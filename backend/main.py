import os, time, uuid
from typing import Optional

import jwt
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

# ---------- ENV ----------
SUPABASE_URL = os.getenv("SUPABASE_URL")  # https://xxxx.supabase.co
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")  # sb_secret_...
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASS", "admin123")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")

SUPABASE_URL = SUPABASE_URL.rstrip("/")
SUPABASE_REST = f"{SUPABASE_URL}/rest/v1"

# ---------- SUPABASE REST HEADERS ----------
REST_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def sb_insert(table: str, row: dict):
    r = requests.post(f"{SUPABASE_REST}/{table}", json=row, headers=REST_HEADERS, timeout=20)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()

def sb_select(table: str, query: str = ""):
    url = f"{SUPABASE_REST}/{table}"
    if query:
        url = f"{url}?{query}"
    r = requests.get(url, headers=REST_HEADERS, timeout=20)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()

def sb_update(table: str, match_query: str, patch: dict):
    url = f"{SUPABASE_REST}/{table}?{match_query}"
    r = requests.patch(url, json=patch, headers=REST_HEADERS, timeout=20)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()

# ---------- STORAGE (Supabase Storage) ----------
SUPABASE_STORAGE = f"{SUPABASE_URL}/storage/v1"
BUCKET = "product-images"   # bucket name

def storage_upload(path: str, file_bytes: bytes, content_type: str):
    # POST /object/<bucket>/<path>
    url = f"{SUPABASE_STORAGE}/object/{BUCKET}/{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    r = requests.post(url, headers=headers, data=file_bytes, timeout=40)
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)

def public_url(path: str) -> str:
    # public bucket -> direct public URL
    return f"{SUPABASE_STORAGE}/object/public/{BUCKET}/{path}"

# ---------- AUTH ----------
def make_admin_token() -> str:
    now = int(time.time())
    payload = {"sub": "admin", "iat": now, "exp": now + 7 * 24 * 3600}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def require_admin(authorization: Optional[str] = Header(default=None, alias="Authorization")):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")

    token = authorization
    if authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]

    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if data.get("sub") != "admin":
            raise HTTPException(status_code=401, detail="Invalid token")
        return True
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

# ---------- SCHEMAS ----------
class AdminLoginIn(BaseModel):
    username: str
    password: str

class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)

class ProductIn(BaseModel):
    category_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=120)
    price: float = Field(gt=0)
    rating: float = Field(ge=0, le=5, default=0)
    image_url: Optional[str] = None
    description: Optional[str] = None
    active: bool = True

class OrderIn(BaseModel):
    customer_name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=6, max_length=20)
    address: str = Field(min_length=5, max_length=500)
    pincode: str = Field(min_length=4, max_length=10)
    items: list[dict] = Field(min_length=1)
    total: float = Field(gt=0)

# ---------- APP ----------
app = FastAPI(title="MyShop API", version="1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # later set frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {
        "ok": True,
        "supabase_rest": SUPABASE_REST,
        "storage_bucket": BUCKET
    }

# ---------- ADMIN LOGIN ----------
@app.post("/admin/login")
def admin_login(body: AdminLoginIn):
    if body.username == ADMIN_USER and body.password == ADMIN_PASS:
        return {"ok": True, "token": make_admin_token()}
    raise HTTPException(status_code=401, detail="Wrong username/password")

# ---------- ADMIN UPLOAD IMAGE ----------
@app.post("/admin/upload", dependencies=[Depends(require_admin)])
async def admin_upload_image(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files allowed")

    # simple size limit: 3 MB
    data = await file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(400, "Image too large (max 2MB)")

    ext = ""
    if file.filename and "." in file.filename:
        ext = "." + file.filename.rsplit(".", 1)[1].lower()

    safe_name = f"products/{uuid.uuid4().hex}{ext}"
    storage_upload(safe_name, data, file.content_type)
    return {"ok": True, "path": safe_name, "url": public_url(safe_name)}

# ---------- CATEGORIES ----------
@app.post("/admin/categories", dependencies=[Depends(require_admin)])
def admin_add_category(body: CategoryIn):
    data = sb_insert("categories", {"name": body.name})
    return {"ok": True, "category": data[0] if data else None}

@app.get("/admin/categories", dependencies=[Depends(require_admin)])
def admin_list_categories():
    cats = sb_select("categories", "select=*&order=id.desc")
    return {"ok": True, "categories": cats}

@app.get("/categories")
def public_categories():
    cats = sb_select("categories", "select=*&order=id.desc")
    return {"ok": True, "categories": cats}

# ---------- PRODUCTS ----------
@app.post("/admin/products", dependencies=[Depends(require_admin)])
def admin_add_product(body: ProductIn):
    payload = body.model_dump()
    data = sb_insert("products", payload)
    return {"ok": True, "product": data[0] if data else None}

@app.get("/admin/products", dependencies=[Depends(require_admin)])
def admin_list_products():
    prods = sb_select("products", "select=*&order=id.desc")
    return {"ok": True, "products": prods}

@app.get("/products")
def public_products(category_id: Optional[int] = None):
    query = "select=*&active=eq.true&order=id.desc"
    if category_id is not None:
        query += f"&category_id=eq.{category_id}"
    prods = sb_select("products", query)
    return {"ok": True, "products": prods}

# ---------- ORDERS ----------
@app.post("/orders")
def create_order(body: OrderIn):
    payload = body.model_dump()
    payload["status"] = "new"
    data = sb_insert("orders", payload)
    return {"ok": True, "order": data[0] if data else None}

@app.get("/admin/orders", dependencies=[Depends(require_admin)])
def admin_list_orders(limit: int = 200):
    orders = sb_select("orders", f"select=*&order=id.desc&limit={limit}")
    return {"ok": True, "orders": orders}

@app.patch("/admin/orders/{order_id}", dependencies=[Depends(require_admin)])
def admin_update_order_status(order_id: int, status: str):
    allowed = {"new", "processing", "delivered", "cancelled"}
    if status not in allowed:
        raise HTTPException(400, f"status must be one of {sorted(list(allowed))}")
    data = sb_update("orders", f"id=eq.{order_id}", {"status": status})
    return {"ok": True, "order": data[0] if data else None}