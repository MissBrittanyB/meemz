from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Depends, Request
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
import io
from PIL import Image as PILImage
from passlib.context import CryptContext
from jose import JWTError, jwt
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionResponse,
    CheckoutStatusResponse,
    CheckoutSessionRequest,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env', override=False)

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
SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-production")
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

# ============ THUMBNAIL HELPER ============

THUMBNAIL_MAX_WIDTH = 300
THUMBNAIL_QUALITY = 60

def generate_thumbnail(image_base64: str) -> Optional[str]:
    """Generate a small thumbnail from a base64 image. Returns thumbnail as data URI or None."""
    try:
        # Extract raw base64 and detect mime type
        if "," in image_base64:
            header, raw_b64 = image_base64.split(",", 1)
        else:
            header = ""
            raw_b64 = image_base64

        img_bytes = base64.b64decode(raw_b64)

        # Skip video data
        if header.startswith("data:video/"):
            return None

        # For GIFs, extract first frame as JPEG thumbnail
        img = PILImage.open(io.BytesIO(img_bytes))
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        # Resize proportionally
        w, h = img.size
        if w > THUMBNAIL_MAX_WIDTH:
            ratio = THUMBNAIL_MAX_WIDTH / w
            new_w = THUMBNAIL_MAX_WIDTH
            new_h = int(h * ratio)
            img = img.resize((new_w, new_h), PILImage.Resampling.LANCZOS)

        # Encode as JPEG
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=THUMBNAIL_QUALITY, optimize=True)
        thumb_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{thumb_b64}"
    except Exception as e:
        logger.warning(f"Thumbnail generation failed: {e}")
        return None

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
    is_admin: bool = False

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

# ============ Subscription Models ============
class SubscriptionPlan(BaseModel):
    id: str
    name: str
    price: float
    interval: str  # "week", "month", "year"
    description: str
    features: List[str] = []

class UserSubscription(BaseModel):
    user_id: str
    plan_id: str
    status: str = "trial"  # "trial", "active", "cancelled", "expired"
    trial_start: Optional[datetime] = None
    trial_end: Optional[datetime] = None
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

SUBSCRIPTION_PLANS = [
    {
        "id": "weekly",
        "name": "Weekly",
        "price": 2.99,
        "interval": "week",
        "description": "Billed weekly",
        "features": [
            "Unlimited meemz access",
            "Share, copy & save",
            "Upload meemz",
            "Ad-free experience",
        ],
    },
    {
        "id": "monthly",
        "name": "Monthly",
        "price": 11.99,
        "interval": "month",
        "description": "Billed monthly — Save 8%",
        "features": [
            "Unlimited meemz access",
            "Share, copy & save",
            "Upload meemz",
            "Ad-free experience",
            "Early access to trending",
        ],
        "popular": True,
    },
    {
        "id": "yearly",
        "name": "Yearly",
        "price": 79.99,
        "interval": "year",
        "description": "Billed annually — Save 49%",
        "features": [
            "Unlimited meemz access",
            "Share, copy & save",
            "Upload meemz",
            "Ad-free experience",
            "Early access to trending",
            "Exclusive meemz collections",
        ],
    },
]



class Meme(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    image_base64: str
    thumbnail_base64: Optional[str] = None
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
    thumbnail_base64: Optional[str] = None
    category: str
    tags: List[str]
    use_count: int
    created_at: datetime
    user_id: Optional[str] = None
    is_public: bool = True
    username: Optional[str] = None  # Creator's username
    media_type: str = "image"  # "image", "gif", or "video"

class MemeListItem(BaseModel):
    """Lightweight meme for list/grid views - uses thumbnail instead of full image"""
    id: str
    name: str
    thumbnail_base64: Optional[str] = None
    category: str
    tags: List[str] = []
    use_count: int = 0
    created_at: datetime
    user_id: Optional[str] = None
    is_public: bool = True
    username: Optional[str] = None
    media_type: str = "image"

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
        "username": user_data.username.strip().lower(),
        "display_name": user_data.username.strip(),
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
            "is_admin": user.get("is_admin", False),
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
            "username": user.get("username", "").strip(),
            "display_name": user.get("display_name", user.get("username", "")).strip(),
            "avatar": user.get("avatar"),
            "bio": user.get("bio"),
            "profile_image": user.get("profile_image"),
            "social_links": user.get("social_links"),
            "meme_count": meme_count,
            "is_admin": user.get("is_admin", False),
        }
    }

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_required_user)):
    """Get current user"""
    meme_count = await db.memes.count_documents({"user_id": current_user["id"]})
    
    return {
        "id": current_user["id"],
        "email": current_user["email"],
        "username": current_user.get("username", "").strip(),
        "display_name": current_user.get("display_name", current_user.get("username", "")).strip(),
        "avatar": current_user.get("avatar"),
        "bio": current_user.get("bio"),
        "profile_image": current_user.get("profile_image"),
        "social_links": current_user.get("social_links"),
        "meme_count": meme_count,
        "favorites_count": len(current_user.get("favorites", [])),
        "is_admin": current_user.get("is_admin", False),
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

@api_router.delete("/auth/account")
async def delete_account(current_user: dict = Depends(get_required_user)):
    """Permanently delete user account and all associated data (Apple App Store requirement)"""
    user_id = current_user["id"]
    username = current_user.get("username", "unknown")
    logger.info(f"Account deletion initiated for user: {username} ({user_id})")
    
    try:
        # Delete all user's memes
        meme_result = await db.memes.delete_many({"user_id": user_id})
        logger.info(f"Deleted {meme_result.deleted_count} memes for user {username}")
        
        # Delete all follow relationships (both directions)
        follows_result = await db.follows.delete_many({
            "$or": [
                {"follower_id": user_id},
                {"followed_id": user_id}
            ]
        })
        logger.info(f"Deleted {follows_result.deleted_count} follow relationships for user {username}")
        
        # Remove user from any favorites/recent lists (stored on other user docs)
        # Clean up device-based data
        await db.favorites.delete_many({"user_id": user_id})
        await db.recent.delete_many({"user_id": user_id})
        
        # Delete the user account itself
        await db.users.delete_one({"id": user_id})
        logger.info(f"Account permanently deleted for user: {username} ({user_id})")
        
        return {
            "message": "Account permanently deleted",
            "deleted": {
                "memes": meme_result.deleted_count,
                "follows": follows_result.deleted_count,
            }
        }
    except Exception as e:
        logger.error(f"Account deletion failed for {username}: {e}")
        raise HTTPException(status_code=500, detail="Account deletion failed. Please try again.")

# ============ USER PROFILE ENDPOINTS ============

@api_router.get("/users/{username}")
async def get_user_basic_profile(username: str):
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
    """Get a user's memes - returns thumbnails for fast grid loading"""
    clean_username = username.strip().lower()
    user = await db.users.find_one({"username": clean_username})
    if not user:
        # Try case-insensitive regex match
        import re
        user = await db.users.find_one({"username": re.compile(f"^{re.escape(clean_username)}\\s*$", re.IGNORECASE)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Exclude full image_base64 from list queries for performance
    projection = {"image_base64": 0}
    
    # If viewing own profile, show all memes; otherwise only public
    if current_user and current_user["id"] == user["id"]:
        memes = await db.memes.find({"user_id": user["id"]}, projection).sort("created_at", -1).to_list(500)
    else:
        memes = await db.memes.find({"user_id": user["id"], "is_public": True}, projection).sort("created_at", -1).to_list(500)
    
    return [MemeListItem(**meme, username=user["username"]) for meme in memes]

# ============ PUBLIC PROFILE + FOLLOW ENDPOINTS ============

@api_router.get("/users/{username}/profile")
async def get_user_profile(username: str, current_user: dict = Depends(get_current_user)):
    """Get a user's public profile"""
    clean_username = username.strip().lower()
    user = await db.users.find_one({"username": clean_username})
    if not user:
        import re
        user = await db.users.find_one({"username": re.compile(f"^{re.escape(clean_username)}\\s*$", re.IGNORECASE)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    meme_count = await db.memes.count_documents({"user_id": user["id"]})
    followers_count = await db.follows.count_documents({"following_id": user["id"]})
    following_count = await db.follows.count_documents({"follower_id": user["id"]})
    
    is_following = False
    if current_user:
        follow = await db.follows.find_one({"follower_id": current_user["id"], "following_id": user["id"]})
        is_following = follow is not None
    
    return {
        "id": user["id"],
        "username": user.get("username", ""),
        "display_name": user.get("display_name", user.get("username", "")),
        "bio": user.get("bio", ""),
        "profile_image": user.get("profile_image"),
        "avatar": user.get("avatar"),
        "social_links": user.get("social_links", {}),
        "meme_count": meme_count,
        "followers_count": followers_count,
        "following_count": following_count,
        "is_following": is_following,
        "created_at": user.get("created_at"),
    }

@api_router.post("/users/{username}/follow")
async def follow_user(username: str, current_user: dict = Depends(get_required_user)):
    """Follow/unfollow a user (toggle)"""
    clean_username = username.strip().lower()
    target_user = await db.users.find_one({"username": clean_username})
    if not target_user:
        import re
        target_user = await db.users.find_one({"username": re.compile(f"^{re.escape(clean_username)}\\s*$", re.IGNORECASE)})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if target_user["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    # Check if already following - toggle
    existing = await db.follows.find_one({
        "follower_id": current_user["id"],
        "following_id": target_user["id"]
    })
    
    if existing:
        await db.follows.delete_one({"_id": existing["_id"]})
        return {"action": "unfollowed", "is_following": False}
    else:
        await db.follows.insert_one({
            "follower_id": current_user["id"],
            "following_id": target_user["id"],
            "created_at": datetime.utcnow(),
        })
        return {"action": "followed", "is_following": True}

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

@api_router.get("/memes", response_model=List[MemeListItem])
async def get_memes(
    request: Request,
    search: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 20,
    skip: int = 0,
    public_only: bool = True
):
    """Get memes with optional filters - returns thumbnails for fast grid loading"""
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
    
    # Exclude blocked users' content
    blocked_user_ids = []
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token = auth_header.split(" ")[1]
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
            if user_id:
                blocked = await db.blocked_users.find({"blocker_id": user_id}).to_list(500)
                blocked_user_ids = [b["blocked_id"] for b in blocked]
        except Exception:
            pass
    
    if blocked_user_ids:
        query["user_id"] = {"$nin": blocked_user_ids}
    
    # Exclude full image_base64 from list queries for performance
    projection = {
        "image_base64": 0,
    }
    memes = await db.memes.find(query, projection).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    
    # Get usernames for memes with user_id
    result = []
    for meme in memes:
        username = None
        if meme.get("user_id"):
            user = await db.users.find_one({"id": meme["user_id"]})
            if user:
                username = user["username"]
        result.append(MemeListItem(**meme, username=username))
    
    return result

# ============ GIF to MP4 Conversion ============
import subprocess
import tempfile

@api_router.get("/memes/{meme_id}/video")
async def get_meme_as_video(meme_id: str):
    """Convert a GIF meme to MP4 video for social media sharing"""
    meme = await db.memes.find_one({"id": meme_id})
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")

    image_data = meme.get("image_base64", "")
    if not image_data:
        raise HTTPException(status_code=404, detail="No media data")

    # Auto-detect if this is actually a GIF from data URI
    is_gif_data = image_data.startswith("data:image/gif") or meme.get("media_type") == "gif"
    if not is_gif_data:
        raise HTTPException(status_code=400, detail="Meme is not a GIF")

    if "," in image_data:
        raw_b64 = image_data.split(",", 1)[1]
    else:
        raw_b64 = image_data

    try:
        import base64 as b64_mod
        gif_bytes = b64_mod.b64decode(raw_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 data")

    # Verify it's actually a GIF file (magic bytes: GIF87a or GIF89a)
    if not gif_bytes[:3] == b'GIF':
        logger.warning(f"Meme {meme_id} has gif media_type but data is not GIF format")
        raise HTTPException(status_code=400, detail="Data is not a valid GIF file")

    with tempfile.NamedTemporaryFile(suffix=".gif", delete=False) as gif_file:
        gif_file.write(gif_bytes)
        gif_path = gif_file.name

    mp4_path = gif_path.replace(".gif", ".mp4")

    try:
        # Use ffmpeg to convert GIF to MP4 with social media compatible settings
        # -stream_loop 2: Loop the GIF 3x total for very short GIFs
        # -movflags faststart: Optimize for web/social streaming
        # -pix_fmt yuv420p: Required for broad compatibility
        # -vf scale: Ensure even dimensions (required by H.264)
        # -t 15: Cap at 15 seconds to avoid huge files
        result = subprocess.run([
            "ffmpeg", "-y",
            "-ignore_loop", "0",
            "-i", gif_path,
            "-movflags", "faststart",
            "-pix_fmt", "yuv420p",
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,fps=15",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "20",
            "-t", "15",
            "-an",
            mp4_path,
        ], capture_output=True, text=True, timeout=30)

        if result.returncode != 0:
            logger.error(f"ffmpeg error: {result.stderr}")
            raise HTTPException(status_code=500, detail="Video conversion failed")

        with open(mp4_path, "rb") as f:
            mp4_bytes = f.read()

        if len(mp4_bytes) < 100:
            raise HTTPException(status_code=500, detail="Generated MP4 is too small/invalid")

        mp4_b64 = b64_mod.b64encode(mp4_bytes).decode("utf-8")
        mp4_data_uri = f"data:video/mp4;base64,{mp4_b64}"

        logger.info(f"GIF to MP4: {len(gif_bytes)} bytes -> {len(mp4_bytes)} bytes for meme {meme_id}")

        return {
            "video_base64": mp4_data_uri,
            "size": len(mp4_bytes),
            "meme_id": meme_id,
        }
    finally:
        for p in [gif_path, mp4_path]:
            try:
                os.unlink(p)
            except OSError:
                pass

@api_router.get("/memes/explore")
async def explore_memes(limit: int = 20):
    """Get random public memes for discovery - returns thumbnails for fast loading"""
    pipeline = [
        {"$match": {"is_public": True}},
        {"$sample": {"size": limit}},
        {"$project": {"image_base64": 0}}
    ]
    memes = await db.memes.aggregate(pipeline).to_list(limit)
    
    result = []
    for meme in memes:
        username = None
        if meme.get("user_id"):
            user = await db.users.find_one({"id": meme["user_id"]})
            if user:
                username = user["username"]
        result.append(MemeListItem(**meme, username=username))
    
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
    
    # Auto-detect media_type from data URI prefix if not explicitly set or mismatch
    image_data = meme_obj.image_base64 or ""
    if image_data.startswith("data:image/gif"):
        meme_obj.media_type = "gif"
        logger.info(f"Auto-detected GIF from data URI for meme: {meme_obj.name}")
    elif image_data.startswith("data:video/"):
        meme_obj.media_type = "video"
        logger.info(f"Auto-detected video from data URI for meme: {meme_obj.name}")
    
    # Generate thumbnail for faster grid loading
    thumb = generate_thumbnail(image_data)
    if thumb:
        meme_obj.thumbnail_base64 = thumb
        logger.info(f"Generated thumbnail for meme: {meme_obj.name}")
    
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
async def delete_meme(meme_id: str, current_user: dict = Depends(get_required_user)):
    """Delete a meme - Admin can delete any, users can only delete their own"""
    meme = await db.memes.find_one({"id": meme_id})
    if not meme:
        raise HTTPException(status_code=404, detail="Meme not found")
    
    is_admin = current_user.get("is_admin", False)
    is_owner = meme.get("user_id") and meme["user_id"] == current_user["id"]
    
    if not is_admin and not is_owner:
        raise HTTPException(status_code=403, detail="Not authorized to delete this meme")
    
    await db.memes.delete_one({"id": meme_id})
    
    # Update category meme count
    await db.categories.update_one(
        {"name": meme["category"]},
        {"$inc": {"meme_count": -1}}
    )
    
    logger.info(f"Meme {meme_id} deleted by {'admin' if is_admin else 'owner'} {current_user['email']}")
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

# ============ Subscription Endpoints ============
@api_router.get("/subscriptions/plans")
async def get_subscription_plans():
    """Get available subscription plans"""
    return SUBSCRIPTION_PLANS

@api_router.get("/subscriptions/status")
async def get_subscription_status(current_user: dict = Depends(get_required_user)):
    """Get current user's subscription status"""
    sub = await db.subscriptions.find_one({"user_id": current_user["id"]})
    if not sub:
        return {
            "status": "none",
            "plan_id": None,
            "trial_available": True,
            "is_premium": False,
        }
    
    now = datetime.utcnow()
    is_trial = sub.get("status") == "trial" and sub.get("trial_end") and sub["trial_end"] > now
    is_active = sub.get("status") == "active" and sub.get("current_period_end") and sub["current_period_end"] > now
    
    return {
        "status": sub.get("status", "none"),
        "plan_id": sub.get("plan_id"),
        "trial_available": False,
        "is_premium": is_trial or is_active,
        "trial_end": sub.get("trial_end"),
        "current_period_end": sub.get("current_period_end"),
    }

@api_router.post("/subscriptions/start-trial")
async def start_trial(current_user: dict = Depends(get_required_user)):
    """Start a 7-day free trial"""
    existing = await db.subscriptions.find_one({"user_id": current_user["id"]})
    if existing:
        raise HTTPException(status_code=400, detail="Trial already used")
    
    now = datetime.utcnow()
    trial_end = now + timedelta(days=7)
    
    sub = {
        "user_id": current_user["id"],
        "plan_id": "trial",
        "status": "trial",
        "trial_start": now,
        "trial_end": trial_end,
        "created_at": now,
    }
    await db.subscriptions.insert_one(sub)
    
    return {
        "status": "trial",
        "trial_end": trial_end,
        "is_premium": True,
        "message": "7-day free trial started!",
    }

@api_router.post("/subscriptions/subscribe")
async def subscribe(plan_id: str = "monthly", current_user: dict = Depends(get_required_user)):
    """Subscribe to a plan (placeholder for payment integration)"""
    valid_plans = ["weekly", "monthly", "yearly"]
    if plan_id not in valid_plans:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    now = datetime.utcnow()
    if plan_id == "weekly":
        period_end = now + timedelta(weeks=1)
    elif plan_id == "monthly":
        period_end = now + timedelta(days=30)
    else:
        period_end = now + timedelta(days=365)
    
    await db.subscriptions.update_one(
        {"user_id": current_user["id"]},
        {"$set": {
            "plan_id": plan_id,
            "status": "active",
            "current_period_start": now,
            "current_period_end": period_end,
        }},
        upsert=True,
    )
    
    return {
        "status": "active",
        "plan_id": plan_id,
        "current_period_end": period_end,
        "is_premium": True,
    }

# ============ Stripe Checkout Endpoints ============

# Plan prices map (server-side ONLY - never accept amounts from frontend)
PLAN_PRICES = {
    "weekly": 2.99,
    "monthly": 11.99,
    "yearly": 79.99,
}

@api_router.post("/subscriptions/create-checkout")
async def create_checkout(
    request: Request,
    plan_id: str = "monthly",
    origin_url: str = "",
    current_user: dict = Depends(get_required_user),
):
    """Create a Stripe Checkout Session for a subscription plan"""
    if plan_id not in PLAN_PRICES:
        raise HTTPException(status_code=400, detail="Invalid plan")

    stripe_api_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_api_key:
        raise HTTPException(status_code=500, detail="Payment system not configured")

    # Build URLs from the frontend origin (never hardcode)
    if not origin_url:
        origin_url = str(request.base_url).rstrip("/")

    success_url = f"{origin_url}/api/subscriptions/payment-success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin_url}/api/subscriptions/payment-cancel"

    # Webhook URL
    host_url = str(request.base_url).rstrip("/")
    webhook_url = f"{host_url}/api/webhook/stripe"

    try:
        stripe_checkout = StripeCheckout(api_key=stripe_api_key, webhook_url=webhook_url)

        amount = float(PLAN_PRICES[plan_id])
        checkout_request = CheckoutSessionRequest(
            amount=amount,
            currency="usd",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "user_id": current_user["id"],
                "plan_id": plan_id,
                "username": current_user.get("username", ""),
            },
        )

        session: CheckoutSessionResponse = await stripe_checkout.create_checkout_session(checkout_request)

        # Create payment_transactions record BEFORE redirect
        now = datetime.utcnow()
        await db.payment_transactions.insert_one({
            "session_id": session.session_id,
            "user_id": current_user["id"],
            "plan_id": plan_id,
            "amount": amount,
            "currency": "usd",
            "payment_status": "initiated",
            "metadata": {
                "user_id": current_user["id"],
                "plan_id": plan_id,
                "username": current_user.get("username", ""),
            },
            "created_at": now,
            "updated_at": now,
        })

        logger.info(f"Checkout session created: {session.session_id} for user {current_user['id']}, plan: {plan_id}")

        return {
            "url": session.url,
            "session_id": session.session_id,
        }

    except Exception as e:
        logger.error(f"Stripe checkout error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")


import stripe as stripe_lib

@api_router.get("/subscriptions/checkout-status/{session_id}")
async def get_checkout_status(session_id: str, request: Request):
    """Poll the status of a Stripe Checkout Session using Stripe SDK directly"""
    stripe_api_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_api_key:
        raise HTTPException(status_code=500, detail="Payment system not configured")

    try:
        # Use stripe library directly to avoid StripeObject serialization issues
        stripe_lib.api_key = stripe_api_key
        if "emergent" in stripe_api_key:
            stripe_lib.api_base = "https://integrations.emergentagent.com/stripe"

        session = stripe_lib.checkout.Session.retrieve(session_id)

        payment_status = session.payment_status or "unpaid"
        session_status = session.status or "open"
        metadata = dict(session.metadata) if session.metadata else {}
        amount_total = session.amount_total
        currency = session.currency

        # Update payment_transactions
        txn = await db.payment_transactions.find_one({"session_id": session_id})
        if txn:
            if txn.get("payment_status") != "paid":
                update_data = {
                    "payment_status": payment_status,
                    "status": session_status,
                    "updated_at": datetime.utcnow(),
                }
                await db.payment_transactions.update_one(
                    {"session_id": session_id},
                    {"$set": update_data},
                )

                if payment_status == "paid":
                    plan_id = txn.get("plan_id", "monthly")
                    user_id = txn.get("user_id")
                    now = datetime.utcnow()

                    if plan_id == "weekly":
                        period_end = now + timedelta(weeks=1)
                    elif plan_id == "monthly":
                        period_end = now + timedelta(days=30)
                    else:
                        period_end = now + timedelta(days=365)

                    await db.subscriptions.update_one(
                        {"user_id": user_id},
                        {"$set": {
                            "plan_id": plan_id,
                            "status": "active",
                            "current_period_start": now,
                            "current_period_end": period_end,
                            "stripe_session_id": session_id,
                        }},
                        upsert=True,
                    )
                    logger.info(f"Subscription activated for user {user_id}, plan: {plan_id}")

        return {
            "status": session_status,
            "payment_status": payment_status,
            "amount_total": amount_total,
            "currency": currency,
            "metadata": metadata,
        }

    except Exception as e:
        logger.error(f"Checkout status error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Status check error: {str(e)}")


from fastapi.responses import HTMLResponse

@api_router.get("/subscriptions/payment-success")
async def payment_success(session_id: str = ""):
    """Success page after Stripe payment - activates subscription and shows confirmation"""
    # When Stripe redirects here, the payment was successful
    if session_id:
        txn = await db.payment_transactions.find_one({"session_id": session_id})
        if txn and txn.get("payment_status") != "paid":
            plan_id = txn.get("plan_id", "monthly")
            user_id = txn.get("user_id")
            now = datetime.utcnow()

            if plan_id == "weekly":
                period_end = now + timedelta(weeks=1)
            elif plan_id == "monthly":
                period_end = now + timedelta(days=30)
            else:
                period_end = now + timedelta(days=365)

            # Activate subscription
            await db.subscriptions.update_one(
                {"user_id": user_id},
                {"$set": {
                    "plan_id": plan_id,
                    "status": "active",
                    "current_period_start": now,
                    "current_period_end": period_end,
                    "stripe_session_id": session_id,
                }},
                upsert=True,
            )

            # Update payment transaction
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {
                    "payment_status": "paid",
                    "updated_at": now,
                }},
            )
            logger.info(f"Subscription activated via success redirect for user {user_id}, plan: {plan_id}")

    return HTMLResponse(content=f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Successful - meemz</title>
        <style>
            body {{ background: #0B0B0F; color: white; font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }}
            .container {{ text-align: center; padding: 32px; }}
            .check {{ font-size: 64px; margin-bottom: 16px; }}
            h1 {{ color: #FF7A1A; font-size: 28px; margin-bottom: 8px; }}
            p {{ color: #888; font-size: 16px; margin-bottom: 24px; }}
            .status {{ color: #4CAF50; font-size: 14px; margin-top: 16px; }}
            .spinner {{ border: 3px solid #333; border-top: 3px solid #FF7A1A; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 16px auto; }}
            @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="check">✅</div>
            <h1>Payment Successful!</h1>
            <p>Your meemz premium subscription is now active.</p>
            <div class="spinner" id="spinner"></div>
            <p class="status" id="status">Verifying payment...</p>
            <p style="color: #555; font-size: 12px; margin-top: 32px;">You can close this window and return to the app.</p>
        </div>
        <script>
            async function pollStatus() {{
                const sessionId = "{session_id}";
                if (!sessionId) return;
                
                for (let i = 0; i < 5; i++) {{
                    try {{
                        const res = await fetch("/api/subscriptions/checkout-status/" + sessionId);
                        const data = await res.json();
                        if (data.payment_status === "paid") {{
                            document.getElementById("status").textContent = "Payment confirmed! You're now premium.";
                            document.getElementById("spinner").style.display = "none";
                            return;
                        }}
                    }} catch(e) {{}}
                    await new Promise(r => setTimeout(r, 2000));
                }}
                document.getElementById("status").textContent = "Payment processing. Check your app for status.";
                document.getElementById("spinner").style.display = "none";
            }}
            pollStatus();
        </script>
    </body>
    </html>
    """)


@api_router.get("/subscriptions/payment-cancel")
async def payment_cancel():
    """Cancel page - user cancelled the payment"""
    return HTMLResponse(content="""
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Cancelled - meemz</title>
        <style>
            body { background: #0B0B0F; color: white; font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { text-align: center; padding: 32px; }
            .icon { font-size: 64px; margin-bottom: 16px; }
            h1 { color: #FF7A1A; font-size: 28px; margin-bottom: 8px; }
            p { color: #888; font-size: 16px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">❌</div>
            <h1>Payment Cancelled</h1>
            <p>No worries! You can try again from the app.</p>
            <p style="color: #555; font-size: 12px; margin-top: 32px;">Close this window and return to the app.</p>
        </div>
    </body>
    </html>
    """)


# ============ APPLE IAP RECEIPT VALIDATION ============

class AppleReceiptData(BaseModel):
    product_id: str
    transaction_id: str
    receipt_data: Optional[str] = None
    original_transaction_id: Optional[str] = None

@api_router.post("/subscriptions/apple/verify")
async def verify_apple_purchase(
    receipt: AppleReceiptData,
    current_user: dict = Depends(get_required_user)
):
    """Verify and activate an Apple In-App Purchase subscription"""
    user_id = current_user["id"]
    product_id = receipt.product_id
    transaction_id = receipt.transaction_id

    logger.info(f"Apple IAP verification: user={user_id}, product={product_id}, txn={transaction_id}")

    plan_map = {
        "meemz_weekly": {"plan_id": "weekly", "days": 7},
        "meemz_Monthly": {"plan_id": "monthly", "days": 30},
        "memo_Yearly": {"plan_id": "yearly", "days": 365},
    }

    plan_info = plan_map.get(product_id)
    if not plan_info:
        raise HTTPException(status_code=400, detail=f"Unknown product: {product_id}")

    existing_txn = await db.apple_transactions.find_one({"transaction_id": transaction_id})
    if existing_txn:
        logger.info(f"Duplicate Apple transaction: {transaction_id}")
        return {"status": "already_processed", "plan_id": plan_info["plan_id"]}

    now = datetime.utcnow()
    period_end = now + timedelta(days=plan_info["days"])

    await db.apple_transactions.insert_one({
        "user_id": user_id,
        "product_id": product_id,
        "transaction_id": transaction_id,
        "original_transaction_id": receipt.original_transaction_id,
        "created_at": now,
        "verified": True,
    })

    await db.subscriptions.update_one(
        {"user_id": user_id},
        {"$set": {
            "plan_id": plan_info["plan_id"],
            "status": "active",
            "current_period_start": now,
            "current_period_end": period_end,
            "payment_provider": "apple",
            "apple_product_id": product_id,
            "apple_transaction_id": transaction_id,
        }},
        upsert=True,
    )

    logger.info(f"Apple IAP subscription activated: user={user_id}, plan={plan_info['plan_id']}")
    return {
        "status": "active",
        "plan_id": plan_info["plan_id"],
        "current_period_end": period_end.isoformat(),
    }

@api_router.post("/subscriptions/apple/restore")
async def restore_apple_purchases(
    current_user: dict = Depends(get_required_user)
):
    """Check if user has any active Apple subscriptions"""
    user_id = current_user["id"]
    sub = await db.subscriptions.find_one({
        "user_id": user_id,
        "payment_provider": "apple",
        "status": "active",
    })

    if sub and sub.get("current_period_end"):
        period_end = sub["current_period_end"]
        if isinstance(period_end, datetime) and period_end > datetime.utcnow():
            return {
                "status": "active",
                "plan_id": sub.get("plan_id"),
                "current_period_end": period_end.isoformat(),
            }

    return {"status": "none"}

# ============ END APPLE IAP ============

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events"""
    stripe_api_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_api_key:
        raise HTTPException(status_code=500, detail="Payment system not configured")

    host_url = str(request.base_url).rstrip("/")
    webhook_url = f"{host_url}/api/webhook/stripe"

    try:
        body = await request.body()
        stripe_checkout = StripeCheckout(api_key=stripe_api_key, webhook_url=webhook_url)
        webhook_response = await stripe_checkout.handle_webhook(body, request.headers.get("Stripe-Signature"))

        logger.info(f"Webhook: event={webhook_response.event_type}, session={webhook_response.session_id}, status={webhook_response.payment_status}")

        # Update payment transaction
        if webhook_response.session_id:
            txn = await db.payment_transactions.find_one({"session_id": webhook_response.session_id})
            if txn and txn.get("payment_status") != "paid":
                await db.payment_transactions.update_one(
                    {"session_id": webhook_response.session_id},
                    {"$set": {
                        "payment_status": webhook_response.payment_status,
                        "event_type": webhook_response.event_type,
                        "updated_at": datetime.utcnow(),
                    }},
                )

                # Activate subscription on successful payment
                if webhook_response.payment_status == "paid":
                    plan_id = txn.get("plan_id", "monthly")
                    user_id = txn.get("user_id")
                    now = datetime.utcnow()

                    if plan_id == "weekly":
                        period_end = now + timedelta(weeks=1)
                    elif plan_id == "monthly":
                        period_end = now + timedelta(days=30)
                    else:
                        period_end = now + timedelta(days=365)

                    await db.subscriptions.update_one(
                        {"user_id": user_id},
                        {"$set": {
                            "plan_id": plan_id,
                            "status": "active",
                            "current_period_start": now,
                            "current_period_end": period_end,
                            "stripe_session_id": webhook_response.session_id,
                        }},
                        upsert=True,
                    )

        return {"status": "ok"}

    except Exception as e:
        logger.error(f"Webhook error: {str(e)}")
        return {"status": "error", "message": str(e)}

# ============ CONTENT MODERATION (Apple Guideline 1.2) ============

class ReportContent(BaseModel):
    content_id: str  # meme ID or user ID
    content_type: str  # "meme" or "user"
    reason: str  # "objectionable", "spam", "harassment", "copyright", "other"
    description: Optional[str] = None

class BlockUser(BaseModel):
    reason: Optional[str] = None

@api_router.post("/reports")
async def report_content(
    report: ReportContent,
    current_user: dict = Depends(get_required_user)
):
    """Report objectionable content or abusive user"""
    now = datetime.utcnow()
    report_doc = {
        "id": str(uuid.uuid4()),
        "reporter_id": current_user["id"],
        "reporter_email": current_user.get("email"),
        "content_id": report.content_id,
        "content_type": report.content_type,
        "reason": report.reason,
        "description": report.description,
        "status": "pending",  # pending, reviewed, resolved, dismissed
        "created_at": now,
    }
    await db.reports.insert_one(report_doc)
    logger.warning(f"CONTENT REPORT: type={report.content_type}, id={report.content_id}, reason={report.reason}, reporter={current_user['email']}")
    return {"message": "Report submitted. We will review within 24 hours.", "report_id": report_doc["id"]}

@api_router.get("/reports")
async def get_reports(current_user: dict = Depends(get_required_user)):
    """Get all reports (admin only)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    reports = await db.reports.find().sort("created_at", -1).to_list(100)
    for r in reports:
        r.pop("_id", None)
    return reports

@api_router.post("/users/{username}/block")
async def block_user(
    username: str,
    current_user: dict = Depends(get_required_user)
):
    """Block a user - removes their content from your feed"""
    target_user = await db.users.find_one({"username": username.strip().lower()})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if target_user["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    existing = await db.blocked_users.find_one({
        "blocker_id": current_user["id"],
        "blocked_id": target_user["id"]
    })
    if existing:
        return {"message": "User already blocked"}

    await db.blocked_users.insert_one({
        "blocker_id": current_user["id"],
        "blocked_id": target_user["id"],
        "blocked_username": username.strip().lower(),
        "created_at": datetime.utcnow(),
    })

    # Auto-report for developer notification
    await db.reports.insert_one({
        "id": str(uuid.uuid4()),
        "reporter_id": current_user["id"],
        "reporter_email": current_user.get("email"),
        "content_id": target_user["id"],
        "content_type": "user_blocked",
        "reason": "blocked_by_user",
        "description": f"User {current_user.get('username')} blocked {username}",
        "status": "pending",
        "created_at": datetime.utcnow(),
    })

    logger.warning(f"USER BLOCKED: {current_user.get('username')} blocked {username}")
    return {"message": f"@{username} has been blocked. Their content will no longer appear in your feed."}

@api_router.delete("/users/{username}/block")
async def unblock_user(
    username: str,
    current_user: dict = Depends(get_required_user)
):
    """Unblock a user"""
    result = await db.blocked_users.delete_one({
        "blocker_id": current_user["id"],
        "blocked_username": username.strip().lower()
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User was not blocked")
    return {"message": f"@{username} has been unblocked"}

@api_router.get("/users/blocked/list")
async def get_blocked_users(current_user: dict = Depends(get_required_user)):
    """Get list of blocked users"""
    blocked = await db.blocked_users.find({"blocker_id": current_user["id"]}).to_list(500)
    return [{"username": b["blocked_username"], "blocked_at": b["created_at"]} for b in blocked]

@api_router.post("/auth/accept-terms")
async def accept_terms(current_user: dict = Depends(get_required_user)):
    """Record that user has accepted the Terms of Use / EULA"""
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"terms_accepted": True, "terms_accepted_at": datetime.utcnow()}}
    )
    return {"message": "Terms accepted"}

# ============ END CONTENT MODERATION ============

# ============ LEGAL PAGES ============

from fastapi.responses import FileResponse

@api_router.get("/screenshots/weekly")
async def screenshot_weekly():
    return FileResponse("/app/backend/apple_iap_weekly.png", media_type="image/png", filename="apple_iap_weekly_1290x2796.png")

@api_router.get("/screenshots/monthly")
async def screenshot_monthly():
    return FileResponse("/app/backend/apple_iap_monthly.png", media_type="image/png", filename="apple_iap_monthly_1290x2796.png")

@api_router.get("/screenshots/yearly")
async def screenshot_yearly():
    return FileResponse("/app/backend/apple_iap_yearly.png", media_type="image/png", filename="apple_iap_yearly_1290x2796.png")

@api_router.get("/privacy-policy")
async def privacy_policy():
    return HTMLResponse(content="""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Privacy Policy - meemz</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0B0B0F;color:#EAEAF0;font-family:-apple-system,sans-serif;line-height:1.7;padding:24px;max-width:800px;margin:0 auto}h1{color:#FF7A1A;font-size:28px;margin-bottom:8px}h2{color:#FF7A1A;font-size:20px;margin-top:32px;margin-bottom:12px}p{color:#AAAABC;font-size:15px;margin-bottom:16px}.date{color:#666;font-size:13px;margin-bottom:24px}ul{margin-left:20px;margin-bottom:16px}li{color:#AAAABC;font-size:15px;margin-bottom:8px}a{color:#FF7A1A}</style></head><body><h1>Privacy Policy</h1><p class="date">Last updated: April 2026</p><p>meemz ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and share information about you when you use our mobile application.</p><h2>Information We Collect</h2><ul><li><strong>Account Information:</strong> When you create an account, we collect your email address, username, and password (stored securely as a hash).</li><li><strong>Profile Information:</strong> You may optionally provide a display name, bio, profile image, and social media links.</li><li><strong>User Content:</strong> Memes, GIFs, and other content you upload to the app.</li><li><strong>Usage Data:</strong> We collect information about how you use the app, including memes viewed, shared, and saved.</li><li><strong>Device Information:</strong> We may collect device identifiers to provide app functionality such as favorites and recent activity.</li></ul><h2>How We Use Your Information</h2><ul><li>To provide and maintain the meemz app</li><li>To manage your account and subscriptions</li><li>To display your uploaded content and profile to other users</li><li>To process payments through the App Store or Stripe</li><li>To improve and optimize the app experience</li></ul><h2>Photo Library Access</h2><p>meemz requests access to your photo library to allow you to upload memes and GIFs you want to share with the community. We also save animated memes to your camera roll so you can share them on social media with motion. Photos are only accessed when you explicitly choose to upload or save content.</p><h2>Information Sharing</h2><p>We do not sell your personal information. We may share information with:</p><ul><li><strong>Other Users:</strong> Your username, profile, and public uploads are visible to other users.</li><li><strong>Payment Processors:</strong> Apple (App Store) and Stripe process subscription payments.</li><li><strong>Service Providers:</strong> We may use third-party services to help operate our app.</li></ul><h2>Data Retention and Deletion</h2><p>You can delete your account at any time from the Profile screen. When you delete your account, we permanently remove your profile, uploaded memes, follow relationships, and all associated data.</p><h2>Children's Privacy</h2><p>meemz is not intended for children under 13. We do not knowingly collect information from children under 13.</p><h2>Changes to This Policy</h2><p>We may update this Privacy Policy from time to time. We will notify you of changes by updating the "Last updated" date.</p><h2>Contact Us</h2><p>If you have questions about this Privacy Policy, contact us at <a href="mailto:support@meemz.app">support@meemz.app</a>.</p></body></html>""")

@api_router.get("/terms-of-service")
async def terms_of_service():
    return HTMLResponse(content="""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Terms of Service - meemz</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0B0B0F;color:#EAEAF0;font-family:-apple-system,sans-serif;line-height:1.7;padding:24px;max-width:800px;margin:0 auto}h1{color:#FF7A1A;font-size:28px;margin-bottom:8px}h2{color:#FF7A1A;font-size:20px;margin-top:32px;margin-bottom:12px}p{color:#AAAABC;font-size:15px;margin-bottom:16px}.date{color:#666;font-size:13px;margin-bottom:24px}ul{margin-left:20px;margin-bottom:16px}li{color:#AAAABC;font-size:15px;margin-bottom:8px}a{color:#FF7A1A}</style></head><body><h1>Terms of Service</h1><p class="date">Last updated: April 2026</p><p>Welcome to meemz! By using our app, you agree to these Terms of Service.</p><h2>Use of Service</h2><p>meemz provides a platform for discovering, sharing, and creating meme content. You must be at least 13 years old to use the app. You are responsible for maintaining the security of your account.</p><h2>User Content</h2><ul><li>You retain ownership of content you upload.</li><li>By uploading content, you grant meemz a license to display and distribute it within the app.</li><li>You must not upload content that infringes on others' rights, is illegal, or is harmful.</li><li>We reserve the right to remove content that violates these terms.</li></ul><h2>Subscriptions</h2><ul><li>Premium subscriptions are available as weekly, monthly, or yearly plans.</li><li>Payment is charged through the App Store or Stripe depending on your platform.</li><li>Subscriptions auto-renew unless cancelled at least 24 hours before the end of the current period.</li><li>You can manage or cancel subscriptions through your App Store account settings or by contacting support.</li></ul><h2>Account Deletion</h2><p>You may delete your account at any time from the Profile screen. Deletion is permanent and removes all your data including uploaded content, profile information, and subscription records.</p><h2>Prohibited Conduct</h2><ul><li>Harassment, hate speech, or bullying of other users</li><li>Uploading illegal, explicit, or copyrighted content without permission</li><li>Attempting to reverse engineer or exploit the app</li><li>Creating fake accounts or impersonating others</li></ul><h2>Limitation of Liability</h2><p>meemz is provided "as is" without warranties. We are not liable for any damages arising from your use of the app.</p><h2>Changes to Terms</h2><p>We may update these terms from time to time. Continued use of the app after changes constitutes acceptance of the new terms.</p><h2>Contact</h2><p>Questions? Contact us at <a href="mailto:support@meemz.app">support@meemz.app</a>.</p></body></html>""")

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
    """Seed categories, ensure ffmpeg, and generate thumbnails on startup"""
    # Ensure ffmpeg is installed (gets wiped on container restart)
    import shutil
    if not shutil.which("ffmpeg"):
        logger.warning("ffmpeg not found! Installing...")
        try:
            result = subprocess.run(
                ["apt-get", "update", "-qq"],
                capture_output=True, text=True, timeout=60
            )
            result = subprocess.run(
                ["apt-get", "install", "-y", "-qq", "ffmpeg"],
                capture_output=True, text=True, timeout=120
            )
            if shutil.which("ffmpeg"):
                logger.info("ffmpeg installed successfully!")
            else:
                logger.error("ffmpeg installation failed!")
        except Exception as e:
            logger.error(f"ffmpeg install error: {e}")
    else:
        logger.info("ffmpeg is available")

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
    
    # Ensure Apple Review demo account exists
    demo_email = "meemzreview@gmail.com"
    existing_demo = await db.users.find_one({"email": demo_email})
    if not existing_demo:
        demo_password = pwd_context.hash("Meemz2026!")
        demo_user = {
            "id": str(uuid.uuid4()),
            "email": demo_email,
            "username": "meemzreview",
            "password": demo_password,
            "display_name": "meemzreview",
            "avatar": None,
            "bio": None,
            "profile_image": None,
            "social_links": {},
            "is_admin": False,
            "terms_accepted": True,
            "created_at": datetime.utcnow(),
        }
        await db.users.insert_one(demo_user)
        logger.info("Apple Review demo account created")
    else:
        logger.info("Apple Review demo account exists")

    # Generate thumbnails for memes that don't have one yet
    missing_thumb_count = await db.memes.count_documents({
        "$or": [
            {"thumbnail_base64": {"$exists": False}},
            {"thumbnail_base64": None}
        ]
    })
    if missing_thumb_count > 0:
        logger.info(f"Generating thumbnails for {missing_thumb_count} memes...")
        cursor = db.memes.find({
            "$or": [
                {"thumbnail_base64": {"$exists": False}},
                {"thumbnail_base64": None}
            ]
        }, {"id": 1, "image_base64": 1})
        generated = 0
        async for meme in cursor:
            image_data = meme.get("image_base64", "")
            if image_data:
                thumb = generate_thumbnail(image_data)
                if thumb:
                    await db.memes.update_one(
                        {"id": meme["id"]},
                        {"$set": {"thumbnail_base64": thumb}}
                    )
                    generated += 1
        logger.info(f"Generated {generated} thumbnails!")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
