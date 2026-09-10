const API = "https://myshop-api-8c54.onrender.com";
document.getElementById("apiBase").textContent = API;

const LS_TOKEN = "admin_token";
let PRODUCTS_CACHE = [];   // for showing images in Items popup

// Local fallback image (no internet needed)
const FALLBACK_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>
  <rect width='100%' height='100%' fill='#f1f5f9'/>
  <path d='M18 56l12-14 10 12 8-10 14 16H18z' fill='#94a3b8'/>
  <circle cx='30' cy='28' r='6' fill='#94a3b8'/>
</svg>`);

function token(){ return localStorage.getItem(LS_TOKEN); }
function authHeaders(){
  return { "Authorization": "Bearer " + token(), "Content-Type": "application/json" };
}
function show(el, yes){ if(el) el.style.display = yes ? "" : "none"; }

function setMsg(id, html, isError=false){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerHTML = `<div class="${isError?'error':'toast'}">${html}</div>`;
}

function logout(){
  localStorage.removeItem(LS_TOKEN);
  location.reload();
}

async function login(){
  const username = document.getElementById("user")?.value.trim();
  const password = document.getElementById("pass")?.value.trim();

  const res = await fetch(`${API}/admin/login`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if(!data.ok){
    setMsg("loginMsg", data.detail || "Login failed", true);
    return;
  }
  localStorage.setItem(LS_TOKEN, data.token);
  init();
}

async function init(){
  const has = !!token();
  show(document.getElementById("loginCard"), !has);
  show(document.getElementById("dash"), has);
  if(!has) return;

  const who = document.getElementById("who");
  if(who) who.textContent = "Logged in";

  await loadCategories();
  await loadProducts();
  await loadOrders();
}
init();

/* ---------------- Categories ---------------- */
async function addCategory(){
  const name = document.getElementById("catName")?.value.trim();
  if(!name) return setMsg("catMsg","Enter category name",true);

  const res = await fetch(`${API}/admin/categories`, {
    method:"POST",
    headers: authHeaders(),
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if(!data.ok){
    setMsg("catMsg", data.detail || "Failed", true);
    return;
  }
  setMsg("catMsg", `Added: ${data.category.name}`);
  document.getElementById("catName").value = "";
  await loadCategories();
}

async function loadCategories(){
  const res = await fetch(`${API}/admin/categories`, {
    headers: { "Authorization":"Bearer " + token() }
  });
  const data = await res.json();
  if(!data.ok){
    document.getElementById("catList").textContent = "Failed to load categories";
    return;
  }

  const cats = data.categories || [];
  const catList = document.getElementById("catList");
  if(catList){
    catList.innerHTML = cats.length
      ? cats.map(c=>`<div>${c.id}. ${c.name}</div>`).join("")
      : "No categories";
  }

  const sel = document.getElementById("prodCategory");
  if(sel){
    sel.innerHTML = cats.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");
  }

  const statCats = document.getElementById("statCats");
  if(statCats) statCats.textContent = cats.length;
}

/* ---------------- Image compress + upload ---------------- */
async function compressImage(file, maxW=1600, quality=0.82){
  const img = new Image();
  const url = URL.createObjectURL(file);

  await new Promise((resolve, reject)=>{
    img.onload = resolve; img.onerror = reject; img.src = url;
  });

  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  URL.revokeObjectURL(url);
  return new File([blob], (file.name || "image") + ".jpg", { type: "image/jpeg" });
}

async function uploadImage(){
  const input = document.getElementById("prodImageFile");
  if(!input?.files || !input.files[0]) return setMsg("uploadMsg","Choose an image first",true);

  setMsg("uploadMsg","Compressing...");
  const compressed = await compressImage(input.files[0]);

  const kb = Math.round(compressed.size/1024);
  setMsg("uploadMsg", `Uploading... (${kb} KB)`);

  const fd = new FormData();
  fd.append("file", compressed);

  const res = await fetch(`${API}/admin/upload`, {
    method:"POST",
    headers: { "Authorization":"Bearer " + token() },
    body: fd
  });
  const data = await res.json();
  if(!data.ok){
    setMsg("uploadMsg", data.detail || "Upload failed", true);
    return;
  }
  document.getElementById("prodImageUrl").value = data.url;
  setMsg("uploadMsg", "Uploaded ✓");
}

/* ---------------- Products ---------------- */
async function addProduct(){
  const payload = {
    category_id: parseInt(document.getElementById("prodCategory")?.value || "0") || null,
    name: document.getElementById("prodName")?.value.trim(),
    price: parseFloat(document.getElementById("prodPrice")?.value || "0"),
    rating: parseFloat(document.getElementById("prodRating")?.value || "0"),
    image_url: (document.getElementById("prodImageUrl")?.value.trim()) || null,
    description: (document.getElementById("prodDesc")?.value.trim()) || null,
    active: (document.getElementById("prodActive")?.value || "true") === "true"
  };

  if(!payload.name || !payload.price){
    return setMsg("prodMsg","Name and price required",true);
  }

  const res = await fetch(`${API}/admin/products`, {
    method:"POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if(!data.ok){
    setMsg("prodMsg", data.detail || "Failed", true);
    return;
  }

  setMsg("prodMsg", `Added: ${data.product.name}`);
  ["prodName","prodPrice","prodRating","prodDesc","prodImageUrl","prodImageFile"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = "";
  });
  await loadProducts();
}

async function loadProducts(){
  const res = await fetch(`${API}/admin/products`, {
    headers: { "Authorization":"Bearer " + token() }
  });
  const data = await res.json();
  if(!data.ok){
    const el = document.getElementById("productsList");
    if(el) el.textContent = "Failed";
    return;
  }

  const prods = data.products || [];
  PRODUCTS_CACHE = prods;

  const statProducts = document.getElementById("statProducts");
  if(statProducts) statProducts.textContent = prods.length;

  const productsList = document.getElementById("productsList");
  if(!productsList) return;

  productsList.innerHTML = prods.length ? `
    <div class="tableWrap">
      <table class="table">
        <tr>
          <th>Image</th><th>ID</th><th>Name</th><th>Price</th><th>Rating</th><th>Active</th>
        </tr>
        ${prods.slice(0,50).map(p=>`
          <tr>
            <td><img class="thumb" src="${p.image_url || FALLBACK_IMG}" alt="" loading="lazy"></td>
            <td>${p.id}</td>
            <td>${p.name}</td>
            <td>₹${p.price}</td>
            <td>${p.rating ?? 0}</td>
            <td><span class="pill">${p.active ? "Yes" : "No"}</span></td>
          </tr>`).join("")}
      </table>
    </div>` : "No products yet";
}

/* ---------------- Orders + Items popup ---------------- */
async function loadOrders(){
  const res = await fetch(`${API}/admin/orders`, {
    headers: { "Authorization":"Bearer " + token() }
  });
  const data = await res.json();
  if(!data.ok){
    setMsg("ordersMsg", data.detail || "Failed to load orders", true);
    return;
  }

  const orders = data.orders || [];
  const statOrders = document.getElementById("statOrders");
  if(statOrders) statOrders.textContent = orders.length;

  const tbody = document.querySelector("#ordersTable tbody");
  if(!tbody) return;

  tbody.innerHTML = orders.map(o=>`
    <tr>
      <td>#${o.id}</td>
      <td>${o.customer_name}</td>
      <td>${o.phone}</td>
      <td>₹${o.total}</td>
      <td><span class="pill">${o.status}</span></td>
      <td>${(o.created_at||"").toString().slice(0,19).replace("T"," ")}</td>
      <td class="row" style="gap:6px">
        <button class="btn" onclick='viewItems(${JSON.stringify(o.items || [])})'>Items</button>
        <select onchange="setStatus(${o.id}, this.value)">
          ${["new","processing","delivered","cancelled"].map(s=>`
            <option value="${s}" ${o.status===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </td>
    </tr>`).join("");
}

async function setStatus(id, status){
  const res = await fetch(`${API}/admin/orders/${id}?status=${encodeURIComponent(status)}`, {
    method:"PATCH",
    headers: { "Authorization":"Bearer " + token() }
  });
  const data = await res.json();
  if(!data.ok){
    setMsg("ordersMsg", data.detail || "Status update failed", true);
    return;
  }
  setMsg("ordersMsg", `Order #${id} → ${status}`);
}

function viewItems(items){
  const modal = document.getElementById("itemsModal");
  const body = document.getElementById("itemsBody");
  if(!modal || !body) return;

  const byId = new Map((PRODUCTS_CACHE || []).map(p => [p.id, p]));

  if(!items.length){
    body.innerHTML = "No items";
  } else {
    body.innerHTML = `
      <div class="tableWrap">
        <table class="table">
          <tr><th>Image</th><th>Name</th><th>Qty</th><th>Price</th></tr>
          ${items.map(i=>{
            const p = byId.get(i.id);
            const img = p?.image_url || FALLBACK_IMG;
            return `
              <tr>
                <td><img class="thumb" src="${img}" alt="" loading="lazy"></td>
                <td>${i.name}</td>
                <td>${i.qty}</td>
                <td>₹${i.price}</td>
              </tr>`;
          }).join("")}
        </table>
      </div>`;
  }
  modal.showModal();
}
function closeItems(){ document.getElementById("itemsModal")?.close(); }