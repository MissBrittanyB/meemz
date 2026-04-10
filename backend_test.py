#!/usr/bin/env python3
"""
MemeVault API Backend Testing Suite
Tests all endpoints as specified in the review request
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Backend URL from frontend environment
BASE_URL = "https://meme-type.preview.emergentagent.com/api"

class MemeVaultTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.test_meme_id = None
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}")
        if details:
            print(f"   Details: {details}")
        if response_data and not success:
            print(f"   Response: {response_data}")
        print()
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "response": response_data
        })
    
    def test_api_health(self):
        """Test 1: GET /api/ - Check API health"""
        try:
            response = self.session.get(f"{self.base_url}/")
            
            if response.status_code == 200:
                data = response.json()
                expected_message = "MemeVault API is running!"
                if data.get("message") == expected_message:
                    self.log_test("API Health Check", True, f"Status: {response.status_code}, Message: {data.get('message')}")
                    return True
                else:
                    self.log_test("API Health Check", False, f"Unexpected message: {data.get('message')}", data)
                    return False
            else:
                self.log_test("API Health Check", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("API Health Check", False, f"Exception: {str(e)}")
            return False
    
    def test_get_categories(self):
        """Test 2: GET /api/categories - Get all categories"""
        try:
            response = self.session.get(f"{self.base_url}/categories")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    # Check if categories have required fields
                    if len(data) > 0:
                        category = data[0]
                        required_fields = ["id", "name", "icon", "meme_count"]
                        has_all_fields = all(field in category for field in required_fields)
                        
                        if has_all_fields:
                            self.log_test("Get Categories", True, f"Found {len(data)} categories with required fields")
                            return True
                        else:
                            missing_fields = [field for field in required_fields if field not in category]
                            self.log_test("Get Categories", False, f"Missing fields: {missing_fields}", category)
                            return False
                    else:
                        self.log_test("Get Categories", True, "No categories found (empty array)")
                        return True
                else:
                    self.log_test("Get Categories", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Get Categories", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Get Categories", False, f"Exception: {str(e)}")
            return False
    
    def test_create_meme(self):
        """Test 3: POST /api/memes - Create a new meme"""
        try:
            # Test meme data with a small base64 image
            test_meme = {
                "name": "Test Reaction Meme",
                "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                "category": "Reactions",
                "tags": ["test", "funny", "reaction"]
            }
            
            response = self.session.post(
                f"{self.base_url}/memes",
                json=test_meme,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "id" in data:
                    self.test_meme_id = data["id"]  # Store for later tests
                    required_fields = ["id", "name", "image_base64", "category", "tags", "use_count", "created_at"]
                    has_all_fields = all(field in data for field in required_fields)
                    
                    if has_all_fields:
                        self.log_test("Create Meme", True, f"Created meme with ID: {data['id']}")
                        return True
                    else:
                        missing_fields = [field for field in required_fields if field not in data]
                        self.log_test("Create Meme", False, f"Missing fields: {missing_fields}", data)
                        return False
                else:
                    self.log_test("Create Meme", False, "No ID in response", data)
                    return False
            else:
                self.log_test("Create Meme", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Create Meme", False, f"Exception: {str(e)}")
            return False
    
    def test_get_all_memes(self):
        """Test 4: GET /api/memes - Get all memes"""
        try:
            response = self.session.get(f"{self.base_url}/memes")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_test("Get All Memes", True, f"Found {len(data)} memes")
                    return True
                else:
                    self.log_test("Get All Memes", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Get All Memes", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Get All Memes", False, f"Exception: {str(e)}")
            return False
    
    def test_filter_memes_by_category(self):
        """Test 5: GET /api/memes?category=Reactions - Filter memes by category"""
        try:
            response = self.session.get(f"{self.base_url}/memes?category=Reactions")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    # Check if all memes are in Reactions category
                    reactions_memes = [meme for meme in data if meme.get("category") == "Reactions"]
                    if len(reactions_memes) == len(data):
                        self.log_test("Filter Memes by Category", True, f"Found {len(data)} memes in Reactions category")
                        return True
                    else:
                        self.log_test("Filter Memes by Category", False, f"Some memes not in Reactions category", data)
                        return False
                else:
                    self.log_test("Filter Memes by Category", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Filter Memes by Category", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Filter Memes by Category", False, f"Exception: {str(e)}")
            return False
    
    def test_search_memes(self):
        """Test 6: GET /api/memes?search=test - Search memes"""
        try:
            response = self.session.get(f"{self.base_url}/memes?search=test")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_test("Search Memes", True, f"Search returned {len(data)} memes")
                    return True
                else:
                    self.log_test("Search Memes", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Search Memes", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Search Memes", False, f"Exception: {str(e)}")
            return False
    
    def test_add_to_favorites(self):
        """Test 7: POST /api/user/test_device_123/favorites - Add meme to favorites"""
        if not self.test_meme_id:
            self.log_test("Add to Favorites", False, "No test meme ID available")
            return False
            
        try:
            payload = {"meme_id": self.test_meme_id}
            response = self.session.post(
                f"{self.base_url}/user/test_device_123/favorites",
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "action" in data and "favorites" in data:
                    self.log_test("Add to Favorites", True, f"Action: {data['action']}, Favorites count: {len(data['favorites'])}")
                    return True
                else:
                    self.log_test("Add to Favorites", False, "Missing action or favorites in response", data)
                    return False
            else:
                self.log_test("Add to Favorites", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Add to Favorites", False, f"Exception: {str(e)}")
            return False
    
    def test_get_favorites(self):
        """Test 8: GET /api/user/test_device_123/favorites - Get favorites"""
        try:
            response = self.session.get(f"{self.base_url}/user/test_device_123/favorites")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_test("Get Favorites", True, f"Found {len(data)} favorite memes")
                    return True
                else:
                    self.log_test("Get Favorites", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Get Favorites", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Get Favorites", False, f"Exception: {str(e)}")
            return False
    
    def test_add_to_recent(self):
        """Test 9: POST /api/user/test_device_123/recent - Track recently used"""
        if not self.test_meme_id:
            self.log_test("Add to Recent", False, "No test meme ID available")
            return False
            
        try:
            payload = {"meme_id": self.test_meme_id}
            response = self.session.post(
                f"{self.base_url}/user/test_device_123/recent",
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "message" in data:
                    self.log_test("Add to Recent", True, f"Message: {data['message']}")
                    return True
                else:
                    self.log_test("Add to Recent", False, "Missing message in response", data)
                    return False
            else:
                self.log_test("Add to Recent", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Add to Recent", False, f"Exception: {str(e)}")
            return False
    
    def test_get_recent(self):
        """Test 10: GET /api/user/test_device_123/recent - Get recent memes"""
        try:
            response = self.session.get(f"{self.base_url}/user/test_device_123/recent")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log_test("Get Recent Memes", True, f"Found {len(data)} recent memes")
                    return True
                else:
                    self.log_test("Get Recent Memes", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Get Recent Memes", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Get Recent Memes", False, f"Exception: {str(e)}")
            return False
    
    def test_delete_meme(self):
        """Test 11: DELETE /api/memes/{meme_id} - Delete test meme"""
        if not self.test_meme_id:
            self.log_test("Delete Meme", False, "No test meme ID available")
            return False
            
        try:
            response = self.session.delete(f"{self.base_url}/memes/{self.test_meme_id}")
            
            if response.status_code == 200:
                data = response.json()
                if "message" in data:
                    self.log_test("Delete Meme", True, f"Message: {data['message']}")
                    return True
                else:
                    self.log_test("Delete Meme", False, "Missing message in response", data)
                    return False
            else:
                self.log_test("Delete Meme", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Delete Meme", False, f"Exception: {str(e)}")
            return False
    
    def test_get_stats(self):
        """Test 12: GET /api/stats - Get app statistics"""
        try:
            response = self.session.get(f"{self.base_url}/stats")
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["memes", "categories", "users"]
                has_all_fields = all(field in data for field in required_fields)
                
                if has_all_fields:
                    self.log_test("Get Stats", True, f"Stats: {data}")
                    return True
                else:
                    missing_fields = [field for field in required_fields if field not in data]
                    self.log_test("Get Stats", False, f"Missing fields: {missing_fields}", data)
                    return False
            else:
                self.log_test("Get Stats", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Get Stats", False, f"Exception: {str(e)}")
            return False
    
    def test_explore_memes_default(self):
        """Test 13: GET /api/memes/explore - Get random public memes (default limit)"""
        try:
            response = self.session.get(f"{self.base_url}/memes/explore")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    # Check response format for each meme
                    if len(data) > 0:
                        meme = data[0]
                        required_fields = ["id", "name", "image_base64", "category", "tags", "use_count", "created_at", "is_public", "username"]
                        has_all_fields = all(field in meme for field in required_fields)
                        
                        if has_all_fields:
                            # Verify all memes are public
                            all_public = all(meme.get("is_public", False) for meme in data)
                            if all_public:
                                self.log_test("Explore Memes (Default)", True, f"Found {len(data)} random public memes with all required fields")
                                return True
                            else:
                                non_public_count = sum(1 for meme in data if not meme.get("is_public", False))
                                self.log_test("Explore Memes (Default)", False, f"{non_public_count} non-public memes returned", data)
                                return False
                        else:
                            missing_fields = [field for field in required_fields if field not in meme]
                            self.log_test("Explore Memes (Default)", False, f"Missing fields: {missing_fields}", meme)
                            return False
                    else:
                        self.log_test("Explore Memes (Default)", True, "No memes found (empty array)")
                        return True
                else:
                    self.log_test("Explore Memes (Default)", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Explore Memes (Default)", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Explore Memes (Default)", False, f"Exception: {str(e)}")
            return False
    
    def test_explore_memes_custom_limit(self):
        """Test 14: GET /api/memes/explore?limit=5 - Get random public memes with custom limit"""
        try:
            response = self.session.get(f"{self.base_url}/memes/explore?limit=5")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    # Check that we get at most 5 memes
                    if len(data) <= 5:
                        # Check response format for each meme
                        if len(data) > 0:
                            meme = data[0]
                            required_fields = ["id", "name", "image_base64", "category", "tags", "use_count", "created_at", "is_public", "username"]
                            has_all_fields = all(field in meme for field in required_fields)
                            
                            if has_all_fields:
                                # Verify all memes are public
                                all_public = all(meme.get("is_public", False) for meme in data)
                                if all_public:
                                    self.log_test("Explore Memes (Custom Limit)", True, f"Found {len(data)} random public memes (limit=5) with all required fields")
                                    return True
                                else:
                                    non_public_count = sum(1 for meme in data if not meme.get("is_public", False))
                                    self.log_test("Explore Memes (Custom Limit)", False, f"{non_public_count} non-public memes returned", data)
                                    return False
                            else:
                                missing_fields = [field for field in required_fields if field not in meme]
                                self.log_test("Explore Memes (Custom Limit)", False, f"Missing fields: {missing_fields}", meme)
                                return False
                        else:
                            self.log_test("Explore Memes (Custom Limit)", True, "No memes found (empty array)")
                            return True
                    else:
                        self.log_test("Explore Memes (Custom Limit)", False, f"Returned {len(data)} memes, expected max 5", data)
                        return False
                else:
                    self.log_test("Explore Memes (Custom Limit)", False, "Response is not an array", data)
                    return False
            else:
                self.log_test("Explore Memes (Custom Limit)", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Explore Memes (Custom Limit)", False, f"Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all tests in sequence"""
        print(f"🚀 Starting MemeVault API Tests")
        print(f"📍 Base URL: {self.base_url}")
        print("=" * 60)
        
        tests = [
            self.test_api_health,
            self.test_get_categories,
            self.test_create_meme,
            self.test_get_all_memes,
            self.test_filter_memes_by_category,
            self.test_search_memes,
            self.test_add_to_favorites,
            self.test_get_favorites,
            self.test_add_to_recent,
            self.test_get_recent,
            self.test_delete_meme,
            self.test_get_stats,
            self.test_explore_memes_default,
            self.test_explore_memes_custom_limit
        ]
        
        passed = 0
        failed = 0
        
        for test in tests:
            if test():
                passed += 1
            else:
                failed += 1
        
        print("=" * 60)
        print(f"📊 Test Results Summary:")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"📈 Success Rate: {(passed/(passed+failed)*100):.1f}%")
        
        if failed > 0:
            print("\n🔍 Failed Tests:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"   ❌ {result['test']}: {result['details']}")
        
        return failed == 0

if __name__ == "__main__":
    tester = MemeVaultTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)