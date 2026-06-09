/**
 * Native IAP hook for meemz (iOS) - react-native-iap v15.x
 *
 * IMPORTANT: react-native-iap v15 changed the API significantly. The old
 * `getSubscriptions` / `requestSubscription` functions no longer exist.
 * Use `fetchProducts` (with type: 'subs') and `requestPurchase`.
 *
 * Purchase results arrive asynchronously via `purchaseUpdatedListener`,
 * NOT from the requestPurchase promise (StoreKit 2 architecture).
 *
 * API reference (v15):
 *   - initConnection()
 *   - fetchProducts({ skus, type: 'subs' })
 *   - requestPurchase({ request: { ios: { sku }, android: { skus } }, type: 'subs' })
 *   - purchaseUpdatedListener / purchaseErrorListener
 *   - getAvailablePurchases() for restore
 *   - finishTransaction({ purchase, isConsumable: false })
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Platform, Alert } from "react-native";
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
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
  const pendingPurchaseResolveRef = useRef<((p: any) => void) | null>(null);
  const pendingPurchaseRejectRef = useRef<((e: any) => void) | null>(null);
  const updateSubRef = useRef<any>(null);
  const errorSubRef = useRef<any>(null);

  const isIOS = Platform.OS === "ios";

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
      try { updateSubRef.current?.remove(); } catch {}
      try { errorSubRef.current?.remove(); } catch {}
      try { endConnection(); } catch {}
      connectedRef.current = false;
    };
  }, []);

  const ensureConnection = async (): Promise<boolean> => {
    if (connectedRef.current) return true;
    try {
      const connected = await initConnection();
      connectedRef.current = !!connected;
      // Attach the global listeners only once after we connect
      if (connected && !updateSubRef.current) {
        updateSubRef.current = purchaseUpdatedListener(async (purchase: any) => {
          console.log("[IAP] purchaseUpdatedListener:", purchase?.productId || purchase?.id);
          try {
            await finishTransaction({ purchase, isConsumable: false });
          } catch (e) {
            console.log("[IAP] finishTransaction error:", e);
          }
          if (pendingPurchaseResolveRef.current) {
            pendingPurchaseResolveRef.current(purchase);
            pendingPurchaseResolveRef.current = null;
            pendingPurchaseRejectRef.current = null;
          }
        });
        errorSubRef.current = purchaseErrorListener((err: any) => {
          console.log("[IAP] purchaseErrorListener:", err?.code, err?.message);
          if (pendingPurchaseRejectRef.current) {
            pendingPurchaseRejectRef.current(err);
            pendingPurchaseResolveRef.current = null;
            pendingPurchaseRejectRef.current = null;
          }
        });
      }
      return !!connected;
    } catch (e: any) {
      console.log("[IAP] initConnection error:", e?.message);
      return false;
    }
  };

  // Fetch subscription products using v15 API with retry
  const doFetchProducts = async (attempts = 3): Promise<any[]> => {
    for (let i = 0; i < attempts; i++) {
      try {
        const result: any = await fetchProducts({ skus: IAP_SKUS, type: "subs" } as any);
        // v15 returns either an array directly, or an object with subscriptions/products
        let list: any[] = [];
        if (Array.isArray(result)) {
          list = result;
        } else if (result && typeof result === "object") {
          list = result.subscriptions || result.products || result.items || [];
        }
        console.log(`[IAP] fetchProducts attempt ${i + 1}: got ${list.length} items`);
        if (list.length > 0) return list;
      } catch (e: any) {
        console.log(`[IAP] fetchProducts attempt ${i + 1} error:`, e?.message);
      }
      if (i < attempts - 1) await sleep(800 * (i + 1));
    }
    return [];
  };

  const initIAP = async () => {
    try {
      const ok = await ensureConnection();
      if (!ok) {
        setAvailable(false);
        return;
      }
      const list = await doFetchProducts(3);
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

  const purchase = useCallback(async (productId: string): Promise<any | null> => {
    setPurchasing(true);
    try {
      const connected = await ensureConnection();
      if (!connected) {
        setPurchasing(false);
        Alert.alert(
          "App Store Unavailable",
          "Couldn't reach the App Store. Please check your internet connection, ensure you're signed in to the App Store, and try again."
        );
        return null;
      }

      // Refetch products if we don't have them
      let list = productsRef.current;
      if (!list || list.length === 0) {
        console.log("[IAP] Products empty at purchase time, refetching...");
        list = await doFetchProducts(3);
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
        return null;
      }

      const product = list.find((p: any) => p?.productId === productId || p?.id === productId);
      if (!product) {
        setPurchasing(false);
        Alert.alert(
          "Subscription Unavailable",
          "This subscription option isn't available right now. Please try a different plan or try again later."
        );
        return null;
      }

      // Set up a promise that will be resolved by the global listeners
      const purchasePromise = new Promise<any>((resolve, reject) => {
        pendingPurchaseResolveRef.current = resolve;
        pendingPurchaseRejectRef.current = reject;
      });

      // v15 API: requestPurchase with platform-namespaced sku
      try {
        await requestPurchase({
          request: {
            ios: { sku: productId },
            android: { skus: [productId] },
          },
          type: "subs",
        } as any);
      } catch (reqErr: any) {
        // requestPurchase itself can reject for user cancel before the listener fires
        pendingPurchaseResolveRef.current = null;
        pendingPurchaseRejectRef.current = null;
        setPurchasing(false);
        const msg = reqErr?.message || "";
        if (
          reqErr?.code === "E_USER_CANCELLED" ||
          reqErr?.code === "E_DEFERRED" ||
          msg.toLowerCase().includes("cancel") ||
          msg.toLowerCase().includes("dismiss")
        ) {
          return null;
        }
        console.log("[IAP] requestPurchase error:", reqErr?.code, msg);
        Alert.alert("Purchase Error", msg || "Could not complete purchase. Please try again.");
        return null;
      }

      // Wait for listener to fire (or timeout after 5 min for safety)
      const timeoutPromise = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("Purchase timeout")), 300_000)
      );

      try {
        const result = await Promise.race([purchasePromise, timeoutPromise]);
        setPurchasing(false);
        return result;
      } catch (listenerErr: any) {
        setPurchasing(false);
        const msg = listenerErr?.message || "";
        if (
          listenerErr?.code === "E_USER_CANCELLED" ||
          listenerErr?.code === "E_DEFERRED" ||
          msg.toLowerCase().includes("cancel") ||
          msg.toLowerCase().includes("dismiss")
        ) {
          return null;
        }
        console.log("[IAP] Purchase listener error:", listenerErr?.code, msg);
        Alert.alert("Purchase Error", msg || "Could not complete purchase.");
        return null;
      }
    } catch (e: any) {
      setPurchasing(false);
      console.log("[IAP] Outer purchase error:", e?.message);
      return null;
    }
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    setPurchasing(true);
    try {
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
