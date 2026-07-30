import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildMapPack } from "./convert-9268-map.mjs";

function readUInt24LE(buffer, offset) {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16)
  );
}

function readPngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  ) {
    throw new Error("PNG không hợp lệ.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("WebP không hợp lệ.");
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) {
      throw new Error("WebP chunk không hợp lệ.");
    }

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        width: readUInt24LE(buffer, dataOffset + 4) + 1,
        height: readUInt24LE(buffer, dataOffset + 7) + 1,
      };
    }
    if (chunkType === "VP8 " && chunkSize >= 10) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (
      chunkType === "VP8L" &&
      chunkSize >= 5 &&
      buffer[dataOffset] === 0x2f
    ) {
      const byte1 = buffer[dataOffset + 1];
      const byte2 = buffer[dataOffset + 2];
      const byte3 = buffer[dataOffset + 3];
      const byte4 = buffer[dataOffset + 4];
      return {
        width: 1 + (((byte2 & 0x3f) << 8) | byte1),
        height:
          1 +
          (((byte4 & 0x0f) << 10) |
            (byte3 << 2) |
            ((byte2 & 0xc0) >> 6)),
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("Không tìm thấy kích thước trong WebP.");
}

export function readImageDimensions(imagePath) {
  const buffer = readFileSync(imagePath);
  const extension = extname(imagePath).toLowerCase();
  if (extension === ".png") {
    return readPngDimensions(buffer);
  }
  if (extension === ".webp") {
    return readWebpDimensions(buffer);
  }
  throw new Error(`Định dạng ảnh không được hỗ trợ: ${extension}`);
}

export function createMapCatalog({ defaultMapId, entries }) {
  if (
    typeof defaultMapId !== "string" ||
    !Array.isArray(entries) ||
    entries.length === 0 ||
    !entries.some((entry) => entry.id === defaultMapId)
  ) {
    throw new Error("Map catalog không hợp lệ.");
  }

  return {
    schemaVersion: 1,
    defaultMapId,
    maps: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      pack: entry.pack,
    })),
  };
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

function findMapImage(imagesDirectory, stateId) {
  for (const extension of [".webp", ".png"]) {
    const candidate = join(imagesDirectory, `${stateId}${extension}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Không tìm thấy ảnh cho state ${stateId}.`);
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  node tools/build-9268-catalog.mjs --db <map_items.db> \\",
  );
  console.log(
    "    --coords <map_coords.json> --images <private maps dir> \\",
  );
  console.log(
    "    --output <public/map-packs/private> [--default-state 906] \\",
  );
  console.log("    [--web-prefix map-packs/private/maps]");
}

async function main() {
  if (process.argv.includes("--help")) {
    printUsage();
    return;
  }

  const argumentsMap = parseArguments(process.argv.slice(2));
  const databasePath = resolve(requiredArgument(argumentsMap, "--db"));
  const coordsPath = resolve(requiredArgument(argumentsMap, "--coords"));
  const imagesDirectory = resolve(requiredArgument(argumentsMap, "--images"));
  const outputDirectory = resolve(requiredArgument(argumentsMap, "--output"));
  const mapsOutputDirectory = join(outputDirectory, "maps");
  const defaultStateId = Number(argumentsMap.get("--default-state") ?? "906");
  const webPrefix =
    argumentsMap.get("--web-prefix") ?? "map-packs/private/maps";
  const coordinates = JSON.parse(readFileSync(coordsPath, "utf8"));
  const stateIds = Object.keys(coordinates)
    .map(Number)
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
  if (!stateIds.includes(defaultStateId)) {
    throw new Error(`Default state ${defaultStateId} không tồn tại.`);
  }

  mkdirSync(mapsOutputDirectory, { recursive: true });
  const entries = [];
  let totalMarkers = 0;

  for (const stateId of stateIds) {
    const imagePath = findMapImage(imagesDirectory, stateId);
    const dimensions = readImageDimensions(imagePath);
    const imageName = basename(imagePath);
    const mapPack = buildMapPack({
      databasePath,
      coordsPath,
      stateId,
      itemIds: "all",
      imageSrc: `${webPrefix}/${imageName}`,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    });
    const packName = `${stateId}.json`;
    writeJson(join(mapsOutputDirectory, packName), mapPack);
    entries.push({
      id: mapPack.id,
      title: `Khu vực ${stateId}`,
      pack: `${webPrefix}/${packName}`,
    });
    totalMarkers += mapPack.markers.length;
  }

  entries.sort((left, right) => {
    const defaultMapId = `wuwa-9268-state-${defaultStateId}`;
    if (left.id === defaultMapId) {
      return -1;
    }
    if (right.id === defaultMapId) {
      return 1;
    }
    return left.id.localeCompare(right.id, "vi", { numeric: true });
  });

  const catalog = createMapCatalog({
    defaultMapId: `wuwa-9268-state-${defaultStateId}`,
    entries,
  });
  writeJson(join(outputDirectory, "catalog.json"), catalog);
  console.log(`Catalog: ${join(outputDirectory, "catalog.json")}`);
  console.log(`Maps: ${entries.length}`);
  console.log(`Markers: ${totalMarkers}`);
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
