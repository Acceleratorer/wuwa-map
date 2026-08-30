import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMapCatalog, parseMapPack } from "../src/map-pack.ts";

const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

test("map packs accept route areas inside the basemap", () => {
  const pack = parseMapPack({
    schemaVersion: 1,
    id: "test-map",
    title: "Test map",
    attribution: "Test data",
    image: { src: "data:image/svg+xml,<svg/>", width: 100, height: 100 },
    areas: [{ id: "north", label: "North", bounds }],
    categories: [
      { id: "loot", label: "Loot", color: "#ffffff", symbol: "L" },
    ],
    markers: [
      { id: "marker", categoryId: "loot", title: "Loot", x: 50, y: 50 },
    ],
  });

  assert.equal(pack.areas?.[0]?.id, "north");
});

test("explicit route memberships partition all markers exactly once", () => {
  const pack = parseMapPack({
    schemaVersion: 1,
    id: "test-map",
    title: "Test map",
    attribution: "Test data",
    image: { src: "data:image/svg+xml,<svg/>", width: 100, height: 100 },
    areas: [
      { id: "north", label: "North", bounds, markerIds: ["north-marker"] },
      { id: "south", label: "South", bounds, markerIds: ["south-marker"] },
    ],
    categories: [
      { id: "loot", label: "Loot", color: "#ffffff", symbol: "L" },
    ],
    markers: [
      {
        id: "north-marker",
        categoryId: "loot",
        title: "North loot",
        x: 50,
        y: 30,
      },
      {
        id: "south-marker",
        categoryId: "loot",
        title: "South loot",
        x: 50,
        y: 70,
      },
    ],
  });

  assert.deepEqual(pack.areas?.[0]?.markerIds, ["north-marker"]);
});

test("explicit route memberships reject duplicated or missing markers", () => {
  assert.throws(
    () =>
      parseMapPack({
        schemaVersion: 1,
        id: "test-map",
        title: "Test map",
        attribution: "Test data",
        image: {
          src: "data:image/svg+xml,<svg/>",
          width: 100,
          height: 100,
        },
        areas: [
          {
            id: "north",
            label: "North",
            bounds,
            markerIds: ["marker"],
          },
          {
            id: "south",
            label: "South",
            bounds,
            markerIds: ["marker"],
          },
        ],
        categories: [
          { id: "loot", label: "Loot", color: "#ffffff", symbol: "L" },
        ],
        markers: [
          {
            id: "marker",
            categoryId: "loot",
            title: "Loot",
            x: 50,
            y: 50,
          },
        ],
      }),
    /bị gán trùng/,
  );
});

test("official areas may be present even when the source has no marker in them", () => {
  const pack = parseMapPack({
    schemaVersion: 1,
    id: "empty-official-area",
    title: "Official area test",
    attribution: "Test data",
    image: { src: "data:image/svg+xml,<svg/>", width: 100, height: 100 },
    areas: [
      { id: "populated", label: "Populated", bounds, markerIds: ["marker"] },
      { id: "empty", label: "Empty official area", bounds, markerIds: [] },
    ],
    categories: [
      { id: "loot", label: "Loot", color: "#ffffff", symbol: "L" },
    ],
    markers: [
      { id: "marker", categoryId: "loot", title: "Loot", x: 50, y: 50 },
    ],
  });

  assert.deepEqual(pack.areas?.[1]?.markerIds, []);
});

test("every official atlas assigns each bundled marker exactly once", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../public/map-packs/private/catalog.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(catalog.maps.length, 51);
  assert.deepEqual(
    catalog.groups.map((group) => group.mapIds.length),
    [18, 15, 3, 15],
  );
  assert.deepEqual(
    catalog.groups.map((group) =>
      group.sections?.map((section) => ({
        title: section.title,
        count: section.mapIds.length,
      })),
    ),
    [
      [
        { title: "Dimmr Plains", count: 4 },
        { title: "Frostlands Surface", count: 5 },
        { title: "Lahai-Roi", count: 9 },
      ],
      [
        { title: "Septimont", count: 2 },
        { title: "Ragunna", count: 13 },
      ],
      undefined,
      [
        { title: "Mengzhou", count: 4 },
        { title: "Jinzhou", count: 11 },
      ],
    ],
  );
  for (const group of catalog.groups) {
    if (group.sections) {
      assert.deepEqual(
        group.sections.flatMap((section) => section.mapIds),
        group.mapIds,
      );
    }
  }

  for (const entry of catalog.maps) {
    const pack = parseMapPack(
      JSON.parse(
        readFileSync(
          new URL(
            `../public/${entry.pack}`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const assigned = pack.areas?.flatMap((area) => area.markerIds ?? []) ?? [];

    assert.ok(pack.markers.length > 0, `${entry.title} không có marker.`);
    assert.ok(pack.areas, `${entry.title} thiếu khu chạy map.`);
    assert.equal(
      assigned.length,
      pack.markers.length,
      `${entry.title} thiếu marker trong area.`,
    );
    assert.equal(
      new Set(assigned).size,
      pack.markers.length,
      `${entry.title} có marker bị gán trùng area.`,
    );
  }
});

test("legacy map IDs keep their progress namespaces", () => {
  const pack = parseMapPack(
    JSON.parse(
      readFileSync(
        new URL(
          "../public/map-packs/private/maps/906.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

  assert.equal(pack.id, "wuwa-kuro-state-906");
  assert.equal(pack.progressMapId, "wuwa-kuro-state-906");
  assert.ok(pack.markers.length > 0);
});

test("catalog groups and area summaries reference valid maps", () => {
  const catalog = parseMapCatalog({
    schemaVersion: 1,
    defaultMapId: "test-map",
    maps: [
      {
        id: "test-map",
        title: "Test map",
        pack: "map-packs/test.json",
        areas: [{ id: "north", label: "North", bounds }],
      },
    ],
    groups: [{
      id: "realm",
      title: "Realm",
      mapIds: ["test-map"],
      sections: [{
        id: "section",
        title: "Section",
        mapIds: ["test-map"],
      }],
    }],
  });

  assert.deepEqual(catalog.groups?.[0]?.mapIds, ["test-map"]);
});
