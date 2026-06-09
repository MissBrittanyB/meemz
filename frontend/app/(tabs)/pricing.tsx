import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import GradientText from "../../utils/GradientText";
import { useNativeIAP, PLAN_TO_PRODUCT } from "../../utils/useNativeIAP";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

interface Plan {
  id: string;
  name: string;
  price: number;
  interval: string;
  description: string;
  features: string[];
  popular?: boolean;
}

interface SubStatus {
  status: string;
  plan_id: string | null;
  trial_available: boolean;
  is_premium: boolean;
  trial_end?: string;
  current_period_end?: string;
}

export default function PricingScreen() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subStatus, setSubStatus] = useState<SubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string>("monthly");
  const [processing, setProcessing] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // Native IAP for iOS
  const { isIOS, available: iapAvailable, loading: iapLoading, purchasing: iapPurchasing, purchase, restore } = useNativeIAP();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const storedToken = await AsyncStorage.getItem("memevault_token");
      setToken(storedToken);

      const plansRes = await axios.get(`${API_URL}/api/subscriptions/plans`);
      setPlans(plansRes.data);

      // Check backend subscription status if signed in
      if (storedToken) {
        try {
          const statusRes = await axios.get(
            `${API_URL}/api/subscriptions/status`,
            { headers: { Authorization: `Bearer ${storedToken}` } }
          );
          setSubStatus(statusRes.data);
        } catch (e) {
          console.log("Could not fetch backend sub status", e);
        }
      }

      // Apple Guideline 5.1.1: also check LOCAL entitlement so anonymous users
      // see their subscription as active without needing an account
      try {
        const localRaw = await AsyncStorage.getItem("meemz_local_entitlement");
        if (localRaw) {
          const local = JSON.parse(localRaw);
          if (local?.is_premium) {
            setSubStatus((current) => current?.is_premium ? current : {
              status: "active",
              plan_id: local.plan_id || "monthly",
              trial_available: false,
              is_premium: true,
            });
          }
        }
      } catch (e) {
        console.log("Could not read local entitlement", e);
      }
    } catch (error) {
      console.error("Error loading pricing:", error);
    } finally {
      setLoading(false);
    }
  };

  const startTrial = async () => {
    // Trial is now handled as an introductory offer on the App Store subscription itself
    // (configured in App Store Connect). Apple Guideline 3.1.2(c) prohibits a separate
    // free-trial button on the purchase screen. This function is retained for backward
    // compatibility with any deep links but should no longer be invoked from the UI.
    if (!token) {
      Alert.alert(
        "Sign Up Required",
        "Create an account first to subscribe!",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign Up", onPress: () => router.push("/(tabs)/profile") },
        ]
      );
      return;
    }

    setProcessing(true);
    try {
      const res = await axios.post(
        `${API_URL}/api/subscriptions/start-trial`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSubStatus({
        status: "trial",
        plan_id: "trial",
        trial_available: false,
        is_premium: true,
        trial_end: res.data.trial_end,
      });
      Alert.alert(
        "Trial Started!",
        "Enjoy 7 days of unlimited meemz access!"
      );
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.response?.data?.detail || "Could not start trial"
      );
    } finally {
      setProcessing(false);
    }
  };

  // Route to correct payment method.
  // Apple Guideline 3.1.1: iOS MUST use In-App Purchase only - never fall back to Stripe.
  // The native IAP hook performs lazy product fetch + retries if products weren't
  // ready at mount, so we let the user tap Subscribe at any time.
  const subscribeToPlan = () => {
    if (isIOS) {
      subscribeWithApple();
    } else {
      subscribeWithStripe();
    }
  };

  // Apple IAP purchase - Per Apple Guideline 5.1.1, purchase MUST NOT require account creation.
  // Anonymous users can subscribe; entitlement is stored locally and offered to be
  // linked to an account afterward (optional, for cross-device access only).
  const subscribeWithApple = async () => {
    setProcessing(true);
    try {
      const productId = PLAN_TO_PRODUCT[selectedPlan];
      if (!productId) {
        Alert.alert("Error", "Invalid plan selected");
        setProcessing(false);
        return;
      }

      const purchaseResult: any = await purchase(productId);
      if (purchaseResult) {
        // Extract the REAL transaction id + receipt from StoreKit
        const transactionId =
          purchaseResult.transactionId ||
          purchaseResult.id ||
          purchaseResult.originalTransactionIdentifierIOS ||
          "";
        const transactionReceipt =
          purchaseResult.transactionReceipt ||
          purchaseResult.receiptIOS ||
          purchaseResult.jwsRepresentation ||
          "";
        const originalTransactionId =
          purchaseResult.originalTransactionIdentifierIOS ||
          purchaseResult.originalTransactionId ||
          transactionId;

        // ALWAYS persist entitlement locally so the user can use the subscription
        // on this device immediately, without needing an account (Apple 5.1.1)
        try {
          const localEntitlement = {
            product_id: productId,
            plan_id: selectedPlan,
            transaction_id: transactionId,
            original_transaction_id: originalTransactionId,
            receipt: transactionReceipt,
            purchased_at: new Date().toISOString(),
            is_premium: true,
          };
          await AsyncStorage.setItem(
            "meemz_local_entitlement",
            JSON.stringify(localEntitlement)
          );
        } catch (e) {
          console.log("Failed to persist local entitlement", e);
        }

        // If user IS already signed in, also sync with backend for cross-device use
        if (token) {
          try {
            await axios.post(
              `${API_URL}/api/subscriptions/apple/verify`,
              {
                product_id: productId,
                transaction_id: transactionId,
                original_transaction_id: originalTransactionId,
                receipt_data: transactionReceipt,
              },
              { headers: { Authorization: `Bearer ${token}` } }
            );
          } catch (verifyErr: any) {
            console.log("[IAP] Backend verify error:", verifyErr?.message);
          }
        }

        // Update UI - user is now premium on this device
        setSubStatus({
          status: "active",
          plan_id: selectedPlan,
          trial_available: false,
          is_premium: true,
        });

        // Post-purchase UX: thank them, and OPTIONALLY offer account linking
        if (token) {
          Alert.alert("Payment Successful!", "Welcome to meemz premium! Enjoy unlimited access.");
        } else {
          Alert.alert(
            "Payment Successful!",
            "Welcome to meemz premium! Enjoy unlimited access on this device.\n\nWant to use your subscription on other devices too? You can optionally create a free account anytime in the Profile tab to link this purchase.",
            [{ text: "OK" }]
          );
        }
      }
    } catch (error: any) {
      if (!error?.message?.includes("cancel")) {
        Alert.alert("Payment Error", error?.message || "Could not complete purchase");
      }
    } finally {
      setProcessing(false);
    }
  };

  // Restore purchases - Per Apple Guideline 5.1.1 / 3.1.1, this MUST work without
  // requiring account creation (StoreKit queries the Apple ID's entitlements directly).
  const handleRestore = async () => {
    setProcessing(true);
    try {
      const success = await restore();
      if (success) {
        // Persist local entitlement so anonymous users see active premium status
        try {
          const localEntitlement = {
            plan_id: selectedPlan,
            restored_at: new Date().toISOString(),
            is_premium: true,
          };
          await AsyncStorage.setItem(
            "meemz_local_entitlement",
            JSON.stringify(localEntitlement)
          );
        } catch {}

        setSubStatus({
          status: "active",
          plan_id: selectedPlan,
          trial_available: false,
          is_premium: true,
        });

        // If signed in, also refresh backend status
        if (token) {
          await loadData();
        }
        Alert.alert("Restored!", "Your subscription has been restored.");
      }
    } catch {}
    setProcessing(false);
  };

  // ============ STRIPE PURCHASE (Web/Android only) ============
  // Per Apple Guideline 3.1.1, this MUST NEVER be invoked on iOS.
  // iOS subscriptions are processed exclusively via Apple In-App Purchase.
  const subscribeWithStripe = async () => {
    if (isIOS) {
      // Hard guard - should be unreachable but protects against future regressions
      Alert.alert(
        "Use In-App Purchase",
        "On iOS, subscriptions are processed through the App Store. Please use the Subscribe button."
      );
      return;
    }

    if (!token) {
      Alert.alert(
        "Sign Up Required",
        "Create an account first to subscribe!",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign Up", onPress: () => router.push("/(tabs)/profile") },
        ]
      );
      return;
    }

    setProcessing(true);
    try {
      let originUrl = API_URL;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        originUrl = window.location.origin;
      }

      const res = await axios.post(
        `${API_URL}/api/subscriptions/create-checkout?plan_id=${selectedPlan}&origin_url=${encodeURIComponent(originUrl)}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const checkoutUrl = res.data.url;
      const sessionId = res.data.session_id;

      if (!checkoutUrl) {
        throw new Error("No checkout URL received");
      }

      if (Platform.OS === "web") {
        window.location.href = checkoutUrl;
      } else {
        const result = await WebBrowser.openBrowserAsync(checkoutUrl);
        if (result.type === "cancel" || result.type === "dismiss") {
          await pollPaymentStatus(sessionId);
        }
      }
    } catch (error: any) {
      console.error("Subscribe error:", error);
      Alert.alert(
        "Payment Error",
        error.response?.data?.detail ||
          error.message ||
          "Could not start checkout"
      );
    } finally {
      setProcessing(false);
    }
  };

  const pollPaymentStatus = async (sessionId: string) => {
    for (let i = 0; i < 5; i++) {
      try {
        const res = await axios.get(
          `${API_URL}/api/subscriptions/status`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (res.data.is_premium || res.data.status === "active") {
          setSubStatus({
            status: "active",
            plan_id: res.data.plan_id || selectedPlan,
            trial_available: false,
            is_premium: true,
          });
          Alert.alert(
            "Payment Successful!",
            "Welcome to meemz premium! Enjoy unlimited access."
          );
          return;
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    Alert.alert(
      "Processing",
      "Your payment is being processed. Check back in a moment.",
      [
        {
          text: "Check Now",
          onPress: async () => {
            await loadData();
          },
        },
        { text: "OK" },
      ]
    );
  };

  const getPricePerWeek = (plan: Plan): string => {
    if (plan.interval === "week") return `$${plan.price.toFixed(2)}/wk`;
    if (plan.interval === "month")
      return `$${(plan.price / 4.33).toFixed(2)}/wk`;
    return `$${(plan.price / 52).toFixed(2)}/wk`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF7A1A" />
        </View>
      </SafeAreaView>
    );
  }

  // Already premium
  if (subStatus?.is_premium) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.premiumContainer}>
          <View style={styles.premiumBadge}>
            <LinearGradient
              colors={["#FF7A1A", "#FF5A8A", "#8B5CFF", "#4FA8FF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.premiumGradient}
            >
              <Ionicons name="diamond" size={40} color="#fff" />
            </LinearGradient>
          </View>
          <GradientText text="meemz Premium" style={styles.premiumTitle} />
          <Text style={styles.premiumSubtext}>
            {subStatus.status === "trial"
              ? "Free Trial Active"
              : `${subStatus.plan_id?.charAt(0).toUpperCase()}${subStatus.plan_id?.slice(1)} Plan`}
          </Text>
          <Text style={styles.premiumExpiry}>
            {subStatus.status === "trial"
              ? `Trial ends: ${new Date(subStatus.trial_end!).toLocaleDateString()}`
              : `Renews: ${new Date(subStatus.current_period_end!).toLocaleDateString()}`}
          </Text>

          <View style={styles.premiumFeatures}>
            <View style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={22} color="#FF7A1A" />
              <Text style={styles.featureText}>Unlimited meemz access</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={22} color="#FF7A1A" />
              <Text style={styles.featureText}>Share, copy & save</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={22} color="#FF7A1A" />
              <Text style={styles.featureText}>Upload meemz</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={22} color="#FF7A1A" />
              <Text style={styles.featureText}>Ad-free experience</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.managePlanButton}
            onPress={() => {
              setSubStatus(null);
              setLoading(false);
            }}
          >
            <Ionicons name="swap-horizontal" size={18} color="#FF7A1A" />
            <Text style={styles.managePlanText}>View Plans / Change Plan</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <GradientText text="meemz" style={styles.logo} />
          <Text style={styles.title}>Unlock Premium</Text>
          <Text style={styles.subtitle}>
            Get unlimited access to share, copy, and save meemz
          </Text>
        </View>

        {/* Plan Cards */}
        <View style={styles.plansContainer}>
          {plans.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              style={[
                styles.planCard,
                selectedPlan === plan.id && styles.planCardSelected,
              ]}
              onPress={() => setSelectedPlan(plan.id)}
              activeOpacity={0.8}
            >
              {plan.popular && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularText}>BEST VALUE</Text>
                </View>
              )}

              <View style={styles.planHeader}>
                <View style={styles.radioOuter}>
                  {selectedPlan === plan.id && (
                    <View style={styles.radioInner} />
                  )}
                </View>
                <View style={styles.planInfo}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  <Text style={styles.planDescription}>
                    {plan.description}
                  </Text>
                </View>
                <View style={styles.planPriceContainer}>
                  <Text style={styles.planPrice}>
                    ${plan.price.toFixed(2)}
                  </Text>
                  <Text style={styles.planInterval}>/{plan.interval}</Text>
                </View>
              </View>

              <Text style={styles.weeklyPrice}>{getPricePerWeek(plan)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Subscribe Button */}
        <TouchableOpacity
          style={[
            styles.subscribeButton,
            processing && styles.subscribeButtonDisabled,
          ]}
          onPress={subscribeToPlan}
          disabled={processing}
          activeOpacity={0.8}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : isIOS && iapLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.subscribeText}>Loading App Store…</Text>
            </View>
          ) : (
            <Text style={styles.subscribeText}>
              Subscribe —{" "}
              {plans.find((p) => p.id === selectedPlan)
                ? `$${plans.find((p) => p.id === selectedPlan)!.price.toFixed(2)}/${plans.find((p) => p.id === selectedPlan)!.interval}`
                : ""}
            </Text>
          )}
        </TouchableOpacity>

        {/* Fine print - Apple Guideline 3.1.2(a) compliant subscription disclosure */}
        <Text style={styles.finePrint}>
          {isIOS
            ? "By subscribing, you agree to a recurring auto-renewing subscription. Payment will be charged to your Apple ID at confirmation of purchase. Your subscription automatically renews at the same price unless cancelled at least 24 hours before the end of the current period. You can manage and cancel subscriptions in your App Store account settings."
            : "By subscribing, you agree to a recurring auto-renewing subscription. Payment will be processed securely. Your subscription automatically renews unless cancelled before the end of the current billing period."}
        </Text>

        {/* Legal Links */}
        <View style={styles.legalLinks}>
          <TouchableOpacity
            onPress={() => WebBrowser.openBrowserAsync("https://meemzai.com/privacy")}
          >
            <Text style={styles.legalLinkText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>|</Text>
          <TouchableOpacity
            onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/api/terms-of-service`)}
          >
            <Text style={styles.legalLinkText}>Terms of Use (EULA)</Text>
          </TouchableOpacity>
        </View>

        {/* Restore Purchases - iOS only */}
        {isIOS && (
          <TouchableOpacity
            style={styles.restoreButton}
            onPress={handleRestore}
            disabled={processing}
          >
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0B0F",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 36,
    fontWeight: "bold",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#EAEAF0",
    marginTop: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
  // Trial
  trialButton: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
  },
  trialGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
  },
  trialTextContainer: {
    flex: 1,
  },
  trialTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  trialSubtext: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    marginTop: 2,
  },
  // Divider
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 24,
    paddingHorizontal: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#1E1E24",
  },
  dividerText: {
    color: "#666",
    fontSize: 13,
    marginHorizontal: 16,
  },
  // Plans
  plansContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  planCard: {
    backgroundColor: "#15151A",
    borderRadius: 14,
    padding: 18,
    borderWidth: 2,
    borderColor: "#1E1E24",
    position: "relative",
    overflow: "hidden",
  },
  planCardSelected: {
    borderColor: "#FF7A1A",
  },
  popularBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "#FF7A1A",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
  },
  popularText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#FF7A1A",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FF7A1A",
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    color: "#EAEAF0",
    fontSize: 18,
    fontWeight: "bold",
  },
  planDescription: {
    color: "#888",
    fontSize: 13,
    marginTop: 2,
  },
  planPriceContainer: {
    alignItems: "flex-end",
  },
  planPrice: {
    color: "#EAEAF0",
    fontSize: 22,
    fontWeight: "bold",
  },
  planInterval: {
    color: "#888",
    fontSize: 13,
  },
  weeklyPrice: {
    color: "#666",
    fontSize: 12,
    marginTop: 8,
    marginLeft: 36,
  },
  // Subscribe
  subscribeButton: {
    backgroundColor: "#FF7A1A",
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
  },
  subscribeButtonDisabled: {
    backgroundColor: "#444",
  },
  subscribeText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  finePrint: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 18,
    paddingHorizontal: 40,
  },
  // Restore Purchases
  restoreButton: {
    alignItems: "center",
    paddingVertical: 16,
    marginBottom: 100,
  },
  restoreText: {
    color: "#888",
    fontSize: 14,
    textDecorationLine: "underline",
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 8,
    gap: 8,
  },
  legalLinkText: {
    color: "#888",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  legalSeparator: {
    color: "#444",
    fontSize: 13,
  },
  // Premium status
  premiumContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  premiumBadge: {
    marginBottom: 24,
  },
  premiumGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  premiumTitle: {
    fontSize: 28,
    fontWeight: "bold",
  },
  premiumSubtext: {
    fontSize: 18,
    color: "#EAEAF0",
    marginTop: 8,
  },
  premiumExpiry: {
    fontSize: 14,
    color: "#888",
    marginTop: 8,
  },
  premiumFeatures: {
    marginTop: 32,
    gap: 16,
    width: "100%",
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  featureText: {
    color: "#EAEAF0",
    fontSize: 16,
  },
  managePlanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 32,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FF7A1A",
    backgroundColor: "rgba(255, 122, 26, 0.08)",
  },
  managePlanText: {
    color: "#FF7A1A",
    fontSize: 15,
    fontWeight: "600",
  },
});
