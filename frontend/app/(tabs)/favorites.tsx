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
  Dimensions,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { shareMemeAction, saveToDeviceAction, copyMemeAction } from "../../utils/memeActions";

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

export default function FavoritesScreen() {
  const [deviceId, setDeviceId] = useState<string>("");
  const [favorites, setFavorites] = useState<Meme[]>([]);
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const fetchFavorites = async () => {
    if (!deviceId) return;
    try {
      const response = await axios.get(
        `${API_URL}/api/user/${deviceId}/favorites`
      );
      setFavorites(response.data);
    } catch (error) {
      console.error("Error fetching favorites:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      fetchFavorites();
    }
  }, [deviceId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFavorites();
    setRefreshing(false);
  };

  const removeFavorite = async (memeId: string) => {
    if (!deviceId) return;
    try {
      await axios.post(`${API_URL}/api/user/${deviceId}/favorites`, {
        meme_id: memeId,
      });
      setFavorites(favorites.filter((m) => m.id !== memeId));
      if (selectedMeme?.id === memeId) {
        setSelectedMeme(null);
      }
    } catch (error) {
      console.error("Error removing favorite:", error);
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
    trackUsage(meme.id);
    await shareMemeAction(meme);
  };

  const copyMeme = async (meme: Meme) => {
    trackUsage(meme.id);
    await copyMemeAction(meme);
  };

  const saveToDevice = async (meme: Meme) => {
    trackUsage(meme.id);
    await saveToDeviceAction(meme);
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
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Favorites</Text>
        <Text style={styles.subtitle}>
          {favorites.length} saved {favorites.length === 1 ? "meme" : "memes"} ❤️
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF7A1A" />
          <Text style={styles.loadingText}>Loading favorites...</Text>
        </View>
      ) : favorites.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="heart-outline" size={80} color="#1E1E24" />
          <Text style={styles.emptyTitle}>No favorites yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap the heart on memes you love!
          </Text>
        </View>
      ) : (
        <FlatList
          data={favorites}
          renderItem={renderMemeItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.memesGrid}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FF7A1A"
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
                    style={styles.actionButton}
                    onPress={() => copyMeme(selectedMeme)}
                  >
                    <Ionicons name="copy-outline" size={24} color="#fff" />
                    <Text style={styles.actionButtonText}>Copy</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.removeButton]}
                    onPress={() => removeFavorite(selectedMeme.id)}
                  >
                    <Ionicons name="heart-dislike" size={24} color="#E74C3C" />
                    <Text style={[styles.actionButtonText, { color: "#E74C3C" }]}>
                      Remove
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
    backgroundColor: "#0B0B0F",
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
    backgroundColor: "#15151A",
  },
  memeImage: {
    width: "100%",
    height: "100%",
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
    backgroundColor: "#15151A",
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
    color: "#FF7A1A",
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
    borderTopColor: "#1E1E24",
  },
  actionButton: {
    alignItems: "center",
    padding: 12,
  },
  removeButton: {
    backgroundColor: "rgba(231, 76, 60, 0.1)",
    borderRadius: 12,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 12,
    marginTop: 4,
  },
});
