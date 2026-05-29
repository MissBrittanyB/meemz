/**
 * Native IAP hook for meemz (iOS/Android)
 * Uses react-native-iap for StoreKit 2
 *
 * Hardened for Apple Review:
 *  - Retries product fetch up to 3 times with exponential backoff on init
 *  - Re-fetches products on-demand if user taps Subscribe before initial load finishes
 *  - Restore always works regardless of product list state (entitlement recovery)
 *  - Clear, action-oriented error messages
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Platform, Alert } from "react-native";
import {
  initConnection,
  endConnection,
  getSubscriptions,
  requestSubscription,
  getAvailablePurchases,
  finishTransaction,
  setup,
} from "react-native-iap";

export const PLAN_TO_PRODUCT: Record<string, string> = {
  weekly: "meemz_weekly",
  monthly: "meemz_Monthly",
  yearly: "memo_Yearly",
};

const IAP_SKUS = ["meemz_weekly", "meemz_Monthly", "memo_Yearly"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useNativeIAP() {
  const [available, setAvailable] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const connectedRef = useRef(false);
  const productsRef = useRef<any[]>([]);

  const isIOS = Platform.OS === "ios";

  // Keep ref in sync with state for use inside async callbacks
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    if (!isIOS) {
      setLoading(false);
      return;
    }
    initIAP();
    return () => {
      try { endConnection(); } catch {}
      connectedRef.current = false;
    };
  }, []);

  // Fetch products with exponential retry. Returns the loaded list.
  const fetchProducts = async (attempts = 3): Promise<any[]> => {
    for (let i = 0; i < attempts; i++) {
      try {
        const subs = await getSubscriptions({ skus: IAP_SKUS });
        const list = Array.isArray(subs) ? subs : [];
        if (list.length > 0) {
          console.log(`[IAP] Products loaded on attempt ${i + 1}:`, list.length);
          return list;
        }
        console.log(`[IAP] Attempt ${i + 1} returned empty list, retrying...`);
      } catch (e: any) {
        console.log(`[IAP] Fetch attempt ${i + 1} error:`, e?.message);
      }
      if (i < attempts - 1) await sleep(800 * (i + 1));
    }
    return [];
  };

  const ensureConnection = async (): Promise<boolean> => {
    if (connectedRef.current) return true;
    try {
      try { setup({ storekitMode: "STOREKIT2_MODE" }); } catch {}
      const connected = await initConnection();
      connectedRef.current = !!connected;
      return !!connected;
    } catch (e: any) {
      console.log("[IAP] initConnection error:", e?.message);
      return false;
    }
  };

  const initIAP = async () => {
    try {
      const ok = await ensureConnection();
      if (!ok) {
        setAvailable(false);
        return;
      }
      const list = await fetchProducts(3);
      setProducts(list);
      productsRef.current = list;
      setAvailable(list.length > 0);
    } catch (e: any) {
      console.log("[IAP] Init error:", e?.message);
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  const purchase = useCallback(async (productId: string): Promise<boolean> => {
    setPurchasing(true);
    try {
      // 1. Make sure StoreKit is connected
      const connected = await ensureConnection();
      if (!connected) {
        setPurchasing(false);
        Alert.alert(
          "App Store Unavailable",
          "Couldn't reach the App Store. Please check your internet connection, ensure you're signed in to the App Store, and try again."
        );
        return false;
      }

      // 2. Make sure products are loaded; refetch on-demand if they aren't yet
      let list = productsRef.current;
      if (!list || list.length === 0) {
        console.log("[IAP] Products not loaded yet, fetching on demand...");
        list = await fetchProducts(3);
        if (list.length > 0) {
          setProducts(list);
          productsRef.current = list;
          setAvailable(true);
        }
      }

      if (!list || list.length === 0) {
        setPurchasing(false);
        Alert.alert(
          "Subscriptions Unavailable",
          "We couldn't load subscription options from the App Store. Please ensure you're signed in to the App Store (Settings → [Your Name] → Media & Purchases), then try again."
        );
        return false;
      }

      // 3. Verify the specific product we want exists in the loaded list
      const product = list.find((p: any) => p?.productId === productId || p?.id === productId);
      if (!product) {
        setPurchasing(false);
        Alert.alert(
          "Subscription Unavailable",
          "This subscription option isn't available right now. Please try a different plan or try again later."
        );
        return false;
      }

      // 4. Build subscription offer args (required for StoreKit 2 + introductory offers)
      const offerToken = product?.subscriptionOfferDetails?.[0]?.offerToken;
      const args: any = { sku: productId };
      if (offerToken) {
        args.subscriptionOffers = [{ sku: productId, offerToken }];
      }

      // 5. Trigger the native purchase sheet
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
      console.log("[IAP] Purchase error:", e?.code, msg);
      Alert.alert("Purchase Error", msg || "Could not complete purchase. Please try again.");
      return false;
    }
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    setPurchasing(true);
    try {
      // Restore should work even when products are unavailable - it queries existing entitlements
      await ensureConnection();
      const purchases = await getAvailablePurchases();
      setPurchasing(false);
      if (purchases && purchases.length > 0) {
        for (const p of purchases) {
          try { await finishTransaction({ purchase: p, isConsumable: false }); } catch {}
        }
        return true;
      }
      Alert.alert("No Purchases", "No previous subscriptions found on this Apple ID.");
      return false;
    } catch (e: any) {
      setPurchasing(false);
      Alert.alert("Restore Error", e?.message || "Could not restore purchases.");
      return false;
    }
  }, []);

  return { isIOS, available, products, loading, purchasing, purchase, restore };
}
