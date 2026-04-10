#!/usr/bin/env python3
"""
Script to import meme images into MemeVault database
"""
import os
import base64
import asyncio
import hashlib
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import uuid

# MongoDB connection
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"

# Categories to randomly assign
CATEGORIES = ["Reactions", "Moods", "Clapbacks", "Relatable", "Petty", "Shady", "Unbothered", "Facts"]

def get_image_base64(filepath):
    """Read image and convert to base64 with data URI"""
    with open(filepath, "rb") as f:
        data = f.read()
    
    # Determine mime type
    ext = filepath.suffix.lower()
    mime_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp"
    }
    mime = mime_types.get(ext, "image/jpeg")
    
    b64 = base64.b64encode(data).decode('utf-8')
    return f"data:{mime};base64,{b64}"

def generate_meme_name(filepath):
    """Generate a readable name from filename"""
    name = filepath.stem
    # Remove common prefixes
    name = name.replace("ImgHunt_Threads_20260409_", "")
    # Take first part before underscore if too long
    if len(name) > 30:
        name = name[:30]
    # Make it more readable
    name = f"Meme {name[:8]}"
    return name

def get_category_from_index(index):
    """Assign category based on index to distribute evenly"""
    return CATEGORIES[index % len(CATEGORIES)]

async def import_memes():
    """Main import function"""
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    
    # Find all image files
    import_dir = Path("/app/memes_import")
    image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
    
    images = []
    for folder in ["folder1", "folder2", "folder3"]:
        folder_path = import_dir / folder
        if folder_path.exists():
            for f in folder_path.iterdir():
                if f.suffix.lower() in image_extensions:
                    images.append(f)
    
    print(f"Found {len(images)} images to import")
    
    # Track imported hashes to avoid duplicates
    imported_hashes = set()
    imported_count = 0
    skipped_count = 0
    
    for i, img_path in enumerate(images):
        try:
            # Read and hash the image to check for duplicates
            with open(img_path, "rb") as f:
                img_data = f.read()
            img_hash = hashlib.md5(img_data).hexdigest()
            
            if img_hash in imported_hashes:
                print(f"  Skipping duplicate: {img_path.name}")
                skipped_count += 1
                continue
            
            imported_hashes.add(img_hash)
            
            # Convert to base64
            ext = img_path.suffix.lower()
            mime_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}
            mime = mime_types.get(ext, "image/jpeg")
            b64 = base64.b64encode(img_data).decode('utf-8')
            image_base64 = f"data:{mime};base64,{b64}"
            
            # Create meme document
            meme = {
                "id": str(uuid.uuid4()),
                "name": f"Meme #{imported_count + 1}",
                "image_base64": image_base64,
                "category": get_category_from_index(imported_count),
                "tags": ["imported", "threads"],
                "use_count": 0,
                "created_at": datetime.utcnow()
            }
            
            # Insert into database
            await db.memes.insert_one(meme)
            imported_count += 1
            print(f"  [{imported_count}] Imported: {img_path.name} -> {meme['category']}")
            
        except Exception as e:
            print(f"  Error importing {img_path.name}: {e}")
    
    # Update category counts
    print("\nUpdating category counts...")
    for cat in CATEGORIES:
        count = await db.memes.count_documents({"category": cat})
        await db.categories.update_one(
            {"name": cat},
            {"$set": {"meme_count": count}}
        )
        print(f"  {cat}: {count} memes")
    
    print(f"\n✅ Import complete!")
    print(f"   Imported: {imported_count} memes")
    print(f"   Skipped (duplicates): {skipped_count}")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(import_memes())
