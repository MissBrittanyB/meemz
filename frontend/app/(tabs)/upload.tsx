import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

// Lazy-load FileSystem for video uploads
let FileSystemLegacy: any = null;
async function getFileSystem() {
  if (!FileSystemLegacy) {
    try {
      FileSystemLegacy = require("expo-file-system/legacy");
    } catch (e) {
      console.warn("expo-file-system/legacy not available");
      FileSystemLegacy = require("expo-file-system");
    }
  }
  return FileSystemLegacy;
}

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

// Admin password for non-logged-in admin uploads
const ADMIN_PASSWORD = "Marchelle7!";

interface Category {
  id: string;
  name: string;
  icon: string;
  meme_count: number;
}

export default function UploadScreen() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  
  // Admin auth
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  
  // Upload form
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>("image");
  const [memeName, setMemeName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    checkAuth();
    fetchCategories();
  }, []);

  const checkAuth = async () => {
    try {
      // Check if logged in as user
      const storedToken = await AsyncStorage.getItem("memevault_token");
      if (storedToken) {
        setToken(storedToken);
        setIsLoggedIn(true);
        return;
      }
      
      // Check if admin authenticated
      const savedAdmin = await AsyncStorage.getItem("memevault_admin_auth");
      if (savedAdmin === "true") {
        setIsAdmin(true);
      }
    } catch (e) {
      console.error("Error checking auth:", e);
    }
  };

  const handleAdminLogin = async () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAdmin(true);
      setPasswordError(false);
      try {
        await AsyncStorage.setItem("memevault_admin_auth", "true");
      } catch (e) {
        console.error("Error saving auth:", e);
      }
    } else {
      setPasswordError(true);
      setPasswordInput("");
    }
  };

  const handleAdminLogout = async () => {
    setIsAdmin(false);
    try {
      await AsyncStorage.removeItem("memevault_admin_auth");
    } catch (e) {
      console.error("Error removing auth:", e);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/categories`);
      setCategories(response.data);
      if (response.data.length > 0) {
        setSelectedCategory(response.data[0].name);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      if (Platform.OS === "web") {
        window.alert("Please grant permission to access your photos");
      } else {
        Alert.alert("Permission Required", "Please grant permission to access your photos");
      }
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.8,
      base64: true,
      videoMaxDuration: 60,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const mimeType = asset.mimeType || "image/jpeg";
      
      // Detect media type
      if (asset.type === "video" || mimeType.startsWith("video/")) {
        setMediaType("video");
      } else if (mimeType === "image/gif") {
        setMediaType("gif");
      } else {
        setMediaType("image");
      }

      if (asset.base64) {
        setSelectedImage(`data:${mimeType};base64,${asset.base64}`);
      } else if (asset.uri) {
        // For videos, read file to base64
        try {
          const FS = await getFileSystem();
          const fileData = await FS.readAsStringAsync(asset.uri, {
            encoding: FS.EncodingType.Base64,
          });
          setSelectedImage(`data:${mimeType};base64,${fileData}`);
        } catch (e) {
          console.error("Error reading file:", e);
          // Fallback: use URI directly
          setSelectedImage(asset.uri);
        }
      }
    }
  };

  const uploadMeme = async () => {
    if (!selectedImage) {
      if (Platform.OS === "web") {
        window.alert("Please select an image, GIF, or video");
      } else {
        Alert.alert("Error", "Please select an image, GIF, or video");
      }
      return;
    }

    if (!memeName.trim()) {
      if (Platform.OS === "web") {
        window.alert("Please enter a name for the meme");
      } else {
        Alert.alert("Error", "Please enter a name for the meme");
      }
      return;
    }

    setUploading(true);

    try {
      const tagsArray = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const headers: any = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      await axios.post(
        `${API_URL}/api/memes`,
        {
          name: memeName.trim(),
          image_base64: selectedImage,
          category: selectedCategory,
          tags: tagsArray,
          is_public: isPublic,
          media_type: mediaType,
        },
        { headers }
      );

      if (Platform.OS === "web") {
        window.alert("Meemz uploaded successfully! 🎉");
      } else {
        Alert.alert("Success!", "Meemz uploaded successfully! 🎉");
      }
      
      // Reset form
      setSelectedImage(null);
      setMemeName("");
      setTags("");
      setIsPublic(true);
      setMediaType("image");
    } catch (error) {
      console.error("Error uploading meme:", error);
      if (Platform.OS === "web") {
        window.alert("Failed to upload meemz. Please try again.");
      } else {
        Alert.alert("Error", "Failed to upload meemz. Please try again.");
      }
    } finally {
      setUploading(false);
    }
  };

  // Not logged in and not admin - show login options
  if (!isLoggedIn && !isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.loginContainer}>
          <View style={styles.lockIconContainer}>
            <Ionicons name="cloud-upload" size={60} color="#FF7A1A" />
          </View>
          <Text style={styles.loginTitle}>Upload Meemzs</Text>
          <Text style={styles.loginSubtitle}>
            Sign in to upload meemz to your profile, or use admin access for global uploads
          </Text>

          <TouchableOpacity
            style={styles.signInButton}
            onPress={() => {
              // Navigate to profile tab for login
              if (Platform.OS === "web") {
                window.alert("Go to Profile tab to sign in or create an account");
              } else {
                Alert.alert("Sign In", "Go to the Profile tab to sign in or create an account");
              }
            }}
          >
            <Ionicons name="person" size={24} color="#fff" />
            <Text style={styles.signInButtonText}>Sign In / Create Account</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.adminLabel}>Admin Access</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Enter admin password"
              placeholderTextColor="#666"
              value={passwordInput}
              onChangeText={(text) => {
                setPasswordInput(text);
                setPasswordError(false);
              }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
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

          {passwordError && (
            <Text style={styles.errorText}>Incorrect password. Try again.</Text>
          )}

          <TouchableOpacity
            style={[styles.adminButton, !passwordInput && styles.buttonDisabled]}
            onPress={handleAdminLogin}
            disabled={!passwordInput}
          >
            <Ionicons name="key" size={20} color="#fff" />
            <Text style={styles.adminButtonText}>Admin Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Upload screen (authenticated)
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>Upload</Text>
                <Text style={styles.subtitle}>
                  {isLoggedIn ? "Add memes to your profile 📤" : "Admin upload 📤"}
                </Text>
              </View>
              {isAdmin && !isLoggedIn && (
                <TouchableOpacity
                  style={styles.logoutButton}
                  onPress={handleAdminLogout}
                >
                  <Ionicons name="log-out-outline" size={24} color="#E74C3C" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Image Picker */}
          <TouchableOpacity
            style={styles.imagePicker}
            onPress={pickImage}
            activeOpacity={0.8}
          >
            {selectedImage ? (
              <Image
                source={{ uri: selectedImage }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.placeholderContent}>
                <Ionicons name="image-outline" size={60} color="#666" />
                <Text style={styles.placeholderText}>Tap to select media, GIF, or video</Text>
              </View>
            )}
            {selectedImage && (
              <TouchableOpacity
                style={styles.changeImageButton}
                onPress={pickImage}
              >
                <Ionicons name="camera" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          {/* Meme Name Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Meme Name</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter a name for this meme"
              placeholderTextColor="#666"
              value={memeName}
              onChangeText={setMemeName}
            />
          </View>

          {/* Category Selection */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoriesScroll}
            >
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryChip,
                    selectedCategory === cat.name && styles.categoryChipSelected,
                  ]}
                  onPress={() => setSelectedCategory(cat.name)}
                >
                  <Text style={styles.categoryEmoji}>{cat.icon}</Text>
                  <Text
                    style={[
                      styles.categoryChipText,
                      selectedCategory === cat.name && styles.categoryChipTextSelected,
                    ]}
                  >
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Tags Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Tags (optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter tags separated by commas"
              placeholderTextColor="#666"
              value={tags}
              onChangeText={setTags}
            />
            <Text style={styles.inputHint}>e.g. funny, relatable, mood</Text>
          </View>

          {/* Public/Private Toggle */}
          {isLoggedIn && (
            <View style={styles.toggleContainer}>
              <View style={styles.toggleInfo}>
                <Ionicons 
                  name={isPublic ? "globe" : "lock-closed"} 
                  size={24} 
                  color={isPublic ? "#27AE60" : "#F39C12"} 
                />
                <View style={styles.toggleText}>
                  <Text style={styles.toggleLabel}>
                    {isPublic ? "Public" : "Private"}
                  </Text>
                  <Text style={styles.toggleHint}>
                    {isPublic 
                      ? "Everyone can see this meme" 
                      : "Only visible via your shared link"}
                  </Text>
                </View>
              </View>
              <Switch
                value={isPublic}
                onValueChange={setIsPublic}
                trackColor={{ false: "#1E1E24", true: "#27AE60" }}
                thumbColor="#fff"
              />
            </View>
          )}

          {/* Upload Button */}
          <TouchableOpacity
            style={[
              styles.uploadButton,
              (!selectedImage || !memeName.trim() || uploading) && styles.buttonDisabled,
            ]}
            onPress={uploadMeme}
            disabled={!selectedImage || !memeName.trim() || uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={24} color="#fff" />
                <Text style={styles.uploadButtonText}>Upload Meemz</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0B0F",
  },
  // Login styles
  loginContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  lockIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 107, 53, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 8,
  },
  loginSubtitle: {
    fontSize: 16,
    color: "#888",
    marginBottom: 32,
    textAlign: "center",
  },
  signInButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF7A1A",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  signInButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#1E1E24",
  },
  dividerText: {
    color: "#666",
    paddingHorizontal: 16,
  },
  adminLabel: {
    color: "#888",
    fontSize: 14,
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#15151A",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E1E24",
    width: "100%",
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  eyeButton: {
    padding: 14,
  },
  errorText: {
    color: "#E74C3C",
    fontSize: 14,
    marginBottom: 16,
  },
  adminButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E1E24",
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  adminButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    backgroundColor: "#1E1E24",
    opacity: 0.6,
  },
  // Upload screen styles
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    marginTop: 4,
  },
  logoutButton: {
    padding: 8,
    backgroundColor: "rgba(231, 76, 60, 0.1)",
    borderRadius: 8,
  },
  imagePicker: {
    marginHorizontal: 16,
    height: 250,
    backgroundColor: "#15151A",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#1E1E24",
    borderStyle: "dashed",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderContent: {
    alignItems: "center",
  },
  placeholderText: {
    color: "#666",
    fontSize: 16,
    marginTop: 12,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  changeImageButton: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "#FF7A1A",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  inputContainer: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  inputLabel: {
    color: "#fff",
    fontSize: 16,
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
  inputHint: {
    color: "#666",
    fontSize: 12,
    marginTop: 6,
  },
  categoriesScroll: {
    marginTop: 4,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#15151A",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#1E1E24",
  },
  categoryChipSelected: {
    backgroundColor: "#FF7A1A",
    borderColor: "#FF7A1A",
  },
  categoryEmoji: {
    fontSize: 18,
    marginRight: 6,
  },
  categoryChipText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "500",
  },
  categoryChipTextSelected: {
    color: "#fff",
  },
  toggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#15151A",
    marginHorizontal: 16,
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E1E24",
  },
  toggleInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  toggleText: {
    marginLeft: 12,
  },
  toggleLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  toggleHint: {
    color: "#888",
    fontSize: 12,
    marginTop: 2,
  },
  uploadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF7A1A",
    marginHorizontal: 16,
    marginTop: 32,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  uploadButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});
