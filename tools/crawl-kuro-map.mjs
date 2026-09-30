import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadKuroTranslations,
  localizeKuroText,
} from "./kuro-localization.mjs";

const API_ORIGIN = "https://api.kurobbs.com";
const CDN_ORIGIN = "https://web-static.kurobbs.com";
const DEFAULT_TILE_SIZE = 768;
const DEFAULT_CONCURRENCY = 6;
const RATE = 100;
const SOURCE_TILE_UNITS = 850;
const CATEGORY_COLORS = [
  "#8bd3c7",
  "#f8c963",
  "#b8a1ff",
  "#f07e83",
  "#6cc8ee",
  "#9fdb72",
];
const CATEGORY_GROUPS = [
  { directory: "61", id: "collection", label: "Bộ sưu tập", icon: "collection" },
  { directory: "52", id: "exploration", label: "Khám phá", icon: "exploration" },
  { directory: "49", id: "resources", label: "Tài nguyên", icon: "resource" },
  { directory: "63", id: "enemies", label: "Kẻ thù", icon: "enemy" },
  { directory: "65", id: "elite-enemies", label: "Kẻ thù mạnh", icon: "elite" },
  { directory: "50", id: "bosses", label: "Boss", icon: "boss" },
  { directory: "51", id: "activities", label: "Hoạt động", icon: "activity" },
  { directory: "48", id: "locations", label: "Địa điểm", icon: "location" },
];
const FALLBACK_GROUP = {
  id: "other",
  label: "Khác",
  icon: "default",
};
const GROUP_BY_DIRECTORY = new Map(
  CATEGORY_GROUPS.map((group) => [group.directory, group]),
);
const CHEST_LABELS = new Map([
  ["qzx_01", "Rương đơn sơ"],
  ["qzx_02", "Rương tiêu chuẩn"],
  ["qzx_03", "Rương tinh xảo"],
  ["qzx_04", "Rương huy quang"],
]);

export const OFFICIAL_REALM_GROUPS = [
  {
    id: "roya-frostlands",
    sourceCountryId: 4,
    title: "Băng nguyên Roya",
    order: 0,
  },
  {
    id: "rinascita",
    sourceCountryId: 3,
    title: "Rinascita",
    order: 1,
  },
  {
    id: "black-shores",
    sourceCountryId: 900,
    title: "Quần đảo Bờ Đen",
    order: 2,
  },
  {
    id: "huanglong",
    sourceCountryId: 1,
    title: "Hoàng Long",
    order: 3,
  },
];

const REALM_GROUP_BY_COUNTRY_ID = new Map(
  OFFICIAL_REALM_GROUPS.map((group) => [group.sourceCountryId, group]),
);

const OFFICIAL_MAP_STATE_SECTIONS = [
  {
    realmId: "roya-frostlands",
    mapState: "7",
    id: "dimmr-plains",
    title: "Dimmr Plains",
    order: 0,
  },
  {
    realmId: "roya-frostlands",
    mapState: "6",
    id: "frostlands-surface",
    title: "Frostlands Surface",
    order: 1,
  },
  {
    realmId: "roya-frostlands",
    mapState: "5",
    id: "lahai-roi",
    title: "Lahai-Roi",
    order: 2,
  },
  {
    realmId: "rinascita",
    mapState: "4",
    id: "septimont",
    title: "Septimont",
    order: 0,
  },
  {
    realmId: "rinascita",
    mapState: "3",
    id: "ragunna",
    title: "Ragunna",
    order: 1,
  },
  {
    realmId: "huanglong",
    mapState: "8",
    id: "mengzhou",
    title: "Mengzhou",
    order: 0,
  },
  {
    realmId: "huanglong",
    mapState: "1",
    id: "jinzhou",
    title: "Jinzhou",
    order: 1,
  },
];

const OFFICIAL_MAP_STATE_SECTION_BY_KEY = new Map(
  OFFICIAL_MAP_STATE_SECTIONS.map((section) => [
    `${section.realmId}/${section.mapState}`,
    section,
  ]),
);

const LEGACY_MAP_IDS = new Map([
  ["8/1/1/2", "wuwa-kuro-state-8-country-1"],
  ["8/1/8/12", "wuwa-kuro-state-8-country-1-2"],
  ["8/3/3/1", "wuwa-kuro-state-8-country-3"],
  ["8/4/6/1", "wuwa-kuro-state-8-country-4"],
  ["8/900//1", "wuwa-kuro-state-8-country-900"],
  ["900/900//2", "wuwa-kuro-state-900"],
  ["902/3/3/9", "wuwa-kuro-state-902"],
  ["903/3/3/11", "wuwa-kuro-state-903"],
  ["905/3/3/14", "wuwa-kuro-state-905"],
  ["906/4/5/6", "wuwa-kuro-state-906"],
  ["909/4/7/6", "wuwa-kuro-state-909"],
  ["910/900//3", "wuwa-kuro-state-910"],
]);

function officialDefinitionKey({
  stateId,
  countryId,
  mapState,
  order,
}) {
  return `${stateId}/${countryId}/${mapState ?? ""}/${order}`;
}

function generatedMapOutputName(id, groupId, stateId, mapState, order) {
  if (id.startsWith("wuwa-kuro-state-")) {
    return id.slice("wuwa-kuro-state-".length);
  }
  return `atlas-${groupId}-${stateId}-${mapState || "base"}-${order}`;
}

function officialAreaId(index) {
  return `official-area-${index + 1}`;
}

export function buildOfficialMapDefinitions(
  countryData,
  translations = new Map(),
) {
  if (!Array.isArray(countryData)) {
    throw new Error("country.json của KURO không đúng định dạng.");
  }

  const definitions = [];
  for (const [realmIndex, realm] of countryData.entries()) {
    const group = REALM_GROUP_BY_COUNTRY_ID.get(Number(realm.countryId));
    if (!group || !Array.isArray(realm.countrys)) {
      continue;
    }

    for (const [entryIndex, entry] of realm.countrys.entries()) {
      const stateId = Number(entry.stateId);
      const countryId = Number(entry.countryId ?? realm.countryId);
      const order = Number.isInteger(Number(entry.order))
        ? Number(entry.order)
        : entryIndex + 1;
      const mapState = String(entry.mapState ?? "");
      const key = officialDefinitionKey({
        stateId,
        countryId,
        mapState,
        order,
      });
      const legacyId = LEGACY_MAP_IDS.get(key);
      const id =
        legacyId ??
        `wuwa-kuro-atlas-${group.id}-${stateId}-${mapState || "base"}-${order}`;
      const sourceName = String(entry.name ?? `Atlas ${order}`);
      const areas = (entry.children ?? [])
        .filter(
          (child) =>
            Number.isFinite(Number(child.xPosition)) &&
            Number.isFinite(Number(child.yPosition)),
        )
        .map((child, childIndex) => ({
          id: officialAreaId(childIndex),
          sourceName: String(child.name ?? `Khu ${childIndex + 1}`),
          label: localizeKuroText(
            String(child.name ?? `Khu ${childIndex + 1}`),
            translations,
          ),
          anchor: {
            x: Number(child.xPosition),
            y: Number(child.yPosition),
          },
        }));

      definitions.push({
        id,
        outputName: generatedMapOutputName(
          id,
          group.id,
          stateId,
          mapState,
          order,
        ),
        realmId: group.id,
        realmTitle: group.title,
        realmOrder: group.order,
        realmSourceName: String(realm.name ?? group.title),
        stateId,
        countryId,
        mapState,
        order,
        sourceName,
        title: localizeKuroText(sourceName, translations),
        progressMapId:
          stateId === 8 ? "wuwa-kuro-state-8" : `wuwa-kuro-state-${stateId}`,
        areas,
        atlasAnchor: {
          x: Number(entry.xPosition),
          y: Number(entry.yPosition),
        },
        sourceIndex: `${realmIndex}-${entryIndex}`,
      });
    }
  }

  if (definitions.length === 0) {
    throw new Error("country.json không có atlas map hợp lệ.");
  }
  return definitions;
}

function squaredDistanceToAtlas(location, definition) {
  return (
    (location.x - definition.atlasAnchor.x) ** 2 +
    (location.y - definition.atlasAnchor.y) ** 2
  );
}

export function assignOfficialLocationIds(positionData, definitions) {
  const assignments = new Map(
    definitions.map((definition) => [definition.id, new Set()]),
  );
  const peerGroups = new Map();
  const stateGroups = new Map();
  for (const definition of definitions) {
    const key = `${definition.stateId}/${definition.countryId}`;
    const peers = peerGroups.get(key) ?? [];
    peers.push(definition);
    peerGroups.set(key, peers);
    const statePeers = stateGroups.get(definition.stateId) ?? [];
    statePeers.push(definition);
    stateGroups.set(definition.stateId, statePeers);
  }

  for (const item of positionData) {
    for (const location of item.location ?? []) {
      if (
        !Number.isFinite(Number(location.x)) ||
        !Number.isFinite(Number(location.y))
      ) {
        continue;
      }
      const exactPeers = peerGroups.get(
        `${Number(location.stateId)}/${Number(location.countryId)}`,
      );
      const peers =
        exactPeers ?? stateGroups.get(Number(location.stateId));
      if (!peers || peers.length === 0) {
        continue;
      }
      let closest = peers[0];
      let closestDistance = squaredDistanceToAtlas(location, closest);
      for (const peer of peers.slice(1)) {
        const distance = squaredDistanceToAtlas(location, peer);
        if (
          distance < closestDistance ||
          (
            distance === closestDistance &&
            peer.sourceIndex.localeCompare(closest.sourceIndex) < 0
          )
        ) {
          closest = peer;
          closestDistance = distance;
        }
      }
      assignments.get(closest.id).add(String(location.id));
    }
  }
  return assignments;
}

export function buildCatalogGroups(entries, definitions = []) {
  const availableMapIds = new Set(entries.map((entry) => entry.id));
  const definitionsByMapId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  return OFFICIAL_REALM_GROUPS
    .map((group) => {
      const groupDefinitions = definitions
        .filter((definition) => definition.realmId === group.id)
        .sort(
          (left, right) =>
            left.realmOrder - right.realmOrder ||
            left.order - right.order ||
            left.sourceIndex.localeCompare(right.sourceIndex),
        )
        .filter((definition) => availableMapIds.has(definition.id));
      const sectionByKey = new Map();
      for (const definition of groupDefinitions) {
        const configuredSection = OFFICIAL_MAP_STATE_SECTION_BY_KEY.get(
          `${definition.realmId}/${definition.mapState}`,
        );
        const section = configuredSection ?? {
          id: `${group.id}-${definition.mapState || "base"}`,
          title: definition.mapState
            ? `Cụm bản đồ ${definition.mapState}`
            : group.title,
          order: Number.MAX_SAFE_INTEGER,
        };
        const sectionMaps = sectionByKey.get(section.id) ?? {
          id: section.id,
          title: section.title,
          order: section.order,
          mapIds: [],
        };
        sectionMaps.mapIds.push(definition.id);
        sectionByKey.set(section.id, sectionMaps);
      }
      const sections = [...sectionByKey.values()]
        .sort(
          (left, right) =>
            left.order - right.order ||
            left.title.localeCompare(right.title, "en"),
        )
        .map(({ id, title, mapIds }) => ({ id, title, mapIds }));
      const catalogGroup = {
        id: group.id,
        title: group.title,
        mapIds:
          sections.length > 1
            ? sections.flatMap((section) => section.mapIds)
            : groupDefinitions.map((definition) => definition.id),
      };
      if (sections.length > 1) {
        catalogGroup.sections = sections;
      }
      return catalogGroup;
    })
    .filter((group) => group.mapIds.length > 0)
    .map((group) => ({
      ...group,
      mapIds: group.mapIds.filter((mapId) => definitionsByMapId.has(mapId)),
    }))
    .filter((group) => group.mapIds.length > 0);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Tham số CLI không hợp lệ.");
    }
    values.set(name, value);
  }
  return values;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} phải là số nguyên dương.`);
  }
  return parsed;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJsonIfPresent(path) {
  return existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : undefined;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "user-agent": "WayfinderMap/0.1 (non-commercial personal map mirror)",
          ...options.headers,
        },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(250 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(
    `Không tải được ${url}: ${
      lastError instanceof Error ? lastError.message : lastError
    }`,
  );
}

async function fetchJson(url, options) {
  return (await fetchWithRetry(url, options)).json();
}

async function fetchJsonWithCache(url, cachePath) {
  try {
    const payload = await fetchJson(url);
    writeJson(cachePath, payload);
    return payload;
  } catch (error) {
    const cached = readJsonIfPresent(cachePath);
    if (cached !== undefined) {
      console.warn(
        `Không refresh được ${url}; dùng cache ${cachePath}.`,
      );
      return cached;
    }
    throw error;
  }
}

async function postApi(path) {
  const payload = await fetchJson(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.kurobbs.com",
      referer: "https://www.kurobbs.com/",
    },
    body: "{}",
  });
  if (payload?.code !== 200) {
    throw new Error(`KURO API ${path} trả về lỗi.`);
  }
  return payload.data;
}

export function parseTileLayout(tileIds, stateId) {
  if (!Array.isArray(tileIds) || tileIds.length === 0) {
    throw new Error(`State ${stateId} không có tile.`);
  }

  const tiles = tileIds.map((tileId) => {
    const match = /^(\d+)_(-?\d+)_(-?\d+)$/.exec(tileId);
    if (!match || Number(match[1]) !== stateId) {
      throw new Error(`Tile ID không hợp lệ: ${tileId}`);
    }
    return {
      id: tileId,
      sourceX: Number(match[2]),
      sourceY: Number(match[3]),
    };
  });
  const minSourceX = Math.min(...tiles.map((tile) => tile.sourceX));
  const maxSourceX = Math.max(...tiles.map((tile) => tile.sourceX));
  const maxSourceY = Math.max(...tiles.map((tile) => tile.sourceY));
  const minSourceY = Math.min(...tiles.map((tile) => tile.sourceY));

  return {
    columns: maxSourceX - minSourceX + 1,
    rows: maxSourceY - minSourceY + 1,
    minSourceX,
    maxSourceX,
    minSourceY,
    maxSourceY,
    tiles: tiles.map((tile) => ({
      ...tile,
      column: tile.sourceX - minSourceX,
      row: maxSourceY - tile.sourceY,
      leafletY: maxSourceY - tile.sourceY -
        (maxSourceY - minSourceY + 1),
    })),
  };
}

export function gameToLocalPixel(
  x,
  y,
  tileSize,
  layout,
) {
  const scale = tileSize / SOURCE_TILE_UNITS;
  const globalX = (x / RATE) * scale + tileSize;
  const globalY = (y / RATE) * scale;
  return {
    x: globalX - layout.minSourceX * tileSize,
    y: globalY + layout.maxSourceY * tileSize,
  };
}

function itemGroup(item) {
  const directory =
    typeof item.icon === "string"
      ? /^adminConfig\/([^/]+)\//.exec(item.icon)?.[1]
      : undefined;
  return directory
    ? GROUP_BY_DIRECTORY.get(directory) ?? FALLBACK_GROUP
    : FALLBACK_GROUP;
}

function markerDescription(location, translations) {
  const parts = [];
  if (location.floorId?.trim()) {
    parts.push(`Tầng ${location.floorId.trim()}`);
  }
  if (location.description?.trim()) {
    parts.push(
      localizeKuroText(location.description.trim(), translations),
    );
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function iconFileName(iconPath) {
  return `${createHash("sha256").update(iconPath).digest("hex").slice(0, 20)}.webp`;
}

export function parseLayerTilePath(tilePath, layout) {
  const match = /^\/([^/]+)\/([^/]+)\/(-?\d+)_(-?\d+)\.png$/.exec(
    tilePath,
  );
  if (!match) {
    throw new Error(`Layer tile không hợp lệ: ${tilePath}`);
  }
  const sourceX = Number(match[3]);
  const sourceY = Number(match[4]);
  return {
    groupPath: match[1],
    floorPath: match[2],
    sourceX,
    sourceY,
    column: sourceX - layout.minSourceX,
    leafletY: layout.maxSourceY - sourceY - layout.rows,
  };
}

export function buildLayerEntries({
  stateId,
  layerData,
  layout,
  tileSize,
  tileExtension,
  translations = new Map(),
}) {
  const entries = [];
  for (const group of layerData) {
    for (const floor of group.floors ?? []) {
      const parsedTiles = (floor.tiles ?? []).map((tilePath) => ({
        tilePath,
        ...parseLayerTilePath(tilePath, layout),
      }));
      if (parsedTiles.length === 0) {
        continue;
      }
      const directoryName = String(floor.id).replaceAll("/", "_");
      entries.push({
        id: String(floor.id),
        label: localizeKuroText(
          floor.name?.trim() || String(floor.id),
          translations,
        ),
        groupId: String(group.id),
        groupLabel: localizeKuroText(
          group.name?.trim() || String(group.id),
          translations,
        ),
        directoryName,
        sourceTiles: parsedTiles,
        tiles: {
          src:
            `map-packs/private/layers/${stateId}/${directoryName}` +
            `/{x}_{y}.${tileExtension}`,
          tileSize,
          columns: layout.columns,
          rows: layout.rows,
          availableTiles: parsedTiles.map(
            (tile) => `${tile.column},${tile.leafletY}`,
          ),
        },
      });
    }
  }
  return entries;
}

function locationMatchesRegion(location, stateId, countryId, locationIds) {
  return (
    Number(location.stateId) === stateId &&
    (
      locationIds !== undefined ||
      countryId === undefined ||
      Number(location.countryId) === countryId
    ) &&
    (locationIds === undefined || locationIds.has(String(location.id))) &&
    Number.isFinite(location.x) &&
    Number.isFinite(location.y)
  );
}

function scaleInitialView(initialView, tileSize, width, height) {
  if (!initialView) {
    return undefined;
  }
  const scale = tileSize / DEFAULT_TILE_SIZE;
  return {
    minX: Math.max(0, initialView.minX * scale),
    minY: Math.max(0, initialView.minY * scale),
    maxX: Math.min(width, initialView.maxX * scale),
    maxY: Math.min(height, initialView.maxY * scale),
  };
}

function scaleAreas(areas, tileSize, width, height) {
  return areas?.map((area) => ({
    ...area,
    bounds: scaleInitialView(area.bounds, tileSize, width, height),
  }));
}

function scalePoint(point, tileSize) {
  const scale = tileSize / DEFAULT_TILE_SIZE;
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

function clampAreaBounds(bounds, limits) {
  const width = Math.min(
    limits.maxX - limits.minX,
    Math.max(1, bounds.maxX - bounds.minX),
  );
  const height = Math.min(
    limits.maxY - limits.minY,
    Math.max(1, bounds.maxY - bounds.minY),
  );
  const minX = Math.max(limits.minX, Math.min(bounds.minX, limits.maxX - width));
  const minY = Math.max(limits.minY, Math.min(bounds.minY, limits.maxY - height));
  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
  };
}

function boundsForRouteMarkers(markers, limits, tileSize) {
  const padding = tileSize * 0.42;
  const minX = Math.min(...markers.map((marker) => marker.x)) - padding;
  const minY = Math.min(...markers.map((marker) => marker.y)) - padding;
  const maxX = Math.max(...markers.map((marker) => marker.x)) + padding;
  const maxY = Math.max(...markers.map((marker) => marker.y)) + padding;
  return clampAreaBounds({
    minX: Math.max(limits.minX, minX),
    minY: Math.max(limits.minY, minY),
    maxX: Math.min(limits.maxX, maxX),
    maxY: Math.min(limits.maxY, maxY),
  }, limits);
}

function boundsForAreaAnchor(anchor, limits, tileSize) {
  const padding = tileSize * 0.65;
  return clampAreaBounds(
    {
      minX: anchor.x - padding,
      minY: anchor.y - padding,
      maxX: anchor.x + padding,
      maxY: anchor.y + padding,
    },
    limits,
  );
}

function tileRegionsForBounds(bounds, tileSize, columns, rows) {
  return [
    {
      minColumn: Math.max(
        0,
        Math.floor(bounds.minX / tileSize) - 1,
      ),
      maxColumn: Math.min(
        columns - 1,
        Math.max(
          0,
          Math.ceil(bounds.maxX / tileSize),
        ),
      ),
      minRow: Math.max(
        0,
        Math.floor(bounds.minY / tileSize) - 1,
      ),
      maxRow: Math.min(
        rows - 1,
        Math.max(
          0,
          Math.ceil(bounds.maxY / tileSize),
        ),
      ),
    },
  ];
}

function routeCountForMarkers(markerCount) {
  if (markerCount < 160) {
    return 1;
  }
  if (markerCount < 500) {
    return 2;
  }
  if (markerCount < 1200) {
    return 3;
  }
  if (markerCount < 2500) {
    return 4;
  }
  return 5;
}

function routeLabel(axis, index, count) {
  const labels = axis === "x"
    ? {
        2: ["Phía Tây", "Phía Đông"],
        3: ["Phía Tây", "Trung tâm", "Phía Đông"],
        4: ["Phía Tây", "Tây trung tâm", "Đông trung tâm", "Phía Đông"],
        5: [
          "Phía Tây",
          "Tây trung tâm",
          "Trung tâm",
          "Đông trung tâm",
          "Phía Đông",
        ],
      }
    : {
        2: ["Phía Bắc", "Phía Nam"],
        3: ["Phía Bắc", "Trung tâm", "Phía Nam"],
        4: ["Phía Bắc", "Bắc trung tâm", "Nam trung tâm", "Phía Nam"],
        5: [
          "Phía Bắc",
          "Bắc trung tâm",
          "Trung tâm",
          "Nam trung tâm",
          "Phía Nam",
        ],
      };
  return labels[count]?.[index] ?? `Khu ${index + 1}`;
}

export function deriveRouteAreas(markers, tileSize, bounds) {
  const routeCount = routeCountForMarkers(markers.length);
  if (routeCount <= 1) {
    return [
      {
        id: "whole-map",
        label: "Toàn khu vực",
        bounds: boundsForRouteMarkers(markers, bounds, tileSize),
        markerIds: markers.map((marker) => marker.id),
      },
    ];
  }

  const xValues = markers.map((marker) => marker.x);
  const yValues = markers.map((marker) => marker.y);
  const xSpan = Math.max(...xValues) - Math.min(...xValues);
  const ySpan = Math.max(...yValues) - Math.min(...yValues);
  const axis = xSpan > ySpan ? "x" : "y";
  const sortedMarkers = [...markers].sort((left, right) =>
    left[axis] - right[axis] ||
    left[axis === "x" ? "y" : "x"] - right[axis === "x" ? "y" : "x"] ||
    left.id.localeCompare(right.id),
  );
  const routeMarkers = Array.from(
    { length: routeCount },
    (_, index) => {
      const start = Math.floor(index * sortedMarkers.length / routeCount);
      const end = Math.floor(
        (index + 1) * sortedMarkers.length / routeCount,
      );
      return sortedMarkers.slice(start, Math.max(start + 1, end));
    },
  );

  return routeMarkers.map((areaMarkers, index) => ({
    id: `route-${index + 1}`,
    label: routeLabel(axis, index, routeCount),
    bounds: boundsForRouteMarkers(areaMarkers, bounds, tileSize),
    markerIds: areaMarkers.map((marker) => marker.id),
  }));
}

function buildRouteAreas(
  areas,
  markers,
  tileSize,
  bounds,
  { anchorsAreLocal = false } = {},
) {
  const normalizedAreas = areas?.length > 0 ? areas : undefined;
  const derivedAreas = normalizedAreas === undefined
    ? deriveRouteAreas(markers, tileSize, bounds)
    : undefined;
  const routeDefinitions = normalizedAreas ?? derivedAreas;
  if (!routeDefinitions) {
    return undefined;
  }
  if (normalizedAreas === undefined) {
    return routeDefinitions;
  }
  if (!normalizedAreas.every((area) => area.anchor)) {
    return scaleAreas(
      normalizedAreas,
      tileSize,
      bounds.maxX,
      bounds.maxY,
    );
  }

  const scaledAreas = routeDefinitions.map((area) => ({
    ...area,
    anchor: anchorsAreLocal
      ? area.anchor
      : scalePoint(area.anchor, tileSize),
  }));
  const markersByAreaId = new Map(
    scaledAreas.map((area) => [area.id, []]),
  );

  for (const marker of markers) {
    let closestArea;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const area of scaledAreas) {
      const distance =
        (marker.x - area.anchor.x) ** 2 +
        (marker.y - area.anchor.y) ** 2;
      if (distance < closestDistance) {
        closestArea = area;
        closestDistance = distance;
      }
    }
    if (!closestArea) {
      throw new Error("Không thể gán marker vào khu chạy map.");
    }
    markersByAreaId.get(closestArea.id).push(marker);
  }

  return scaledAreas.map((area) => {
    const areaMarkers = markersByAreaId.get(area.id) ?? [];
    return {
      id: area.id,
      label: area.label,
      bounds:
        areaMarkers.length > 0
          ? boundsForRouteMarkers(areaMarkers, bounds, tileSize)
          : boundsForAreaAnchor(area.anchor, bounds, tileSize),
      markerIds: areaMarkers.map((marker) => marker.id),
    };
  });
}

function tileMatchesRegions(tile, tileRegions) {
  return (
    tileRegions === undefined ||
    tileRegions.some(
      (region) =>
        tile.column >= region.minColumn &&
        tile.column <= region.maxColumn &&
        tile.row >= region.minRow &&
        tile.row <= region.maxRow,
    )
  );
}

function pixelMatchesRegions(pixel, tileSize, tileRegions) {
  return tileMatchesRegions(
    {
      column: Math.floor(pixel.x / tileSize),
      row: Math.floor(pixel.y / tileSize),
    },
    tileRegions,
  );
}

function tileRegionBounds(tileRegions, tileSize, width, height) {
  if (tileRegions === undefined) {
    return undefined;
  }
  return {
    minX: Math.max(
      0,
      Math.min(...tileRegions.map((region) => region.minColumn)) * tileSize,
    ),
    minY: Math.max(
      0,
      Math.min(...tileRegions.map((region) => region.minRow)) * tileSize,
    ),
    maxX: Math.min(
      width,
      (Math.max(...tileRegions.map((region) => region.maxColumn)) + 1) *
        tileSize,
    ),
    maxY: Math.min(
      height,
      (Math.max(...tileRegions.map((region) => region.maxRow)) + 1) *
        tileSize,
    ),
  };
}

function filterTileSourceToRegions(source, tileRegions) {
  if (tileRegions === undefined || source.availableTiles === undefined) {
    return source;
  }
  return {
    ...source,
    availableTiles: source.availableTiles.filter((tile) => {
      const match = /^(-?\d+),(-?\d+)$/.exec(tile);
      if (!match) {
        return false;
      }
      return tileMatchesRegions(
        {
          column: Number(match[1]),
          row: Number(match[2]) + source.rows,
        },
        tileRegions,
      );
    }),
  };
}

export function buildKuroMapPack({
  stateId,
  stateName,
  countryId,
  mapId,
  progressMapId,
  tileRegions,
  locationIds,
  initialView,
  areas,
  areasUseLocalAnchors = false,
  tileSize,
  tileExtension,
  tileWebPrefix,
  layout,
  positionData,
  iconWebPathBySource = new Map(),
  layerEntries = [],
  retrievedAt,
  translations = new Map(),
}) {
  const width = layout.columns * tileSize;
  const height = layout.rows * tileSize;
  const fullBounds = {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: height,
  };
  const candidateItems = positionData.filter(
    (item) =>
      Array.isArray(item.location) &&
      item.location.some(
        (location) =>
          locationMatchesRegion(location, stateId, countryId, locationIds),
      ),
  );
  const groupByItemId = new Map(
    candidateItems.map((item) => [String(item.id), itemGroup(item)]),
  );
  const markers = [];

  for (const item of candidateItems) {
    const itemId = String(item.id);
    const title = localizeKuroText(
      CHEST_LABELS.get(itemId) ?? item.name?.trim() ?? itemId,
      translations,
    );
    for (const location of item.location) {
      if (
        !locationMatchesRegion(
          location,
          stateId,
          countryId,
          locationIds,
        )
      ) {
        continue;
      }
      const pixel = gameToLocalPixel(
        location.x,
        location.y,
        tileSize,
        layout,
      );
      if (
        pixel.x < 0 ||
        pixel.x > width ||
        pixel.y < 0 ||
        pixel.y > height ||
        !pixelMatchesRegions(pixel, tileSize, tileRegions)
      ) {
        continue;
      }
      markers.push({
        id: `kuro:${location.id}`,
        categoryId: itemId,
        title,
        x: Math.round(pixel.x * 1000) / 1000,
        y: Math.round(pixel.y * 1000) / 1000,
        description: markerDescription(location, translations),
        floorId: location.floorId?.trim() || undefined,
        levelId: location.level?.trim() || undefined,
      });
    }
  }

  if (markers.length === 0) {
    throw new Error(`State ${stateId} không có marker hợp lệ.`);
  }

  const markerBounds = boundsForRouteMarkers(markers, fullBounds, tileSize);
  const effectiveTileRegions =
    tileRegions ??
    tileRegionsForBounds(
      markerBounds,
      tileSize,
      layout.columns,
      layout.rows,
    );
  const contentBounds =
    tileRegionBounds(effectiveTileRegions, tileSize, width, height) ??
    markerBounds;
  const routeBounds = contentBounds;
  const usedItemIds = new Set(markers.map((marker) => marker.categoryId));
  const items = candidateItems.filter((item) =>
    usedItemIds.has(String(item.id)),
  );
  const usedGroupIds = new Set(
    items.map((item) => groupByItemId.get(String(item.id)).id),
  );
  const chestIds = items
    .map((item) => String(item.id))
    .filter((itemId) => itemId.startsWith("qzx_"));
  const usedLayerIds = new Set(
    markers
      .map((marker) => marker.levelId)
      .filter((levelId) => levelId && levelId !== "0"),
  );
  const selectedLayerEntries = layerEntries
    .filter((layer) => usedLayerIds.has(layer.id))
    .map((layer) => ({
      ...layer,
      tiles: filterTileSourceToRegions(layer.tiles, effectiveTileRegions),
    }))
    .filter((layer) => layer.tiles.availableTiles?.length !== 0);
  const availableTiles = layout.tiles
    .filter((tile) => tileMatchesRegions(tile, effectiveTileRegions))
    .map((tile) => `${tile.column},${tile.leafletY}`);

  return {
    schemaVersion: 1,
    id: mapId ?? `wuwa-kuro-state-${stateId}`,
    progressMapId,
    title: localizeKuroText(
      stateName || `Khu vực ${stateId}`,
      translations,
    ),
    subtitle: `${markers.length} vị trí · ${items.length} loại điểm`,
    attribution:
      `Dữ liệu và tile bản đồ: KURO GAMES official interactive map; ` +
      `dùng phi thương mại theo permission do chủ dự án xác nhận. ` +
      `Tải ngày ${retrievedAt.slice(0, 10)}.`,
    tiles: {
      src: `${tileWebPrefix}/{x}_{y}.${tileExtension}`,
      tileSize,
      columns: layout.columns,
      rows: layout.rows,
      availableTiles,
    },
    bounds: contentBounds,
    initialView:
      scaleInitialView(initialView, tileSize, width, height) ?? markerBounds,
    areas: buildRouteAreas(
      areas,
      markers,
      tileSize,
      routeBounds,
      { anchorsAreLocal: areasUseLocalAnchors },
    ),
    categoryGroups: [...CATEGORY_GROUPS, FALLBACK_GROUP]
      .filter((group) => usedGroupIds.has(group.id))
      .map(({ id, label, icon }) => ({ id, label, icon })),
    defaultVisibleCategoryIds:
      chestIds.length > 0
        ? chestIds
        : items.slice(0, 8).map((item) => String(item.id)),
    categories: items.map((item, index) => {
      const itemId = String(item.id);
      const group = groupByItemId.get(itemId);
      return {
        id: itemId,
        label: localizeKuroText(
          CHEST_LABELS.get(itemId) ?? item.name?.trim() ?? itemId,
          translations,
        ),
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
        symbol: CHEST_LABELS.has(itemId)
          ? String(["qzx_01", "qzx_02", "qzx_03", "qzx_04"].indexOf(itemId) + 1)
          : "•",
        groupId: group.id,
        icon: itemId.startsWith("qzx_") ? "chest" : group.icon,
        imageSrc:
          typeof item.icon === "string"
            ? iconWebPathBySource.get(item.icon)
            : undefined,
      };
    }),
    layers: selectedLayerEntries.length > 0
      ? selectedLayerEntries.map(
          ({ id, label, groupId, groupLabel, tiles }) => ({
            id,
            label,
            groupId,
            groupLabel,
            tiles,
          }),
        )
      : undefined,
    markers,
  };
}

async function downloadFile(url, outputPath, refresh) {
  if (
    !refresh &&
    existsSync(outputPath) &&
    statSync(outputPath).size > 0
  ) {
    return false;
  }
  const response = await fetchWithRetry(url);
  const temporaryPath = `${outputPath}.part`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(temporaryPath, Buffer.from(await response.arrayBuffer()));
  renameSync(temporaryPath, outputPath);
  return true;
}

async function runPool(tasks, concurrency, onProgress) {
  let nextIndex = 0;
  let completed = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      await task();
      completed += 1;
      onProgress(completed, tasks.length);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, tasks.length) },
      () => worker(),
    ),
  );
}

function removeStaleTiles(directory, expectedNames) {
  if (!existsSync(directory)) {
    return;
  }
  for (const name of readdirSync(directory)) {
    if (
      /^-?\d+_-?\d+\.(?:png|webp)$/.test(name) &&
      !expectedNames.has(name)
    ) {
      unlinkSync(join(directory, name));
    }
  }
}

function removeStaleIcons(directory, expectedNames) {
  if (!existsSync(directory)) {
    return;
  }
  for (const name of readdirSync(directory)) {
    if (/^[a-f0-9]{20}\.webp$/.test(name) && !expectedNames.has(name)) {
      unlinkSync(join(directory, name));
    }
  }
}

function stateNames(selection) {
  return new Map(
    (selection?.state ?? []).map((state) => [Number(state.id), state.name]),
  );
}

function selectedStateIds(value, availableStateIds) {
  if (!value || value === "all") {
    return availableStateIds;
  }
  const requested = value
    .split(",")
    .map((stateId) => Number(stateId.trim()))
    .filter(Number.isInteger);
  if (
    requested.length === 0 ||
    requested.some((stateId) => !availableStateIds.includes(stateId))
  ) {
    throw new Error("Danh sách --states không hợp lệ.");
  }
  return requested;
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  pnpm crawl:kuro --output public/map-packs/private " +
      "[--raw-output data/private/kuro] [--states all|8,906]",
  );
  console.log(
    "    [--tile-size 768|1024] [--concurrency 6] " +
      "[--default-state 906] [--refresh-tiles true|false] " +
      "[--translations tools/kuro-map-translations.vi.json]",
  );
}

async function main() {
  if (process.argv.includes("--help")) {
    printUsage();
    return;
  }

  const argumentsMap = parseArguments(process.argv.slice(2));
  const outputDirectory = resolve(
    argumentsMap.get("--output") ?? "public/map-packs/private",
  );
  const rawOutputDirectory = resolve(
    argumentsMap.get("--raw-output") ?? "data/private/kuro",
  );
  const tileSize = positiveInteger(
    argumentsMap.get("--tile-size") ?? DEFAULT_TILE_SIZE,
    "tileSize",
  );
  if (![768, 1024].includes(tileSize)) {
    throw new Error("--tile-size chỉ hỗ trợ 768 hoặc 1024.");
  }
  const concurrency = positiveInteger(
    argumentsMap.get("--concurrency") ?? DEFAULT_CONCURRENCY,
    "concurrency",
  );
  const defaultStateId = positiveInteger(
    argumentsMap.get("--default-state") ?? 906,
    "defaultState",
  );
  const retrievedAt = new Date().toISOString();
  const tileExtension = tileSize === 768 ? "webp" : "png";
  const previousManifest = readJsonIfPresent(
    join(rawOutputDirectory, "manifest.json"),
  );
  const translations = loadKuroTranslations(
    resolve(
      argumentsMap.get("--translations") ??
        "tools/kuro-map-translations.vi.json",
    ),
  );

  const [resourceHash, mapIdList, selection] = await Promise.all([
    postApi("/map/core/config/getMapResource"),
    postApi("/map/core/config/getMapIdList"),
    fetchJson(
      `${API_ORIGIN}/map/core/position/getMapStateSelection?_t=${Date.now()}`,
      {
        headers: {
          origin: "https://www.kurobbs.com",
          referer: "https://www.kurobbs.com/",
        },
      },
    ).then((payload) => {
      if (payload?.code !== 200) {
        throw new Error("Không tải được danh sách state.");
      }
      return payload.data;
    }),
  ]);
  const countryPath = join(rawOutputDirectory, "country.json");
  const areaPath = join(rawOutputDirectory, "area.json");
  const catalogRelationPath = join(
    rawOutputDirectory,
    "catalogRelation.json",
  );
  const [countryData, areaData, catalogRelationData] = await Promise.all([
    fetchJsonWithCache(
      `${CDN_ORIGIN}/mcmap/country/${resourceHash}/country.json`,
      countryPath,
    ),
    fetchJsonWithCache(
      `${CDN_ORIGIN}/mcmap/area/${resourceHash}/area.json`,
      areaPath,
    ),
    fetchJsonWithCache(
      `${CDN_ORIGIN}/mcmap/catalog/${resourceHash}/catalogRelation.json`,
      catalogRelationPath,
    ),
  ]);
  const refreshTiles =
    argumentsMap.get("--refresh-tiles") === "true" ||
    previousManifest?.resourceHash !== resourceHash ||
    previousManifest?.tileSize !== tileSize;
  const availableStateIds = Object.keys(mapIdList)
    .map(Number)
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
  const stateIds = selectedStateIds(
    argumentsMap.get("--states"),
    availableStateIds,
  );
  if (!stateIds.includes(defaultStateId)) {
    throw new Error("Default state phải nằm trong danh sách state được crawl.");
  }

  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(rawOutputDirectory, { recursive: true });
  writeJson(join(rawOutputDirectory, "map-id-list.json"), mapIdList);
  writeJson(join(rawOutputDirectory, "state-selection.json"), selection);
  writeJson(countryPath, countryData);
  writeJson(areaPath, areaData);
  writeJson(catalogRelationPath, catalogRelationData);

  const mapDefinitions = buildOfficialMapDefinitions(countryData, translations);
  const previousCatalog = readJsonIfPresent(
    join(outputDirectory, "catalog.json"),
  );
  const previousMapFileNames = new Set(
    (previousCatalog?.maps ?? [])
      .map((entry) => basename(String(entry.pack ?? "")))
      .filter((fileName) => fileName.endsWith(".json")),
  );
  const catalogEntries = [];
  const expectedMapFileNames = new Set();
  const iconOutputDirectory = join(outputDirectory, "icons");
  const iconWebPathBySource = new Map();
  const expectedIconNames = new Set();
  let totalMarkers = 0;
  let totalLayerTiles = 0;

  for (const stateId of stateIds) {
    console.log(`State ${stateId}: tải metadata...`);
    const stateRawDirectory = join(rawOutputDirectory, String(stateId));
    const positionPath = join(stateRawDirectory, "position.json");
    const catalogPath = join(stateRawDirectory, "catalog.json");
    const layerPath = join(stateRawDirectory, "layer.json");
    const positionUrl = `${CDN_ORIGIN}/mcmap/position/${stateId}/position.json`;
    const catalogUrl =
      `${CDN_ORIGIN}/mcmap/catalog/${resourceHash}/${stateId}/catalog.json`;
    const layerUrl =
      `${CDN_ORIGIN}/mcmap/layer/${resourceHash}/${stateId}/layer.json`;

    const [positionData, , layerData] = await Promise.all([
      fetchJsonWithCache(positionUrl, positionPath),
      fetchJsonWithCache(catalogUrl, catalogPath),
      fetchJsonWithCache(layerUrl, layerPath),
    ]);

    const layout = parseTileLayout(mapIdList[String(stateId)], stateId);
    const tileOutputDirectory = join(
      outputDirectory,
      "maps",
      String(stateId),
    );
    const tileWebPrefix = `map-packs/private/maps/${stateId}`;
    const layerEntries = buildLayerEntries({
      stateId,
      layerData,
      layout,
      tileSize,
      tileExtension,
      translations,
    });
    const expectedTileNames = new Set(
      layout.tiles.map(
        (tile) => `${tile.column}_${tile.leafletY}.${tileExtension}`,
      ),
    );
    const tasks = layout.tiles.map((tile) => async () => {
      const sourceUrl =
        `${CDN_ORIGIN}/mcmap/tiles/${resourceHash}/${stateId}/${tile.id}.png` +
        (tileSize === 768
          ? "?x-oss-process=image/format,webp/resize,w_768,h_768"
          : "");
      await downloadFile(
        sourceUrl,
        join(
          tileOutputDirectory,
          `${tile.column}_${tile.leafletY}.${tileExtension}`,
        ),
        refreshTiles,
      );
    });
    removeStaleTiles(tileOutputDirectory, expectedTileNames);

    for (const item of positionData) {
      if (
        typeof item.icon !== "string" ||
        iconWebPathBySource.has(item.icon)
      ) {
        continue;
      }
      const fileName = iconFileName(item.icon);
      expectedIconNames.add(fileName);
      iconWebPathBySource.set(
        item.icon,
        `map-packs/private/icons/${fileName}`,
      );
      tasks.push(async () => {
        await downloadFile(
          `${CDN_ORIGIN}/${item.icon}` +
            "?x-oss-process=image/format,webp/resize,w_96,h_96",
          join(iconOutputDirectory, fileName),
          refreshTiles,
        );
      });
    }

    for (const layer of layerEntries) {
      const layerOutputDirectory = join(
        outputDirectory,
        "layers",
        String(stateId),
        layer.directoryName,
      );
      const expectedLayerTiles = new Set(
        layer.sourceTiles.map(
          (tile) => `${tile.column}_${tile.leafletY}.${tileExtension}`,
        ),
      );
      removeStaleTiles(layerOutputDirectory, expectedLayerTiles);
      for (const tile of layer.sourceTiles) {
        tasks.push(async () => {
          await downloadFile(
            `${CDN_ORIGIN}/mcmap/tiles/${resourceHash}/${stateId}` +
              `${tile.tilePath}` +
              (tileSize === 768
                ? "?x-oss-process=image/format,webp/resize,w_768,h_768"
                : ""),
            join(
              layerOutputDirectory,
              `${tile.column}_${tile.leafletY}.${tileExtension}`,
            ),
            refreshTiles,
          );
        });
      }
      totalLayerTiles += layer.sourceTiles.length;
    }

    let lastReported = 0;
    await runPool(tasks, concurrency, (completed, total) => {
      const percentage = Math.floor((completed / total) * 100);
      if (percentage >= lastReported + 10 || completed === total) {
        lastReported = percentage;
        console.log(`State ${stateId}: tile ${completed}/${total}`);
      }
    });

    const stateDefinitions = mapDefinitions.filter(
      (definition) => definition.stateId === stateId,
    );
    if (stateDefinitions.length === 0) {
      throw new Error(`Không có atlas chính thức cho state ${stateId}.`);
    }
    const locationAssignments = assignOfficialLocationIds(
      positionData,
      stateDefinitions,
    );
    const mapPacks = stateDefinitions.map((definition) => {
      const officialAreas = definition.areas.map((area) => ({
        id: area.id,
        label: area.label,
        anchor: gameToLocalPixel(
          area.anchor.x,
          area.anchor.y,
          tileSize,
          layout,
        ),
      }));
      return buildKuroMapPack({
        stateId,
        stateName: definition.title,
        countryId: definition.countryId,
        mapId: definition.id,
        progressMapId: definition.progressMapId,
        locationIds: locationAssignments.get(definition.id),
        areas: officialAreas,
        areasUseLocalAnchors: true,
        tileSize,
        tileExtension,
        tileWebPrefix,
        layout,
        positionData,
        iconWebPathBySource,
        layerEntries,
        retrievedAt,
        translations,
      });
    });

    for (let index = 0; index < mapPacks.length; index += 1) {
      const mapPack = mapPacks[index];
      const definition = stateDefinitions[index];
      const outputName = definition.outputName;
      writeJson(
        join(outputDirectory, "maps", `${outputName}.json`),
        mapPack,
      );
      catalogEntries.push({
        id: mapPack.id,
        title: mapPack.title,
        pack: `map-packs/private/maps/${outputName}.json`,
        areas: mapPack.areas?.map(({ id, label, bounds }) => ({
          id,
          label,
          bounds,
        })),
      });
      expectedMapFileNames.add(`${outputName}.json`);
      totalMarkers += mapPack.markers.length;
    }
    const markerTotal = mapPacks.reduce(
      (total, pack) => total + pack.markers.length,
      0,
    );
    const categoryTotal = mapPacks.reduce(
      (total, pack) => total + pack.categories.length,
      0,
    );
    console.log(
      `State ${stateId}: ${markerTotal} marker, ` +
        `${categoryTotal} loại điểm.`,
    );
  }

  for (const fileName of previousMapFileNames) {
    if (!expectedMapFileNames.has(fileName)) {
      const stalePath = join(outputDirectory, "maps", fileName);
      if (existsSync(stalePath)) {
        unlinkSync(stalePath);
      }
    }
  }

  if (stateIds.length === availableStateIds.length) {
    removeStaleIcons(iconOutputDirectory, expectedIconNames);
  }

  const definitionOrder = new Map(
    mapDefinitions.map((definition, index) => [definition.id, index]),
  );
  const defaultMapId =
    mapDefinitions.find((definition) => definition.stateId === defaultStateId)
      ?.id ?? mapDefinitions[0].id;
  catalogEntries.sort((left, right) => {
    if (left.id === defaultMapId) return -1;
    if (right.id === defaultMapId) return 1;
    return (
      (definitionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (definitionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id, "vi", { numeric: true })
    );
  });
  writeJson(join(outputDirectory, "catalog.json"), {
    schemaVersion: 1,
    defaultMapId,
    maps: catalogEntries,
    groups: buildCatalogGroups(catalogEntries, mapDefinitions),
  });
  writeJson(join(rawOutputDirectory, "manifest.json"), {
    schemaVersion: 1,
    source: "https://www.kurobbs.com/map/",
    resourceHash,
    retrievedAt,
    tileSize,
    iconSize: 96,
    states: stateIds,
    maps: mapDefinitions
      .filter((definition) => stateIds.includes(definition.stateId))
      .map((definition) => definition.id),
  });
  console.log(
    `Hoàn tất: ${stateIds.length} map, ${totalMarkers} marker, ` +
      `${totalLayerTiles} layer tile, ${outputDirectory}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
