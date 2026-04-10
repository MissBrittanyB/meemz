#!/usr/bin/env python3
"""
Backend API Testing for Admin Delete Permissions
Tests the meemz backend API admin delete functionality
"""

import requests
import json
import sys
from datetime import datetime

# Get backend URL from environment
BACKEND_URL = "https://meme-type.preview.emergentagent.com/api"

def log_test(test_name, status, details=""):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    status_icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"[{timestamp}] {status_icon} {test_name}")
    if details:
        print(f"    {details}")

def test_admin_login():
    """Test 1: Admin login returns is_admin flag"""
    print("\n=== TEST 1: Admin Login Returns is_admin Flag ===")
    
    # Try both credential sets to see which one works
    credentials_to_try = [
        {"email": "test@memevault.com", "password": "Marchelle7!"},
        {"email": "test@memevault.com", "password": "Test123!"}
    ]
    
    admin_token = None
    admin_user = None
    
    for creds in credentials_to_try:
        try:
            response = requests.post(f"{BACKEND_URL}/auth/login", json=creds)
            if response.status_code == 200:
                data = response.json()
                admin_token = data.get("access_token")
                admin_user = data.get("user", {})
                
                log_test("Admin Login", "PASS", f"Logged in with {creds['password']}")
                log_test("Admin Token Received", "PASS", f"Token: {admin_token[:20]}...")
                
                # Check if is_admin flag is present and true
                is_admin = admin_user.get("is_admin", False)
                if is_admin:
                    log_test("Admin Flag Check", "PASS", f"is_admin: {is_admin}")
                else:
                    log_test("Admin Flag Check", "FAIL", f"is_admin: {is_admin} (expected True)")
                
                return admin_token, admin_user
                
        except Exception as e:
            log_test("Admin Login", "FAIL", f"Error with {creds['password']}: {str(e)}")
    
    log_test("Admin Login", "FAIL", "Could not login with either password")
    return None, None

def test_auth_me_admin_flag(admin_token):
    """Test 2: Auth/me returns is_admin flag"""
    print("\n=== TEST 2: Auth/me Returns is_admin Flag ===")
    
    if not admin_token:
        log_test("Auth/me Admin Flag", "SKIP", "No admin token available")
        return False
    
    try:
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BACKEND_URL}/auth/me", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            is_admin = data.get("is_admin", False)
            
            log_test("Auth/me Request", "PASS", f"Status: {response.status_code}")
            
            if is_admin:
                log_test("Auth/me Admin Flag", "PASS", f"is_admin: {is_admin}")
                return True
            else:
                log_test("Auth/me Admin Flag", "FAIL", f"is_admin: {is_admin} (expected True)")
                return False
        else:
            log_test("Auth/me Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Auth/me Request", "FAIL", f"Error: {str(e)}")
        return False

def test_admin_can_delete_any_meme(admin_token):
    """Test 3: Admin can delete any meme"""
    print("\n=== TEST 3: Admin Can Delete Any Meme ===")
    
    if not admin_token:
        log_test("Admin Delete Test", "SKIP", "No admin token available")
        return False
    
    try:
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        # First get a meme to delete
        response = requests.get(f"{BACKEND_URL}/memes?limit=1")
        if response.status_code != 200:
            log_test("Get Meme for Delete", "FAIL", f"Status: {response.status_code}")
            return False
        
        memes = response.json()
        if not memes:
            log_test("Get Meme for Delete", "FAIL", "No memes available to delete")
            return False
        
        meme_to_delete = memes[0]
        meme_id = meme_to_delete["id"]
        meme_name = meme_to_delete["name"]
        
        log_test("Get Meme for Delete", "PASS", f"Found meme: {meme_name} (ID: {meme_id})")
        
        # Try to delete the meme as admin
        delete_response = requests.delete(f"{BACKEND_URL}/memes/{meme_id}", headers=headers)
        
        if delete_response.status_code == 200:
            data = delete_response.json()
            message = data.get("message", "")
            log_test("Admin Delete Meme", "PASS", f"Status: {delete_response.status_code}, Message: {message}")
            return True
        else:
            log_test("Admin Delete Meme", "FAIL", f"Status: {delete_response.status_code}, Response: {delete_response.text}")
            return False
            
    except Exception as e:
        log_test("Admin Delete Test", "FAIL", f"Error: {str(e)}")
        return False

def test_non_admin_cannot_delete_others_memes():
    """Test 4: Non-admin cannot delete others' memes"""
    print("\n=== TEST 4: Non-admin Cannot Delete Others' Memes ===")
    
    try:
        # Register a new non-admin user
        new_user_data = {
            "email": "testuser2@test.com",
            "password": "Test1234!",
            "username": "testuser2"
        }
        
        register_response = requests.post(f"{BACKEND_URL}/auth/register", json=new_user_data)
        
        if register_response.status_code == 200:
            reg_data = register_response.json()
            non_admin_token = reg_data.get("access_token")
            user_info = reg_data.get("user", {})
            is_admin = user_info.get("is_admin", False)
            
            log_test("Register Non-admin User", "PASS", f"User: {user_info.get('username')}, is_admin: {is_admin}")
            
            if is_admin:
                log_test("Non-admin User Check", "FAIL", f"New user has admin privileges: {is_admin}")
                return False
            
        elif register_response.status_code == 400 and "already registered" in register_response.text:
            # User already exists, try to login
            login_response = requests.post(f"{BACKEND_URL}/auth/login", json={
                "email": new_user_data["email"],
                "password": new_user_data["password"]
            })
            
            if login_response.status_code == 200:
                login_data = login_response.json()
                non_admin_token = login_data.get("access_token")
                user_info = login_data.get("user", {})
                is_admin = user_info.get("is_admin", False)
                
                log_test("Login Existing Non-admin User", "PASS", f"User: {user_info.get('username')}, is_admin: {is_admin}")
            else:
                log_test("Login Existing User", "FAIL", f"Status: {login_response.status_code}")
                return False
        else:
            log_test("Register Non-admin User", "FAIL", f"Status: {register_response.status_code}, Response: {register_response.text}")
            return False
        
        # Get a meme that belongs to someone else (or a seed meme)
        memes_response = requests.get(f"{BACKEND_URL}/memes?limit=5")
        if memes_response.status_code != 200:
            log_test("Get Memes for Non-admin Test", "FAIL", f"Status: {memes_response.status_code}")
            return False
        
        memes = memes_response.json()
        if not memes:
            log_test("Get Memes for Non-admin Test", "FAIL", "No memes available")
            return False
        
        # Find a meme that doesn't belong to the current user
        target_meme = None
        for meme in memes:
            if meme.get("user_id") != user_info.get("id"):
                target_meme = meme
                break
        
        if not target_meme:
            # Use the first meme (likely a seed meme)
            target_meme = memes[0]
        
        meme_id = target_meme["id"]
        meme_name = target_meme["name"]
        
        log_test("Get Target Meme", "PASS", f"Target meme: {meme_name} (ID: {meme_id})")
        
        # Try to delete the meme as non-admin
        headers = {"Authorization": f"Bearer {non_admin_token}"}
        delete_response = requests.delete(f"{BACKEND_URL}/memes/{meme_id}", headers=headers)
        
        if delete_response.status_code == 403:
            data = delete_response.json()
            detail = data.get("detail", "")
            log_test("Non-admin Delete Rejection", "PASS", f"Status: 403, Detail: {detail}")
            return True
        else:
            log_test("Non-admin Delete Rejection", "FAIL", f"Expected 403, got {delete_response.status_code}, Response: {delete_response.text}")
            return False
            
    except Exception as e:
        log_test("Non-admin Delete Test", "FAIL", f"Error: {str(e)}")
        return False

def test_unauthenticated_delete_rejected():
    """Test 5: Unauthenticated delete is rejected"""
    print("\n=== TEST 5: Unauthenticated Delete is Rejected ===")
    
    try:
        # Get a meme ID to try deleting
        response = requests.get(f"{BACKEND_URL}/memes?limit=1")
        if response.status_code != 200:
            log_test("Get Meme for Unauth Test", "FAIL", f"Status: {response.status_code}")
            return False
        
        memes = response.json()
        if not memes:
            log_test("Get Meme for Unauth Test", "FAIL", "No memes available")
            return False
        
        meme_id = memes[0]["id"]
        meme_name = memes[0]["name"]
        
        log_test("Get Meme for Unauth Test", "PASS", f"Target meme: {meme_name} (ID: {meme_id})")
        
        # Try to delete without authentication
        delete_response = requests.delete(f"{BACKEND_URL}/memes/{meme_id}")
        
        if delete_response.status_code == 401:
            data = delete_response.json()
            detail = data.get("detail", "")
            log_test("Unauthenticated Delete Rejection", "PASS", f"Status: 401, Detail: {detail}")
            return True
        else:
            log_test("Unauthenticated Delete Rejection", "FAIL", f"Expected 401, got {delete_response.status_code}, Response: {delete_response.text}")
            return False
            
    except Exception as e:
        log_test("Unauthenticated Delete Test", "FAIL", f"Error: {str(e)}")
        return False

def main():
    """Run all admin delete permission tests"""
    print("🧪 ADMIN DELETE PERMISSIONS TESTING")
    print("=" * 50)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Track test results
    test_results = []
    
    # Test 1: Admin login
    admin_token, admin_user = test_admin_login()
    test_results.append(("Admin Login", admin_token is not None))
    
    # Test 2: Auth/me admin flag
    auth_me_result = test_auth_me_admin_flag(admin_token)
    test_results.append(("Auth/me Admin Flag", auth_me_result))
    
    # Test 3: Admin can delete any meme
    admin_delete_result = test_admin_can_delete_any_meme(admin_token)
    test_results.append(("Admin Delete Any Meme", admin_delete_result))
    
    # Test 4: Non-admin cannot delete others' memes
    non_admin_result = test_non_admin_cannot_delete_others_memes()
    test_results.append(("Non-admin Delete Rejection", non_admin_result))
    
    # Test 5: Unauthenticated delete rejected
    unauth_result = test_unauthenticated_delete_rejected()
    test_results.append(("Unauthenticated Delete Rejection", unauth_result))
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 TEST SUMMARY")
    print("=" * 50)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {test_name}")
        if result:
            passed += 1
    
    print(f"\nResults: {passed}/{total} tests passed ({(passed/total)*100:.1f}%)")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED! Admin delete permissions working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the details above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())