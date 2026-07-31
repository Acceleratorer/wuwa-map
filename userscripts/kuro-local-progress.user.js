// ==UserScript==
// @name         KURO Map Local Progress
// @namespace    https://github.com/Acceleratorer/wuwa-map
// @version      0.1.0
// @description  Local-only progress overlay for the official KURO Wuthering Waves map.
// @match        https://www.kurobbs.com/mc/map/*
// @match        https://www.kurobbs.com/mc/map*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "wuwa-kuro-local-progress:v1";
  const SETTINGS_KEY = "wuwa-kuro-local-progress-settings:v1";
  const MARKER_SELECTOR =
    ".leaflet-marker-icon, .amap-marker, .mapboxgl-marker, [class*='marker'], [class*='Marker']";

  const state = {
    entries: loadEntries(),
    settings: loadSettings(),
    current: null,
    lastClickedElement: null,
  };

  const root = document.createElement("div");
  root.id = "wuwa-local-progress-root";
  root.innerHTML = `
    <style>
      #wuwa-local-progress-root {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 24px));
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #e9fffb;
      }

      #wuwa-local-progress-root * {
        box-sizing: border-box;
      }

      .wlp-panel {
        overflow: hidden;
        border: 1px solid rgba(126, 242, 222, 0.28);
        border-radius: 12px;
        background: rgba(5, 19, 22, 0.94);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.38);
        backdrop-filter: blur(12px);
      }

      .wlp-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-bottom: 1px solid rgba(126, 242, 222, 0.14);
      }

      .wlp-title {
        flex: 1;
        min-width: 0;
      }

      .wlp-title strong {
        display: block;
        font-size: 14px;
        line-height: 1.2;
      }

      .wlp-title span,
      .wlp-muted {
        color: rgba(233, 255, 251, 0.68);
        font-size: 12px;
      }

      .wlp-toggle,
      .wlp-button,
      .wlp-icon-button {
        border: 1px solid rgba(126, 242, 222, 0.28);
        border-radius: 8px;
        background: rgba(126, 242, 222, 0.1);
        color: #e9fffb;
        cursor: pointer;
        font: inherit;
      }

      .wlp-toggle,
      .wlp-icon-button {
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        font-size: 18px;
      }

      .wlp-body {
        display: grid;
        gap: 10px;
        padding: 12px;
      }

      .wlp-current {
        display: grid;
        gap: 4px;
        padding: 10px;
        border: 1px solid rgba(126, 242, 222, 0.18);
        border-radius: 10px;
        background: rgba(126, 242, 222, 0.07);
      }

      .wlp-current strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }

      .wlp-row {
        display: flex;
        gap: 8px;
      }

      .wlp-button {
        min-height: 36px;
        flex: 1;
        padding: 8px 10px;
        font-size: 13px;
      }

      .wlp-button.primary {
        border-color: rgba(126, 242, 222, 0.62);
        background: rgba(65, 213, 190, 0.24);
      }

      .wlp-button.danger {
        border-color: rgba(255, 124, 124, 0.36);
        background: rgba(255, 124, 124, 0.1);
      }

      .wlp-check {
        display: flex;
        align-items: center;
        gap: 8px;
        color: rgba(233, 255, 251, 0.82);
        font-size: 13px;
      }

      .wlp-check input {
        width: 16px;
        height: 16px;
        accent-color: #57dbc9;
      }

      .wlp-list {
        display: grid;
        gap: 6px;
        max-height: 180px;
        overflow: auto;
        padding-right: 2px;
      }

      .wlp-entry {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        padding: 8px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.055);
        font-size: 12px;
      }

      .wlp-entry code {
        color: #9cf4e7;
        font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
        font-size: 11px;
      }

      .wlp-entry button {
        width: 28px;
        height: 28px;
      }

      .wlp-toast {
        display: none;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(87, 219, 201, 0.16);
        color: #dffff9;
        font-size: 12px;
      }

      .wlp-toast.show {
        display: block;
      }

      .wlp-collapsed .wlp-body,
      .wlp-collapsed .wlp-title span {
        display: none;
      }

      .wlp-local-dimmed {
        opacity: 0.25 !important;
        filter: grayscale(1) !important;
      }

      @media (max-width: 640px) {
        #wuwa-local-progress-root {
          right: 10px;
          bottom: 10px;
          width: calc(100vw - 20px);
        }

        .wlp-list {
          max-height: 130px;
        }
      }
    </style>
    <section class="wlp-panel" aria-label="Local progress panel">
      <div class="wlp-head">
        <button class="wlp-toggle" type="button" title="Thu gọn">✓</button>
        <div class="wlp-title">
          <strong>Local Progress</strong>
          <span>Chỉ lưu trên máy này, không cần login KURO.</span>
        </div>
        <button class="wlp-icon-button" data-action="refresh" type="button" title="Đọc URL hiện tại">↻</button>
      </div>
      <div class="wlp-body">
        <div class="wlp-current">
          <span class="wlp-muted">Marker hiện tại</span>
          <strong data-current-title>Chưa chọn marker</strong>
          <span class="wlp-muted" data-current-key>Mở hoặc click một marker để script đọc state/items/x/y từ URL.</span>
        </div>
        <div class="wlp-row">
          <button class="wlp-button primary" data-action="toggle" type="button" disabled>Đánh dấu đã nhặt</button>
          <button class="wlp-button" data-action="copy" type="button" disabled>Copy key</button>
        </div>
        <label class="wlp-check">
          <input data-action="hide" type="checkbox" />
          <span>Làm mờ marker đã nhặt khi có thể</span>
        </label>
        <div class="wlp-row">
          <button class="wlp-button" data-action="export" type="button">Export JSON</button>
          <button class="wlp-button" data-action="import" type="button">Import JSON</button>
        </div>
        <input data-import-file type="file" accept="application/json,.json" hidden />
        <div class="wlp-muted" data-progress>0 marker đã nhặt</div>
        <div class="wlp-list" data-list></div>
        <div class="wlp-toast" data-toast></div>
      </div>
    </section>
  `;

  document.documentElement.append(root);

  const panel = root.querySelector(".wlp-panel");
  const toggleButton = root.querySelector(".wlp-toggle");
  const currentTitle = root.querySelector("[data-current-title]");
  const currentKey = root.querySelector("[data-current-key]");
  const progress = root.querySelector("[data-progress]");
  const list = root.querySelector("[data-list]");
  const toast = root.querySelector("[data-toast]");
  const importFile = root.querySelector("[data-import-file]");
  const markButton = root.querySelector("[data-action='toggle']");
  const copyButton = root.querySelector("[data-action='copy']");
  const hideCheckbox = root.querySelector("[data-action='hide']");

  hideCheckbox.checked = state.settings.dimCompleted;
  panel.classList.toggle("wlp-collapsed", state.settings.collapsed);

  toggleButton.addEventListener("click", () => {
    state.settings.collapsed = !state.settings.collapsed;
    saveSettings();
    panel.classList.toggle("wlp-collapsed", state.settings.collapsed);
  });

  root.addEventListener("click", (event) => {
    const action = event.target?.closest?.("[data-action]")?.dataset.action;
    if (!action) return;

    if (action === "refresh") updateCurrentFromLocation(true);
    if (action === "toggle") toggleCurrent();
    if (action === "copy") copyCurrentKey();
    if (action === "export") exportEntries();
    if (action === "import") importFile.click();
  });

  hideCheckbox.addEventListener("change", () => {
    state.settings.dimCompleted = hideCheckbox.checked;
    saveSettings();
    applyDimToLastClicked();
  });

  importFile.addEventListener("change", importEntries);

  document.addEventListener(
    "click",
    (event) => {
      if (root.contains(event.target)) return;
      const marker = event.target?.closest?.(MARKER_SELECTOR);
      if (marker) state.lastClickedElement = marker;
      setTimeout(() => updateCurrentFromLocation(false), 80);
    },
    true,
  );

  window.addEventListener("popstate", () => updateCurrentFromLocation(false));
  patchHistory("pushState");
  patchHistory("replaceState");

  updateCurrentFromLocation(false);
  render();

  function patchHistory(method) {
    const original = history[method];
    history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      setTimeout(() => updateCurrentFromLocation(false), 0);
      return result;
    };
  }

  function loadEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return new Map();
      return new Map(parsed.filter((entry) => entry && typeof entry.key === "string").map((entry) => [entry.key, entry]));
    } catch {
      return new Map();
    }
  }

  function loadSettings() {
    try {
      return {
        collapsed: false,
        dimCompleted: true,
        ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
      };
    } catch {
      return { collapsed: false, dimCompleted: true };
    }
  }

  function saveEntries() {
    const entries = [...state.entries.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function readMarkerFromUrl() {
    const params = new URLSearchParams(location.search);
    const stateId = params.get("state");
    const country = params.get("country");
    const item = params.get("items") || params.get("item") || params.get("type");
    const rawX = params.get("x");
    const rawY = params.get("y");
    const x = Number(rawX);
    const y = Number(rawY);

    if (!stateId || !country || !item || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    const roundedX = Math.round(x * 100) / 100;
    const roundedY = Math.round(y * 100) / 100;
    const key = `country=${country}|state=${stateId}|item=${item}|x=${roundedX}|y=${roundedY}`;

    return {
      key,
      country,
      stateId,
      item,
      x: roundedX,
      y: roundedY,
      url: location.href,
      title: `${item} · state ${stateId} · ${roundedX}, ${roundedY}`,
    };
  }

  function updateCurrentFromLocation(showMessage) {
    const next = readMarkerFromUrl();
    const changed = next?.key !== state.current?.key;
    state.current = next;

    if (showMessage) {
      showToast(next ? "Đã đọc marker từ URL." : "Chưa thấy đủ state/items/x/y trên URL.");
    }

    if (changed) applyDimToLastClicked();
    render();
  }

  function toggleCurrent() {
    if (!state.current) {
      showToast("Chưa chọn marker. Hãy click marker trên KURO trước.");
      return;
    }

    if (state.entries.has(state.current.key)) {
      state.entries.delete(state.current.key);
      showToast("Đã bỏ đánh dấu marker này.");
    } else {
      state.entries.set(state.current.key, {
        ...state.current,
        completedAt: new Date().toISOString(),
      });
      showToast("Đã lưu marker vào máy này.");
    }

    saveEntries();
    applyDimToLastClicked();
    render();
  }

  async function copyCurrentKey() {
    if (!state.current) return;

    try {
      await navigator.clipboard.writeText(state.current.key);
      showToast("Đã copy key marker.");
    } catch {
      showToast(state.current.key);
    }
  }

  function exportEntries() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      source: "KURO Map Local Progress userscript",
      entries: [...state.entries.values()].sort((a, b) => a.key.localeCompare(b.key)),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wuwa-kuro-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importEntries() {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      const incoming = Array.isArray(payload) ? payload : payload.entries;
      if (!Array.isArray(incoming)) throw new Error("Missing entries array");

      let imported = 0;
      for (const entry of incoming) {
        if (!entry || typeof entry.key !== "string") continue;
        state.entries.set(entry.key, {
          key: entry.key,
          country: String(entry.country || ""),
          stateId: String(entry.stateId || ""),
          item: String(entry.item || ""),
          x: Number(entry.x) || 0,
          y: Number(entry.y) || 0,
          url: String(entry.url || ""),
          title: String(entry.title || entry.key),
          completedAt: String(entry.completedAt || new Date().toISOString()),
        });
        imported += 1;
      }

      saveEntries();
      render();
      showToast(`Đã import ${imported} marker.`);
    } catch (error) {
      showToast(`Import lỗi: ${error.message}`);
    }
  }

  function removeEntry(key) {
    state.entries.delete(key);
    saveEntries();
    applyDimToLastClicked();
    render();
  }

  function applyDimToLastClicked() {
    if (!state.lastClickedElement || !state.current) return;

    const shouldDim = state.settings.dimCompleted && state.entries.has(state.current.key);
    state.lastClickedElement.classList.toggle("wlp-local-dimmed", shouldDim);
  }

  function render() {
    const isKnown = Boolean(state.current);
    const isComplete = isKnown && state.entries.has(state.current.key);

    currentTitle.textContent = state.current?.title || "Chưa chọn marker";
    currentKey.textContent = state.current?.key || "Mở hoặc click một marker để script đọc state/items/x/y từ URL.";
    markButton.disabled = !isKnown;
    copyButton.disabled = !isKnown;
    markButton.textContent = isComplete ? "Bỏ đánh dấu" : "Đánh dấu đã nhặt";
    progress.textContent = `${state.entries.size} marker đã nhặt`;

    const entries = [...state.entries.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 30);
    list.replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement("div");
        row.className = "wlp-entry";
        row.innerHTML = `
          <div>
            <div>${escapeHtml(entry.title || entry.key)}</div>
            <code>${escapeHtml(entry.item || entry.key)}</code>
          </div>
          <button class="wlp-icon-button" type="button" title="Xóa">×</button>
        `;
        row.querySelector("button").addEventListener("click", () => removeEntry(entry.key));
        return row;
      }),
    );
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char];
    });
  }
})();
