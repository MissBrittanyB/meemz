from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
import base64
from passlib.context import CryptContext
from jose import JWTError, jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'memevault')]

# Create the main app
app = FastAPI(title="meemz API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Security
SECRET_KEY = os.environ.get("SECRET_KEY", "memevault-secret-key-change-in-production-2024")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

# ============ AUTH HELPERS ============

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        user = await db.users.find_one({"id": user_id})
        return user
    except JWTError:
        return None

async def get_required_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    user = await get_current_user(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

# ============ MODELS ============

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    username: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    avatar: Optional[str] = None
    bio: Optional[str] = None
    profile_image: Optional[str] = None
    social_links: Optional[dict] = None  # {"instagram": "", "twitter": "", "tiktok": ""}
    created_at: datetime
    meme_count: int = 0
    followers_count: int = 0
    following_count: int = 0

class UserUpdate(BaseModel):
    username: Optional[str] = None
    bio: Optional[str] = None
    avatar: Optional[str] = None
    profile_image: Optional[str] = None
    social_links: Optional[dict] = None

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
    user_id: Optional[str] = None  # Creator's user ID
    is_public: bool = True  # Public or private
    media_type: str = "image"  # "image", "gif", or "video"

class MemeCreate(BaseModel):
    name: str
    image_base64: str
    category: str
    tags: List[str] = []
    is_public: bool = True
    media_type: str = "image"  # "image", "gif", or "video"

class MemeResponse(BaseModel):
    id: str
    name: str
    image_base64: str
    category: str
    tags: List[str]
    use_count: int
    created_at: datetime
    user_id: Optional[str] = None
    is_public: bool = True
    username: Optional[str] = None  # Creator's username
    media_type: str = "image"  # "image", "gif", or "video"

class FavoriteAction(BaseModel):
    meme_id: str

class RecentAction(BaseModel):
    meme_id: str

# ============ AUTH ENDPOINTS ============

@api_router.post("/auth/register")
async def register(user_data: UserRegister):
    """Register a new user"""
    # Check if email exists
    existing_email = await db.users.find_one({"email": user_data.email.lower()})
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username exists
    existing_username = await db.users.find_one({"username": user_data.username.lower()})
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    # Create user
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": user_data.email.lower(),
        "username": user_data.username.lower(),
        "display_name": user_data.username,
        "password_hash": get_password_hash(user_data.password),
        "avatar": None,
        "bio": None,
        "created_at": datetime.utcnow(),
        "favorites": [],
        "recently_used": [],
        "followers": [],
        "following": [],
    }
    
    await db.users.insert_one(user)
    
    # Create token
    access_token = create_access_token(data={"sub": user_id})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": user["email"],
            "username": user["username"],
            "display_name": user["display_name"],
            "avatar": user["avatar"],
            "bio": user["bio"],
        }
    }

@api_router.post("/auth/login")
async def login(user_data: UserLogin):
    """Login user"""
    user = await db.users.find_one({"email": user_data.email.lower()})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(user_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Create token
    access_token = create_access_token(data={"sub": user["id"]})
    
    # Get meme count
    meme_count = await db.memes.count_documents({"user_id": user["id"]})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "username": user["username"],
            "display_name": user.get("display_name", user["username"]),
            "avatar": user.get("avatar"),
            "bio": user.get("bio"),
            "meme_count": meme_count,
        }
    }

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_required_user)):
    """Get current user"""
    meme_count = await db.memes.count_documents({"user_id": current_user["id"]})
    
    return {
        "id": current_user["id"],
        "email": current_user["email"],
        "username": current_user["username"],
        "display_name": current_user.get("display_name", current_user["username"]),
        "avatar": current_user.get("avatar"),
        "bio": current_user.get("bio"),
        "meme_count": meme_count,
        "favorites_count": len(current_user.get("favorites", [])),
    }

@api_router.put("/auth/me")
async def update_me(update_data: UserUpdate, current_user: dict = Depends(get_required_user)):
    """Update current user profile"""
    update_dict = {}
    
    if update_data.username:
        # Check if username is taken
        existing = await db.users.find_one({
            "username": update_data.username.lower(),
            "id": {"$ne": current_user["id"]}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        update_dict["username"] = update_data.username.lower()
        update_dict["display_name"] = update_data.username
    
    if update_data.bio is not None:
        update_dict["bio"] = update_data.bio
    
    if update_data.avatar is not None:
        update_dict["avatar"] = update_data.avatar

    if update_data.profile_image is not None:
        update_dict["profile_image"] = update_data.profile_image
    
    if update_data.social_links is not None:
        update_dict["social_links"] = update_data.social_links
    
    if update_dict:
        await db.users.update_one({"id": current_user["id"]}, {"$set": update_dict})
    
    return {"message": "Profile updated"}

# ============ USER PROFILE ENDPOINTS ============

@api_router.get("/users/{username}")
async def get_user_profile(username: str):
    """Get a user's public profile"""
    user = await db.users.find_one({"username": username.lower()})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    meme_count = await db.memes.count_documents({"user_id": user["id"], "is_public": True})
    
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user.get("display_name", user["username"]),
        "avatar": user.get("avatar"),
        "bio": user.get("bio"),
        "profile_image": user.get("profile_image"),
        "social_links": user.get("social_links"),
        "meme_count": meme_count,
        "created_at": user["created_at"],
    }

@api_router.get("/users/{username}/memes")
async def get_user_memes(username: str, current_user: dict = Depends(get_current_user)):
    """Get a user's memes"""
    user = await db.users.find_one({"username": username.lower()})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # If viewing own profile, show all memes; otherwise only public
    if current_user and current_user["id"] == user["id"]:
        memes = await db.memes.find({"user_id": user["id"]}).sort("created_at", -1).to_list(500)
    else:
        memes = await db.memes.find({"user_id": user["id"], "is_public": True}).sort("created_at", -1).to_list(500)
    
    return [MemeResponse(**meme, username=user["username"]) for meme in memes]

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
    limit: int = 20,
    skip: int = 0,
    public_only: bool = True
):
    """Get memes with optional filters"""
    query = {}
    
    if public_only:
        query["is_public"] = True
    
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"tags": {"$regex": search, "$options": "i"}}
        ]
    
    if category and category != "All":
        query["category"] = category
    
    memes = await db.memes.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    
    # Get usernames for memes with user_id
    result = []
    for meme in memes:
        username = None
        if meme.get("user_id"):
            user = await db.users.find_one({"id": meme["user_id"]})
            if user:
                username = user["username"]
        result.append(MemeResponse(**meme, username=username))
    
    return result

@api_router.get("/memes/explore")
async def explore_memes(limit: int = 20):
    """Get random public memes for discovery"""
    pipeline = [
        {"$match": {"is_public": True}},
        {"$sample": {"size": limit}}
    ]
    memes = await db.memes.aggregate(pipeline).to_list(limit)
    
    result = []
    for meme in memes:
        username = None
        if meme.get("user_id"):
            user = await db.users.find_one({"id": meme["user_id"]})
            if user:
                username = user["username"]
        result.append(MemeResponse(**meme, username=username))
    
    return result

@api_router.get("/memes/{meme_id}", response_model=MemeResponse)
async def get_meme(meme_id: str):
    """Get a single meme by ID"""
    meme = await db.memes.find_one({"id": meme_id})
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")
    
    username = None
    if meme.get("user_id"):
        user = await db.users.find_one({"id": meme["user_id"]})
        if user:
            username = user["username"]
    
    return MemeResponse(**meme, username=username)

@api_router.post("/memes", response_model=MemeResponse)
async def create_meme(meme: MemeCreate, current_user: dict = Depends(get_current_user)):
    """Create a new meme"""
    meme_obj = Meme(**meme.dict())
    
    # If user is logged in, associate meme with user
    if current_user:
        meme_obj.user_id = current_user["id"]
    
    await db.memes.insert_one(meme_obj.dict())
    
    # Update category meme count
    await db.categories.update_one(
        {"name": meme.category},
        {"$inc": {"meme_count": 1}}
    )
    
    username = None
    if current_user:
        username = current_user["username"]
    
    return MemeResponse(**meme_obj.dict(), username=username)

@api_router.put("/memes/{meme_id}")
async def update_meme(meme_id: str, meme_data: MemeCreate, current_user: dict = Depends(get_required_user)):
    """Update a meme (owner only)"""
    meme = await db.memes.find_one({"id": meme_id})
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")
    
    if meme.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized to edit this meme")
    
    update_dict = {
        "name": meme_data.name,
        "category": meme_data.category,
        "tags": meme_data.tags,
        "is_public": meme_data.is_public,
    }
    
    await db.memes.update_one({"id": meme_id}, {"$set": update_dict})
    return {"message": "Meme updated"}

@api_router.delete("/memes/{meme_id}")
async def delete_meme(meme_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a meme"""
    meme = await db.memes.find_one({"id": meme_id})
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")
    
    # Check if user owns the meme (if logged in) - allow admin delete for non-user memes
    if meme.get("user_id") and current_user:
        if meme["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to delete this meme")
    
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

# ============ USER FAVORITES & RECENT (with auth) ============

@api_router.get("/me/favorites")
async def get_my_favorites(current_user: dict = Depends(get_required_user)):
    """Get current user's favorite memes"""
    favorites = current_user.get("favorites", [])
    if not favorites:
        return []
    
    memes = await db.memes.find({"id": {"$in": favorites}}).to_list(500)
    return [MemeResponse(**meme) for meme in memes]

@api_router.post("/me/favorites")
async def toggle_my_favorite(action: FavoriteAction, current_user: dict = Depends(get_required_user)):
    """Add or remove a meme from favorites"""
    favorites = current_user.get("favorites", [])
    
    if action.meme_id in favorites:
        favorites.remove(action.meme_id)
        action_taken = "removed"
    else:
        favorites.append(action.meme_id)
        action_taken = "added"
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"favorites": favorites}}
    )
    
    return {"action": action_taken, "favorites": favorites}

@api_router.get("/me/recent")
async def get_my_recent(current_user: dict = Depends(get_required_user)):
    """Get current user's recently used memes"""
    recent = current_user.get("recently_used", [])[-20:]
    recent.reverse()
    
    if not recent:
        return []
    
    memes = await db.memes.find({"id": {"$in": recent}}).to_list(100)
    meme_dict = {m["id"]: m for m in memes}
    sorted_memes = [meme_dict[mid] for mid in recent if mid in meme_dict]
    
    return [MemeResponse(**meme) for meme in sorted_memes]

@api_router.post("/me/recent")
async def add_to_my_recent(action: RecentAction, current_user: dict = Depends(get_required_user)):
    """Add a meme to recently used"""
    recently_used = current_user.get("recently_used", [])
    
    if action.meme_id in recently_used:
        recently_used.remove(action.meme_id)
    
    recently_used.append(action.meme_id)
    
    if len(recently_used) > 50:
        recently_used = recently_used[-50:]
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"recently_used": recently_used}}
    )
    
    # Also increment use count
    await db.memes.update_one(
        {"id": action.meme_id},
        {"$inc": {"use_count": 1}}
    )
    
    return {"message": "Added to recent"}

# ============ LEGACY DEVICE-BASED ENDPOINTS (for non-logged in users) ============

@api_router.get("/user/{device_id}/favorites")
async def get_favorites(device_id: str):
    """Get user's favorite memes (legacy device-based)"""
    user = await db.device_users.find_one({"device_id": device_id})
    if not user or not user.get("favorites"):
        return []
    
    memes = await db.memes.find({"id": {"$in": user["favorites"]}}).to_list(100)
    return [MemeResponse(**meme) for meme in memes]

@api_router.post("/user/{device_id}/favorites")
async def toggle_favorite(device_id: str, action: FavoriteAction):
    """Add or remove a meme from favorites (legacy device-based)"""
    user = await db.device_users.find_one({"device_id": device_id})
    
    if not user:
        user = {"device_id": device_id, "favorites": [action.meme_id], "recently_used": []}
        await db.device_users.insert_one(user)
        return {"action": "added", "favorites": user["favorites"]}
    
    favorites = user.get("favorites", [])
    
    if action.meme_id in favorites:
        favorites.remove(action.meme_id)
        action_taken = "removed"
    else:
        favorites.append(action.meme_id)
        action_taken = "added"
    
    await db.device_users.update_one(
        {"device_id": device_id},
        {"$set": {"favorites": favorites}}
    )
    
    return {"action": action_taken, "favorites": favorites}

@api_router.get("/user/{device_id}/recent")
async def get_recent(device_id: str):
    """Get user's recently used memes (legacy device-based)"""
    user = await db.device_users.find_one({"device_id": device_id})
    if not user or not user.get("recently_used"):
        return []
    
    recent_ids = user["recently_used"][-20:]
    recent_ids.reverse()
    
    memes = await db.memes.find({"id": {"$in": recent_ids}}).to_list(100)
    meme_dict = {m["id"]: m for m in memes}
    sorted_memes = [meme_dict[mid] for mid in recent_ids if mid in meme_dict]
    
    return [MemeResponse(**meme) for meme in sorted_memes]

@api_router.post("/user/{device_id}/recent")
async def add_to_recent(device_id: str, action: RecentAction):
    """Add a meme to recently used (legacy device-based)"""
    user = await db.device_users.find_one({"device_id": device_id})
    
    if not user:
        user = {"device_id": device_id, "favorites": [], "recently_used": [action.meme_id]}
        await db.device_users.insert_one(user)
        return {"message": "Added to recent"}
    
    recently_used = user.get("recently_used", [])
    
    if action.meme_id in recently_used:
        recently_used.remove(action.meme_id)
    
    recently_used.append(action.meme_id)
    
    if len(recently_used) > 50:
        recently_used = recently_used[-50:]
    
    await db.device_users.update_one(
        {"device_id": device_id},
        {"$set": {"recently_used": recently_used}}
    )
    
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
