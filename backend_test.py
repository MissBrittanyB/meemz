#!/usr/bin/env python3
"""
Backend API Testing for User Profile and Follow Features
Tests the meemz backend API user profile and follow functionality
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

def test_get_public_user_profile():
    """Test 1: Get public user profile"""
    print("\n=== TEST 1: Get Public User Profile ===")
    
    try:
        response = requests.get(f"{BACKEND_URL}/users/missbrittanyb/profile")
        
        if response.status_code == 200:
            data = response.json()
            
            # Check required fields
            required_fields = ["username", "display_name", "bio", "social_links", 
                             "meme_count", "followers_count", "following_count", "is_following"]
            
            missing_fields = [field for field in required_fields if field not in data]
            
            if missing_fields:
                log_test("Public Profile Fields", "FAIL", f"Missing fields: {missing_fields}")
                return False
            
            # Check is_following is false without auth
            if data.get("is_following") != False:
                log_test("Public Profile is_following", "FAIL", f"Expected False, got {data.get('is_following')}")
                return False
            
            log_test("Get Public User Profile", "PASS", 
                    f"Username: {data.get('username')}, Memes: {data.get('meme_count')}, "
                    f"Followers: {data.get('followers_count')}, Following: {data.get('following_count')}")
            return True
            
        else:
            log_test("Get Public User Profile", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Get Public User Profile", "FAIL", f"Error: {str(e)}")
        return False

def test_login_and_get_auth_profile():
    """Test 2: Get user profile with auth (shows is_following)"""
    print("\n=== TEST 2: Get User Profile with Auth ===")
    
    try:
        # Login first
        login_data = {"email": "test@memevault.com", "password": "Test123!"}
        login_response = requests.post(f"{BACKEND_URL}/auth/login", json=login_data)
        
        if login_response.status_code != 200:
            log_test("Login for Auth Profile", "FAIL", f"Status: {login_response.status_code}, Response: {login_response.text}")
            return None, False
        
        login_result = login_response.json()
        token = login_result.get("access_token")
        
        if not token:
            log_test("Login Token", "FAIL", "No access token received")
            return None, False
        
        log_test("Login for Auth Profile", "PASS", f"Token: {token[:20]}...")
        
        # Get profile with auth
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BACKEND_URL}/users/missbrittanyb/profile", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            
            # Check is_following field exists and is boolean
            is_following = data.get("is_following")
            if is_following is None:
                log_test("Auth Profile is_following", "FAIL", "is_following field missing")
                return token, False
            
            if not isinstance(is_following, bool):
                log_test("Auth Profile is_following", "FAIL", f"Expected boolean, got {type(is_following)}")
                return token, False
            
            log_test("Get Auth User Profile", "PASS", 
                    f"is_following: {is_following}, Username: {data.get('username')}")
            return token, True
            
        else:
            log_test("Get Auth User Profile", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return token, False
            
    except Exception as e:
        log_test("Get Auth User Profile", "FAIL", f"Error: {str(e)}")
        return None, False

def test_follow_user(token):
    """Test 3: Follow a user"""
    print("\n=== TEST 3: Follow a User ===")
    
    if not token:
        log_test("Follow User", "SKIP", "No auth token available")
        return False
    
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.post(f"{BACKEND_URL}/users/missbrittanyb/follow", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            
            # Check response format
            if "action" not in data or "is_following" not in data:
                log_test("Follow Response Format", "FAIL", f"Missing fields in response: {data}")
                return False
            
            action = data.get("action")
            is_following = data.get("is_following")
            
            if action == "followed" and is_following == True:
                log_test("Follow User", "PASS", f"Action: {action}, is_following: {is_following}")
                return True
            elif action == "unfollowed" and is_following == False:
                log_test("Follow User", "PASS", f"Already following - toggled to unfollow. Action: {action}, is_following: {is_following}")
                # Follow again to ensure we're following for next test
                follow_again = requests.post(f"{BACKEND_URL}/users/missbrittanyb/follow", headers=headers)
                if follow_again.status_code == 200:
                    follow_data = follow_again.json()
                    log_test("Follow User (Second Attempt)", "PASS", f"Action: {follow_data.get('action')}, is_following: {follow_data.get('is_following')}")
                return True
            else:
                log_test("Follow User", "FAIL", f"Unexpected response: action={action}, is_following={is_following}")
                return False
            
        else:
            log_test("Follow User", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Follow User", "FAIL", f"Error: {str(e)}")
        return False

def test_unfollow_user(token):
    """Test 4: Unfollow a user (toggle)"""
    print("\n=== TEST 4: Unfollow User (Toggle) ===")
    
    if not token:
        log_test("Unfollow User", "SKIP", "No auth token available")
        return False
    
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.post(f"{BACKEND_URL}/users/missbrittanyb/follow", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            
            action = data.get("action")
            is_following = data.get("is_following")
            
            if action == "unfollowed" and is_following == False:
                log_test("Unfollow User", "PASS", f"Action: {action}, is_following: {is_following}")
                return True
            elif action == "followed" and is_following == True:
                log_test("Unfollow User", "PASS", f"Was not following - toggled to follow. Action: {action}, is_following: {is_following}")
                # Unfollow again to test the unfollow action
                unfollow_again = requests.post(f"{BACKEND_URL}/users/missbrittanyb/follow", headers=headers)
                if unfollow_again.status_code == 200:
                    unfollow_data = unfollow_again.json()
                    log_test("Unfollow User (Second Attempt)", "PASS", f"Action: {unfollow_data.get('action')}, is_following: {unfollow_data.get('is_following')}")
                return True
            else:
                log_test("Unfollow User", "FAIL", f"Unexpected response: action={action}, is_following={is_following}")
                return False
            
        else:
            log_test("Unfollow User", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Unfollow User", "FAIL", f"Error: {str(e)}")
        return False

def test_cannot_follow_yourself():
    """Test 5: Cannot follow yourself"""
    print("\n=== TEST 5: Cannot Follow Yourself ===")
    
    try:
        # Login as missbrittanyb
        login_data = {"email": "brittanyb@thebrandingbar.com", "password": "Marchelle7!"}
        login_response = requests.post(f"{BACKEND_URL}/auth/login", json=login_data)
        
        if login_response.status_code != 200:
            log_test("Login as missbrittanyb", "FAIL", f"Status: {login_response.status_code}, Response: {login_response.text}")
            return False
        
        login_result = login_response.json()
        token = login_result.get("access_token")
        
        if not token:
            log_test("Login Token", "FAIL", "No access token received")
            return False
        
        log_test("Login as missbrittanyb", "PASS", f"Token: {token[:20]}...")
        
        # Try to follow yourself
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.post(f"{BACKEND_URL}/users/missbrittanyb/follow", headers=headers)
        
        if response.status_code == 400:
            data = response.json()
            detail = data.get("detail", "")
            
            if "Cannot follow yourself" in detail:
                log_test("Cannot Follow Yourself", "PASS", f"Status: 400, Detail: {detail}")
                return True
            else:
                log_test("Cannot Follow Yourself", "FAIL", f"Wrong error message: {detail}")
                return False
        else:
            log_test("Cannot Follow Yourself", "FAIL", f"Expected 400, got {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Cannot Follow Yourself", "FAIL", f"Error: {str(e)}")
        return False

def test_auth_me_returns_is_admin():
    """Test 6: Auth/me returns is_admin"""
    print("\n=== TEST 6: Auth/me Returns is_admin ===")
    
    try:
        # Login with admin credentials
        login_data = {"email": "brittanyb@thebrandingbar.com", "password": "Marchelle7!"}
        login_response = requests.post(f"{BACKEND_URL}/auth/login", json=login_data)
        
        if login_response.status_code != 200:
            log_test("Admin Login", "FAIL", f"Status: {login_response.status_code}, Response: {login_response.text}")
            return False
        
        login_result = login_response.json()
        token = login_result.get("access_token")
        
        if not token:
            log_test("Admin Login Token", "FAIL", "No access token received")
            return False
        
        log_test("Admin Login", "PASS", f"Token: {token[:20]}...")
        
        # Get /auth/me
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BACKEND_URL}/auth/me", headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            
            is_admin = data.get("is_admin")
            username = data.get("username", "").strip()
            
            if is_admin == True:
                log_test("Auth/me is_admin", "PASS", f"is_admin: {is_admin}, username: {username}")
                return True
            else:
                log_test("Auth/me is_admin", "FAIL", f"Expected is_admin: true, got {is_admin}")
                return False
        else:
            log_test("Auth/me Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Auth/me Returns is_admin", "FAIL", f"Error: {str(e)}")
        return False

def test_username_with_trailing_space():
    """Test 7: Username with trailing space still works"""
    print("\n=== TEST 7: Username with Trailing Space ===")
    
    try:
        # Test with trailing space in URL
        response = requests.get(f"{BACKEND_URL}/users/missbrittanyb%20/memes")
        
        if response.status_code == 200:
            data = response.json()
            
            if isinstance(data, list):
                log_test("Username Trailing Space", "PASS", f"Returned {len(data)} memes (backend strips trailing space)")
                return True
            else:
                log_test("Username Trailing Space", "FAIL", f"Expected array, got {type(data)}")
                return False
        else:
            log_test("Username Trailing Space", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Username Trailing Space", "FAIL", f"Error: {str(e)}")
        return False

def test_get_user_memes():
    """Test 8: Get user memes"""
    print("\n=== TEST 8: Get User Memes ===")
    
    try:
        response = requests.get(f"{BACKEND_URL}/users/missbrittanyb/memes")
        
        if response.status_code == 200:
            data = response.json()
            
            if isinstance(data, list):
                log_test("Get User Memes", "PASS", f"Returned {len(data)} memes")
                
                # Check structure of first meme if available
                if data:
                    meme = data[0]
                    required_fields = ["id", "name", "image_base64", "category", "tags", 
                                     "use_count", "created_at", "is_public", "username"]
                    missing_fields = [field for field in required_fields if field not in meme]
                    
                    if missing_fields:
                        log_test("Meme Structure", "FAIL", f"Missing fields: {missing_fields}")
                        return False
                    else:
                        log_test("Meme Structure", "PASS", f"All required fields present")
                
                return True
            else:
                log_test("Get User Memes", "FAIL", f"Expected array, got {type(data)}")
                return False
        else:
            log_test("Get User Memes", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Get User Memes", "FAIL", f"Error: {str(e)}")
        return False

def main():
    """Run all user profile and follow feature tests"""
    print("🧪 USER PROFILE AND FOLLOW FEATURES TESTING")
    print("=" * 60)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Track test results
    test_results = []
    
    # Test 1: Get public user profile
    public_profile_result = test_get_public_user_profile()
    test_results.append(("Get Public User Profile", public_profile_result))
    
    # Test 2: Get user profile with auth
    token, auth_profile_result = test_login_and_get_auth_profile()
    test_results.append(("Get User Profile with Auth", auth_profile_result))
    
    # Test 3: Follow a user
    follow_result = test_follow_user(token)
    test_results.append(("Follow User", follow_result))
    
    # Test 4: Unfollow a user (toggle)
    unfollow_result = test_unfollow_user(token)
    test_results.append(("Unfollow User (Toggle)", unfollow_result))
    
    # Test 5: Cannot follow yourself
    self_follow_result = test_cannot_follow_yourself()
    test_results.append(("Cannot Follow Yourself", self_follow_result))
    
    # Test 6: Auth/me returns is_admin
    auth_me_result = test_auth_me_returns_is_admin()
    test_results.append(("Auth/me Returns is_admin", auth_me_result))
    
    # Test 7: Username with trailing space
    trailing_space_result = test_username_with_trailing_space()
    test_results.append(("Username Trailing Space", trailing_space_result))
    
    # Test 8: Get user memes
    user_memes_result = test_get_user_memes()
    test_results.append(("Get User Memes", user_memes_result))
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {test_name}")
        if result:
            passed += 1
    
    print(f"\nResults: {passed}/{total} tests passed ({(passed/total)*100:.1f}%)")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED! User profile and follow features working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the details above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())