// background.js
const MRU_KEY = "mru_tab_ids";
const MAX = 200;

async function loadMRU() {
  const obj = await browser.storage.local.get(MRU_KEY);
  return Array.isArray(obj[MRU_KEY]) ? obj[MRU_KEY] : [];
}

async function saveMRU(list) {
  await browser.storage.local.set({ [MRU_KEY]: list.slice(0, MAX) });
}

async function touch(tabId) {
  let mru = await loadMRU();
  mru = mru.filter((id) => id !== tabId);
  mru.unshift(tabId);
  await saveMRU(mru);
}

browser.tabs.onActivated.addListener(({ tabId }) => {
  touch(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  loadMRU().then((mru) => saveMRU(mru.filter((id) => id !== tabId)));
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return;
  const [tab] = await browser.tabs.query({ windowId, active: true });
  if (tab?.id) touch(tab.id);
});
