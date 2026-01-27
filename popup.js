const $q = document.getElementById("q");
const $list = document.getElementById("list");
const $meta = document.getElementById("meta");

let allTabs = [];
let filtered = [];
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

function rankTabs(query) {
  if (!query) {
    // Default: active tab first, then window order
    return allTabs.map((t, i) => ({ t, s: 0, i }));
  }

  return allTabs
    .map((t, i) => {
      const hay = `${t.title || ""} ${t.url || ""}`;
      const s = fuzzyScore(hay, query);
      return { t, s, i };
    })
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s || a.i - b.i);
}

function clearList() {
  while ($list.firstChild) $list.removeChild($list.firstChild);
}

function render() {
  clearList();
  filtered = rankTabs($q.value).map((x) => x.t);

  if (sel >= filtered.length) sel = filtered.length - 1;
  if (sel < 0) sel = 0;

  $meta.textContent =
    filtered.length === 0
      ? "No matches"
      : `${filtered.length} tab${filtered.length === 1 ? "" : "s"} • ↑/↓ to navigate • Enter to switch`;

  for (let i = 0; i < filtered.length; i++) {
    const tab = filtered[i];

    const li = document.createElement("li");
    li.className = "item";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", i === sel ? "true" : "false");

    const img = document.createElement("img");
    img.className = "favicon";
    img.src = tab.favIconUrl || "";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => (img.style.visibility = "hidden");

    const textWrap = document.createElement("div");

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = tab.title || tab.url || "(untitled)";

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = tab.url || "";

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
  const tab = filtered[sel];
  if (!tab) return;

  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
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
  } else if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === "w" || e.key === "Backspace" || e.key === "Delete")
  ) {
    e.preventDefault();
  }
}

// popup.js
const MRU_KEY = "mru_tab_ids";

async function loadMRU() {
  const obj = await browser.storage.local.get(MRU_KEY);
  return Array.isArray(obj[MRU_KEY]) ? obj[MRU_KEY] : [];
}

async function init() {
  const mru = await loadMRU();
  const rank = new Map(mru.map((id, i) => [id, i]));

  const tabs = await browser.tabs.query({});

  allTabs = tabs
    .map((t, i) => ({
      t,
      i,
      r: rank.has(t.id) ? rank.get(t.id) : Infinity,
    }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);

  // ✅ make “previous tab” first by pushing current tab to the end
  allTabs = moveActiveToEnd(allTabs);

  render();

  // ✅ re-render on typing
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
