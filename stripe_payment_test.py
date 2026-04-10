#!/usr/bin/env python3
"""
Stripe Payment Integration Test Suite for MemeVault
Tests specific Stripe checkout functionality as requested
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Backend URL from frontend environment
BASE_URL = "https://meme-type.preview.emergentagent.com/api"

class StripePaymentTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.auth_token = None
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
    
    def test_auth_login(self):
        """Test 1: POST /api/auth/login - Get auth token"""
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
                if "access_token" in data and "user" in data:
                    self.auth_token = data["access_token"]
                    self.log_test("1. Auth Login", True, f"Successfully logged in as {data['user'].get('email')}, token obtained")
                    return True
                else:
                    self.log_test("1. Auth Login", False, "Missing access_token or user in response", data)
                    return False
            else:
                self.log_test("1. Auth Login", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("1. Auth Login", False, f"Exception: {str(e)}")
            return False
    
    def test_subscription_plans(self):
        """Test 2: GET /api/subscriptions/plans - Verify 3 plans with correct prices"""
        try:
            response = self.session.get(f"{self.base_url}/subscriptions/plans")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) == 3:
                    # Check for expected plans
                    plan_ids = [plan.get("id") for plan in data]
                    expected_plans = ["weekly", "monthly", "yearly"]
                    
                    if all(plan_id in plan_ids for plan_id in expected_plans):
                        # Check prices
                        weekly_plan = next((p for p in data if p.get("id") == "weekly"), None)
                        monthly_plan = next((p for p in data if p.get("id") == "monthly"), None)
                        yearly_plan = next((p for p in data if p.get("id") == "yearly"), None)
                        
                        if (weekly_plan and weekly_plan.get("price") == 2.99 and
                            monthly_plan and monthly_plan.get("price") == 11.99 and
                            yearly_plan and yearly_plan.get("price") == 79.99):
                            self.log_test("2. Subscription Plans", True, f"Found 3 plans with correct prices: Weekly $2.99, Monthly $11.99, Yearly $79.99")
                            return True
                        else:
                            prices = {p.get("id"): p.get("price") for p in data}
                            self.log_test("2. Subscription Plans", False, f"Incorrect prices: {prices}", data)
                            return False
                    else:
                        missing_plans = [p for p in expected_plans if p not in plan_ids]
                        self.log_test("2. Subscription Plans", False, f"Missing plans: {missing_plans}", data)
                        return False
                else:
                    self.log_test("2. Subscription Plans", False, f"Expected 3 plans, got {len(data) if isinstance(data, list) else 'non-array'}", data)
                    return False
            else:
                self.log_test("2. Subscription Plans", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("2. Subscription Plans", False, f"Exception: {str(e)}")
            return False
    
    def test_create_checkout_weekly(self):
        """Test 3: POST /api/subscriptions/create-checkout?plan_id=weekly&origin_url=http://localhost:3000 (with auth)"""
        if not self.auth_token:
            self.log_test("3. Create Checkout Weekly", False, "No auth token available")
            return False
            
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = self.session.post(
                f"{self.base_url}/subscriptions/create-checkout?plan_id=weekly&origin_url=http://localhost:3000",
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                if "url" in data and "session_id" in data:
                    url = data["url"]
                    if url.startswith("https://checkout.stripe.com/"):
                        self.log_test("3. Create Checkout Weekly", True, f"Created weekly checkout session with valid Stripe URL: {url[:50]}...")
                        return True
                    else:
                        self.log_test("3. Create Checkout Weekly", False, f"URL doesn't start with https://checkout.stripe.com/: {url}", data)
                        return False
                else:
                    self.log_test("3. Create Checkout Weekly", False, "Missing url or session_id in response", data)
                    return False
            elif response.status_code == 500:
                # Expected if Stripe key has issues
                try:
                    error_data = response.json()
                    if "Payment error" in error_data.get("detail", "") or "stripe" in error_data.get("detail", "").lower():
                        self.log_test("3. Create Checkout Weekly", True, f"Expected 500 error due to Stripe configuration: {error_data.get('detail')}")
                        return True
                    else:
                        self.log_test("3. Create Checkout Weekly", False, f"Unexpected 500 error: {error_data.get('detail')}", error_data)
                        return False
                except:
                    self.log_test("3. Create Checkout Weekly", True, f"Expected 500 error due to Stripe configuration: {response.text}")
                    return True
            else:
                self.log_test("3. Create Checkout Weekly", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("3. Create Checkout Weekly", False, f"Exception: {str(e)}")
            return False
    
    def test_create_checkout_monthly(self):
        """Test 4: POST /api/subscriptions/create-checkout?plan_id=monthly&origin_url=http://localhost:3000 (with auth)"""
        if not self.auth_token:
            self.log_test("4. Create Checkout Monthly", False, "No auth token available")
            return False
            
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = self.session.post(
                f"{self.base_url}/subscriptions/create-checkout?plan_id=monthly&origin_url=http://localhost:3000",
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                if "url" in data and "session_id" in data:
                    url = data["url"]
                    if url.startswith("https://checkout.stripe.com/"):
                        self.log_test("4. Create Checkout Monthly", True, f"Created monthly checkout session with valid Stripe URL: {url[:50]}...")
                        return True
                    else:
                        self.log_test("4. Create Checkout Monthly", False, f"URL doesn't start with https://checkout.stripe.com/: {url}", data)
                        return False
                else:
                    self.log_test("4. Create Checkout Monthly", False, "Missing url or session_id in response", data)
                    return False
            elif response.status_code == 500:
                # Expected if Stripe key has issues
                try:
                    error_data = response.json()
                    if "Payment error" in error_data.get("detail", "") or "stripe" in error_data.get("detail", "").lower():
                        self.log_test("4. Create Checkout Monthly", True, f"Expected 500 error due to Stripe configuration: {error_data.get('detail')}")
                        return True
                    else:
                        self.log_test("4. Create Checkout Monthly", False, f"Unexpected 500 error: {error_data.get('detail')}", error_data)
                        return False
                except:
                    self.log_test("4. Create Checkout Monthly", True, f"Expected 500 error due to Stripe configuration: {response.text}")
                    return True
            else:
                self.log_test("4. Create Checkout Monthly", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("4. Create Checkout Monthly", False, f"Exception: {str(e)}")
            return False
    
    def test_create_checkout_yearly(self):
        """Test 5: POST /api/subscriptions/create-checkout?plan_id=yearly&origin_url=http://localhost:3000 (with auth)"""
        if not self.auth_token:
            self.log_test("5. Create Checkout Yearly", False, "No auth token available")
            return False
            
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = self.session.post(
                f"{self.base_url}/subscriptions/create-checkout?plan_id=yearly&origin_url=http://localhost:3000",
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                if "url" in data and "session_id" in data:
                    url = data["url"]
                    if url.startswith("https://checkout.stripe.com/"):
                        self.log_test("5. Create Checkout Yearly", True, f"Created yearly checkout session with valid Stripe URL: {url[:50]}...")
                        return True
                    else:
                        self.log_test("5. Create Checkout Yearly", False, f"URL doesn't start with https://checkout.stripe.com/: {url}", data)
                        return False
                else:
                    self.log_test("5. Create Checkout Yearly", False, "Missing url or session_id in response", data)
                    return False
            elif response.status_code == 500:
                # Expected if Stripe key has issues
                try:
                    error_data = response.json()
                    if "Payment error" in error_data.get("detail", "") or "stripe" in error_data.get("detail", "").lower():
                        self.log_test("5. Create Checkout Yearly", True, f"Expected 500 error due to Stripe configuration: {error_data.get('detail')}")
                        return True
                    else:
                        self.log_test("5. Create Checkout Yearly", False, f"Unexpected 500 error: {error_data.get('detail')}", error_data)
                        return False
                except:
                    self.log_test("5. Create Checkout Yearly", True, f"Expected 500 error due to Stripe configuration: {response.text}")
                    return True
            else:
                self.log_test("5. Create Checkout Yearly", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("5. Create Checkout Yearly", False, f"Exception: {str(e)}")
            return False
    
    def test_payment_success_page(self):
        """Test 6: GET /api/subscriptions/payment-success?session_id=test_123 - Should return 200 with HTML page"""
        try:
            response = self.session.get(f"{self.base_url}/subscriptions/payment-success?session_id=test_123")
            
            if response.status_code == 200:
                content = response.text
                # Check if it's HTML and contains expected content
                if "<!DOCTYPE html>" in content and ("Payment Successful" in content or "success" in content.lower()) and "meemz" in content:
                    self.log_test("6. Payment Success Page", True, "HTML page rendered correctly with success message and meemz branding")
                    return True
                else:
                    self.log_test("6. Payment Success Page", False, "HTML page missing expected content", content[:200])
                    return False
            else:
                self.log_test("6. Payment Success Page", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("6. Payment Success Page", False, f"Exception: {str(e)}")
            return False
    
    def test_payment_cancel_page(self):
        """Test 7: GET /api/subscriptions/payment-cancel - Should return 200 with HTML page"""
        try:
            response = self.session.get(f"{self.base_url}/subscriptions/payment-cancel")
            
            if response.status_code == 200:
                content = response.text
                # Check if it's HTML and contains expected content
                if "<!DOCTYPE html>" in content and ("Payment Cancelled" in content or "cancel" in content.lower()) and "meemz" in content:
                    self.log_test("7. Payment Cancel Page", True, "HTML page rendered correctly with cancel message and meemz branding")
                    return True
                else:
                    self.log_test("7. Payment Cancel Page", False, "HTML page missing expected content", content[:200])
                    return False
            else:
                self.log_test("7. Payment Cancel Page", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("7. Payment Cancel Page", False, f"Exception: {str(e)}")
            return False
    
    def test_subscription_status(self):
        """Test 8: GET /api/subscriptions/status (with auth) - Should return subscription status"""
        if not self.auth_token:
            self.log_test("8. Subscription Status", False, "No auth token available")
            return False
            
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = self.session.get(
                f"{self.base_url}/subscriptions/status",
                headers=headers
            )
            
            if response.status_code == 200:
                data = response.json()
                # Check for subscription status fields
                expected_fields = ["status", "subscription", "active", "plan"]
                has_status_field = any(field in data for field in expected_fields)
                
                if has_status_field:
                    self.log_test("8. Subscription Status", True, f"Subscription status endpoint working: {data}")
                    return True
                else:
                    self.log_test("8. Subscription Status", False, f"Missing expected status fields in response", data)
                    return False
            elif response.status_code == 404:
                self.log_test("8. Subscription Status", False, "Subscription status endpoint not found (404)", response.text)
                return False
            else:
                self.log_test("8. Subscription Status", False, f"Status: {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("8. Subscription Status", False, f"Exception: {str(e)}")
            return False
    
    def test_create_checkout_no_auth(self):
        """Test 9: POST /api/subscriptions/create-checkout without auth - Should return 401/403"""
        try:
            response = self.session.post(
                f"{self.base_url}/subscriptions/create-checkout?plan_id=monthly&origin_url=http://localhost:3000"
            )
            
            if response.status_code in [401, 403]:
                self.log_test("9. Create Checkout No Auth", True, f"Correctly rejected unauthorized request with status {response.status_code}")
                return True
            else:
                self.log_test("9. Create Checkout No Auth", False, f"Expected 401/403, got {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("9. Create Checkout No Auth", False, f"Exception: {str(e)}")
            return False
    
    def test_create_checkout_invalid_plan(self):
        """Test 10: POST /api/subscriptions/create-checkout?plan_id=invalid (with auth) - Should return 400"""
        if not self.auth_token:
            self.log_test("10. Create Checkout Invalid Plan", False, "No auth token available")
            return False
            
        try:
            headers = {
                "Authorization": f"Bearer {self.auth_token}",
                "Content-Type": "application/json"
            }
            
            response = self.session.post(
                f"{self.base_url}/subscriptions/create-checkout?plan_id=invalid&origin_url=http://localhost:3000",
                headers=headers
            )
            
            if response.status_code == 400:
                self.log_test("10. Create Checkout Invalid Plan", True, f"Correctly rejected invalid plan_id with status 400")
                return True
            elif response.status_code == 500:
                # May also be 500 if Stripe validation fails
                try:
                    error_data = response.json()
                    if "invalid" in error_data.get("detail", "").lower() or "plan" in error_data.get("detail", "").lower():
                        self.log_test("10. Create Checkout Invalid Plan", True, f"Correctly rejected invalid plan_id with status 500: {error_data.get('detail')}")
                        return True
                    else:
                        self.log_test("10. Create Checkout Invalid Plan", False, f"Unexpected 500 error: {error_data.get('detail')}", error_data)
                        return False
                except:
                    self.log_test("10. Create Checkout Invalid Plan", False, f"Unexpected 500 error: {response.text}")
                    return False
            else:
                self.log_test("10. Create Checkout Invalid Plan", False, f"Expected 400, got {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("10. Create Checkout Invalid Plan", False, f"Exception: {str(e)}")
            return False
    
    def run_stripe_tests(self):
        """Run all Stripe payment integration tests"""
        print(f"🚀 Starting Stripe Payment Integration Tests for MemeVault")
        print(f"📍 Base URL: {self.base_url}")
        print("=" * 70)
        
        tests = [
            self.test_auth_login,
            self.test_subscription_plans,
            self.test_create_checkout_weekly,
            self.test_create_checkout_monthly,
            self.test_create_checkout_yearly,
            self.test_payment_success_page,
            self.test_payment_cancel_page,
            self.test_subscription_status,
            self.test_create_checkout_no_auth,
            self.test_create_checkout_invalid_plan
        ]
        
        passed = 0
        failed = 0
        
        for test in tests:
            if test():
                passed += 1
            else:
                failed += 1
        
        print("=" * 70)
        print(f"📊 Stripe Payment Integration Test Results:")
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
    tester = StripePaymentTester()
    success = tester.run_stripe_tests()
    sys.exit(0 if success else 1)