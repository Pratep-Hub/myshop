const API = "https://myshop-api-8c54.onrender.com";
const CART_KEY = "myshop_cart_v1";

let ALL_PRODUCTS = [];
let ALL_CATEGORIES = [];
let CURRENT_PRODUCT = null;
let tiltCleanup = null;

// local fallback img (no internet)
const FALLBACK_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' width='600' height='450'>
  <rect width='100%' height='100%' fill='#111827'/>
  <path d='M120 320l90-110 70 80 50-60 120 140H120z' fill='#334155'/>
  <circle cx='210' cy='170' r='35' fill='#334155'/>
</svg>`);

/* ---------------- Toast ---------------- */
function showToast(msg, ok=true){
  const t = document.getElementById("toast");
  t.style.display = "";
  t.style.background = ok ? "#0f172a" : "#7f1d1d";
  t.textContent = msg;
  setTimeout(()=> t.style.display="none", 2800);
}

/* ---------------- Cart helpers ---------------- */
function getCart(){ return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
function saveCart(c){ localStorage.setItem(CART_KEY, JSON.stringify(c)); updateCartCount(); }
function updateCartCount(){
  const c = getCart();
  const n = c.reduce((s,i)=>s+i.qty,0);
  document.getElementById("cartCount").textContent = n;
}
updateCartCount();

function addToCart(p){
  const c = getCart();
  const idx = c.findIndex(x=>x.id===p.id);
  if(idx>=0) c[idx].qty += 1;
  else c.push({id:p.id, name:p.name, price:Number(p.price), qty:1});
  saveCart(c);
  showToast("Added to cart ✓", true);
}

function openCart(){
  renderCart();
  document.getElementById("cartModal").showModal();
}
function closeCart(){
  document.getElementById("cartModal").close();
}

function clearCart(){
  saveCart([]);
  renderCart();
  showToast("Cart cleared");
}

function renderCart(){
  const c = getCart();
  const wrap = document.getElementById("cartItems");
  const total = c.reduce((s,i)=>s+i.price*i.qty,0);
  document.getElementById("total").textContent = total.toFixed(0);

  if(c.length===0){ wrap.innerHTML = "Cart empty"; return; }

  wrap.innerHTML = c.map((i,idx)=>`
    <div class="line" style="padding:10px;border:1px solid rgba(15,23,42,.12);border-radius:12px;margin:8px 0">
      <div>
        <b>${i.name}</b><div class="muted">₹${i.price} x ${i.qty}</div>
      </div>
      <div class="row">
        <button class="btn" onclick="dec(${idx})">-</button>
        <button class="btn" onclick="inc(${idx})">+</button>
        <button class="btn" onclick="rem(${idx})">Remove</button>
      </div>
    </div>`).join("");
}
function inc(idx){ const c=getCart(); c[idx].qty++; saveCart(c); renderCart(); }
function dec(idx){ const c=getCart(); c[idx].qty--; if(c[idx].qty<=0) c.splice(idx,1); saveCart(c); renderCart(); }
function rem(idx){ const c=getCart(); c.splice(idx,1); saveCart(c); renderCart(); }

/* ---------------- Checkout modal ---------------- */
function openCheckout(){
  const c = getCart();
  if(!c.length){ showToast("Cart is empty. Add product first.", false); return; }

  const total = c.reduce((s,i)=>s+i.price*i.qty,0);
  document.getElementById("checkoutTotal").textContent = total.toFixed(0);
  document.getElementById("formError").innerHTML = "";
  document.getElementById("checkoutModal").showModal();
}

function closeCheckout(){
  document.getElementById("checkoutModal").close();
}

function validateForm(){
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address = document.getElementById("address").value.trim();
  const pincode = document.getElementById("pincode").value.trim();

  if(name.length < 2) return "Enter your name";
  if(!/^[0-9]{10}$/.test(phone)) return "Phone must be 10 digits";
  if(address.length < 8) return "Enter full address";
  if(!/^[0-9]{6}$/.test(pincode)) return "Pincode must be 6 digits";
  return null;
}

async function submitOrder(){
  const err = validateForm();
  const errBox = document.getElementById("formError");
  if(err){
    errBox.innerHTML = `<div class="error">${err}</div>`;
    showToast(err, false);
    return;
  }

  const c = getCart();
  const total = c.reduce((s,i)=>s+i.price*i.qty,0);

  const payload = {
    customer_name: document.getElementById("name").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    address: document.getElementById("address").value.trim(),
    pincode: document.getElementById("pincode").value.trim(),
    items: c,
    total
  };

  showToast("Placing order...");
  const res = await fetch(`${API}/orders`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if(!data.ok){
    showToast(data.detail || "Order failed", false);
    return;
  }

  saveCart([]);
  renderCart();
  closeCheckout();
  closeCart();
  showToast(`Order placed ✓ ID: ${data.order.id}`, true);
}

/* ---------------- Load categories + products ---------------- */
async function init(){
  document.getElementById("status").textContent = "Loading...";
  const [catsRes, prodsRes] = await Promise.all([
    fetch(`${API}/categories`),
    fetch(`${API}/products`)
  ]);

  const catsData = await catsRes.json();
  const prodsData = await prodsRes.json();

  ALL_CATEGORIES = catsData.categories || [];
  ALL_PRODUCTS = prodsData.products || [];

  const sel = document.getElementById("catFilter");
  sel.innerHTML = `<option value="all">All categories</option>` +
    ALL_CATEGORIES.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");

  applyFilters();
}
init();

function applyFilters(){
  const cat = document.getElementById("catFilter").value;
  const q = (document.getElementById("searchBox").value || "").trim().toLowerCase();

  let list = ALL_PRODUCTS.slice();

  if(cat !== "all"){
    const cid = Number(cat);
    list = list.filter(p => Number(p.category_id) === cid);
  }
  if(q){
    list = list.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q)
    );
  }
  renderProducts(list);
}

function renderProducts(list){
  const box = document.getElementById("products");
  document.getElementById("status").textContent = `${list.length} items`;

  box.innerHTML = list.map(p=>`
    <div class="card">
      <div class="img" style="cursor:pointer" onclick='openProductModal(${JSON.stringify(p)})'>
        <img src="${p.image_url || FALLBACK_IMG}" alt="${p.name}" loading="lazy">
      </div>

      <h3 style="cursor:pointer" onclick='openProductModal(${JSON.stringify(p)})'>${p.name}</h3>

      <div class="muted">⭐ ${p.rating ?? 0}</div>
      <div class="desc">${p.description || ""}</div>

      <div class="price">₹${p.price}</div>

      <button class="btn primary" onclick='addToCart(${JSON.stringify({id:p.id,name:p.name,price:p.price})})'>
        Add to cart
      </button>
    </div>`).join("");
}

/* ---------------- Product Modal ---------------- */
function openProductModal(p){
  CURRENT_PRODUCT = p;

  document.getElementById("mName").textContent = p.name || "";
  document.getElementById("mPrice").textContent = p.price || "";
  document.getElementById("mRating").textContent = p.rating ?? 0;
  document.getElementById("mDesc").textContent = p.description || "";
  document.getElementById("mImg").src = p.image_url || FALLBACK_IMG;

  document.getElementById("productModal").showModal();
  enableTilt();
}

function closeProductModal(){
  document.getElementById("productModal").close();
  if(typeof tiltCleanup === "function") tiltCleanup();
}

function addModalToCart(){
  if(!CURRENT_PRODUCT) return;
  addToCart({id: CURRENT_PRODUCT.id, name: CURRENT_PRODUCT.name, price: CURRENT_PRODUCT.price});
  closeProductModal();
}

/* ---------------- Improved 3D Tilt (spring + glare) ---------------- */
function enableTilt(){
  if(typeof tiltCleanup === "function") tiltCleanup();

  const area = document.getElementById("tiltArea");
  const img = document.getElementById("mImg");
  if(!area || !img) return;

  let targetX = 0, targetY = 0;
  let curX = 0, curY = 0;
  let raf = null;

  const max = 16;
  const damp = 0.12;

  function animate(){
    curX += (targetX - curX) * damp;
    curY += (targetY - curY) * damp;

    img.style.transform = `rotateX(${curX.toFixed(2)}deg) rotateY(${curY.toFixed(2)}deg) translateZ(0) scale(1.02)`;
    raf = requestAnimationFrame(animate);
  }

  function setTarget(clientX, clientY){
    const r = area.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;

    targetY = (x - 0.5) * (max * 2);
    targetX = -(y - 0.5) * (max * 2);

    area.style.setProperty("--gx", `${(x*100).toFixed(1)}%`);
    area.style.setProperty("--gy", `${(y*100).toFixed(1)}%`);

    area.classList.add("tilting");
    if(!raf) raf = requestAnimationFrame(animate);
  }

  function reset(){
    targetX = 0; targetY = 0;
    area.classList.remove("tilting");

    setTimeout(()=>{
      if(Math.abs(curX) < 0.15 && Math.abs(curY) < 0.15){
        if(raf) cancelAnimationFrame(raf);
        raf = null;
        img.style.transform = "rotateX(0deg) rotateY(0deg) translateZ(0) scale(1.02)";
      }
    }, 250);
  }

  const onMove = (e)=> setTarget(e.clientX, e.clientY);
  const onLeave = ()=> reset();
  const onTouchMove = (e)=>{
    if(!e.touches || !e.touches[0]) return;
    setTarget(e.touches[0].clientX, e.touches[0].clientY);
  };
  const onTouchEnd = ()=> reset();

  area.addEventListener("mousemove", onMove);
  area.addEventListener("mouseleave", onLeave);
  area.addEventListener("touchmove", onTouchMove, {passive:true});
  area.addEventListener("touchend", onTouchEnd);

  tiltCleanup = ()=>{
    area.removeEventListener("mousemove", onMove);
    area.removeEventListener("mouseleave", onLeave);
    area.removeEventListener("touchmove", onTouchMove);
    area.removeEventListener("touchend", onTouchEnd);
    if(raf) cancelAnimationFrame(raf);
    raf = null;
  };
}


// --- Hidden admin entry: long press brand for 3 seconds ---
(function setupAdminLongPress(){
  const el = document.getElementById("brandAdmin");
  if(!el) return;

  let timer = null;
  const DURATION = 3000;

  const start = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // go to admin page
      window.location.href = "./admin.html";
    }, DURATION);
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  // Mouse
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", cancel);
  el.addEventListener("mouseleave", cancel);

  // Touch (mobile)
  el.addEventListener("touchstart", start, {passive:true});
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
})();