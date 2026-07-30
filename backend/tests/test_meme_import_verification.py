"""
Backend verification suite for the 4 net-new meme import into the live Meemz
production DB (Option A: --min-size-bytes 8192 --clean-names).

Strategy:
  (a) HTTP against the public EXPO_PUBLIC_BACKEND_URL (same host TestFlight
      1.0.15 (1017) hits) — anonymous, no Authorization header.
  (b) Read-only Mongo queries via pymongo using /app/backend/.env
      MONGO_URL + DB_NAME.
  (c) Re-run `import_unified.py --dry-run` to prove idempotency.

Read-only. No writes to DB. No supervisor restarts.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import List, Dict, Any

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# ---------------------------------------------------------------------------
# Fixtures / env loading
# ---------------------------------------------------------------------------

# Load frontend env for the public URL
load_dotenv("/app/frontend/.env")
PUBLIC_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

# Load backend env for MONGO_URL + DB_NAME
load_dotenv("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

NEW_MEME_NAMES = {"Meme #510", "Meme #511", "Meme #512", "Meme #513"}
EXPECTED_TOTAL = 513
CORRUPT_FILENAME = "ImgHunt_Threads_20260409_ImgHunt_Threads_20260409.jpeg"


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    # Intentionally NO Authorization header — anonymous testing.
    s.headers.update({"Accept": "application/json"})
    return s


@pytest.fixture(scope="module")
def db():
    assert MONGO_URL, "MONGO_URL missing from /app/backend/.env"
    assert DB_NAME, "DB_NAME missing from /app/backend/.env"
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def all_public_memes(http) -> List[Dict[str, Any]]:
    """Paginate the anonymous public list endpoint until exhausted."""
    assert PUBLIC_URL, "EXPO_PUBLIC_BACKEND_URL missing"
    out: List[Dict[str, Any]] = []
    skip = 0
    limit = 100
    while skip <= 1000:  # safety cap
        r = http.get(f"{PUBLIC_URL}/api/memes",
                     params={"limit": limit, "skip": skip}, timeout=30)
        assert r.status_code == 200, f"GET /api/memes failed {r.status_code} at skip={skip}"
        batch = r.json()
        assert isinstance(batch, list), f"expected list, got {type(batch)}"
        out.extend(batch)
        if len(batch) < limit:
            break
        skip += limit
    return out


# ---------------------------------------------------------------------------
# 1) Live production count via public URL == 513
# ---------------------------------------------------------------------------

class TestPublicCount:
    def test_total_public_memes_is_513(self, all_public_memes):
        assert len(all_public_memes) == EXPECTED_TOTAL, (
            f"public /api/memes returned {len(all_public_memes)} items, expected {EXPECTED_TOTAL}"
        )


# ---------------------------------------------------------------------------
# 2) Anonymous visibility of the 4 new memes in the newest-first window
# ---------------------------------------------------------------------------

class TestAnonymousVisibility:
    def test_new_memes_visible_in_first_window(self, http):
        r = http.get(f"{PUBLIC_URL}/api/memes",
                     params={"limit": 100, "skip": 0}, timeout=30)
        assert r.status_code == 200
        first_100 = r.json()
        names = [m.get("name") for m in first_100]
        for expected in NEW_MEME_NAMES:
            assert expected in names, f"{expected} not found in first 100 items (newest-first)"

    def test_new_memes_are_public(self, all_public_memes):
        found = [m for m in all_public_memes if m.get("name") in NEW_MEME_NAMES]
        assert len(found) == 4, f"expected 4 new memes in public list, got {len(found)}"
        for m in found:
            assert m.get("is_public") is True, f"{m.get('name')} is_public != True"


# ---------------------------------------------------------------------------
# 3) Thumbnail presence for the 4 new memes (grid render sanity)
# ---------------------------------------------------------------------------

class TestThumbnailPresence:
    def test_new_memes_have_thumbnail_base64(self, all_public_memes):
        found = [m for m in all_public_memes if m.get("name") in NEW_MEME_NAMES]
        assert len(found) == 4, f"expected 4 new memes, got {len(found)}"
        for m in found:
            thumb = m.get("thumbnail_base64")
            assert thumb, f"{m.get('name')} missing thumbnail_base64"
            assert isinstance(thumb, str) and thumb.startswith("data:image/"), (
                f"{m.get('name')} thumbnail_base64 does not start with 'data:image/' "
                f"(got {str(thumb)[:40]}...)"
            )


# ---------------------------------------------------------------------------
# 4) Per-item GET /api/memes/{id} returns 200 + full image_base64 > 100KB
# ---------------------------------------------------------------------------

class TestPerItemFetch:
    def test_each_new_meme_full_fetch(self, http, all_public_memes):
        found = [m for m in all_public_memes if m.get("name") in NEW_MEME_NAMES]
        assert len(found) == 4
        for m in found:
            mid = m.get("id")
            assert mid, f"{m.get('name')} missing id"
            r = http.get(f"{PUBLIC_URL}/api/memes/{mid}", timeout=30)
            assert r.status_code == 200, (
                f"GET /api/memes/{mid} ({m.get('name')}) returned {r.status_code}"
            )
            body = r.json()
            img_b64 = body.get("image_base64") or ""
            assert img_b64.startswith("data:image/"), (
                f"{m.get('name')} image_base64 malformed"
            )
            # >100KB total string is a proxy for the raw file being 386-866KB
            assert len(img_b64) > 100_000, (
                f"{m.get('name')} image_base64 too small: {len(img_b64)} chars"
            )


# ---------------------------------------------------------------------------
# 5) Idempotency proof: --dry-run report numbers match exactly
# ---------------------------------------------------------------------------

class TestIdempotency:
    def test_dry_run_shows_no_new_inserts(self):
        proc = subprocess.run(
            ["python3", "import_unified.py",
             "--dry-run", "--min-size-bytes", "8192", "--clean-names"],
            cwd="/app/memes_import",
            capture_output=True, text=True, timeout=180,
        )
        assert proc.returncode == 0, (
            f"dry-run exited {proc.returncode}\nSTDOUT:\n{proc.stdout}\n"
            f"STDERR:\n{proc.stderr}"
        )
        out = proc.stdout
        # Parse the printed report lines
        def _num(label: str) -> int:
            m = re.search(rf"{re.escape(label)}\s*:\s*(\d+)", out)
            assert m, f"could not find '{label}' in dry-run output:\n{out}"
            return int(m.group(1))

        discovered = _num("discovered files")
        unreadable = _num("unreadable / skipped")
        already   = _num("already in DB (dedup)")
        to_insert = _num("to insert")

        assert discovered == 334, f"discovered={discovered}, expected 334"
        assert unreadable == 1,   f"unreadable={unreadable}, expected 1"
        assert already   == 333, f"already_in_db={already}, expected 333"
        assert to_insert == 0,   f"to_insert={to_insert}, expected 0 (idempotency broken!)"


# ---------------------------------------------------------------------------
# 6) content_hash persisted on all 4 new docs (32-char hex)
# ---------------------------------------------------------------------------

class TestContentHashPersisted:
    def test_new_memes_have_content_hash(self, db):
        docs = list(db.memes.find(
            {"name": {"$in": list(NEW_MEME_NAMES)}},
            {"name": 1, "content_hash": 1, "_id": 0}
        ))
        assert len(docs) == 4, f"expected 4 docs in DB, got {len(docs)}: {docs}"
        hex_re = re.compile(r"^[0-9a-f]{32}$")
        seen_hashes = set()
        for d in docs:
            h = d.get("content_hash")
            assert h, f"{d.get('name')} missing content_hash"
            assert hex_re.match(h), (
                f"{d.get('name')} content_hash not 32-char hex: {h}"
            )
            seen_hashes.add(h)
        assert len(seen_hashes) == 4, (
            f"content_hashes not unique across the 4 new docs: {seen_hashes}"
        )


# ---------------------------------------------------------------------------
# 7) Regression: existing memes untouched
# ---------------------------------------------------------------------------

class TestRegression:
    def test_random_five_preexisting_memes_still_fetch(self, http, all_public_memes):
        others = [m for m in all_public_memes if m.get("name") not in NEW_MEME_NAMES]
        assert len(others) >= 5
        # Take 5 spread across the list (front, middle, back) — deterministic.
        idxs = [0, len(others)//4, len(others)//2, 3*len(others)//4, len(others)-1]
        for i in idxs:
            m = others[i]
            mid = m.get("id")
            r = http.get(f"{PUBLIC_URL}/api/memes/{mid}", timeout=30)
            assert r.status_code == 200, (
                f"preexisting meme id={mid} name={m.get('name')} fetch failed {r.status_code}"
            )
            body = r.json()
            assert body.get("id") == mid
            assert body.get("image_base64", "").startswith("data:image/")

    def test_user_count_and_category_count_sane(self, db):
        users = db.users.count_documents({})
        cats  = db.categories.count_documents({})
        assert users >= 1, f"users collection empty (got {users})"
        # 8 baseline categories or 9 (Funny added earlier this session)
        assert cats in (8, 9), f"unexpected category count: {cats} (want 8 or 9)"


# ---------------------------------------------------------------------------
# 8) No duplicate categories
# ---------------------------------------------------------------------------

class TestCategories:
    def test_category_count_and_uniqueness(self, db):
        cats = list(db.categories.find({}, {"name": 1, "_id": 0}))
        names = [c["name"] for c in cats]
        assert len(cats) in (8, 9), f"got {len(cats)} categories: {names}"
        assert len(names) == len(set(names)), (
            f"duplicate category names found: {sorted(names)}"
        )


# ---------------------------------------------------------------------------
# 9) Corrupt 3KB file was NOT inserted
# ---------------------------------------------------------------------------

class TestCorruptFileSkipped:
    def test_no_meme_from_corrupt_source(self, db):
        hit = db.memes.find_one({"source_filename": CORRUPT_FILENAME})
        assert hit is None, (
            f"Corrupt 3KB file was imported anyway! doc: "
            f"{ {k: v for k, v in hit.items() if k != 'image_base64'} }"
        )

    def test_no_meme_has_tiny_image_base64(self, db):
        # Any doc with a bizarrely short base64 payload indicates the corrupt
        # placeholder slipped in. All real memes are well above 8KB → base64
        # will be >10K chars.
        tiny = list(db.memes.find(
            {"image_base64": {"$exists": True},
             "$expr": {"$lt": [{"$strLenCP": "$image_base64"}, 8000]}},
            {"name": 1, "source_filename": 1, "_id": 0}
        ))
        assert tiny == [], f"found {len(tiny)} memes with suspiciously short image_base64: {tiny[:3]}"
