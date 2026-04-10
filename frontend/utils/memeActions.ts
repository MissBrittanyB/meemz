import { Platform, Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";

interface MemeData {
  id: string;
  name: string;
  image_base64: string;
  media_type?: string;
}

/**
 * Extracts raw base64 data from a data URI string.
 */
function extractBase64(imageData: string): string {
  if (!imageData) return "";
  const commaIndex = imageData.indexOf(",");
  if (commaIndex !== -1) {
    return imageData.substring(commaIndex + 1);
  }
  return imageData;
}

/**
 * Detects if the meme is a GIF (animated)
 */
function isGif(meme: MemeData): boolean {
  if (meme.media_type === "gif") return true;
  if (meme.image_base64?.startsWith("data:image/gif")) return true;
  return false;
}

/**
 * Detects if the meme is a video
 */
function isVideo(meme: MemeData): boolean {
  if (meme.media_type === "video") return true;
  if (meme.image_base64?.startsWith("data:video/")) return true;
  return false;
}

/**
 * Gets the file extension, MIME type, and iOS UTI for the meme
 */
function getMediaInfo(meme: MemeData): { ext: string; mimeType: string; uti: string } {
  // Check media_type field first
  if (isGif(meme)) {
    return { ext: "gif", mimeType: "image/gif", uti: "com.compuserve.gif" };
  }
  if (isVideo(meme)) {
    return { ext: "mp4", mimeType: "video/mp4", uti: "public.mpeg-4" };
  }

  // Fall back to data URI detection
  const b64 = meme.image_base64 || "";
  const match = b64.match(/^data:([^;]+);base64,/);
  if (match) {
    const mime = match[1].toLowerCase();
    if (mime === "image/gif") return { ext: "gif", mimeType: "image/gif", uti: "com.compuserve.gif" };
    if (mime === "video/mp4") return { ext: "mp4", mimeType: "video/mp4", uti: "public.mpeg-4" };
    if (mime === "video/quicktime") return { ext: "mov", mimeType: "video/quicktime", uti: "com.apple.quicktime-movie" };
    if (mime === "image/jpeg" || mime === "image/jpg") return { ext: "jpg", mimeType: "image/jpeg", uti: "public.jpeg" };
    if (mime === "image/webp") return { ext: "webp", mimeType: "image/webp", uti: "public.webp" };
  }

  return { ext: "png", mimeType: "image/png", uti: "public.png" };
}

/**
 * Writes base64 data to a temporary cache file.
 * Returns the local file:// URI.
 */
async function writeToTempFile(meme: MemeData): Promise<string> {
  console.log("[memeActions] writeToTempFile - starting");

  if (!FileSystem.cacheDirectory) {
    throw new Error("FileSystem.cacheDirectory is not available");
  }

  const rawBase64 = extractBase64(meme.image_base64);
  if (!rawBase64 || rawBase64.length < 100) {
    throw new Error("Base64 data is empty or too short");
  }

  const { ext } = getMediaInfo(meme);
  const filename = `meemz_${meme.id}_${Date.now()}.${ext}`;
  const fileUri = FileSystem.cacheDirectory + filename;

  console.log("[memeActions] Writing to:", fileUri, "ext:", ext);
  console.log("[memeActions] Base64 length:", rawBase64.length);

  await FileSystem.writeAsStringAsync(fileUri, rawBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  console.log("[memeActions] File exists:", fileInfo.exists, "size:", (fileInfo as any).size);

  if (!fileInfo.exists) {
    throw new Error("File was not written successfully");
  }

  return fileUri;
}

/**
 * Cleanup helper
 */
async function cleanupFile(fileUri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================
// COPY
// ============================================================
export async function copyMemeAction(meme: MemeData): Promise<boolean> {
  console.log("[memeActions] copyMemeAction called for:", meme.name, "isGif:", isGif(meme));

  try {
    // --- WEB ---
    if (Platform.OS === "web") {
      try {
        const blob = await fetch(meme.image_base64).then((r) => r.blob());
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
        return true;
      } catch {
        await Clipboard.setStringAsync(meme.name || "meemz");
        return true;
      }
    }

    // --- NATIVE: GIFs and Videos ---
    // Clipboard.setImageAsync doesn't support animated GIFs or videos.
    // For GIFs/videos, we use the share sheet so the user can send it directly.
    if (isGif(meme) || isVideo(meme)) {
      console.log("[memeActions] GIF/Video detected - using share sheet for copy");
      const fileUri = await writeToTempFile(meme);
      const isAvailable = await Sharing.isAvailableAsync();

      if (isAvailable) {
        const { mimeType, uti } = getMediaInfo(meme);
        Alert.alert(
          "Copy GIF",
          "GIFs can't be copied to clipboard directly. Use the share sheet to send it!",
        );
        await Sharing.shareAsync(fileUri, {
          mimeType,
          dialogTitle: "Share this Meemz GIF",
          UTI: uti,
        });
        setTimeout(() => cleanupFile(fileUri), 30000);
        return true;
      }

      Alert.alert("Copy Issue", "Could not copy GIF. Try using Share instead.");
      return false;
    }

    // --- NATIVE: Static Images ---
    const rawBase64 = extractBase64(meme.image_base64);
    console.log("[memeActions] Attempting Clipboard.setImageAsync, base64 length:", rawBase64.length);

    try {
      await Clipboard.setImageAsync(rawBase64);
      Alert.alert("Copied!", "Meemz copied to clipboard! Paste it anywhere.");
      return true;
    } catch (clipErr: any) {
      console.log("[memeActions] setImageAsync failed:", clipErr?.message || clipErr);

      // Fallback: share sheet
      try {
        const fileUri = await writeToTempFile(meme);
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          const { mimeType, uti } = getMediaInfo(meme);
          await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: "Copy this Meemz", UTI: uti });
          setTimeout(() => cleanupFile(fileUri), 30000);
          return true;
        }
      } catch (fbErr: any) {
        console.error("[memeActions] Copy fallback failed:", fbErr?.message || fbErr);
      }

      Alert.alert("Copy Issue", "Could not copy directly. Try using Share instead.");
      return false;
    }
  } catch (error: any) {
    console.error("[memeActions] copyMemeAction error:", error?.message || error);
    if (Platform.OS !== "web") {
      Alert.alert("Copy Failed", error?.message || "Unknown error");
    }
    return false;
  }
}

// ============================================================
// SHARE
// ============================================================
export async function shareMemeAction(meme: MemeData): Promise<boolean> {
  console.log("[memeActions] shareMemeAction called for:", meme.name, "isGif:", isGif(meme));

  try {
    // --- WEB ---
    if (Platform.OS === "web") {
      const { ext } = getMediaInfo(meme);
      try {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `meemz_${meme.id}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        // silent
      }
      return true;
    }

    // --- NATIVE ---
    const isAvailable = await Sharing.isAvailableAsync();
    console.log("[memeActions] Sharing available:", isAvailable);

    if (!isAvailable) {
      Alert.alert("Sharing Unavailable", "Sharing is not available on this device.");
      return false;
    }

    const fileUri = await writeToTempFile(meme);
    const { mimeType, uti } = getMediaInfo(meme);

    console.log("[memeActions] Sharing file:", fileUri, "mimeType:", mimeType, "UTI:", uti);

    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: "Share Meemz",
      UTI: uti,
    });

    // Delayed cleanup
    setTimeout(() => cleanupFile(fileUri), 30000);

    return true;
  } catch (error: any) {
    console.error("[memeActions] shareMemeAction error:", error?.message || error);
    if (Platform.OS !== "web") {
      Alert.alert("Share Failed", error?.message || "Could not share. Please try again.");
    }
    return false;
  }
}

// ============================================================
// SAVE TO DEVICE
// ============================================================
export async function saveToDeviceAction(meme: MemeData): Promise<boolean> {
  console.log("[memeActions] saveToDeviceAction called for:", meme.name, "isGif:", isGif(meme));

  try {
    // --- WEB ---
    if (Platform.OS === "web") {
      const { ext } = getMediaInfo(meme);
      try {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `meemz_${meme.id}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        // silent
      }
      return true;
    }

    // --- NATIVE ---
    console.log("[memeActions] Requesting media library permissions...");
    const { status } = await MediaLibrary.requestPermissionsAsync();
    console.log("[memeActions] Permission status:", status);

    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Please allow access to save meemz to your photos.",
        [{ text: "OK" }]
      );
      return false;
    }

    const fileUri = await writeToTempFile(meme);
    console.log("[memeActions] Saving to media library from:", fileUri);

    const asset = await MediaLibrary.createAssetAsync(fileUri);
    console.log("[memeActions] Asset created:", asset.uri);

    // Cleanup temp file
    await cleanupFile(fileUri);

    const mediaLabel = isGif(meme) ? "GIF" : isVideo(meme) ? "video" : "image";
    Alert.alert("Saved!", `Meemz ${mediaLabel} saved to your photos!`);
    return true;
  } catch (error: any) {
    console.error("[memeActions] saveToDeviceAction error:", error?.message || error);
    if (Platform.OS !== "web") {
      Alert.alert("Save Failed", error?.message || "Could not save. Please try again.");
    }
    return false;
  }
}
