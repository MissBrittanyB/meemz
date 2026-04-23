/**
 * Apple In-App Purchase hook for meemz
 * Uses expo-iap for StoreKit integration on iOS
 * Falls back gracefully on non-iOS platforms or Expo Go
 */
import { useState, useEffect, useCallback } from "react";
import { Platform, Alert } from "react-native";

// Product IDs - must match App Store Connect
export const APPLE_PRODUCT_IDS = {
  weekly: "meemz_weekly",
  monthly: "meemz_monthly",
  yearly: "meemz_yearly",
};

const ALL_PRODUCT_IDS = Object.values(APPLE_PRODUCT_IDS);

export interface AppleProduct {
  productId: string;
  title: string;
  description: string;
  price: string;
  localizedPrice: string;
  currency: string;
}

interface UseAppleIAPReturn {
  isIOS: boolean;
  iapAvailable: boolean;
  products: AppleProduct[];
  loading: boolean;
  purchasing: boolean;
  error: string | null;
  purchaseProduct: (productId: string) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
}

export function useAppleIAP(): UseAppleIAPReturn {
  const [iapAvailable, setIapAvailable] = useState(false);
  const [products, setProducts] = useState<AppleProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iapModule, setIapModule] = useState<any>(null);

  const isIOS = Platform.OS === "ios";

  useEffect(() => {
    if (!isIOS) {
      setLoading(false);
      return;
    }

    initIAP();

    return () => {
      // Cleanup
      if (iapModule?.endConnection) {
        iapModule.endConnection();
      }
    };
  }, []);

  const initIAP = async () => {
    try {
      // Dynamic import to avoid crashes on non-iOS / Expo Go
      const IAP = await import("expo-iap");
      setIapModule(IAP);

      // Initialize connection
      const result = await IAP.initConnection();
      if (result) {
        setIapAvailable(true);
        console.log("[IAP] Connection established");

        // Fetch products from App Store
        await fetchProducts(IAP);
      } else {
        console.log("[IAP] Connection failed - may be in Expo Go or simulator");
        setIapAvailable(false);
      }
    } catch (err: any) {
      console.log("[IAP] Init error (expected in Expo Go):", err?.message);
      setIapAvailable(false);
      setError(null); // Don't show error for expected Expo Go failures
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async (IAP: any) => {
    try {
      const items = await IAP.getSubscriptions({ skus: ALL_PRODUCT_IDS });
      console.log("[IAP] Products fetched:", items?.length);

      if (items && items.length > 0) {
        const mapped: AppleProduct[] = items.map((item: any) => ({
          productId: item.productId,
          title: item.title || item.localizedTitle || item.productId,
          description: item.description || item.localizedDescription || "",
          price: item.price || "0",
          localizedPrice: item.localizedPrice || `$${item.price || "0"}`,
          currency: item.currency || "USD",
        }));
        setProducts(mapped);
      }
    } catch (err: any) {
      console.log("[IAP] Fetch products error:", err?.message);
    }
  };

  const purchaseProduct = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!iapModule || !iapAvailable) {
        Alert.alert("Not Available", "In-App Purchases are not available on this device.");
        return false;
      }

      setPurchasing(true);
      setError(null);

      try {
        console.log("[IAP] Requesting purchase:", productId);
        const purchase = await iapModule.requestSubscription({
          sku: productId,
        });

        if (purchase) {
          console.log("[IAP] Purchase successful:", purchase.transactionId);

          // Finish the transaction
          await iapModule.finishTransaction({
            purchase,
            isConsumable: false,
          });

          return true;
        }
        return false;
      } catch (err: any) {
        console.error("[IAP] Purchase error:", err?.message);

        // User cancelled
        if (
          err?.code === "E_USER_CANCELLED" ||
          err?.message?.includes("cancel")
        ) {
          console.log("[IAP] User cancelled purchase");
          return false;
        }

        setError(err?.message || "Purchase failed");
        Alert.alert(
          "Purchase Error",
          err?.message || "Something went wrong. Please try again."
        );
        return false;
      } finally {
        setPurchasing(false);
      }
    },
    [iapModule, iapAvailable]
  );

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    if (!iapModule || !iapAvailable) {
      Alert.alert("Not Available", "In-App Purchases are not available on this device.");
      return false;
    }

    setPurchasing(true);
    try {
      console.log("[IAP] Restoring purchases...");
      const purchases = await iapModule.getAvailablePurchases();

      if (purchases && purchases.length > 0) {
        console.log("[IAP] Found", purchases.length, "previous purchases");
        // Finish all restored transactions
        for (const purchase of purchases) {
          await iapModule.finishTransaction({
            purchase,
            isConsumable: false,
          });
        }
        return true;
      } else {
        Alert.alert("No Purchases Found", "No previous subscriptions found to restore.");
        return false;
      }
    } catch (err: any) {
      console.error("[IAP] Restore error:", err?.message);
      Alert.alert("Restore Error", err?.message || "Failed to restore purchases.");
      return false;
    } finally {
      setPurchasing(false);
    }
  }, [iapModule, iapAvailable]);

  return {
    isIOS,
    iapAvailable,
    products,
    loading,
    purchasing,
    error,
    purchaseProduct,
    restorePurchases,
  };
}
