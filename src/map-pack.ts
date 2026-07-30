import type {
  BackupPayload,
  MapCategory,
  MapMarker,
  MapPack,
  Profile,
  ProgressRecord,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAllowedImageSource(value: string): boolean {
  if (value.startsWith("data:")) {
    return value.startsWith("data:image/");
  }

  try {
    const url = new URL(value, "https://map-pack.local/");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function assertCategory(value: unknown, index: number): asserts value is MapCategory {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.symbol) ||
    !isNonEmptyString(value.color)
  ) {
    throw new Error(`Danh mục #${index + 1} không hợp lệ.`);
  }

  if (!/^#[0-9a-f]{6}$/i.test(value.color)) {
    throw new Error(`Màu của danh mục "${value.label}" phải có dạng #RRGGBB.`);
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
}

export function parseMapPack(value: unknown): MapPack {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.attribution) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.markers)
  ) {
    throw new Error("Map pack không đúng schema version 1.");
  }

  const image = value.image;
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
    throw new Error("Thông tin basemap không hợp lệ.");
  }

  value.categories.forEach(assertCategory);
  const categoryIds = new Set(value.categories.map((category) => category.id));
  const categoryIdCount = categoryIds.size;
  if (categoryIdCount !== value.categories.length) {
    throw new Error("Map pack có category id bị trùng.");
  }

  value.markers.forEach((marker, index) =>
    assertMarker(
      marker,
      index,
      categoryIds,
      imageWidth,
      imageHeight,
    ),
  );

  const markerIds = new Set(value.markers.map((marker) => marker.id));
  if (markerIds.size !== value.markers.length) {
    throw new Error("Map pack có marker id bị trùng.");
  }

  return value as unknown as MapPack;
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
