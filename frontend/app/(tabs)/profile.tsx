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
  Dimensions,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as ImagePicker from "expo-image-picker";
import GradientText from "../../utils/GradientText";

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
  profile_image: string | null;
  social_links: {
    instagram?: string;
    twitter?: string;
    tiktok?: string;
  } | null;
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

  // Edit profile states
  const [isEditing, setIsEditing] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editTwitter, setEditTwitter] = useState("");
  const [editTiktok, setEditTiktok] = useState("");
  const [saving, setSaving] = useState(false);

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
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setUser(response.data);
      setIsLoggedIn(true);
      fetchMyMemes(authToken, response.data);
    } catch (e) {
      console.error("Fetch user error:", e);
      await logout();
    }
  };

  const fetchMyMemes = async (authToken: string, userData?: User) => {
    try {
      const u = userData || user;
      if (!u?.username) return;
      const response = await axios.get(
        `${API_URL}/api/users/${u.username}/memes`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      setMyMemes(response.data);
    } catch (e) {
      console.error("Fetch meemz error:", e);
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
        password,
      });
      const { access_token, user: userData } = response.data;
      await AsyncStorage.setItem("memevault_token", access_token);
      setToken(access_token);
      setUser(userData);
      setIsLoggedIn(true);
      setEmail("");
      setPassword("");
    } catch (error: any) {
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
        username: username.toLowerCase(),
      });
      const { access_token, user: userData } = response.data;
      await AsyncStorage.setItem("memevault_token", access_token);
      setToken(access_token);
      setUser(userData);
      setIsLoggedIn(true);
      setEmail("");
      setPassword("");
      setUsername("");
      if (Platform.OS !== "web") {
        Alert.alert("Welcome!", "Your account has been created!");
      }
    } catch (error: any) {
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

  const pickProfileImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please grant photo library access");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      const mimeType = result.assets[0].mimeType || "image/jpeg";
      const imageData = `data:${mimeType};base64,${result.assets[0].base64}`;
      try {
        await axios.put(
          `${API_URL}/api/auth/me`,
          { profile_image: imageData, avatar: imageData },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setUser((prev) =>
          prev
            ? { ...prev, profile_image: imageData, avatar: imageData }
            : prev
        );
        if (Platform.OS !== "web") {
          Alert.alert("Updated!", "Profile picture updated!");
        }
      } catch (error) {
        console.error("Upload profile image error:", error);
        Alert.alert("Error", "Failed to update profile picture");
      }
    }
  };

  const startEditing = () => {
    setEditBio(user?.bio || "");
    setEditInstagram(user?.social_links?.instagram || "");
    setEditTwitter(user?.social_links?.twitter || "");
    setEditTiktok(user?.social_links?.tiktok || "");
    setIsEditing(true);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await axios.put(
        `${API_URL}/api/auth/me`,
        {
          bio: editBio,
          social_links: {
            instagram: editInstagram.trim(),
            twitter: editTwitter.trim(),
            tiktok: editTiktok.trim(),
          },
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setUser((prev) =>
        prev
          ? {
              ...prev,
              bio: editBio,
              social_links: {
                instagram: editInstagram.trim(),
                twitter: editTwitter.trim(),
                tiktok: editTiktok.trim(),
              },
            }
          : prev
      );
      setIsEditing(false);
      if (Platform.OS !== "web") {
        Alert.alert("Saved!", "Profile updated!");
      }
    } catch (error) {
      console.error("Save profile error:", error);
      Alert.alert("Error", "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const openSocialLink = (platform: string, handle: string) => {
    if (!handle) return;
    let url = "";
    const cleanHandle = handle.replace("@", "");
    if (platform === "instagram") url = `https://instagram.com/${cleanHandle}`;
    else if (platform === "twitter") url = `https://x.com/${cleanHandle}`;
    else if (platform === "tiktok") url = `https://tiktok.com/@${cleanHandle}`;
    if (url) Linking.openURL(url);
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
              <GradientText text="meemz" style={styles.authLogo} />
              <Text style={styles.authTitle}>
                {authMode === "login" ? "Welcome Back" : "Join meemz"}
              </Text>
              <Text style={styles.authSubtitle}>
                {authMode === "login"
                  ? "Sign in to access your meemz"
                  : "Create an account to share meemz"}
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
              style={[
                styles.authButton,
                authLoading && styles.authButtonDisabled,
              ]}
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
          {/* Profile Picture */}
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={pickProfileImage}
            activeOpacity={0.7}
          >
            {user?.profile_image || user?.avatar ? (
              <Image
                source={{ uri: user.profile_image || user.avatar || "" }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user?.username?.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.cameraIcon}>
              <Ionicons name="camera" size={14} color="#fff" />
            </View>
          </TouchableOpacity>

          <Text style={styles.displayName}>
            {user?.display_name || user?.username}
          </Text>
          <Text style={styles.usernameText}>@{user?.username}</Text>

          {user?.bio && !isEditing && (
            <Text style={styles.bio}>{user.bio}</Text>
          )}

          {/* Social Links */}
          {!isEditing && user?.social_links && (
            <View style={styles.socialRow}>
              {user.social_links.instagram ? (
                <TouchableOpacity
                  style={styles.socialButton}
                  onPress={() =>
                    openSocialLink("instagram", user.social_links!.instagram!)
                  }
                >
                  <Ionicons name="logo-instagram" size={18} color="#E1306C" />
                  <Text style={styles.socialHandle}>
                    @{user.social_links.instagram.replace("@", "")}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {user.social_links.twitter ? (
                <TouchableOpacity
                  style={styles.socialButton}
                  onPress={() =>
                    openSocialLink("twitter", user.social_links!.twitter!)
                  }
                >
                  <Ionicons name="logo-twitter" size={18} color="#1DA1F2" />
                  <Text style={styles.socialHandle}>
                    @{user.social_links.twitter.replace("@", "")}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {user.social_links.tiktok ? (
                <TouchableOpacity
                  style={styles.socialButton}
                  onPress={() =>
                    openSocialLink("tiktok", user.social_links!.tiktok!)
                  }
                >
                  <Ionicons name="musical-notes" size={18} color="#FF004F" />
                  <Text style={styles.socialHandle}>
                    @{user.social_links.tiktok.replace("@", "")}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{myMemes.length}</Text>
              <Text style={styles.statLabel}>Meemz</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{user?.meme_count || 0}</Text>
              <Text style={styles.statLabel}>Uploads</Text>
            </View>
          </View>

          {/* Action Buttons */}
          {!isEditing ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={startEditing}
              >
                <Ionicons name="pencil" size={18} color="#fff" />
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.logoutButton} onPress={logout}>
                <Ionicons name="log-out-outline" size={20} color="#E74C3C" />
              </TouchableOpacity>
            </View>
          ) : (
            /* Edit Form */
            <View style={styles.editForm}>
              <View style={styles.editField}>
                <Text style={styles.editLabel}>Bio</Text>
                <TextInput
                  style={styles.editInput}
                  placeholder="Tell us about yourself..."
                  placeholderTextColor="#666"
                  value={editBio}
                  onChangeText={setEditBio}
                  multiline
                  maxLength={150}
                />
              </View>
              <View style={styles.editField}>
                <Text style={styles.editLabel}>Instagram</Text>
                <View style={styles.socialInputRow}>
                  <Ionicons
                    name="logo-instagram"
                    size={18}
                    color="#E1306C"
                  />
                  <TextInput
                    style={styles.socialInput}
                    placeholder="username"
                    placeholderTextColor="#666"
                    value={editInstagram}
                    onChangeText={setEditInstagram}
                    autoCapitalize="none"
                  />
                </View>
              </View>
              <View style={styles.editField}>
                <Text style={styles.editLabel}>X / Twitter</Text>
                <View style={styles.socialInputRow}>
                  <Ionicons name="logo-twitter" size={18} color="#1DA1F2" />
                  <TextInput
                    style={styles.socialInput}
                    placeholder="username"
                    placeholderTextColor="#666"
                    value={editTwitter}
                    onChangeText={setEditTwitter}
                    autoCapitalize="none"
                  />
                </View>
              </View>
              <View style={styles.editField}>
                <Text style={styles.editLabel}>TikTok</Text>
                <View style={styles.socialInputRow}>
                  <Ionicons
                    name="musical-notes"
                    size={18}
                    color="#FF004F"
                  />
                  <TextInput
                    style={styles.socialInput}
                    placeholder="username"
                    placeholderTextColor="#666"
                    value={editTiktok}
                    onChangeText={setEditTiktok}
                    autoCapitalize="none"
                  />
                </View>
              </View>
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setIsEditing(false)}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    saving && styles.authButtonDisabled,
                  ]}
                  onPress={saveProfile}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* My Meemz Section */}
        <View style={styles.memesSection}>
          <Text style={styles.sectionTitle}>My Meemz</Text>
          {myMemes.length === 0 ? (
            <View style={styles.emptyMemes}>
              <Ionicons name="images-outline" size={60} color="#1E1E24" />
              <Text style={styles.emptyText}>No meemz uploaded yet</Text>
              <Text style={styles.emptySubtext}>
                Go to Upload to add your first meemz!
              </Text>
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
  authLogo: {
    fontSize: 42,
    fontWeight: "bold",
  },
  authTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#EAEAF0",
    marginTop: 12,
  },
  authSubtitle: {
    fontSize: 15,
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
    color: "#EAEAF0",
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
    position: "relative",
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "#FF7A1A",
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
  cameraIcon: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "#FF7A1A",
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#0B0B0F",
  },
  displayName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#EAEAF0",
  },
  usernameText: {
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
    lineHeight: 20,
  },
  socialRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
    gap: 10,
    justifyContent: "center",
  },
  socialButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#15151A",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  socialHandle: {
    color: "#EAEAF0",
    fontSize: 12,
    fontWeight: "500",
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
    color: "#EAEAF0",
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
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF7A1A",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  editButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  logoutButton: {
    backgroundColor: "rgba(231, 76, 60, 0.1)",
    padding: 12,
    borderRadius: 8,
  },
  // Edit form
  editForm: {
    width: "100%",
    marginTop: 20,
    paddingHorizontal: 8,
  },
  editField: {
    marginBottom: 14,
  },
  editLabel: {
    color: "#888",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  editInput: {
    backgroundColor: "#15151A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#1E1E24",
    minHeight: 50,
  },
  socialInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#15151A",
    borderRadius: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#1E1E24",
    gap: 10,
  },
  socialInput: {
    flex: 1,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 15,
  },
  editActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#15151A",
    borderWidth: 1,
    borderColor: "#1E1E24",
  },
  cancelText: {
    color: "#888",
    fontWeight: "600",
    fontSize: 15,
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#FF7A1A",
  },
  saveText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
  },
  // Meemz section
  memesSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#EAEAF0",
    marginBottom: 16,
  },
  emptyMemes: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    color: "#EAEAF0",
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
