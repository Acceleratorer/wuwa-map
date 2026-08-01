import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectKuroTexts,
  localizeKuroCatalog,
  localizeKuroMapPack,
} from "./kuro-localization.mjs";

const sourcePack = {
  schemaVersion: 1,
  id: "wuwa-kuro-state-1",
  title: "测试地图",
  subtitle: "1 vị trí",
  attribution: "Test",
  tiles: {
    src: "map/{x}_{y}.webp",
    tileSize: 768,
    columns: 1,
    rows: 1,
  },
  categoryGroups: [
    { id: "collection", label: "Bộ sưu tập", icon: "collection" },
  ],
  categories: [
    {
      id: "test",
      label: "测试标记",
      color: "#ffffff",
      symbol: "1",
      groupId: "collection",
    },
  ],
  layers: [
    {
      id: "floor",
      label: "一层",
      groupId: "tower",
      groupLabel: "高塔",
      tiles: {
        src: "floor/{x}_{y}.webp",
        tileSize: 768,
        columns: 1,
        rows: 1,
      },
    },
  ],
  markers: [
    {
      id: "marker",
      categoryId: "test",
      title: "测试标记",
      description: "测试说明",
      x: 10,
      y: 20,
    },
  ],
};

test("KURO localization translates display text and preserves stable ids", () => {
  const translations = new Map([
    ["测试地图", "Bản đồ thử nghiệm"],
    ["测试标记", "Điểm thử nghiệm"],
    ["测试说明", "Mô tả thử nghiệm"],
    ["一层", "Tầng một"],
    ["高塔", "Tháp cao"],
  ]);
  const localized = localizeKuroMapPack(sourcePack, translations);

  assert.equal(localized.id, sourcePack.id);
  assert.equal(localized.title, "Bản đồ thử nghiệm");
  assert.equal(localized.categories[0].id, "test");
  assert.equal(localized.categories[0].label, "Điểm thử nghiệm");
  assert.equal(localized.layers[0].label, "Tầng một");
  assert.equal(localized.layers[0].groupLabel, "Tháp cao");
  assert.equal(localized.markers[0].id, "marker");
  assert.equal(localized.markers[0].title, "Điểm thử nghiệm");
  assert.equal(localized.markers[0].description, "Mô tả thử nghiệm");
});

test("KURO localization collector can include or skip long descriptions", () => {
  assert.deepEqual(
    collectKuroTexts([sourcePack], { includeDescriptions: false }),
    ["高塔", "测试地图", "测试标记", "一层"].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    ),
  );
  assert.equal(
    collectKuroTexts([sourcePack], { includeDescriptions: true })
      .includes("测试说明"),
    true,
  );
});

test("KURO catalog uses the same translation cache as map packs", () => {
  const localized = localizeKuroCatalog(
    {
      schemaVersion: 1,
      defaultMapId: sourcePack.id,
      maps: [
        {
          id: sourcePack.id,
          title: sourcePack.title,
          pack: "map.json",
        },
      ],
    },
    new Map([["测试地图", "Bản đồ thử nghiệm"]]),
  );
  assert.equal(localized.maps[0].title, "Bản đồ thử nghiệm");
});

test("KURO localization resolves generated text through a manual override", () => {
  const localized = localizeKuroMapPack(
    sourcePack,
    new Map([
      ["测试地图", "Machine translation"],
      ["Machine translation", "Bản đồ thử nghiệm"],
    ]),
  );
  assert.equal(localized.title, "Bản đồ thử nghiệm");
});
