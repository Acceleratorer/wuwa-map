import type {
  BackupPayload,
  MapCategory,
  MapCategoryGroup,
  MapCatalog,
  MapFloorLayer,
  MapIconName,
  MapMarker,
  MapPack,
  MapTileSource,
  Profile,
  ProgressRecord,
} from "./types";

const MAP_ICON_NAMES = new Set<MapIconName>([
  "activity",
  "boss",
  "chest",
  "collection",
  "default",
  "elite",
  "enemy",
  "exploration",
  "location",
  "resource",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMapIconName(value: unknown): value is MapIconName {
  return typeof value === "string" && MAP_ICON_NAMES.has(value as MapIconName);
}

function isAllowedResourceSource(value: string): boolean {
  try {
    const url = new URL(value, "https://map-pack.local/");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isAllowedImageSource(value: string): boolean {
  return value.startsWith("data:")
    ? value.startsWith("data:image/")
    : isAllowedResourceSource(value);
}

function assertTileSource(
  value: unknown,
  label: string,
): asserts value is MapTileSource {
  const tileSource = isRecord(value) ? value.src : undefined;
  const tileSize = isRecord(value) ? value.tileSize : undefined;
  const columns = isRecord(value) ? value.columns : undefined;
  const rows = isRecord(value) ? value.rows : undefined;
  const availableTiles = isRecord(value) ? value.availableTiles : undefined;
  if (
    !isRecord(value) ||
    !isNonEmptyString(tileSource) ||
    !isAllowedResourceSource(tileSource) ||
    !isFiniteNumber(tileSize) ||
    !isFiniteNumber(columns) ||
    !isFiniteNumber(rows) ||
    !Number.isInteger(tileSize) ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    tileSize <= 0 ||
    columns <= 0 ||
    rows <= 0 ||
    !tileSource.includes("{x}") ||
    !tileSource.includes("{y}") ||
    (
      availableTiles !== undefined &&
      (
        !Array.isArray(availableTiles) ||
        new Set(availableTiles).size !== availableTiles.length ||
        !availableTiles.every((tile) => {
          if (typeof tile !== "string") {
            return false;
          }
          const match = /^(-?\d+),(-?\d+)$/.exec(tile);
          if (!match) {
            return false;
          }
          const x = Number(match[1]);
          const y = Number(match[2]);
          return x >= 0 && x < columns && y >= -rows && y < 0;
        })
      )
    )
  ) {
    throw new Error(`${label} không hợp lệ.`);
  }
}

export function mapPackDimensions(pack: MapPack): {
  width: number;
  height: number;
} {
  if (pack.image) {
    return {
      width: pack.image.width,
      height: pack.image.height,
    };
  }
  if (pack.tiles) {
    return {
      width: pack.tiles.tileSize * pack.tiles.columns,
      height: pack.tiles.tileSize * pack.tiles.rows,
    };
  }
  throw new Error("Map pack không có basemap.");
}

function assertCategory(value: unknown, index: number): asserts value is MapCategory {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.symbol) ||
    !isNonEmptyString(value.color) ||
    (value.groupId !== undefined && !isNonEmptyString(value.groupId)) ||
    (value.icon !== undefined && !isMapIconName(value.icon)) ||
    (
      value.imageSrc !== undefined &&
      (
        !isNonEmptyString(value.imageSrc) ||
        !isAllowedImageSource(value.imageSrc)
      )
    )
  ) {
    throw new Error(`Danh mục #${index + 1} không hợp lệ.`);
  }

  if (!/^#[0-9a-f]{6}$/i.test(value.color)) {
    throw new Error(`Màu của danh mục "${value.label}" phải có dạng #RRGGBB.`);
  }
}

function assertCategoryGroup(
  value: unknown,
  index: number,
): asserts value is MapCategoryGroup {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isMapIconName(value.icon)
  ) {
    throw new Error(`Nhóm danh mục #${index + 1} không hợp lệ.`);
  }
}

function assertMarker(
  value: unknown,
  index: number,
  categoryIds: Set<string>,
  width: number,
  height: number,
): asserts value is MapMarker {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.categoryId) ||
    !isNonEmptyString(value.title) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y)
  ) {
    throw new Error(`Marker #${index + 1} không hợp lệ.`);
  }

  if (!categoryIds.has(value.categoryId)) {
    throw new Error(`Marker "${value.title}" dùng categoryId không tồn tại.`);
  }

  if (value.x < 0 || value.x > width || value.y < 0 || value.y > height) {
    throw new Error(`Marker "${value.title}" nằm ngoài kích thước bản đồ.`);
  }

  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error(`Mô tả của marker "${value.title}" không hợp lệ.`);
  }
  if (
    (value.floorId !== undefined && !isNonEmptyString(value.floorId)) ||
    (value.levelId !== undefined && !isNonEmptyString(value.levelId))
  ) {
    throw new Error(`Thông tin tầng của marker "${value.title}" không hợp lệ.`);
  }
}

function assertFloorLayer(
  value: unknown,
  index: number,
): asserts value is MapFloorLayer {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.groupId) ||
    !isNonEmptyString(value.groupLabel)
  ) {
    throw new Error(`Tầng bản đồ #${index + 1} không hợp lệ.`);
  }
  assertTileSource(value.tiles, `Tile của tầng "${value.label}"`);
}

function assertInitialView(
  value: unknown,
  width: number,
  height: number,
): void {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.minX) ||
    !isFiniteNumber(value.minY) ||
    !isFiniteNumber(value.maxX) ||
    !isFiniteNumber(value.maxY) ||
    value.minX < 0 ||
    value.minY < 0 ||
    value.maxX > width ||
    value.maxY > height ||
    value.minX >= value.maxX ||
    value.minY >= value.maxY
  ) {
    throw new Error("Initial map view bounds are invalid.");
  }
}

export function parseMapPack(value: unknown): MapPack {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.id) ||
    (value.progressMapId !== undefined &&
      !isNonEmptyString(value.progressMapId)) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.attribution) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.markers)
  ) {
    throw new Error("Map pack không đúng schema version 1.");
  }

  const image = value.image;
  const tiles = value.tiles;
  const hasImage = image !== undefined;
  const hasTiles = tiles !== undefined;
  if (hasImage === hasTiles) {
    throw new Error("Map pack phải có đúng một loại basemap.");
  }

  let mapWidth: number;
  let mapHeight: number;
  if (hasImage) {
    const imageSource = isRecord(image) ? image.src : undefined;
    const imageWidth = isRecord(image) ? image.width : undefined;
    const imageHeight = isRecord(image) ? image.height : undefined;
    if (
      !isRecord(image) ||
      !isNonEmptyString(imageSource) ||
      !isAllowedImageSource(imageSource) ||
      !isFiniteNumber(imageWidth) ||
      !isFiniteNumber(imageHeight) ||
      imageWidth <= 0 ||
      imageHeight <= 0
    ) {
      throw new Error("Thông tin basemap ảnh không hợp lệ.");
    }
    mapWidth = imageWidth;
    mapHeight = imageHeight;
  } else {
    assertTileSource(tiles, "Thông tin basemap tile");
    mapWidth = tiles.tileSize * tiles.columns;
    mapHeight = tiles.tileSize * tiles.rows;
  }

  if (value.bounds !== undefined) {
    assertInitialView(value.bounds, mapWidth, mapHeight);
  }
  if (value.initialView !== undefined) {
    assertInitialView(value.initialView, mapWidth, mapHeight);
  }

  value.categories.forEach(assertCategory);
  const categoryIds = new Set(value.categories.map((category) => category.id));
  const categoryIdCount = categoryIds.size;
  if (categoryIdCount !== value.categories.length) {
    throw new Error("Map pack có category id bị trùng.");
  }

  if (value.categoryGroups !== undefined) {
    if (!Array.isArray(value.categoryGroups) || value.categoryGroups.length === 0) {
      throw new Error("Danh sách nhóm category không hợp lệ.");
    }
    value.categoryGroups.forEach(assertCategoryGroup);
    const categoryGroupIds = new Set(
      value.categoryGroups.map((group) => group.id),
    );
    if (categoryGroupIds.size !== value.categoryGroups.length) {
      throw new Error("Map pack có category group id bị trùng.");
    }
    if (
      value.categories.some(
        (category) =>
          category.groupId !== undefined &&
          !categoryGroupIds.has(category.groupId),
      )
    ) {
      throw new Error("Category dùng groupId không tồn tại.");
    }
  } else if (
    value.categories.some((category) => category.groupId !== undefined)
  ) {
    throw new Error("Map pack thiếu danh sách categoryGroups.");
  }

  if (value.layers !== undefined) {
    if (!Array.isArray(value.layers) || value.layers.length === 0) {
      throw new Error("Danh sách tầng bản đồ không hợp lệ.");
    }
    value.layers.forEach(assertFloorLayer);
    const layerIds = new Set(value.layers.map((layer) => layer.id));
    if (layerIds.size !== value.layers.length) {
      throw new Error("Map pack có id tầng bản đồ bị trùng.");
    }
  }

  value.markers.forEach((marker, index) =>
    assertMarker(
      marker,
      index,
      categoryIds,
      mapWidth,
      mapHeight,
    ),
  );

  const markerIds = new Set(value.markers.map((marker) => marker.id));
  if (markerIds.size !== value.markers.length) {
    throw new Error("Map pack có marker id bị trùng.");
  }

  if (
    value.defaultVisibleCategoryIds !== undefined &&
    (
      !Array.isArray(value.defaultVisibleCategoryIds) ||
      !value.defaultVisibleCategoryIds.every(
        (categoryId) =>
          isNonEmptyString(categoryId) && categoryIds.has(categoryId),
      ) ||
      new Set(value.defaultVisibleCategoryIds).size !==
        value.defaultVisibleCategoryIds.length
    )
  ) {
    throw new Error("Danh sách category mặc định không hợp lệ.");
  }

  return value as unknown as MapPack;
}

export function parseMapCatalog(value: unknown): MapCatalog {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.defaultMapId) ||
    !Array.isArray(value.maps) ||
    value.maps.length === 0 ||
    !value.maps.every(
      (entry) =>
        isRecord(entry) &&
        isNonEmptyString(entry.id) &&
        isNonEmptyString(entry.title) &&
        isNonEmptyString(entry.pack) &&
        isAllowedResourceSource(entry.pack),
    )
  ) {
    throw new Error("Map catalog không đúng schema version 1.");
  }

  const mapIds = new Set(value.maps.map((entry) => entry.id));
  if (
    mapIds.size !== value.maps.length ||
    !mapIds.has(value.defaultMapId)
  ) {
    throw new Error("Map catalog có id bị trùng hoặc defaultMapId không tồn tại.");
  }

  return value as unknown as MapCatalog;
}

function isProfile(value: unknown): value is Profile {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.createdAt)
  );
}

function isProgressRecord(value: unknown): value is ProgressRecord {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.mapId) &&
    isNonEmptyString(value.markerId) &&
    isNonEmptyString(value.profileId) &&
    typeof value.done === "boolean" &&
    isNonEmptyString(value.updatedAt)
  );
}

export function parseBackup(value: unknown): BackupPayload {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.exportedAt) ||
    !Array.isArray(value.profiles) ||
    !Array.isArray(value.progress) ||
    !Array.isArray(value.settings) ||
    !value.profiles.every(isProfile) ||
    !value.progress.every(isProgressRecord) ||
    !value.settings.every(
      (setting) => isRecord(setting) && isNonEmptyString(setting.key),
    )
  ) {
    throw new Error("File backup không đúng định dạng.");
  }

  return value as unknown as BackupPayload;
}
