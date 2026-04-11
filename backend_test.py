#!/usr/bin/env python3
"""
Backend API Testing for Thumbnail System
Tests the meemz backend API thumbnail functionality and performance optimizations
"""

import requests
import json
import sys
import base64
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

def test_memes_list_has_thumbnails():
    """Test 1: GET /api/memes?limit=5 - Should return thumbnails but NOT full images"""
    print("\n=== TEST 1: Memes List Has Thumbnails (No Full Images) ===")
    
    try:
        response = requests.get(f"{BACKEND_URL}/memes?limit=5")
        
        if response.status_code == 200:
            data = response.json()
            
            if not isinstance(data, list):
                log_test("Memes List Response Type", "FAIL", f"Expected list, got {type(data)}")
                return False
            
            if len(data) == 0:
                log_test("Memes List Empty", "WARN", "No memes found in database")
                return True
            
            # Check first meme structure
            meme = data[0]
            
            # Should have thumbnail_base64
            if "thumbnail_base64" not in meme:
                log_test("Thumbnail Field Missing", "FAIL", "thumbnail_base64 field not found")
                return False
            
            # Should NOT have image_base64 (performance optimization)
            if "image_base64" in meme:
                log_test("Full Image in List", "FAIL", "image_base64 should be excluded from list endpoints for performance")
                return False
            
            # Check thumbnail format
            thumbnail = meme.get("thumbnail_base64")
            if thumbnail and not thumbnail.startswith("data:image/jpeg;base64,"):
                log_test("Thumbnail Format", "FAIL", f"Expected JPEG data URI, got: {thumbnail[:50]}...")
                return False
            
            # Check required fields
            required_fields = ["id", "name", "category", "tags", "use_count", "created_at", "is_public", "media_type"]
            missing_fields = [field for field in required_fields if field not in meme]
            
            if missing_fields:
                log_test("Required Fields", "FAIL", f"Missing fields: {missing_fields}")
                return False
            
            log_test("Memes List Thumbnails", "PASS", 
                    f"Found {len(data)} memes with thumbnails, no full images (performance optimized)")
            return True
            
        else:
            log_test("Memes List Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Memes List Thumbnails", "FAIL", f"Error: {str(e)}")
        return False

def test_explore_has_thumbnails():
    """Test 2: GET /api/memes/explore?limit=5 - Should return thumbnails but NOT full images"""
    print("\n=== TEST 2: Explore Memes Has Thumbnails (No Full Images) ===")
    
    try:
        response = requests.get(f"{BACKEND_URL}/memes/explore?limit=5")
        
        if response.status_code == 200:
            data = response.json()
            
            if not isinstance(data, list):
                log_test("Explore Response Type", "FAIL", f"Expected list, got {type(data)}")
                return False
            
            if len(data) == 0:
                log_test("Explore Empty", "WARN", "No public memes found for exploration")
                return True
            
            # Check first meme structure
            meme = data[0]
            
            # Should have thumbnail_base64
            if "thumbnail_base64" not in meme:
                log_test("Explore Thumbnail Missing", "FAIL", "thumbnail_base64 field not found")
                return False
            
            # Should NOT have image_base64 (performance optimization)
            if "image_base64" in meme:
                log_test("Explore Full Image", "FAIL", "image_base64 should be excluded from explore endpoint for performance")
                return False
            
            # All explore memes should be public
            if not meme.get("is_public", False):
                log_test("Explore Public Check", "FAIL", f"Non-public meme in explore: {meme.get('id')}")
                return False
            
            log_test("Explore Memes Thumbnails", "PASS", 
                    f"Found {len(data)} public memes with thumbnails, no full images")
            return True
            
        else:
            log_test("Explore Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Explore Memes Thumbnails", "FAIL", f"Error: {str(e)}")
        return False

def test_single_meme_has_both():
    """Test 3: GET /api/memes/{meme_id} - Should return BOTH full image and thumbnail"""
    print("\n=== TEST 3: Single Meme Has Both Full Image and Thumbnail ===")
    
    try:
        # First get a meme ID from the list
        list_response = requests.get(f"{BACKEND_URL}/memes?limit=1")
        if list_response.status_code != 200:
            log_test("Get Meme ID", "FAIL", "Could not get meme list to find ID")
            return False
        
        memes = list_response.json()
        if not memes:
            log_test("No Memes Available", "WARN", "No memes in database to test single meme endpoint")
            return True
        
        meme_id = memes[0]["id"]
        
        # Get single meme
        response = requests.get(f"{BACKEND_URL}/memes/{meme_id}")
        
        if response.status_code == 200:
            meme = response.json()
            
            # Should have BOTH image_base64 and thumbnail_base64
            if "image_base64" not in meme:
                log_test("Single Meme Full Image", "FAIL", "image_base64 field missing from single meme endpoint")
                return False
            
            if "thumbnail_base64" not in meme:
                log_test("Single Meme Thumbnail", "FAIL", "thumbnail_base64 field missing from single meme endpoint")
                return False
            
            # Check data formats
            full_image = meme.get("image_base64", "")
            thumbnail = meme.get("thumbnail_base64", "")
            
            if not full_image.startswith("data:image/"):
                log_test("Full Image Format", "FAIL", f"Invalid full image format: {full_image[:50]}...")
                return False
            
            if thumbnail and not thumbnail.startswith("data:image/jpeg;base64,"):
                log_test("Single Meme Thumbnail Format", "FAIL", f"Invalid thumbnail format: {thumbnail[:50]}...")
                return False
            
            # Thumbnail should be smaller than full image
            if thumbnail:
                try:
                    full_size = len(full_image)
                    thumb_size = len(thumbnail)
                    if thumb_size >= full_size:
                        log_test("Thumbnail Size", "WARN", f"Thumbnail ({thumb_size}) not smaller than full image ({full_size})")
                    else:
                        reduction = ((full_size - thumb_size) / full_size) * 100
                        log_test("Thumbnail Size Optimization", "PASS", f"Thumbnail is {reduction:.1f}% smaller than full image")
                except:
                    pass
            
            log_test("Single Meme Both Images", "PASS", 
                    f"Meme {meme_id} has both full image and thumbnail")
            return True
            
        else:
            log_test("Single Meme Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Single Meme Both Images", "FAIL", f"Error: {str(e)}")
        return False

def test_create_meme_generates_thumbnail():
    """Test 4: POST /api/memes - Create meme and verify thumbnail auto-generation"""
    print("\n=== TEST 4: Create Meme Auto-Generates Thumbnail ===")
    
    try:
        # Login first
        login_data = {"email": "test@memevault.com", "password": "Test123!"}
        login_response = requests.post(f"{BACKEND_URL}/auth/login", json=login_data)
        
        if login_response.status_code != 200:
            log_test("Login for Meme Creation", "FAIL", f"Status: {login_response.status_code}, Response: {login_response.text}")
            return False
        
        login_result = login_response.json()
        token = login_result.get("access_token")
        
        if not token:
            log_test("Login Token", "FAIL", "No access token received")
            return False
        
        log_test("Login for Meme Creation", "PASS", f"Token: {token[:20]}...")
        
        # Create a simple test image (1x1 red pixel PNG)
        test_image_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
        test_image_data_uri = f"data:image/png;base64,{test_image_b64}"
        
        # Create meme
        meme_data = {
            "name": f"Test Thumbnail Meme {datetime.now().strftime('%H%M%S')}",
            "image_base64": test_image_data_uri,
            "category": "Reactions",
            "tags": ["test", "thumbnail"],
            "is_public": True,
            "media_type": "image"
        }
        
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.post(f"{BACKEND_URL}/memes", json=meme_data, headers=headers)
        
        if response.status_code == 200:
            created_meme = response.json()
            
            # Should have both image_base64 and thumbnail_base64
            if "image_base64" not in created_meme:
                log_test("Created Meme Full Image", "FAIL", "image_base64 missing from created meme")
                return False
            
            if "thumbnail_base64" not in created_meme:
                log_test("Created Meme Thumbnail", "FAIL", "thumbnail_base64 missing from created meme - auto-generation failed")
                return False
            
            # Check thumbnail format
            thumbnail = created_meme.get("thumbnail_base64")
            if not thumbnail.startswith("data:image/jpeg;base64,"):
                log_test("Created Thumbnail Format", "FAIL", f"Invalid thumbnail format: {thumbnail[:50]}...")
                return False
            
            # Verify the meme was actually saved with thumbnail
            meme_id = created_meme["id"]
            verify_response = requests.get(f"{BACKEND_URL}/memes/{meme_id}")
            
            if verify_response.status_code == 200:
                saved_meme = verify_response.json()
                if "thumbnail_base64" not in saved_meme or not saved_meme["thumbnail_base64"]:
                    log_test("Thumbnail Persistence", "FAIL", "Thumbnail not saved to database")
                    return False
            
            log_test("Create Meme Thumbnail Generation", "PASS", 
                    f"Meme {meme_id} created with auto-generated thumbnail")
            return True
            
        else:
            log_test("Create Meme Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Create Meme Thumbnail Generation", "FAIL", f"Error: {str(e)}")
        return False

def test_categories_endpoint():
    """Test 5: GET /api/categories - Verify existing endpoint still works"""
    print("\n=== TEST 5: Categories Endpoint Still Works ===")
    
    try:
        response = requests.get(f"{BACKEND_URL}/categories")
        
        if response.status_code == 200:
            data = response.json()
            
            if not isinstance(data, list):
                log_test("Categories Response Type", "FAIL", f"Expected list, got {type(data)}")
                return False
            
            if len(data) == 0:
                log_test("Categories Empty", "WARN", "No categories found")
                return True
            
            # Check category structure
            category = data[0]
            required_fields = ["id", "name", "icon", "meme_count"]
            missing_fields = [field for field in required_fields if field not in category]
            
            if missing_fields:
                log_test("Category Fields", "FAIL", f"Missing fields: {missing_fields}")
                return False
            
            log_test("Categories Endpoint", "PASS", f"Found {len(data)} categories")
            return True
            
        else:
            log_test("Categories Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Categories Endpoint", "FAIL", f"Error: {str(e)}")
        return False

def test_stats_endpoint():
    """Test 6: GET /api/stats - Verify existing endpoint still works"""
    print("\n=== TEST 6: Stats Endpoint Still Works ===")
    
    try:
        response = requests.get(f"{BACKEND_URL}/stats")
        
        if response.status_code == 200:
            data = response.json()
            
            required_fields = ["memes", "categories", "users"]
            missing_fields = [field for field in required_fields if field not in data]
            
            if missing_fields:
                log_test("Stats Fields", "FAIL", f"Missing fields: {missing_fields}")
                return False
            
            # Check that values are numbers
            for field in required_fields:
                if not isinstance(data[field], int):
                    log_test("Stats Value Type", "FAIL", f"{field} should be integer, got {type(data[field])}")
                    return False
            
            log_test("Stats Endpoint", "PASS", 
                    f"Memes: {data['memes']}, Categories: {data['categories']}, Users: {data['users']}")
            return True
            
        else:
            log_test("Stats Request", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
    except Exception as e:
        log_test("Stats Endpoint", "FAIL", f"Error: {str(e)}")
        return False

def test_performance_comparison():
    """Test 7: Performance comparison between list and single meme endpoints"""
    print("\n=== TEST 7: Performance Comparison (List vs Single) ===")
    
    try:
        # Test list endpoint response size
        list_response = requests.get(f"{BACKEND_URL}/memes?limit=5")
        if list_response.status_code != 200:
            log_test("Performance Test Setup", "FAIL", "Could not get memes list")
            return False
        
        list_data = list_response.json()
        if not list_data:
            log_test("Performance Test", "WARN", "No memes to test performance")
            return True
        
        list_size = len(list_response.content)
        
        # Test single meme endpoint response size
        meme_id = list_data[0]["id"]
        single_response = requests.get(f"{BACKEND_URL}/memes/{meme_id}")
        if single_response.status_code != 200:
            log_test("Performance Single Meme", "FAIL", "Could not get single meme")
            return False
        
        single_size = len(single_response.content)
        
        # Calculate per-meme size difference
        list_per_meme = list_size / len(list_data)
        size_reduction = ((single_size - list_per_meme) / single_size) * 100
        
        if size_reduction > 50:  # Expect significant reduction
            log_test("Performance Optimization", "PASS", 
                    f"List endpoint is {size_reduction:.1f}% smaller per meme (thumbnails vs full images)")
        else:
            log_test("Performance Optimization", "WARN", 
                    f"List endpoint only {size_reduction:.1f}% smaller per meme")
        
        log_test("Response Size Comparison", "PASS", 
                f"List: {list_size} bytes ({len(list_data)} memes), Single: {single_size} bytes")
        return True
        
    except Exception as e:
        log_test("Performance Comparison", "FAIL", f"Error: {str(e)}")
        return False

def main():
    """Run all thumbnail system tests"""
    print("🧪 THUMBNAIL SYSTEM TESTING")
    print("=" * 60)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Track test results
    test_results = []
    
    # Test 1: Memes list has thumbnails (no full images)
    result1 = test_memes_list_has_thumbnails()
    test_results.append(("Memes List Thumbnails", result1))
    
    # Test 2: Explore has thumbnails (no full images)
    result2 = test_explore_has_thumbnails()
    test_results.append(("Explore Memes Thumbnails", result2))
    
    # Test 3: Single meme has both full image and thumbnail
    result3 = test_single_meme_has_both()
    test_results.append(("Single Meme Both Images", result3))
    
    # Test 4: Create meme generates thumbnail
    result4 = test_create_meme_generates_thumbnail()
    test_results.append(("Create Meme Thumbnail Generation", result4))
    
    # Test 5: Categories endpoint still works
    result5 = test_categories_endpoint()
    test_results.append(("Categories Endpoint", result5))
    
    # Test 6: Stats endpoint still works
    result6 = test_stats_endpoint()
    test_results.append(("Stats Endpoint", result6))
    
    # Test 7: Performance comparison
    result7 = test_performance_comparison()
    test_results.append(("Performance Comparison", result7))
    
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
        print("🎉 ALL TESTS PASSED! Thumbnail system working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the details above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())