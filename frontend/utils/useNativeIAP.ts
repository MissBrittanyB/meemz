/**
 * Default stub - IAP not available on web/SSR
 * Native implementation is in useNativeIAP.native.ts
 */
export const PLAN_TO_PRODUCT: Record<string, string> = {
  weekly: "meemz_weekly",
  monthly: "meemz_Monthly",
  yearly: "memo_Yearly",
};

export function useNativeIAP() {
  return {
    isIOS: false,
    available: false,
    products: [] as any[],
    loading: false,
    purchasing: false,
    purchase: async (_productId: string) => false,
    restore: async () => false,
  };
}
