import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";

/**
 * Checks if the user is authenticated.
 * If not, shows an alert prompting sign-up and returns false.
 * If yes, returns true so the action can proceed.
 */
export async function requireAuth(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem("memevault_token");
    console.log("[authGate] Token check:", token ? "HAS TOKEN" : "NO TOKEN");
    if (token) return true;

    if (Platform.OS === "web") {
      const shouldSignUp = window.confirm(
        "Sign up to share, copy, and save meemz! Go to sign up?"
      );
      if (shouldSignUp) {
        router.push("/(tabs)/profile");
      }
    } else {
      Alert.alert(
        "Sign Up Required",
        "Create a free account to share, copy, and save meemz!",
        [
          { text: "Later", style: "cancel" },
          {
            text: "Sign Up",
            onPress: () => router.push("/(tabs)/profile"),
          },
        ]
      );
    }
    return false;
  } catch (e: any) {
    console.error("[authGate] Error checking auth:", e?.message || e);
    return false;
  }
}
