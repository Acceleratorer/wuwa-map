import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createMapCatalog,
  readImageDimensions,
} from "./build-9268-catalog.mjs";

test("catalog builder reads PNG dimensions and creates lazy map entries", () => {
  const directory = mkdtempSync(join(tmpdir(), "wayfinder-catalog-"));
  const imagePath = join(directory, "906.png");
  const pngHeader = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(pngHeader, 0);
  pngHeader.writeUInt32BE(4973, 16);
  pngHeader.writeUInt32BE(4956, 20);
  writeFileSync(imagePath, pngHeader);

  try {
    assert.deepEqual(readImageDimensions(imagePath), {
      width: 4973,
      height: 4956,
    });

    const catalog = createMapCatalog({
      defaultMapId: "wuwa-9268-state-906",
      entries: [
        {
          id: "wuwa-9268-state-906",
          title: "Bản đồ khu vực 906",
          pack: "map-packs/private/maps/906.json",
        },
        {
          id: "wuwa-9268-state-8",
          title: "Bản đồ khu vực 8",
          pack: "map-packs/private/maps/8.json",
        },
      ],
    });

    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.defaultMapId, "wuwa-9268-state-906");
    assert.deepEqual(
      catalog.maps.map((entry) => entry.id),
      ["wuwa-9268-state-906", "wuwa-9268-state-8"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
