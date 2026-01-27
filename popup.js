const $q = document.getElementById("q");
const $list = document.getElementById("list");
const $meta = document.getElementById("meta");

let allTabs = [];
let recentClosed = [];
let allItems = []; // unified list: open tabs + recently closed
let filtered = []; // unified filtered list
let sel = 0;

window.addEventListener("blur", () => {
  requestAnimationFrame(() => $q.focus());
});

function normalize(s) {
  return (s || "").toLowerCase();
}

function moveActiveToEnd(tabs) {
  const idx = tabs.findIndex((t) => t.active);
  if (idx === -1) return tabs;
  const [active] = tabs.splice(idx, 1);
  tabs.push(active);
  return tabs;
}

// Simple fuzzy scoring: rewards ordered character matches with closeness bonus
function fuzzyScore(text, query) {
  text = normalize(text);
  query = normalize(query);
  if (!query) return 0;

  let ti = 0;
  let score = 0;
  let lastMatch = -1;

  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    const idx = text.indexOf(ch, ti);
    if (idx === -1) return -Infinity;

    // base point for a match
    score += 10;

    // bonus for consecutive matches
    if (lastMatch !== -1 && idx === lastMatch + 1) score += 8;

    // bonus for “word boundary-ish”
    if (idx === 0 || " /:-_.".includes(text[idx - 1])) score += 6;

    // small penalty for distance jumped
    score -= Math.min(6, idx - ti);

    lastMatch = idx;
    ti = idx + 1;
  }

  // shorter texts slightly favored
  score -= Math.min(10, text.length / 50);
  return score;
}

function getHostParts(url) {
  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase();
    // also include "base domain-ish" (last 2 labels) as a separate field
    const parts = host.split(".").filter(Boolean);
    const base = parts.length >= 2 ? parts.slice(-2).join(".") : host;
    return { host, base, full: `${host} ${base}`.trim() };
  } catch {
    return { host: "", base: "", full: "" };
  }
}

function tokens(q) {
  return normalize(q).split(/\s+/).filter(Boolean);
}

function includesScore(text, q) {
  text = normalize(text);
  q = normalize(q);
  if (!q) return 0;
  return text.includes(q) ? 200 : 0; // big boost for exact substring
}

function itemTitle(item) {
  if (item.kind === "tab")
    return item.tab.title || item.tab.url || "(untitled)";
  const t = item.session?.tab;
  // sessions items: { tab: { title, url, ... }, sessionId }
  return t?.title || t?.url || "(recently closed)";
}

function itemUrl(item) {
  if (item.kind === "tab") return item.tab.url || "";
  return item.session?.tab?.url || "";
}

function itemFavicon(item) {
  if (item.kind === "tab") return item.tab.favIconUrl || "";
  // recently closed usually doesn't have favIconUrl
  return "";
}

function combinedScore(item, query) {
  const title = itemTitle(item);
  const url = itemUrl(item);

  // Reuse your existing logic by creating a tab-like object
  return combinedScoreTabLike({ title, url }, query);
}

function combinedScoreTabLike(tab, query) {
  const toks = tokens(query);
  if (toks.length === 0) return 0;

  const title = tab.title || "";
  const url = tab.url || "";
  const urlNoProto = url.replace(/^https?:\/\//i, "");

  const { host, base, full } = getHostParts(url);

  // For each token, require it to match somewhere (host/url/title).
  // Then weight host > url > title.
  let total = 0;

  for (const tok of toks) {
    const sHost = Math.max(
      fuzzyScore(full, tok),
      fuzzyScore(host, tok),
      fuzzyScore(base, tok),
    );
    const sUrl = fuzzyScore(urlNoProto, tok);
    const sTitle = fuzzyScore(title, tok);

    const hasHost = sHost > -Infinity;
    const hasUrl = sUrl > -Infinity;
    const hasTitle = sTitle > -Infinity;

    if (!hasHost && !hasUrl && !hasTitle) return -Infinity;

    const W_HOST = 6.0;
    const W_URL = 2.0;
    const W_TITLE = 1.0;

    const domainBonus = hasHost ? 60 : 0;

    total +=
      domainBonus +
      W_HOST * (hasHost ? sHost : 0) +
      W_URL * (hasUrl ? sUrl : 0) +
      W_TITLE * (hasTitle ? sTitle : 0);
  }

  // Extra boosts for whole-query substring matches (nice for "chatgpt", "teams", etc.)
  total += includesScore(full, query) * 2;
  total += includesScore(urlNoProto, query);
  total += includesScore(title, query);

  return total;
}

function rankItems(query) {
  if (!query) return allItems.map((item, i) => ({ item, s: 0, i }));

  return allItems
    .map((item, i) => ({ item, s: combinedScore(item, query), i }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s || a.i - b.i);
}

function clearList() {
  while ($list.firstChild) $list.removeChild($list.firstChild);
}

function render() {
  clearList();
  const ranked = rankItems($q.value).map((x) => x.item);
  const openTabs = ranked.filter((item) => item.kind === "tab");
  const closedTabs = ranked.filter((item) => item.kind === "closed");
  filtered = [...openTabs, ...closedTabs];

  if (sel >= filtered.length) sel = filtered.length - 1;
  if (sel < 0) sel = 0;

  $meta.textContent =
    filtered.length === 0
      ? "No matches"
      : `${filtered.length} tab${filtered.length === 1 ? "" : "s"} • ↑/↓ to navigate • Enter to switch`;

  // Divider before open tabs
  if (openTabs.length > 0) {
    const div = document.createElement("li");
    div.className = "divider";
    div.textContent = "Open tabs";
    $list.appendChild(div);
  }

  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];

    // Divider before the first closed tab
    if (item.kind === "closed" && i === openTabs.length) {
      const div = document.createElement("li");
      div.className = "divider";
      div.textContent = "Recently closed";
      $list.appendChild(div);
    }

    const li = document.createElement("li");
    li.className = "item";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", i === sel ? "true" : "false");

    const img = document.createElement("img");
    img.className = "favicon";
    img.src = itemFavicon(item);

    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => (img.style.visibility = "hidden");

    const textWrap = document.createElement("div");

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = itemTitle(item);

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = itemUrl(item);

    textWrap.appendChild(title);
    textWrap.appendChild(sub);

    li.appendChild(img);
    li.appendChild(textWrap);

    li.addEventListener("mousemove", () => {
      sel = i;
      updateSelection();
    });

    li.addEventListener("click", () => activateSelected());

    $list.appendChild(li);
  }

  updateSelection();
}

function updateSelection() {
  const items = $list.querySelectorAll(".item");
  items.forEach((el, i) =>
    el.setAttribute("aria-selected", i === sel ? "true" : "false"),
  );

  const active = items[sel];
  if (active) active.scrollIntoView({ block: "nearest" });
}

async function activateSelected() {
  const item = filtered[sel];
  if (!item) return;

  if (item.kind === "tab") {
    const tab = item.tab;
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    window.close();
    return;
  }

  // recently closed
  const sessionId = item.session?.tab?.sessionId;
  console.log("item", JSON.stringify(item, 2, null));
  if (!sessionId) return;

  const restored = await browser.sessions.restore(sessionId);

  // restored can be { tab } or { window }
  if (restored?.tab?.id) {
    await browser.tabs.update(restored.tab.id, { active: true });
    await browser.windows.update(restored.tab.windowId, { focused: true });
  } else if (restored?.window?.id) {
    await browser.windows.update(restored.window.id, { focused: true });
  }

  window.close();
}

async function closeSelected() {
  const tab = filtered[sel];
  if (!tab) return;
  await browser.tabs.remove(tab.id);

  // Refresh list after close
  allTabs = await browser.tabs.query({});
  render();
}

function onKey(e) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    sel = Math.min(filtered.length - 1, sel + 1);
    updateSelection();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    sel = Math.max(0, sel - 1);
    updateSelection();
  } else if (e.key === "Enter") {
    e.preventDefault();
    activateSelected();
  } else if (e.key === "Escape") {
    e.preventDefault();
    window.close();
  }
}

// popup.js
const MRU_KEY = "mru_tab_ids";

async function loadMRU() {
  const obj = await browser.storage.local.get(MRU_KEY);
  return Array.isArray(obj[MRU_KEY]) ? obj[MRU_KEY] : [];
}

function buildAllItems() {
  const openItems = allTabs.map((tab) => ({ kind: "tab", tab }));
  const closedItems = recentClosed.map((session) => ({
    kind: "closed",
    session,
  }));
  allItems = [...openItems, ...closedItems];
}

async function loadRecentlyClosed(maxResults = 10) {
  const arr = await browser.sessions.getRecentlyClosed({ maxResults });
  // keep only closed tabs (ignore closed windows unless you want them too)
  return arr;
}

async function init() {
  const mru = await loadMRU();
  const rank = new Map(mru.map((id, i) => [id, i]));

  const tabs = await browser.tabs.query({});

  allTabs = tabs
    .map((t, i) => ({ t, i, r: rank.has(t.id) ? rank.get(t.id) : Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);

  allTabs = moveActiveToEnd(allTabs);

  recentClosed = await loadRecentlyClosed(10);
  console.log("recentClosed", recentClosed);
  buildAllItems();

  render();

  $q.addEventListener("input", () => {
    sel = 0;
    render();
  });

  requestAnimationFrame(() => {
    $q.focus();
    $q.select();
  });

  document.addEventListener("keydown", onKey);
}

init().catch((err) => {
  $meta.textContent = `Error: ${String(err)}`;
});
