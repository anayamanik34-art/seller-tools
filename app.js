"use strict";

/* ===================================================================
   Eksoch Seller Tools — a Gumroad seller toolkit that runs fully in the
   browser. Keys are kept in this device's localStorage and are sent only
   to api.gumroad.com and api.anthropic.com.
   =================================================================== */

const $ = (sel, el = document) => el.querySelector(sel);
const main = $("#main");

// ---------- Storage (wrapped: storage can be blocked) ----------
const K = { gum: "est.gumroadToken", ai: "est.anthropicKey", demo: "est.demo", pro: "est.proCode" };
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } },
};
// A link with ?demo=1 opens the sample shop (used for Store screenshots and demo links).
const startParams = new URLSearchParams(location.search);
if (startParams.get("demo") === "1") store.set(K.demo, "1");
const isDemo = () => store.get(K.demo) === "1";
const connected = () => isDemo() || !!store.get(K.gum);

// ---------- Pro (unlocked with an AppSumo code, checked on this device) ----------
// pro-codes.js holds one-way hashes of the valid codes, made by make_appsumo_codes.js.
const PRO_SALT = "eksoch-seller-tools|";
const PRO_PAGES = new Set(["discounts", "writer", "export"]);
const normalizeCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
async function codeIsValid(code) {
  const norm = normalizeCode(code);
  if (norm.length < 10 || !self.PRO_CODE_HASHES || !crypto?.subtle) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PRO_SALT + norm));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return self.PRO_CODE_HASHES.has(hex);
}
let proActive = false;
const hasPro = () => proActive || isDemo();

// ---------- Helpers ----------
class AppError extends Error {}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const prettyDay = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}
const errorBox = (e) => `<div class="msg error">${esc(e instanceof AppError ? e.message : "Something went wrong. Please try again.")}</div>`;
if (!window.__estErrorsHooked) {
  window.__estErrorsHooked = true;
  window.addEventListener("unhandledrejection", (ev) => { if (!(ev.reason instanceof AppError)) console.error(ev.reason); });
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied ✅"); }
  catch { toast("Couldn't copy — select the text and press Ctrl+C."); }
}

// ===================================================================
// Gumroad API
// ===================================================================
async function gum(method, path, params = {}, token = store.get(K.gum)) {
  const body = new URLSearchParams({ ...params, access_token: token });
  let url = "https://api.gumroad.com/v2" + path;
  const opts = { method };
  if (method === "GET") url += "?" + body; else opts.body = body;
  let r;
  try { r = await fetch(url, opts); } catch { throw new AppError("Couldn't reach Gumroad. Check your internet connection."); }
  if (r.status === 401) throw new AppError("Gumroad didn't accept the access token. Copy a fresh token from Gumroad and connect again in Settings.");
  let data;
  try { data = await r.json(); } catch { throw new AppError(`Gumroad sent an unexpected response (HTTP ${r.status}).`); }
  if (!r.ok || !data.success) throw new AppError(data.message || `Gumroad error (HTTP ${r.status}).`);
  return data;
}

// ===================================================================
// Demo data (used in demo mode, also lets store reviewers try the app)
// ===================================================================
const demo = (() => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const products = [
    { id: "d1", name: "Watercolour Botanical Clipart Pack", price: 900, published: true, description: "<p>40 hand-painted botanical PNG files with transparent backgrounds.</p>" },
    { id: "d2", name: "Printable Alphabet Tracing Worksheets", price: 400, published: true, description: "<p>26 A4 tracing pages for ages 3–6.</p>" },
    { id: "d3", name: "Small Business Budget Template (Excel)", price: 1200, published: true, description: "<p>Monthly budget workbook with charts.</p>" },
    { id: "d4", name: "SQL Interview Cheat Sheet", price: 0, published: true, description: "<p>Free two-page PDF of common SQL patterns.</p>" },
    { id: "d5", name: "Mountain Landscapes Art Prints", price: 1500, published: true, description: "<p>Six high-resolution printable landscapes.</p>" },
    { id: "d6", name: "Holiday Gift Tags Bundle", price: 300, published: false, description: "<p>Printable gift tags, coming soon.</p>" },
  ];
  const sales = [];
  let n = 1000;
  for (let day = 364; day >= 0; day--) {
    const count = Math.floor(rand() * (day < 60 ? 4 : 3));
    for (let i = 0; i < count; i++) {
      const p = products[Math.floor(rand() * 5)];
      const d = daysAgo(day);
      d.setHours(8 + Math.floor(rand() * 12), Math.floor(rand() * 60));
      n++;
      sales.push({
        created_at: d.toISOString(), product_name: p.name, product_id: p.id, price: p.price,
        refunded: p.price > 0 && rand() < 0.03, email: `buyer${n}@example.com`, order_id: n,
      });
    }
  }
  for (const p of products) {
    const mine = sales.filter((s) => s.product_id === p.id && !s.refunded);
    p.sales_count = mine.length;
    p.sales_usd_cents = mine.reduce((t, s) => t + s.price, 0);
    p.formatted_price = p.price ? money(p.price / 100) : "$0+";
    p.short_url = "https://gumroad.com";
  }
  const codes = {
    d1: [{ id: "c1", name: "SPRING20", percent_off: 20, times_used: 14, max_purchase_count: null }],
    d3: [{ id: "c2", name: "LAUNCH5", amount_cents: 500, times_used: 6, max_purchase_count: 50 }],
  };
  return { products, sales, codes };
})();

// ===================================================================
// Data layer (real Gumroad or demo)
// ===================================================================
const cache = { products: null, sales: new Map(), codes: new Map() };
const clearCache = () => { cache.products = null; cache.sales.clear(); cache.codes.clear(); };

const api = {
  async products() {
    if (!cache.products) cache.products = isDemo() ? demo.products : (await gum("GET", "/products")).products || [];
    return cache.products;
  },
  async sales(after, before) {
    const key = after + "|" + (before || "");
    if (cache.sales.has(key)) return cache.sales.get(key);
    let out;
    if (isDemo()) {
      out = demo.sales.filter((s) => { const d = isoDay(new Date(s.created_at)); return d >= after && (!before || d < before); });
    } else {
      out = [];
      let pageKey = "";
      do {
        const params = { after };
        if (before) params.before = before;
        if (pageKey) params.page_key = pageKey;
        const data = await gum("GET", "/sales", params);
        out.push(...(data.sales || []));
        pageKey = data.next_page_key || "";
      } while (pageKey);
    }
    cache.sales.set(key, out);
    return out;
  },
  async setPublished(id, on) {
    if (isDemo()) { demo.products.find((p) => p.id === id).published = on; return; }
    await gum("PUT", `/products/${encodeURIComponent(id)}/${on ? "enable" : "disable"}`);
    cache.products = null;
  },
  async codes(id) {
    if (isDemo()) return demo.codes[id] || [];
    if (!cache.codes.has(id)) cache.codes.set(id, (await gum("GET", `/products/${encodeURIComponent(id)}/offer_codes`)).offer_codes || []);
    return cache.codes.get(id);
  },
  async createCode(id, { name, type, amount, max }) {
    if (isDemo()) {
      (demo.codes[id] ||= []).push({
        id: "c" + Date.now(), name, times_used: 0, max_purchase_count: max || null,
        ...(type === "percent" ? { percent_off: amount } : { amount_cents: amount }),
      });
      return;
    }
    const params = { name, offer_type: type, amount_off: amount };
    if (max) params.max_purchase_count = max;
    await gum("POST", `/products/${encodeURIComponent(id)}/offer_codes`, params);
    cache.codes.delete(id);
  },
  async deleteCode(id, codeId) {
    if (isDemo()) { demo.codes[id] = (demo.codes[id] || []).filter((c) => c.id !== codeId); return; }
    await gum("DELETE", `/products/${encodeURIComponent(id)}/offer_codes/${encodeURIComponent(codeId)}`);
    cache.codes.delete(id);
  },
};

const salesRows = (sales) => sales.map((s) => ({
  day: isoDay(new Date(s.created_at)), product: s.product_name || "", amount: (s.price || 0) / 100,
  refunded: !!s.refunded, email: s.email || "", order: s.order_id || s.id || "",
}));

// ===================================================================
// Shell & routing
// ===================================================================
const PAGES = { dashboard: viewDashboard, products: viewProducts, discounts: viewDiscounts, writer: viewWriter, export: viewExport, pro: viewPro, settings: viewSettings };

function updateChrome() {
  $("#tabs").hidden = !connected();
  $("#demoBadge").hidden = !isDemo();
  $("#proBadge").hidden = !proActive || isDemo();
  $("#shopLine").textContent = isDemo() ? "Exploring with sample data" : connected() ? "Connected to Gumroad" : "For Gumroad sellers";
  for (const a of document.querySelectorAll("#tabs a")) {
    a.classList.toggle("locked", PRO_PAGES.has(a.dataset.page) && !hasPro());
  }
}

let renderId = 0;
async function route() {
  updateChrome();
  let page = location.hash.slice(1);
  if (!connected() && page !== "pro") return viewWelcome();
  if (!PAGES[page]) page = "dashboard";
  for (const a of document.querySelectorAll("#tabs a")) {
    if (a.dataset.page === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  const id = ++renderId;
  main.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (PRO_PAGES.has(page) && !hasPro()) viewLocked(page);
    else await PAGES[page](() => id === renderId);
  } catch (e) {
    if (id === renderId) main.innerHTML = errorBox(e) + (isDemo() ? "" : '<p><a href="#settings">Open Settings</a></p>');
  }
}
window.addEventListener("hashchange", route);

// ===================================================================
// Welcome / connect
// ===================================================================
const GUMROAD_STEPS = `
  <ol>
    <li>On gumroad.com open <strong>Settings → Advanced</strong>.</li>
    <li>Under <strong>Applications</strong>, create an application (any name; redirect URI <code>http://localhost</code>).</li>
    <li>Click <strong>Generate access token</strong> and copy it.</li>
    <li>Paste it here and click <strong>Connect</strong>.</li>
  </ol>`;

function tokenForm(id) {
  return `
    <form id="${id}">
      <label>Gumroad access token
        <input type="password" name="token" autocomplete="off" spellcheck="false" required>
      </label>
      <div class="row"><button class="btn primary" type="submit">Connect</button></div>
      <div class="formMsg"></div>
    </form>`;
}

function wireTokenForm(form, after) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const token = form.token.value.trim();
    const msg = $(".formMsg", form);
    if (!/^[A-Za-z0-9_\-]{10,}$/.test(token)) { msg.innerHTML = errorBox(new AppError("That doesn't look like a Gumroad token. Copy it again from Gumroad.")); return; }
    const btn = $("button", form);
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      await gum("GET", "/products", {}, token);
      store.set(K.gum, token);
      store.set(K.demo, "");
      clearCache();
      toast("Connected to Gumroad ✅");
      after();
    } catch (e) {
      msg.innerHTML = errorBox(e);
    } finally {
      btn.disabled = false; btn.textContent = "Connect";
    }
  });
}

function viewWelcome() {
  main.innerHTML = `
    <section class="welcome">
      <div class="card">
        <h2>Run your Gumroad shop from one place</h2>
        <p>See sales at a glance, manage discount codes, export orders and write product listings with AI.</p>
        <p class="muted small">Your access token is saved only on this device and is sent only to Gumroad.</p>
        <h3>Connect your Gumroad store</h3>
        ${GUMROAD_STEPS}
        ${tokenForm("connectForm")}
      </div>
      <div class="card">
        <h3>Just looking?</h3>
        <p>Try every feature with a sample shop. Nothing is sent to Gumroad.</p>
        <button class="btn" id="tryDemo" type="button">▶ Try the demo</button>
      </div>
    </section>`;
  wireTokenForm($("#connectForm"), () => { location.hash = "#dashboard"; route(); });
  $("#tryDemo").addEventListener("click", () => {
    store.set(K.demo, "1");
    clearCache();
    location.hash = "#dashboard";
    route();
  });
}

// ===================================================================
// Dashboard
// ===================================================================
function dayBars(rows, days) {
  const totals = new Map();
  for (let i = days - 1; i >= 0; i--) totals.set(isoDay(daysAgo(i)), 0);
  for (const r of rows) if (totals.has(r.day)) totals.set(r.day, totals.get(r.day) + r.amount);
  const vals = [...totals.values()];
  const max = Math.max(...vals, 0.01);
  const keys = [...totals.keys()];
  const bars = keys.map((k, i) => `<div style="height:${(vals[i] / max) * 100}%" title="${prettyDay(k)}: ${money(vals[i])}"></div>`).join("");
  return `<div class="bars" role="img" aria-label="Revenue per day">${bars}</div>
    <div class="axis"><span>${prettyDay(keys[0])}</span><span>${prettyDay(keys[keys.length - 1])}</span></div>`;
}

function productBars(rows) {
  const by = new Map();
  for (const r of rows) {
    const t = by.get(r.product) || { revenue: 0, orders: 0 };
    t.revenue += r.amount; t.orders += 1;
    by.set(r.product, t);
  }
  const list = [...by.entries()].sort((a, b) => b[1].revenue - a[1].revenue || b[1].orders - a[1].orders).slice(0, 8);
  const max = Math.max(...list.map(([, t]) => t.revenue), 0.01);
  return list.map(([name, t]) => `
    <div class="hbar">
      <div class="lab"><span title="${esc(name)}">${esc(name)}</span><span class="muted">${money(t.revenue)} · ${t.orders} order${t.orders === 1 ? "" : "s"}</span></div>
      <div class="track"><div class="fill" style="width:${Math.max((t.revenue / max) * 100, t.revenue ? 2 : 0)}%"></div></div>
    </div>`).join("");
}

let dashDays = 30;
async function viewDashboard(current) {
  const rows = salesRows(await api.sales(isoDay(daysAgo(dashDays - 1))));
  if (!current()) return;
  const paid = rows.filter((r) => !r.refunded);
  const revenue = paid.reduce((t, r) => t + r.amount, 0);
  const refunds = rows.length - paid.length;
  main.innerHTML = `
    <div class="row spread">
      <h2>📊 Dashboard</h2>
      <label class="row" style="margin:0">Period
        <select id="period" style="width:auto">
          ${[7, 30, 90, 365].map((d) => `<option value="${d}" ${d === dashDays ? "selected" : ""}>Last ${d} days</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="grid kpis" style="margin-bottom:16px">
      <div class="kpi"><span>Revenue</span><strong>${money(revenue)}</strong></div>
      <div class="kpi"><span>Orders</span><strong>${paid.length}</strong></div>
      <div class="kpi"><span>Average order</span><strong>${money(paid.length ? revenue / paid.length : 0)}</strong></div>
      <div class="kpi"><span>Refunds</span><strong>${refunds}</strong></div>
    </div>
    ${rows.length ? `
    <div class="grid two">
      <div class="card"><h3>Revenue per day</h3>${dayBars(paid, dashDays)}</div>
      <div class="card"><h3>Best sellers</h3>${productBars(paid)}</div>
    </div>` : `<div class="msg info">No sales in this period yet. Try a longer period.</div>`}
    <div class="row"><button class="btn small" id="refresh" type="button">🔄 Refresh data</button></div>`;
  $("#period").addEventListener("change", (e) => { dashDays = Number(e.target.value); route(); });
  $("#refresh").addEventListener("click", () => { clearCache(); route(); });
}

// ===================================================================
// Products
// ===================================================================
async function viewProducts(current) {
  const products = await api.products();
  if (!current()) return;
  if (!products.length) { main.innerHTML = '<h2>📦 Products</h2><div class="msg info">You don\'t have any products on Gumroad yet.</div>'; return; }
  main.innerHTML = `
    <h2>📦 Products</h2>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Product</th><th class="num">Price</th><th class="num">Sales</th><th class="num">Revenue</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${products.map((p) => `
            <tr>
              <td>${p.short_url ? `<a href="${esc(p.short_url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td>
              <td class="num">${esc(p.formatted_price || "")}</td>
              <td class="num">${p.sales_count || 0}</td>
              <td class="num">${money((p.sales_usd_cents || 0) / 100)}</td>
              <td><span class="pill ${p.published ? "on" : ""}">${p.published ? "Published" : "Unpublished"}</span></td>
              <td><button class="btn small" type="button" data-id="${esc(p.id)}">${p.published ? "Unpublish" : "Publish"}</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="muted small">Sales and revenue are all-time totals from Gumroad.</p>`;
  main.querySelectorAll("button[data-id]").forEach((btn) => btn.addEventListener("click", async () => {
    const p = products.find((x) => x.id === btn.dataset.id);
    const action = p.published ? "Unpublish" : "Publish";
    if (!confirm(`${action} “${p.name}”?${p.published ? "\n\nBuyers won't be able to buy it until you publish it again." : ""}`)) return;
    btn.disabled = true;
    try { await api.setPublished(p.id, !p.published); toast(`${action}ed “${p.name}”`); route(); }
    catch (e) { btn.disabled = false; main.insertAdjacentHTML("afterbegin", errorBox(e)); }
  }));
}

// ===================================================================
// Discount codes
// ===================================================================
let discountProduct = "";
const describeCode = (c) => c.percent_off != null ? `${c.percent_off}% off` : c.amount_cents != null ? `${money(c.amount_cents / 100)} off` : "—";

async function viewDiscounts(current) {
  const products = await api.products();
  if (!current()) return;
  if (!products.length) { main.innerHTML = '<h2>🏷️ Discount codes</h2><div class="msg info">You don\'t have any products on Gumroad yet.</div>'; return; }
  if (!products.some((p) => p.id === discountProduct)) discountProduct = products[0].id;
  const codes = await api.codes(discountProduct);
  if (!current()) return;
  main.innerHTML = `
    <h2>🏷️ Discount codes</h2>
    <label>Product
      <select id="dProduct">${products.map((p) => `<option value="${esc(p.id)}" ${p.id === discountProduct ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
    </label>
    <div class="card table-wrap">
      <h3>Existing codes</h3>
      ${codes.length ? `<table>
        <thead><tr><th>Code</th><th>Discount</th><th class="num">Used</th><th class="num">Max uses</th><th></th></tr></thead>
        <tbody>${codes.map((c) => `
          <tr><td><strong>${esc(c.name)}</strong></td><td>${describeCode(c)}</td><td class="num">${c.times_used || 0}</td>
          <td class="num">${c.max_purchase_count || "Unlimited"}</td>
          <td><button class="btn small danger" type="button" data-code="${esc(c.id)}">Delete</button></td></tr>`).join("")}
        </tbody></table>` : '<p class="muted">No discount codes for this product yet.</p>'}
    </div>
    <form class="card" id="codeForm">
      <h3>Create a new code</h3>
      <div class="grid three">
        <label>Code <span class="hint">(letters and numbers)</span><input name="name" maxlength="40" placeholder="SPRING20" required></label>
        <label>Type
          <select name="type"><option value="percent">Percent off</option><option value="cents">Fixed amount off ($)</option></select>
        </label>
        <label>Amount <input name="amount" type="number" min="0.5" step="0.5" value="20" required></label>
      </div>
      <label>Max uses <span class="hint">(leave empty for unlimited)</span><input name="max" type="number" min="1" step="1"></label>
      <div class="formMsg"></div>
      <button class="btn primary" type="submit">Create code</button>
    </form>`;
  $("#dProduct").addEventListener("change", (e) => { discountProduct = e.target.value; route(); });
  main.querySelectorAll("button[data-code]").forEach((btn) => btn.addEventListener("click", async () => {
    const c = codes.find((x) => x.id === btn.dataset.code);
    if (!confirm(`Delete the code ${c.name}? Buyers won't be able to use it anymore.`)) return;
    btn.disabled = true;
    try { await api.deleteCode(discountProduct, c.id); toast(`Deleted ${c.name}`); route(); }
    catch (e) { btn.disabled = false; main.insertAdjacentHTML("afterbegin", errorBox(e)); }
  }));
  const form = $("#codeForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $(".formMsg", form);
    const name = form.name.value.trim().toUpperCase();
    const type = form.type.value;
    const amt = Number(form.amount.value);
    const max = form.max.value ? Math.floor(Number(form.max.value)) : 0;
    if (!/^[A-Z0-9]+$/.test(name)) { msg.innerHTML = errorBox(new AppError("The code must be letters and numbers only, with no spaces.")); return; }
    if (type === "percent" && !(amt >= 1 && amt <= 100)) { msg.innerHTML = errorBox(new AppError("Percent off must be between 1 and 100.")); return; }
    if (!(amt > 0)) { msg.innerHTML = errorBox(new AppError("Enter an amount above zero.")); return; }
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      await api.createCode(discountProduct, { name, type, amount: type === "percent" ? Math.round(amt) : Math.round(amt * 100), max });
      toast(`Created ${name} ✅`);
      route();
    } catch (e) { btn.disabled = false; msg.innerHTML = errorBox(e); }
  });
}

// ===================================================================
// AI listing writer (Claude, with the seller's own Anthropic key)
// ===================================================================
const AI_MODEL = "claude-opus-5-5";
const AI_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" }, seo_title: { type: "string" }, short_summary: { type: "string" },
    description: { type: "string" }, whats_included: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } }, meta_description: { type: "string" },
  },
  required: ["title", "seo_title", "short_summary", "description", "whats_included", "tags", "meta_description"],
  additionalProperties: false,
};
const AI_SYSTEM = `You write product listings for an independent seller of digital products (art packs, printables, worksheets, datasets, courses, templates, cheat sheets) on Gumroad and Etsy.

Write copy that is specific, warm and honest:
- Use only facts the seller gives you. Never invent file counts, formats, sizes, licences, guarantees, reviews or results. If a detail is missing, leave it out rather than guess.
- Lead with what the buyer gets and who it is for, then the details.
- Plain, friendly English. No hype words like "ultimate", "game-changer" or "revolutionary", no ALL CAPS, at most two emoji in the whole listing.

Field rules:
- title: up to 80 characters, natural, includes the main keyword.
- seo_title: up to 60 characters.
- short_summary: one sentence, up to 160 characters.
- description: 120-250 words in Markdown, short paragraphs, may use a few bullet points. Do not repeat the "what's included" list word for word.
- whats_included: 3-8 short bullet items, only from the seller's facts.
- tags: exactly 13 search tags, each 20 characters or fewer, lowercase, no '#', no duplicates.
- meta_description: up to 155 characters.`;

async function claude(path, apiKey, body) {
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2026-10-21",
    "anthropic-dangerous-direct-browser-access": "true",
    "content-type": "application/json",
  };
  if (body) headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1" + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new AppError("Couldn't reach Anthropic. Check your internet connection."); }
  let data = {};
  try { data = await r.json(); } catch { /* keep empty */ }
  if (r.ok) return data;
  const detail = data.error?.message || "";
  if (r.status === 401) throw new AppError("Your Anthropic API key was rejected. Add a new one in Settings.");
  if (r.status === 403) throw new AppError("This API key isn't allowed to use the model. Check your Anthropic account.");
  if (r.status === 429) throw new AppError("Too many requests right now. Wait a minute and try again.");
  if (r.status === 400 && /credit/i.test(detail)) throw new AppError("Your Anthropic account is out of credit. Add credit at console.anthropic.com.");
  if (r.status >= 500) throw new AppError("Anthropic is having trouble right now. Try again in a minute.");
  throw new AppError(`Anthropic error (${r.status})${detail ? ": " + detail : ""}`);
}

async function writeListing(apiKey, brief) {
  const data = await claude("/messages", apiKey, {
    model: AI_MODEL,
    max_tokens: 16000,
    fallbacks: "default",
    system: AI_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [{ role: "user", content: brief }],
  });
  if (data.stop_reason === "refusal") throw new AppError("The AI declined to write this listing. Try rewording your notes.");
  if (data.stop_reason === "max_tokens") throw new AppError("The answer was cut off. Try shorter notes.");
  const text = (data.content || []).find((b) => b.type === "text")?.text || "";
  try { return JSON.parse(text); } catch { throw new AppError("The AI's answer couldn't be read. Please try again."); }
}

// Pre-written example for the demo shop's first product (matches its demo facts).
const DEMO_LISTING = {
  title: "Watercolour Botanical Clipart – 40 Hand-Painted PNGs with Transparent Backgrounds",
  seo_title: "Watercolour Botanical Clipart – 40 PNG Files",
  short_summary: "40 hand-painted watercolour botanicals as transparent PNGs, ready for cards, invitations and branding.",
  description: "Bring a soft, hand-painted feel to your designs with this collection of **40 watercolour botanical illustrations**.\n\nEvery piece is saved as a PNG with a transparent background, so you can drop leaves, stems and blooms straight onto cards, wedding stationery, social posts or product labels without any cutting out.\n\n- Layer pieces together to build your own wreaths and borders\n- Works in Canva, Procreate, Photoshop and most design apps\n- Instant download, nothing is posted to you\n\nA calm, natural set for anyone who loves botanical style.",
  whats_included: ["40 watercolour botanical illustrations", "PNG files with transparent backgrounds", "Instant digital download"],
  tags: ["watercolor clipart", "botanical clipart", "floral png", "leaf clipart", "wedding clipart", "greenery png", "transparent png", "hand painted", "card making", "invitation art", "digital clipart", "flower clipart", "craft supplies"],
  meta_description: "40 hand-painted watercolour botanical PNGs with transparent backgrounds for cards, invitations and branding. Instant download.",
};

function sampleListing(name) {
  if (name === demo.products[0].name) return DEMO_LISTING;
  return {
    title: `${name} – Printable Digital Download`,
    seo_title: name.slice(0, 60),
    short_summary: `A ready-to-use digital download: ${name}.`,
    description: `This is a **sample listing** shown in demo mode. With your own Anthropic API key, the AI writes a real listing from the facts you enter.\n\n- Tells buyers what they get\n- Uses only the facts you give it\n- Ready to paste into Gumroad or Etsy`,
    whats_included: ["Sample item one", "Sample item two", "Instant download"],
    tags: ["digital download", "printable", "instant download", "sample tag", "gift idea", "home decor", "planner", "worksheet", "clipart", "art print", "template", "small business", "handmade"],
    meta_description: `Sample meta description for ${name}.`,
  };
}

const md = (text) => {
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  let html = "", list = false;
  for (const raw of esc(text).split("\n")) {
    const line = raw.trim();
    if (/^[-*•] /.test(line)) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    if (!line) continue;
    const h = line.match(/^#{1,4} (.*)/);
    html += h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(line)}</p>`;
  }
  return html + (list ? "</ul>" : "");
};
const htmlToText = (h) => (new DOMParser().parseFromString(h || "", "text/html").body.textContent || "").replace(/\s+/g, " ").trim();

let lastListing = null;
async function viewWriter(current) {
  const products = await api.products();
  if (!current()) return;
  const aiKey = store.get(K.ai);
  if (!aiKey && !isDemo()) {
    main.innerHTML = `
      <h2>✍️ AI listing writer</h2>
      <div class="card">
        <p>Writes a title, description, tags and SEO text from a few notes. It uses <strong>your own</strong> Anthropic account; each listing costs a few US cents there.</p>
        <h3>Add your Anthropic API key</h3>
        <ol>
          <li>Sign in at <strong>console.anthropic.com</strong> and add a little credit under <strong>Billing</strong>.</li>
          <li>Open <strong>API keys → Create key</strong> and copy it right away (it starts with <code>sk-ant-</code>).</li>
          <li>Paste it below. It's saved only on this device and sent only to Anthropic.</li>
        </ol>
        ${aiKeyForm("aiForm")}
      </div>`;
    wireAiKeyForm($("#aiForm"), route);
    return;
  }
  main.innerHTML = `
    <h2>✍️ AI listing writer</h2>
    ${!aiKey ? '<div class="msg warn">Demo mode: you\'ll see a sample listing. Add your Anthropic API key in Settings to write real ones.</div>' : ""}
    <form class="card" id="wForm">
      <label>Start from
        <select name="start"><option value="">✏️ A new product</option>${products.map((p) => `<option value="${esc(p.id)}">📦 ${esc(p.name)}</option>`).join("")}</select>
      </label>
      <label>Product name <input name="name" required></label>
      <div class="grid three">
        <label>Product type
          <select name="type">${["Digital art pack", "Printable / worksheet", "Dataset / dashboard", "Course / guide", "Template", "Cheat sheet", "Other digital product"].map((t) => `<option>${t}</option>`).join("")}</select>
        </label>
        <label>Selling on <select name="platform"><option>Gumroad</option><option>Etsy</option><option>Gumroad and Etsy</option></select></label>
        <label>Tone <select name="tone"><option>Warm and friendly</option><option>Professional</option><option>Playful</option><option>Calm and elegant</option></select></label>
      </div>
      <label>Who is it for? <span class="hint">(optional)</span><input name="audience" placeholder="e.g. parents teaching kids to write at home"></label>
      <label>Facts about the product
        <textarea name="notes" placeholder="e.g. 26 printable pages, A4 PDF, tracing letters with pictures, for ages 3-6"></textarea>
      </label>
      <label class="check" id="useExistingRow" hidden><input type="checkbox" name="useExisting" checked> Improve the current Gumroad description</label>
      <div class="formMsg"></div>
      <button class="btn primary" type="submit">✨ Write listing</button>
    </form>
    <div id="wOut"></div>`;
  const form = $("#wForm");
  let existing = "";
  if (isDemo() && startParams.get("sample") === "1" && !lastListing && products[0]) {
    form.name.value = products[0].name;
    lastListing = sampleListing(products[0].name);
  }
  form.start.addEventListener("change", () => {
    const p = products.find((x) => x.id === form.start.value);
    existing = p ? htmlToText(p.description) : "";
    if (p) form.name.value = p.name;
    $("#useExistingRow").hidden = !existing;
  });
  if (lastListing) showListing(lastListing);
  if (startParams.get("sample") === "1") form.before($("#wOut"));  // screenshot link: result first
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $(".formMsg", form);
    msg.innerHTML = "";
    const name = form.name.value.trim();
    const notes = form.notes.value.trim();
    const useExisting = existing && form.useExisting.checked;
    if (!name) { msg.innerHTML = errorBox(new AppError("Please enter a product name.")); return; }
    if (!notes && !useExisting) { msg.innerHTML = errorBox(new AppError("Add a few facts about the product so the AI has something true to write about.")); return; }
    const brief = [`Product name: ${name}`, `Product type: ${form.type.value}`, `Selling on: ${form.platform.value}`, `Tone: ${form.tone.value}`];
    if (form.audience.value.trim()) brief.push(`Who it's for: ${form.audience.value.trim()}`);
    if (notes) brief.push(`Seller's notes and facts:\n${notes}`);
    if (useExisting) brief.push(`Current listing text (improve on it, keep its facts):\n${existing}`);
    const btn = $("button[type=submit]", form);
    btn.disabled = true; btn.textContent = "Writing… (about 20–60 seconds)";
    try {
      lastListing = aiKey ? await writeListing(aiKey, brief.join("\n\n")) : sampleListing(name);
      showListing(lastListing);
      $("#wOut").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { msg.innerHTML = errorBox(e); }
    finally { btn.disabled = false; btn.textContent = "✨ Write listing"; }
  });
}

function showListing(L) {
  const included = (L.whats_included || []).map((i) => `• ${i}`).join("\n");
  const tags = L.tags || [];
  const parts = [
    ["Title", L.title], ["Short summary", L.short_summary], ["Description", L.description, "rich"],
    ["What's included", included], ["Tags", tags.join(", "), "tags"], ["SEO title", L.seo_title], ["Meta description", L.meta_description],
  ];
  const blocks = parts.map(([label, text, kind], i) => `
    <div class="out-block">
      <div class="out-head"><strong>${label}${kind === "tags" ? ` (${tags.length})` : ""}</strong><button class="btn small" type="button" data-copy="${i}">📋 Copy</button></div>
      ${kind === "rich" ? `<div class="out-rich">${md(text)}</div>`
        : kind === "tags" ? `<div class="tags">${tags.map((t) => `<span class="${t.length > 20 ? "long" : ""}">${esc(t)}</span>`).join("")}</div>`
        : `<div class="out-text">${esc(text)}</div>`}
    </div>`).join("");
  const tooLong = tags.filter((t) => t.length > 20);
  $("#wOut").innerHTML = `
    <div class="card">
      <div class="row spread"><h3>Your listing</h3><button class="btn small" id="dlListing" type="button">⬇️ Download .txt</button></div>
      ${tooLong.length ? `<div class="msg warn">Etsy allows 20 characters per tag. Shorten: ${tooLong.map(esc).join(", ")}</div>` : ""}
      ${blocks}
    </div>`;
  $("#wOut").querySelectorAll("button[data-copy]").forEach((b) => b.addEventListener("click", () => copy(parts[b.dataset.copy][1] || "")));
  $("#dlListing").addEventListener("click", () => download("listing.txt",
    parts.map(([label, text]) => `${label.toUpperCase()}\n${text}\n`).join("\n"), "text/plain"));
}

function aiKeyForm(id) {
  return `
    <form id="${id}">
      <label>Anthropic API key <input type="password" name="key" autocomplete="off" spellcheck="false" required></label>
      <div class="formMsg"></div>
      <button class="btn primary" type="submit">Save key</button>
    </form>`;
}

function wireAiKeyForm(form, after) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const key = form.key.value.trim();
    const msg = $(".formMsg", form);
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key)) { msg.innerHTML = errorBox(new AppError("That doesn't look like an Anthropic API key (it starts with sk-ant-).")); return; }
    const btn = $("button", form);
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      await claude("/models?limit=1", key);
      store.set(K.ai, key);
      toast("Anthropic API key saved ✅");
      after();
    } catch (e) { msg.innerHTML = errorBox(e); }
    finally { btn.disabled = false; btn.textContent = "Save key"; }
  });
}

// ===================================================================
// Export
// ===================================================================
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function viewExport(current) {
  main.innerHTML = `
    <h2>⬇️ Export sales</h2>
    <form class="card" id="xForm">
      <p class="muted">Download your sales as a CSV file for Excel or Google Sheets. The file includes buyer emails, so keep it private.</p>
      <div class="grid two">
        <label>From <input type="date" name="from" value="${isoDay(daysAgo(30))}" required></label>
        <label>To <input type="date" name="to" value="${isoDay(new Date())}" required></label>
      </div>
      <div class="formMsg"></div>
      <button class="btn primary" type="submit">⬇️ Download CSV</button>
    </form>`;
  if (!current()) return;
  const form = $("#xForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $(".formMsg", form);
    msg.innerHTML = "";
    const from = form.from.value, to = form.to.value;
    if (from > to) { msg.innerHTML = errorBox(new AppError("“From” must be before “To”.")); return; }
    const before = new Date(to + "T12:00:00"); before.setDate(before.getDate() + 1);
    const btn = $("button", form);
    btn.disabled = true; btn.textContent = "Fetching sales…";
    try {
      const rows = salesRows(await api.sales(from, isoDay(before)));
      if (!rows.length) { msg.innerHTML = '<div class="msg info">No sales in this date range.</div>'; return; }
      const lines = [["Date", "Product", "Amount $", "Refunded", "Buyer email", "Order ID"]]
        .concat(rows.map((r) => [r.day, r.product, r.amount.toFixed(2), r.refunded ? "yes" : "no", r.email, r.order]));
      download(`gumroad-sales_${from}_${to}.csv`, "﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n"), "text/csv");
      msg.innerHTML = `<div class="msg info">Downloaded ${rows.length} sale${rows.length === 1 ? "" : "s"}.</div>`;
    } catch (e) { msg.innerHTML = errorBox(e); }
    finally { btn.disabled = false; btn.textContent = "⬇️ Download CSV"; }
  });
}

// ===================================================================
// Pro: unlock with a code
// ===================================================================
const PRO_FEATURES = `
  <ul>
    <li>✍️ <strong>AI listing writer</strong>: titles, descriptions, 13 tags and SEO text</li>
    <li>🏷️ <strong>Discount codes</strong>: create, track and delete codes</li>
    <li>⬇️ <strong>Sales export</strong>: any date range as a CSV file</li>
  </ul>`;
const PAGE_NAMES = { discounts: "Discount codes", writer: "The AI listing writer", export: "Sales export" };

function proCodeForm(id) {
  return `
    <form id="${id}">
      <label>Your code <span class="hint">(for example EST-ABCD-EFGH-JKMN)</span>
        <input name="code" autocomplete="off" spellcheck="false" autocapitalize="characters" required>
      </label>
      <div class="formMsg"></div>
      <button class="btn primary" type="submit">Unlock Pro</button>
    </form>`;
}

function wireProCodeForm(form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $(".formMsg", form);
    const code = form.code.value.trim();
    const btn = $("button", form);
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      if (!(await codeIsValid(code))) throw new AppError("That code isn't valid. Check it against your AppSumo purchase and try again.");
      store.set(K.pro, normalizeCode(code));
      proActive = true;
      toast("Pro unlocked ✅");
      location.hash = connected() ? "#writer" : "";
      route();
    } catch (e) { msg.innerHTML = errorBox(e); }
    finally { btn.disabled = false; btn.textContent = "Unlock Pro"; }
  });
}

function viewLocked(page) {
  main.innerHTML = `
    <div class="card">
      <h2>🔒 ${PAGE_NAMES[page]} is part of Pro</h2>
      <p>Pro adds:</p>
      ${PRO_FEATURES}
      <p>Have a code from AppSumo? Enter it below. It unlocks Pro for good in this app.</p>
      ${proCodeForm("lockForm")}
    </div>`;
  wireProCodeForm($("#lockForm"));
}

async function viewPro() {
  if (proActive) {
    main.innerHTML = `
      <h2>⭐ Pro</h2>
      <div class="card">
        <p>✅ <strong>Pro is unlocked</strong> in this app.</p>
        ${PRO_FEATURES}
        <p class="muted small">Your code is saved only on this device. To use Pro on another device, enter the same code there.</p>
        <button class="btn danger small" id="rmPro" type="button">Remove the code from this device</button>
      </div>`;
    $("#rmPro").addEventListener("click", () => {
      if (!confirm("Remove your Pro code from this device? Keep a copy of it so you can enter it again.")) return;
      store.set(K.pro, ""); proActive = false; toast("Pro code removed"); route();
    });
    return;
  }
  main.innerHTML = `
    <h2>⭐ Unlock Pro</h2>
    <div class="card">
      <p>The dashboard and products list are open to everyone. Pro adds:</p>
      ${PRO_FEATURES}
      <h3>Enter your AppSumo code</h3>
      ${proCodeForm("proForm")}
      ${connected() ? "" : '<p class="muted small">After unlocking, connect your Gumroad store to start using it.</p>'}
    </div>`;
  wireProCodeForm($("#proForm"));
}

// ===================================================================
// Settings
// ===================================================================
async function viewSettings() {
  const hasGum = !!store.get(K.gum), hasAi = !!store.get(K.ai);
  main.innerHTML = `
    <h2>⚙️ Settings</h2>
    <div class="card">
      <h3>Gumroad</h3>
      <p>${isDemo() ? "You're in <strong>demo mode</strong> with sample data." : hasGum ? "✅ Connected." : "Not connected."}</p>
      <details ${!hasGum || isDemo() ? "open" : ""}>
        <summary>${hasGum ? "Replace the access token" : "Connect your Gumroad store"}</summary>
        ${GUMROAD_STEPS}
        ${tokenForm("sTokenForm")}
      </details>
      ${isDemo() ? '<p><button class="btn" id="leaveDemo" type="button">Leave demo mode</button></p>' : ""}
    </div>
    <div class="card">
      <h3>AI listing writer</h3>
      <p>${hasAi ? "✅ Anthropic API key saved." : "No Anthropic API key yet."} <span class="muted small">Uses your own Anthropic account; each listing costs a few US cents.</span></p>
      <details><summary>${hasAi ? "Replace the API key" : "Add an API key"}</summary>${aiKeyForm("sAiForm")}</details>
      ${hasAi ? '<p><button class="btn danger small" id="rmAi" type="button">Remove API key</button></p>' : ""}
    </div>
    <div class="card">
      <h3>Pro</h3>
      <p>${isDemo() ? "Demo mode shows every Pro feature." : proActive ? "✅ Pro is unlocked." : "Pro is not unlocked."} <a href="#pro">${proActive ? "Manage Pro" : "Enter a code"}</a></p>
    </div>
    <div class="card">
      <h3>This device</h3>
      <p class="muted small">Your keys are stored only in this app on this device and are sent only to Gumroad and Anthropic.</p>
      <button class="btn danger" id="forget" type="button">Disconnect and remove all keys</button>
    </div>`;
  wireTokenForm($("#sTokenForm"), route);
  wireAiKeyForm($("#sAiForm"), route);
  $("#leaveDemo")?.addEventListener("click", () => { store.set(K.demo, ""); clearCache(); route(); });
  $("#rmAi")?.addEventListener("click", () => { if (confirm("Remove the Anthropic API key from this device?")) { store.set(K.ai, ""); toast("API key removed"); route(); } });
  $("#forget").addEventListener("click", () => {
    if (!confirm("Disconnect Gumroad and remove all keys from this device?")) return;
    store.set(K.gum, ""); store.set(K.ai, ""); store.set(K.demo, "");
    clearCache(); lastListing = null;
    location.hash = "";
    toast("All keys removed");
    route();
  });
}

// ===================================================================
// Start
// ===================================================================
(async () => {
  const saved = store.get(K.pro);
  proActive = !!saved && await codeIsValid(saved).catch(() => false);
  route();
})();
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
