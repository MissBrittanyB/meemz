import { AppEventsLogger, Settings } from "react-native-fbsdk-next";

const PLAN_PRICES_USD: Record<string, number> = {
  weekly: 2.99,
  monthly: 6.99,
  yearly: 39.99,
};

type EventParameters = Record<string, string | number>;

function safelyLog(action: () => void, eventName: string): void {
  try {
    action();
  } catch (error) {
    console.warn(`[Meta App Events] Could not log ${eventName}`, error);
  }
}

export function initializeMetaAppEvents(): void {
  safelyLog(() => {
    Settings.initializeSDK();
  }, "SDK initialization");
}

export function logMetaRegistration(): void {
  safelyLog(
    () =>
      AppEventsLogger.logEvent(AppEventsLogger.AppEvents.CompletedRegistration, {
        [AppEventsLogger.AppEventParams.RegistrationMethod]: "email",
      }),
    "completed registration"
  );
}

export function logMetaMemeSaved(memeId: string, mediaType?: string): void {
  safelyLog(
    () =>
      AppEventsLogger.logEvent("meemz_meme_saved", {
        [AppEventsLogger.AppEventParams.ContentID]: memeId,
        [AppEventsLogger.AppEventParams.ContentType]: mediaType || "image",
      }),
    "meme saved"
  );
}

export function logMetaMemeShared(memeId: string, mediaType?: string): void {
  safelyLog(
    () =>
      AppEventsLogger.logEvent("meemz_meme_shared", {
        [AppEventsLogger.AppEventParams.ContentID]: memeId,
        [AppEventsLogger.AppEventParams.ContentType]: mediaType || "image",
      }),
    "meme shared"
  );
}

export function logMetaSubscriptionPurchase(planId: string): void {
  const price = PLAN_PRICES_USD[planId];
  const parameters: EventParameters = {
    [AppEventsLogger.AppEventParams.Currency]: "USD",
    [AppEventsLogger.AppEventParams.ContentType]: "subscription",
    [AppEventsLogger.AppEventParams.ContentID]: planId,
  };

  safelyLog(
    () =>
      AppEventsLogger.logEvent(
        AppEventsLogger.AppEvents.Subscribe,
        price,
        parameters
      ),
    "subscription"
  );

  if (price) {
    safelyLog(
      () => AppEventsLogger.logPurchase(price, "USD", parameters),
      "purchase"
    );
  }
}
