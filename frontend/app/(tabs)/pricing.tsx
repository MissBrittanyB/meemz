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
import { useAppleIAP, APPLE_PRODUCT_IDS } from "../../utils/useAppleIAP";

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

  // Apple IAP hook
  const {
    isIOS,
    iapAvailable,
    products: appleProducts,
    purchasing: iapPurchasing,
    purchaseProduct,
    restorePurchases,
  } = useAppleIAP();

  // Use Apple IAP on iOS when available, Stripe otherwise
  const useApplePayment = isIOS && iapAvailable;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const storedToken = await AsyncStorage.getItem("memevault_token");
      setToken(storedToken);

      const plansRes = await axios.get(`${API_URL}/api/subscriptions/plans`);
      setPlans(plansRes.data);

      if (storedToken) {
        const statusRes = await axios.get(
          `${API_URL}/api/subscriptions/status`,
          { headers: { Authorization: `Bearer ${storedToken}` } }
        );
        setSubStatus(statusRes.data);
      }
    } catch (error) {
      console.error("Error loading pricing:", error);
    } finally {
      setLoading(false);
    }
  };

  const startTrial = async () => {
    if (!token) {
      Alert.alert(
        "Sign Up Required",
        "Create an account first to start your free trial!",
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

  // ============ APPLE IAP PURCHASE ============
  const subscribeWithApple = async () => {
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
      // Map plan ID to Apple product ID
      const appleProductId =
        APPLE_PRODUCT_IDS[selectedPlan as keyof typeof APPLE_PRODUCT_IDS];
      if (!appleProductId) {
        Alert.alert("Error", "Invalid plan selected");
        return;
      }

      console.log("[Pricing] Starting Apple IAP purchase:", appleProductId);
      const success = await purchaseProduct(appleProductId);

      if (success) {
        // Verify with backend
        try {
          await axios.post(
            `${API_URL}/api/subscriptions/apple/verify`,
            {
              product_id: appleProductId,
              transaction_id: `apple_${Date.now()}`,
            },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } catch (verifyErr) {
          console.log("[Pricing] Backend verify error (non-critical):", verifyErr);
        }

        setSubStatus({
          status: "active",
          plan_id: selectedPlan,
          trial_available: false,
          is_premium: true,
        });
        Alert.alert(
          "Payment Successful!",
          "Welcome to meemz premium! Enjoy unlimited access."
        );
      }
    } catch (error: any) {
      console.error("Apple IAP error:", error);
      if (!error?.message?.includes("cancel")) {
        Alert.alert(
          "Payment Error",
          error?.message || "Could not complete purchase"
        );
      }
    } finally {
      setProcessing(false);
    }
  };

  // ============ STRIPE PURCHASE (Web/Android) ============
  const subscribeWithStripe = async () => {
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

  // Route to correct payment method
  const subscribeToPlan = () => {
    if (useApplePayment) {
      subscribeWithApple();
    } else {
      subscribeWithStripe();
    }
  };

  const handleRestorePurchases = async () => {
    if (!token) {
      Alert.alert("Sign In Required", "Please sign in to restore purchases.");
      return;
    }

    setProcessing(true);
    try {
      const success = await restorePurchases();
      if (success) {
        // Verify with backend
        try {
          await axios.post(
            `${API_URL}/api/subscriptions/apple/restore`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } catch {}

        await loadData();
        Alert.alert("Restored!", "Your subscription has been restored.");
      }
    } catch (err: any) {
      Alert.alert("Restore Failed", err?.message || "Could not restore purchases.");
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

        {/* Trial CTA */}
        {(!subStatus || subStatus.trial_available) && (
          <TouchableOpacity
            style={styles.trialButton}
            onPress={startTrial}
            disabled={processing}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#FF7A1A", "#FF5A8A", "#8B5CFF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.trialGradient}
            >
              {processing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="gift" size={22} color="#fff" />
                  <View style={styles.trialTextContainer}>
                    <Text style={styles.trialTitle}>
                      Start 7-Day Free Trial
                    </Text>
                    <Text style={styles.trialSubtext}>
                      No payment required. Cancel anytime.
                    </Text>
                  </View>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or choose a plan</Text>
          <View style={styles.dividerLine} />
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
            (processing || iapPurchasing) && styles.subscribeButtonDisabled,
          ]}
          onPress={subscribeToPlan}
          disabled={processing || iapPurchasing}
          activeOpacity={0.8}
        >
          {processing || iapPurchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.subscribeText}>
              Subscribe —{" "}
              {plans.find((p) => p.id === selectedPlan)
                ? `$${plans.find((p) => p.id === selectedPlan)!.price.toFixed(2)}/${plans.find((p) => p.id === selectedPlan)!.interval}`
                : ""}
            </Text>
          )}
        </TouchableOpacity>

        {/* Fine print */}
        <Text style={styles.finePrint}>
          {useApplePayment
            ? "Payment will be charged through the App Store.\nSubscription auto-renews unless cancelled."
            : "Payment will be processed securely via Stripe.\nSubscription auto-renews unless cancelled."}
        </Text>

        {/* Restore Purchases - iOS only */}
        {isIOS && (
          <TouchableOpacity
            style={styles.restoreButton}
            onPress={handleRestorePurchases}
            disabled={processing || iapPurchasing}
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
