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
import { dirname, join, resolve } from "node:path";
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

export function buildKuroMapPack({
  stateId,
  stateName,
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
  const items = positionData.filter(
    (item) =>
      Array.isArray(item.location) &&
      item.location.some(
        (location) =>
          location.stateId === stateId &&
          Number.isFinite(location.x) &&
          Number.isFinite(location.y),
      ),
  );
  const groupByItemId = new Map(
    items.map((item) => [String(item.id), itemGroup(item)]),
  );
  const markers = [];

  for (const item of items) {
    const itemId = String(item.id);
    const title = localizeKuroText(
      CHEST_LABELS.get(itemId) ?? item.name?.trim() ?? itemId,
      translations,
    );
    for (const location of item.location) {
      if (
        location.stateId !== stateId ||
        !Number.isFinite(location.x) ||
        !Number.isFinite(location.y)
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
        pixel.y > height
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

  const usedGroupIds = new Set(
    items.map((item) => groupByItemId.get(String(item.id)).id),
  );
  const chestIds = items
    .map((item) => String(item.id))
    .filter((itemId) => itemId.startsWith("qzx_"));

  return {
    schemaVersion: 1,
    id: `wuwa-kuro-state-${stateId}`,
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
      availableTiles: layout.tiles.map(
        (tile) => `${tile.column},${tile.leafletY}`,
      ),
    },
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
    layers: layerEntries.length > 0
      ? layerEntries.map(
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

  const names = stateNames(selection);
  const catalogEntries = [];
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

    const mapPack = buildKuroMapPack({
      stateId,
      stateName: names.get(stateId),
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
    writeJson(join(outputDirectory, "maps", `${stateId}.json`), mapPack);
    catalogEntries.push({
      id: mapPack.id,
      title: mapPack.title,
      pack: `map-packs/private/maps/${stateId}.json`,
    });
    totalMarkers += mapPack.markers.length;
    console.log(
      `State ${stateId}: ${mapPack.markers.length} marker, ` +
        `${mapPack.categories.length} loại điểm.`,
    );
  }

  if (stateIds.length === availableStateIds.length) {
    removeStaleIcons(iconOutputDirectory, expectedIconNames);
  }

  catalogEntries.sort((left, right) => {
    const defaultMapId = `wuwa-kuro-state-${defaultStateId}`;
    if (left.id === defaultMapId) return -1;
    if (right.id === defaultMapId) return 1;
    return left.id.localeCompare(right.id, "vi", { numeric: true });
  });
  writeJson(join(outputDirectory, "catalog.json"), {
    schemaVersion: 1,
    defaultMapId: `wuwa-kuro-state-${defaultStateId}`,
    maps: catalogEntries,
  });
  writeJson(join(rawOutputDirectory, "manifest.json"), {
    schemaVersion: 1,
    source: "https://www.kurobbs.com/mc/map/",
    resourceHash,
    retrievedAt,
    tileSize,
    iconSize: 96,
    states: stateIds,
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
