/**
 * Apple In-App Purchase hook for meemz
 * Uses react-native-iap for StoreKit 2 integration
 * Only active on iOS native builds — gracefully no-ops elsewhere
 */
import { useState, useEffect, useCallback } from "react";
import { Platform, Alert } from "react-native";

// Product IDs - must match App Store Connect exactly
export const IAP_PRODUCT_IDS = [
  "meemz_weekly",
  "meemz_Monthly", // Note: capital M to match App Store Connect
  "meemz_yearly",
];

// Map plan names to product IDs
export const PLAN_TO_PRODUCT: Record<string, string> = {
  weekly: "meemz_weekly",
  monthly: "meemz_Monthly",
  yearly: "meemz_yearly",
};

interface IAPState {
  available: boolean;
  products: any[];
  loading: boolean;
  purchasing: boolean;
}

export function useNativeIAP() {
  const [state, setState] = useState<IAPState>({
    available: false,
    products: [],
    loading: true,
    purchasing: false,
  });
  const [iap, setIap] = useState<any>(null);

  const isIOS = Platform.OS === "ios";

  useEffect(() => {
    if (!isIOS) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    initIAP();
    return () => {
      try { iap?.endConnection?.(); } catch {}
    };
  }, []);

  const initIAP = async () => {
    try {
      const RNIap = require("react-native-iap");
      setIap(RNIap);

      // Setup for StoreKit 2
      if (RNIap.setup) {
        RNIap.setup({ storekitMode: "STOREKIT2_MODE" });
      }

      const connected = await RNIap.initConnection();
      if (connected) {
        console.log("[IAP] Connected to App Store");

        // Fetch subscription products
        try {
          const subs = await RNIap.getSubscriptions({ skus: IAP_PRODUCT_IDS });
          console.log("[IAP] Subscriptions loaded:", subs?.length);
          setState({
            available: true,
            products: subs || [],
            loading: false,
            purchasing: false,
          });
        } catch (fetchErr: any) {
          console.log("[IAP] Fetch products error:", fetchErr?.message);
          setState((s) => ({ ...s, available: true, loading: false }));
        }
      } else {
        console.log("[IAP] Not connected");
        setState((s) => ({ ...s, loading: false }));
      }
    } catch (err: any) {
      // Expected to fail in Expo Go, simulators, web
      console.log("[IAP] Init failed (expected in dev):", err?.message);
      setState((s) => ({ ...s, loading: false }));
    }
  };

  const purchase = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!iap || !state.available) return false;

      setState((s) => ({ ...s, purchasing: true }));
      try {
        console.log("[IAP] Requesting subscription:", productId);
        const purchase = await iap.requestSubscription({ sku: productId });

        if (purchase) {
          console.log("[IAP] Purchase success:", purchase.transactionId || purchase.transactionReceipt?.substring(0, 20));
          // Finish the transaction
          try {
            await iap.finishTransaction({ purchase, isConsumable: false });
          } catch {}
          setState((s) => ({ ...s, purchasing: false }));
          return true;
        }

        setState((s) => ({ ...s, purchasing: false }));
        return false;
      } catch (err: any) {
        console.log("[IAP] Purchase error:", err?.code, err?.message);
        setState((s) => ({ ...s, purchasing: false }));

        // Don't show error for user cancellation
        if (err?.code === "E_USER_CANCELLED" || err?.message?.includes("cancel")) {
          return false;
        }

        Alert.alert("Purchase Error", err?.message || "Could not complete purchase. Please try again.");
        return false;
      }
    },
    [iap, state.available]
  );

  const restore = useCallback(async (): Promise<boolean> => {
    if (!iap || !state.available) return false;

    setState((s) => ({ ...s, purchasing: true }));
    try {
      const purchases = await iap.getAvailablePurchases();
      setState((s) => ({ ...s, purchasing: false }));

      if (purchases && purchases.length > 0) {
        for (const p of purchases) {
          try { await iap.finishTransaction({ purchase: p, isConsumable: false }); } catch {}
        }
        return true;
      }

      Alert.alert("No Purchases", "No previous subscriptions found to restore.");
      return false;
    } catch (err: any) {
      setState((s) => ({ ...s, purchasing: false }));
      Alert.alert("Restore Error", err?.message || "Could not restore purchases.");
      return false;
    }
  }, [iap, state.available]);

  return {
    isIOS,
    available: state.available,
    products: state.products,
    loading: state.loading,
    purchasing: state.purchasing,
    purchase,
    restore,
  };
}
