import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  FlatList,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width } = Dimensions.get("window");
const MEME_SIZE = (width - 48) / 3;

interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar: string | null;
  bio: string | null;
  meme_count?: number;
}

interface Meme {
  id: string;
  name: string;
  image_base64: string;
  category: string;
  is_public: boolean;
}

export default function ProfileScreen() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [myMemes, setMyMemes] = useState<Meme[]>([]);
  
  // Auth form states
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem("memevault_token");
      if (storedToken) {
        setToken(storedToken);
        await fetchUser(storedToken);
      }
    } catch (e) {
      console.error("Auth check error:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUser = async (authToken: string) => {
    try {
      const response = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setUser(response.data);
      setIsLoggedIn(true);
      fetchMyMemes(authToken);
    } catch (e) {
      console.error("Fetch user error:", e);
      await logout();
    }
  };

  const fetchMyMemes = async (authToken: string) => {
    try {
      if (!user?.username) return;
      const response = await axios.get(`${API_URL}/api/users/${user.username}/memes`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      setMyMemes(response.data);
    } catch (e) {
      console.error("Fetch memes error:", e);
    }
  };

  useEffect(() => {
    if (user && token) {
      fetchMyMemes(token);
    }
  }, [user, token]);

  const handleLogin = async () => {
    if (!email || !password) {
      setAuthError("Please fill in all fields");
      return;
    }

    setAuthLoading(true);
    setAuthError("");

    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        email: email.toLowerCase(),
        password
      });

      const { access_token, user: userData } = response.data;
      
      await AsyncStorage.setItem("memevault_token", access_token);
      setToken(access_token);
      setUser(userData);
      setIsLoggedIn(true);
      
      // Clear form
      setEmail("");
      setPassword("");
    } catch (error: any) {
      console.error("Login error:", error);
      setAuthError(error.response?.data?.detail || "Login failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !password || !username) {
      setAuthError("Please fill in all fields");
      return;
    }

    if (username.length < 3) {
      setAuthError("Username must be at least 3 characters");
      return;
    }

    if (password.length < 6) {
      setAuthError("Password must be at least 6 characters");
      return;
    }

    setAuthLoading(true);
    setAuthError("");

    try {
      const response = await axios.post(`${API_URL}/api/auth/register`, {
        email: email.toLowerCase(),
        password,
        username: username.toLowerCase()
      });

      const { access_token, user: userData } = response.data;
      
      await AsyncStorage.setItem("memevault_token", access_token);
      setToken(access_token);
      setUser(userData);
      setIsLoggedIn(true);
      
      // Clear form
      setEmail("");
      setPassword("");
      setUsername("");
      
      if (Platform.OS !== "web") {
        Alert.alert("Welcome!", "Your account has been created! 🎉");
      }
    } catch (error: any) {
      console.error("Register error:", error);
      setAuthError(error.response?.data?.detail || "Registration failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem("memevault_token");
    setToken(null);
    setUser(null);
    setIsLoggedIn(false);
    setMyMemes([]);
  };

  const copyProfileLink = () => {
    const link = `memevault.app/${user?.username}`;
    if (Platform.OS === "web") {
      navigator.clipboard?.writeText(link);
      window.alert(`Profile link copied: ${link}`);
    } else {
      Alert.alert("Profile Link", `Share your profile: ${link}`);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF7A1A" />
        </View>
      </SafeAreaView>
    );
  }

  // Logged out - show auth form
  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardAvoid}
        >
          <ScrollView contentContainerStyle={styles.authContainer}>
            <View style={styles.authHeader}>
              <Ionicons name="person-circle" size={80} color="#FF7A1A" />
              <Text style={styles.authTitle}>
                {authMode === "login" ? "Welcome Back" : "Join meemz"}
              </Text>
              <Text style={styles.authSubtitle}>
                {authMode === "login" 
                  ? "Sign in to access your meemz" 
                  : "Create an account to upload & share meemzs"}
              </Text>
            </View>

            {authError ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={20} color="#E74C3C" />
                <Text style={styles.errorText}>{authError}</Text>
              </View>
            ) : null}

            {authMode === "register" && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Username</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Choose a username"
                  placeholderTextColor="#666"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
              </View>
            )}

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter your email"
                placeholderTextColor="#666"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Enter your password"
                  placeholderTextColor="#666"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons
                    name={showPassword ? "eye-off" : "eye"}
                    size={24}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.authButton, authLoading && styles.authButtonDisabled]}
              onPress={authMode === "login" ? handleLogin : handleRegister}
              disabled={authLoading}
            >
              {authLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.authButtonText}>
                  {authMode === "login" ? "Sign In" : "Create Account"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchAuthMode}
              onPress={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
            >
              <Text style={styles.switchAuthText}>
                {authMode === "login" 
                  ? "Don't have an account? Sign Up" 
                  : "Already have an account? Sign In"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Logged in - show profile
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user?.username?.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          
          <Text style={styles.displayName}>{user?.display_name || user?.username}</Text>
          <Text style={styles.username}>@{user?.username}</Text>
          
          {user?.bio && <Text style={styles.bio}>{user.bio}</Text>}

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{myMemes.length}</Text>
              <Text style={styles.statLabel}>Memes</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{user?.meme_count || 0}</Text>
              <Text style={styles.statLabel}>Uploads</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.shareButton} onPress={copyProfileLink}>
              <Ionicons name="link" size={20} color="#fff" />
              <Text style={styles.shareButtonText}>Share Profile</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.logoutButton} onPress={logout}>
              <Ionicons name="log-out-outline" size={20} color="#E74C3C" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.memesSection}>
          <Text style={styles.sectionTitle}>My Memes</Text>
          
          {myMemes.length === 0 ? (
            <View style={styles.emptyMemes}>
              <Ionicons name="images-outline" size={60} color="#1E1E24" />
              <Text style={styles.emptyText}>No memes uploaded yet</Text>
              <Text style={styles.emptySubtext}>Go to Upload to add your first meme!</Text>
            </View>
          ) : (
            <View style={styles.memesGrid}>
              {myMemes.map((meme) => (
                <View key={meme.id} style={styles.memeItem}>
                  <Image
                    source={{ uri: meme.image_base64 }}
                    style={styles.memeImage}
                    resizeMode="cover"
                  />
                  {!meme.is_public && (
                    <View style={styles.privateIndicator}>
                      <Ionicons name="lock-closed" size={12} color="#fff" />
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0B0F",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardAvoid: {
    flex: 1,
  },
  // Auth styles
  authContainer: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  authHeader: {
    alignItems: "center",
    marginBottom: 32,
  },
  authTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginTop: 16,
  },
  authSubtitle: {
    fontSize: 16,
    color: "#888",
    marginTop: 8,
    textAlign: "center",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(231, 76, 60, 0.1)",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: "#E74C3C",
    marginLeft: 8,
    flex: 1,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: "#15151A",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#1E1E24",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#15151A",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E1E24",
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 16,
  },
  eyeButton: {
    padding: 14,
  },
  authButton: {
    backgroundColor: "#FF7A1A",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  authButtonDisabled: {
    backgroundColor: "#666",
  },
  authButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  switchAuthMode: {
    marginTop: 24,
    alignItems: "center",
  },
  switchAuthText: {
    color: "#FF7A1A",
    fontSize: 16,
  },
  // Profile styles
  profileHeader: {
    alignItems: "center",
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#15151A",
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#FF7A1A",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 40,
    fontWeight: "bold",
    color: "#fff",
  },
  displayName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
  },
  username: {
    fontSize: 16,
    color: "#888",
    marginTop: 4,
  },
  bio: {
    fontSize: 14,
    color: "#ccc",
    marginTop: 12,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  statsRow: {
    flexDirection: "row",
    marginTop: 20,
    gap: 40,
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
  },
  statLabel: {
    fontSize: 14,
    color: "#888",
  },
  actionRow: {
    flexDirection: "row",
    marginTop: 20,
    gap: 12,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF7A1A",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  shareButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  logoutButton: {
    backgroundColor: "rgba(231, 76, 60, 0.1)",
    padding: 12,
    borderRadius: 8,
  },
  // Memes section
  memesSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 16,
  },
  emptyMemes: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
  },
  emptySubtext: {
    color: "#666",
    fontSize: 14,
    marginTop: 8,
  },
  memesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },
  memeItem: {
    width: MEME_SIZE,
    height: MEME_SIZE,
    margin: 4,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#15151A",
  },
  memeImage: {
    width: "100%",
    height: "100%",
  },
  privateIndicator: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 10,
    padding: 4,
  },
});
