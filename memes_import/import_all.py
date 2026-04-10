#!/usr/bin/env python3
"""
Script to import ALL meme images (no duplicate skipping)
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

def get_category_from_index(index):
    """Assign category based on index to distribute evenly"""
    return CATEGORIES[index % len(CATEGORIES)]

async def import_all_memes():
    """Import all memes without duplicate checking"""
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    
    # Get existing meme count for naming
    existing_count = await db.memes.count_documents({})
    print(f"Existing memes in database: {existing_count}")
    
    # Find all image files in folders 1-3 only (the original ones that were skipped)
    import_dir = Path("/app/memes_import")
    image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
    
    images = []
    for folder in ["folder9", "folder10", "folder11"]:
        folder_path = import_dir / folder
        if folder_path.exists():
            for f in folder_path.iterdir():
                if f.suffix.lower() in image_extensions:
                    images.append(f)
    
    print(f"Found {len(images)} images to import from folders 1-3")
    
    imported_count = 0
    
    for i, img_path in enumerate(images):
        try:
            # Read image
            with open(img_path, "rb") as f:
                img_data = f.read()
            
            # Convert to base64
            ext = img_path.suffix.lower()
            mime_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}
            mime = mime_types.get(ext, "image/jpeg")
            b64 = base64.b64encode(img_data).decode('utf-8')
            image_base64 = f"data:{mime};base64,{b64}"
            
            # Create meme document
            meme_number = existing_count + imported_count + 1
            meme = {
                "id": str(uuid.uuid4()),
                "name": f"Meme #{meme_number}",
                "image_base64": image_base64,
                "category": get_category_from_index(meme_number - 1),
                "tags": ["imported", "threads"],
                "use_count": 0,
                "created_at": datetime.utcnow()
            }
            
            # Insert into database
            await db.memes.insert_one(meme)
            imported_count += 1
            
            if imported_count % 10 == 0:
                print(f"  Progress: {imported_count} memes imported...")
            
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
    
    total_memes = await db.memes.count_documents({})
    
    print(f"\n✅ Import complete!")
    print(f"   New memes imported: {imported_count}")
    print(f"   Total memes in database: {total_memes}")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(import_all_memes())
