from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import base64

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'memevault')]

# Create the main app
app = FastAPI(title="MemeVault API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============ MODELS ============

class Category(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    icon: str = "😎"
    meme_count: int = 0

class CategoryCreate(BaseModel):
    name: str
    icon: str = "😎"

class Meme(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    image_base64: str
    category: str
    tags: List[str] = []
    use_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

class MemeCreate(BaseModel):
    name: str
    image_base64: str
    category: str
    tags: List[str] = []

class MemeResponse(BaseModel):
    id: str
    name: str
    image_base64: str
    category: str
    tags: List[str]
    use_count: int
    created_at: datetime

class UserData(BaseModel):
    device_id: str
    favorites: List[str] = []
    recently_used: List[str] = []

class FavoriteAction(BaseModel):
    meme_id: str

class RecentAction(BaseModel):
    meme_id: str

# ============ CATEGORY ENDPOINTS ============

@api_router.get("/categories", response_model=List[Category])
async def get_categories():
    """Get all categories"""
    categories = await db.categories.find().to_list(100)
    return [Category(**cat) for cat in categories]

@api_router.post("/categories", response_model=Category)
async def create_category(category: CategoryCreate):
    """Create a new category"""
    cat_obj = Category(**category.dict())
    await db.categories.insert_one(cat_obj.dict())
    return cat_obj

@api_router.delete("/categories/{category_id}")
async def delete_category(category_id: str):
    """Delete a category"""
    result = await db.categories.delete_one({"id": category_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}

# ============ MEME ENDPOINTS ============

@api_router.get("/memes", response_model=List[MemeResponse])
async def get_memes(
    search: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 500,
    skip: int = 0
):
    """Get memes with optional filters"""
    query = {}
    
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"tags": {"$regex": search, "$options": "i"}}
        ]
    
    if category and category != "All":
        query["category"] = category
    
    memes = await db.memes.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return [MemeResponse(**meme) for meme in memes]

@api_router.get("/memes/{meme_id}", response_model=MemeResponse)
async def get_meme(meme_id: str):
    """Get a single meme by ID"""
    meme = await db.memes.find_one({"id": meme_id})
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")
    return MemeResponse(**meme)

@api_router.post("/memes", response_model=MemeResponse)
async def create_meme(meme: MemeCreate):
    """Create a new meme"""
    meme_obj = Meme(**meme.dict())
    await db.memes.insert_one(meme_obj.dict())
    
    # Update category meme count
    await db.categories.update_one(
        {"name": meme.category},
        {"$inc": {"meme_count": 1}}
    )
    
    return MemeResponse(**meme_obj.dict())

@api_router.post("/memes/upload")
async def upload_meme(
    file: UploadFile = File(...),
    name: str = Form(...),
    category: str = Form(...),
    tags: str = Form(default="")
):
    """Upload a meme image file"""
    try:
        contents = await file.read()
        image_base64 = base64.b64encode(contents).decode('utf-8')
        
        # Determine content type
        content_type = file.content_type or "image/jpeg"
        full_base64 = f"data:{content_type};base64,{image_base64}"
        
        tags_list = [t.strip() for t in tags.split(",") if t.strip()]
        
        meme_obj = Meme(
            name=name,
            image_base64=full_base64,
            category=category,
            tags=tags_list
        )
        
        await db.memes.insert_one(meme_obj.dict())
        
        # Update category meme count
        await db.categories.update_one(
            {"name": category},
            {"$inc": {"meme_count": 1}}
        )
        
        return MemeResponse(**meme_obj.dict())
    except Exception as e:
        logger.error(f"Error uploading meme: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/memes/{meme_id}")
async def delete_meme(meme_id: str):
    """Delete a meme"""
    meme = await db.memes.find_one({"id": meme_id})
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")
    
    await db.memes.delete_one({"id": meme_id})
    
    # Update category meme count
    await db.categories.update_one(
        {"name": meme["category"]},
        {"$inc": {"meme_count": -1}}
    )
    
    return {"message": "Meme deleted"}

@api_router.post("/memes/{meme_id}/use")
async def increment_use_count(meme_id: str):
    """Increment the use count of a meme"""
    result = await db.memes.update_one(
        {"id": meme_id},
        {"$inc": {"use_count": 1}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Meme not found")
    return {"message": "Use count incremented"}

# ============ USER DATA ENDPOINTS ============

@api_router.get("/user/{device_id}/favorites", response_model=List[MemeResponse])
async def get_favorites(device_id: str):
    """Get user's favorite memes"""
    user = await db.users.find_one({"device_id": device_id})
    if not user or not user.get("favorites"):
        return []
    
    memes = await db.memes.find({"id": {"$in": user["favorites"]}}).to_list(100)
    return [MemeResponse(**meme) for meme in memes]

@api_router.post("/user/{device_id}/favorites")
async def toggle_favorite(device_id: str, action: FavoriteAction):
    """Add or remove a meme from favorites"""
    user = await db.users.find_one({"device_id": device_id})
    
    if not user:
        # Create new user
        user = UserData(device_id=device_id, favorites=[action.meme_id])
        await db.users.insert_one(user.dict())
        return {"action": "added", "favorites": user.favorites}
    
    favorites = user.get("favorites", [])
    
    if action.meme_id in favorites:
        favorites.remove(action.meme_id)
        action_taken = "removed"
    else:
        favorites.append(action.meme_id)
        action_taken = "added"
    
    await db.users.update_one(
        {"device_id": device_id},
        {"$set": {"favorites": favorites}}
    )
    
    return {"action": action_taken, "favorites": favorites}

@api_router.get("/user/{device_id}/recent", response_model=List[MemeResponse])
async def get_recent(device_id: str):
    """Get user's recently used memes"""
    user = await db.users.find_one({"device_id": device_id})
    if not user or not user.get("recently_used"):
        return []
    
    # Get memes in order of recently used
    recent_ids = user["recently_used"][-20:]  # Last 20
    recent_ids.reverse()  # Most recent first
    
    memes = await db.memes.find({"id": {"$in": recent_ids}}).to_list(100)
    
    # Sort by the order in recent_ids
    meme_dict = {m["id"]: m for m in memes}
    sorted_memes = [meme_dict[mid] for mid in recent_ids if mid in meme_dict]
    
    return [MemeResponse(**meme) for meme in sorted_memes]

@api_router.post("/user/{device_id}/recent")
async def add_to_recent(device_id: str, action: RecentAction):
    """Add a meme to recently used"""
    user = await db.users.find_one({"device_id": device_id})
    
    if not user:
        user = UserData(device_id=device_id, recently_used=[action.meme_id])
        await db.users.insert_one(user.dict())
        return {"message": "Added to recent"}
    
    recently_used = user.get("recently_used", [])
    
    # Remove if already exists (to move to end)
    if action.meme_id in recently_used:
        recently_used.remove(action.meme_id)
    
    recently_used.append(action.meme_id)
    
    # Keep only last 50
    if len(recently_used) > 50:
        recently_used = recently_used[-50:]
    
    await db.users.update_one(
        {"device_id": device_id},
        {"$set": {"recently_used": recently_used}}
    )
    
    # Also increment use count
    await db.memes.update_one(
        {"id": action.meme_id},
        {"$inc": {"use_count": 1}}
    )
    
    return {"message": "Added to recent"}

# ============ STATS ENDPOINT ============

@api_router.get("/stats")
async def get_stats():
    """Get app statistics"""
    meme_count = await db.memes.count_documents({})
    category_count = await db.categories.count_documents({})
    user_count = await db.users.count_documents({})
    
    return {
        "memes": meme_count,
        "categories": category_count,
        "users": user_count
    }

# ============ SEED DEFAULT CATEGORIES ============

@api_router.post("/seed-categories")
async def seed_categories():
    """Seed default categories"""
    default_categories = [
        {"name": "Reactions", "icon": "😂"},
        {"name": "Moods", "icon": "😌"},
        {"name": "Clapbacks", "icon": "👏"},
        {"name": "Relatable", "icon": "💯"},
        {"name": "Petty", "icon": "💅"},
        {"name": "Shady", "icon": "🙄"},
        {"name": "Unbothered", "icon": "😎"},
        {"name": "Facts", "icon": "📠"},
    ]
    
    for cat in default_categories:
        existing = await db.categories.find_one({"name": cat["name"]})
        if not existing:
            cat_obj = Category(**cat)
            await db.categories.insert_one(cat_obj.dict())
    
    return {"message": "Categories seeded"}

@api_router.get("/")
async def root():
    return {"message": "MemeVault API is running!"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Seed categories on startup"""
    logger.info("Seeding default categories...")
    default_categories = [
        {"name": "Reactions", "icon": "😂"},
        {"name": "Moods", "icon": "😌"},
        {"name": "Clapbacks", "icon": "👏"},
        {"name": "Relatable", "icon": "💯"},
        {"name": "Petty", "icon": "💅"},
        {"name": "Shady", "icon": "🙄"},
        {"name": "Unbothered", "icon": "😎"},
        {"name": "Facts", "icon": "📠"},
    ]
    
    for cat in default_categories:
        existing = await db.categories.find_one({"name": cat["name"]})
        if not existing:
            cat_obj = Category(**cat)
            await db.categories.insert_one(cat_obj.dict())
    logger.info("Categories seeded!")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
