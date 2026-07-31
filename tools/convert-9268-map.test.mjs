import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { buildMapPack } from "./convert-9268-map.mjs";

test("9268 converter maps game coordinates into resized image pixels", () => {
  const directory = mkdtempSync(join(tmpdir(), "wayfinder-9268-"));
  const databasePath = join(directory, "map_items.db");
  const coordsPath = join(directory, "map_coords.json");
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      CREATE TABLE state (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE item (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT
      );
      CREATE TABLE location (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        state_id INTEGER NOT NULL,
        country_id INTEGER,
        floor_id TEXT,
        level TEXT,
        x REAL,
        y REAL,
        description TEXT
      );

      INSERT INTO state (id, name) VALUES (906, 'Test Region');
      INSERT INTO item (id, name, icon) VALUES
        ('qzx_01', 'Common Chest', 'adminConfig/61/props_namephoto/chest-1.png'),
        ('qzx_02', 'Standard Chest', 'adminConfig/61/props_namephoto/chest-2.png'),
        ('310000790', 'Rock Spider', 'adminConfig/63/props_namephoto/enemy.png');
      INSERT INTO location (
        id, item_id, state_id, country_id, floor_id, level, x, y, description
      ) VALUES
        ('marker-1', 'qzx_01', 906, 4, '40', '0', 1500, 3000, 'Near the bridge'),
        ('marker-outside', 'qzx_02', 906, 4, '', '0', 3000, 3000, ''),
        ('marker-2', '310000790', 906, 4, '', '0', 1600, 3200, '');
    `);
  } finally {
    database.close();
  }

  writeFileSync(
    coordsPath,
    JSON.stringify({
      906: {
        offset: [1000, 2000],
        scale: [10, 20],
        min: [1000, 2000],
        max: [2000, 4000],
      },
    }),
  );

  try {
    const mapPack = buildMapPack({
      databasePath,
      coordsPath,
      stateId: 906,
      countryId: 4,
      itemIds: ["qzx_01", "qzx_02"],
      imageSrc: "map-packs/private/wuwa-906.webp",
      imageWidth: 50,
      imageHeight: 25,
    });

    assert.equal(mapPack.id, "wuwa-9268-state-906");
    assert.equal(mapPack.title, "Bản đồ rương · Khu vực 906");
    assert.deepEqual(
      mapPack.categories.map((category) => ({
        id: category.id,
        label: category.label,
      })),
      [
        { id: "qzx_01", label: "Rương đơn sơ" },
        { id: "qzx_02", label: "Rương tiêu chuẩn" },
      ],
    );
    assert.equal(mapPack.markers.length, 1);
    assert.equal(mapPack.markers[0].id, "9268:marker-1");
    assert.equal(mapPack.markers[0].title, "Rương đơn sơ");
    assert.equal(mapPack.markers[0].x, 25);
    assert.equal(mapPack.markers[0].y, 12.5);
    assert.match(mapPack.markers[0].description, /Tầng 40/);
    assert.doesNotMatch(mapPack.markers[0].description, /Near the bridge/);
    assert.equal(mapPack.subtitle, "1 vị trí · 2 loại rương");
    assert.match(mapPack.attribution, /9268\/wuwa-map/);
    assert.deepEqual(mapPack.categoryGroups, [
      { id: "collection", label: "Bộ sưu tập", icon: "collection" },
    ]);
    assert.deepEqual(
      mapPack.categories.map((category) => ({
        id: category.id,
        groupId: category.groupId,
        icon: category.icon,
      })),
      [
        { id: "qzx_01", groupId: "collection", icon: "chest" },
        { id: "qzx_02", groupId: "collection", icon: "chest" },
      ],
    );

    const fullMapPack = buildMapPack({
      databasePath,
      coordsPath,
      stateId: 906,
      countryId: 4,
      itemIds: "all",
      imageSrc: "map-packs/private/maps/906.webp",
      imageWidth: 50,
      imageHeight: 25,
    });

    assert.equal(fullMapPack.title, "Bản đồ khu vực 906");
    assert.equal(fullMapPack.subtitle, "2 vị trí · 3 loại điểm");
    assert.deepEqual(fullMapPack.defaultVisibleCategoryIds, [
      "qzx_01",
      "qzx_02",
    ]);
    assert.deepEqual(fullMapPack.categoryGroups, [
      { id: "collection", label: "Bộ sưu tập", icon: "collection" },
      { id: "enemies", label: "Kẻ thù", icon: "enemy" },
    ]);
    assert.deepEqual(
      fullMapPack.categories.map((category) => ({
        id: category.id,
        label: category.label,
        symbol: category.symbol,
        groupId: category.groupId,
        icon: category.icon,
      })),
      [
        {
          id: "qzx_01",
          label: "Rương đơn sơ",
          symbol: "1",
          groupId: "collection",
          icon: "chest",
        },
        {
          id: "qzx_02",
          label: "Rương tiêu chuẩn",
          symbol: "2",
          groupId: "collection",
          icon: "chest",
        },
        {
          id: "310000790",
          label: "Kẻ thù 310000790",
          symbol: "•",
          groupId: "enemies",
          icon: "enemy",
        },
      ],
    );
    assert.equal(fullMapPack.markers.length, 2);
    assert.equal(
      fullMapPack.markers.find((marker) => marker.id === "9268:marker-2")
        ?.title,
      "Kẻ thù 310000790",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
