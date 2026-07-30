import L, {
  type CircleMarker,
  type LayerGroup,
  type Map as LeafletMap,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import demoMapPackJson from "./data/demo-map-pack.json";
import { parseBackup, parseMapPack } from "./map-pack";
import { LocalDatabase, progressRecordId } from "./storage";
import { SyncApiError, SyncClient, type RemoteSession } from "./sync";
import type { MapCategory, MapMarker, MapPack, Profile } from "./types";

const DEFAULT_PROFILES: Profile[] = [
  {
    id: "owner",
    name: "Chủ map",
    createdAt: "2026-07-30T00:00:00.000Z",
  },
  {
    id: "friend",
    name: "Đồng đội",
    createdAt: "2026-07-30T00:00:01.000Z",
  },
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Không tìm thấy #app.");
}

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <button class="icon-button mobile-only" id="sidebar-toggle" type="button" aria-label="Mở bộ lọc">
        <span></span><span></span><span></span>
      </button>
      <div class="brand">
        <img src="${import.meta.env.BASE_URL}icon.svg" alt="" />
        <div>
          <strong>Wayfinder</strong>
          <span>Bản đồ tiến trình cá nhân</span>
        </div>
      </div>
      <div class="topbar-spacer"></div>
      <div class="top-progress" aria-live="polite">
        <span id="top-progress-count">0 / 0</span>
        <small>đã hoàn thành</small>
      </div>
      <label class="profile-picker">
        <span>Hồ sơ</span>
        <select id="profile-select" aria-label="Chọn profile"></select>
      </label>
      <button class="icon-button settings-button" id="settings-button" type="button" aria-label="Mở cài đặt">⚙</button>
    </header>

    <aside class="sidebar" id="sidebar">
      <section class="map-intro">
        <div class="eyebrow">BẢN ĐỒ ĐANG DÙNG</div>
        <h1 id="map-title"></h1>
        <p id="map-subtitle"></p>
        <div class="demo-notice" id="demo-notice">
          <span>DEMO</span>
          Dữ liệu giả lập, không phải dữ liệu trong game.
        </div>
      </section>

      <section class="progress-card">
        <div class="progress-card-row">
          <div>
            <span class="eyebrow">TIẾN TRÌNH</span>
            <strong id="progress-percentage">0%</strong>
          </div>
          <span id="progress-fraction">0 / 0 điểm</span>
        </div>
        <div class="progress-track" aria-hidden="true">
          <div id="progress-bar"></div>
        </div>
      </section>

      <label class="search-box">
        <span aria-hidden="true">⌕</span>
        <input id="search-input" type="search" placeholder="Tìm điểm..." autocomplete="off" />
      </label>

      <div class="section-heading">
        <span>Loại điểm</span>
        <button id="toggle-all-categories" type="button">Bật tất cả</button>
      </div>
      <div class="category-list" id="category-list"></div>

      <label class="toggle-row">
        <input id="hide-completed" type="checkbox" />
        <span class="toggle-control"></span>
        <span>
          <strong>Ẩn điểm đã nhặt</strong>
          <small>Giữ bản đồ gọn khi chạy route</small>
        </span>
      </label>

      <div class="sidebar-actions">
        <button class="secondary-button" id="fit-map" type="button">Căn toàn bản đồ</button>
        <button class="secondary-button" id="open-settings" type="button">Dữ liệu & backup</button>
      </div>

      <footer class="sidebar-footer">
        <p id="map-attribution"></p>
        <span class="sync-status" id="sync-status">Chỉ lưu trên thiết bị này.</span>
      </footer>
    </aside>

    <main class="map-stage">
      <div id="map" aria-label="Bản đồ tương tác"></div>
      <div class="map-hud">
        <span class="status-dot"></span>
        <span id="visible-count">0 điểm đang hiển thị</span>
      </div>
      <div class="map-hint">Kéo để di chuyển · Cuộn để phóng to</div>
    </main>
  </div>

  <dialog class="settings-dialog" id="settings-dialog">
    <form method="dialog" class="dialog-shell">
      <div class="dialog-header">
        <div>
          <span class="eyebrow">THIẾT LẬP THIẾT BỊ</span>
          <h2>Dữ liệu và profile</h2>
        </div>
        <button class="icon-button" value="cancel" aria-label="Đóng">×</button>
      </div>

      <section class="dialog-section">
        <h3>Hồ sơ hiện tại</h3>
        <p id="profile-mode-description">Hồ sơ đang lưu trên thiết bị này.</p>
        <div class="inline-form">
          <input id="profile-name-input" type="text" maxlength="40" aria-label="Tên profile" />
          <button id="rename-profile" class="primary-button" type="button">Lưu tên</button>
        </div>
        <button id="copy-friend-link" class="secondary-button full-width" type="button">
          Sao chép link profile local
        </button>
        <button id="logout-device" class="danger-button full-width" type="button" hidden>
          Ngắt liên kết thiết bị
        </button>
      </section>

      <section class="dialog-section">
        <h3>Backup tiến trình</h3>
        <p>Export định kỳ để tránh mất dữ liệu khi xóa storage của trình duyệt.</p>
        <div class="button-grid">
          <button id="export-backup" class="secondary-button" type="button">Export JSON</button>
          <button id="import-backup" class="secondary-button" type="button">Import JSON</button>
        </div>
      </section>

      <section class="dialog-section">
        <h3>Gói bản đồ</h3>
        <p>Chỉ import dữ liệu và basemap mà bạn có quyền sử dụng.</p>
        <div class="button-grid">
          <button id="import-map-pack" class="secondary-button" type="button">Import gói bản đồ</button>
          <button id="use-demo-map" class="secondary-button" type="button">Dùng bản đồ demo</button>
        </div>
      </section>

      <div class="dialog-footer">
        <span id="storage-status">IndexedDB đang hoạt động</span>
        <button class="primary-button" value="cancel">Xong</button>
      </div>
    </form>
  </dialog>

  <input id="backup-file-input" type="file" accept="application/json,.json" hidden />
  <input id="map-pack-file-input" type="file" accept="application/json,.json" hidden />
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Không tìm thấy element: ${selector}`);
  }
  return element;
}

const elements = {
  sidebar: mustQuery<HTMLElement>("#sidebar"),
  sidebarToggle: mustQuery<HTMLButtonElement>("#sidebar-toggle"),
  settingsButton: mustQuery<HTMLButtonElement>("#settings-button"),
  openSettings: mustQuery<HTMLButtonElement>("#open-settings"),
  settingsDialog: mustQuery<HTMLDialogElement>("#settings-dialog"),
  mapTitle: mustQuery<HTMLElement>("#map-title"),
  mapSubtitle: mustQuery<HTMLElement>("#map-subtitle"),
  mapAttribution: mustQuery<HTMLElement>("#map-attribution"),
  demoNotice: mustQuery<HTMLElement>("#demo-notice"),
  topProgressCount: mustQuery<HTMLElement>("#top-progress-count"),
  progressPercentage: mustQuery<HTMLElement>("#progress-percentage"),
  progressFraction: mustQuery<HTMLElement>("#progress-fraction"),
  progressBar: mustQuery<HTMLElement>("#progress-bar"),
  visibleCount: mustQuery<HTMLElement>("#visible-count"),
  searchInput: mustQuery<HTMLInputElement>("#search-input"),
  categoryList: mustQuery<HTMLElement>("#category-list"),
  toggleAllCategories: mustQuery<HTMLButtonElement>("#toggle-all-categories"),
  hideCompleted: mustQuery<HTMLInputElement>("#hide-completed"),
  fitMap: mustQuery<HTMLButtonElement>("#fit-map"),
  profileSelect: mustQuery<HTMLSelectElement>("#profile-select"),
  profileNameInput: mustQuery<HTMLInputElement>("#profile-name-input"),
  profileModeDescription: mustQuery<HTMLElement>("#profile-mode-description"),
  renameProfile: mustQuery<HTMLButtonElement>("#rename-profile"),
  copyFriendLink: mustQuery<HTMLButtonElement>("#copy-friend-link"),
  logoutDevice: mustQuery<HTMLButtonElement>("#logout-device"),
  exportBackup: mustQuery<HTMLButtonElement>("#export-backup"),
  importBackup: mustQuery<HTMLButtonElement>("#import-backup"),
  importMapPack: mustQuery<HTMLButtonElement>("#import-map-pack"),
  useDemoMap: mustQuery<HTMLButtonElement>("#use-demo-map"),
  backupFileInput: mustQuery<HTMLInputElement>("#backup-file-input"),
  mapPackFileInput: mustQuery<HTMLInputElement>("#map-pack-file-input"),
  syncStatus: mustQuery<HTMLElement>("#sync-status"),
  toast: mustQuery<HTMLElement>("#toast"),
};

const database = await LocalDatabase.open();
const demoMapPack = parseMapPack(demoMapPackJson);
const bundledMapPack = await loadBundledMapPack();
const syncClient = new SyncClient();
let initialSyncMessage: string | undefined;
let remoteSession = await bootstrapRemoteSession();

let profiles = await ensureProfiles();
if (remoteSession) {
  await database.putProfile(remoteSession.profile);
  profiles = await database.getAllProfiles();
}
let activeProfileId = remoteSession?.profile.id ??
  (await resolveActiveProfileId(profiles));
let mapPack = await resolveActiveMapPack(bundledMapPack);
let activeMapPack = resolveImageSource(mapPack);
let completedMarkerIds = new Set<string>();
let visibleCategoryIds = await resolveVisibleCategoryIds(activeMapPack);
const storedHideCompleted = await database.getSetting<unknown>("hideCompleted");
let hideCompleted =
  typeof storedHideCompleted === "boolean" ? storedHideCompleted : false;
let searchTerm = "";
let map: LeafletMap;
let imageBounds: L.LatLngBounds;
let markerLayer: LayerGroup;
let markerReferences = new Map<string, CircleMarker>();
let toastTimer: number | undefined;
let syncInFlight = false;

await reloadProgress();
renderStaticMapDetails();
renderProfiles();
renderCategories();
initializeMap();
renderMarkers();
bindEvents();
renderSyncState(
  remoteSession ? "Đang kết nối..." : "Chỉ lưu trên thiết bị này",
);
if (initialSyncMessage) {
  showToast(initialSyncMessage, remoteSession ? "success" : "error");
}
void syncRemoteProgress();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch(() => {
        showToast("Không thể bật chế độ offline.", "error");
      });
  });
}

async function bootstrapRemoteSession(): Promise<RemoteSession | undefined> {
  const url = new URL(window.location.href);
  const inviteCode = url.searchParams.get("invite");

  try {
    if (inviteCode) {
      const session = await syncClient.claimInvite(inviteCode);
      url.searchParams.delete("invite");
      window.history.replaceState(null, "", url);
      initialSyncMessage = `Thiết bị đã liên kết với ${session.profile.name}.`;
      return session;
    }
    return await syncClient.getSession();
  } catch (error) {
    if (inviteCode) {
      initialSyncMessage = errorMessage(error);
    }
    return undefined;
  }
}

async function ensureProfiles(): Promise<Profile[]> {
  const existing = await database.getAllProfiles();
  const existingIds = new Set(existing.map((profile) => profile.id));

  for (const profile of DEFAULT_PROFILES) {
    if (!existingIds.has(profile.id)) {
      await database.putProfile(profile);
      existing.push(profile);
    }
  }

  return existing.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function resolveActiveProfileId(availableProfiles: Profile[]): Promise<string> {
  const requestedProfileId = new URL(window.location.href).searchParams.get("profile");
  const storedProfileId = await database.getSetting<unknown>("activeProfileId");
  const savedProfileId =
    typeof storedProfileId === "string" ? storedProfileId : undefined;
  const fallbackId = availableProfiles[0]?.id;
  const candidate = requestedProfileId ?? savedProfileId ?? fallbackId;

  if (!candidate || !availableProfiles.some((profile) => profile.id === candidate)) {
    throw new Error("Không có profile hợp lệ.");
  }

  await database.putSetting("activeProfileId", candidate);
  return candidate;
}

async function loadBundledMapPack(): Promise<MapPack | undefined> {
  try {
    const response = await fetch(
      `${import.meta.env.BASE_URL}map-packs/private/default-map-pack.json`,
      { cache: "no-cache" },
    );
    if (!response.ok) {
      return undefined;
    }
    return parseMapPack(await response.json());
  } catch {
    return undefined;
  }
}

async function resolveActiveMapPack(
  bundledPack: MapPack | undefined,
): Promise<MapPack> {
  const storedMapPackId = await database.getSetting<unknown>("activeMapPackId");
  const defaultMapPack = bundledPack ?? demoMapPack;
  const activeMapPackId =
    typeof storedMapPackId === "string" ? storedMapPackId : defaultMapPack.id;

  if (activeMapPackId === demoMapPack.id) {
    return demoMapPack;
  }
  if (bundledPack && activeMapPackId === bundledPack.id) {
    await database.putSetting("activeMapPackId", bundledPack.id);
    return bundledPack;
  }

  const storedMapPack = await database.getMapPack(activeMapPackId);
  if (!storedMapPack) {
    await database.putSetting("activeMapPackId", defaultMapPack.id);
    return defaultMapPack;
  }

  return parseMapPack(storedMapPack);
}

function resolveImageSource(pack: MapPack): MapPack {
  return {
    ...pack,
    image: {
      ...pack.image,
      src: new URL(pack.image.src, document.baseURI).href,
    },
  };
}

async function resolveVisibleCategoryIds(pack: MapPack): Promise<Set<string>> {
  const key = `visibleCategories:${pack.id}`;
  const storedValue = await database.getSetting<unknown>(key);
  const validCategoryIds = new Set(pack.categories.map((category) => category.id));

  if (
    !Array.isArray(storedValue) ||
    !storedValue.every((value) => typeof value === "string")
  ) {
    return validCategoryIds;
  }

  const filtered = storedValue.filter((id) => validCategoryIds.has(id));
  return new Set(filtered);
}

async function reloadProgress(): Promise<void> {
  const records = await database.getProgress(activeProfileId, activeMapPack.id);
  completedMarkerIds = new Set(
    records.filter((record) => record.done).map((record) => record.markerId),
  );
}

function renderStaticMapDetails(): void {
  elements.mapTitle.textContent = activeMapPack.title;
  elements.mapSubtitle.textContent =
    activeMapPack.subtitle ?? "Bản đồ không có mô tả.";
  elements.mapAttribution.textContent = activeMapPack.attribution;
  elements.demoNotice.hidden = activeMapPack.id !== demoMapPack.id;
  elements.hideCompleted.checked = hideCompleted;
}

function renderProfiles(): void {
  elements.profileSelect.replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === activeProfileId;
    elements.profileSelect.append(option);
  }

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  elements.profileNameInput.value = activeProfile?.name ?? "";
  const isLinkedDevice = Boolean(remoteSession);
  elements.profileSelect.disabled = isLinkedDevice;
  elements.profileNameInput.disabled = isLinkedDevice;
  elements.renameProfile.disabled = isLinkedDevice;
  elements.copyFriendLink.hidden = isLinkedDevice;
  elements.logoutDevice.hidden = !isLinkedDevice;
  elements.profileModeDescription.textContent = isLinkedDevice
    ? `Thiết bị đã liên kết với profile ${
        remoteSession?.profile.name ?? activeProfile?.name ?? ""
      }. Tiến trình được đồng bộ với server.`
    : "Hồ sơ đang lưu trên thiết bị này.";
}

function renderCategories(): void {
  elements.categoryList.replaceChildren();

  for (const category of activeMapPack.categories) {
    const categoryMarkers = activeMapPack.markers.filter(
      (marker) => marker.categoryId === category.id,
    );
    const completed = categoryMarkers.filter((marker) =>
      completedMarkerIds.has(marker.id),
    ).length;

    const label = document.createElement("label");
    label.className = "category-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = visibleCategoryIds.has(category.id);
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        visibleCategoryIds.add(category.id);
      } else {
        visibleCategoryIds.delete(category.id);
      }
      await persistVisibleCategories();
      renderMarkers();
    });

    const swatch = document.createElement("span");
    swatch.className = "category-swatch";
    swatch.style.setProperty("--category-color", category.color);
    swatch.textContent = category.symbol;

    const text = document.createElement("span");
    text.className = "category-label";
    const title = document.createElement("strong");
    title.textContent = category.label;
    const count = document.createElement("small");
    count.textContent = `${completed}/${categoryMarkers.length}`;
    text.append(title, count);

    label.append(checkbox, swatch, text);
    elements.categoryList.append(label);
  }

  elements.toggleAllCategories.textContent =
    visibleCategoryIds.size === activeMapPack.categories.length
      ? "Tắt tất cả"
      : "Bật tất cả";
}

function initializeMap(): void {
  imageBounds = L.latLngBounds(
    [0, 0],
    [activeMapPack.image.height, activeMapPack.image.width],
  );

  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 2.5,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    attributionControl: false,
  });

  L.imageOverlay(activeMapPack.image.src, imageBounds, {
    className: "map-image",
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.fitBounds(imageBounds, { animate: false });
  if (window.matchMedia("(max-width: 820px)").matches) {
    map.setZoom(Math.min(map.getZoom() + 0.75, map.getMaxZoom()), {
      animate: false,
    });
  }
  map.setMaxBounds(imageBounds.pad(0.18));
}

function markerLatLng(marker: MapMarker): L.LatLngExpression {
  return [activeMapPack.image.height - marker.y, marker.x];
}

function renderMarkers(): void {
  markerLayer.clearLayers();
  markerReferences = new Map<string, CircleMarker>();
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase("vi");
  let visibleMarkerCount = 0;

  for (const marker of activeMapPack.markers) {
    const category = findCategory(marker.categoryId);
    const isDone = completedMarkerIds.has(marker.id);
    const matchesCategory = visibleCategoryIds.has(marker.categoryId);
    const haystack = `${marker.title} ${marker.description ?? ""}`.toLocaleLowerCase(
      "vi",
    );
    const matchesSearch =
      normalizedSearchTerm.length === 0 || haystack.includes(normalizedSearchTerm);

    if (
      !matchesCategory ||
      !matchesSearch ||
      (hideCompleted && isDone)
    ) {
      continue;
    }

    const circle = L.circleMarker(markerLatLng(marker), {
      radius: isDone ? 8 : 10,
      color: isDone ? "#d9fff6" : "#f7fffc",
      weight: isDone ? 1 : 2,
      fillColor: category.color,
      fillOpacity: isDone ? 0.28 : 0.94,
      opacity: isDone ? 0.48 : 1,
      className: isDone ? "progress-marker is-done" : "progress-marker",
    });

    const tooltipContent = document.createElement("span");
    tooltipContent.textContent = marker.title;
    circle.bindTooltip(tooltipContent, {
      direction: "top",
      offset: [0, -8],
      opacity: 0.95,
    });
    circle.bindPopup(createMarkerPopup(marker, category, isDone), {
      className: "marker-popup",
      minWidth: 230,
      closeButton: true,
    });
    circle.addTo(markerLayer);
    markerReferences.set(marker.id, circle);
    visibleMarkerCount += 1;
  }

  elements.visibleCount.textContent = `${visibleMarkerCount} điểm đang hiển thị`;
  updateProgressDisplay();
}

function findCategory(categoryId: string): MapCategory {
  const category = activeMapPack.categories.find(
    (candidate) => candidate.id === categoryId,
  );
  if (!category) {
    throw new Error(`Không tìm thấy category: ${categoryId}`);
  }
  return category;
}

function createMarkerPopup(
  marker: MapMarker,
  category: MapCategory,
  isDone: boolean,
): HTMLElement {
  const wrapper = document.createElement("article");
  wrapper.className = "popup-content";

  const badge = document.createElement("span");
  badge.className = "popup-badge";
  badge.style.setProperty("--category-color", category.color);
  badge.textContent = category.label;

  const title = document.createElement("h3");
  title.textContent = marker.title;

  const description = document.createElement("p");
  description.textContent =
    marker.description ?? `Tọa độ: ${Math.round(marker.x)}, ${Math.round(marker.y)}`;

  const coordinate = document.createElement("code");
  coordinate.textContent = `x ${marker.x} · y ${marker.y}`;

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = isDone
    ? "marker-toggle is-complete"
    : "marker-toggle";
  toggleButton.textContent = isDone ? "✓ Đã nhặt — hoàn tác" : "Đánh dấu đã nhặt";
  toggleButton.addEventListener("click", async () => {
    await setMarkerDone(marker.id, !isDone);
  });

  wrapper.append(badge, title, description, coordinate, toggleButton);
  return wrapper;
}

async function setMarkerDone(markerId: string, done: boolean): Promise<void> {
  await database.putProgress({
    id: progressRecordId(activeProfileId, activeMapPack.id, markerId),
    profileId: activeProfileId,
    mapId: activeMapPack.id,
    markerId,
    done,
    updatedAt: new Date().toISOString(),
    pendingSync: true,
  });

  if (done) {
    completedMarkerIds.add(markerId);
    showToast("Đã lưu tiến trình.");
  } else {
    completedMarkerIds.delete(markerId);
    showToast("Đã hoàn tác điểm.");
  }

  map.closePopup();
  renderCategories();
  renderMarkers();
  void syncRemoteProgress();
}

function updateProgressDisplay(): void {
  const total = activeMapPack.markers.length;
  const completed = activeMapPack.markers.filter((marker) =>
    completedMarkerIds.has(marker.id),
  ).length;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

  elements.topProgressCount.textContent = `${completed} / ${total}`;
  elements.progressPercentage.textContent = `${percentage}%`;
  elements.progressFraction.textContent = `${completed} / ${total} điểm`;
  elements.progressBar.style.width = `${percentage}%`;
}

async function persistVisibleCategories(): Promise<void> {
  await database.putSetting(
    `visibleCategories:${activeMapPack.id}`,
    [...visibleCategoryIds],
  );
}

function renderSyncState(
  label: string,
  state: "local" | "syncing" | "synced" | "offline" = "local",
): void {
  elements.syncStatus.textContent = label;
  elements.syncStatus.dataset.state = state;
}

async function syncRemoteProgress(): Promise<void> {
  if (
    !remoteSession ||
    remoteSession.profile.id !== activeProfileId ||
    syncInFlight
  ) {
    if (!remoteSession) {
      renderSyncState("Chỉ lưu trên thiết bị này.", "local");
    }
    return;
  }

  syncInFlight = true;
  renderSyncState("Đang đồng bộ...", "syncing");
  let syncSucceeded = false;

  try {
    const localRecords = await database.getProgress(
      activeProfileId,
      activeMapPack.id,
    );
    const pending = localRecords.filter(
      (record) => record.pendingSync !== false,
    );

    for (let offset = 0; offset < pending.length; offset += 500) {
      const batch = pending.slice(offset, offset + 500);
      const submittedVersions = new Map(
        batch.map((record) => [record.id, record.updatedAt]),
      );
      const canonical = await syncClient.pushProgress(batch);
      const latestLocal = new Map(
        (
          await database.getProgress(activeProfileId, activeMapPack.id)
        ).map((record) => [record.id, record]),
      );

      for (const record of canonical) {
        const current = latestLocal.get(record.id);
        if (current?.updatedAt === submittedVersions.get(record.id)) {
          await database.putProgress({ ...record, pendingSync: false });
        }
      }
    }

    const remoteRecords = await syncClient.pullProgress(activeMapPack.id);
    const currentLocal = new Map(
      (
        await database.getProgress(activeProfileId, activeMapPack.id)
      ).map((record) => [record.id, record]),
    );
    for (const record of remoteRecords) {
      if (currentLocal.get(record.id)?.pendingSync === true) {
        continue;
      }
      await database.putProgress({ ...record, pendingSync: false });
    }

    await reloadProgress();
    renderCategories();
    renderMarkers();
    renderSyncState("Đã đồng bộ với server.", "synced");
    syncSucceeded = true;
  } catch (error) {
    if (error instanceof SyncApiError && error.status === 401) {
      remoteSession = undefined;
      renderProfiles();
      renderSyncState(
        "Phiên thiết bị đã hết hạn — tiến trình vẫn lưu local.",
        "offline",
      );
    } else {
      renderSyncState("Offline — tiến trình vẫn lưu local.", "offline");
    }
  } finally {
    syncInFlight = false;
    const remaining = (
      await database.getProgress(activeProfileId, activeMapPack.id)
    ).some((record) => record.pendingSync !== false);
    if (syncSucceeded && remaining && remoteSession) {
      window.setTimeout(() => void syncRemoteProgress(), 600);
    }
  }
}

function bindEvents(): void {
  window.addEventListener("online", () => {
    void syncRemoteProgress();
  });

  elements.sidebarToggle.addEventListener("click", () => {
    elements.sidebar.classList.toggle("is-open");
  });

  for (const button of [
    elements.settingsButton,
    elements.openSettings,
  ]) {
    button.addEventListener("click", () => {
      elements.sidebar.classList.remove("is-open");
      elements.settingsDialog.showModal();
    });
  }

  elements.searchInput.addEventListener("input", () => {
    searchTerm = elements.searchInput.value;
    renderMarkers();
  });

  elements.hideCompleted.addEventListener("change", async () => {
    hideCompleted = elements.hideCompleted.checked;
    await database.putSetting("hideCompleted", hideCompleted);
    renderMarkers();
  });

  elements.toggleAllCategories.addEventListener("click", async () => {
    if (visibleCategoryIds.size === activeMapPack.categories.length) {
      visibleCategoryIds.clear();
    } else {
      visibleCategoryIds = new Set(
        activeMapPack.categories.map((category) => category.id),
      );
    }
    await persistVisibleCategories();
    renderCategories();
    renderMarkers();
  });

  elements.fitMap.addEventListener("click", () => {
    map.fitBounds(imageBounds);
    elements.sidebar.classList.remove("is-open");
  });

  elements.profileSelect.addEventListener("change", async () => {
    activeProfileId = elements.profileSelect.value;
    await database.putSetting("activeProfileId", activeProfileId);
    await reloadProgress();
    renderProfiles();
    renderCategories();
    renderMarkers();
    showToast("Đã chuyển profile.");
  });

  elements.renameProfile.addEventListener("click", async () => {
    const name = elements.profileNameInput.value.trim();
    if (!name) {
      showToast("Tên profile không được để trống.", "error");
      return;
    }

    const profile = profiles.find((candidate) => candidate.id === activeProfileId);
    if (!profile) {
      return;
    }

    const updated = { ...profile, name };
    await database.putProfile(updated);
    profiles = profiles.map((candidate) =>
      candidate.id === updated.id ? updated : candidate,
    );
    renderProfiles();
    showToast("Đã đổi tên profile.");
  });

  elements.logoutDevice.addEventListener("click", async () => {
    try {
      await syncClient.logout();
      remoteSession = undefined;
      renderSyncState("Đã ngắt thiết bị. Tiến trình local vẫn được giữ.", "local");
      showToast("Đã ngắt liên kết thiết bị.");
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  });

  elements.copyFriendLink.addEventListener("click", async () => {
    const inviteUrl = new URL(window.location.href);
    inviteUrl.search = "";
    inviteUrl.searchParams.set("profile", "friend");

    try {
      await navigator.clipboard.writeText(inviteUrl.href);
      showToast("Đã sao chép link Đồng đội.");
    } catch {
      window.prompt("Sao chép link này:", inviteUrl.href);
    }
  });

  elements.exportBackup.addEventListener("click", async () => {
    const backup = await database.exportBackup();
    downloadJson(
      `wayfinder-backup-${new Date().toISOString().slice(0, 10)}.json`,
      backup,
    );
    showToast("Đã export backup.");
  });

  elements.importBackup.addEventListener("click", () => {
    elements.backupFileInput.click();
  });

  elements.backupFileInput.addEventListener("change", async () => {
    const file = elements.backupFileInput.files?.[0];
    elements.backupFileInput.value = "";
    if (!file) {
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast("File backup vượt quá 10 MB.", "error");
      return;
    }

    try {
      const payload = parseBackup(JSON.parse(await file.text()));
      await database.importBackup(payload);
      showToast("Đã import backup. Đang tải lại...");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  });

  elements.importMapPack.addEventListener("click", () => {
    elements.mapPackFileInput.click();
  });

  elements.mapPackFileInput.addEventListener("change", async () => {
    const file = elements.mapPackFileInput.files?.[0];
    elements.mapPackFileInput.value = "";
    if (!file) {
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("Gói bản đồ JSON vượt quá 5 MB.", "error");
      return;
    }

    try {
      const importedMapPack = parseMapPack(JSON.parse(await file.text()));
      await database.putMapPack(importedMapPack);
      await database.putSetting("activeMapPackId", importedMapPack.id);
      showToast("Đã import map pack. Đang tải lại...");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  });

  elements.useDemoMap.addEventListener("click", async () => {
    await database.putSetting("activeMapPackId", demoMapPack.id);
    showToast("Đang chuyển về bản đồ demo...");
    window.setTimeout(() => window.location.reload(), 350);
  });
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Có lỗi không xác định.";
}

function showToast(message: string, type: "success" | "error" = "success"): void {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2600);
}
