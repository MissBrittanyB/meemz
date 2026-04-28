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
  yearly: "meemz_yearly",
};

const IAP_SKUS = ["meemz_weekly", "meemz_Monthly", "meemz_yearly"];

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
          console.log("[IAP] Products:", subs?.length);
          setProducts(subs || []);
          setAvailable(true);
        } catch (e: any) {
          console.log("[IAP] Fetch error:", e?.message);
          setAvailable(true);
        }
      }
    } catch (e: any) {
      console.log("[IAP] Init error:", e?.message);
    } finally {
      setLoading(false);
    }
  };

  const purchase = useCallback(async (productId: string): Promise<boolean> => {
    if (!available) return false;
    setPurchasing(true);
    try {
      const result = await requestSubscription({ sku: productId });
      if (result) {
        try { await finishTransaction({ purchase: result, isConsumable: false }); } catch {}
        setPurchasing(false);
        return true;
      }
      setPurchasing(false);
      return false;
    } catch (e: any) {
      setPurchasing(false);
      if (e?.code === "E_USER_CANCELLED" || e?.message?.includes("cancel")) return false;
      Alert.alert("Purchase Error", e?.message || "Could not complete purchase.");
      return false;
    }
  }, [available]);

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
