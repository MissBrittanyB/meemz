"""Shared pytest fixtures for backend tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://meme-type.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "brittanyb@thebrandingbar.com"
ADMIN_PASSWORD = "Marchelle7!"
ADMIN_USERNAME = "missbrittanyb"

DEMO_EMAIL = "meemzreview@gmail.com"
DEMO_PASSWORD = "Meemz2026!"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def _login(session, email, password):
    resp = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert resp.status_code == 200, f"Login failed for {email}: {resp.status_code} {resp.text}"
    data = resp.json()
    return data["access_token"], data["user"]


@pytest.fixture(scope="session")
def admin_auth(api_client):
    token, user = _login(api_client, ADMIN_EMAIL, ADMIN_PASSWORD)
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="session")
def demo_auth(api_client):
    try:
        token, user = _login(api_client, DEMO_EMAIL, DEMO_PASSWORD)
        return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}
    except AssertionError:
        pytest.skip("Demo account not available")
