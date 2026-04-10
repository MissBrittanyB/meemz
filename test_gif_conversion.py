#!/usr/bin/env python3
"""
GIF to MP4 Conversion Testing Suite
Tests the specific GIF conversion functionality requested in the review
"""

import requests
import json
import sys

# Backend URL from frontend environment
BASE_URL = "https://meme-type.preview.emergentagent.com/api"

class GIFConversionTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.auth_token = None
        
    def log_test(self, test_name: str, success: bool, details: str = ""):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}")
        if details:
            print(f"   Details: {details}")
        print()
    
    def test_auth_login(self):
        """Login to get auth token"""
        try:
            login_data = {
                "email": "test@memevault.com",
                "password": "Test123!"
            }
            
            response = self.session.post(
                f"{self.base_url}/auth/login",
                json=login_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "access_token" in data:
                    self.auth_token = data["access_token"]
                    self.log_test("Auth Login", True, f"Successfully logged in as {data['user'].get('email')}")
                    return True
            
            self.log_test("Auth Login", False, f"Status: {response.status_code}")
            return False
                
        except Exception as e:
            self.log_test("Auth Login", False, f"Exception: {str(e)}")
            return False
    
    def test_gif_to_mp4_conversion_existing_meme(self):
        """Test 1: GET /api/memes/{meme_id}/video - Convert existing GIF meme to MP4"""
        gif_meme_id = "fc53a17a-5a83-4c69-8b24-a2cfe4d99874"
        
        try:
            response = self.session.get(f"{self.base_url}/memes/{gif_meme_id}/video", timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["video_base64", "size", "meme_id"]
                has_all_fields = all(field in data for field in required_fields)
                
                if has_all_fields:
                    video_data = data.get("video_base64", "")
                    if video_data.startswith("data:video/mp4;base64,"):
                        size = data.get("size", 0)
                        if size > 100:
                            if data.get("meme_id") == gif_meme_id:
                                self.log_test("GIF to MP4 Conversion (Existing)", True, f"Successfully converted GIF to MP4. Size: {size} bytes, Video data URI format correct")
                                return True
                            else:
                                self.log_test("GIF to MP4 Conversion (Existing)", False, f"Meme ID mismatch")
                                return False
                        else:
                            self.log_test("GIF to MP4 Conversion (Existing)", False, f"Video size too small: {size} bytes")
                            return False
                    else:
                        self.log_test("GIF to MP4 Conversion (Existing)", False, f"Invalid video data URI format")
                        return False
                else:
                    missing_fields = [field for field in required_fields if field not in data]
                    self.log_test("GIF to MP4 Conversion (Existing)", False, f"Missing fields: {missing_fields}")
                    return False
            else:
                self.log_test("GIF to MP4 Conversion (Existing)", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("GIF to MP4 Conversion (Existing)", False, f"Exception: {str(e)}")
            return False
    
    def test_gif_to_mp4_nonexistent_meme(self):
        """Test 2: GET /api/memes/{nonexistent_id}/video - 404 for non-existent meme"""
        nonexistent_id = "nonexistent-id-12345"
        
        try:
            response = self.session.get(f"{self.base_url}/memes/{nonexistent_id}/video")
            
            if response.status_code == 404:
                try:
                    data = response.json()
                    if data.get("detail") == "Meme not found":
                        self.log_test("GIF to MP4 404 Test", True, f"Correctly returned 404 with proper error message")
                        return True
                    else:
                        self.log_test("GIF to MP4 404 Test", False, f"404 returned but wrong error message: {data.get('detail')}")
                        return False
                except:
                    self.log_test("GIF to MP4 404 Test", False, f"404 returned but response is not JSON")
                    return False
            else:
                self.log_test("GIF to MP4 404 Test", False, f"Expected 404, got {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("GIF to MP4 404 Test", False, f"Exception: {str(e)}")
            return False
    
    def test_meme_listing_includes_media_type(self):
        """Test 3: GET /api/memes?limit=5 - Verify media_type field is included"""
        try:
            response = self.session.get(f"{self.base_url}/memes?limit=5")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) > 0:
                    meme = data[0]
                    if "media_type" in meme:
                        valid_media_types = ["image", "gif", "video"]
                        media_type = meme.get("media_type")
                        if media_type in valid_media_types:
                            self.log_test("Meme Listing Media Type", True, f"Found {len(data)} memes with media_type field. First meme media_type: {media_type}")
                            return True
                        else:
                            self.log_test("Meme Listing Media Type", False, f"Invalid media_type value: {media_type}")
                            return False
                    else:
                        self.log_test("Meme Listing Media Type", False, "media_type field missing from meme response")
                        return False
                else:
                    self.log_test("Meme Listing Media Type", True, "No memes found to test media_type field")
                    return True
            else:
                self.log_test("Meme Listing Media Type", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Meme Listing Media Type", False, f"Exception: {str(e)}")
            return False
    
    def test_create_gif_meme_auto_detection(self):
        """Test 4: POST /api/memes - Create GIF meme with auto-detection of media_type"""
        if not self.auth_token:
            self.log_test("Create GIF Meme Auto-Detection", False, "No auth token available")
            return False
            
        try:
            gif_meme = {
                "name": "Test GIF Upload",
                "image_base64": "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
                "category": "Trending",
                "tags": ["test"],
                "media_type": "image"  # This should be auto-corrected to "gif"
            }
            
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = self.session.post(
                f"{self.base_url}/memes",
                json=gif_meme,
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                if "id" in data and "media_type" in data:
                    if data.get("media_type") == "gif":
                        self.log_test("Create GIF Meme Auto-Detection", True, f"Successfully auto-detected GIF from data URI. Created meme ID: {data['id']} with media_type: gif")
                        
                        # Clean up - delete the test meme
                        try:
                            self.session.delete(f"{self.base_url}/memes/{data['id']}", headers=headers)
                        except:
                            pass
                        
                        return True
                    else:
                        self.log_test("Create GIF Meme Auto-Detection", False, f"Auto-detection failed. Expected media_type: gif, got: {data.get('media_type')}")
                        return False
                else:
                    self.log_test("Create GIF Meme Auto-Detection", False, "Missing id or media_type in response")
                    return False
            else:
                self.log_test("Create GIF Meme Auto-Detection", False, f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Create GIF Meme Auto-Detection", False, f"Exception: {str(e)}")
            return False
    
    def test_existing_endpoints_still_work(self):
        """Test 5: Verify existing endpoints still work after GIF conversion implementation"""
        try:
            endpoints_to_test = [
                ("/memes?limit=5", "GET memes"),
                ("/categories", "GET categories"),
                ("/memes/explore?limit=3", "GET explore memes")
            ]
            
            all_passed = True
            results = []
            
            for endpoint, name in endpoints_to_test:
                try:
                    response = self.session.get(f"{self.base_url}{endpoint}")
                    if response.status_code == 200:
                        data = response.json()
                        if isinstance(data, list):
                            results.append(f"{name}: ✅ ({len(data)} items)")
                        else:
                            results.append(f"{name}: ✅")
                    else:
                        results.append(f"{name}: ❌ (Status {response.status_code})")
                        all_passed = False
                except Exception as e:
                    results.append(f"{name}: ❌ (Exception: {str(e)})")
                    all_passed = False
            
            if all_passed:
                self.log_test("Existing Endpoints Verification", True, f"All endpoints working: {', '.join(results)}")
                return True
            else:
                self.log_test("Existing Endpoints Verification", False, f"Some endpoints failed: {', '.join(results)}")
                return False
                
        except Exception as e:
            self.log_test("Existing Endpoints Verification", False, f"Exception: {str(e)}")
            return False
    
    def run_gif_tests(self):
        """Run all GIF conversion tests"""
        print(f"🎬 Starting GIF to MP4 Conversion Tests")
        print(f"📍 Base URL: {self.base_url}")
        print("=" * 60)
        
        tests = [
            self.test_auth_login,
            self.test_gif_to_mp4_conversion_existing_meme,
            self.test_gif_to_mp4_nonexistent_meme,
            self.test_meme_listing_includes_media_type,
            self.test_create_gif_meme_auto_detection,
            self.test_existing_endpoints_still_work
        ]
        
        passed = 0
        failed = 0
        
        for test in tests:
            if test():
                passed += 1
            else:
                failed += 1
        
        print("=" * 60)
        print(f"📊 GIF Conversion Test Results:")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"📈 Success Rate: {(passed/(passed+failed)*100):.1f}%")
        
        return failed == 0

if __name__ == "__main__":
    tester = GIFConversionTester()
    success = tester.run_gif_tests()
    sys.exit(0 if success else 1)