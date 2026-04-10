import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { shareMemeAction, saveToDeviceAction, copyMemeAction } from "../../utils/memeActions";
import { requireAuth } from "../../utils/authGate";
import GradientText from "../../utils/GradientText";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

interface Meme {
  id: string;
  name: string;
  image_base64: string;
  category: string;
  tags: string[];
  use_count: number;
  created_at: string;
  user_id?: string;
  is_public: boolean;
  username?: string;
  media_type?: string;
}

export default function ExploreScreen() {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    initDevice();
    fetchExploreMemes();
    checkAdmin();
  }, []);

  const checkAdmin = async () => {
    try {
      const token = await AsyncStorage.getItem("memevault_token");
      if (!token) return;
      const res = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIsAdmin(res.data?.is_admin === true);
    } catch { /* not logged in */ }
  };

  const initDevice = async () => {
    try {
      let id = await AsyncStorage.getItem("device_id");
      if (!id) {
        id = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await AsyncStorage.setItem("device_id", id);
      }
      setDeviceId(id);

      const favResponse = await axios.get(
        `${API_URL}/api/user/${id}/favorites`
      );
      const favIds = favResponse.data.map((m: Meme) => m.id);
      setFavorites(favIds);
    } catch (error) {
      console.error("Error initializing device:", error);
    }
  };

  const fetchExploreMemes = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/memes/explore?limit=20`);
      setMemes(response.data);
    } catch (error) {
      console.error("Error fetching explore memes:", error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchExploreMemes();
    setRefreshing(false);
  }, []);

  const shuffleMemes = async () => {
    setLoading(true);
    await fetchExploreMemes();
  };

  const deleteMeme = async (meme: Meme) => {
    const doDelete = async () => {
      try {
        const token = await AsyncStorage.getItem("memevault_token");
        await axios.delete(`${API_URL}/api/memes/${meme.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMemes((prev) => prev.filter((m) => m.id !== meme.id));
        setSelectedMeme(null);
        setModalVisible(false);
        Alert.alert("Deleted!", "Meme has been removed");
      } catch (error: any) {
        const msg = error?.response?.data?.detail || "Failed to delete meme";
        Alert.alert("Error", msg);
      }
    };

    Alert.alert(
      "Delete Meme",
      "Are you sure you want to delete this meme? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]
    );
  };

  const toggleFavorite = async (meme: Meme) => {
    if (!deviceId) return;
    try {
      const response = await axios.post(
        `${API_URL}/api/user/${deviceId}/favorites`,
        { meme_id: meme.id }
      );
      if (response.data.action === "added") {
        setFavorites((prev) => [...prev, meme.id]);
      } else {
        setFavorites((prev) => prev.filter((id) => id !== meme.id));
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
    const authed = await requireAuth();
    if (!authed) return;
    try {
      trackUsage(meme.id);
      await shareMemeAction(meme);
    } catch (e: any) {
      Alert.alert("Share Error", e?.message || "Unknown error");
    }
  };

  const copyMeme = async (meme: Meme) => {
    const authed = await requireAuth();
    if (!authed) return;
    try {
      trackUsage(meme.id);
      await copyMemeAction(meme);
    } catch (e: any) {
      Alert.alert("Copy Error", e?.message || "Unknown error");
    }
  };

  const saveToDevice = async (meme: Meme) => {
    const authed = await requireAuth();
    if (!authed) return;
    try {
      trackUsage(meme.id);
      await saveToDeviceAction(meme);
    } catch (e: any) {
      Alert.alert("Save Error", e?.message || "Unknown error");
    }
  };

  const openMeme = (meme: Meme) => {
    setSelectedMeme(meme);
    setModalVisible(true);
  };

  const getCategoryColor = (category: string) => {
    const colorMap: Record<string, string> = {
      Reactions: "#FF7A1A",
      Moods: "#9B59B6",
      Clapbacks: "#3498DB",
      Relatable: "#27AE60",
      Petty: "#F39C12",
      Shady: "#E74C3C",
      Unbothered: "#1ABC9C",
      Facts: "#E91E63",
    };
    return colorMap[category] || "#FF7A1A";
  };

  const renderMemeCard = ({ item, index }: { item: Meme; index: number }) => {
    const isFavorited = favorites.includes(item.id);
    return (
      <TouchableOpacity
        style={styles.memeCard}
        onPress={() => openMeme(item)}
        activeOpacity={0.85}
      >
        <Image
          source={{ uri: item.image_base64 }}
          style={styles.memeImage}
          resizeMode="cover"
        />
        <View style={styles.cardOverlay}>
          <View style={styles.cardTopRow}>
            <View
              style={[
                styles.categoryBadge,
                { backgroundColor: getCategoryColor(item.category) + "CC" },
              ]}
            >
              <Text style={styles.categoryBadgeText} numberOfLines={1}>
                {item.category}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.heartButton}
              onPress={() => toggleFavorite(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={isFavorited ? "heart" : "heart-outline"}
                size={20}
                color={isFavorited ? "#FF7A1A" : "#fff"}
              />
            </TouchableOpacity>
          </View>
          {item.username && (
            <View style={styles.cardBottomRow}>
              <Ionicons name="person-circle-outline" size={14} color="#ccc" />
              <Text style={styles.usernameText} numberOfLines={1}>
                @{item.username}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <GradientText text="Explore" style={styles.title} />
          <Text style={styles.subtitle}>Discover new meemz</Text>
        </View>
        <TouchableOpacity
          style={styles.shuffleButton}
          onPress={shuffleMemes}
          activeOpacity={0.7}
        >
          <Ionicons name="shuffle" size={22} color="#fff" />
          <Text style={styles.shuffleText}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF7A1A" />
          <Text style={styles.loadingText}>Discovering meemz...</Text>
        </View>
      ) : memes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="compass-outline" size={80} color="#1E1E24" />
          <Text style={styles.emptyTitle}>Nothing to explore yet</Text>
          <Text style={styles.emptySubtitle}>
            Be the first to upload meemz!
          </Text>
        </View>
      ) : (
        <FlatList
          data={memes}
          renderItem={renderMemeCard}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.gridContent}
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

      {/* Meme Detail Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
            >
              <Ionicons name="close-circle" size={32} color="#fff" />
            </TouchableOpacity>

            {selectedMeme && (
              <>
                <Image
                  source={{ uri: selectedMeme.image_base64 }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />

                <View style={styles.modalInfo}>
                  <Text style={styles.modalName}>{selectedMeme.name}</Text>
                  <View style={styles.modalMeta}>
                    <View
                      style={[
                        styles.modalCategoryBadge,
                        {
                          backgroundColor:
                            getCategoryColor(selectedMeme.category) + "40",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.modalCategoryText,
                          { color: getCategoryColor(selectedMeme.category) },
                        ]}
                      >
                        {selectedMeme.category}
                      </Text>
                    </View>
                    {selectedMeme.username && (
                      <Text style={styles.modalUsername}>
                        by @{selectedMeme.username}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => shareMeme(selectedMeme)}
                  >
                    <Ionicons
                      name="share-social"
                      size={22}
                      color="#FF7A1A"
                    />
                    <Text style={styles.actionText}>Share</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => copyMeme(selectedMeme)}
                  >
                    <Ionicons
                      name="copy-outline"
                      size={22}
                      color="#FF7A1A"
                    />
                    <Text style={styles.actionText}>Copy</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => toggleFavorite(selectedMeme)}
                  >
                    <Ionicons
                      name={
                        favorites.includes(selectedMeme.id)
                          ? "heart"
                          : "heart-outline"
                      }
                      size={22}
                      color="#FF7A1A"
                    />
                    <Text style={styles.actionText}>
                      {favorites.includes(selectedMeme.id)
                        ? "Liked"
                        : "Like"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => saveToDevice(selectedMeme)}
                  >
                    <Ionicons name="download" size={22} color="#FF7A1A" />
                    <Text style={styles.actionText}>Save</Text>
                  </TouchableOpacity>

                  {isAdmin && (
                    <TouchableOpacity
                      style={[styles.actionButton, { borderColor: "#E74C3C" }]}
                      onPress={() => deleteMeme(selectedMeme)}
                    >
                      <Ionicons name="trash-outline" size={22} color="#E74C3C" />
                      <Text style={[styles.actionText, { color: "#E74C3C" }]}>Delete</Text>
                    </TouchableOpacity>
                  )}
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
  },
  subtitle: {
    fontSize: 14,
    color: "#888",
    marginTop: 2,
  },
  shuffleButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF7A1A",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  shuffleText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
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
  gridContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  row: {
    justifyContent: "space-between",
    marginBottom: 8,
  },
  memeCard: {
    width: "48.5%",
    aspectRatio: 0.87,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#15151A",
  },
  memeImage: {
    width: "100%",
    height: "100%",
  },
  cardOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
    padding: 8,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    maxWidth: "70%",
  },
  categoryBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  heartButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
    gap: 4,
  },
  usernameText: {
    color: "#ccc",
    fontSize: 11,
    fontWeight: "500",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
  },
  modalContent: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  closeButton: {
    position: "absolute",
    top: 60,
    right: 16,
    zIndex: 10,
  },
  modalImage: {
    width: "100%",
    height: 350,
    borderRadius: 12,
  },
  modalInfo: {
    paddingHorizontal: 8,
    paddingTop: 16,
  },
  modalName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  modalMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 10,
  },
  modalCategoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  modalCategoryText: {
    fontSize: 12,
    fontWeight: "600",
  },
  modalUsername: {
    color: "#888",
    fontSize: 13,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 24,
    paddingHorizontal: 16,
  },
  actionButton: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#15151A",
    borderRadius: 12,
    minWidth: 80,
  },
  actionText: {
    color: "#FF7A1A",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
});
