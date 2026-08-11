import L, {
  type Layer,
  type LayerGroup,
  type Map as LeafletMap,
  type Marker,
  type TileLayer,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import demoMapPackJson from "./data/demo-map-pack.json";
import { createCanvasIconMarker } from "./canvas-marker-icons";
import { createFilterIcon } from "./filter-icons";
import { uiIcon } from "./ui-icons";
import {
  mapPackDimensions,
  parseBackup,
  parseMapCatalog,
  parseMapPack,
} from "./map-pack";
import { LocalDatabase, progressRecordId } from "./storage";
import { SyncApiError, SyncClient, type RemoteSession } from "./sync";
import type {
  MapCatalog,
  MapCategory,
  MapCategoryGroup,
  MapFloorLayer,
  MapMarker,
  MapPack,
  MapTileSource,
  Profile,
} from "./types";

const FALLBACK_CATEGORY_GROUP: MapCategoryGroup = {
  id: "__other__",
  label: "Khác",
  icon: "default",
};
const TRANSPARENT_TILE =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const MAX_DOM_ICON_MARKERS = 2500;
const MAP_DATA_VERSION = "region-split-v2";
const MAP_ID_ALIASES = new Map<string, string>([
  ["wuwa-kuro-state-8", "wuwa-kuro-state-8-country-1"],
]);

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
      <button class="icon-button mobile-only" id="sidebar-toggle" type="button" aria-label="Mở bộ lọc" aria-expanded="false">
        ${uiIcon("menu")}
      </button>
      <div class="brand">
        <span class="brand-mark">
          <img src="${import.meta.env.BASE_URL}icon.svg" alt="" />
        </span>
        <div class="brand-copy">
          <span class="brand-kicker">ACCELRA / WUWA</span>
          <strong>Wayfinder</strong>
        </div>
      </div>
      <div class="topbar-spacer"></div>
      <div class="top-progress" aria-live="polite">
        ${uiIcon("check")}
        <div>
          <span id="top-progress-count">0 / 0</span>
          <small>đã hoàn thành</small>
        </div>
      </div>
      <label class="profile-picker">
        ${uiIcon("user")}
        <div>
          <span>Hồ sơ</span>
          <select id="profile-select" aria-label="Chọn profile"></select>
        </div>
      </label>
      <button class="icon-button settings-button" id="settings-button" type="button" aria-label="Mở cài đặt">
        ${uiIcon("settings")}
      </button>
    </header>

    <aside class="sidebar" id="sidebar">
      <section class="map-intro">
        <div class="map-intro-heading">
          <div class="eyebrow">BẢN ĐỒ ĐANG DÙNG</div>
          <span class="live-badge"><i></i> LIVE DATA</span>
        </div>
        <h1 id="map-title"></h1>
        <p id="map-subtitle"></p>
        <div class="map-picker-grid">
          <label class="map-picker" id="map-picker" hidden>
            <span class="field-label">${uiIcon("map")} Khu vực</span>
            <select id="map-select" aria-label="Chọn khu vực"></select>
          </label>
          <label class="map-picker" id="floor-picker" hidden>
            <span class="field-label">${uiIcon("layers")} Tầng bản đồ</span>
            <select id="floor-select" aria-label="Chọn tầng bản đồ"></select>
          </label>
        </div>
        <div class="demo-notice" id="demo-notice">
          <span>DEMO</span>
          Dữ liệu giả lập, không phải dữ liệu trong game.
        </div>
      </section>

      <section class="progress-card">
        <div class="progress-card-row">
          <div class="progress-copy">
            <span class="progress-card-icon">${uiIcon("sparkles")}</span>
            <div>
              <span class="eyebrow">TIẾN TRÌNH</span>
              <strong id="progress-percentage">0%</strong>
            </div>
          </div>
          <span id="progress-fraction">0 / 0 điểm</span>
        </div>
        <div class="progress-track" aria-hidden="true">
          <div id="progress-bar"></div>
        </div>
      </section>

      <label class="search-box">
        ${uiIcon("search")}
        <input id="search-input" type="search" placeholder="Tìm tên hoặc ID..." autocomplete="off" />
      </label>

      <div class="section-heading category-heading">
        <span>${uiIcon("layers")} Bộ lọc điểm</span>
        <button id="toggle-all-categories" type="button">Chọn tất cả</button>
      </div>
      <div class="category-browser">
        <nav class="category-groups" id="category-groups" aria-label="Nhóm loại điểm"></nav>
        <section class="category-panel" aria-live="polite">
          <div class="category-panel-heading">
            <strong id="category-group-title">Loại điểm</strong>
            <span id="category-group-count">0 mục</span>
          </div>
          <div class="category-list" id="category-list"></div>
        </section>
      </div>

      <section class="selected-filters">
        <div class="selected-filters-heading">
          <span id="selected-category-count">Đang chọn 0 loại</span>
          <button id="reset-category-filters" type="button">↻ Mặc định</button>
        </div>
        <div class="selected-category-list" id="selected-category-list"></div>
      </section>

      <label class="toggle-row">
        <input id="hide-completed" type="checkbox" />
        <span class="toggle-control"></span>
        <span>
          <strong>Ẩn điểm đã nhặt</strong>
          <small>Giữ bản đồ gọn khi chạy route</small>
        </span>
      </label>

      <div class="sidebar-actions">
        <button class="secondary-button" id="fit-map" type="button">
          ${uiIcon("fit")} Căn toàn bản đồ
        </button>
        <button class="secondary-button" id="open-settings" type="button">
          ${uiIcon("database")} Dữ liệu & backup
        </button>
      </div>

      <footer class="sidebar-footer">
        <span class="accelra-signature">ACCELRA SYSTEM / PERSONAL BUILD</span>
        <p id="map-attribution"></p>
        <span class="sync-status" id="sync-status">Chỉ lưu trên thiết bị này.</span>
      </footer>
    </aside>
    <button class="sidebar-scrim" id="sidebar-scrim" type="button" aria-label="Đóng bộ lọc"></button>

    <main class="map-stage">
      <div class="mobile-map-controls" id="mobile-map-controls" hidden>
        <label class="mobile-map-picker" id="mobile-map-picker" hidden>
          <span>${uiIcon("map")} Khu vực</span>
          <select id="mobile-map-select" aria-label="Chọn khu vực nhanh"></select>
        </label>
        <label class="mobile-map-picker" id="mobile-floor-picker" hidden>
          <span>${uiIcon("layers")} Tầng</span>
          <select id="mobile-floor-select" aria-label="Chọn tầng nhanh"></select>
        </label>
      </div>
      <div id="map" aria-label="Bản đồ tương tác"></div>
      <div class="map-hud">
        ${uiIcon("signal")}
        <span id="visible-count">0 điểm đang hiển thị</span>
      </div>
      <div class="map-hint">${uiIcon("fit")} Kéo để di chuyển · Cuộn để phóng to</div>
    </main>
  </div>

  <dialog class="settings-dialog" id="settings-dialog">
    <form method="dialog" class="dialog-shell">
      <div class="dialog-header">
        <div>
          <span class="eyebrow">THIẾT LẬP THIẾT BỊ</span>
          <h2>Dữ liệu và profile</h2>
        </div>
        <button class="icon-button" value="cancel" aria-label="Đóng">
          ${uiIcon("close")}
        </button>
      </div>

      <section class="dialog-section">
        <h3>Hồ sơ hiện tại</h3>
        <p id="profile-mode-description">Hồ sơ đang lưu trên thiết bị này.</p>
        <div class="inline-form">
          <input id="profile-name-input" type="text" maxlength="40" aria-label="Tên profile" />
          <button id="rename-profile" class="primary-button" type="button">${uiIcon("check")} Lưu tên</button>
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
          <button id="export-backup" class="secondary-button" type="button">${uiIcon("download")} Export JSON</button>
          <button id="import-backup" class="secondary-button" type="button">${uiIcon("upload")} Import JSON</button>
        </div>
      </section>

      <section class="dialog-section">
        <h3>Gói bản đồ</h3>
        <p>Chỉ import dữ liệu và basemap mà bạn có quyền sử dụng.</p>
        <div class="button-grid">
          <button id="import-map-pack" class="secondary-button" type="button">${uiIcon("package")} Import gói bản đồ</button>
          <button id="use-demo-map" class="secondary-button" type="button">${uiIcon("map")} Dùng bản đồ demo</button>
        </div>
      </section>

      <div class="dialog-footer">
        <span id="storage-status">IndexedDB đang hoạt động</span>
        <button class="primary-button" value="cancel">${uiIcon("check")} Xong</button>
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
  sidebarScrim: mustQuery<HTMLButtonElement>("#sidebar-scrim"),
  settingsButton: mustQuery<HTMLButtonElement>("#settings-button"),
  openSettings: mustQuery<HTMLButtonElement>("#open-settings"),
  settingsDialog: mustQuery<HTMLDialogElement>("#settings-dialog"),
  mapTitle: mustQuery<HTMLElement>("#map-title"),
  mapSubtitle: mustQuery<HTMLElement>("#map-subtitle"),
  mapAttribution: mustQuery<HTMLElement>("#map-attribution"),
  mobileMapControls: mustQuery<HTMLElement>("#mobile-map-controls"),
  mobileMapPicker: mustQuery<HTMLElement>("#mobile-map-picker"),
  mobileMapSelect: mustQuery<HTMLSelectElement>("#mobile-map-select"),
  mobileFloorPicker: mustQuery<HTMLElement>("#mobile-floor-picker"),
  mobileFloorSelect: mustQuery<HTMLSelectElement>("#mobile-floor-select"),
  mapPicker: mustQuery<HTMLElement>("#map-picker"),
  mapSelect: mustQuery<HTMLSelectElement>("#map-select"),
  floorPicker: mustQuery<HTMLElement>("#floor-picker"),
  floorSelect: mustQuery<HTMLSelectElement>("#floor-select"),
  demoNotice: mustQuery<HTMLElement>("#demo-notice"),
  topProgressCount: mustQuery<HTMLElement>("#top-progress-count"),
  progressPercentage: mustQuery<HTMLElement>("#progress-percentage"),
  progressFraction: mustQuery<HTMLElement>("#progress-fraction"),
  progressBar: mustQuery<HTMLElement>("#progress-bar"),
  visibleCount: mustQuery<HTMLElement>("#visible-count"),
  searchInput: mustQuery<HTMLInputElement>("#search-input"),
  categoryGroups: mustQuery<HTMLElement>("#category-groups"),
  categoryGroupTitle: mustQuery<HTMLElement>("#category-group-title"),
  categoryGroupCount: mustQuery<HTMLElement>("#category-group-count"),
  categoryList: mustQuery<HTMLElement>("#category-list"),
  selectedCategoryCount: mustQuery<HTMLElement>("#selected-category-count"),
  selectedCategoryList: mustQuery<HTMLElement>("#selected-category-list"),
  resetCategoryFilters: mustQuery<HTMLButtonElement>("#reset-category-filters"),
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
const bundledMapCatalog = await loadBundledMapCatalog();
const bundledMapPack = bundledMapCatalog
  ? undefined
  : await loadBundledMapPack();
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
let mapPack = await resolveActiveMapPack(
  bundledMapCatalog,
  bundledMapPack,
);
let activeMapPack = resolveBasemapSources(mapPack);
const categoryGroups = resolveCategoryGroups(activeMapPack);
const categoryGroupById = new Map(
  categoryGroups.map((group) => [group.id, group]),
);
const categoryById = new Map(
  activeMapPack.categories.map((category) => [category.id, category]),
);
const markersByCategory = new Map<string, MapMarker[]>();
for (const marker of activeMapPack.markers) {
  const categoryMarkers = markersByCategory.get(marker.categoryId) ?? [];
  categoryMarkers.push(marker);
  markersByCategory.set(marker.categoryId, categoryMarkers);
}
let completedMarkerIds = new Set<string>();
let visibleCategoryIds = await resolveVisibleCategoryIds(activeMapPack);
let activeCategoryGroupId = resolveInitialCategoryGroupId();
const storedHideCompleted = await database.getSetting<unknown>("hideCompleted");
let hideCompleted =
  typeof storedHideCompleted === "boolean" ? storedHideCompleted : false;
let searchTerm = "";
const storedFloorId = await database.getSetting<unknown>(
  `activeFloor:${activeMapPack.id}`,
);
let activeFloorId =
  typeof storedFloorId === "string" &&
  activeMapPack.layers?.some((layer) => layer.id === storedFloorId)
    ? storedFloorId
    : "";
let map: LeafletMap;
let imageBounds: L.LatLngBounds;
let mapContentBounds: L.LatLngBounds;
let mapViewBounds: L.LatLngBounds;
let markerLayer: LayerGroup;
let floorTileLayer: TileLayer | undefined;
let markerReferences = new Map<string, Layer>();
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

async function loadBundledMapCatalog(): Promise<MapCatalog | undefined> {
  try {
    const catalogUrl = new URL(
      `${import.meta.env.BASE_URL}map-packs/private/catalog.json`,
      document.baseURI,
    );
    catalogUrl.searchParams.set("v", MAP_DATA_VERSION);
    const response = await fetch(
      catalogUrl,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return undefined;
    }
    return parseMapCatalog(await response.json());
  } catch {
    return undefined;
  }
}

async function loadMapPackResource(
  path: string,
): Promise<MapPack | undefined> {
  try {
    const packUrl = new URL(path, document.baseURI);
    packUrl.searchParams.set("v", MAP_DATA_VERSION);
    const response = await fetch(
      packUrl,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return undefined;
    }
    return parseMapPack(await response.json());
  } catch {
    return undefined;
  }
}

async function loadBundledMapPack(): Promise<MapPack | undefined> {
  return loadMapPackResource(
    `${import.meta.env.BASE_URL}map-packs/private/default-map-pack.json`,
  );
}

async function loadCatalogMapPack(
  catalog: MapCatalog,
  mapId: string,
): Promise<MapPack | undefined> {
  const entry = catalog.maps.find((candidate) => candidate.id === mapId);
  if (!entry) {
    return undefined;
  }
  const pack = await loadMapPackResource(entry.pack);
  return pack?.id === entry.id ? pack : undefined;
}

async function resolveActiveMapPack(
  catalog: MapCatalog | undefined,
  bundledPack: MapPack | undefined,
): Promise<MapPack> {
  const storedMapPackId = await database.getSetting<unknown>("activeMapPackId");
  const requestedMapPackId =
    typeof storedMapPackId === "string"
      ? storedMapPackId
      : catalog?.defaultMapId ?? bundledPack?.id ?? demoMapPack.id;
  const activeMapPackId =
    MAP_ID_ALIASES.get(requestedMapPackId) ?? requestedMapPackId;

  if (activeMapPackId === demoMapPack.id) {
    return demoMapPack;
  }
  if (catalog) {
    const catalogPack = await loadCatalogMapPack(catalog, activeMapPackId);
    if (catalogPack) {
      await database.putSetting("activeMapPackId", catalogPack.id);
      return catalogPack;
    }
  }
  if (bundledPack && activeMapPackId === bundledPack.id) {
    await database.putSetting("activeMapPackId", bundledPack.id);
    return bundledPack;
  }

  const storedMapPack = await database.getMapPack(activeMapPackId);
  if (storedMapPack) {
    return parseMapPack(storedMapPack);
  }

  if (catalog) {
    const defaultCatalogPack = await loadCatalogMapPack(
      catalog,
      catalog.defaultMapId,
    );
    if (defaultCatalogPack) {
      await database.putSetting("activeMapPackId", defaultCatalogPack.id);
      return defaultCatalogPack;
    }
  }

  const fallbackMapPack = bundledPack ?? demoMapPack;
  await database.putSetting("activeMapPackId", fallbackMapPack.id);
  return fallbackMapPack;
}

function resolveTileTemplate(source: string): string {
  const xToken = "__WAYFINDER_TILE_X__";
  const yToken = "__WAYFINDER_TILE_Y__";
  return new URL(
    source.replace("{x}", xToken).replace("{y}", yToken),
    document.baseURI,
  ).href
    .replace(xToken, "{x}")
    .replace(yToken, "{y}");
}

function resolveBasemapSources(pack: MapPack): MapPack {
  return {
    ...pack,
    image: pack.image
      ? {
          ...pack.image,
          src: new URL(pack.image.src, document.baseURI).href,
        }
      : undefined,
    tiles: pack.tiles
      ? {
          ...pack.tiles,
          src: resolveTileTemplate(pack.tiles.src),
        }
      : undefined,
    categories: pack.categories.map((category) => ({
      ...category,
      imageSrc: category.imageSrc
        ? new URL(category.imageSrc, document.baseURI).href
        : undefined,
    })),
    layers: pack.layers?.map((layer) => ({
      ...layer,
      tiles: {
        ...layer.tiles,
        src: resolveTileTemplate(layer.tiles.src),
      },
    })),
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
    const defaultCategoryIds =
      pack.defaultVisibleCategoryIds ?? [...validCategoryIds];
    return new Set(
      defaultCategoryIds.filter((id) => validCategoryIds.has(id)),
    );
  }

  const filtered = storedValue.filter((id) => validCategoryIds.has(id));
  return new Set(filtered);
}

function resolveCategoryGroups(pack: MapPack): MapCategoryGroup[] {
  const configuredGroups = pack.categoryGroups ?? [];
  const configuredGroupIds = new Set(
    configuredGroups.map((group) => group.id),
  );
  const usedGroupIds = new Set(
    pack.categories
      .map((category) => category.groupId)
      .filter((groupId): groupId is string => groupId !== undefined),
  );
  const groups = configuredGroups.filter((group) =>
    usedGroupIds.has(group.id),
  );
  const hasUngroupedCategories = pack.categories.some(
    (category) =>
      category.groupId === undefined ||
      !configuredGroupIds.has(category.groupId),
  );

  if (hasUngroupedCategories || groups.length === 0) {
    groups.push(FALLBACK_CATEGORY_GROUP);
  }
  return groups;
}

function categoryGroupId(category: MapCategory): string {
  return category.groupId && categoryGroupById.has(category.groupId)
    ? category.groupId
    : FALLBACK_CATEGORY_GROUP.id;
}

function resolveInitialCategoryGroupId(): string {
  const firstVisibleCategory = activeMapPack.categories.find((category) =>
    visibleCategoryIds.has(category.id),
  );
  return firstVisibleCategory
    ? categoryGroupId(firstVisibleCategory)
    : categoryGroups[0]?.id ?? FALLBACK_CATEGORY_GROUP.id;
}

function defaultVisibleCategoryIds(pack: MapPack): Set<string> {
  const validCategoryIds = new Set(
    pack.categories.map((category) => category.id),
  );
  return new Set(
    (pack.defaultVisibleCategoryIds ?? [...validCategoryIds]).filter((id) =>
      validCategoryIds.has(id),
    ),
  );
}

function progressMapId(pack: MapPack): string {
  return pack.progressMapId ?? pack.id;
}

async function reloadProgress(): Promise<void> {
  const records = await database.getProgress(
    activeProfileId,
    progressMapId(activeMapPack),
  );
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
  renderMapSelector();
  renderFloorSelector();
}

function renderMapSelector(): void {
  const options = bundledMapCatalog?.maps.map((entry) => ({
    id: entry.id,
    title: entry.title,
  })) ?? [];

  if (!options.some((option) => option.id === activeMapPack.id)) {
    options.push({
      id: activeMapPack.id,
      title: activeMapPack.title,
    });
  }
  if (!options.some((option) => option.id === demoMapPack.id)) {
    options.push({
      id: demoMapPack.id,
      title: "Bản đồ demo",
    });
  }

  for (const select of [elements.mapSelect, elements.mobileMapSelect]) {
    select.replaceChildren();
    for (const mapOption of options) {
      const option = document.createElement("option");
      option.value = mapOption.id;
      option.textContent = mapOption.title;
      option.selected = mapOption.id === activeMapPack.id;
      select.append(option);
    }
  }
  const pickerHidden = options.length <= 1;
  elements.mapPicker.hidden = pickerHidden;
  elements.mobileMapPicker.hidden = pickerHidden;
  updateMobileMapControlsVisibility();
}

function renderFloorSelector(): void {
  const layers = activeMapPack.layers ?? [];
  if (layers.length === 0) {
    elements.floorPicker.hidden = true;
    elements.mobileFloorPicker.hidden = true;
    elements.floorSelect.replaceChildren();
    elements.mobileFloorSelect.replaceChildren();
    updateMobileMapControlsVisibility();
    return;
  }

  for (const select of [elements.floorSelect, elements.mobileFloorSelect]) {
    populateFloorSelect(select, layers);
  }
  elements.floorPicker.hidden = false;
  elements.mobileFloorPicker.hidden = false;
  updateMobileMapControlsVisibility();
}

function populateFloorSelect(
  select: HTMLSelectElement,
  layers: MapFloorLayer[],
): void {
  select.replaceChildren();
  const allFloors = document.createElement("option");
  allFloors.value = "";
  allFloors.textContent = "Tất cả tầng";
  allFloors.selected = activeFloorId === "";
  select.append(allFloors);

  const layersByGroup = new Map<string, MapFloorLayer[]>();
  for (const layer of layers) {
    const groupLayers = layersByGroup.get(layer.groupId) ?? [];
    groupLayers.push(layer);
    layersByGroup.set(layer.groupId, groupLayers);
  }
  for (const groupLayers of layersByGroup.values()) {
    const group = document.createElement("optgroup");
    group.label = groupLayers[0]?.groupLabel ?? "Tầng bản đồ";
    for (const layer of groupLayers) {
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = layer.label;
      option.selected = layer.id === activeFloorId;
      group.append(option);
    }
    select.append(group);
  }
}

function updateMobileMapControlsVisibility(): void {
  elements.mobileMapControls.hidden =
    elements.mobileMapPicker.hidden && elements.mobileFloorPicker.hidden;
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
  elements.categoryGroups.replaceChildren();
  elements.categoryList.replaceChildren();
  elements.selectedCategoryList.replaceChildren();
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase("vi");
  const isSearching = normalizedSearchTerm.length > 0;

  for (const group of categoryGroups) {
    const groupCategories = activeMapPack.categories.filter(
      (category) => categoryGroupId(category) === group.id,
    );
    const selectedCount = groupCategories.filter((category) =>
      visibleCategoryIds.has(category.id),
    ).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      group.id === activeCategoryGroupId
        ? "category-group-button is-active"
        : "category-group-button";
    button.setAttribute(
      "aria-pressed",
      String(group.id === activeCategoryGroupId),
    );
    button.append(createFilterIcon(group.icon, "•"));

    const label = document.createElement("span");
    label.textContent = group.label;
    const count = document.createElement("small");
    count.textContent = `${selectedCount}/${groupCategories.length}`;
    button.append(label, count);
    button.addEventListener("click", () => {
      activeCategoryGroupId = group.id;
      if (searchTerm.length > 0) {
        searchTerm = "";
        elements.searchInput.value = "";
        renderMarkers();
      }
      renderCategories();
    });
    elements.categoryGroups.append(button);
  }

  const displayedCategories = activeMapPack.categories.filter((category) => {
    if (isSearching) {
      const categorySearchText =
        `${category.label} ${category.id}`.toLocaleLowerCase("vi");
      return categorySearchText.includes(normalizedSearchTerm);
    }
    return categoryGroupId(category) === activeCategoryGroupId;
  });

  const activeGroup = categoryGroupById.get(activeCategoryGroupId) ??
    FALLBACK_CATEGORY_GROUP;
  elements.categoryGroupTitle.textContent = isSearching
    ? "Kết quả tìm kiếm"
    : activeGroup.label;
  elements.categoryGroupCount.textContent = `${displayedCategories.length} mục`;

  if (displayedCategories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "category-empty";
    empty.textContent = isSearching
      ? "Không tìm thấy loại điểm phù hợp."
      : "Nhóm này chưa có điểm trong khu vực.";
    elements.categoryList.append(empty);
  }

  for (const category of displayedCategories) {
    const categoryMarkers = markersByCategory.get(category.id) ?? [];
    const categoryGroup = categoryGroupById.get(categoryGroupId(category)) ??
      FALLBACK_CATEGORY_GROUP;
    const completed = categoryMarkers.filter((marker) =>
      completedMarkerIds.has(marker.id),
    ).length;
    const isSelected = visibleCategoryIds.has(category.id);

    const card = document.createElement("button");
    card.type = "button";
    card.className = isSelected
      ? "category-card is-selected"
      : "category-card";
    card.style.setProperty("--category-color", category.color);
    card.setAttribute("aria-pressed", String(isSelected));
    card.title = `${category.label} · ${category.id}`;
    card.addEventListener("click", async () => {
      if (visibleCategoryIds.has(category.id)) {
        visibleCategoryIds.delete(category.id);
      } else {
        visibleCategoryIds.add(category.id);
      }
      await persistVisibleCategories();
      renderCategories();
      renderMarkers();
    });

    const swatch = document.createElement("span");
    swatch.className = "category-card-icon";
    swatch.style.setProperty("--category-color", category.color);
    if (category.imageSrc) {
      const image = document.createElement("img");
      image.src = category.imageSrc;
      image.alt = "";
      image.loading = "lazy";
      swatch.append(image);
    } else {
      swatch.append(
        createFilterIcon(
          category.icon ?? categoryGroup.icon,
          category.symbol,
        ),
      );
    }

    const text = document.createElement("span");
    text.className = "category-card-copy";
    const title = document.createElement("strong");
    title.textContent = category.label;
    const details = document.createElement("span");
    details.className = "category-card-details";
    const progress = document.createElement("small");
    progress.textContent = `${completed}/${categoryMarkers.length}`;
    const id = document.createElement("code");
    id.textContent = category.id;
    details.append(progress, id);
    text.append(title, details);

    const selectedIndicator = document.createElement("span");
    selectedIndicator.className = "category-selected-indicator";
    selectedIndicator.textContent = "✓";
    selectedIndicator.setAttribute("aria-hidden", "true");

    card.append(swatch, text, selectedIndicator);
    elements.categoryList.append(card);
  }

  const selectedCategories = activeMapPack.categories.filter((category) =>
    visibleCategoryIds.has(category.id),
  );
  elements.selectedCategoryCount.textContent =
    `Đang chọn ${selectedCategories.length} loại`;

  if (selectedCategories.length === 0) {
    const empty = document.createElement("span");
    empty.className = "selected-category-empty";
    empty.textContent = "Chưa chọn loại điểm nào.";
    elements.selectedCategoryList.append(empty);
  }

  for (const category of selectedCategories) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selected-category-chip";
    chip.style.setProperty("--category-color", category.color);
    chip.title = `Bỏ ${category.label}`;
    const label = document.createElement("span");
    label.textContent = category.label;
    const remove = document.createElement("span");
    remove.textContent = "×";
    remove.setAttribute("aria-hidden", "true");
    chip.append(label, remove);
    chip.addEventListener("click", async () => {
      visibleCategoryIds.delete(category.id);
      await persistVisibleCategories();
      renderCategories();
      renderMarkers();
    });
    elements.selectedCategoryList.append(chip);
  }

  elements.toggleAllCategories.textContent =
    visibleCategoryIds.size === activeMapPack.categories.length
      ? "Bỏ chọn tất cả"
      : "Chọn tất cả";
}

function initializeMap(): void {
  const dimensions = mapPackDimensions(activeMapPack);
  imageBounds = L.latLngBounds(
    [0, 0],
    [dimensions.height, dimensions.width],
  );
  const content = activeMapPack.bounds ?? {
    minX: 0,
    minY: 0,
    maxX: dimensions.width,
    maxY: dimensions.height,
  };
  mapContentBounds = L.latLngBounds(
    [dimensions.height - content.maxY, content.minX],
    [dimensions.height - content.minY, content.maxX],
  );
  const view = activeMapPack.initialView ?? {
    ...content,
  };
  mapViewBounds = L.latLngBounds(
    [dimensions.height - view.maxY, view.minX],
    [dimensions.height - view.minY, view.maxX],
  );

  map = L.map("map", {
    crs: L.CRS.Simple,
    preferCanvas: true,
    minZoom: -2,
    maxZoom: 2.5,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    attributionControl: false,
  });

  if (activeMapPack.image) {
    L.imageOverlay(activeMapPack.image.src, imageBounds, {
      className: "map-image",
    }).addTo(map);
  } else if (activeMapPack.tiles) {
    createTileLayer(activeMapPack.tiles, "map-image", 200).addTo(map);
  }
  updateFloorLayer();
  markerLayer = L.layerGroup().addTo(map);
  map.fitBounds(mapViewBounds, { animate: false });
  if (window.matchMedia("(max-width: 820px)").matches) {
    map.setZoom(Math.min(map.getZoom() + 0.75, map.getMaxZoom()), {
      animate: false,
    });
  }
  map.setMaxBounds(mapContentBounds.pad(0.18));
}

function createTileLayer(
  source: MapTileSource,
  className: string,
  zIndex: number,
): TileLayer {
  const tileLayer = L.tileLayer(source.src, {
    tileSize: source.tileSize,
    minNativeZoom: 0,
    maxNativeZoom: 0,
    minZoom: -2,
    maxZoom: 2.5,
    noWrap: true,
    bounds: mapContentBounds,
    keepBuffer: 2,
    updateWhenZooming: false,
    className,
    zIndex,
  });
  if (source.availableTiles) {
    const availableTiles = new Set(source.availableTiles);
    const originalGetTileUrl = tileLayer.getTileUrl.bind(tileLayer);
    tileLayer.getTileUrl = (coordinates) =>
      availableTiles.has(`${coordinates.x},${coordinates.y}`)
        ? originalGetTileUrl(coordinates)
        : TRANSPARENT_TILE;
  }
  return tileLayer;
}

function updateFloorLayer(): void {
  if (floorTileLayer) {
    map.removeLayer(floorTileLayer);
    floorTileLayer = undefined;
  }
  if (!activeFloorId) {
    return;
  }
  const floor = activeMapPack.layers?.find(
    (layer) => layer.id === activeFloorId,
  );
  if (floor) {
    floorTileLayer = createTileLayer(
      floor.tiles,
      "map-image floor-map-image",
      240,
    ).addTo(map);
  }
}

function markerLatLng(marker: MapMarker): L.LatLngExpression {
  const dimensions = mapPackDimensions(activeMapPack);
  return [dimensions.height - marker.y, marker.x];
}

function markerMatchesActiveFloor(marker: MapMarker): boolean {
  return activeFloorId === "" || marker.levelId === activeFloorId;
}

function renderMarkers(): void {
  markerLayer.clearLayers();
  markerReferences = new Map<string, Layer>();
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase("vi");
  const visibleMarkers = activeMapPack.markers.filter((marker) => {
    const isDone = completedMarkerIds.has(marker.id);
    const matchesCategory =
      normalizedSearchTerm.length > 0 ||
      visibleCategoryIds.has(marker.categoryId);
    const haystack =
      `${marker.title} ${marker.categoryId} ${marker.description ?? ""}`
        .toLocaleLowerCase("vi");
    const matchesSearch =
      normalizedSearchTerm.length === 0 || haystack.includes(normalizedSearchTerm);
    return (
      matchesCategory &&
      matchesSearch &&
      markerMatchesActiveFloor(marker) &&
      !(hideCompleted && isDone)
    );
  });
  const useDomIconMarkers = visibleMarkers.length <= MAX_DOM_ICON_MARKERS;

  for (const marker of visibleMarkers) {
    const category = findCategory(marker.categoryId);
    const isDone = completedMarkerIds.has(marker.id);
    const renderedMarker =
      useDomIconMarkers
        ? createDomIconMarker(marker, category, isDone)
        : createCanvasIconMarker(
            markerLatLng(marker),
            {
              radius: isDone ? 8 : 10,
              color: isDone ? "#d9fff6" : "#f7fffc",
              weight: isDone ? 1 : 2,
              fillColor: category.color,
              fillOpacity: isDone ? 0.28 : 0.94,
              opacity: isDone ? 0.48 : 1,
              className: isDone
                ? "progress-marker is-done"
                : "progress-marker",
            },
            category.imageSrc,
            category.symbol,
            isDone,
          );

    const tooltipContent = document.createElement("span");
    tooltipContent.textContent = marker.title;
    renderedMarker.bindTooltip(tooltipContent, {
      direction: "top",
      offset: [0, useDomIconMarkers ? -4 : -8],
      opacity: 0.95,
    });
    renderedMarker.bindPopup(createMarkerPopup(marker, category, isDone), {
      className: "marker-popup",
      minWidth: 230,
      closeButton: true,
    });
    renderedMarker.addTo(markerLayer);
    markerReferences.set(marker.id, renderedMarker);
  }

  elements.visibleCount.textContent = `${visibleMarkers.length} điểm đang hiển thị`;
  updateProgressDisplay();
}

function createDomIconMarker(
  marker: MapMarker,
  category: MapCategory,
  isDone: boolean,
): Marker {
  const wrapper = document.createElement("span");
  wrapper.className = isDone
    ? "map-marker-icon is-done"
    : "map-marker-icon";
  wrapper.style.setProperty("--category-color", category.color);

  const frame = document.createElement("span");
  frame.className = "map-marker-frame";
  const categoryGroup = categoryGroupById.get(categoryGroupId(category)) ??
    FALLBACK_CATEGORY_GROUP;
  const fallbackIcon = () =>
    createFilterIcon(
      category.icon ?? categoryGroup.icon,
      category.symbol,
    );

  if (category.imageSrc) {
    const image = document.createElement("img");
    image.src = category.imageSrc;
    image.alt = "";
    image.addEventListener(
      "error",
      () => frame.replaceChildren(fallbackIcon()),
      { once: true },
    );
    frame.append(image);
  } else {
    frame.append(fallbackIcon());
  }
  wrapper.append(frame);

  if (isDone) {
    const check = document.createElement("span");
    check.className = "map-marker-check";
    check.textContent = "✓";
    wrapper.append(check);
  }

  return L.marker(markerLatLng(marker), {
    icon: L.divIcon({
      className: "progress-icon-marker",
      html: wrapper,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -17],
      tooltipAnchor: [0, -16],
    }),
    opacity: isDone ? 0.52 : 1,
    riseOnHover: true,
  });
}

function findCategory(categoryId: string): MapCategory {
  const category = categoryById.get(categoryId);
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
  const mapId = progressMapId(activeMapPack);
  await database.putProgress({
    id: progressRecordId(activeProfileId, mapId, markerId),
    profileId: activeProfileId,
    mapId,
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
    const mapId = progressMapId(activeMapPack);
    const localRecords = await database.getProgress(
      activeProfileId,
      mapId,
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
          await database.getProgress(activeProfileId, mapId)
        ).map((record) => [record.id, record]),
      );

      for (const record of canonical) {
        const current = latestLocal.get(record.id);
        if (current?.updatedAt === submittedVersions.get(record.id)) {
          await database.putProgress({ ...record, pendingSync: false });
        }
      }
    }

    const remoteRecords = await syncClient.pullProgress(mapId);
    const currentLocal = new Map(
      (
        await database.getProgress(activeProfileId, mapId)
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
      await database.getProgress(
        activeProfileId,
        progressMapId(activeMapPack),
      )
    ).some((record) => record.pendingSync !== false);
    if (syncSucceeded && remaining && remoteSession) {
      window.setTimeout(() => void syncRemoteProgress(), 600);
    }
  }
}

function setSidebarOpen(open: boolean): void {
  elements.sidebar.classList.toggle("is-open", open);
  elements.sidebarToggle.setAttribute("aria-expanded", String(open));
}

function bindEvents(): void {
  window.addEventListener("online", () => {
    void syncRemoteProgress();
  });

  elements.sidebarToggle.addEventListener("click", () => {
    setSidebarOpen(!elements.sidebar.classList.contains("is-open"));
  });
  elements.sidebarScrim.addEventListener("click", () => {
    setSidebarOpen(false);
  });

  for (const button of [
    elements.settingsButton,
    elements.openSettings,
  ]) {
    button.addEventListener("click", () => {
      setSidebarOpen(false);
      elements.settingsDialog.showModal();
    });
  }

  elements.searchInput.addEventListener("input", () => {
    searchTerm = elements.searchInput.value;
    renderCategories();
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

  elements.resetCategoryFilters.addEventListener("click", async () => {
    visibleCategoryIds = defaultVisibleCategoryIds(activeMapPack);
    searchTerm = "";
    elements.searchInput.value = "";
    activeCategoryGroupId = resolveInitialCategoryGroupId();
    await persistVisibleCategories();
    renderCategories();
    renderMarkers();
    showToast("Đã đặt lại bộ lọc mặc định.");
  });

  elements.fitMap.addEventListener("click", () => {
    map.fitBounds(mapViewBounds);
    setSidebarOpen(false);
  });

  for (const select of [elements.mapSelect, elements.mobileMapSelect]) {
    select.addEventListener("change", async () => {
      await database.putSetting("activeMapPackId", select.value);
      window.location.reload();
    });
  }

  const changeFloor = async (value: string): Promise<void> => {
    activeFloorId = value;
    elements.floorSelect.value = value;
    elements.mobileFloorSelect.value = value;
    await database.putSetting(
      `activeFloor:${activeMapPack.id}`,
      activeFloorId,
    );
    updateFloorLayer();
    renderMarkers();
    const floorLabel = activeFloorId
      ? activeMapPack.layers?.find((layer) => layer.id === activeFloorId)
          ?.label
      : "Tất cả tầng";
    setSidebarOpen(false);
    showToast(`Đã chuyển sang ${floorLabel ?? "tầng bản đồ"}.`);
  };

  for (const select of [elements.floorSelect, elements.mobileFloorSelect]) {
    select.addEventListener("change", () => {
      void changeFloor(select.value);
    });
  }

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
