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

    // --- NATIVE: GIFs ---
    // iOS clipboard does NOT support animated GIFs (strips animation).
    // Best approach: Convert to MP4, save to Camera Roll so user can
    // attach the animated video from their Photos in any social app.
    if (isGif(meme)) {
      console.log("[memeActions] GIF detected - saving animated MP4 to Camera Roll");

      // Request media library permission first
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Please allow photo library access to save animated meemz.",
          [{ text: "OK" }]
        );
        return false;
      }

      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[memeActions] Copy MP4 conversion attempt ${attempt}/3`);
          const response = await fetch(`${API_URL}/api/memes/${meme.id}/video`);

          if (response.ok) {
            const videoData = await response.json();
            if (videoData.video_base64) {
              const rawMp4Base64 = extractBase64(videoData.video_base64);
              if (!FileSystem.cacheDirectory) throw new Error("Cache not available");

              const mp4FileUri = FileSystem.cacheDirectory + `meemz_copy_${meme.id}_${Date.now()}.mp4`;
              await FileSystem.writeAsStringAsync(mp4FileUri, rawMp4Base64, {
                encoding: FileSystem.EncodingType.Base64,
              });

              const fileInfo = await FileSystem.getInfoAsync(mp4FileUri);
              if (!fileInfo.exists || (fileInfo as any).size < 100) {
                throw new Error("MP4 file too small or missing");
              }

              // Save to Camera Roll
              await MediaLibrary.createAssetAsync(mp4FileUri);
              cleanupFile(mp4FileUri);

              Alert.alert(
                "Saved with Motion!",
                "Animated meemz saved to your Camera Roll! Open any social app and attach it from your Photos for full animation.",
                [{ text: "Got it!" }]
              );
              console.log("[memeActions] GIF saved as MP4 to Camera Roll!");
              return true;
            }
          }
        } catch (err: any) {
          console.log(`[memeActions] Copy MP4 attempt ${attempt} failed:`, err?.message);
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1000));
      }

      // Fallback: save original GIF to camera roll
      console.log("[memeActions] MP4 conversion failed, saving original GIF to Camera Roll");
      try {
        const fileUri = await writeToTempFile(meme);
        await MediaLibrary.createAssetAsync(fileUri);
        cleanupFile(fileUri);
        Alert.alert(
          "Saved!",
          "Meemz saved to your Camera Roll. Attach it from your Photos in any social app. Note: some apps may not animate GIFs.",
          [{ text: "Got it!" }]
        );
        return true;
      } catch (fallbackErr: any) {
        console.error("[memeActions] GIF save fallback failed:", fallbackErr?.message);
        Alert.alert("Copy Issue", "Could not save animated meemz. Try using Share instead.");
        return false;
      }
    }

    // --- NATIVE: Videos ---
    // Save video to Camera Roll for easy pasting into social apps
    if (isVideo(meme)) {
      console.log("[memeActions] Video - saving to Camera Roll");
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Please allow photo library access to save meemz.");
        return false;
      }
      const fileUri = await writeToTempFile(meme);
      await MediaLibrary.createAssetAsync(fileUri);
      cleanupFile(fileUri);
      Alert.alert("Saved!", "Meemz video saved to your Camera Roll! Attach it from your Photos in any app.");
      return true;
    }

    // --- NATIVE: Static Images ---
    // Clipboard.setImageAsync works for static PNG/JPEG
    let imageDataUri = meme.image_base64;
    if (!imageDataUri.startsWith("data:")) {
      imageDataUri = `data:image/png;base64,${imageDataUri}`;
    }

    console.log("[memeActions] Clipboard.setImageAsync with data URI, length:", imageDataUri.length);

    try {
      await Clipboard.setImageAsync(imageDataUri);
      Alert.alert("Copied!", "Meemz copied to clipboard! Paste it in Messages, Notes, or any app that supports image paste.");
      return true;
    } catch (clipErr: any) {
      console.log("[memeActions] setImageAsync failed:", clipErr?.message || clipErr);

      // Fallback: save to Camera Roll
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === "granted") {
          const fileUri = await writeToTempFile(meme);
          await MediaLibrary.createAssetAsync(fileUri);
          cleanupFile(fileUri);
          Alert.alert("Saved!", "Couldn't copy to clipboard directly, but meemz was saved to your Camera Roll!");
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
  const memeIsGif = isGif(meme);
  const memeIsVideo = isVideo(meme);
  console.log("[memeActions] shareMemeAction called for:", meme.name, "isGif:", memeIsGif, "isVideo:", memeIsVideo, "media_type:", meme.media_type);

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

    // For GIFs: Convert to MP4 video for social media compatibility
    // Instagram, Facebook, Twitter etc. don't animate GIFs from the iOS share sheet
    if (memeIsGif) {
      console.log("[memeActions] GIF detected - attempting MP4 conversion for social media");
      
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      console.log("[memeActions] API_URL:", API_URL);
      
      // Try converting GIF to MP4 with retries
      let mp4Success = false;
      let lastError = "";
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[memeActions] MP4 conversion attempt ${attempt}/3`);
          const videoUrl = `${API_URL}/api/memes/${meme.id}/video`;
          console.log("[memeActions] Fetching:", videoUrl);
          
          const response = await fetch(videoUrl, {
            method: "GET",
            headers: { "Accept": "application/json" },
          });
          
          console.log("[memeActions] Response status:", response.status);
          
          if (response.ok) {
            const videoData = await response.json();
            console.log("[memeActions] Video data received, size:", videoData.size);
            
            if (videoData.video_base64) {
              // Write MP4 to temp file
              const rawMp4Base64 = extractBase64(videoData.video_base64);
              if (!FileSystem.cacheDirectory) {
                throw new Error("Cache directory not available");
              }
              
              const mp4Filename = `meemz_${meme.id}_${Date.now()}.mp4`;
              const mp4FileUri = FileSystem.cacheDirectory + mp4Filename;
              
              console.log("[memeActions] Writing MP4 to:", mp4FileUri, "base64 length:", rawMp4Base64.length);
              
              await FileSystem.writeAsStringAsync(mp4FileUri, rawMp4Base64, {
                encoding: FileSystem.EncodingType.Base64,
              });
              
              const fileInfo = await FileSystem.getInfoAsync(mp4FileUri);
              console.log("[memeActions] MP4 file exists:", fileInfo.exists, "size:", (fileInfo as any).size);
              
              if (!fileInfo.exists || (fileInfo as any).size < 100) {
                throw new Error("MP4 file write failed or too small");
              }
              
              // Share the MP4 video
              await Sharing.shareAsync(mp4FileUri, {
                mimeType: "video/mp4",
                dialogTitle: "Share Meemz",
                UTI: "public.mpeg-4",
              });
              
              // Cleanup after delay
              setTimeout(() => cleanupFile(mp4FileUri), 60000);
              
              mp4Success = true;
              console.log("[memeActions] MP4 shared successfully!");
              break; // Exit retry loop
            }
          } else {
            const errText = await response.text().catch(() => "");
            lastError = `HTTP ${response.status}: ${errText}`;
            console.log("[memeActions] API error:", lastError);
          }
        } catch (err: any) {
          lastError = err?.message || "Unknown error";
          console.log(`[memeActions] Attempt ${attempt} failed:`, lastError);
        }
        
        // Wait before retry
        if (attempt < 3) {
          console.log("[memeActions] Waiting 1s before retry...");
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (mp4Success) {
        return true;
      }
      
      // MP4 conversion failed after retries - share as GIF with warning
      console.log("[memeActions] MP4 conversion failed after 3 attempts, sharing as GIF with warning");
      console.log("[memeActions] Last error:", lastError);
      
      // Share as GIF anyway but warn user
      const fileUri = await writeToTempFile(meme);
      await Sharing.shareAsync(fileUri, {
        mimeType: "image/gif",
        dialogTitle: "Share Meemz",
        UTI: "com.compuserve.gif",
      });
      setTimeout(() => cleanupFile(fileUri), 60000);
      
      // Warn user about animation limitation
      setTimeout(() => {
        Alert.alert(
          "Heads Up",
          "The GIF was shared but may appear as a still image on some social media apps (Instagram, Facebook). For best results, save the meme first, then share directly from your Photos app.",
          [{ text: "Got it" }]
        );
      }, 1000);
      
      return true;
    }

    // Standard share (static images + videos)
    const fileUri = await writeToTempFile(meme);
    const { mimeType, uti } = getMediaInfo(meme);

    console.log("[memeActions] Sharing file:", fileUri, "mimeType:", mimeType, "UTI:", uti);

    await Sharing.shareAsync(fileUri, {
      mimeType,
      dialogTitle: "Share Meemz",
      UTI: uti,
    });

    setTimeout(() => cleanupFile(fileUri), 60000);

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
