import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Dimensions,
  Linking,
  Alert,
  Modal,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import Constants from "expo-constants";
import { shareMemeAction, saveToDeviceAction, copyMemeAction } from "../../utils/memeActions";

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL
  || process.env.EXPO_PUBLIC_BACKEND_URL
  || "";

const { width } = Dimensions.get("window");
const GRID_GAP = 2;
const NUM_COLUMNS = 3;
const ITEM_SIZE = Math.floor((width - GRID_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS);

interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  profile_image?: string;
  avatar?: string;
  social_links: Record<string, string>;
  meme_count: number;
  followers_count: number;
  following_count: number;
  is_following: boolean;
  is_blocked?: boolean;
}

interface Meme {
  id: string;
  name: string;
  image_base64?: string;
  thumbnail_base64?: string;
  category: string;
  media_type?: string;
}

const SOCIAL_PLATFORMS = [
  { key: "instagram", icon: "logo-instagram", color: "#E1306C", urlPrefix: "https://instagram.com/" },
  { key: "twitter", icon: "logo-twitter", color: "#1DA1F2", urlPrefix: "https://x.com/" },
  { key: "tiktok", icon: "musical-notes", color: "#69C9D0", urlPrefix: "https://tiktok.com/@" },
  { key: "threads", icon: "at-outline", color: "#000000", urlPrefix: "https://threads.net/@" },
];

export default function UserProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [selectedMeme, setSelectedMeme] = useState<Meme | null>(null);
  const [fullMeme, setFullMeme] = useState<Meme | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (username) {
      fetchProfile();
      fetchMemes();
    }
  }, [username]);

  const fetchProfile = async () => {
    try {
      const token = await AsyncStorage.getItem("memevault_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      
      const res = await axios.get(`${API_URL}/api/users/${encodeURIComponent(username!)}/profile`, { headers });
      setProfile(res.data);
    } catch (err) {
      console.error("Error fetching profile:", err);
    }
  };

  const fetchMemes = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/users/${encodeURIComponent(username!)}/memes`);
      setMemes(res.data || []);
    } catch (err) {
      console.error("Error fetching memes:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleFollow = async () => {
    if (!profile) return;
    const token = await AsyncStorage.getItem("memevault_token");
    if (!token) {
      Alert.alert("Login Required", "Please log in to follow users.");
      return;
    }
    
    setFollowLoading(true);
    try {
      const res = await axios.post(
        `${API_URL}/api/users/${encodeURIComponent(username!)}/follow`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              is_following: res.data.is_following,
              followers_count: prev.followers_count + (res.data.is_following ? 1 : -1),
            }
          : null
      );
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Failed to follow";
      Alert.alert("Error", msg);
    } finally {
      setFollowLoading(false);
    }
  };

  const toggleBlock = async () => {
    if (!profile) return;
    const token = await AsyncStorage.getItem("memevault_token");
    if (!token) {
      Alert.alert("Sign In Required", "Please sign in to block users.");
      return;
    }

    const isBlocked = profile.is_blocked === true;
    const doBlock = async () => {
      setBlockLoading(true);
      try {
        if (isBlocked) {
          await axios.delete(
            `${API_URL}/api/users/${encodeURIComponent(profile.username)}/block`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          setProfile((prev) => (prev ? { ...prev, is_blocked: false } : prev));
          Alert.alert("User Unblocked", `@${profile.username} has been unblocked.`);
        } else {
          await axios.post(
            `${API_URL}/api/users/${encodeURIComponent(profile.username)}/block`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
          );
          setProfile((prev) =>
            prev ? { ...prev, is_blocked: true, is_following: false } : prev
          );
          setMemes([]);
          Alert.alert(
            "User Blocked",
            `@${profile.username} has been blocked. Their content will no longer appear in your feeds and future interactions are prevented. Our team is notified for review.`
          );
        }
      } catch (err: any) {
        Alert.alert("Error", err?.response?.data?.detail || "Action failed. Please try again.");
      } finally {
        setBlockLoading(false);
      }
    };

    if (isBlocked) {
      Alert.alert(
        "Unblock @" + profile.username + "?",
        "You will see their content again and they will be able to interact with you.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Unblock", onPress: doBlock },
        ]
      );
    } else {
      Alert.alert(
        "Block @" + profile.username + "?",
        "Their content will be removed from your feeds and future interactions will be prevented. Our team is notified for review.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Block", style: "destructive", onPress: doBlock },
        ]
      );
    }
  };

  const openSocialLink = (platform: string, handle: string) => {
    if (!handle) return;
    const cleanHandle = handle.replace("@", "").trim();
    const plat = SOCIAL_PLATFORMS.find((p) => p.key === platform);
    if (plat && cleanHandle) {
      Linking.openURL(`${plat.urlPrefix}${cleanHandle}`);
    }
  };

  const openMemeDetail = async (meme: Meme) => {
    setSelectedMeme(meme);
    setFullMeme(null);
    try {
      const res = await axios.get(`${API_URL}/api/memes/${meme.id}`);
      setFullMeme(res.data);
    } catch {
      setFullMeme(meme);
    }
  };

  const shareMeme = async (meme: Meme) => {
    setActionLoading("share");
    const m = fullMeme || meme;
    await shareMemeAction(m as any);
    setActionLoading(null);
  };

  const copyMeme = async (meme: Meme) => {
    setActionLoading("copy");
    const m = fullMeme || meme;
    await copyMemeAction(m as any);
    setActionLoading(null);
  };

  const saveMeme = async (meme: Meme) => {
    setActionLoading("save");
    const m = fullMeme || meme;
    await saveToDeviceAction(m as any);
    setActionLoading(null);
  };

  const renderMemeItem = ({ item }: { item: Meme }) => {
    const itemIsGif = item.media_type === "gif" || item.thumbnail_base64?.startsWith("data:image/gif");
    const displayUri = item.thumbnail_base64 || item.image_base64 || "";
    return (
      <TouchableOpacity
        style={styles.memeItem}
        onPress={() => openMemeDetail(item)}
        activeOpacity={0.8}
      >
        <Image source={{ uri: displayUri }} style={styles.memeImage} resizeMode="cover" />
        {itemIsGif && (
          <View style={styles.gifBadge}>
            <Text style={styles.gifBadgeText}>GIF</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#FF7A1A" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>@{profile?.username || username}</Text>
        {profile ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={toggleBlock}
            disabled={blockLoading}
            accessibilityLabel={profile.is_blocked ? "Unblock user" : "Block user"}
          >
            {blockLoading ? (
              <ActivityIndicator size="small" color="#E74C3C" />
            ) : (
              <Ionicons
                name={profile.is_blocked ? "ban" : "ban-outline"}
                size={24}
                color="#E74C3C"
              />
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Info */}
        {profile && (
          <View style={styles.profileSection}>
            <View style={styles.avatarRow}>
              {profile.profile_image ? (
                <Image source={{ uri: profile.profile_image }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarText}>
                    {(profile.display_name || profile.username)?.[0]?.toUpperCase() || "?"}
                  </Text>
                </View>
              )}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profile.meme_count}</Text>
                  <Text style={styles.statLabel}>Meemz</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profile.followers_count}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profile.following_count}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </View>
              </View>
            </View>

            <Text style={styles.displayName}>{profile.display_name || profile.username}</Text>
            {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

            {/* Social Links */}
            {profile.social_links && Object.keys(profile.social_links).some((k) => profile.social_links[k]) && (
              <View style={styles.socialRow}>
                {SOCIAL_PLATFORMS.map((plat) => {
                  const handle = profile.social_links?.[plat.key];
                  if (!handle) return null;
                  return (
                    <TouchableOpacity
                      key={plat.key}
                      style={[styles.socialChip, { borderColor: plat.color }]}
                      onPress={() => openSocialLink(plat.key, handle)}
                    >
                      <Ionicons name={plat.icon as any} size={16} color={plat.color} />
                      <Text style={[styles.socialHandle, { color: plat.color }]}>
                        @{handle.replace("@", "")}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Follow / Unblock Button */}
            {profile.is_blocked ? (
              <TouchableOpacity
                style={[styles.followButton, styles.blockedButton]}
                onPress={toggleBlock}
                disabled={blockLoading}
              >
                {blockLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="ban" size={18} color="#fff" />
                    <Text style={styles.followButtonText}>Unblock</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.followButton,
                  profile.is_following && styles.followingButton,
                ]}
                onPress={toggleFollow}
                disabled={followLoading}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons
                      name={profile.is_following ? "checkmark" : "person-add"}
                      size={18}
                      color={profile.is_following ? "#FF7A1A" : "#fff"}
                    />
                    <Text
                      style={[
                        styles.followButtonText,
                        profile.is_following && styles.followingButtonText,
                      ]}
                    >
                      {profile.is_following ? "Following" : "Follow"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Memes Grid */}
        <View style={styles.memesSection}>
          <Text style={styles.sectionTitle}>Meemz</Text>
          {profile?.is_blocked ? (
            <View style={styles.blockedContainer}>
              <Ionicons name="ban" size={40} color="#666" />
              <Text style={styles.blockedTitle}>You&apos;ve blocked this user</Text>
              <Text style={styles.blockedSubtitle}>
                Their content is hidden across meemz. Tap the ban icon above to unblock.
              </Text>
            </View>
          ) : memes.length === 0 && !loading ? (
            <Text style={styles.emptyText}>No meemz yet</Text>
          ) : (
            <FlatList
              data={memes}
              renderItem={renderMemeItem}
              keyExtractor={(item) => item.id}
              numColumns={NUM_COLUMNS}
              scrollEnabled={false}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.gridRow}
            />
          )}
        </View>
      </ScrollView>

      {/* Meme Detail Modal */}
      <Modal visible={!!selectedMeme} transparent animationType="fade" onRequestClose={() => setSelectedMeme(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedMeme(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>

            {selectedMeme && (
              <>
                <Image
                  source={{ uri: (fullMeme?.image_base64 || selectedMeme.thumbnail_base64 || selectedMeme.image_base64) }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
                <Text style={styles.modalName}>{selectedMeme.name}</Text>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => shareMeme(selectedMeme)}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "share" ? (
                      <ActivityIndicator size="small" color="#FF7A1A" />
                    ) : (
                      <Ionicons name="share-outline" size={24} color="#fff" />
                    )}
                    <Text style={styles.actionBtnText}>Share</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => copyMeme(selectedMeme)}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "copy" ? (
                      <ActivityIndicator size="small" color="#FF7A1A" />
                    ) : (
                      <Ionicons name="copy-outline" size={24} color="#fff" />
                    )}
                    <Text style={styles.actionBtnText}>Copy</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => saveMeme(selectedMeme)}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "save" ? (
                      <ActivityIndicator size="small" color="#FF7A1A" />
                    ) : (
                      <Ionicons name="download-outline" size={24} color="#fff" />
                    )}
                    <Text style={styles.actionBtnText}>Save</Text>
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
    backgroundColor: "#0D0D0D",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1A1A1A",
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  profileSection: {
    padding: 20,
    alignItems: "center",
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 24,
  },
  avatarPlaceholder: {
    backgroundColor: "#FF7A1A",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
  },
  statsRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  statLabel: {
    color: "#888",
    fontSize: 12,
    marginTop: 2,
  },
  displayName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  bio: {
    color: "#aaa",
    fontSize: 14,
    alignSelf: "flex-start",
    marginBottom: 12,
    lineHeight: 20,
  },
  socialRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  socialChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  socialHandle: {
    fontSize: 13,
    fontWeight: "500",
  },
  followButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    backgroundColor: "#FF7A1A",
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  followingButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#FF7A1A",
  },
  followButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  followingButtonText: {
    color: "#FF7A1A",
  },
  blockedButton: {
    backgroundColor: "#E74C3C",
  },
  blockedContainer: {
    alignItems: "center",
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  blockedTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  blockedSubtitle: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  memesSection: {
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  emptyText: {
    color: "#666",
    textAlign: "center",
    marginTop: 40,
    fontSize: 16,
  },
  grid: {
    paddingBottom: 20,
  },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  memeItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 4,
    overflow: "hidden",
  },
  memeImage: {
    width: "100%",
    height: "100%",
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
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    maxHeight: "85%",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: -40,
    right: 0,
    zIndex: 10,
    padding: 8,
  },
  modalImage: {
    width: "100%",
    height: 300,
    borderRadius: 12,
    marginBottom: 16,
  },
  modalName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: "row",
    gap: 16,
  },
  actionBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1A1A",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 4,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
  },
});
