import { Platform, Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";

interface MemeData {
  id: string;
  name: string;
  image_base64: string;
}

/**
 * Extracts raw base64 data from a data URI string.
 * Handles "data:image/jpeg;base64,/9j/4AAQ..." format
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
 * Detects the image extension from a base64 data URI
 */
function getImageExtension(imageData: string): string {
  if (!imageData) return "png";
  const match = imageData.match(/^data:image\/([a-zA-Z+]+);base64,/);
  if (match) {
    const type = match[1].toLowerCase();
    if (type === "jpeg" || type === "jpg") return "jpg";
    if (type === "gif") return "gif";
    if (type === "webp") return "webp";
  }
  return "png";
}

/**
 * Writes base64 image data to a temporary cache file.
 * Returns the local file:// URI.
 */
async function writeToTempFile(meme: MemeData): Promise<string> {
  console.log("[memeActions] writeToTempFile - starting");
  console.log("[memeActions] FileSystem available:", !!FileSystem);
  console.log("[memeActions] cacheDirectory:", FileSystem.cacheDirectory);

  if (!FileSystem.cacheDirectory) {
    throw new Error("FileSystem.cacheDirectory is not available");
  }

  const rawBase64 = extractBase64(meme.image_base64);
  if (!rawBase64 || rawBase64.length < 100) {
    throw new Error("Base64 data is empty or too short");
  }

  const ext = getImageExtension(meme.image_base64);
  const filename = `meemz_${meme.id}_${Date.now()}.${ext}`;
  const fileUri = FileSystem.cacheDirectory + filename;

  console.log("[memeActions] Writing to:", fileUri);
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
 * Cleanup helper - deletes a temp file silently
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
  console.log("[memeActions] copyMemeAction called for:", meme.name);

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

    // --- NATIVE (iOS / Android) ---
    const rawBase64 = extractBase64(meme.image_base64);
    console.log("[memeActions] Attempting Clipboard.setImageAsync, base64 length:", rawBase64.length);

    try {
      await Clipboard.setImageAsync(rawBase64);
      Alert.alert("Copied!", "Meemz copied to clipboard! Paste it anywhere.");
      return true;
    } catch (clipErr: any) {
      console.log("[memeActions] setImageAsync failed:", clipErr?.message || clipErr);

      // Fallback: write to file then open share sheet for manual copy
      try {
        const fileUri = await writeToTempFile(meme);
        const isAvailable = await Sharing.isAvailableAsync();

        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "image/png",
            dialogTitle: "Copy this Meemz",
          });
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
  console.log("[memeActions] shareMemeAction called for:", meme.name);

  try {
    // --- WEB ---
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `meemz_${meme.id}.png`;
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
    const ext = getImageExtension(meme.image_base64);
    const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;

    console.log("[memeActions] Sharing file:", fileUri, "mimeType:", mimeType);

    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: "Share Meemz",
      UTI: ext === "jpg" ? "public.jpeg" : "public.png",
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
  console.log("[memeActions] saveToDeviceAction called for:", meme.name);

  try {
    // --- WEB ---
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `meemz_${meme.id}.png`;
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

    Alert.alert("Saved!", "Meemz saved to your photos!");
    return true;
  } catch (error: any) {
    console.error("[memeActions] saveToDeviceAction error:", error?.message || error);
    if (Platform.OS !== "web") {
      Alert.alert("Save Failed", error?.message || "Could not save. Please try again.");
    }
    return false;
  }
}
