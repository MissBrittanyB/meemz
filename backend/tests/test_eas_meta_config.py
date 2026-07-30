"""
Config validation tests for EAS iOS Meta (FBSDK) env vars.
Read-only validation only — no builds, no file edits.
SECURITY: never log the client-token value; only length + sha256 prefix.
"""
import hashlib
import json
import os
import subprocess
import pytest
import requests

EAS_PATH = "/app/frontend/eas.json"
APP_CONFIG_PATH = "/app/frontend/app.config.js"
FRONTEND_DIR = "/app/frontend"
EXPECTED_APP_ID = "2826139691089206"
TOKEN_LEN = 32
BACKEND_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://meme-type.preview.emergentagent.com"
).rstrip("/")


# ---------- helpers ----------
def _load_eas():
    with open(EAS_PATH) as f:
        return json.load(f)


def _token_fp(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:8]


def _run_node_config(env_extra: dict) -> str:
    env = os.environ.copy()
    # strip inherited meta vars first for a clean baseline
    for k in ("EXPO_PUBLIC_META_APP_ID", "EXPO_PUBLIC_META_CLIENT_TOKEN"):
        env.pop(k, None)
    env.update(env_extra)
    script = (
        "const c=require('./app.config.js');"
        "const p=c.plugins;"
        "const fb=p.find(x=>Array.isArray(x)&&x[0]==='react-native-fbsdk-next');"
        "const out={pluginCount:p.length,"
        "metaConfigured:c.extra.metaAppEventsConfigured,"
        "fb:fb?fb[1]:null};"
        "console.log(JSON.stringify(out));"
    )
    res = subprocess.run(
        ["node", "-e", script],
        cwd=FRONTEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert res.returncode == 0, f"node exec failed: {res.stderr}"
    # extract the last JSON line
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.strip().startswith("{")]
    assert lines, f"no JSON in output: {res.stdout}"
    return json.loads(lines[-1])


# ---------- eas.json structural tests ----------
class TestEasJsonStructure:
    def test_json_parses(self):
        data = _load_eas()
        assert "build" in data and "cli" in data

    def test_cli_unaltered(self):
        cli = _load_eas()["cli"]
        assert cli.get("version") == ">= 7.0.0"
        assert cli.get("appVersionSource") == "remote"

    def test_production_env_has_both_keys(self):
        prod = _load_eas()["build"]["production"]["env"]
        assert prod.get("EXPO_PUBLIC_META_APP_ID") == EXPECTED_APP_ID
        tok = prod.get("EXPO_PUBLIC_META_CLIENT_TOKEN", "")
        assert isinstance(tok, str) and len(tok) == TOKEN_LEN, (
            f"token length {len(tok)} != {TOKEN_LEN}"
        )
        print(f"prod token: len={len(tok)} fp={_token_fp(tok)}")

    def test_preview_env_has_both_keys(self):
        prev = _load_eas()["build"]["preview"]["env"]
        assert prev.get("EXPO_PUBLIC_META_APP_ID") == EXPECTED_APP_ID
        tok = prev.get("EXPO_PUBLIC_META_CLIENT_TOKEN", "")
        assert isinstance(tok, str) and len(tok) == TOKEN_LEN
        print(f"preview token: len={len(tok)} fp={_token_fp(tok)}")

    def test_preview_and_production_tokens_match(self):
        b = _load_eas()["build"]
        assert (
            b["production"]["env"]["EXPO_PUBLIC_META_CLIENT_TOKEN"]
            == b["preview"]["env"]["EXPO_PUBLIC_META_CLIENT_TOKEN"]
        )

    def test_development_profile_has_no_meta_env(self):
        dev = _load_eas()["build"]["development"]
        env = dev.get("env", {}) or {}
        assert "EXPO_PUBLIC_META_APP_ID" not in env
        assert "EXPO_PUBLIC_META_CLIENT_TOKEN" not in env

    def test_development_profile_unaltered(self):
        dev = _load_eas()["build"]["development"]
        assert dev.get("developmentClient") is True
        assert dev.get("distribution") == "internal"
        assert dev["ios"]["resourceClass"] == "m-medium"
        assert dev["ios"]["simulator"] is True

    def test_preview_profile_unaltered_non_env(self):
        prev = _load_eas()["build"]["preview"]
        assert prev.get("distribution") == "internal"
        assert prev["ios"]["resourceClass"] == "m-medium"
        assert prev["ios"]["simulator"] is False

    def test_production_profile_unaltered_non_env(self):
        prod = _load_eas()["build"]["production"]
        assert prod.get("autoIncrement") is True
        assert prod["ios"]["resourceClass"] == "m-medium"
        assert prod["ios"]["simulator"] is False
        assert prod["ios"]["buildConfiguration"] == "Release"


# ---------- app.config.js simulated environments ----------
class TestAppConfigSimulation:
    def test_baseline_unset_env_produces_5_plugins(self):
        out = _run_node_config({})
        assert out["pluginCount"] == 5, out
        assert out["metaConfigured"] is False
        assert out["fb"] is None

    def test_production_env_produces_6_plugins(self):
        prod_env = _load_eas()["build"]["production"]["env"]
        out = _run_node_config(prod_env)
        assert out["pluginCount"] == 6, out
        assert out["metaConfigured"] is True
        fb = out["fb"]
        assert fb is not None
        assert fb["appID"] == EXPECTED_APP_ID
        assert isinstance(fb["clientToken"], str) and len(fb["clientToken"]) == TOKEN_LEN
        assert fb["isAutoInitEnabled"] is True
        assert fb["autoLogAppEventsEnabled"] is True
        assert fb["advertiserIDCollectionEnabled"] is False
        assert fb["scheme"] == f"fb{EXPECTED_APP_ID}"
        assert fb["displayName"] == "meemz"

    def test_preview_env_produces_6_plugins(self):
        prev_env = _load_eas()["build"]["preview"]["env"]
        out = _run_node_config(prev_env)
        assert out["pluginCount"] == 6, out
        assert out["metaConfigured"] is True
        fb = out["fb"]
        assert fb["appID"] == EXPECTED_APP_ID
        assert len(fb["clientToken"]) == TOKEN_LEN
        assert fb["isAutoInitEnabled"] is True
        assert fb["autoLogAppEventsEnabled"] is True
        assert fb["advertiserIDCollectionEnabled"] is False
        assert fb["scheme"] == f"fb{EXPECTED_APP_ID}"
        assert fb["displayName"] == "meemz"

    def test_meta_auto_activation_and_trial_attribution_requirements(self):
        """Meta requires autoLogAppEvents=true AND autoInit=true for auto activation."""
        prod_env = _load_eas()["build"]["production"]["env"]
        out = _run_node_config(prod_env)
        fb = out["fb"]
        assert fb["isAutoInitEnabled"] is True, "auto init required by Meta"
        assert fb["autoLogAppEventsEnabled"] is True, "auto log app events required"


# ---------- regression: frontend + backend still up ----------
class TestRegression:
    def test_metro_serves_200(self):
        try:
            r = requests.get("http://localhost:3000", timeout=15)
        except Exception as e:
            pytest.fail(f"metro not reachable: {e}")
        assert r.status_code == 200, f"metro status {r.status_code}"
        # sanity: no missing-module error surfaced in HTML
        assert "Cannot find module" not in r.text
        assert "ModuleNotFoundError" not in r.text

    def test_backend_memes_endpoint(self):
        if not BACKEND_URL:
            pytest.skip("EXPO_BACKEND_URL not set")
        r = requests.get(f"{BACKEND_URL}/api/memes", timeout=15)
        assert r.status_code in (200, 401), f"unexpected {r.status_code}: {r.text[:200]}"

    def test_backend_auth_register(self):
        if not BACKEND_URL:
            pytest.skip("EXPO_BACKEND_URL not set")
        import uuid
        payload = {
            "email": f"TEST_meta_{uuid.uuid4().hex[:8]}@example.com",
            "password": "TestPass123!",
            "username": f"TEST_{uuid.uuid4().hex[:8]}",
        }
        r = requests.post(
            f"{BACKEND_URL}/api/auth/register", json=payload, timeout=15
        )
        # accept any 2xx or 4xx as "endpoint reachable & responsive"
        assert r.status_code < 500, f"server error {r.status_code}: {r.text[:200]}"
