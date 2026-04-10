import { Platform, Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

interface MemeData {
  id: string;
  name: string;
  image_base64: string;
}

/**
 * Extracts raw base64 data from a data URI or raw base64 string
 */
function extractBase64(imageData: string): string {
  // Strip data URI prefix if present (e.g., "data:image/png;base64,")
  return imageData.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
}

/**
 * Detects the image extension from a base64 data URI
 */
function getImageExtension(imageData: string): string {
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
 * Writes base64 image to a temp file and returns the file URI.
 * Uses cacheDirectory for temp files (best for sharing).
 */
async function writeToTempFile(meme: MemeData): Promise<string> {
  const base64Data = extractBase64(meme.image_base64);
  const ext = getImageExtension(meme.image_base64);
  const filename = `MemeVault_${Date.now()}.${ext}`;
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(fileUri, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return fileUri;
}

/**
 * Opens the native share sheet to share a meme image.
 * On web, falls back to a download link.
 */
export async function shareMemeAction(meme: MemeData): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      // Web fallback: trigger download
      try {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `MemeVault_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        // Silently fail on web
      }
      return true;
    }

    // Native: write to temp file, then open share sheet
    const fileUri = await writeToTempFile(meme);
    const ext = getImageExtension(meme.image_base64);
    const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;

    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: "Share Meme",
      UTI: ext === "jpg" ? "public.jpeg" : "public.png",
    });

    // Cleanup temp file after a delay (give share sheet time)
    setTimeout(async () => {
      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch {
        // Ignore cleanup errors
      }
    }, 30000);

    return true;
  } catch (error: any) {
    console.error("Share error:", error);
    if (Platform.OS !== "web") {
      Alert.alert("Share Failed", "Could not open share sheet. Please try again.");
    }
    return false;
  }
}

/**
 * Saves a meme image to the device's photo library.
 */
export async function saveToDeviceAction(meme: MemeData): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `MemeVault_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        // Silently fail on web
      }
      return true;
    }

    // Request permissions
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Please grant permission to save images to your photos."
      );
      return false;
    }

    // Write to temp file
    const fileUri = await writeToTempFile(meme);

    // Save to media library
    await MediaLibrary.createAssetAsync(fileUri);

    // Cleanup temp file
    await FileSystem.deleteAsync(fileUri, { idempotent: true });

    Alert.alert("Saved!", "Meme saved to your photos!");
    return true;
  } catch (error: any) {
    console.error("Save error:", error);
    if (Platform.OS !== "web") {
      Alert.alert("Save Failed", "Could not save meme. Please try again.");
    }
    return false;
  }
}
