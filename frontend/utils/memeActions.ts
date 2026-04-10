import { Platform, Alert } from "react-native";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";

// Lazy-load FileSystem legacy API to prevent bundling issues
let FileSystem: any = null;
async function getFileSystem() {
  if (!FileSystem) {
    try {
      FileSystem = require("expo-file-system/legacy");
    } catch (e) {
      console.warn("expo-file-system/legacy not available, trying main import");
      FileSystem = require("expo-file-system");
    }
  }
  return FileSystem;
}

interface MemeData {
  id: string;
  name: string;
  image_base64: string;
}

/**
 * Extracts raw base64 data from a data URI or raw base64 string
 */
function extractBase64(imageData: string): string {
  // Handle both data URI and raw base64
  if (imageData.includes(",")) {
    return imageData.split(",")[1] || imageData;
  }
  return imageData;
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
 * Gets the MIME type from a base64 data URI
 */
function getMimeType(imageData: string): string {
  const match = imageData.match(/^data:([^;]+);base64,/);
  if (match) return match[1];
  return "image/png";
}

/**
 * Writes base64 image to a temp file and returns the file URI.
 */
async function writeToTempFile(meme: MemeData): Promise<string> {
  const FS = await getFileSystem();
  
  if (!FS || !FS.cacheDirectory) {
    throw new Error("FileSystem not available on this platform");
  }

  const base64Data = extractBase64(meme.image_base64);
  const ext = getImageExtension(meme.image_base64);
  const filename = `meemz_${Date.now()}.${ext}`;
  const fileUri = `${FS.cacheDirectory}${filename}`;

  await FS.writeAsStringAsync(fileUri, base64Data, {
    encoding: FS.EncodingType.Base64,
  });

  // Verify the file was written
  const fileInfo = await FS.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    throw new Error("Failed to write temp file");
  }

  return fileUri;
}

/**
 * Copies the meme image to the device clipboard.
 */
export async function copyMemeAction(meme: MemeData): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      try {
        const blob = await fetch(meme.image_base64).then((r) => r.blob());
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
      } catch {
        await Clipboard.setStringAsync(meme.name || "meemz");
      }
      return true;
    }

    // Try native image copy
    const base64Data = extractBase64(meme.image_base64);
    try {
      await Clipboard.setImageAsync(base64Data);
      Alert.alert("Copied!", "Meemz copied to clipboard! Paste it anywhere.");
      return true;
    } catch (clipboardError) {
      console.log("Image clipboard failed, trying file-based approach:", clipboardError);
      // Fallback: save to temp file and let user know
      try {
        const fileUri = await writeToTempFile(meme);
        // Try sharing as a fallback for copy
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          Alert.alert(
            "Copy Meemz",
            "Tap 'Copy Photo' in the share sheet to copy this meemz!",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Share",
                onPress: async () => {
                  try {
                    await Sharing.shareAsync(fileUri, {
                      mimeType: "image/png",
                      dialogTitle: "Copy Meemz",
                    });
                  } catch (e) {
                    console.error("Share fallback error:", e);
                  }
                },
              },
            ]
          );
          return true;
        }
      } catch (fallbackError) {
        console.error("Copy fallback error:", fallbackError);
      }
      Alert.alert("Copy Failed", "Could not copy meemz. Try using Share instead.");
      return false;
    }
  } catch (error: any) {
    console.error("Copy error:", error);
    if (Platform.OS !== "web") {
      Alert.alert("Copy Failed", "Could not copy meemz to clipboard.");
    }
    return false;
  }
}

/**
 * Opens the native share sheet to share a meme image.
 */
export async function shareMemeAction(meme: MemeData): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
        link.href = meme.image_base64;
        link.download = `meemz_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        // Silently fail
      }
      return true;
    }

    // Check if sharing is available
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert(
        "Sharing Unavailable",
        "Sharing is not available on this device. Try saving the meemz first."
      );
      return false;
    }

    // Write to temp file, then share
    const fileUri = await writeToTempFile(meme);
    const ext = getImageExtension(meme.image_base64);
    const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;

    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: "Share Meemz",
      UTI: ext === "jpg" ? "public.jpeg" : "public.png",
    });

    // Cleanup temp file after a delay
    setTimeout(async () => {
      try {
        const FS = await getFileSystem();
        if (FS) {
          await FS.deleteAsync(fileUri, { idempotent: true });
        }
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
        link.download = `meemz_${meme.id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        // Silently fail
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

    // Write to temp file and save to library
    const fileUri = await writeToTempFile(meme);
    await MediaLibrary.createAssetAsync(fileUri);
    
    // Cleanup temp file
    try {
      const FS = await getFileSystem();
      if (FS) {
        await FS.deleteAsync(fileUri, { idempotent: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    Alert.alert("Saved!", "Meemz saved to your photos!");
    return true;
  } catch (error: any) {
    console.error("Save error:", error);
    if (Platform.OS !== "web") {
      Alert.alert("Save Failed", "Could not save meemz. Please try again.");
    }
    return false;
  }
}
