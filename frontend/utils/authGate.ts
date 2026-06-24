import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";

/**
 * Auth check for non-account-specific actions (share / copy / save).
 *
 * Per Apple App Store Review Guideline 5.1.1, an app cannot require users
 * to register before accessing content or features that are NOT tied to a
 * specific user account.
 *
 * Share, copy, and save-to-device are device-local actions that don't
 * persist per-user data, so they must always be allowed for anonymous users.
 *
 * This function ALWAYS returns true. It is kept as a function (rather than
 * removed) so the dozens of existing call sites keep working without
 * touching every file. If you want to gate a truly account-specific
 * feature, use `requireAccountAuth()` below instead.
 */
export async function requireAuth(): Promise<boolean> {
  return true;
}

/**
 * Auth check for legitimately account-specific actions (upload to your
 * profile, follow users, edit your own profile, etc.). Per Apple 5.1.1,
 * account creation IS allowed to be required for these features because
 * they are tied to a specific user.
 *
 * Returns true if a token exists. Otherwise prompts the user to sign up
 * (optionally) and returns false.
 */
export async function requireAccountAuth(
  featureName: string = "this feature"
): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem("memevault_token");
    if (token) return true;

    if (Platform.OS === "web") {
      const ok = window.confirm(
        `Create a free account to ${featureName}. Go to sign up?`
      );
      if (ok) router.push("/(tabs)/profile");
    } else {
      Alert.alert(
        "Optional Account",
        `Create a free account to ${featureName}.`,
        [
          { text: "Later", style: "cancel" },
          { text: "Sign Up", onPress: () => router.push("/(tabs)/profile") },
        ]
      );
    }
    return false;
  } catch {
    return false;
  }
}
