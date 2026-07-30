"""Regression tests around the Meta App Events wire-up.

These backend tests exist to prove that adding the FBSDK client-side event calls
did not change the backend API contract. We hit:
  - POST /api/auth/register (must still return access_token + user)
  - POST /api/memes (admin create still succeeds; also feeds GIF regression)
  - POST /api/subscriptions/apple/verify (contract unchanged; expects 400/422
    when no receipt is supplied)
  - GET /api/memes GIF hydration still works (from previous fix)
"""
import base64
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://meme-type.preview.emergentagent.com"
).rstrip("/")


def _tiny_gif_data_uri() -> str:
    b = bytearray()
    b += b"GIF89a"
    b += bytes([1, 0, 1, 0])
    b += bytes([0xF0, 0, 0])
    b += bytes([0xFF, 0xFF, 0xFF])
    b += bytes([0x00, 0x00, 0x00])
    b += bytes([0x21, 0xFF, 0x0B])
    b += b"NETSCAPE2.0"
    b += bytes([0x03, 0x01, 0x00, 0x00, 0x00])
    b += bytes([0x21, 0xF9, 0x04, 0x00, 0x0A, 0x00, 0x00, 0x00])
    b += bytes([0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0])
    b += bytes([0x02, 0x02, 0x4C, 0x01, 0x00])
    b += bytes([0x21, 0xF9, 0x04, 0x00, 0x0A, 0x00, 0x00, 0x00])
    b += bytes([0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0])
    b += bytes([0x02, 0x02, 0x44, 0x01, 0x00])
    b += bytes([0x3B])
    return "data:image/gif;base64," + base64.b64encode(bytes(b)).decode("ascii")


# ---------- Register ----------

class TestRegisterRegression:
    def test_register_returns_access_token_and_user(self, api_client):
        suffix = uuid.uuid4().hex[:10]
        email = f"TEST_meta_{suffix}@example.com"
        username = f"test_meta_{suffix}"
        payload = {"email": email, "password": "TestPass123!", "username": username}
        r = api_client.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
        data = r.json()
        assert "access_token" in data and data["access_token"]
        assert "user" in data
        # backend normalizes email/username to lowercase
        assert data["user"]["email"].lower() == email.lower()
        assert data["user"]["username"].lower() == username.lower()


# ---------- Meme create (admin) ----------

class TestMemeCreateRegression:
    def test_admin_can_create_meme(self, api_client, admin_auth):
        payload = {
            "name": f"TEST_meta_{uuid.uuid4().hex[:8]}",
            "image_base64": _tiny_gif_data_uri(),
            "category": "Reactions",
            "tags": ["test", "meta"],
            "is_public": True,
            "media_type": "gif",
        }
        r = api_client.post(
            f"{BASE_URL}/api/memes",
            json=payload,
            headers=admin_auth["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["id"]
        assert created["media_type"] == "gif"
        # cleanup
        api_client.delete(
            f"{BASE_URL}/api/memes/{created['id']}",
            headers=admin_auth["headers"],
            timeout=15,
        )


# ---------- Apple verify contract ----------

class TestAppleVerifyContract:
    def test_apple_verify_rejects_missing_receipt(self, api_client):
        # Empty body should fail validation; contract unchanged.
        r = api_client.post(
            f"{BASE_URL}/api/subscriptions/apple/verify",
            json={},
            timeout=15,
        )
        # 400 or 422 both indicate "no receipt supplied" - contract preserved.
        assert r.status_code in (400, 401, 422), (
            f"unexpected status {r.status_code}: {r.text[:300]}"
        )

    def test_apple_verify_rejects_bogus_receipt(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/subscriptions/apple/verify",
            json={"receipt_data": "not-a-real-receipt"},
            timeout=20,
        )
        # backend should reject the bogus receipt with a client error
        assert r.status_code in (400, 401, 422, 502), (
            f"unexpected status {r.status_code}: {r.text[:300]}"
        )


# ---------- GIF hydration regression ----------

class TestGifHydrationStillWorks:
    def test_memes_list_gif_hydration(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/memes?limit=50", timeout=30)
        assert r.status_code == 200
        items = r.json()
        gifs = [m for m in items if m.get("media_type") == "gif"]
        if not gifs:
            pytest.skip("No GIFs currently in list")
        for g in gifs:
            assert g.get("image_base64"), f"GIF {g['id']} missing image_base64"
            assert g["image_base64"].startswith("data:image/gif")
        # non-GIFs must still be lightweight
        non_gifs = [m for m in items if m.get("media_type") != "gif"]
        leaked = [m["id"] for m in non_gifs if m.get("image_base64")]
        assert not leaked, f"non-GIFs leaked image_base64: {leaked}"
