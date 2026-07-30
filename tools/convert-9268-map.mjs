import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_ITEM_IDS = [
  "qzx_01",
  "qzx_02",
  "qzx_03",
  "qzx_04",
];
const CATEGORY_COLORS = [
  "#8bd3c7",
  "#f8c963",
  "#b8a1ff",
  "#f07e83",
  "#6cc8ee",
  "#9fdb72",
];
const ID_PATTERN = /^[a-zA-Z0-9:_-]{1,128}$/;

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} phải là số nguyên dương.`);
  }
  return value;
}

function assertItemIds(itemIds) {
  if (
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    !itemIds.every((itemId) => ID_PATTERN.test(itemId))
  ) {
    throw new Error("Danh sách item ID không hợp lệ.");
  }
}

function readCoordinateReference(coordsPath, stateId) {
  const payload = JSON.parse(readFileSync(coordsPath, "utf8"));
  const reference = payload[String(stateId)];
  if (
    typeof reference !== "object" ||
    reference === null ||
    !Array.isArray(reference.offset) ||
    !Array.isArray(reference.scale) ||
    !Array.isArray(reference.min) ||
    !Array.isArray(reference.max) ||
    reference.offset.length !== 2 ||
    reference.scale.length !== 2 ||
    reference.min.length !== 2 ||
    reference.max.length !== 2 ||
    ![
      ...reference.offset,
      ...reference.scale,
      ...reference.min,
      ...reference.max,
    ].every(Number.isFinite) ||
    reference.scale.some((value) => value <= 0)
  ) {
    throw new Error(`Không có coordinate reference hợp lệ cho state ${stateId}.`);
  }
  return reference;
}

function roundCoordinate(value) {
  return Math.round(value * 1000) / 1000;
}

function markerDescription(row) {
  const parts = [];
  const floorId = row.floor_id?.trim();
  const description = row.description?.trim();
  if (floorId) {
    parts.push(`Tầng ${floorId}`);
  }
  if (description) {
    parts.push(description);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function buildMapPack({
  databasePath,
  coordsPath,
  stateId,
  countryId,
  itemIds = DEFAULT_ITEM_IDS,
  imageSrc,
  imageWidth,
  imageHeight,
}) {
  assertPositiveInteger(stateId, "stateId");
  if (countryId !== undefined) {
    assertPositiveInteger(countryId, "countryId");
  }
  assertItemIds(itemIds);
  assertPositiveInteger(imageWidth, "imageWidth");
  assertPositiveInteger(imageHeight, "imageHeight");
  if (typeof imageSrc !== "string" || imageSrc.trim().length === 0) {
    throw new Error("imageSrc không hợp lệ.");
  }

  const coordinateReference = readCoordinateReference(coordsPath, stateId);
  const [offsetX, offsetY] = coordinateReference.offset;
  const [scaleX, scaleY] = coordinateReference.scale;
  const sourceWidth =
    (coordinateReference.max[0] - coordinateReference.min[0]) / scaleX;
  const sourceHeight =
    (coordinateReference.max[1] - coordinateReference.min[1]) / scaleY;
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error("Kích thước map nguồn không hợp lệ.");
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const state = database
      .prepare("SELECT id, name FROM state WHERE id = ?")
      .get(stateId);
    if (!state) {
      throw new Error(`Không tìm thấy state ${stateId}.`);
    }

    const placeholders = itemIds.map(() => "?").join(", ");
    const itemRows = database
      .prepare(`
        SELECT id, name
        FROM item
        WHERE id IN (${placeholders})
      `)
      .all(...itemIds);
    const itemById = new Map(itemRows.map((item) => [item.id, item]));
    const missingItemIds = itemIds.filter((itemId) => !itemById.has(itemId));
    if (missingItemIds.length > 0) {
      throw new Error(`Không tìm thấy item: ${missingItemIds.join(", ")}.`);
    }

    const locationRows = database
      .prepare(`
        SELECT
          l.id,
          l.item_id,
          l.floor_id,
          l.level,
          l.x,
          l.y,
          l.description
        FROM location AS l
        WHERE l.state_id = ?
          AND (? IS NULL OR l.country_id = ?)
          AND l.item_id IN (${placeholders})
          AND l.x IS NOT NULL
          AND l.y IS NOT NULL
        ORDER BY l.item_id, l.id
      `)
      .all(
        stateId,
        countryId ?? null,
        countryId ?? null,
        ...itemIds,
      );

    const markers = [];
    for (const row of locationRows) {
      const sourceX = (row.x - offsetX) / scaleX;
      const sourceY = (row.y - offsetY) / scaleY;
      if (
        sourceX < 0 ||
        sourceX > sourceWidth ||
        sourceY < 0 ||
        sourceY > sourceHeight
      ) {
        continue;
      }

      markers.push({
        id: `9268:${row.id}`,
        categoryId: row.item_id,
        title: itemById.get(row.item_id).name,
        x: roundCoordinate((sourceX / sourceWidth) * imageWidth),
        y: roundCoordinate((sourceY / sourceHeight) * imageHeight),
        description: markerDescription(row),
      });
    }

    if (markers.length === 0) {
      throw new Error("Không có marker nào nằm trong phạm vi ảnh map.");
    }

    return {
      schemaVersion: 1,
      id: `wuwa-9268-state-${stateId}`,
      title: state.name,
      subtitle: `${markers.length} điểm · ${itemIds.join(", ")}`,
      attribution:
        "Dữ liệu tổng hợp: 9268/wuwa-map (MIT). Bản đồ và dữ liệu game gốc thuộc KURO GAMES.",
      image: {
        src: imageSrc,
        width: imageWidth,
        height: imageHeight,
      },
      categories: itemIds.map((itemId, index) => ({
        id: itemId,
        label: itemById.get(itemId).name,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
        symbol: String(index + 1),
      })),
      markers,
    };
  } finally {
    database.close();
  }
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

function requiredArgument(values, name) {
  const value = values.get(name);
  if (!value) {
    throw new Error(`Thiếu tham số ${name}.`);
  }
  return value;
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  node tools/convert-9268-map.mjs --db <map_items.db> --coords <map_coords.json> \\",
  );
  console.log(
    "    --state 906 --country 4 --image <public image path> \\",
  );
  console.log(
    "    --image-width 4973 --image-height 4956 --output <map-pack.json> \\",
  );
  console.log("    [--items qzx_01,qzx_02,qzx_03,qzx_04]");
}

async function main() {
  if (process.argv.includes("--help")) {
    printUsage();
    return;
  }

  const argumentsMap = parseArguments(process.argv.slice(2));
  const outputPath = resolve(requiredArgument(argumentsMap, "--output"));
  const mapPack = buildMapPack({
    databasePath: resolve(requiredArgument(argumentsMap, "--db")),
    coordsPath: resolve(requiredArgument(argumentsMap, "--coords")),
    stateId: Number(requiredArgument(argumentsMap, "--state")),
    countryId: argumentsMap.has("--country")
      ? Number(argumentsMap.get("--country"))
      : undefined,
    itemIds: argumentsMap.has("--items")
      ? argumentsMap
          .get("--items")
          .split(",")
          .map((itemId) => itemId.trim())
          .filter(Boolean)
      : DEFAULT_ITEM_IDS,
    imageSrc: requiredArgument(argumentsMap, "--image"),
    imageWidth: Number(requiredArgument(argumentsMap, "--image-width")),
    imageHeight: Number(requiredArgument(argumentsMap, "--image-height")),
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(mapPack, null, 2)}\n`, "utf8");
  console.log(`Map pack: ${outputPath}`);
  console.log(`Markers: ${mapPack.markers.length}`);
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
