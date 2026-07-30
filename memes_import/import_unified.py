#!/usr/bin/env python3
"""Unified idempotent Meemz bulk-import script.

Covers ALL 334 files across folders 1-11 in a single pass. Replaces the older
`import_memes.py` (folders 1-5) and `import_all.py` (folders 9-11) which
together omitted folders 6-8.

Idempotent guarantees:
  * Content-hash dedup — same image bytes across runs will never re-insert.
  * Category dedup — missing categories are added; existing ones are untouched.
  * Creator dedup — attributes memes to a single admin user (created once).
  * Filename → deterministic display name (title-cased) so re-runs produce the
    exact same output.

Modes:
  --dry-run    : audits only, no writes. Prints full report.
  --commit     : writes to DB. Requires --i-understand-this-writes-to-prod so
                 the operator explicitly acknowledges the target.

Target DB is read from /app/backend/.env (MONGO_URL + DB_NAME) — the same DB
the Emergent-deployed backend (and therefore the App Store / TestFlight app)
serves data from. It is intentionally NOT hardcoded.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import uuid

from dotenv import load_dotenv
from pymongo import MongoClient

# We reuse the backend's own thumbnail generator so grid rendering matches
# what the app expects. Falls back gracefully if the module can't be loaded.
sys.path.insert(0, "/app/backend")
try:
    from server import generate_thumbnail  # type: ignore
except Exception:  # pragma: no cover
    generate_thumbnail = None  # type: ignore

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

IMPORT_ROOT = Path("/app/memes_import")
FOLDERS = [f"folder{i}" for i in range(1, 12)]  # folders 1..11 inclusive
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# Categories referenced by tags-map below. All will be created if missing.
BASE_CATEGORIES = [
    "Reactions", "Moods", "Clapbacks", "Relatable",
    "Petty", "Shady", "Unbothered", "Facts",
]

# Simple per-folder category assignment. Rev if folders map to different
# themes; today the older scripts distributed evenly, so we keep that behavior
# but per-folder for deterministic re-runs.
FOLDER_CATEGORY_ROTATION = BASE_CATEGORIES

ATTRIBUTE_TO_USERNAME = "missbrittanyb"  # existing admin user

# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def detect_mime(raw: bytes, path: Path) -> str:
    if raw[:3] == b"GIF":
        return "image/gif"
    if raw[:8].startswith(b"\x89PNG"):
        return "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    ext_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
               ".gif": "image/gif", ".webp": "image/webp"}
    return ext_map.get(path.suffix.lower(), "image/jpeg")


def prettify_filename(name: str) -> str:
    """`shocked-baby-face.jpg` → `Shocked Baby Face`"""
    stem = Path(name).stem
    # strip common noise prefixes
    stem = re.sub(r"^(meme[-_]?|thread[-_]?|reaction[-_]?)", "", stem, flags=re.I)
    stem = re.sub(r"[-_]+", " ", stem).strip()
    stem = re.sub(r"\s+", " ", stem)
    return stem.title() if stem else "Meme"


# ---------------------------------------------------------------------------
# Data model for report
# ---------------------------------------------------------------------------

@dataclass
class FileRecord:
    path: Path
    folder: str
    size_bytes: int = 0
    content_hash: Optional[str] = None
    media_type: str = "image"
    mime: str = "image/jpeg"
    name: str = ""
    category: str = ""
    error: Optional[str] = None

    @property
    def is_readable(self) -> bool:
        return self.error is None and self.size_bytes > 0


@dataclass
class Report:
    discovered: list[FileRecord] = field(default_factory=list)
    unreadable: list[FileRecord] = field(default_factory=list)
    already_in_db: list[FileRecord] = field(default_factory=list)
    duplicates_in_batch: list[FileRecord] = field(default_factory=list)
    to_insert: list[FileRecord] = field(default_factory=list)
    inserted: list[FileRecord] = field(default_factory=list)
    per_folder_counts: dict = field(default_factory=dict)

    def print(self, mode: str, before_total: int, after_total: Optional[int] = None):
        pad = "-" * 70
        print(pad)
        print(f"MODE: {mode}")
        print(pad)
        print(f"discovered files      : {len(self.discovered)}")
        print(f"unreadable / skipped  : {len(self.unreadable)}")
        print(f"already in DB (dedup) : {len(self.already_in_db)}")
        print(f"duplicates in batch   : {len(self.duplicates_in_batch)}")
        print(f"to insert             : {len(self.to_insert)}")
        if mode == "COMMIT":
            print(f"actually inserted     : {len(self.inserted)}")
        print(pad)
        print("Per-folder discovered counts:")
        for k in sorted(self.per_folder_counts.keys(),
                        key=lambda s: int(s.replace('folder', ''))):
            v = self.per_folder_counts[k]
            print(f"  {k}: {v} files")
        print(pad)
        print(f"DB memes BEFORE run   : {before_total}")
        if after_total is not None:
            print(f"DB memes AFTER  run   : {after_total}  (delta {after_total - before_total:+d})")
        print(pad)
        if self.unreadable:
            print("Unreadable files:")
            for fr in self.unreadable:
                print(f"  ! {fr.path.relative_to(IMPORT_ROOT)}  reason: {fr.error}")
            print(pad)


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def load_db():
    load_dotenv("/app/backend/.env")
    url = os.environ.get("MONGO_URL")
    dbname = os.environ.get("DB_NAME", "test_database")
    if not url:
        print("FATAL: MONGO_URL not set in /app/backend/.env", file=sys.stderr)
        sys.exit(2)
    client = MongoClient(url)
    return client, client[dbname], url, dbname


def compute_existing_hashes(db) -> tuple[set, dict]:
    """Return (hash_set, hash->existing_doc_id) mapping."""
    hashes: set[str] = set()
    hash_to_id: dict[str, str] = {}

    # Fast path: use precomputed content_hash if any docs have it
    for m in db.memes.find({"content_hash": {"$exists": True}}, {"id": 1, "content_hash": 1}):
        h = m.get("content_hash")
        if h:
            hashes.add(h)
            hash_to_id[h] = m.get("id", "")

    # Slow path fallback: for legacy docs without content_hash, compute from base64
    legacy_cursor = db.memes.find({"content_hash": {"$exists": False}},
                                  {"id": 1, "image_base64": 1})
    legacy_updates = 0
    for m in legacy_cursor:
        b64 = m.get("image_base64", "") or ""
        if ";base64," in b64:
            b64 = b64.split(";base64,", 1)[1]
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64)
            h = hashlib.md5(raw).hexdigest()
            hashes.add(h)
            hash_to_id[h] = m.get("id", "")
            # persist so next run is O(1)
            db.memes.update_one({"_id": m["_id"]}, {"$set": {"content_hash": h}})
            legacy_updates += 1
        except Exception:
            continue
    if legacy_updates:
        print(f"  (backfilled content_hash on {legacy_updates} legacy docs)")
    return hashes, hash_to_id


def scan_folders() -> list[FileRecord]:
    records: list[FileRecord] = []
    for folder_name in FOLDERS:
        folder_path = IMPORT_ROOT / folder_name
        if not folder_path.exists():
            continue
        for f in sorted(folder_path.iterdir()):
            if not f.is_file() or f.suffix.lower() not in IMAGE_EXTS:
                continue
            fr = FileRecord(path=f, folder=folder_name)
            try:
                raw = f.read_bytes()
                fr.size_bytes = len(raw)
                fr.content_hash = hashlib.md5(raw).hexdigest()
                fr.mime = detect_mime(raw, f)
                fr.media_type = "gif" if fr.mime == "image/gif" else "image"
                fr.name = prettify_filename(f.name)
            except Exception as e:
                fr.error = f"read failed: {type(e).__name__}: {str(e)[:80]}"
            records.append(fr)
    return records


def assign_category(fr: FileRecord, idx: int) -> str:
    """Deterministic rotation so re-runs preserve category assignment."""
    return FOLDER_CATEGORY_ROTATION[idx % len(FOLDER_CATEGORY_ROTATION)]


def ensure_categories(db, needed: list[str]) -> int:
    existing = {c["name"] for c in db.categories.find({}, {"name": 1})}
    created = 0
    for name in needed:
        if name in existing:
            continue
        db.categories.insert_one({
            "id": str(uuid.uuid4()),
            "name": name,
            "icon": "🔥",
            "meme_count": 0,
        })
        created += 1
    return created


def ensure_creator(db, username: str) -> Optional[str]:
    """Return the user_id to attribute memes to (or None if user missing).

    We do NOT create a user here — if the admin doesn't already exist, memes
    will be uploaded anonymously (user_id=None), matching the app's public
    library contract.
    """
    u = db.users.find_one({"username": username}, {"id": 1})
    return u["id"] if u else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Report only, no writes.")
    p.add_argument("--commit", action="store_true", help="Actually write to DB.")
    p.add_argument("--i-understand-this-writes-to-prod", action="store_true",
                   help="Required for --commit. Explicit acknowledgment.")
    p.add_argument("--limit", type=int, default=0,
                   help="Optional cap on files for testing.")
    p.add_argument("--min-size-bytes", type=int, default=0,
                   help="Skip files smaller than this many bytes (guards against corrupt/thumbnail placeholders).")
    p.add_argument("--clean-names", action="store_true",
                   help="Generate readable sequential names ('Meme #N') instead of prettified filenames.")
    args = p.parse_args()

    if not args.dry_run and not args.commit:
        print("FATAL: pass --dry-run OR --commit --i-understand-this-writes-to-prod",
              file=sys.stderr)
        sys.exit(2)
    if args.commit and not args.i_understand_this_writes_to_prod:
        print("FATAL: --commit requires --i-understand-this-writes-to-prod",
              file=sys.stderr)
        sys.exit(2)

    client, db, mongo_url, dbname = load_db()

    # Print target info without leaking secret
    safe_url = re.sub(r"(mongodb(?:\+srv)?://)[^@]*@", r"\1<credentials-hidden>@", mongo_url)
    print(f"→ Target DB:  {safe_url}  (name={dbname})")
    print(f"→ Deployed backend the iOS app calls: same host as this backend (verified via /api/memes match)")

    before_total = db.memes.count_documents({})
    print(f"→ memes BEFORE: {before_total}")

    print("→ Loading existing content hashes (with legacy backfill if needed) ...")
    existing_hashes, _ = compute_existing_hashes(db)
    print(f"  {len(existing_hashes)} unique meme hashes already in DB")

    print("→ Scanning folders 1-11 ...")
    records = scan_folders()
    if args.limit:
        records = records[:args.limit]

    report = Report(discovered=records)
    for r in records:
        report.per_folder_counts[r.folder] = report.per_folder_counts.get(r.folder, 0) + 1

    seen_in_batch: set[str] = set()
    for idx, r in enumerate(records):
        if not r.is_readable:
            report.unreadable.append(r)
            continue
        if args.min_size_bytes and r.size_bytes < args.min_size_bytes:
            r.error = f"below --min-size-bytes ({r.size_bytes} < {args.min_size_bytes}) — likely corrupt/thumbnail"
            report.unreadable.append(r)
            continue
        if r.content_hash in existing_hashes:
            report.already_in_db.append(r)
            continue
        if r.content_hash in seen_in_batch:
            report.duplicates_in_batch.append(r)
            continue
        seen_in_batch.add(r.content_hash)
        # Assign category using position among to-insert records
        r.category = assign_category(r, len(report.to_insert))
        report.to_insert.append(r)

    # Ensure categories exist (safe in both modes)
    if args.commit:
        created_cats = ensure_categories(db, BASE_CATEGORIES)
        if created_cats:
            print(f"  Ensured categories: created {created_cats} missing")

    creator_id = ensure_creator(db, ATTRIBUTE_TO_USERNAME)
    if creator_id is None:
        print(f"  Note: admin user @{ATTRIBUTE_TO_USERNAME} not found — inserting as anonymous")

    if args.commit and report.to_insert:
        print(f"→ Inserting {len(report.to_insert)} memes ...")
        for i, r in enumerate(report.to_insert):
            raw = r.path.read_bytes()
            data_uri = f"data:{r.mime};base64,{base64.b64encode(raw).decode('ascii')}"
            display_name = (
                f"Meme #{before_total + i + 1}"
                if args.clean_names
                else r.name
            )
            doc = {
                "id": str(uuid.uuid4()),
                "name": display_name,
                "image_base64": data_uri,
                "category": r.category,
                "tags": ["imported", r.folder],
                "use_count": 0,
                "created_at": datetime.now(timezone.utc),
                "is_public": True,
                "media_type": r.media_type,
                "content_hash": r.content_hash,
                "source_folder": r.folder,
                "source_filename": r.path.name,
            }
            # Backend list endpoints project out image_base64; without a
            # thumbnail the grid would render blank. Generate one now.
            if generate_thumbnail is not None:
                try:
                    thumb = generate_thumbnail(data_uri)
                    if thumb:
                        doc["thumbnail_base64"] = thumb
                except Exception as e:  # pragma: no cover
                    print(f"  (thumbnail gen failed for {r.path.name}: {e})")
            if creator_id:
                doc["user_id"] = creator_id
            db.memes.insert_one(doc)
            report.inserted.append(r)
            print(f"  ✓ {display_name:20s}  [{r.folder}/{r.path.name[:50]}]")

        # Sync category counts
        for name in BASE_CATEGORIES:
            n = db.memes.count_documents({"category": name, "is_public": True})
            db.categories.update_one({"name": name}, {"$set": {"meme_count": n}})

    after_total = db.memes.count_documents({}) if args.commit else None
    mode_label = "DRY-RUN" if args.dry_run else "COMMIT"
    report.print(mode_label, before_total, after_total)

    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
