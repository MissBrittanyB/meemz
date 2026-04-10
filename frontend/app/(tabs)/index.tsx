import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
  Share,
  Platform,
  Dimensions,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import axios from "axios";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width } = Dimensions.get("window");
const MEME_SIZE = (width - 48) / 3;

// Generate a simple device ID
const getDeviceId = () => {
  const stored = "memevault_device_" + Math.random().toString(36).substring(7);
  return stored;
};

const DEVICE_ID = getDeviceId();

interface Meme {
  id: string;
  name: string;
  image_base64: string;
  category: string;
  tags: string[];
  use_count: number;
  created_at: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  meme_count: number;
}

export default function MemesScreen() {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);

  const fetchMemes = useCallback(async () => {
    try {
      const params: any = {};
      if (searchQuery) params.search = searchQuery;
      if (selectedCategory !== "All") params.category = selectedCategory;

      const response = await axios.get(`${API_URL}/api/memes`, { params });
      setMemes(response.data);
    } catch (error) {
      console.error("Error fetching memes:", error);
    }
  }, [searchQuery, selectedCategory]);

  const fetchCategories = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/categories`);
      setCategories(response.data);
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const fetchFavorites = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/user/${DEVICE_ID}/favorites`
      );
      setFavorites(response.data.map((m: Meme) => m.id));
    } catch (error) {
      console.error("Error fetching favorites:", error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchMemes(), fetchCategories(), fetchFavorites()]);
      setLoading(false);
    };
    loadData();
  }, []);

  useEffect(() => {
    fetchMemes();
  }, [fetchMemes]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchMemes(), fetchCategories(), fetchFavorites()]);
    setRefreshing(false);
  };

  const toggleFavorite = async (memeId: string) => {
    try {
      await axios.post(`${API_URL}/api/user/${DEVICE_ID}/favorites`, {
        meme_id: memeId,
      });
      if (favorites.includes(memeId)) {
        setFavorites(favorites.filter((id) => id !== memeId));
      } else {
        setFavorites([...favorites, memeId]);
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
    }
  };

  const trackUsage = async (memeId: string) => {
    try {
      await axios.post(`${API_URL}/api/user/${DEVICE_ID}/recent`, {
        meme_id: memeId,
      });
    } catch (error) {
      console.error("Error tracking usage:", error);
    }
  };

  const copyToClipboard = async (meme: Meme) => {
    try {
      // For images, we need to save and share
      await shareMeme(meme);
      trackUsage(meme.id);
    } catch (error) {
      Alert.alert("Error", "Failed to copy meme");
    }
  };

  const shareMeme = async (meme: Meme) => {
    try {
      trackUsage(meme.id);

      if (Platform.OS === "web") {
        // Web: Download the meme
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `MemeVault_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.alert("Meme downloaded! Share it from your downloads folder.");
        return;
      }
      
      // Request permissions first
      await MediaLibrary.requestPermissionsAsync();
      
      // Mobile: Save to temp file in document directory
      const base64Data = meme.image_base64.replace(/^data:image\/\w+;base64,/, "");
      const filename = `meme_share_${Date.now()}.png`;
      const fileUri = `${FileSystem.documentDirectory}${filename}`;

      // Write file using string encoding type
      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: 'base64',
      });

      // Share using Sharing API
      const isAvailable = await Sharing.isAvailableAsync();
      
      if (isAvailable) {
        await Sharing.shareAsync(fileUri, {
          UTI: 'public.png',
          mimeType: 'image/png',
        });
      } else {
        // Fallback to Share API for iOS
        await Share.share({
          url: fileUri,
        });
      }
      
      // Cleanup temp file after a delay
      setTimeout(async () => {
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (e) {}
      }, 5000);
      
    } catch (error: any) {
      console.error("Share error:", error);
      
      // Try alternative share method
      try {
        await Share.share({
          message: "Check out this meme from MemeVault!",
        });
      } catch (fallbackError) {
        if (Platform.OS !== "web") {
          Alert.alert("Share Error", "Unable to share. Please try again.");
        }
      }
    }
  };

  const saveToDevice = async (meme: Meme) => {
    try {
      trackUsage(meme.id);

      if (Platform.OS === "web") {
        // Web: Download the image
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `MemeVault_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.alert("Meme saved to your downloads!");
      } else {
        // Mobile: Save to camera roll
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permission Required",
            "Please grant permission to save images to your photos"
          );
          return;
        }

        const base64Data = meme.image_base64.replace(/^data:image\/\w+;base64,/, "");
        const fileUri = `${FileSystem.cacheDirectory}meme_${meme.id}.png`;

        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: 'base64',
        });

        await MediaLibrary.saveToLibraryAsync(fileUri);
        Alert.alert("Saved!", "Meme saved to your photos! 📸");
      }
    } catch (error) {
      console.error("Error saving:", error);
      if (Platform.OS === "web") {
        window.alert("Failed to save meme");
      } else {
        Alert.alert("Error", "Failed to save meme");
      }
    }
  };

  const deleteMeme = async (meme: Meme) => {
    try {
      await axios.delete(`${API_URL}/api/memes/${meme.id}`);
      setMemes(memes.filter((m) => m.id !== meme.id));
      setSelectedMeme(null);
      // Simple feedback
      if (Platform.OS === "web") {
        console.log("Meme deleted successfully");
      } else {
        Alert.alert("Deleted!", "Meme has been removed");
      }
    } catch (error) {
      console.error("Error deleting:", error);
      if (Platform.OS === "web") {
        console.error("Failed to delete meme");
      } else {
        Alert.alert("Error", "Failed to delete meme");
      }
    }
  };

  const renderMemeItem = ({ item }: { item: Meme }) => (
    <TouchableOpacity
      style={styles.memeItem}
      onPress={() => setSelectedMeme(item)}
      activeOpacity={0.8}
    >
      <Image
        source={{ uri: item.image_base64 }}
        style={styles.memeImage}
        resizeMode="cover"
      />
      {favorites.includes(item.id) && (
        <View style={styles.favoriteIndicator}>
          <Ionicons name="heart" size={14} color="#FF6B35" />
        </View>
      )}
    </TouchableOpacity>
  );

  const renderCategoryChip = ({ item }: { item: Category | { name: string } }) => (
    <TouchableOpacity
      style={[
        styles.categoryChip,
        selectedCategory === item.name && styles.categoryChipActive,
      ]}
      onPress={() => setSelectedCategory(item.name)}
    >
      <Text
        style={[
          styles.categoryChipText,
          selectedCategory === item.name && styles.categoryChipTextActive,
        ]}
      >
        {"icon" in item ? item.icon : "📁"} {item.name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>MemeVault</Text>
        <Text style={styles.subtitle}>Your meme library 🔥</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={20}
          color="#666"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search memes..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <Ionicons name="close-circle" size={20} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Category Chips */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={[{ name: "All" }, ...categories]}
        renderItem={renderCategoryChip}
        keyExtractor={(item) => item.name}
        style={styles.categoriesList}
        contentContainerStyle={styles.categoriesContent}
      />

      {/* Memes Grid */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={styles.loadingText}>Loading memes...</Text>
        </View>
      ) : memes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={80} color="#333" />
          <Text style={styles.emptyTitle}>No memes yet</Text>
          <Text style={styles.emptySubtitle}>
            Upload some memes to get started!
          </Text>
        </View>
      ) : (
        <FlatList
          data={memes}
          renderItem={renderMemeItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.memesGrid}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FF6B35"
            />
          }
        />
      )}

      {/* Meme Preview Modal */}
      <Modal
        visible={selectedMeme !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMeme(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedMeme && (
              <>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setSelectedMeme(null)}
                >
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>

                <Image
                  source={{ uri: selectedMeme.image_base64 }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />

                <Text style={styles.modalTitle}>{selectedMeme.name}</Text>
                <Text style={styles.modalCategory}>
                  {selectedMeme.category}
                </Text>

                {selectedMeme.tags.length > 0 && (
                  <View style={styles.tagsContainer}>
                    {selectedMeme.tags.map((tag, index) => (
                      <View key={index} style={styles.tag}>
                        <Text style={styles.tagText}>#{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => shareMeme(selectedMeme)}
                  >
                    <Ionicons name="share-outline" size={24} color="#fff" />
                    <Text style={styles.actionButtonText}>Share</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      favorites.includes(selectedMeme.id) &&
                        styles.actionButtonActive,
                    ]}
                    onPress={() => toggleFavorite(selectedMeme.id)}
                  >
                    <Ionicons
                      name={
                        favorites.includes(selectedMeme.id)
                          ? "heart"
                          : "heart-outline"
                      }
                      size={24}
                      color={
                        favorites.includes(selectedMeme.id) ? "#FF6B35" : "#fff"
                      }
                    />
                    <Text
                      style={[
                        styles.actionButtonText,
                        favorites.includes(selectedMeme.id) && {
                          color: "#FF6B35",
                        },
                      ]}
                    >
                      {favorites.includes(selectedMeme.id) ? "Liked" : "Like"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => saveToDevice(selectedMeme)}
                  >
                    <Ionicons name="download-outline" size={24} color="#fff" />
                    <Text style={styles.actionButtonText}>Save</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={() => deleteMeme(selectedMeme)}
                  >
                    <Ionicons name="trash-outline" size={24} color="#E74C3C" />
                    <Text style={[styles.actionButtonText, { color: "#E74C3C" }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
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
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
  },
  categoriesList: {
    maxHeight: 50,
    marginTop: 16,
  },
  categoriesContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryChip: {
    backgroundColor: "#1A1A1A",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: "#FF6B35",
  },
  categoryChipText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "500",
  },
  categoryChipTextActive: {
    color: "#fff",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#888",
    marginTop: 16,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 16,
  },
  emptySubtitle: {
    color: "#666",
    fontSize: 16,
    textAlign: "center",
    marginTop: 8,
  },
  memesGrid: {
    padding: 16,
    paddingBottom: 100,
  },
  memeItem: {
    width: MEME_SIZE,
    height: MEME_SIZE,
    margin: 4,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1A1A1A",
  },
  memeImage: {
    width: "100%",
    height: "100%",
  },
  favoriteIndicator: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 10,
    padding: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    maxHeight: "85%",
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 10,
    padding: 4,
  },
  modalImage: {
    width: "100%",
    height: 300,
    borderRadius: 12,
    marginTop: 24,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 16,
    textAlign: "center",
  },
  modalCategory: {
    color: "#FF6B35",
    fontSize: 14,
    marginTop: 4,
  },
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 12,
    gap: 8,
  },
  tag: {
    backgroundColor: "#333",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    color: "#888",
    fontSize: 12,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  actionButton: {
    alignItems: "center",
    padding: 8,
  },
  actionButtonActive: {
    backgroundColor: "rgba(255, 107, 53, 0.1)",
    borderRadius: 12,
  },
  deleteButton: {
    backgroundColor: "rgba(231, 76, 60, 0.1)",
    borderRadius: 12,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 11,
    marginTop: 4,
  },
});
