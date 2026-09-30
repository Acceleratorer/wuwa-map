import L, {
  type ImageOverlay,
  type LayerGroup,
  type Map as LeafletMap,
  type Marker,
  type TileLayer,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import demoMapPackJson from "./data/demo-map-pack.json";
import { createBackupFilename } from "./backup-filename";
import { createCanvasIconMarker } from "./canvas-marker-icons";
import { createFilterIcon } from "./filter-icons";
import { uiIcon } from "./ui-icons";
import {
  mapPackDimensions,
  parseBackup,
  parseMapCatalog,
  parseMapPack,
} from "./map-pack";
import { resolveRequestedMapPackId } from "./map-selection";
import { summarizeProgressForCategories } from "./progress";
import { LocalDatabase, progressRecordId } from "./storage";
import { SyncApiError, SyncClient, type RemoteSession } from "./sync";
import { buildMarkerSearchIndex, normalizeSearchText } from "./marker-search";
import { filterVisibleMarkers } from "./marker-visibility";
import type {
  MapCatalog,
  MapCatalogEntry,
  MapCatalogGroup,
  MapCatalogSection,
  MapArea,
  MapCategory,
  MapCategoryGroup,
  MapFloorLayer,
  MapMarker,
  MapPack,
  MapTileSource,
  MapViewBounds,
  Profile,
  ProgressRecord,
} from "./types";

const FALLBACK_CATEGORY_GROUP: MapCategoryGroup = {
  id: "__other__",
  label: "Khác",
  icon: "default",
};
const TRANSPARENT_TILE =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const MAX_DOM_ICON_MARKERS = 2500;
const MAP_DATA_VERSION = "route-switcher-v12";
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
      <section class="loot-console-heading">
        <div class="loot-console-title">
          <span class="eyebrow">ROUTE FILTER</span>
          <span class="live-badge"><i></i> LIVE DATA</span>
        </div>
        <h1>Vật phẩm & điểm loot</h1>
        <p>Chọn đúng item cần chạy; bản đồ và khu vực được đổi bằng nút nổi bên dưới.</p>
      </section>

      <label class="search-box">
        ${uiIcon("search")}
        <input
          id="search-input"
          type="search"
          aria-label="Tìm điểm theo tên hoặc ID"
          placeholder="Tìm tên hoặc ID..."
          autocomplete="off"
        />
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
      <div id="map" aria-label="Bản đồ tương tác"></div>
      <section class="route-overview" aria-live="polite">
        <span class="route-realm" id="route-realm-title">Bản đồ</span>
        <h1 id="map-title"></h1>
        <p id="map-subtitle"></p>
        <div class="route-progress-row">
          <div>
            <strong id="progress-percentage">0%</strong>
            <span id="progress-fraction">0 / 0 điểm</span>
          </div>
          <span class="route-area-name" id="route-area-name">Toàn khu vực</span>
        </div>
        <div
          class="progress-track"
          id="progress-track"
          role="progressbar"
          aria-label="Tiến trình khu vực đang chọn"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
        >
          <div id="progress-bar"></div>
        </div>
        <div class="demo-notice" id="demo-notice">
          <span>DEMO</span>
          Dữ liệu giả lập.
        </div>
      </section>
      <div class="map-hud">
        ${uiIcon("signal")}
        <span id="visible-count">0 điểm đang hiển thị</span>
      </div>
      <button class="map-switch-trigger" id="map-switch-trigger" type="button" aria-haspopup="dialog">
        ${uiIcon("map")}
        <span>Chuyển bản đồ</span>
        ${uiIcon("switch")}
      </button>
      <div class="map-hint">${uiIcon("fit")} Kéo để di chuyển · Cuộn để phóng to</div>
    </main>
  </div>

  <dialog class="map-switch-dialog" id="map-switch-dialog">
    <form method="dialog" class="map-switch-shell">
      <header class="map-switch-header">
        <div>
          <span class="eyebrow">WAYFINDER ROUTE NETWORK</span>
          <h2>Chuyển bản đồ</h2>
        </div>
        <button class="icon-button" value="cancel" aria-label="Đóng bộ chọn bản đồ">
          ${uiIcon("close")}
        </button>
      </header>
      <div class="map-switch-grid">
        <nav class="map-realm-list" id="map-realm-list" aria-label="Đại vùng và cụm bản đồ"></nav>
        <section class="map-switch-column">
          <header>
            <span class="eyebrow">KHU VỰC</span>
            <strong id="map-realm-heading">Bản đồ</strong>
          </header>
          <div class="map-atlas-list" id="map-atlas-list"></div>
        </section>
        <section class="map-switch-column">
          <header>
            <span class="eyebrow">KHU CHẠY MAP</span>
            <strong id="map-area-heading">Toàn khu vực</strong>
          </header>
          <div class="map-area-list" id="map-area-list"></div>
          <label class="switch-floor-picker" id="floor-picker" hidden>
            <span>${uiIcon("layers")} Tầng bản đồ</span>
            <select id="floor-select" aria-label="Chọn tầng bản đồ"></select>
          </label>
        </section>
      </div>
      <footer class="map-switch-footer">
        <span id="map-switch-selection">Chọn atlas và khu vực muốn chạy.</span>
        <div>
          <button class="secondary-button" value="cancel">Hủy</button>
          <button class="primary-button" id="confirm-map-switch" type="button">
            ${uiIcon("map")} <span id="confirm-map-switch-label">Mở khu vực</span>
          </button>
        </div>
      </footer>
    </form>
  </dialog>

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
  mapSwitchTrigger: mustQuery<HTMLButtonElement>("#map-switch-trigger"),
  mapSwitchDialog: mustQuery<HTMLDialogElement>("#map-switch-dialog"),
  mapRealmList: mustQuery<HTMLElement>("#map-realm-list"),
  mapRealmHeading: mustQuery<HTMLElement>("#map-realm-heading"),
  mapAtlasList: mustQuery<HTMLElement>("#map-atlas-list"),
  mapAreaHeading: mustQuery<HTMLElement>("#map-area-heading"),
  mapAreaList: mustQuery<HTMLElement>("#map-area-list"),
  mapSwitchSelection: mustQuery<HTMLElement>("#map-switch-selection"),
  confirmMapSwitch: mustQuery<HTMLButtonElement>("#confirm-map-switch"),
  confirmMapSwitchLabel: mustQuery<HTMLElement>("#confirm-map-switch-label"),
  mapTitle: mustQuery<HTMLElement>("#map-title"),
  mapSubtitle: mustQuery<HTMLElement>("#map-subtitle"),
  routeRealmTitle: mustQuery<HTMLElement>("#route-realm-title"),
  routeAreaName: mustQuery<HTMLElement>("#route-area-name"),
  mapAttribution: mustQuery<HTMLElement>("#map-attribution"),
  floorPicker: mustQuery<HTMLElement>("#floor-picker"),
  floorSelect: mustQuery<HTMLSelectElement>("#floor-select"),
  demoNotice: mustQuery<HTMLElement>("#demo-notice"),
  topProgressCount: mustQuery<HTMLElement>("#top-progress-count"),
  progressPercentage: mustQuery<HTMLElement>("#progress-percentage"),
  progressFraction: mustQuery<HTMLElement>("#progress-fraction"),
  progressTrack: mustQuery<HTMLElement>("#progress-track"),
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

const demoMapPack = parseMapPack(demoMapPackJson);
const syncClient = new SyncClient();
let initialSyncMessage: string | undefined;
const remoteSessionPromise = bootstrapRemoteSession();
const [database, bundledMapCatalog] = await Promise.all([
  LocalDatabase.open(),
  loadBundledMapCatalog(),
]);
const bundledMapPack = bundledMapCatalog
  ? undefined
  : await loadBundledMapPack();
const [initialRemoteSession, initialProfiles, mapPack] = await Promise.all([
  remoteSessionPromise,
  ensureProfiles(),
  resolveActiveMapPack(bundledMapCatalog, bundledMapPack),
]);
let remoteSession = initialRemoteSession;
let profiles = initialProfiles;
if (remoteSession) {
  await database.putProfile(remoteSession.profile);
  profiles = await database.getAllProfiles();
}
let activeProfileId = remoteSession?.profile.id ??
  (await resolveActiveProfileId(profiles));
let activeMapPack = resolveBasemapSources(mapPack);
let activeMapDimensions = mapPackDimensions(activeMapPack);
let categoryGroups = resolveCategoryGroups(activeMapPack);
let categoryGroupById = new Map(
  categoryGroups.map((group) => [group.id, group]),
);
let categoryById = new Map(
  activeMapPack.categories.map((category) => [category.id, category]),
);
let markerSearchIndex: Map<string, string> | undefined;
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
const storedAreaId = await database.getSetting<unknown>(
  `activeArea:${activeMapPack.id}`,
);
let activeAreaId =
  typeof storedAreaId === "string" &&
  activeMapPack.areas?.some((area) => area.id === storedAreaId)
    ? storedAreaId
    : "";
let switchGroupId = catalogGroupForMap(activeMapPack.id)?.id ?? "";
let switchMapId = activeMapPack.id;
let switchSectionId = catalogSectionForMap(activeMapPack.id)?.id ?? "";
let switchAreaId = activeAreaId;
let map: LeafletMap;
let imageBounds: L.LatLngBounds;
let mapContentBounds: L.LatLngBounds;
let mapViewBounds: L.LatLngBounds;
let markerLayer: LayerGroup;
let floorTileLayer: TileLayer | undefined;
let floorScrimLayer: ImageOverlay;
let toastTimer: number | undefined;
let markerRenderTimer: number | undefined;
let syncInFlight = false;
let mapSwitchInFlight = false;
const areaMarkerIdSets = new WeakMap<MapArea, ReadonlySet<string>>();

await reloadProgress();
renderStaticMapDetails();
renderProfiles();
renderCategories();
initializeMap();
renderMarkers();
bindEvents();
setSidebarOpen(false);
renderSyncState(
  remoteSession ? "Đang kết nối..." : "Chỉ lưu trên thiết bị này",
);
if (initialSyncMessage) {
  showToast(initialSyncMessage, remoteSession ? "success" : "error");
}
void syncRemoteProgress();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const registerServiceWorker = () => {
    navigator.serviceWorker
      .register(
        `${import.meta.env.BASE_URL}sw.js?v=${MAP_DATA_VERSION}`,
        {
          scope: import.meta.env.BASE_URL,
        },
      )
      .catch(() => {
        showToast("Không thể bật chế độ offline.", "error");
      });
  };
  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker, { once: true });
  }
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
    const response = await fetch(catalogUrl, { cache: "no-store" });
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
    const response = await fetch(packUrl, { cache: "no-store" });
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
  const requestedMapPackId = resolveRequestedMapPackId({
    storedMapPackId,
    catalogDefaultMapId: catalog?.defaultMapId,
    bundledMapPackId: bundledPack?.id,
    demoMapPackId: demoMapPack.id,
  });
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
  const resolved = new URL(
    source.replace("{x}", xToken).replace("{y}", yToken),
    document.baseURI,
  ).href
    .replace(xToken, "{x}")
    .replace(yToken, "{y}");
  return `${resolved}${resolved.includes("?") ? "&" : "?"}v=${MAP_DATA_VERSION}`;
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

function availableMapEntries(): MapCatalogEntry[] {
  const entries = [...(bundledMapCatalog?.maps ?? [])];
  if (!entries.some((entry) => entry.id === activeMapPack.id)) {
    entries.push({
      id: activeMapPack.id,
      title: activeMapPack.title,
      pack: "",
      areas: activeMapPack.areas,
    });
  }
  return entries;
}

function availableMapGroups(): MapCatalogGroup[] {
  const entries = availableMapEntries();
  const availableIds = new Set(entries.map((entry) => entry.id));
  const configured: MapCatalogGroup[] = (bundledMapCatalog?.groups ?? [])
    .map((group) => ({
      ...group,
      mapIds: group.mapIds.filter((mapId) => availableIds.has(mapId)),
      sections: group.sections
        ?.map((section) => ({
          ...section,
          mapIds: section.mapIds.filter((mapId) => availableIds.has(mapId)),
        }))
        .filter((section) => section.mapIds.length > 0),
    }))
    .filter((group) => group.mapIds.length > 0);
  const configuredIds = new Set(
    configured.flatMap((group) => group.mapIds),
  );
  const ungrouped = entries
    .map((entry) => entry.id)
    .filter((mapId) => !configuredIds.has(mapId));
  if (ungrouped.length > 0) {
    configured.push({
      id: "__other_maps__",
      title: "Bản đồ khác",
      mapIds: ungrouped,
    });
  }
  return configured.length > 0
    ? configured
    : [{
        id: "__all_maps__",
        title: "Tất cả bản đồ",
        mapIds: entries.map((entry) => entry.id),
      }];
}

function catalogGroupForMap(mapId: string): MapCatalogGroup | undefined {
  return availableMapGroups().find((group) => group.mapIds.includes(mapId));
}

function catalogSectionForMap(
  mapId: string,
  group = catalogGroupForMap(mapId),
): MapCatalogSection | undefined {
  return group?.sections?.find((section) => section.mapIds.includes(mapId));
}

function catalogSectionsForGroup(
  group: MapCatalogGroup | undefined,
): MapCatalogSection[] {
  return group?.sections ?? [];
}

function activeArea(): MapArea | undefined {
  return activeMapPack.areas?.find((area) => area.id === activeAreaId);
}

function markerMatchesArea(marker: MapMarker, area: MapArea | undefined): boolean {
  if (area?.markerIds !== undefined) {
    let markerIds = areaMarkerIdSets.get(area);
    if (!markerIds) {
      markerIds = new Set(area.markerIds);
      areaMarkerIdSets.set(area, markerIds);
    }
    return markerIds.has(marker.id);
  }

  return (
    area === undefined ||
    (
      marker.x >= area.bounds.minX &&
      marker.x <= area.bounds.maxX &&
      marker.y >= area.bounds.minY &&
      marker.y <= area.bounds.maxY
    )
  );
}

function markerMatchesActiveArea(marker: MapMarker): boolean {
  return markerMatchesArea(marker, activeArea());
}

function activeRouteMarkers(): MapMarker[] {
  return activeMapPack.markers.filter(markerMatchesActiveArea);
}

function routeBounds(bounds: MapViewBounds): L.LatLngBounds {
  return L.latLngBounds(
    [activeMapDimensions.height - bounds.maxY, bounds.minX],
    [activeMapDimensions.height - bounds.minY, bounds.maxX],
  );
}

function activeRouteBounds(): L.LatLngBounds {
  const area = activeArea();
  return area ? routeBounds(area.bounds) : mapViewBounds;
}

function updateRouteDetails(): void {
  const group = catalogGroupForMap(activeMapPack.id);
  const area = activeArea();
  elements.routeRealmTitle.textContent = group?.title ?? "Bản đồ cá nhân";
  elements.mapTitle.textContent = activeMapPack.title;
  elements.mapSubtitle.textContent =
    activeMapPack.subtitle ?? "Bản đồ không có mô tả.";
  elements.routeAreaName.textContent = area?.label ?? "Toàn khu vực";
}

function renderStaticMapDetails(): void {
  updateRouteDetails();
  elements.mapAttribution.textContent = activeMapPack.attribution;
  elements.demoNotice.hidden = activeMapPack.id !== demoMapPack.id;
  elements.hideCompleted.checked = hideCompleted;
  renderFloorSelector();
  renderMapSwitcher();
}

function renderFloorSelector(): void {
  const layers = activeMapPack.layers ?? [];
  if (layers.length === 0) {
    elements.floorPicker.hidden = true;
    elements.floorSelect.replaceChildren();
    return;
  }

  populateFloorSelect(elements.floorSelect, layers);
  elements.floorPicker.hidden = false;
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

function renderMapSwitcher(): void {
  const groups = availableMapGroups();
  const entries = availableMapEntries();
  let selectedGroup = groups.find((group) => group.id === switchGroupId);
  if (!selectedGroup || !selectedGroup.mapIds.includes(switchMapId)) {
    selectedGroup =
      groups.find((group) => group.mapIds.includes(switchMapId)) ??
      groups[0];
    switchGroupId = selectedGroup?.id ?? "";
  }
  const sections = catalogSectionsForGroup(selectedGroup);
  let selectedSection = sections.find(
    (section) =>
      section.id === switchSectionId &&
      section.mapIds.includes(switchMapId),
  );
  if (!selectedSection) {
    selectedSection =
      sections.find((section) => section.mapIds.includes(switchMapId)) ??
      sections[0];
    switchSectionId = selectedSection?.id ?? "";
  }
  if (selectedSection && !selectedSection.mapIds.includes(switchMapId)) {
    switchMapId = selectedSection.mapIds[0] ?? activeMapPack.id;
    switchAreaId = "";
  } else if (
    selectedGroup &&
    !selectedGroup.mapIds.includes(switchMapId)
  ) {
    switchSectionId = sections[0]?.id ?? "";
    switchMapId =
      sections[0]?.mapIds[0] ??
      selectedGroup.mapIds[0] ??
      activeMapPack.id;
    switchAreaId = "";
  }

  elements.mapRealmList.replaceChildren();
  for (const group of groups) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      group.id === switchGroupId
        ? "map-realm-option is-active"
        : "map-realm-option";
    button.setAttribute("aria-pressed", String(group.id === switchGroupId));
    const title = document.createElement("strong");
    title.textContent = group.title;
    const count = document.createElement("span");
    count.textContent = group.sections?.length
      ? `${group.sections.length} cụm · ${group.mapIds.length} map`
      : `${group.mapIds.length} map`;
    button.append(title, count);
    button.addEventListener("click", () => {
      switchGroupId = group.id;
      const firstSection = group.sections?.[0];
      switchSectionId = firstSection?.id ?? "";
      if (!group.mapIds.includes(switchMapId)) {
        switchMapId =
          firstSection?.mapIds[0] ??
          group.mapIds[0] ??
          activeMapPack.id;
      }
      switchAreaId = "";
      renderMapSwitcher();
    });
    elements.mapRealmList.append(button);

    if (group.id === switchGroupId && (group.sections?.length ?? 0) > 1) {
      const sectionList = document.createElement("div");
      sectionList.className = "map-state-list";
      sectionList.setAttribute("aria-label", `Cụm bản đồ ${group.title}`);
      for (const section of group.sections ?? []) {
        const sectionButton = document.createElement("button");
        sectionButton.type = "button";
        sectionButton.className =
          section.id === switchSectionId
            ? "map-state-option is-active"
            : "map-state-option";
        sectionButton.setAttribute(
          "aria-pressed",
          String(section.id === switchSectionId),
        );
        const sectionTitle = document.createElement("strong");
        sectionTitle.textContent = section.title;
        const sectionCount = document.createElement("span");
        sectionCount.textContent = `${section.mapIds.length}`;
        sectionButton.append(sectionTitle, sectionCount);
        sectionButton.addEventListener("click", () => {
          switchGroupId = group.id;
          switchSectionId = section.id;
          if (!section.mapIds.includes(switchMapId)) {
            switchMapId = section.mapIds[0] ?? activeMapPack.id;
            switchAreaId = "";
          }
          renderMapSwitcher();
        });
        sectionList.append(sectionButton);
      }
      elements.mapRealmList.append(sectionList);
    }
  }

  elements.mapRealmHeading.textContent =
    selectedSection?.title ?? selectedGroup?.title ?? "Bản đồ";
  elements.mapAtlasList.replaceChildren();
  const selectedMapIds = selectedSection?.mapIds ?? selectedGroup?.mapIds ?? [];
  const atlasEntries = selectedMapIds
    .map((mapId) => entries.find((entry) => entry.id === mapId))
    .filter((entry): entry is MapCatalogEntry => entry !== undefined);
  for (const entry of atlasEntries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      entry.id === switchMapId
        ? "map-atlas-option is-active"
        : "map-atlas-option";
    button.setAttribute("aria-pressed", String(entry.id === switchMapId));
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const meta = document.createElement("span");
    const areaCount = entry.areas?.length ?? 0;
    meta.textContent =
      entry.id === activeMapPack.id
        ? "Đang mở"
        : areaCount > 0
          ? `${areaCount} khu`
          : "Mở atlas";
    button.append(title, meta);
    button.addEventListener("click", () => {
      switchMapId = entry.id;
      switchSectionId =
        catalogSectionForMap(entry.id, selectedGroup)?.id ?? "";
      switchAreaId =
        entry.id === activeMapPack.id ? activeAreaId : "";
      renderMapSwitcher();
    });
    elements.mapAtlasList.append(button);
  }

  const selectedEntry = entries.find((entry) => entry.id === switchMapId);
  const areas =
    selectedEntry?.areas ??
    (switchMapId === activeMapPack.id ? activeMapPack.areas : undefined) ??
    [];
  const wholeMapArea = areas.find((area) => area.id === "whole-map");
  if (wholeMapArea && switchAreaId === "") {
    switchAreaId = wholeMapArea.id;
  }
  elements.mapAreaHeading.textContent =
    selectedEntry?.title ?? activeMapPack.title;
  elements.mapAreaList.replaceChildren();
  const allAreas: Array<{ id: string; label: string }> = wholeMapArea
    ? areas.map((area) => ({ id: area.id, label: area.label }))
    : [
        { id: "", label: "Toàn khu vực" },
        ...areas.map((area) => ({ id: area.id, label: area.label })),
      ];
  for (const area of allAreas) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      area.id === switchAreaId
        ? "map-area-option is-active"
        : "map-area-option";
    button.setAttribute("aria-pressed", String(area.id === switchAreaId));
    button.textContent = area.label;
    button.addEventListener("click", () => {
      switchAreaId = area.id;
      renderMapSwitcher();
    });
    elements.mapAreaList.append(button);
  }

  elements.floorPicker.hidden =
    switchMapId !== activeMapPack.id ||
    (activeMapPack.layers?.length ?? 0) === 0;
  const selectedAreaLabel =
    areas.find((area) => area.id === switchAreaId)?.label ?? "Toàn khu vực";
  const selectionParts = [
    selectedGroup?.title,
    selectedSection?.title,
    selectedEntry?.title ?? activeMapPack.title,
    selectedAreaLabel,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  elements.mapSwitchSelection.textContent =
    selectionParts.join(" · ");
}

function updateFallbackDialogState(): void {
  document.body.classList.toggle(
    "dialog-fallback-open",
    Boolean(document.querySelector("dialog.is-fallback-open[open]")),
  );
}

function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) {
    return;
  }
  if (typeof dialog.showModal === "function") {
    dialog.classList.remove("is-fallback-open");
    dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "");
  dialog.classList.add("is-fallback-open");
  updateFallbackDialogState();
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
  dialog.classList.remove("is-fallback-open");
  updateFallbackDialogState();
}

function openMapSwitcher(): void {
  switchMapId = activeMapPack.id;
  switchSectionId = catalogSectionForMap(activeMapPack.id)?.id ?? "";
  switchAreaId = activeAreaId;
  switchGroupId = catalogGroupForMap(activeMapPack.id)?.id ??
    availableMapGroups()[0]?.id ??
    "";
  renderMapSwitcher();
  setSidebarOpen(false);
  openDialog(elements.mapSwitchDialog);
}

async function applyActiveArea(areaId: string): Promise<void> {
  activeAreaId =
    activeMapPack.areas?.some((area) => area.id === areaId)
      ? areaId
      : "";
  await database.putSetting(
    `activeArea:${activeMapPack.id}`,
    activeAreaId,
  );
  updateRouteDetails();
  updateProgressDisplay();
  map.fitBounds(activeRouteBounds(), {
    animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    padding: [24, 24],
  });
}

async function activateMapPack(
  mapPack: MapPack,
  requestedAreaId: string | undefined,
): Promise<void> {
  const nextMapPack = resolveBasemapSources(mapPack);
  const [
    nextVisibleCategoryIds,
    storedFloorId,
    storedAreaId,
    progressRecords,
  ] = await Promise.all([
    resolveVisibleCategoryIds(nextMapPack),
    database.getSetting<unknown>(`activeFloor:${nextMapPack.id}`),
    database.getSetting<unknown>(`activeArea:${nextMapPack.id}`),
    database.getProgress(activeProfileId, progressMapId(nextMapPack)),
  ]);
  const nextFloorId =
    typeof storedFloorId === "string" &&
      nextMapPack.layers?.some((layer) => layer.id === storedFloorId)
      ? storedFloorId
      : "";
  const areaCandidate =
    requestedAreaId ??
    (typeof storedAreaId === "string" ? storedAreaId : "");
  const nextAreaId =
    areaCandidate &&
      nextMapPack.areas?.some((area) => area.id === areaCandidate)
      ? areaCandidate
      : "";

  window.clearTimeout(markerRenderTimer);
  markerRenderTimer = undefined;
  map.remove();

  activeMapPack = nextMapPack;
  activeMapDimensions = mapPackDimensions(activeMapPack);
  categoryGroups = resolveCategoryGroups(activeMapPack);
  categoryGroupById = new Map(
    categoryGroups.map((group) => [group.id, group]),
  );
  categoryById = new Map(
    activeMapPack.categories.map((category) => [category.id, category]),
  );
  markerSearchIndex = undefined;
  completedMarkerIds = new Set(
    progressRecords
      .filter((record) => record.done)
      .map((record) => record.markerId),
  );
  visibleCategoryIds = nextVisibleCategoryIds;
  activeCategoryGroupId = resolveInitialCategoryGroupId();
  activeFloorId = nextFloorId;
  activeAreaId = nextAreaId;
  searchTerm = "";
  elements.searchInput.value = "";
  switchGroupId = catalogGroupForMap(activeMapPack.id)?.id ?? "";
  switchMapId = activeMapPack.id;
  switchSectionId = catalogSectionForMap(activeMapPack.id)?.id ?? "";
  switchAreaId = activeAreaId;

  renderStaticMapDetails();
  renderCategories();
  initializeMap();
  renderMarkers();
  setSidebarOpen(false);
}

async function confirmMapSwitch(): Promise<void> {
  if (mapSwitchInFlight) {
    return;
  }

  mapSwitchInFlight = true;
  elements.confirmMapSwitch.disabled = true;
  elements.confirmMapSwitch.setAttribute("aria-busy", "true");
  elements.confirmMapSwitchLabel.textContent = "Đang tải...";
  try {
    if (switchMapId !== activeMapPack.id) {
      if (!bundledMapCatalog) {
        throw new Error("Không tìm thấy catalog bản đồ.");
      }
      const selectedMapPack = await loadCatalogMapPack(
        bundledMapCatalog,
        switchMapId,
      );
      if (!selectedMapPack) {
        throw new Error("Không tải được dữ liệu bản đồ đã chọn.");
      }
      await database.putSettings([
        { key: "activeMapPackId", value: switchMapId },
        { key: `activeArea:${switchMapId}`, value: switchAreaId },
      ]);
      await activateMapPack(selectedMapPack, switchAreaId);
      closeDialog(elements.mapSwitchDialog);
      showToast(`Đã chuyển tới ${activeMapPack.title}.`);
      void syncRemoteProgress();
      return;
    }
    await applyActiveArea(switchAreaId);
    closeDialog(elements.mapSwitchDialog);
    showToast(
      activeArea()?.label
        ? `Đã chuyển tới ${activeArea()?.label}.`
        : "Đang hiển thị toàn khu vực.",
    );
  } catch (error) {
    showToast(`Không lưu được lựa chọn bản đồ: ${errorMessage(error)}`, "error");
  } finally {
    mapSwitchInFlight = false;
    elements.confirmMapSwitch.disabled = false;
    elements.confirmMapSwitch.removeAttribute("aria-busy");
    elements.confirmMapSwitchLabel.textContent = "Mở khu vực";
  }
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
  const normalizedSearchTerm = normalizeSearchText(searchTerm);
  const isSearching = normalizedSearchTerm.length > 0;
  const atlasMarkersByCategory = new Map<string, MapMarker[]>();
  for (const marker of activeMapPack.markers) {
    const categoryMarkers =
      atlasMarkersByCategory.get(marker.categoryId) ?? [];
    categoryMarkers.push(marker);
    atlasMarkersByCategory.set(marker.categoryId, categoryMarkers);
  }
  const atlasCategories = activeMapPack.categories.filter(
    (category) => (atlasMarkersByCategory.get(category.id)?.length ?? 0) > 0,
  );
  if (
    !atlasCategories.some(
      (category) => categoryGroupId(category) === activeCategoryGroupId,
    )
  ) {
    activeCategoryGroupId = atlasCategories[0]
      ? categoryGroupId(atlasCategories[0])
      : categoryGroups[0]?.id ?? FALLBACK_CATEGORY_GROUP.id;
  }

  for (const group of categoryGroups) {
    const groupCategories = atlasCategories.filter(
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

  const displayedCategories = atlasCategories.filter((category) => {
    if (isSearching) {
      const categorySearchText = normalizeSearchText(
        `${category.label} ${category.id}`,
      );
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
      : "Nhóm này chưa có điểm trên atlas.";
    elements.categoryList.append(empty);
  }

  for (const category of displayedCategories) {
    const categoryMarkers = atlasMarkersByCategory.get(category.id) ?? [];
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

  const selectedCategories = atlasCategories.filter((category) =>
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

  const allAtlasCategoriesSelected =
    atlasCategories.length > 0 &&
    atlasCategories.every((category) => visibleCategoryIds.has(category.id));
  elements.toggleAllCategories.textContent =
    allAtlasCategoriesSelected
      ? "Bỏ chọn tất cả"
      : "Chọn tất cả";
}

function initializeMap(): void {
  imageBounds = L.latLngBounds(
    [0, 0],
    [activeMapDimensions.height, activeMapDimensions.width],
  );
  const content = activeMapPack.bounds ?? {
    minX: 0,
    minY: 0,
    maxX: activeMapDimensions.width,
    maxY: activeMapDimensions.height,
  };
  mapContentBounds = L.latLngBounds(
    [activeMapDimensions.height - content.maxY, content.minX],
    [activeMapDimensions.height - content.minY, content.maxX],
  );
  const view = activeMapPack.initialView ?? {
    ...content,
  };
  mapViewBounds = L.latLngBounds(
    [activeMapDimensions.height - view.maxY, view.minX],
    [activeMapDimensions.height - view.minY, view.maxX],
  );

  map = L.map("map", {
    crs: L.CRS.Simple,
    preferCanvas: true,
    minZoom: -2,
    maxZoom: 2.5,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    zoomControl: false,
    attributionControl: false,
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);

  const baseMapPane = map.createPane("base-map-pane");
  baseMapPane.style.zIndex = "200";
  const floorScrimPane = map.createPane("floor-scrim-pane");
  floorScrimPane.style.zIndex = "220";
  floorScrimPane.classList.add("floor-scrim-pane");
  const floorMapPane = map.createPane("floor-map-pane");
  floorMapPane.style.zIndex = "240";

  if (activeMapPack.image) {
    L.imageOverlay(activeMapPack.image.src, imageBounds, {
      className: "map-image base-map-image",
      pane: "base-map-pane",
    }).addTo(map);
  } else if (activeMapPack.tiles) {
    createTileLayer(
      activeMapPack.tiles,
      "map-image base-map-image",
      200,
      "base-map-pane",
    ).addTo(map);
  }
  floorScrimLayer = L.imageOverlay(TRANSPARENT_TILE, imageBounds, {
    className: "floor-map-scrim",
    interactive: false,
    opacity: 0,
    pane: "floor-scrim-pane",
  }).addTo(map);
  updateFloorLayer();
  markerLayer = L.layerGroup().addTo(map);
  map.fitBounds(activeRouteBounds(), { animate: false });
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
  pane: string,
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
    pane,
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
  floorScrimLayer.setOpacity(0);
  map.getContainer().classList.remove("is-floor-focused");
  if (!activeFloorId) {
    return;
  }
  const floor = activeMapPack.layers?.find(
    (layer) => layer.id === activeFloorId,
  );
  if (floor) {
    map.getContainer().classList.add("is-floor-focused");
    floorScrimLayer.setOpacity(0.34);
    floorTileLayer = createTileLayer(
      floor.tiles,
      "map-image floor-map-image",
      240,
      "floor-map-pane",
    ).addTo(map);
  }
}

function markerLatLng(marker: MapMarker): L.LatLngExpression {
  return [activeMapDimensions.height - marker.y, marker.x];
}

function renderMarkers(): void {
  window.clearTimeout(markerRenderTimer);
  markerRenderTimer = undefined;
  markerLayer.clearLayers();
  const normalizedSearchTerm = normalizeSearchText(searchTerm);
  const activeSearchIndex =
    normalizedSearchTerm.length > 0
      ? markerSearchIndex ??= buildMarkerSearchIndex(activeMapPack.markers)
      : undefined;
  const visibleMarkers = filterVisibleMarkers(activeMapPack.markers, {
    activeFloorId,
    completedMarkerIds,
    hideCompleted,
    normalizedSearchTerm,
    searchIndex: activeSearchIndex,
    visibleCategoryIds,
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

    renderedMarker.bindTooltip(() => {
      const tooltipContent = document.createElement("span");
      tooltipContent.textContent = marker.title;
      return tooltipContent;
    }, {
      direction: "top",
      offset: [0, useDomIconMarkers ? -4 : -8],
      opacity: 0.95,
    });
    renderedMarker.bindPopup(
      () =>
        createMarkerPopup(
          marker,
          category,
          completedMarkerIds.has(marker.id),
        ),
      {
        className: "marker-popup",
        minWidth: 230,
        closeButton: true,
      },
    );
    renderedMarker.addTo(markerLayer);
  }

  elements.visibleCount.textContent = `${visibleMarkers.length} điểm đang hiển thị`;
  updateProgressDisplay();
}

function scheduleMarkerRender(): void {
  window.clearTimeout(markerRenderTimer);
  markerRenderTimer = window.setTimeout(() => renderMarkers(), 120);
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
    title: marker.title,
    alt: marker.title,
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
  const { completed, total, percentage } = summarizeProgressForCategories(
    activeRouteMarkers(),
    completedMarkerIds,
    visibleCategoryIds,
  );

  elements.topProgressCount.textContent = `${completed} / ${total}`;
  elements.progressPercentage.textContent = `${percentage}%`;
  elements.progressFraction.textContent = `${completed} / ${total} điểm`;
  elements.progressTrack.setAttribute("aria-valuenow", String(percentage));
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

      const acknowledged: ProgressRecord[] = [];
      for (const record of canonical) {
        const current = latestLocal.get(record.id);
        if (current?.updatedAt !== submittedVersions.get(record.id)) {
          continue;
        }
        acknowledged.push({ ...record, pendingSync: false });
      }
      await database.putProgressBatch(acknowledged);
    }

    const remoteRecords = await syncClient.pullProgress(mapId);
    const currentLocal = new Map(
      (
        await database.getProgress(activeProfileId, mapId)
      ).map((record) => [record.id, record]),
    );
    await database.putProgressBatch(
      remoteRecords
        .filter((record) => currentLocal.get(record.id)?.pendingSync !== true)
        .map((record) => ({ ...record, pendingSync: false })),
    );

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
  const isMobile = window.matchMedia("(max-width: 820px)").matches;
  const isOpen = isMobile && open;
  elements.sidebar.classList.toggle("is-open", isOpen);
  elements.sidebarToggle.setAttribute("aria-expanded", String(isOpen));
  elements.sidebar.setAttribute(
    "aria-hidden",
    isMobile ? String(!isOpen) : "false",
  );
  elements.sidebar.inert = isMobile && !isOpen;
  elements.sidebarScrim.setAttribute("aria-hidden", String(!isOpen));
  elements.sidebarScrim.inert = !isOpen;
}

async function changeFloor(value: string): Promise<void> {
  activeFloorId = value;
  elements.floorSelect.value = value;
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
  showToast(`Đã chuyển sang ${floorLabel ?? "tầng bản đồ"}.`);
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
  window.addEventListener("resize", () => {
    setSidebarOpen(elements.sidebar.classList.contains("is-open"));
  });

  for (const button of [
    elements.settingsButton,
    elements.openSettings,
  ]) {
    button.addEventListener("click", () => {
      setSidebarOpen(false);
      openDialog(elements.settingsDialog);
    });
  }
  for (const dialog of [
    elements.mapSwitchDialog,
    elements.settingsDialog,
  ]) {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        closeDialog(dialog);
      }
    });
    for (const button of dialog.querySelectorAll<HTMLButtonElement>(
      "button[value='cancel']",
    )) {
      button.type = "button";
      button.addEventListener("click", () => {
        closeDialog(dialog);
      });
    }
  }
  elements.mapSwitchTrigger.addEventListener("click", openMapSwitcher);
  elements.confirmMapSwitch.addEventListener("click", () => {
    void confirmMapSwitch();
  });

  elements.searchInput.addEventListener("input", () => {
    searchTerm = elements.searchInput.value;
    renderCategories();
    scheduleMarkerRender();
  });

  elements.hideCompleted.addEventListener("change", async () => {
    hideCompleted = elements.hideCompleted.checked;
    await database.putSetting("hideCompleted", hideCompleted);
    renderMarkers();
  });

  elements.toggleAllCategories.addEventListener("click", async () => {
    const atlasCategoryIds = new Set(
      activeMapPack.markers.map((marker) => marker.categoryId),
    );
    const allSelected =
      atlasCategoryIds.size > 0 &&
      [...atlasCategoryIds].every((id) => visibleCategoryIds.has(id));
    if (allSelected) {
      for (const categoryId of atlasCategoryIds) {
        visibleCategoryIds.delete(categoryId);
      }
    } else {
      for (const categoryId of atlasCategoryIds) {
        visibleCategoryIds.add(categoryId);
      }
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

  elements.floorSelect.addEventListener("change", () => {
    void changeFloor(elements.floorSelect.value);
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
    const activeProfile = profiles.find(
      (profile) => profile.id === activeProfileId,
    );
    if (!activeProfile) {
      showToast("Không tìm thấy profile đang dùng.", "error");
      return;
    }

    const backup = await database.exportBackup();
    downloadJson(
      createBackupFilename(activeProfile, new Date(backup.exportedAt)),
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
      await database.putSettings([
        { key: "activeMapPackId", value: importedMapPack.id },
        { key: `activeArea:${importedMapPack.id}`, value: "" },
      ]);
      await activateMapPack(importedMapPack, "");
      closeDialog(elements.settingsDialog);
      showToast("Đã import và mở map pack.");
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  });

  elements.useDemoMap.addEventListener("click", async () => {
    try {
      await database.putSettings([
        { key: "activeMapPackId", value: demoMapPack.id },
        { key: `activeArea:${demoMapPack.id}`, value: "" },
      ]);
      await activateMapPack(demoMapPack, "");
      closeDialog(elements.settingsDialog);
      showToast("Đã chuyển sang bản đồ demo.");
    } catch (error) {
      showToast(`Không mở được bản đồ demo: ${errorMessage(error)}`, "error");
    }
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
