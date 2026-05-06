/**
 * Native IAP hook for meemz (iOS/Android)
 * Uses react-native-iap for StoreKit 2
 */
import { useState, useEffect, useCallback } from "react";
import { Platform, Alert } from "react-native";
import { initConnection, endConnection, getSubscriptions, requestSubscription, getAvailablePurchases, finishTransaction, setup } from "react-native-iap";

export const PLAN_TO_PRODUCT: Record<string, string> = {
  weekly: "meemz_weekly",
  monthly: "meemz_Monthly",
  yearly: "memo_Yearly",
};

const IAP_SKUS = ["meemz_weekly", "meemz_Monthly", "memo_Yearly"];

export function useNativeIAP() {
  const [available, setAvailable] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  const isIOS = Platform.OS === "ios";

  useEffect(() => {
    if (!isIOS) {
      setLoading(false);
      return;
    }
    initIAP();
    return () => { try { endConnection(); } catch {} };
  }, []);

  const initIAP = async () => {
    try {
      try { setup({ storekitMode: "STOREKIT2_MODE" }); } catch {}

      const connected = await initConnection();
      if (connected) {
        console.log("[IAP] Connected");
        try {
          const subs = await getSubscriptions({ skus: IAP_SKUS });
          const list = Array.isArray(subs) ? subs : [];
          console.log("[IAP] Products loaded:", list.length);
          setProducts(list);
          // Only mark as available if products actually loaded - prevents
          // attempting purchases against unloaded SKUs (which throws errors)
          setAvailable(list.length > 0);
        } catch (e: any) {
          console.log("[IAP] Fetch error:", e?.message);
          setAvailable(false);
        }
      }
    } catch (e: any) {
      console.log("[IAP] Init error:", e?.message);
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  const purchase = useCallback(async (productId: string): Promise<boolean> => {
    if (!available) {
      Alert.alert(
        "Subscriptions Unavailable",
        "App Store subscriptions are not available right now. Please ensure you're signed into the App Store and try again."
      );
      return false;
    }
    setPurchasing(true);
    try {
      // Find the loaded product to get its subscription offer details (required by StoreKit 2)
      const product = products.find((p: any) => p?.productId === productId || p?.id === productId);
      const offerToken = product?.subscriptionOfferDetails?.[0]?.offerToken;

      // Build args - include subscriptionOffers for Android, sku for both
      const args: any = { sku: productId };
      if (offerToken) {
        args.subscriptionOffers = [{ sku: productId, offerToken }];
      }

      const result = await requestSubscription(args);
      if (result) {
        try { await finishTransaction({ purchase: result, isConsumable: false }); } catch {}
        setPurchasing(false);
        return true;
      }
      setPurchasing(false);
      return false;
    } catch (e: any) {
      setPurchasing(false);
      const msg = e?.message || "";
      // Silently swallow user-initiated cancellations - never show an error
      if (
        e?.code === "E_USER_CANCELLED" ||
        e?.code === "E_DEFERRED" ||
        msg.toLowerCase().includes("cancel") ||
        msg.toLowerCase().includes("dismiss")
      ) {
        return false;
      }
      // Only surface real, actionable errors
      console.log("[IAP] Purchase error:", e?.code, msg);
      Alert.alert("Purchase Error", msg || "Could not complete purchase.");
      return false;
    }
  }, [available, products]);

  const restore = useCallback(async (): Promise<boolean> => {
    if (!available) return false;
    setPurchasing(true);
    try {
      const purchases = await getAvailablePurchases();
      setPurchasing(false);
      if (purchases?.length > 0) {
        for (const p of purchases) {
          try { await finishTransaction({ purchase: p, isConsumable: false }); } catch {}
        }
        return true;
      }
      Alert.alert("No Purchases", "No previous subscriptions found.");
      return false;
    } catch (e: any) {
      setPurchasing(false);
      Alert.alert("Restore Error", e?.message || "Could not restore.");
      return false;
    }
  }, [available]);

  return { isIOS, available, products, loading, purchasing, purchase, restore };
}
