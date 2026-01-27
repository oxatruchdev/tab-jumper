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

// Fuzzy scoring with best-alignment search (non-greedy)
function fuzzyScore(text, query) {
  text = normalize(text);
  query = normalize(query);
  if (!query) return 0;
  if (query.length > text.length) return -Infinity;

  // Fast path: exact substring match
  const subIdx = text.indexOf(query);
  if (subIdx !== -1) {
    let score = query.length * 20;
    // bonus for matching at a word boundary
    if (subIdx === 0 || " /:-_.".includes(text[subIdx - 1])) score += 30;
    // bonus for prefix
    if (subIdx === 0) score += 20;
    score -= Math.min(10, text.length / 50);
    return score;
  }

  // Recursive best-alignment fuzzy match
  const best = fuzzyAlign(text, query, 0, 0, -1);
  if (best === -Infinity) return best;
  return best - Math.min(10, text.length / 50);
}

function fuzzyAlign(text, query, ti, qi, lastMatch) {
  if (qi === query.length) return 0;
  if (ti >= text.length) return -Infinity;

  const ch = query[qi];
  let best = -Infinity;

  for (let i = ti; i < text.length; i++) {
    if (text[i] !== ch) continue;

    let score = 10;
    if (lastMatch !== -1 && i === lastMatch + 1) score += 8;
    if (i === 0 || " /:-_.".includes(text[i - 1])) score += 6;
    score -= Math.min(6, i - ti);

    const rest = fuzzyAlign(text, query, i + 1, qi + 1, i);
    if (rest === -Infinity) continue;

    best = Math.max(best, score + rest);

    // If we got a consecutive or boundary match, unlikely to improve — prune
    if (score >= 16) break;
  }

  return best;
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

function itemHost(item) {
  try {
    return new URL(itemUrl(item)).hostname;
  } catch {
    return itemUrl(item);
  }
}

function itemFavicon(item) {
  if (item.kind === "tab") return item.tab.favIconUrl || "";
  return item.session?.tab?.favIconUrl || "";
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

  const { host, base, full } = getHostParts(url);

  // For each token, require it to match somewhere (host/title).
  let total = 0;

  for (const tok of toks) {
    const sHost = Math.max(
      fuzzyScore(full, tok),
      fuzzyScore(host, tok),
      fuzzyScore(base, tok),
    );
    const sTitle = fuzzyScore(title, tok);

    const MIN = tok.length * 8;
    const hasHost = sHost >= MIN;
    const hasTitle = sTitle >= MIN;

    if (!hasHost && !hasTitle) return -Infinity;

    const W_HOST = 4.0;
    const W_TITLE = 3.0;

    const domainBonus = hasHost ? 60 : 0;

    total +=
      domainBonus +
      W_HOST * (hasHost ? sHost : 0) +
      W_TITLE * (hasTitle ? sTitle : 0);
  }

  // Extra boosts for whole-query substring matches
  total += includesScore(full, query) * 2;
  total += includesScore(title, query);

  return total;
}

function rankItems(query) {
  if (!query) return allItems.map((item, i) => ({ item, s: 0, i }));

  return allItems
    .map((item, i) => ({ item, s: combinedScore(item, query), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
}

function fuzzyMatchPositions(text, query) {
  const t = normalize(text);
  const q = normalize(query);
  if (!q || q.length > t.length) return null;

  // Fast path: exact substring match
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    const positions = [];
    for (let i = subIdx; i < subIdx + q.length; i++) positions.push(i);
    return positions;
  }

  // Recursive best-alignment (mirrors fuzzyAlign but tracks positions)
  function align(ti, qi, lastMatch) {
    if (qi === q.length) return { score: 0, pos: [] };
    if (ti >= t.length) return null;

    const ch = q[qi];
    let best = null;

    for (let i = ti; i < t.length; i++) {
      if (t[i] !== ch) continue;

      let score = 10;
      if (lastMatch !== -1 && i === lastMatch + 1) score += 8;
      if (i === 0 || " /:-_.".includes(t[i - 1])) score += 6;
      score -= Math.min(6, i - ti);

      const rest = align(i + 1, qi + 1, i);
      if (!rest) continue;

      const total = score + rest.score;
      if (!best || total > best.score) {
        best = { score: total, pos: [i, ...rest.pos] };
      }

      if (score >= 16) break;
    }

    return best;
  }

  const result = align(0, 0, -1);
  return result ? result.pos : null;
}

function highlightText(text, positions) {
  const frag = document.createDocumentFragment();
  if (!positions || positions.length === 0) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }

  const set = new Set(positions);
  let i = 0;
  while (i < text.length) {
    if (set.has(i)) {
      const span = document.createElement("span");
      span.className = "hl";
      let j = i;
      while (j < text.length && set.has(j)) j++;
      span.textContent = text.slice(i, j);
      frag.appendChild(span);
      i = j;
    } else {
      let j = i;
      while (j < text.length && !set.has(j)) j++;
      frag.appendChild(document.createTextNode(text.slice(i, j)));
      i = j;
    }
  }
  return frag;
}

function getMatchPositions(text, query) {
  const toks = tokens(query);
  if (toks.length === 0) return null;

  const all = new Set();
  for (const tok of toks) {
    const pos = fuzzyMatchPositions(text, tok);
    if (pos) pos.forEach((p) => all.add(p));
  }
  return all.size > 0 ? [...all].sort((a, b) => a - b) : null;
}

function clearList() {
  while ($list.firstChild) $list.removeChild($list.firstChild);
}

function render() {
  clearList();
  const ranked = rankItems($q.value).map((x) => x.item);
  const audibleTabs = ranked.filter(
    (item) => item.kind === "tab" && item.tab.audible,
  );
  const openTabs = ranked.filter(
    (item) => item.kind === "tab" && !item.tab.audible,
  );
  const closedTabs = ranked.filter((item) => item.kind === "closed");
  filtered = [...audibleTabs, ...openTabs, ...closedTabs];

  if (!$q.value && audibleTabs.length > 0 && openTabs.length > 0) {
    sel = audibleTabs.length;
  }
  if (sel >= filtered.length) sel = filtered.length - 1;
  if (sel < 0) sel = 0;

  $meta.textContent =
    filtered.length === 0
      ? "No matches"
      : `${filtered.length} tab${filtered.length === 1 ? "" : "s"} • ↑/↓ to navigate • Enter to switch`;

  // Divider before audible tabs
  if (audibleTabs.length > 0) {
    const div = document.createElement("li");
    div.className = "divider";
    div.textContent = "Audible";
    $list.appendChild(div);
  }

  let sectionIndex = 0;
  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];

    // Divider before open tabs
    if (i === audibleTabs.length && openTabs.length > 0) {
      const div = document.createElement("li");
      div.className = "divider";
      div.textContent = "Open tabs";
      $list.appendChild(div);
    }

    // Divider before closed tabs
    if (i === audibleTabs.length + openTabs.length && closedTabs.length > 0) {
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
    const titleText = itemTitle(item);
    const hostText = itemHost(item);
    const query = $q.value;

    if (query) {
      title.appendChild(
        highlightText(titleText, getMatchPositions(titleText, query)),
      );
    } else {
      title.textContent = titleText;
    }

    const sub = document.createElement("div");
    sub.className = "sub";
    if (query) {
      sub.appendChild(
        highlightText(hostText, getMatchPositions(hostText, query)),
      );
    } else {
      sub.textContent = hostText;
    }

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
  if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "j")) {
    e.preventDefault();
    sel = Math.min(filtered.length - 1, sel + 1);
    updateSelection();
  } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "k")) {
    e.preventDefault();
    sel = Math.max(0, sel - 1);
    updateSelection();
  } else if (e.key === "Enter" || (e.ctrlKey && e.key === "l")) {
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
