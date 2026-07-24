"""Tests for GIF display in list endpoints and GIF upload flow.

Bug context: List endpoints (/api/memes, /api/memes/explore, /api/users/{u}/memes)
previously excluded image_base64 for ALL items to keep grids fast. That caused
GIFs to appear static because the frontend only had `thumbnail_base64` (a JPEG
first-frame). The fix: for items where `media_type == "gif"`, list endpoints
now populate `image_base64` with the full animated data URI.

Non-GIF items must still have `image_base64` absent/null in list responses
(the perf goal).
"""
import base64
import os
import time
import uuid
from typing import List

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://meme-type.preview.emergentagent.com").rstrip("/")


# Smallest possible valid animated GIF (2 frames, 1x1 px) generated inline.
# Verified starts with GIF89a magic bytes.
def _tiny_gif_data_uri() -> str:
    # 1x1 transparent 2-frame animated GIF (~50 bytes)
    gif_hex = (
        "47494638396101000100f00000ffffff00000021f90400090000002c00000000"
        "0100010000020144003b"
    )
    # That's just 1 frame. Build a real 2-frame animated gif:
    # Header GIF89a + LSD + GCT + NETSCAPE loop + 2 frames.
    b = bytearray()
    b += b"GIF89a"
    b += bytes([1, 0, 1, 0])          # width=1 height=1
    b += bytes([0xF0, 0, 0])          # GCT flag, 2-color table
    b += bytes([0xFF, 0xFF, 0xFF])    # color 0 white
    b += bytes([0x00, 0x00, 0x00])    # color 1 black
    # NETSCAPE2.0 loop extension
    b += bytes([0x21, 0xFF, 0x0B])
    b += b"NETSCAPE2.0"
    b += bytes([0x03, 0x01, 0x00, 0x00, 0x00])
    # Frame 1
    b += bytes([0x21, 0xF9, 0x04, 0x00, 0x0A, 0x00, 0x00, 0x00])  # GCE delay 10
    b += bytes([0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0])                  # image descriptor
    b += bytes([0x02, 0x02, 0x4C, 0x01, 0x00])                     # LZW min + data + terminator
    # Frame 2
    b += bytes([0x21, 0xF9, 0x04, 0x00, 0x0A, 0x00, 0x00, 0x00])
    b += bytes([0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0])
    b += bytes([0x02, 0x02, 0x44, 0x01, 0x00])
    b += bytes([0x3B])                                             # trailer
    return "data:image/gif;base64," + base64.b64encode(bytes(b)).decode("ascii")


# 1x1 red PNG
def _tiny_png_data_uri() -> str:
    png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+h"
        "HgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    )
    return "data:image/png;base64," + png_b64


# ==================== Auth helpers ====================

class TestAuthAndBasics:
    """Sanity: backend up, admin can login."""

    def test_backend_up(self):
        r = requests.get(f"{BASE_URL}/api/categories", timeout=15)
        assert r.status_code == 200

    def test_admin_login(self, admin_auth):
        assert admin_auth["token"]
        assert admin_auth["user"]["username"] == "missbrittanyb"


# ==================== Core GIF list-endpoint tests ====================

def _summarize(items: List[dict]) -> dict:
    total = len(items)
    gifs = [m for m in items if m.get("media_type") == "gif"]
    non_gifs = [m for m in items if m.get("media_type") != "gif"]
    gifs_with_img = [m for m in gifs if m.get("image_base64")]
    non_gifs_with_img = [m for m in non_gifs if m.get("image_base64")]
    return {
        "total": total,
        "gifs": len(gifs),
        "non_gifs": len(non_gifs),
        "gifs_with_image_base64": len(gifs_with_img),
        "non_gifs_with_image_base64": len(non_gifs_with_img),
    }


class TestMemeListGifContract:
    """GET /api/memes must return image_base64 for GIFs, and NOT for non-GIFs."""

    def test_get_memes_returns_image_base64_only_for_gifs(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/memes?limit=50", timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list) and len(items) > 0, "Expected non-empty meme list"

        summary = _summarize(items)
        print(f"[/api/memes] summary: {summary}")

        # All GIFs must have image_base64 populated
        gifs = [m for m in items if m.get("media_type") == "gif"]
        if gifs:
            missing = [m["id"] for m in gifs if not m.get("image_base64")]
            assert not missing, f"GIF items missing image_base64: {missing}"
            for g in gifs:
                assert g["image_base64"].startswith("data:image/gif"), (
                    f"GIF id={g['id']} image_base64 does not start with data:image/gif "
                    f"(got prefix {g['image_base64'][:30]})"
                )
        else:
            pytest.skip("No GIF memes present in first 50; upload test will create one.")

        # Non-GIFs must NOT include image_base64 (perf contract)
        non_gifs = [m for m in items if m.get("media_type") != "gif"]
        leaked = [m["id"] for m in non_gifs if m.get("image_base64")]
        assert not leaked, f"Non-GIF items should not include image_base64 in list, found: {leaked}"

    def test_explore_memes_gif_contract(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/memes/explore?limit=50", timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        summary = _summarize(items)
        print(f"[/api/memes/explore] summary: {summary}")

        gifs = [m for m in items if m.get("media_type") == "gif"]
        if gifs:
            for g in gifs:
                assert g.get("image_base64"), f"Explore GIF id={g['id']} missing image_base64"
                assert g["image_base64"].startswith("data:image/gif"), (
                    f"Explore GIF id={g['id']} bad prefix {g['image_base64'][:30]}"
                )
        non_gifs = [m for m in items if m.get("media_type") != "gif"]
        leaked = [m["id"] for m in non_gifs if m.get("image_base64")]
        assert not leaked, f"Explore leaked image_base64 for non-GIFs: {leaked}"

    def test_user_memes_gif_contract(self, api_client, admin_auth):
        r = api_client.get(
            f"{BASE_URL}/api/users/missbrittanyb/memes",
            headers=admin_auth["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        items = r.json()
        summary = _summarize(items)
        print(f"[/api/users/missbrittanyb/memes] summary: {summary}")

        gifs = [m for m in items if m.get("media_type") == "gif"]
        if gifs:
            for g in gifs:
                assert g.get("image_base64"), f"User GIF id={g['id']} missing image_base64"
                assert g["image_base64"].startswith("data:image/gif"), (
                    f"User GIF id={g['id']} bad prefix {g['image_base64'][:30]}"
                )
        non_gifs = [m for m in items if m.get("media_type") != "gif"]
        leaked = [m["id"] for m in non_gifs if m.get("image_base64")]
        assert not leaked, f"User-memes leaked image_base64 for non-GIFs: {leaked}"


# ==================== Upload GIF → re-list contract ====================

class TestGifUploadAndReList:
    """POST a GIF, then verify list endpoint returns it with full image_base64."""

    @pytest.fixture(scope="class")
    def uploaded_gif(self, api_client, admin_auth):
        data_uri = _tiny_gif_data_uri()
        payload = {
            "name": f"TEST_gif_{uuid.uuid4().hex[:8]}",
            "image_base64": data_uri,
            "category": "Reactions",
            "tags": ["test", "gif"],
            "is_public": True,
            "media_type": "gif",
        }
        r = api_client.post(
            f"{BASE_URL}/api/memes",
            json=payload,
            headers=admin_auth["headers"],
            timeout=30,
        )
        assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text}"
        created = r.json()
        assert created["media_type"] == "gif", f"media_type not gif: {created.get('media_type')}"
        assert created["image_base64"].startswith("data:image/gif")
        yield {"id": created["id"], "name": payload["name"], "data_uri": data_uri}

        # Cleanup
        try:
            api_client.delete(
                f"{BASE_URL}/api/memes/{created['id']}",
                headers=admin_auth["headers"],
                timeout=15,
            )
        except Exception:
            pass

    def test_uploaded_gif_appears_in_memes_list_with_image_base64(self, api_client, uploaded_gif):
        # Give the DB a moment
        time.sleep(0.5)
        r = api_client.get(f"{BASE_URL}/api/memes?limit=50", timeout=30)
        assert r.status_code == 200
        items = r.json()
        match = next((m for m in items if m["id"] == uploaded_gif["id"]), None)
        assert match is not None, f"Uploaded GIF {uploaded_gif['id']} not found in /api/memes?limit=50"
        assert match["media_type"] == "gif"
        assert match.get("image_base64"), "image_base64 missing on newly uploaded GIF in list"
        assert match["image_base64"].startswith("data:image/gif"), (
            f"bad prefix {match['image_base64'][:30]}"
        )
        # Verify it's the actual full data (matches or at least is a plausible GIF payload)
        assert len(match["image_base64"]) > 100, "image_base64 looks truncated"

    def test_uploaded_gif_appears_in_user_memes(self, api_client, admin_auth, uploaded_gif):
        r = api_client.get(
            f"{BASE_URL}/api/users/missbrittanyb/memes",
            headers=admin_auth["headers"],
            timeout=30,
        )
        assert r.status_code == 200
        items = r.json()
        match = next((m for m in items if m["id"] == uploaded_gif["id"]), None)
        assert match is not None, "Uploaded GIF not in user memes"
        assert match.get("image_base64", "").startswith("data:image/gif")

    def test_single_meme_endpoint_returns_full_image(self, api_client, uploaded_gif):
        r = api_client.get(f"{BASE_URL}/api/memes/{uploaded_gif['id']}", timeout=30)
        assert r.status_code == 200
        m = r.json()
        assert m["media_type"] == "gif"
        assert m["image_base64"].startswith("data:image/gif")
        assert len(m["image_base64"]) > 100


# ==================== Regression: single-item, reports, block ====================

class TestSingleMemeEndpoint:
    """Regression: /api/memes/{id} was never affected; must still return full base64."""

    def test_single_meme_for_first_available(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/memes?limit=5", timeout=30)
        assert r.status_code == 200
        items = r.json()
        if not items:
            pytest.skip("No memes available for single-item regression")
        meme_id = items[0]["id"]
        r2 = api_client.get(f"{BASE_URL}/api/memes/{meme_id}", timeout=30)
        assert r2.status_code == 200
        m = r2.json()
        assert m.get("image_base64"), "Single-item endpoint missing image_base64"
        assert m["image_base64"].startswith("data:"), "image_base64 not a data URI"


class TestReportsRegression:
    """/api/reports POST + GET (admin) still function."""

    def test_report_content_submit_and_admin_list(self, api_client, admin_auth):
        # Submit a report on a real meme
        list_r = api_client.get(f"{BASE_URL}/api/memes?limit=1", timeout=15)
        assert list_r.status_code == 200
        items = list_r.json()
        if not items:
            pytest.skip("No memes to report against")
        meme_id = items[0]["id"]

        payload = {
            "content_id": meme_id,
            "content_type": "meme",
            "reason": "TEST_regression",
            "description": "TEST_ automated regression report - safe to ignore",
        }
        r = api_client.post(
            f"{BASE_URL}/api/reports",
            json=payload,
            headers=admin_auth["headers"],
            timeout=15,
        )
        assert r.status_code == 200, f"Report submit failed: {r.status_code} {r.text}"
        rep = r.json()
        assert "report_id" in rep

        # Admin can list reports
        r2 = api_client.get(
            f"{BASE_URL}/api/reports",
            headers=admin_auth["headers"],
            timeout=15,
        )
        assert r2.status_code == 200
        reports = r2.json()
        assert isinstance(reports, list)
        # Our report should appear
        found = any(rp.get("id") == rep["report_id"] for rp in reports)
        assert found, "Newly submitted report not returned by GET /api/reports"


class TestBlockRegression:
    """/api/users/{username}/block toggle still functions and profile shows is_blocked."""

    def test_block_and_unblock_and_profile_shows_is_blocked(self, api_client, admin_auth, demo_auth):
        """Admin blocks the demo user, then unblocks. Profile response must expose is_blocked."""
        target_username = demo_auth["user"]["username"]

        # Ensure clean state - try unblock first
        api_client.delete(
            f"{BASE_URL}/api/users/{target_username}/block",
            headers=admin_auth["headers"],
            timeout=15,
        )

        # Block
        r = api_client.post(
            f"{BASE_URL}/api/users/{target_username}/block",
            headers=admin_auth["headers"],
            timeout=15,
        )
        assert r.status_code == 200, f"Block failed: {r.text}"

        # Profile shows is_blocked=True
        prof = api_client.get(
            f"{BASE_URL}/api/users/{target_username}/profile",
            headers=admin_auth["headers"],
            timeout=15,
        )
        assert prof.status_code == 200
        prof_data = prof.json()
        assert "is_blocked" in prof_data, "Profile response missing is_blocked field"
        assert prof_data["is_blocked"] is True, f"Expected is_blocked=True, got {prof_data.get('is_blocked')}"

        # Unblock
        r2 = api_client.delete(
            f"{BASE_URL}/api/users/{target_username}/block",
            headers=admin_auth["headers"],
            timeout=15,
        )
        assert r2.status_code == 200, f"Unblock failed: {r2.text}"

        # Profile now shows is_blocked=False
        prof2 = api_client.get(
            f"{BASE_URL}/api/users/{target_username}/profile",
            headers=admin_auth["headers"],
            timeout=15,
        )
        assert prof2.status_code == 200
        assert prof2.json().get("is_blocked") is False
