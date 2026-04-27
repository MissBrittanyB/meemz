import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const TERMS_ACCEPTED_KEY = "meemz_terms_accepted";

interface EULAGateProps {
  children: React.ReactNode;
}

export default function EULAGate({ children }: EULAGateProps) {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    checkAcceptance();
  }, []);

  const checkAcceptance = async () => {
    const val = await AsyncStorage.getItem(TERMS_ACCEPTED_KEY);
    setAccepted(val === "true");
  };

  const handleAccept = async () => {
    await AsyncStorage.setItem(TERMS_ACCEPTED_KEY, "true");
    // Also notify backend if logged in
    try {
      const token = await AsyncStorage.getItem("memevault_token");
      if (token) {
        fetch(`${API_URL}/api/auth/accept-terms`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    } catch {}
    setAccepted(true);
  };

  const handleDecline = () => {
    Alert.alert(
      "Terms Required",
      "You must accept the Terms of Use to use meemz. The app contains user-generated content and these terms protect you and the community.",
      [{ text: "OK" }]
    );
  };

  // Still loading
  if (accepted === null) return null;

  // Already accepted
  if (accepted) return <>{children}</>;

  // Show EULA screen
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <LinearGradient
            colors={["#FF7A1A", "#FF5A8A", "#8B5CFF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconCircle}
          >
            <Ionicons name="shield-checkmark" size={36} color="#fff" />
          </LinearGradient>
          <Text style={styles.title}>Welcome to meemz</Text>
          <Text style={styles.subtitle}>
            Before you start, please review and accept our community guidelines and terms.
          </Text>
        </View>

        <View style={styles.termsBox}>
          <Text style={styles.termsTitle}>Community Guidelines</Text>
          <Text style={styles.termsText}>
            By using meemz, you agree to the following:
          </Text>

          <View style={styles.termItem}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.termText}>
              No objectionable, offensive, or harmful content
            </Text>
          </View>
          <View style={styles.termItem}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.termText}>
              No harassment, bullying, or hate speech
            </Text>
          </View>
          <View style={styles.termItem}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.termText}>
              No copyrighted content without permission
            </Text>
          </View>
          <View style={styles.termItem}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.termText}>
              No spam, scams, or misleading content
            </Text>
          </View>
          <View style={styles.termItem}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.termText}>
              Report objectionable content when you see it
            </Text>
          </View>

          <Text style={[styles.termsText, { marginTop: 16 }]}>
            Violations will result in content removal and account suspension within 24 hours. You can report content and block users at any time.
          </Text>
        </View>

        <View style={styles.linksRow}>
          <TouchableOpacity
            onPress={() => WebBrowser.openBrowserAsync("https://meemzai.com/privacy")}
          >
            <Text style={styles.linkText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.linkSeparator}>|</Text>
          <TouchableOpacity
            onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/api/terms-of-service`)}
          >
            <Text style={styles.linkText}>Terms of Use</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.acceptButton} onPress={handleAccept} activeOpacity={0.8}>
          <LinearGradient
            colors={["#FF7A1A", "#FF5A8A"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.acceptGradient}
          >
            <Text style={styles.acceptText}>I Agree to the Terms of Use</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.declineButton} onPress={handleDecline}>
          <Text style={styles.declineText}>Decline</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0B0F",
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 60,
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#EAEAF0",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#888",
    textAlign: "center",
    lineHeight: 22,
  },
  termsBox: {
    backgroundColor: "#15151A",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  termsTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#EAEAF0",
    marginBottom: 12,
  },
  termsText: {
    fontSize: 14,
    color: "#999",
    lineHeight: 20,
    marginBottom: 16,
  },
  termItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
    paddingRight: 16,
  },
  termText: {
    flex: 1,
    fontSize: 14,
    color: "#EAEAF0",
    lineHeight: 20,
  },
  linksRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    marginBottom: 24,
  },
  linkText: {
    color: "#FF7A1A",
    fontSize: 14,
    textDecorationLine: "underline",
  },
  linkSeparator: {
    color: "#444",
    fontSize: 14,
  },
  acceptButton: {
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 12,
  },
  acceptGradient: {
    paddingVertical: 18,
    alignItems: "center",
  },
  acceptText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  declineButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  declineText: {
    color: "#666",
    fontSize: 15,
  },
});
