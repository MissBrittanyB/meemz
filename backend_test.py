"""
Backend tests for the hardened Apple IAP receipt-verification endpoint
POST /api/subscriptions/apple/verify

Run: python /app/backend_test.py
"""

import os
import sys
import asyncio
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = "http://localhost:8001/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# Primary test credentials per review request
PRIMARY_EMAIL = "meemzreview@gmail.com"
PRIMARY_PASSWORD = "Meemz2026!"
PRIMARY_USERNAME = "meemzreview"

# Fallback if primary doesn't exist
FALLBACK_EMAIL = "test@memevault.com"
FALLBACK_PASSWORD = "Test123!"

results = []  # list of (name, ok, detail)


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} :: {detail}")
    results.append((name, ok, detail))


def login(email, password):
    return requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": email, "password": password},
        timeout=15,
    )


def register(email, password, username):
    return requests.post(
        f"{BASE_URL}/auth/register",
        json={"email": email, "password": password, "username": username},
        timeout=15,
    )


def get_token():
    r = login(PRIMARY_EMAIL, PRIMARY_PASSWORD)
    if r.status_code == 200 and r.json().get("access_token"):
        print(f"  -> logged in as primary user {PRIMARY_EMAIL}")
        return r.json()["access_token"], r.json().get("user", {}).get("id")
    print(f"  -> primary login failed ({r.status_code} {r.text[:120]}); attempting register")
    rr = register(PRIMARY_EMAIL, PRIMARY_PASSWORD, PRIMARY_USERNAME)
    if rr.status_code in (200, 201):
        body = rr.json()
        if body.get("access_token"):
            print(f"  -> registered primary user {PRIMARY_EMAIL}")
            return body["access_token"], body.get("user", {}).get("id")
        r2 = login(PRIMARY_EMAIL, PRIMARY_PASSWORD)
        if r2.status_code == 200:
            return r2.json()["access_token"], r2.json().get("user", {}).get("id")
    print(f"  -> register failed ({rr.status_code} {rr.text[:120]}); using fallback")
    rf = login(FALLBACK_EMAIL, FALLBACK_PASSWORD)
    if rf.status_code == 200:
        print(f"  -> logged in as fallback user {FALLBACK_EMAIL}")
        return rf.json()["access_token"], rf.json().get("user", {}).get("id")
    raise RuntimeError(f"Could not authenticate any user. login={rf.status_code} {rf.text}")


def test_1_unauthenticated():
    body = {
        "product_id": "meemz_weekly",
        "transaction_id": "txn_unauth_1",
        "receipt_data": "abc",
    }
    r = requests.post(f"{BASE_URL}/subscriptions/apple/verify", json=body, timeout=15)
    ok = r.status_code in (401, 403)
    record(
        "1. Unauthenticated request rejected",
        ok,
        f"status={r.status_code} body={r.text[:200]}",
    )


def test_2_missing_receipt(token):
    headers = {"Authorization": f"Bearer {token}"}
    body = {"product_id": "meemz_weekly", "transaction_id": "txn_missing_receipt_1"}
    r = requests.post(f"{BASE_URL}/subscriptions/apple/verify", json=body, headers=headers, timeout=15)
    detail_text = ""
    try:
        detail_text = r.json().get("detail", "")
    except Exception:
        detail_text = r.text
    ok = r.status_code == 400 and "Receipt data is required" in detail_text
    record(
        "2. Missing receipt_data -> 400 'Receipt data is required'",
        ok,
        f"status={r.status_code} detail={detail_text!r}",
    )


def test_3_unknown_product(token):
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "product_id": "bogus_product",
        "transaction_id": "txn_unknown_product_1",
        "receipt_data": "abc",
    }
    r = requests.post(f"{BASE_URL}/subscriptions/apple/verify", json=body, headers=headers, timeout=15)
    detail_text = ""
    try:
        detail_text = r.json().get("detail", "")
    except Exception:
        detail_text = r.text
    ok = r.status_code == 400 and "Unknown product" in detail_text
    record(
        "3. Unknown product_id -> 400 'Unknown product: ...'",
        ok,
        f"status={r.status_code} detail={detail_text!r}",
    )


def test_4_invalid_receipt(token):
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "product_id": "meemz_weekly",
        "transaction_id": "txn_invalid_receipt_1",
        "receipt_data": "this-is-not-a-valid-receipt-just-garbage",
    }
    r = requests.post(
        f"{BASE_URL}/subscriptions/apple/verify", json=body, headers=headers, timeout=60
    )
    detail_text = ""
    try:
        detail_text = r.json().get("detail", "")
    except Exception:
        detail_text = r.text
    ok = r.status_code in (400, 502)
    record(
        "4. Invalid base64 receipt -> 400 or 502",
        ok,
        f"status={r.status_code} detail={detail_text!r}",
    )


async def insert_dup_doc(user_id):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    txn_id = "dup_txn_99"
    await db.apple_transactions.delete_many({"transaction_id": txn_id})
    await db.apple_transactions.insert_one({
        "transaction_id": txn_id,
        "product_id": "meemz_weekly",
        "user_id": user_id or "test-user",
        "verified": True,
    })
    client.close()
    return txn_id


async def cleanup_dup_doc(txn_id):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await db.apple_transactions.delete_many({"transaction_id": txn_id})
    client.close()


def test_5_duplicate_short_circuit(token, user_id):
    loop = asyncio.new_event_loop()
    try:
        txn_id = loop.run_until_complete(insert_dup_doc(user_id))
        headers = {"Authorization": f"Bearer {token}"}
        body = {
            "product_id": "meemz_weekly",
            "transaction_id": txn_id,
            "receipt_data": "garbage-receipt-should-not-reach-apple-because-short-circuit",
        }
        r = requests.post(
            f"{BASE_URL}/subscriptions/apple/verify", json=body, headers=headers, timeout=15
        )
        body_json = {}
        try:
            body_json = r.json()
        except Exception:
            pass
        ok = (
            r.status_code == 200
            and body_json.get("status") == "already_processed"
            and body_json.get("plan_id") == "weekly"
        )
        record(
            "5. Duplicate transaction short-circuits -> 200 already_processed",
            ok,
            f"status={r.status_code} body={body_json!r}",
        )
        loop.run_until_complete(cleanup_dup_doc(txn_id))
    finally:
        loop.close()


def test_6_plans():
    r = requests.get(f"{BASE_URL}/subscriptions/plans", timeout=15)
    ok = False
    detail = f"status={r.status_code}"
    if r.status_code == 200:
        try:
            data = r.json()
            plans = data if isinstance(data, list) else data.get("plans", [])
            ok = isinstance(plans, list) and len(plans) == 3
            detail = f"status=200 count={len(plans)} ids={[p.get('id') for p in plans]}"
        except Exception as e:
            detail = f"status=200 parse_err={e}"
    record("6a. GET /api/subscriptions/plans returns 3 plans", ok, detail)


def test_6_health():
    r = requests.get(f"{BASE_URL}/health", timeout=10)
    if r.status_code == 200:
        record("6b. GET /api/health -> 200", True, f"body={r.text[:120]}")
        return
    r2 = requests.get(f"{BASE_URL}/", timeout=10)
    ok = r2.status_code == 200
    record(
        "6b. GET /api/ (root health fallback) -> 200",
        ok,
        f"/api/health={r.status_code}; /api/={r2.status_code} body={r2.text[:120]}",
    )


def test_6_status(token):
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{BASE_URL}/subscriptions/status", headers=headers, timeout=15)
    ok = r.status_code == 200
    record(
        "6c. GET /api/subscriptions/status (auth) -> 200",
        ok,
        f"status={r.status_code} body={r.text[:200]}",
    )


def main():
    print("=" * 70)
    print("APPLE IAP RECEIPT VERIFY -- BACKEND TESTS")
    print(f"BASE_URL = {BASE_URL}")
    print("=" * 70)

    print("\n[Login]")
    token, user_id = get_token()
    print(f"  token_len={len(token)} user_id={user_id}")

    print("\n--- Apple verify endpoint scenarios ---")
    test_1_unauthenticated()
    test_2_missing_receipt(token)
    test_3_unknown_product(token)
    test_4_invalid_receipt(token)
    test_5_duplicate_short_circuit(token, user_id)

    print("\n--- Regression checks ---")
    test_6_plans()
    test_6_health()
    test_6_status(token)

    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print("\n" + "=" * 70)
    print(f"SUMMARY: {passed} passed, {failed} failed, {len(results)} total")
    print("=" * 70)
    for name, ok, detail in results:
        sym = "PASS" if ok else "FAIL"
        print(f"  [{sym}] {name}")
        if not ok:
            print(f"        {detail}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
