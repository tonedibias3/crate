import { CONFIG } from "./config.js";
import { makeApi } from "./api.js?v=9";

/* ======================================================================
   helpers
   ====================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CONDITIONS = ["Not graded", "Mint", "Near Mint", "Very Good Plus", "Very Good", "Good", "Fair", "Poor"];
const GRADE_GUIDE = `<details class="grade-guide"><summary>What do the grades mean?</summary>
  <dl>
    <dt>Not graded</dt><dd>You haven't checked. That's fine, most people start here.</dd>
    <dt>Mint</dt><dd>Perfect. Usually still sealed.</dd>
    <dt>Near Mint</dt><dd>Looks almost new. Barely played, no visible flaws.</dd>
    <dt>Very Good Plus</dt><dd>Light wear. A few faint marks, plays great.</dd>
    <dt>Very Good</dt><dd>Visible wear and some surface noise, still plays well.</dd>
    <dt>Good</dt><dd>Heavy wear and noise. Plays all the way through.</dd>
    <dt>Fair / Poor</dt><dd>Damaged. Skips or is badly scratched.</dd>
  </dl>
  <p class="help">To grade, pull the record out and tilt the vinyl under a bright light. Be honest, buyers will check.</p></details>`;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const ICON = {
  matches: '<svg viewBox="0 0 24 24"><path d="M6 8h12l-3.5-3.5M18 16H6l3.5 3.5"/></svg>',
  feed: '<svg viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  collection: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/></svg>',
  wantlist: '<svg viewBox="0 0 24 24"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>',
};

const TABS = [
  ["matches", "Matches"],
  ["feed", "Feed"],
  ["search", "Search"],
  ["collection", "Collection"],
  ["wantlist", "Wantlist"],
];

function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const hueOf = (s) => hash(s) % 360;

function wrapText(text, n, max) {
  const lines = [];
  let cur = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > n && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  const out = lines.slice(0, max).map((l) => (l.length > n + 2 ? l.slice(0, n) + "…" : l));
  if (lines.length > max) out[max - 1] = out[max - 1].replace(/…?$/, "…");
  return out;
}

const artCache = new Map();
function artSvg(artist = "", title = "") {
  const key = `${artist}|${title}`;
  if (artCache.has(key)) return artCache.get(key);
  const hue = hueOf(key);
  const lines = wrapText(title, 13, 4);
  const startY = 276 - (lines.length - 1) * 34;
  const tspans = lines.map((l, i) => `<tspan x="24" dy="${i ? 34 : 0}">${esc(l)}</tspan>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">` +
    `<rect width="300" height="300" fill="hsl(${hue} 32% 20%)"/>` +
    `<circle cx="215" cy="85" r="150" fill="none" stroke="hsl(${hue} 40% 30%)" stroke-width="2"/>` +
    `<circle cx="215" cy="85" r="104" fill="none" stroke="hsl(${hue} 40% 28%)" stroke-width="2"/>` +
    `<circle cx="215" cy="85" r="58" fill="hsl(${hue} 55% 46%)"/><circle cx="215" cy="85" r="5" fill="#0f0f13"/>` +
    `<text x="24" y="38" font-family="Georgia,serif" font-size="15" fill="hsl(${hue} 30% 82%)">${esc(String(artist).slice(0, 28))}</text>` +
    `<text x="24" y="${startY}" font-family="Georgia,serif" font-weight="700" font-size="30" fill="hsl(${hue} 40% 94%)">${tspans}</text>` +
    `</svg>`;
  const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  artCache.set(key, uri);
  return uri;
}

const safeUrl = (u) => (typeof u === "string" && /^(https?:|data:image\/|blob:)/i.test(u) ? u : null);

function coverImg(r, { alt = false, cls = "" } = {}) {
  const src = safeUrl(r.cover_url) || safeUrl(r.cover) || artSvg(r.artist, r.title);
  const label = alt ? `${r.title} by ${r.artist}` : "";
  return `<img class="cover ${cls}" src="${esc(src)}" alt="${esc(label)}" loading="lazy" decoding="async" data-artist="${esc(r.artist)}" data-title="${esc(r.title)}">`;
}

// A cover that fails to load falls back to the generated sleeve
document.addEventListener(
  "error",
  (e) => {
    const t = e.target;
    if (t?.tagName === "IMG" && t.dataset.artist !== undefined && !t.dataset.fell) {
      t.dataset.fell = "1";
      t.src = artSvg(t.dataset.artist, t.dataset.title);
    }
  },
  true,
);

const money = (n, cur = "USD") => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n); }
  catch { return `$${Number(n).toFixed(2)}`; }
};
function priceLine(p) {
  if (!p) return "";
  if (p.lowest === null || p.lowest === undefined) return "None for sale on Discogs right now";
  return `From ${money(p.lowest, p.currency)} on Discogs, ${p.for_sale} for sale`;
}
// Fills the price row in whatever sheet is open. Safe if the sheet closes first.
async function loadPrice(releaseId) {
  const slot = $("#price-slot");
  if (!slot) return;
  try {
    const p = await state.api.discogs.price(releaseId);
    const now = $("#price-slot");
    if (now && now.dataset.id === String(releaseId)) now.innerHTML = `<span class="price-main">${esc(priceLine(p))}</span><span class="price-note">Lowest current listing, not an appraisal</span>`;
  } catch {
    const now = $("#price-slot");
    if (now) now.remove();
  }
}
const priceSlot = (id) => `<div class="price-row" id="price-slot" data-id="${esc(id)}"><span class="price-main skel-text">Checking Discogs…</span></div>`;

const fmtList = (f) =>
  (Array.isArray(f) ? f : String(f || "").split(","))
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "vinyl");

const chipsHtml = (f, extra = "") => {
  const list = fmtList(f);
  const html = list.map((c) => `<span class="chip">${esc(c)}</span>`).join("") + extra;
  return html ? `<div class="chips">${html}</div>` : "";
};

const metaLine = (r) => [r.year, r.label, r.country].filter(Boolean).join(", ");

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function avatar(p, size = 36) {
  const name = p?.username || "?";
  const inner = safeUrl(p?.avatar_url) ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(name[0].toUpperCase());
  return `<span class="avatar" style="--s:${size}px;--h:${hueOf(name)}">${inner}</span>`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const skeleton = (n = 4) => '<div class="skel"></div>'.repeat(n);

let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 3400);
}

/* ======================================================================
   sheets
   ====================================================================== */

function openSheet(html) {
  closeSheet();
  const root = $("#sheet-root");
  root.innerHTML = `<div class="backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  document.body.classList.add("noscroll");
  const sheet = $(".sheet", root);
  const focusable = sheet.querySelector("input,select,textarea,button");
  if (focusable && !matchMedia("(pointer: coarse)").matches) focusable.focus();
  return sheet;
}
function closeSheet() {
  $("#sheet-root").innerHTML = "";
  document.body.classList.remove("noscroll");
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
});

/* ======================================================================
   themes and small preferences (stored on this device only)
   ====================================================================== */

const THEMES = [
  { id: "walnut", name: "Walnut", note: "Dark wood, amber lamp light", colors: ["#6a4528", "#1b130d", "#e3a233"], bar: "#4b2f1a" },
  { id: "daylight", name: "Daylight", note: "Cream tin ceiling, oak, brick red", colors: ["#b98655", "#eadfc6", "#b4452b"], bar: "#96673c" },
  { id: "midnight", name: "Midnight", note: "Dark and cool, the original", colors: ["#2f2f3b", "#0f0f13", "#4b6bfa"], bar: "#0f0f13" },
];
const pref = {
  get(k, d) { try { return localStorage.getItem("crate-" + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("crate-" + k, v); } catch { /* private mode */ } },
};
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.setAttribute("data-theme", t.id);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bar);
  pref.set("theme", t.id);
}
applyTheme(pref.get("theme", "walnut"));

/* ======================================================================
   state
   ====================================================================== */

const state = {
  api: null,
  userId: null,
  me: null,
  items: new Map(), // item id -> item (so sheets can open any record we've loaded)
  wants: new Map(),
  feedMode: "following",
  mine: { owned: new Set(), wanted: new Set() },
  search: { q: "", mode: "search", master: null, results: [], page: 1, pages: 1, loading: false, error: "", seq: 0, sort: "relevance" },
  profile: null,
  matchUsers: 0,
};

let renderToken = 0;
const setView = (token, html) => {
  if (token !== renderToken) return false;
  view.innerHTML = html;
  return true;
};
const remember = (items) => items.forEach((i) => state.items.set(i.id, i));

/* ======================================================================
   chrome (top bar, tab bar)
   ====================================================================== */

function renderChrome() {
  const demoTag = state.api.mode === "demo" ? '<span class="demo-tag">Demo</span>' : "";
  $("#topbar").innerHTML =
    `<a class="wordmark" href="#/matches" aria-label="White Whale home"><span class="dot"></span>White Whale${demoTag}</a>` +
    `<div class="topbar-right"><button class="icon-btn" data-act="settings" aria-label="Settings">${ICON.gear}</button>` +
    `<a class="avatar-btn" href="#/u/${esc(state.me.username)}" aria-label="Your profile">${avatar(state.me, 36)}</a></div>`;
  $("#tabs").innerHTML = TABS.map(
    ([id, label]) =>
      `<button class="tab" data-act="tab" data-tab="${id}" id="tab-${id}">${ICON[id]}<span>${label}</span></button>`,
  ).join("");
  paintBadge();
}

function paintBadge() {
  const tab = $("#tab-matches");
  if (!tab) return;
  tab.querySelector(".badge")?.remove();
  if (state.matchUsers > 0) tab.insertAdjacentHTML("beforeend", `<span class="badge">${state.matchUsers}</span>`);
}

async function refreshBadge() {
  try {
    const rows = await state.api.matches();
    state.matchUsers = new Set(rows.map((r) => r.other_user_id)).size;
    paintBadge();
  } catch { /* the badge is a nicety */ }
}

function setActiveTab(name) {
  for (const [id] of TABS) {
    const el = $(`#tab-${id}`);
    if (!el) continue;
    if (id === name) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }
}

/* ======================================================================
   auth
   ====================================================================== */

function renderAuth(mode = "login", notice = "") {
  $("#topbar").hidden = true;
  $("#tabs").hidden = true;
  view.dataset.mode = "auth";
  const signup = mode === "signup";
  view.innerHTML = `
    <section class="auth">
      <div class="wordmark"><span class="dot"></span>White Whale</div>
      <p class="tagline">Show your collection. Find who has the record you're hunting.</p>
      <form data-form="auth" data-mode="${mode}" novalidate>
        ${signup ? `
          <label class="field"><span>Username</span>
            <input class="input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="20" placeholder="vinyl_fan">
            <div class="help">3 to 20 letters, numbers or underscores. Others see this.</div></label>
          <label class="field"><span>City (optional)</span>
            <input class="input" name="city" autocomplete="address-level2" maxlength="60" placeholder="Augusta, GA"></label>` : ""}
        ${signup
          ? `<label class="field"><span>Email</span>
          <input class="input" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="you@example.com">
          <div class="help">Only used to reset your password. Others never see it.</div></label>`
          : `<label class="field"><span>Username or email</span>
          <input class="input" name="identifier" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="username or you@example.com"></label>`}
        <label class="field"><span>Password</span>
          <span class="pw"><input class="input" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "At least 8 characters" : "Your password"}">
          <button type="button" class="eye" data-act="toggle-pw" aria-label="Show password" aria-pressed="false">${ICON.eye}</button></span></label>
        <p class="error" id="auth-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">${signup ? "Create account" : "Log in"}</button>
      </form>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
      <p class="switch-mode">${signup ? "Already have an account?" : "New here?"}
        <button class="link" data-act="auth-mode" data-mode="${signup ? "login" : "signup"}">${signup ? "Log in" : "Create an account"}</button></p>
    </section>`;
}

async function submitAuth(form) {
  const mode = form.dataset.mode;
  const f = new FormData(form);
  const email = String(f.get("email") || "").trim();
  const identifier = String(f.get("identifier") || "").trim();
  const password = String(f.get("password") || "");
  const errBox = $("#auth-error");
  const showErr = (m) => { errBox.textContent = m; errBox.hidden = false; };
  errBox.hidden = true;
  const btn = form.querySelector('button[type="submit"]');

  if (mode === "signup") {
    if (!/^\S+@\S+\.\S+$/.test(email)) return showErr("Enter a valid email address.");
    if (password.length < 8) return showErr("Use a password with at least 8 characters.");
  } else {
    if (!identifier) return showErr("Enter your username or email.");
    if (!password) return showErr("Enter your password.");
    if (identifier.includes("@") && !/^\S+@\S+\.\S+$/.test(identifier)) return showErr("That email doesn't look right.");
  }

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = mode === "signup" ? "Creating account…" : "Logging in…";
  try {
    if (mode === "signup") {
      const username = String(f.get("username") || "").trim().toLowerCase();
      const city = String(f.get("city") || "").trim();
      if (!USERNAME_RE.test(username)) throw new Error("Username needs 3 to 20 letters, numbers or underscores.");
      if (!(await state.api.auth.usernameAvailable(username))) throw new Error("That username is taken. Try another.");
      const { needsConfirm } = await state.api.auth.signUp({ email, password, username, city });
      if (needsConfirm) return renderAuth("login", "Account created. Check your email for a confirmation link, then log in.");
    } else {
      await state.api.auth.signIn({ identifier, password });
    }
    handleSession(await state.api.auth.session());
  } catch (e) {
    showErr(e.message);
    btn.disabled = false;
    btn.textContent = label;
  }
}

let lastSessionKey;
async function handleSession(session) {
  const key = session?.user?.id ?? null;
  if (lastSessionKey === key) return;
  lastSessionKey = key;
  state.userId = key;
  state.items.clear();
  state.matchUsers = 0;
  if (!key) {
    state.me = null;
    renderAuth();
    return;
  }
  try {
    for (let i = 0; i < 3 && !state.me; i++) {
      state.me = await state.api.profiles.me();
      if (!state.me) await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    return showError(e);
  }
  if (!state.me) return showError(new Error("Your profile wasn't created. Log out and sign up again."));
  renderChrome();
  route();
  refreshBadge();
}

/* ======================================================================
   router
   ====================================================================== */

function route({ keepScroll = false } = {}) {
  closeSheet();
  if (!state.userId || !state.me) return;
  const token = ++renderToken;
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const name = parts[0] || "matches";
  view.dataset.mode = "";
  $("#topbar").hidden = false;
  $("#tabs").hidden = false;
  setActiveTab(name);
  if (name !== "search" && (state.search.q || state.search.results.length)) resetSearch();
  if (!keepScroll) window.scrollTo(0, 0);
  const views = {
    matches: () => viewMatches(token),
    feed: () => viewFeed(token),
    search: () => viewSearch(token),
    collection: () => viewCollection(token),
    wantlist: () => viewWantlist(token),
    u: () => viewProfile(token, decodeURIComponent(parts[1] || state.me.username)),
  };
  (views[name] || views.matches)().catch((err) => {
    if (token === renderToken) showError(err);
  });
}
window.addEventListener("hashchange", () => route());

function showError(err) {
  view.dataset.mode = "";
  view.innerHTML = `<div class="empty"><h1 class="headline">Something went wrong.</h1><p class="sub">${esc(err?.message || err)}</p>
    <button class="btn btn-primary" data-act="retry">Try again</button></div>`;
}

/* ======================================================================
   matches
   ====================================================================== */

async function viewMatches(token) {
  if (!setView(token, `<h1 class="page-title">Matches</h1>${skeleton(3)}`)) return;
  const rows = await state.api.matches();
  if (token !== renderToken) return;

  const group = (direction) => {
    const map = new Map();
    for (const r of rows.filter((x) => x.direction === direction)) {
      if (!map.has(r.other_user_id)) map.set(r.other_user_id, { user: r, rows: [] });
      map.get(r.other_user_id).rows.push(r);
    }
    return map;
  };
  const has = group("has_your_want");
  const wants = group("wants_your_record");
  const total = new Set(rows.map((r) => r.other_user_id)).size;
  state.matchUsers = total;
  paintBadge();

  if (!total) {
    setView(token, `
      <h1 class="page-title">Matches</h1>
      <div class="empty">
        <h2 class="headline">No matches yet.</h2>
        <p class="sub">Add records you own and records you're hunting. When another collector lines up with you, they show up here.</p>
        <a class="btn btn-primary" href="#/search">Add records</a>
      </div>`);
    return;
  }

  const chipFor = (r) => {
    const text =
      r.direction === "has_your_want"
        ? r.match_type === "exact" ? "Exact pressing" : "Different pressing"
        : r.match_type === "exact" ? "Wants this pressing" : "Wants any pressing";
    return `<span class="chip on">${text}</span>`;
  };
  const card = ({ user, rows: list }) => `
    <article class="match-card">
      <a class="match-head" href="#/u/${esc(user.username)}">${avatar(user, 40)}
        <span><span class="who">@${esc(user.username)}</span>${user.city ? `<br><span class="where">${esc(user.city)}</span>` : ""}</span></a>
      <ul class="rows">${list.map((r) => `
        <li class="row tight">${coverImg(r)}
          <div class="row-main"><div class="title">${esc(r.title)}</div><div class="artist">${esc(r.artist)}</div>
            <div class="meta">${esc([r.year, r.country].filter(Boolean).join(", "))}</div>${chipsHtml(r.format, chipFor(r))}</div></li>`).join("")}
      </ul>
      <div class="match-foot"><button class="btn btn-ghost btn-sm" disabled aria-disabled="true">Offer a trade</button><span class="soon">Coming soon</span></div>
    </article>`;
  const section = (title, map) =>
    map.size ? `<h2 class="section-title">${title}</h2>${[...map.values()].map(card).join("")}` : "";

  setView(token, `
    <h1 class="headline">${total === 1 ? "1 collector lines up" : `${total} collectors line up`} with your lists.</h1>
    <p class="sub">${plural(has.size, "has", "have")} records you want. ${plural(wants.size, "wants", "want")} records you own.</p>
    ${section("Have records you want", has)}
    ${section("Want records you own", wants)}`);
}

/* ======================================================================
   feed
   ====================================================================== */

function heartHtml(item) {
  return `<button class="heart" data-act="like" data-item="${esc(item.id)}" aria-pressed="${item.liked}" aria-label="Like this record">${ICON.heart}<span>${item.like_count || ""}</span></button>`;
}

function syncHearts(item) {
  document.querySelectorAll(`.heart[data-item="${CSS.escape(item.id)}"]`).forEach((b) => {
    b.setAttribute("aria-pressed", String(item.liked));
    b.querySelector("span").textContent = item.like_count || "";
  });
}

async function viewFeed(token) {
  const pressed = (m) => String(state.feedMode === m);
  if (!setView(token, `
    <h1 class="page-title">Feed</h1><p class="sub">New records from collectors.</p>
    <div class="seg" role="group" aria-label="Feed" style="margin-top:18px">
      <button data-act="feed-mode" data-mode="following" aria-pressed="${pressed("following")}">Following</button>
      <button data-act="feed-mode" data-mode="everyone" aria-pressed="${pressed("everyone")}">Everyone</button>
    </div><div id="feed-list">${skeleton(5)}</div>`)) return;
  await loadFeed(token);
}

async function loadFeed(token) {
  const items = await state.api.feed(state.feedMode);
  if (token !== renderToken) return;
  remember(items);
  const box = $("#feed-list");
  if (!items.length) {
    box.innerHTML =
      state.feedMode === "following"
        ? `<div class="empty"><h2 class="headline">Nothing here yet.</h2><p class="sub">Follow collectors and their new records land here.</p>
           <button class="btn btn-primary" data-act="feed-mode" data-mode="everyone">See everyone</button></div>`
        : `<div class="empty"><h2 class="headline">No records yet.</h2><p class="sub">Be the first. Add something from your shelf.</p><a class="btn btn-primary" href="#/search">Add records</a></div>`;
    return;
  }
  box.innerHTML = `<ul class="rows">${items.map((it) => `
    <li class="row">
      <button class="row-btn" data-act="open-item" data-item="${esc(it.id)}">${coverImg(it.release)}
        <span class="row-main"><span class="meta" style="display:block;margin:0 0 2px"><b style="color:var(--bone)">@${esc(it.owner.username)}</b> added, ${timeAgo(it.created_at)}</span>
          <span class="title" style="display:block">${esc(it.release.title)}</span>
          <span class="artist" style="display:block">${esc(it.release.artist)}</span></span></button>
      <div class="row-side">${heartHtml(it)}</div>
    </li>`).join("")}</ul>`;
}

/* ======================================================================
   search and add
   ====================================================================== */

function resetSearch() {
  const s = state.search;
  clearTimeout(searchTimer);
  s.seq++;
  Object.assign(s, { q: "", mode: "search", master: null, results: [], page: 1, pages: 1, loading: false, error: "" });
}

async function viewSearch(token) {
  const s = state.search;
  if (!setView(token, `
    <div class="search-top"><h1 class="page-title">Search</h1><p class="sub">Find the exact pressing you own or want.</p></div>
    <div class="search-bar"><div class="search-field"><input class="input" id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
      placeholder="Artist or album" value="${esc(s.q)}" data-input="search" aria-label="Search records">
      <button class="search-clear" type="button" data-act="search-clear" aria-label="Clear search"${s.q ? "" : " hidden"}>&times;</button></div></div>
    <div id="search-out"></div>`)) return;
  renderSearchOut();
  try {
    state.mine = await state.api.mine();
    if (token === renderToken) renderSearchOut();
  } catch { /* statuses are a nicety */ }
}

function renderSearchOut() {
  const box = $("#search-out");
  if (!box) return;
  const s = state.search;
  const inVersions = s.mode === "versions";
  let html = "";

  if (inVersions) {
    html += `<div style="margin-top:18px"><button class="link" data-act="search-back">Back to results</button>
      <h2 class="section-title" style="margin-top:6px">All pressings of ${esc(s.master.title)}</h2></div>`;
  }

  if (s.error) html += `<p class="error">${esc(s.error)}</p>`;

  if (!inVersions && s.q.length < 2 && !s.results.length) {
    html += `<p class="help" style="margin-top:20px">Try an artist, an album, or both. Pick the exact pressing so matches work.</p>`;
  } else if (s.results.length) {
    const SORTS = [["relevance", "Best match"], ["title", "Album A to Z"], ["artist", "Artist A to Z"], ["new", "Year, newest first"], ["old", "Year, oldest first"]];
    html += `<div class="sort-row"><label for="sort">Sort by</label><select id="sort" class="input" data-input="sort">${SORTS.map(([v, l]) => `<option value="${v}"${s.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
    const order = s.results.map((r, i) => i);
    const txt = (v) => String(v ?? "").toLowerCase();
    const cmp = {
      title: (a, b) => txt(s.results[a].title).localeCompare(txt(s.results[b].title)),
      artist: (a, b) => txt(s.results[a].artist).localeCompare(txt(s.results[b].artist)) || txt(s.results[a].title).localeCompare(txt(s.results[b].title)),
      new: (a, b) => (s.results[b].year || 0) - (s.results[a].year || 0),
      old: (a, b) => (s.results[a].year || 9999) - (s.results[b].year || 9999),
    }[s.sort];
    if (cmp) order.sort((a, b) => cmp(a, b) || a - b);
    html += `<ul class="rows">${order.map((i) => {
      const r = s.results[i];
      const own = state.mine.owned.has(r.id);
      const want = state.mine.wanted.has(r.id);
      const extra = (own ? '<span class="chip on">In your collection</span>' : "") + (want ? '<span class="chip on">On your wantlist</span>' : "");
      return `<li class="row">${coverImg({ ...r, cover_url: r.cover })}
        <div class="row-main"><div class="title">${esc(r.title)}</div><div class="artist">${esc(r.artist)}</div>
          <div class="meta">${esc(metaLine(r))}</div>${chipsHtml(r.formats, extra)}
          ${!inVersions && r.master_id ? `<button class="link" data-act="versions" data-idx="${i}">All pressings</button>` : ""}</div>
        <div class="row-side"><button class="btn btn-primary btn-sm" data-act="open-add" data-idx="${i}">Add</button></div></li>`;
    }).join("")}</ul>`;
  } else if (!s.loading && !s.error) {
    html += `<div class="empty" style="margin-top:36px"><p class="sub">Nothing found. Try fewer words.</p></div>`;
  }

  if (s.loading) html += skeleton(s.results.length ? 1 : 4);
  else if (s.results.length && s.page < s.pages) {
    html += `<div style="margin-top:18px"><button class="btn btn-ghost btn-block" data-act="search-more">Show more</button></div>`;
  }
  box.innerHTML = html;
}

async function runSearch(reset = true) {
  const s = state.search;
  const mine = ++s.seq;
  if (reset) { s.results = []; s.page = 1; s.pages = 1; }
  s.loading = true;
  s.error = "";
  renderSearchOut();
  try {
    const data =
      s.mode === "versions"
        ? await state.api.discogs.versions({ master_id: s.master.master_id, artist: s.master.artist, title: s.master.title, page: s.page })
        : await state.api.discogs.search(s.q, s.page);
    if (mine !== s.seq) return;
    s.results = s.results.concat(data.results);
    s.pages = data.pages || 1;
  } catch (e) {
    if (mine !== s.seq) return;
    s.error = e.message;
  }
  s.loading = false;
  renderSearchOut();
}

// While typing, hide the bars so the keyboard leaves room for results.
// Return/Search closes the keyboard, and so does scrolling the results.
document.addEventListener("focusin", (e) => { if (e.target.dataset?.input === "search") document.body.classList.add("typing"); });
let typingOff;
document.addEventListener("focusin", (e) => { if (e.target.dataset?.input === "search") clearTimeout(typingOff); });
// small delay so a tap on a result isn't lost when the bars slide back in
document.addEventListener("focusout", (e) => {
  if (e.target.dataset?.input === "search") typingOff = setTimeout(() => document.body.classList.remove("typing"), 400);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset?.input === "search") { e.preventDefault(); clearTimeout(searchTimer); if (state.search.q.length >= 2) runSearch(true); e.target.blur(); }
});
document.addEventListener("touchmove", (e) => {
  if (document.body.classList.contains("typing") && !e.target.closest(".search-bar")) document.activeElement?.blur?.();
}, { passive: true });

let searchTimer;
document.addEventListener("input", (e) => {
  if (e.target.dataset?.input === "sort") { state.search.sort = e.target.value; renderSearchOut(); return; }
  if (e.target.dataset?.input !== "search") return;
  const s = state.search;
  const clr = $(".search-clear");
  if (clr) clr.hidden = !e.target.value;
  clearTimeout(searchTimer);
  s.q = e.target.value.trim();
  s.mode = "search";
  s.master = null;
  if (s.q.length < 2) {
    s.seq++;
    s.results = [];
    s.loading = false;
    s.error = "";
    renderSearchOut();
    return;
  }
  searchTimer = setTimeout(() => runSearch(true), 450);
});

const releaseFromResult = (r) => ({ ...r, cover_url: r.cover });

function openAddSheet(result) {
  const r = releaseFromResult(result);
  const canAny = Boolean(result.master_id);
  const sheet = openSheet(`
    <div class="sheet-head">${coverImg(r)}
      <div style="min-width:0"><h2>${esc(r.title)}</h2><p class="artist">${esc(r.artist)}</p><p class="meta">${esc(metaLine(r))}</p></div></div>
    ${chipsHtml(result.formats)}
    <div class="seg" role="group" aria-label="Add as" style="margin-top:18px">
      <button type="button" data-kind="own" aria-pressed="true">I own this</button>
      <button type="button" data-kind="want" aria-pressed="false">I want this</button>
    </div>
    <form data-form="add" data-id="${esc(result.id)}" style="margin-top:16px">
      <div data-panel="own">
        <label class="field"><span>Condition</span><select class="select" name="condition">${CONDITIONS.map((c) => `<option ${c === "Not graded" ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        ${GRADE_GUIDE}
        <label class="field"><span>Notes (optional)</span><textarea class="textarea" name="notes" maxlength="500" placeholder="Where you found it, pressing details, anything else"></textarea></label>
      </div>
      <div data-panel="want" hidden>
        <label class="switch"><span><b>Any pressing of this album</b><br><span class="help">${canAny ? "Match with any version, not just this one." : "Discogs has no album group for this record, so only this exact pressing can match."}</span></span>
          <input type="checkbox" name="any" ${canAny ? "" : "disabled"}></label>
      </div>
      <p class="error" id="add-error" role="alert" hidden></p>
      <div class="sheet-actions"><button class="btn btn-primary" type="submit" id="add-go">Add to collection</button>
        <button class="btn btn-ghost" type="button" data-close>Cancel</button></div>
    </form>`);
  sheet.dataset.kind = "own";
  sheet.querySelectorAll("[data-kind]").forEach((b) =>
    b.addEventListener("click", () => {
      const kind = b.dataset.kind;
      sheet.dataset.kind = kind;
      sheet.querySelectorAll("[data-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      sheet.querySelector('[data-panel="own"]').hidden = kind !== "own";
      sheet.querySelector('[data-panel="want"]').hidden = kind !== "want";
      sheet.querySelector("#add-go").textContent = kind === "own" ? "Add to collection" : "Add to wantlist";
    }),
  );
}

async function submitAdd(form) {
  const sheet = form.closest(".sheet");
  const kind = sheet.dataset.kind;
  const result = state.search.results.find((r) => String(r.id) === form.dataset.id);
  const btn = $("#add-go");
  const err = $("#add-error");
  err.hidden = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Adding…";
  try {
    const release = await state.api.discogs.release(result.id);
    const f = new FormData(form);
    if (kind === "own") {
      await state.api.collection.add(release.discogs_release_id, String(f.get("condition")), String(f.get("notes") || "").trim());
      state.mine.owned.add(result.id);
      toast("Added to your collection.");
    } else {
      await state.api.wantlist.add(release, f.get("any") === "on");
      state.mine.wanted.add(result.id);
      toast("Added to your wantlist.");
    }
    closeSheet();
    renderSearchOut();
    refreshBadge();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ======================================================================
   collection and wantlist (yours)
   ====================================================================== */

const tile = (it) => `<button class="tile" data-act="open-item" data-item="${esc(it.id)}">${coverImg(it.release, { alt: true })}</button>`;

/* ---------- the crate: side view, flip through ---------- */

const SLOT = 70;
const initialOf = (artist) => {
  const m = String(artist || "").replace(/^the\s+/i, "").match(/[a-z0-9]/i);
  if (!m) return "#";
  return /[a-z]/i.test(m[0]) ? m[0].toUpperCase() : "#";
};
const crateSort = (items) =>
  [...items].sort((a, b) =>
    String(a.release.artist).replace(/^the\s+/i, "").localeCompare(String(b.release.artist).replace(/^the\s+/i, ""), undefined, { sensitivity: "base" }) ||
    String(a.release.title).localeCompare(String(b.release.title), undefined, { sensitivity: "base" }));

function collectionBody(items, mode, { empty = "" } = {}) {
  if (!items.length) return empty;
  if (mode === "grid") return `<div class="grid3">${items.map(tile).join("")}</div>`;
  const list = crateSort(items);
  state.crate = list;
  const letters = [...new Map(list.map((it, i) => [initialOf(it.release.artist), i])).entries()].reverse();
  const first = new Map();
  list.forEach((it, i) => { const L = initialOf(it.release.artist); if (!first.has(L)) first.set(L, i); });
  return `
    <div class="letters" role="group" aria-label="Jump to letter">${[...first].map(([L, i]) =>
      `<button class="letter" data-act="crate-jump" data-idx="${i}" data-letter="${esc(L)}">${esc(L)}</button>`).join("")}</div>
    <div class="crate-wrap">
      <div class="crate" tabindex="0" role="listbox" aria-label="Your crate. Swipe sideways to flip through records.">
        ${list.map((it, i) => `<button class="slot" role="option" data-act="crate-slot" data-idx="${i}" aria-label="${esc(it.release.title)} by ${esc(it.release.artist)}"><span class="sleeve">${coverImg(it.release)}</span></button>`).join("")}
      </div>
      <div class="crate-front" aria-hidden="true"></div>
    </div>
    <div class="now-wrap" data-open="${pref.get("cinfo", "open") !== "closed"}">
      <button class="now-toggle" data-act="now-toggle" aria-expanded="${pref.get("cinfo", "open") !== "closed"}" aria-label="Show or hide record details"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="now" aria-live="polite"></div>
      <p class="crate-hint">Swipe to flip. Tap the front record to open it.</p>
    </div>`;
}

function initCrate() {
  const el = $(".crate");
  if (!el) return;
  const slots = [...el.querySelectorAll(".slot")];
  const now = $(".now");
  const letterBtns = [...document.querySelectorAll(".letter")];
  el.style.paddingInline = Math.max(0, (el.clientWidth - SLOT) / 2) + "px";
  let raf = 0;
  let center = -1;
  const paint = () => {
    raf = 0;
    const pos = el.scrollLeft / SLOT;
    const c = Math.max(0, Math.min(slots.length - 1, Math.round(pos)));
    for (let i = 0; i < slots.length; i++) {
      const o = i - pos, a = Math.abs(o);
      const sleeve = slots[i].firstElementChild;
      if (a > 9) {
        if (slots[i].dataset.far !== String(Math.sign(o))) {
          slots[i].dataset.far = String(Math.sign(o));
          sleeve.style.transform = `translateX(${Math.sign(o) * 80}px) rotateY(${-Math.sign(o) * 58}deg)`;
          slots[i].style.zIndex = 0;
        }
        continue;
      }
      delete slots[i].dataset.far;
      const near = Math.min(a, 1), sg = Math.sign(o);
      sleeve.style.transform = `translateX(${sg * 80 * near}px) translateY(${(1 - near) * -16}px) rotateY(${-sg * 58 * near}deg) scale(${1 + (1 - near) * 0.07})`;
      slots[i].style.zIndex = String(1000 - Math.round(a * 10));
    }
    if (c !== center) {
      center = c;
      el.dataset.center = String(c);
      const it = state.crate[c];
      if (it) {
        const r = it.release;
        now.innerHTML = `<div class="short">${esc(r.title)} <span>${esc(r.artist)}</span></div><div class="title">${esc(r.title)}</div><div class="artist">${esc(r.artist)}</div><div class="meta">${esc([r.year, it.condition === "Not graded" ? "" : it.condition].filter(Boolean).join(", "))}</div>`;
        const L = initialOf(r.artist);
        letterBtns.forEach((b) => b.setAttribute("aria-current", String(b.dataset.letter === L)));
      }
    }
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(paint); };
  el.addEventListener("scroll", queue, { passive: true });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = Math.max(0, Math.min(slots.length - 1, center + (e.key === "ArrowRight" ? 1 : -1)));
    el.scrollTo({ left: next * SLOT, behavior: "smooth" });
  });
  paint();
}

const cview = () => (pref.get("cview", "crate") === "grid" ? "grid" : "crate");

function viewToggle() {
  const m = cview();
  return `<div class="seg view-toggle" role="group" aria-label="Collection view">
    <button data-act="cview" data-mode="crate" aria-pressed="${m === "crate"}">Crate</button>
    <button data-act="cview" data-mode="grid" aria-pressed="${m === "grid"}">Grid</button></div>`;
}

async function viewCollection(token) {
  if (!setView(token, `<h1 class="page-title">Collection</h1>${skeleton(3)}`)) return;
  const items = await state.api.collection.list(state.userId);
  if (token !== renderToken) return;
  remember(items);
  state.collectionItems = items;
  if (!items.length) {
    setView(token, `<h1 class="page-title">Collection</h1>
      <div class="empty"><h2 class="headline">Your crate is empty.</h2>
        <p class="sub">Search for a record and add the exact pressing you own.</p>
        <a class="btn btn-primary" href="#/search">Add your first record</a></div>`);
    return;
  }
  setView(token, `
    <div class="head-row">
      <div><h1 class="page-title">Collection</h1><p class="sub">${plural(items.length, "record", "records")}</p></div>
      <a class="btn btn-ghost btn-sm" href="#/search">Add records</a></div>
    <div style="margin-top:16px">${viewToggle()}</div>
    <div id="cbody">${collectionBody(items, cview())}</div>`);
  initCrate();
}

function wantRow(w, { editable }) {
  const r = w.release;
  const mode = w.any_pressing ? "Any pressing" : "This pressing";
  const side = editable
    ? `<div class="row-side">
         ${w.master_id ? `<button class="btn btn-ghost btn-sm" data-act="want-toggle" data-id="${esc(w.id)}" aria-label="Match mode: ${mode}. Tap to change.">${mode}</button>` : ""}
         <button class="link" data-act="want-remove" data-id="${esc(w.id)}">Remove</button></div>`
    : "";
  const modeChip = `<span class="chip ${w.any_pressing ? "on" : ""}" data-mode-chip="${esc(w.id)}">${mode}</span>`;
  return `<li class="row">${coverImg(r)}
    <div class="row-main"><div class="title">${esc(r.title)}</div><div class="artist">${esc(r.artist)}</div>
      <div class="meta">${esc(metaLine(r))}</div>${editable ? chipsHtml(r.format) : chipsHtml(r.format, modeChip)}</div>${side}</li>`;
}

async function viewWantlist(token) {
  if (!setView(token, `<h1 class="page-title">Wantlist</h1>${skeleton(3)}`)) return;
  const wants = await state.api.wantlist.list(state.userId);
  if (token !== renderToken) return;
  state.wants = new Map(wants.map((w) => [w.id, w]));
  if (!wants.length) {
    setView(token, `<h1 class="page-title">Wantlist</h1>
      <div class="empty"><h2 class="headline">Nothing on your wantlist.</h2>
        <p class="sub">Add the records you're hunting. Collectors who own them show up in Matches.</p>
        <a class="btn btn-primary" href="#/search">Find a record</a></div>`);
    return;
  }
  setView(token, `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px">
      <div><h1 class="page-title">Wantlist</h1><p class="sub">${plural(wants.length, "record", "records")}</p></div>
      <a class="btn btn-ghost btn-sm" href="#/search">Add records</a></div>
    <p class="help" style="margin-top:14px">"Any pressing" matches every version of the album. "This pressing" only matches the exact one.</p>
    <ul class="rows">${wants.map((w) => wantRow(w, { editable: true })).join("")}</ul>`);
}

/* ======================================================================
   record sheet
   ====================================================================== */

function openItemSheet(item) {
  const mine = item.user_id === state.userId;
  const r = item.release;
  const stageHue = hueOf(`${r.artist}|${r.title}`);
  const facts = (extra) => `<dl class="facts">
      <div><dt>Year</dt><dd>${esc(r.year || "Unknown")}</dd></div>
      <div><dt>Label</dt><dd>${esc(r.label || "Unknown")}</dd></div>
      <div><dt>Country</dt><dd>${esc(r.country || "Unknown")}</dd></div>${extra}</dl>`;

  let body = `
    <div class="sleeve-stage" style="--h:${stageHue}"><div class="disc-slide"><div class="disc"></div></div>${coverImg(r, { alt: true })}</div>
    <h2>${esc(r.title)}</h2><p class="artist">${esc(r.artist)}</p>${chipsHtml(r.format)}${priceSlot(item.release_id)}`;

  if (mine) {
    body += facts(`<div><dt>Added</dt><dd>${timeAgo(item.created_at)}</dd></div>`) + `
      <form data-form="edit-item" data-id="${esc(item.id)}" style="margin-top:20px">
        <label class="field"><span>Condition</span><select class="select" name="condition">${CONDITIONS.map((c) => `<option ${c === item.condition ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        ${GRADE_GUIDE}
        <label class="field"><span>Notes</span><textarea class="textarea" name="notes" maxlength="500" placeholder="Where you found it, pressing details, anything else">${esc(item.notes)}</textarea></label>
        <p class="help">${plural(item.like_count, "like", "likes")}</p>
        <div class="sheet-actions"><button class="btn btn-primary" type="submit">Save changes</button>
          <button class="btn btn-danger" type="button" data-act="remove-item" data-id="${esc(item.id)}">Remove from collection</button></div>
      </form>`;
  } else {
    body += facts(`<div><dt>Condition</dt><dd>${esc(item.condition)}</dd></div>`);
    if (item.notes) body += `<p class="notes">${esc(item.notes)}</p>`;
    body += `
      <a class="owner" href="#/u/${esc(item.owner.username)}">${avatar(item.owner, 40)}
        <span><b>@${esc(item.owner.username)}</b><br><span class="meta">Added ${timeAgo(item.created_at)}</span></span></a>
      <div class="sheet-actions" style="grid-template-columns:auto 1fr;align-items:center">
        ${heartHtml(item)}
        <button class="btn btn-ghost" data-act="want-from-item" data-item="${esc(item.id)}">Add to my wantlist</button>
      </div>
      <div style="text-align:center;margin-top:10px"><button class="link" data-act="report" data-user="${esc(item.user_id)}" data-name="${esc(item.owner.username)}" data-item="${esc(item.id)}">Report this record</button></div>`;
  }

  const sheet = openSheet(body);
  const stage = $(".sleeve-stage", sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("out")));
  loadPrice(item.release_id);
}

async function saveItem(form) {
  const item = state.items.get(form.dataset.id);
  const f = new FormData(form);
  const patch = { condition: String(f.get("condition")), notes: String(f.get("notes") || "").trim() };
  await state.api.collection.update(item.id, patch);
  Object.assign(item, patch);
  toast("Saved.");
  closeSheet();
}

/* ======================================================================
   profiles
   ====================================================================== */

async function viewProfile(token, username) {
  if (!setView(token, skeleton(4))) return;
  const p = await state.api.profiles.byUsername(username);
  if (token !== renderToken) return;
  if (!p) {
    setView(token, `<div class="empty"><h1 class="headline">No collector named @${esc(username)}.</h1><a class="btn btn-primary" href="#/matches">Back to matches</a></div>`);
    return;
  }
  const [stats, items, wants] = await Promise.all([
    state.api.profiles.stats(p.id),
    state.api.collection.list(p.id),
    state.api.wantlist.list(p.id),
  ]);
  if (token !== renderToken) return;
  remember(items);
  state.wants = new Map(wants.map((w) => [w.id, w]));
  state.profile = { p, stats, items, wants, tab: "collection", isMe: p.id === state.userId };
  renderProfile(token);
}

function renderProfile(token = renderToken) {
  const { p, stats, items, wants, tab, isMe } = state.profile;
  const actions = isMe
    ? `<button class="btn btn-ghost" data-act="edit-profile">Edit profile</button>`
    : `<button class="btn ${stats.isFollowing ? "btn-ghost" : "btn-primary"}" data-act="${stats.isFollowing ? "unfollow" : "follow"}">${stats.isFollowing ? "Following" : "Follow"}</button>
       <button class="btn btn-ghost" data-act="profile-menu" aria-label="More options">More</button>`;

  let content;
  if (tab === "collection") {
    content = collectionBody(items, cview(), {
      empty: `<p class="help" style="margin-top:24px">${isMe ? "Nothing in your collection yet." : `@${esc(p.username)} hasn't added any records.`}</p>`,
    });
  } else {
    content = wants.length
      ? `<ul class="rows">${wants.map((w) => wantRow(w, { editable: false })).join("")}</ul>`
      : `<p class="help" style="margin-top:24px">${isMe ? "Your wantlist is empty." : `@${esc(p.username)} isn't hunting anything yet.`}</p>`;
  }

  setView(token, `
    <div class="profile-head">${avatar(p, 72)}
      <div style="min-width:0"><h1 class="name">@${esc(p.username)}</h1>${p.city ? `<p class="sub" style="margin-top:2px">${esc(p.city)}</p>` : ""}</div></div>
    ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
    <div class="stats"><div><b>${stats.records}</b>records</div><div><b>${stats.followers}</b>followers</div><div><b>${stats.following}</b>following</div></div>
    <div class="profile-actions">${actions}</div>
    ${wallHtml()}
    <div class="seg" role="group" aria-label="Profile">
      <button data-act="ptab" data-tab="collection" aria-pressed="${tab === "collection"}">Collection</button>
      <button data-act="ptab" data-tab="wantlist" aria-pressed="${tab === "wantlist"}">Wantlist</button></div>
    ${tab === "collection" && items.length ? `<div style="margin-top:14px">${viewToggle()}</div>` : ""}
    ${content}
    ${isMe ? `<div style="margin-top:36px;display:grid;gap:10px">
        <button class="btn btn-ghost" data-act="blocked-list">Blocked collectors</button>
        <button class="btn btn-ghost" data-act="signout">Log out</button></div>` : ""}
    ${state.api.mode === "demo" && isMe ? `<p class="demo-note">Demo mode: sample data in your browser. Nothing is saved and no real collectors are here.</p>` : ""}`);
  if (tab === "collection" && cview() === "crate") initCrate();
}

/* ---------- the wall: ledges with records facing out ---------- */

function ledges(list, render) {
  const rows = [];
  for (let i = 0; i < list.length; i += 3) rows.push(list.slice(i, i + 3));
  return rows.map((r) => `<div class="ledge">${r.map(render).join("")}</div>`).join("");
}

function wallHtml() {
  const { items, wants, isMe } = state.profile;
  const rot = crateSort(items.filter((i) => i.featured));
  const hunt = wants.filter((w) => w.featured);
  if (!isMe && !rot.length && !hunt.length) return "";
  const section = (title, kind, count, body, emptyMsg) => `
    <div class="wall-sec">
      <div class="wall-head"><h2 class="wall-title">${title}</h2>
        ${isMe ? `<button class="link" data-act="wall-pick" data-kind="${kind}">${count ? "Edit" : "Pick records"}</button>` : ""}</div>
      ${count ? body : isMe ? `<p class="wall-empty">${emptyMsg}</p>` : ""}
    </div>`;
  return `<section class="wall" aria-label="Profile wall">
    ${rot.length || isMe ? section("In rotation", "own", rot.length,
      ledges(rot, (it) => `<button class="perch" data-act="open-item" data-item="${esc(it.id)}">${coverImg(it.release, { alt: true })}</button>`),
      "Pick up to 6 records you're spinning right now.") : ""}
    ${hunt.length || isMe ? section("In search of", "want", hunt.length,
      ledges(hunt, (w) => `<button class="perch" data-act="want-open" data-id="${esc(w.id)}">${coverImg(w.release, { alt: true })}<span class="price-tag">${w.any_pressing ? "Any" : "Exact"}</span></button>`),
      "Pick up to 6 records you're hunting for. Others see them.") : ""}
  </section>`;
}

function openEditProfile() {
  const { p } = state.profile;
  openSheet(`
    <h2>Edit profile</h2>
    <div style="display:flex;align-items:center;gap:14px;margin:16px 0">${avatar(p, 64)}
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">Change photo<input type="file" accept="image/*" data-input="avatar" hidden></label></div>
    <form data-form="edit-profile">
      <label class="field"><span>City</span><input class="input" name="city" maxlength="60" value="${esc(p.city)}" placeholder="Augusta, GA"></label>
      <label class="field"><span>Bio</span><textarea class="textarea" name="bio" maxlength="280" placeholder="What do you collect?">${esc(p.bio)}</textarea></label>
      <p class="error" id="profile-error" role="alert" hidden></p>
      <div class="sheet-actions"><button class="btn btn-primary" type="submit">Save</button><button class="btn btn-ghost" type="button" data-close>Cancel</button></div>
    </form>`);
}

async function resizeImage(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.86));
}

document.addEventListener("change", async (e) => {
  if (e.target.dataset?.input !== "avatar") return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const blob = await resizeImage(file);
    const updated = await state.api.profiles.uploadAvatar(blob);
    state.me = updated;
    state.profile.p = updated;
    renderChrome();
    toast("Photo updated.");
    closeSheet();
    renderProfile();
  } catch (err) {
    toast(err.message || "Couldn't upload that photo.", true);
  }
});

function openReport({ userId, name, itemId }) {
  const reasons = [["spam", "Spam"], ["harassment", "Harassment"], ["inappropriate", "Inappropriate content"], ["scam", "Scam or fake listing"], ["other", "Something else"]];
  openSheet(`
    <h2>Report ${itemId ? "this record" : `@${esc(name)}`}</h2>
    <p class="sub">Tell us what's wrong. Reports are private.</p>
    <form data-form="report" data-user="${esc(userId)}" data-item="${esc(itemId || "")}" style="margin-top:12px">
      ${reasons.map(([v, l], i) => `<label class="choice"><input type="radio" name="reason" value="${v}" ${i === 0 ? "checked" : ""}><span>${l}</span></label>`).join("")}
      <label class="field" style="margin-top:12px"><span>Details (optional)</span><textarea class="textarea" name="details" maxlength="500"></textarea></label>
      <div class="sheet-actions"><button class="btn btn-primary" type="submit">Send report</button><button class="btn btn-ghost" type="button" data-close>Cancel</button></div>
    </form>`);
}

async function openBlockedList() {
  const sheet = openSheet(`<h2>Blocked collectors</h2><div id="blocked-box">${skeleton(2)}</div>`);
  const list = await state.api.safety.blocked();
  const box = $("#blocked-box", sheet);
  if (!box) return;
  box.innerHTML = list.length
    ? `<ul class="rows">${list.map((u) => `<li class="row" style="align-items:center">${avatar(u, 40)}<div class="row-main"><div class="title">@${esc(u.username)}</div></div>
        <button class="btn btn-ghost btn-sm" data-act="unblock" data-user="${esc(u.id)}">Unblock</button></li>`).join("")}</ul>`
    : `<p class="help" style="margin-top:14px">You haven't blocked anyone.</p>`;
}

/* ---------- settings, wall picker, wanted record ---------- */

function openSettings() {
  openSheet(`
    <h2>Settings</h2>
    <p class="sub">Pick the look of your shop. This only changes it on this device.</p>
    <div class="themes">${THEMES.map((t) => `
      <button class="theme" data-act="set-theme" data-id="${t.id}" aria-pressed="${document.documentElement.dataset.theme === t.id}">
        <span class="swatch">${t.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span>
        <span><b>${t.name}</b><small>${t.note}</small></span></button>`).join("")}</div>
    <div class="sheet-actions"><button class="btn btn-ghost" data-close>Done</button></div>`);
}

function openWallPicker(kind) {
  const own = kind === "own";
  const list = own ? crateSort(state.profile.items) : state.profile.wants;
  const n = list.filter((x) => x.featured).length;
  openSheet(`
    <h2>${own ? "In rotation" : "In search of"}</h2>
    <p class="sub">${own ? "Records you're spinning right now." : "Records you're hunting. Others can see these."} Pick up to 6.</p>
    <p class="picker-count" id="picker-count">${n} of 6 on your wall</p>
    <ul class="rows picker-list">${list.map((x) => `
      <li class="row tight" style="align-items:center">${coverImg(x.release)}
        <div class="row-main"><div class="title">${esc(x.release.title)}</div><div class="artist">${esc(x.release.artist)}</div></div>
        <label class="switch" style="padding:0"><input type="checkbox" data-act="wall-toggle" data-kind="${kind}" data-id="${esc(x.id)}" ${x.featured ? "checked" : ""} aria-label="Show ${esc(x.release.title)} on my wall"></label></li>`).join("") ||
      `<li class="help">${own ? "Add records to your collection first." : "Add records to your wantlist first."}</li>`}</ul>
    <div class="sheet-actions"><button class="btn btn-primary" data-close>Done</button></div>`);
}

function openWantSheet(w) {
  const r = w.release;
  openSheet(`
    <div class="sheet-head">${coverImg(r)}
      <div style="min-width:0"><h2>${esc(r.title)}</h2><p class="artist">${esc(r.artist)}</p><p class="meta">${esc(metaLine(r))}</p></div></div>
    ${chipsHtml(r.format, `<span class="chip on">${w.any_pressing ? "Any pressing" : "This pressing only"}</span>`)}
    ${priceSlot(w.release_id)}
    <p class="help" style="margin-top:14px">${state.profile && state.profile.isMe ? "You're hunting for this one." : `@${esc(state.profile?.p.username || "")} is hunting for this one. Own it? You'll show up in their matches.`}</p>
    <div class="sheet-actions"><button class="btn btn-ghost" data-close>Close</button></div>`);
  loadPrice(w.release_id);
}

/* ======================================================================
   actions (every button with data-act)
   ====================================================================== */

const ACT = {
  tab: (el) => { location.hash = `#/${el.dataset.tab}`; },
  retry: () => route(),
  signout: async () => { await state.api.auth.signOut(); },
  "auth-mode": (el) => renderAuth(el.dataset.mode),

  "feed-mode": async (el) => {
    state.feedMode = el.dataset.mode;
    const token = renderToken;
    document.querySelectorAll('[data-act="feed-mode"][aria-pressed]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.feedMode)));
    $("#feed-list").innerHTML = skeleton(5);
    await loadFeed(token);
  },

  like: async (el) => {
    const item = state.items.get(el.dataset.item);
    const on = !item.liked;
    item.liked = on;
    item.like_count += on ? 1 : -1;
    syncHearts(item);
    try {
      await state.api.likes.toggle(item.id, on);
    } catch (e) {
      item.liked = !on;
      item.like_count += on ? -1 : 1;
      syncHearts(item);
      throw e;
    }
  },

  "open-item": (el) => openItemSheet(state.items.get(el.dataset.item)),

  "remove-item": async (el) => {
    if (!el.dataset.armed) {
      el.dataset.armed = "1";
      el.textContent = "Tap again to remove";
      setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = "Remove from collection"; } }, 4000);
      return;
    }
    await state.api.collection.remove(el.dataset.id);
    state.items.delete(el.dataset.id);
    toast("Removed from your collection.");
    closeSheet();
    route({ keepScroll: true });
    refreshBadge();
  },

  "want-from-item": async (el) => {
    const item = state.items.get(el.dataset.item);
    await state.api.wantlist.add(item.release, false);
    toast("Added to your wantlist.");
    closeSheet();
    refreshBadge();
  },

  "open-add": (el) => openAddSheet(state.search.results[Number(el.dataset.idx)]),
  versions: (el) => {
    const s = state.search;
    const r = s.results[Number(el.dataset.idx)];
    s.mode = "versions";
    s.master = { master_id: r.master_id, artist: r.artist, title: r.title };
    runSearch(true);
    window.scrollTo(0, 0);
  },
  "search-back": () => {
    const s = state.search;
    s.mode = "search";
    s.master = null;
    runSearch(true);
  },
  "search-clear": () => {
    resetSearch();
    const q = $("#q");
    if (q) { q.value = ""; q.focus(); }
    const clr = $(".search-clear");
    if (clr) clr.hidden = true;
    renderSearchOut();
  },
  "search-more": () => { state.search.page += 1; runSearch(false); },

  "want-toggle": async (el) => {
    const w = state.wants.get(el.dataset.id);
    const any = !w.any_pressing;
    await state.api.wantlist.setAny(w.id, any);
    w.any_pressing = any;
    el.textContent = any ? "Any pressing" : "This pressing";
    refreshBadge();
  },
  "want-remove": async (el) => {
    if (!confirm("Remove this record from your wantlist?")) return;
    await state.api.wantlist.remove(el.dataset.id);
    state.wants.delete(el.dataset.id);
    toast("Removed from your wantlist.");
    route({ keepScroll: true });
    refreshBadge();
  },

  ptab: (el) => { state.profile.tab = el.dataset.tab; renderProfile(); },
  follow: async () => {
    const { p, stats } = state.profile;
    await state.api.follows.follow(p.id);
    stats.isFollowing = true;
    stats.followers += 1;
    renderProfile();
  },
  unfollow: async () => {
    const { p, stats } = state.profile;
    await state.api.follows.unfollow(p.id);
    stats.isFollowing = false;
    stats.followers = Math.max(0, stats.followers - 1);
    renderProfile();
  },
  "edit-profile": () => openEditProfile(),
  "profile-menu": () => {
    const { p } = state.profile;
    openSheet(`<h2>@${esc(p.username)}</h2>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="report" data-user="${esc(p.id)}" data-name="${esc(p.username)}">Report</button>
        <button class="btn btn-danger" data-act="block-confirm">Block</button>
        <button class="btn btn-ghost" data-close>Cancel</button></div>`);
  },
  report: (el) => openReport({ userId: el.dataset.user, name: el.dataset.name, itemId: el.dataset.item }),
  "block-confirm": () => {
    const { p } = state.profile;
    openSheet(`<h2>Block @${esc(p.username)}?</h2>
      <p class="sub">You won't see each other's profiles, records or matches. Any follows and likes between you are removed. You can unblock later from your profile.</p>
      <div class="sheet-actions"><button class="btn btn-danger" data-act="block-do">Block @${esc(p.username)}</button><button class="btn btn-ghost" data-close>Cancel</button></div>`);
  },
  "block-do": async () => {
    const { p } = state.profile;
    await state.api.safety.block(p.id);
    toast(`Blocked @${p.username}.`);
    closeSheet();
    location.hash = "#/matches";
    refreshBadge();
  },
  "toggle-pw": (el) => {
    const input = el.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    el.setAttribute("aria-pressed", String(show));
    el.setAttribute("aria-label", show ? "Hide password" : "Show password");
    el.innerHTML = show ? ICON.eyeOff : ICON.eye;
  },
  settings: () => openSettings(),
  "set-theme": (el) => {
    applyTheme(el.dataset.id);
    document.querySelectorAll(".theme").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
  },
  "now-toggle": (el) => {
    const wrap = el.closest(".now-wrap");
    const open = wrap.dataset.open !== "true";
    wrap.dataset.open = String(open);
    el.setAttribute("aria-expanded", String(open));
    pref.set("cinfo", open ? "open" : "closed");
  },
  cview: (el) => {
    pref.set("cview", el.dataset.mode);
    if (location.hash.startsWith("#/collection")) {
      document.querySelectorAll(".view-toggle button").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      $("#cbody").innerHTML = collectionBody(state.collectionItems, cview());
      initCrate();
    } else renderProfile();
  },
  "crate-slot": (el) => {
    const crate = $(".crate");
    const idx = Number(el.dataset.idx);
    if (Number(crate.dataset.center) === idx) openItemSheet(state.crate[idx]);
    else crate.scrollTo({ left: idx * SLOT, behavior: "smooth" });
  },
  "crate-jump": (el) => $(".crate").scrollTo({ left: Number(el.dataset.idx) * SLOT, behavior: "smooth" }),
  "wall-pick": (el) => openWallPicker(el.dataset.kind),
  "wall-toggle": async (el) => {
    const kind = el.dataset.kind;
    const list = kind === "own" ? state.profile.items : state.profile.wants;
    const row = list.find((x) => x.id === el.dataset.id);
    const on = el.checked;
    try {
      if (kind === "own") await state.api.collection.update(row.id, { featured: on });
      else await state.api.wantlist.setFeatured(row.id, on);
    } catch (e) {
      el.checked = !on;
      throw e;
    }
    row.featured = on;
    const n = list.filter((x) => x.featured).length;
    $("#picker-count").textContent = `${n} of 6 on your wall`;
    renderProfile();
  },
  "want-open": (el) => openWantSheet(state.wants.get(el.dataset.id)),
  "blocked-list": () => openBlockedList(),
  unblock: async (el) => {
    await state.api.safety.unblock(el.dataset.user);
    toast("Unblocked.");
    await openBlockedList();
    refreshBadge();
  },
};

document.addEventListener("change", (e) => {
  const el = e.target.closest('input[data-act="wall-toggle"]');
  if (!el) return;
  Promise.resolve(ACT["wall-toggle"](el)).catch((err) => toast(err?.message || "Something went wrong.", true));
});

document.addEventListener("click", (e) => {
  if (e.target.closest('input[data-act="wall-toggle"]')) return; // handled on change
  const el = e.target.closest("[data-act]");
  if (!el || !ACT[el.dataset.act]) return;
  e.preventDefault();
  Promise.resolve(ACT[el.dataset.act](el, e)).catch((err) => toast(err?.message || "Something went wrong.", true));
});

/* ======================================================================
   forms
   ====================================================================== */

const FORMS = {
  auth: (form) => submitAuth(form),
  add: (form) => submitAdd(form),
  "edit-item": async (form) => {
    await saveItem(form);
    route({ keepScroll: true });
  },
  "edit-profile": async (form) => {
    const f = new FormData(form);
    const updated = await state.api.profiles.update({ city: String(f.get("city") || "").trim(), bio: String(f.get("bio") || "").trim() });
    state.me = updated;
    state.profile.p = updated;
    closeSheet();
    toast("Profile saved.");
    renderProfile();
  },
  report: async (form) => {
    const f = new FormData(form);
    await state.api.safety.report({
      target_user_id: form.dataset.user,
      target_item_id: form.dataset.item || null,
      reason: String(f.get("reason")),
      details: String(f.get("details") || "").trim(),
    });
    closeSheet();
    toast("Report sent. Thanks for telling us.");
  },
};

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-form]");
  if (!form || !FORMS[form.dataset.form]) return;
  e.preventDefault();
  Promise.resolve(FORMS[form.dataset.form](form)).catch((err) => toast(err?.message || "Something went wrong.", true));
});

/* ======================================================================
   boot
   ====================================================================== */

async function main() {
  const params = new URLSearchParams(location.search);
  const demo = params.has("demo") || CONFIG.DEMO || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY;
  view.innerHTML = skeleton(3);
  try {
    state.api = await makeApi(CONFIG, demo);
  } catch (e) {
    return showError(new Error("Couldn't load the app's services. Check your connection and reload."));
  }
  // Supabase asks that async work inside this callback be deferred
  state.api.auth.onChange((session) => setTimeout(() => handleSession(session), 0));
  handleSession(await state.api.auth.session());
}

window.__crate = { state }; // handy for debugging in the browser console
main();
