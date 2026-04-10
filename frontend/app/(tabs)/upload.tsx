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
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

// Admin password - change this to your desired password
const ADMIN_PASSWORD = "memevault2024";

interface Category {
  id: string;
  name: string;
  icon: string;
  meme_count: number;
}

export default function UploadScreen() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [memeName, setMemeName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [tags, setTags] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [uploading, setUploading] = useState(false);

  // Check if already authenticated
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const savedAuth = await AsyncStorage.getItem("memevault_admin_auth");
      if (savedAuth === "true") {
        setIsAuthenticated(true);
        fetchCategories();
      }
    } catch (e) {
      console.error("Error checking auth:", e);
    }
  };

  const handleLogin = async () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setPasswordError(false);
      try {
        await AsyncStorage.setItem("memevault_admin_auth", "true");
      } catch (e) {
        console.error("Error saving auth:", e);
      }
      fetchCategories();
    } else {
      setPasswordError(true);
      setPasswordInput("");
    }
  };

  const handleLogout = async () => {
    setIsAuthenticated(false);
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
        Alert.alert(
          "Permission Required",
          "Please grant permission to access your photos"
        );
      }
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      if (asset.base64) {
        const mimeType = asset.mimeType || "image/jpeg";
        setSelectedImage(`data:${mimeType};base64,${asset.base64}`);
      }
    }
  };

  const uploadMeme = async () => {
    if (!selectedImage) {
      if (Platform.OS === "web") {
        window.alert("Please select an image");
      } else {
        Alert.alert("Error", "Please select an image");
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

    if (!selectedCategory) {
      if (Platform.OS === "web") {
        window.alert("Please select a category");
      } else {
        Alert.alert("Error", "Please select a category");
      }
      return;
    }

    setUploading(true);

    try {
      const tagsArray = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      await axios.post(`${API_URL}/api/memes`, {
        name: memeName.trim(),
        image_base64: selectedImage,
        category: selectedCategory,
        tags: tagsArray,
      });

      if (Platform.OS === "web") {
        window.alert("Meme uploaded successfully! 🎉");
        setSelectedImage(null);
        setMemeName("");
        setTags("");
      } else {
        Alert.alert("Success!", "Meme uploaded successfully! 🎉", [
          {
            text: "Upload Another",
            onPress: () => {
              setSelectedImage(null);
              setMemeName("");
              setTags("");
            },
          },
        ]);
      }
    } catch (error) {
      console.error("Error uploading meme:", error);
      if (Platform.OS === "web") {
        window.alert("Failed to upload meme. Please try again.");
      } else {
        Alert.alert("Error", "Failed to upload meme. Please try again.");
      }
    } finally {
      setUploading(false);
    }
  };

  // Login Screen
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.loginContainer}>
          <View style={styles.lockIconContainer}>
            <Ionicons name="lock-closed" size={60} color="#FF6B35" />
          </View>
          <Text style={styles.loginTitle}>Admin Access</Text>
          <Text style={styles.loginSubtitle}>
            Enter password to upload memes
          </Text>

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
            style={[
              styles.loginButton,
              !passwordInput && styles.loginButtonDisabled,
            ]}
            onPress={handleLogin}
            disabled={!passwordInput}
          >
            <Ionicons name="log-in" size={24} color="#fff" />
            <Text style={styles.loginButtonText}>Access Upload</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Upload Screen (authenticated)
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
                <Text style={styles.subtitle}>Add memes to your vault 📤</Text>
              </View>
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleLogout}
              >
                <Ionicons name="log-out-outline" size={24} color="#E74C3C" />
              </TouchableOpacity>
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
                <Text style={styles.placeholderText}>Tap to select image</Text>
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
                    selectedCategory === cat.name &&
                      styles.categoryChipSelected,
                  ]}
                  onPress={() => setSelectedCategory(cat.name)}
                >
                  <Text style={styles.categoryEmoji}>{cat.icon}</Text>
                  <Text
                    style={[
                      styles.categoryChipText,
                      selectedCategory === cat.name &&
                        styles.categoryChipTextSelected,
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

          {/* Upload Button */}
          <TouchableOpacity
            style={[
              styles.uploadButton,
              (!selectedImage || !memeName.trim() || uploading) &&
                styles.uploadButtonDisabled,
            ]}
            onPress={uploadMeme}
            disabled={!selectedImage || !memeName.trim() || uploading}
          >
            {uploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={24} color="#fff" />
                <Text style={styles.uploadButtonText}>Upload Meme</Text>
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
    backgroundColor: "#0A0A0A",
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
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
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
  loginButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF6B35",
    width: "100%",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  loginButtonDisabled: {
    backgroundColor: "#333",
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
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
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#333",
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
    backgroundColor: "#FF6B35",
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
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#333",
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
    backgroundColor: "#1A1A1A",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#333",
  },
  categoryChipSelected: {
    backgroundColor: "#FF6B35",
    borderColor: "#FF6B35",
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
  uploadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF6B35",
    marginHorizontal: 16,
    marginTop: 32,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  uploadButtonDisabled: {
    backgroundColor: "#333",
  },
  uploadButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
});
