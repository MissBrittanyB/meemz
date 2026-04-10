import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
  Share,
  Dimensions,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width } = Dimensions.get("window");
const MEME_SIZE = (width - 48) / 3;

interface Meme {
  id: string;
  name: string;
  image_base64: string;
  category: string;
  tags: string[];
  use_count: number;
  created_at: string;
}

export default function RecentScreen() {
  const [deviceId, setDeviceId] = useState<string>("");
  const [recentMemes, setRecentMemes] = useState<Meme[]>([]);
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    const initDeviceId = async () => {
      try {
        let storedId = await AsyncStorage.getItem("memevault_device_id");
        if (!storedId) {
          storedId = "memevault_" + Date.now() + "_" + Math.random().toString(36).substring(7);
          await AsyncStorage.setItem("memevault_device_id", storedId);
        }
        setDeviceId(storedId);
      } catch (e) {
        const fallbackId = "memevault_web_" + Date.now();
        setDeviceId(fallbackId);
      }
    };
    initDeviceId();
  }, []);

  const fetchRecent = async () => {
    if (!deviceId) return;
    try {
      const response = await axios.get(
        `${API_URL}/api/user/${deviceId}/recent`
      );
      setRecentMemes(response.data);
    } catch (error) {
      console.error("Error fetching recent:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFavorites = async () => {
    if (!deviceId) return;
    try {
      const response = await axios.get(
        `${API_URL}/api/user/${deviceId}/favorites`
      );
      setFavorites(response.data.map((m: Meme) => m.id));
    } catch (error) {
      console.error("Error fetching favorites:", error);
    }
  };

  useEffect(() => {
    if (deviceId) {
      Promise.all([fetchRecent(), fetchFavorites()]);
    }
  }, [deviceId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchRecent(), fetchFavorites()]);
    setRefreshing(false);
  };

  const toggleFavorite = async (memeId: string) => {
    if (!deviceId) return;
    try {
      await axios.post(`${API_URL}/api/user/${deviceId}/favorites`, {
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
    if (!deviceId) return;
    try {
      await axios.post(`${API_URL}/api/user/${deviceId}/recent`, {
        meme_id: memeId,
      });
    } catch (error) {
      console.error("Error tracking usage:", error);
    }
  };

  const shareMeme = async (meme: Meme) => {
    try {
      trackUsage(meme.id);

      // Check if native mobile
      const isNativeMobile = Platform.OS === "ios" || Platform.OS === "android";
      
      if (!isNativeMobile) {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `MemeVault_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.alert("Meme downloaded!");
        return;
      }

      // Native mobile: open share sheet
      const base64Data = meme.image_base64.replace(/^data:image\/\w+;base64,/, "");
      const filename = `MemeVault_${Date.now()}.png`;
      const fileUri = `${FileSystem.documentDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: "base64",
      });

      await Sharing.shareAsync(fileUri, {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: "Share Meme",
      });

      setTimeout(async () => {
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (e) {}
      }, 15000);

    } catch (error) {
      console.error("Error sharing:", error);
      if (Platform.OS !== "web") {
        Alert.alert("Error", "Failed to share meme");
      }
    }
  };

  const saveToDevice = async (meme: Meme) => {
    try {
      trackUsage(meme.id);

      if (Platform.OS === "web") {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `MemeVault_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.alert("Meme saved!");
        return;
      }

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Please grant permission to save images");
        return;
      }

      const base64Data = meme.image_base64.replace(/^data:image\/\w+;base64,/, "");
      const filename = `MemeVault_${Date.now()}.png`;
      const fileUri = `${FileSystem.documentDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: "base64",
      });

      await MediaLibrary.createAssetAsync(fileUri);
      await FileSystem.deleteAsync(fileUri, { idempotent: true });

      Alert.alert("Saved!", "Meme saved to your photos! 📸");
    } catch (error) {
      console.error("Error saving:", error);
      if (Platform.OS !== "web") {
        Alert.alert("Error", "Failed to save meme");
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Recent</Text>
        <Text style={styles.subtitle}>Recently used memes ⏰</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={styles.loadingText}>Loading recent...</Text>
        </View>
      ) : recentMemes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="time-outline" size={80} color="#333" />
          <Text style={styles.emptyTitle}>No recent memes</Text>
          <Text style={styles.emptySubtitle}>
            Share or save memes to see them here!
          </Text>
        </View>
      ) : (
        <FlatList
          data={recentMemes}
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
                <Text style={styles.modalCategory}>{selectedMeme.category}</Text>

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
                      favorites.includes(selectedMeme.id) && styles.actionButtonActive,
                    ]}
                    onPress={() => toggleFavorite(selectedMeme.id)}
                  >
                    <Ionicons
                      name={favorites.includes(selectedMeme.id) ? "heart" : "heart-outline"}
                      size={24}
                      color={favorites.includes(selectedMeme.id) ? "#FF6B35" : "#fff"}
                    />
                    <Text
                      style={[
                        styles.actionButtonText,
                        favorites.includes(selectedMeme.id) && { color: "#FF6B35" },
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
    padding: 12,
  },
  actionButtonActive: {
    backgroundColor: "rgba(255, 107, 53, 0.1)",
    borderRadius: 12,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 12,
    marginTop: 4,
  },
});
