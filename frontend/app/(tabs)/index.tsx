import React, { useState, useEffect, useCallback, useRef } from "react";
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
  Dimensions,
  RefreshControl,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import axios from "axios";
import { shareMemeAction, saveToDeviceAction, copyMemeAction } from "../../utils/memeActions";
import GradientText from "../../utils/GradientText";
import { requireAuth } from "../../utils/authGate";

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const NUM_COLUMNS = 3;
const GRID_PADDING = 8;
const ITEM_SPACING = 2;
const MEME_SIZE = Math.floor((SCREEN_WIDTH - GRID_PADDING * 2 - ITEM_SPACING * (NUM_COLUMNS - 1) * 2) / NUM_COLUMNS);

interface Meme {
  id: string;
  name: string;
  image_base64?: string;
  thumbnail_base64?: string;
  category: string;
  tags: string[];
  use_count: number;
  created_at: string;
  media_type?: string;
  username?: string;
  user_id?: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  meme_count: number;
}

export default function MemesScreen() {
  const [deviceId, setDeviceId] = useState<string>("");
  const [memes, setMemes] = useState<Meme[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // Report content
  const reportMeme = async (meme: Meme, reason: string) => {
    try {
      const t = token || await AsyncStorage.getItem("memevault_token");
      await axios.post(`${API_URL}/api/reports`, {
        content_id: meme.id, content_type: "meme", reason,
      }, { headers: { Authorization: `Bearer ${t}` } });
      Alert.alert("Reported", "Thank you. We will review this content within 24 hours.");
    } catch { Alert.alert("Error", "Could not submit report. Please try again."); }
  };

  // Block user
  const blockUser = async (username: string) => {
    try {
      const t = token || await AsyncStorage.getItem("memevault_token");
      await axios.post(`${API_URL}/api/users/${username}/block`, {}, {
        headers: { Authorization: `Bearer ${t}` },
      });
      Alert.alert("User Blocked", `@${username} has been blocked. Their content will no longer appear in your feed.`);
      setSelectedMeme(null);
      setFullMeme(null);
      // Refresh feed to remove blocked user's content
      loadMemes(true);
    } catch { Alert.alert("Error", "Could not block user. Please try again."); }
  };

  // Check admin status and set token
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const storedToken = await AsyncStorage.getItem("memevault_token");
        if (!storedToken) return;
        setToken(storedToken);
        const res = await axios.get(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        setIsAdmin(res.data?.is_admin === true);
      } catch { /* not logged in */ }
    };
    checkAdmin();
  }, []);

  // Initialize device ID on mount
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
        // Fallback for web
        const fallbackId = "memevault_web_" + Date.now();
        setDeviceId(fallbackId);
      }
    };
    initDeviceId();
  }, []);

  const PAGE_SIZE = 12; // 4 rows of 3 = 12 memes per page (keeps payload smaller)
  const skipRef = useRef(0);

  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);

  const fetchMemes = useCallback(async (reset = true) => {
    try {
      if (reset) {
        setLoading(true);
        hasMoreRef.current = true;
        setHasMore(true);
        skipRef.current = 0;
      } else {
        if (!hasMoreRef.current || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }

      const params: any = { limit: PAGE_SIZE, skip: skipRef.current };
      if (searchQuery) params.search = searchQuery;
      if (selectedCategory !== "All") params.category = selectedCategory;

      const response = await axios.get(`${API_URL}/api/memes`, { params });
      const newMemes = response.data;

      if (newMemes.length < PAGE_SIZE) {
        hasMoreRef.current = false;
        setHasMore(false);
      }

      if (reset) {
        setMemes(newMemes);
        skipRef.current = newMemes.length;
      } else {
        setMemes((prev) => [...prev, ...newMemes]);
        skipRef.current += newMemes.length;
      }
    } catch (error) {
      console.error("Error fetching memes:", error);
    } finally {
      setLoading(false);
      loadingMoreRef.current = false;
      setLoadingMore(false);
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

  const fetchFavorites = useCallback(async () => {
    if (!deviceId) return;
    try {
      const response = await axios.get(
        `${API_URL}/api/user/${deviceId}/favorites`
      );
      setFavorites(response.data.map((m: Meme) => m.id));
    } catch (error) {
      console.error("Error fetching favorites:", error);
    }
  }, [deviceId]);

  // Load data when deviceId is ready
  useEffect(() => {
    if (deviceId) {
      const loadData = async () => {
        setLoading(true);
        await Promise.all([fetchMemes(), fetchCategories(), fetchFavorites()]);
        setLoading(false);
      };
      loadData();
    }
  }, [deviceId]);

  // Re-fetch when search/category filters change
  useEffect(() => {
    if (deviceId) {
      fetchMemes(true);
    }
  }, [searchQuery, selectedCategory]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchMemes(true), fetchCategories(), fetchFavorites()]);
    setRefreshing(false);
  };

  const loadMoreMemes = () => {
    if (hasMoreRef.current && !loadingMoreRef.current) {
      fetchMemes(false);
    }
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

  const [fullMeme, setFullMeme] = useState<Meme | null>(null);
  const [fullMemeLoading, setFullMemeLoading] = useState(false);

  // Fetch full meme detail when modal opens
  const openMemeModal = async (meme: Meme) => {
    setSelectedMeme(meme);
    setFullMeme(null);
    setFullMemeLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/memes/${meme.id}`);
      setFullMeme(res.data);
    } catch (err) {
      console.error("Error fetching full meme:", err);
      // Fallback: use thumbnail if available
      setFullMeme(meme);
    } finally {
      setFullMemeLoading(false);
    }
  };

  const shareMeme = async (meme: Meme) => {
    const authed = await requireAuth();
    if (!authed) return;
    setActionLoading("share");
    try {
      trackUsage(meme.id);
      const memeToShare = fullMeme || meme;
      await shareMemeAction(memeToShare as any);
    } catch (e: any) {
      console.error("shareMeme wrapper error:", e);
      Alert.alert("Share Error", e?.message || "Unknown error occurred");
    } finally {
      setActionLoading(null);
    }
  };

  const copyMeme = async (meme: Meme) => {
    const authed = await requireAuth();
    if (!authed) return;
    setActionLoading("copy");
    try {
      trackUsage(meme.id);
      const memeToCopy = fullMeme || meme;
      await copyMemeAction(memeToCopy as any);
    } catch (e: any) {
      console.error("copyMeme wrapper error:", e);
      Alert.alert("Copy Error", e?.message || "Unknown error occurred");
    } finally {
      setActionLoading(null);
    }
  };

  const saveToDevice = async (meme: Meme) => {
    const authed = await requireAuth();
    if (!authed) return;
    setActionLoading("save");
    try {
      trackUsage(meme.id);
      const memeToSave = fullMeme || meme;
      await saveToDeviceAction(memeToSave as any);
    } catch (e: any) {
      console.error("saveToDevice wrapper error:", e);
      Alert.alert("Save Error", e?.message || "Unknown error occurred");
    } finally {
      setActionLoading(null);
    }
  };

  const deleteMeme = async (meme: Meme) => {
    const doDelete = async () => {
      try {
        const token = await AsyncStorage.getItem("memevault_token");
        await axios.delete(`${API_URL}/api/memes/${meme.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMemes(memes.filter((m) => m.id !== meme.id));
        setSelectedMeme(null);
        if (Platform.OS === "web") {
          console.log("Meemz deleted successfully");
        } else {
          Alert.alert("Deleted!", "Meme has been removed");
        }
      } catch (error: any) {
        console.error("Error deleting:", error);
        const msg = error?.response?.data?.detail || "Failed to delete meme";
        if (Platform.OS !== "web") {
          Alert.alert("Error", msg);
        }
      }
    };

    if (Platform.OS === "web") {
      doDelete();
    } else {
      Alert.alert(
        "Delete Meme",
        "Are you sure you want to delete this meme? This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: doDelete },
        ]
      );
    }
  };

  const renderMemeItem = ({ item }: { item: Meme }) => {
    const itemIsGif = item.media_type === "gif" || item.thumbnail_base64?.startsWith("data:image/gif");
    const displayUri = item.thumbnail_base64 || item.image_base64 || "";
    return (
      <TouchableOpacity
        style={styles.memeItem}
        onPress={() => openMemeModal(item)}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: displayUri }}
          style={styles.memeImage}
          resizeMode="cover"
        />
        {itemIsGif && (
          <View style={styles.gifBadge}>
            <Text style={styles.gifBadgeText}>GIF</Text>
          </View>
        )}
        {favorites.includes(item.id) && (
          <View style={styles.favoriteIndicator}>
            <Ionicons name="heart" size={14} color="#FF7A1A" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <GradientText text="meemz" style={styles.title} />
        <Text style={styles.subtitle}>Where meemz really live.</Text>
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
          placeholder="Search meemz..."
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
      <View style={styles.categoriesWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesContent}
        >
          {[{ name: "All" } as Category, ...categories].map((item) => (
            <TouchableOpacity
              key={item.name}
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
          ))}
        </ScrollView>
      </View>

      {/* Memes Grid */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF7A1A" />
          <Text style={styles.loadingText}>Loading meemz...</Text>
        </View>
      ) : memes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={80} color="#1E1E24" />
          <Text style={styles.emptyTitle}>No meemz yet</Text>
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
          onEndReached={loadMoreMemes}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <ActivityIndicator size="small" color="#FF7A1A" />
                <Text style={{ color: "#666", fontSize: 12, marginTop: 8 }}>Loading more meemz...</Text>
              </View>
            ) : hasMore ? (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <Text style={{ color: "#444", fontSize: 12 }}>Scroll for more meemz</Text>
              </View>
            ) : memes.length > 0 ? (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <Text style={{ color: "#444", fontSize: 12 }}>All {memes.length} meemz loaded</Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FF7A1A"
            />
          }
        />
      )}

      {/* Meme Preview Modal */}
      <Modal
        visible={selectedMeme !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { setSelectedMeme(null); setFullMeme(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingBottom: 16 }}>
            {selectedMeme && (
              <>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => { setSelectedMeme(null); setFullMeme(null); }}
                >
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>

                <Image
                  source={{ uri: (fullMeme?.image_base64 || selectedMeme.thumbnail_base64 || selectedMeme.image_base64) }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
                {fullMemeLoading && (
                  <ActivityIndicator size="small" color="#FF7A1A" style={{ position: "absolute", top: 140 }} />
                )}

                <Text style={styles.modalTitle}>{selectedMeme.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={styles.modalCategory}>
                    {selectedMeme.category}
                  </Text>
                  {selectedMeme.username && (
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedMeme(null);
                        router.push(`/user/${encodeURIComponent(selectedMeme.username!)}`);
                      }}
                    >
                      <Text style={{ color: "#FF7A1A", fontSize: 13, textDecorationLine: "underline" }}>
                        by @{selectedMeme.username}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

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
                    style={[styles.actionButton, actionLoading === "share" && styles.actionButtonLoading]}
                    onPress={() => shareMeme(selectedMeme)}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "share" ? (
                      <ActivityIndicator size="small" color="#FF7A1A" />
                    ) : (
                      <Ionicons name="share-outline" size={24} color="#fff" />
                    )}
                    <Text style={styles.actionButtonText}>
                      {actionLoading === "share" ? "Sharing..." : "Share"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, actionLoading === "copy" && styles.actionButtonLoading]}
                    onPress={() => copyMeme(selectedMeme)}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "copy" ? (
                      <ActivityIndicator size="small" color="#FF7A1A" />
                    ) : (
                      <Ionicons name="copy-outline" size={24} color="#fff" />
                    )}
                    <Text style={styles.actionButtonText}>
                      {actionLoading === "copy" ? "Copying..." : "Copy"}
                    </Text>
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
                        favorites.includes(selectedMeme.id) ? "#FF7A1A" : "#fff"
                      }
                    />
                    <Text
                      style={[
                        styles.actionButtonText,
                        favorites.includes(selectedMeme.id) && {
                          color: "#FF7A1A",
                        },
                      ]}
                    >
                      {favorites.includes(selectedMeme.id) ? "Liked" : "Like"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, actionLoading === "save" && styles.actionButtonLoading]}
                    onPress={() => saveToDevice(selectedMeme)}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "save" ? (
                      <ActivityIndicator size="small" color="#FF7A1A" />
                    ) : (
                      <Ionicons name="download-outline" size={24} color="#fff" />
                    )}
                    <Text style={styles.actionButtonText}>
                      {actionLoading === "save" ? "Saving..." : "Save"}
                    </Text>
                  </TouchableOpacity>

                  {isAdmin && (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.deleteButton]}
                      onPress={() => deleteMeme(selectedMeme)}
                    >
                      <Ionicons name="trash-outline" size={24} color="#E74C3C" />
                      <Text style={[styles.actionButtonText, { color: "#E74C3C" }]}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Report & Block - Apple Guideline 1.2 */}
                <View style={{ flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 20, paddingBottom: 16, width: "100%" }}>
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1E1E24", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 }}
                    onPress={() => {
                      Alert.alert(
                        "Report Content",
                        "Report this meemz as objectionable, spam, or inappropriate?",
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Report", style: "destructive", onPress: () => reportMeme(selectedMeme, "objectionable") },
                        ]
                      );
                    }}
                    activeOpacity={0.6}
                  >
                    <Ionicons name="flag-outline" size={18} color="#E74C3C" />
                    <Text style={{ color: "#E74C3C", fontSize: 14, fontWeight: "600" }}>Report</Text>
                  </TouchableOpacity>

                  {selectedMeme.username && (
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1E1E24", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 }}
                      onPress={() => {
                        Alert.alert(
                          "Block @" + selectedMeme.username,
                          "Their content will be removed from your feed. This also notifies our team for review.",
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Block", style: "destructive", onPress: () => blockUser(selectedMeme.username!) },
                          ]
                        );
                      }}
                      activeOpacity={0.6}
                    >
                      <Ionicons name="ban-outline" size={18} color="#E74C3C" />
                      <Text style={{ color: "#E74C3C", fontSize: 14, fontWeight: "600" }}>Block User</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
            </ScrollView>
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
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#15151A",
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
  categoriesWrapper: {
    marginTop: 12,
    marginBottom: 8,
  },
  categoriesContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: "center",
  },
  categoryChip: {
    backgroundColor: "#15151A",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: "#FF7A1A",
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
    padding: GRID_PADDING,
    paddingBottom: 100,
  },
  memeItem: {
    width: MEME_SIZE,
    height: MEME_SIZE,
    margin: ITEM_SPACING,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "#15151A",
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
  gifBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    backgroundColor: "rgba(255, 122, 26, 0.85)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  gifBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
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
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 12,
    gap: 8,
  },
  tag: {
    backgroundColor: "#1E1E24",
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
    borderTopColor: "#1E1E24",
  },
  actionButton: {
    alignItems: "center",
    padding: 8,
  },
  actionButtonActive: {
    backgroundColor: "rgba(255, 107, 53, 0.1)",
    borderRadius: 12,
  },
  actionButtonLoading: {
    backgroundColor: "rgba(255, 122, 26, 0.15)",
    borderRadius: 12,
    opacity: 0.8,
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
