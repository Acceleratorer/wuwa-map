import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATE_REGION_SPLITS,
  buildLayerEntries,
  buildKuroMapPack,
  gameToLocalPixel,
  parseLayerTilePath,
  parseTileLayout,
} from "./crawl-kuro-map.mjs";

test("state 8 keeps both Huanglong atlases separate with shared progress", () => {
  const definitions = STATE_REGION_SPLITS.get(8);
  const huanglong = definitions.find(
    (definition) => definition.id === "wuwa-kuro-state-8-country-1",
  );
  const huanglong2 = definitions.find(
    (definition) => definition.id === "wuwa-kuro-state-8-country-1-2",
  );

  assert.equal(huanglong.progressMapId, "wuwa-kuro-state-8");
  assert.equal(huanglong2.progressMapId, "wuwa-kuro-state-8");
  assert.equal(huanglong.countryId, 1);
  assert.equal(huanglong2.countryId, 1);
  assert.deepEqual(huanglong.tileRegions, [
    {
      minColumn: 9,
      maxColumn: 18,
      minRow: 10,
      maxRow: 22,
    },
  ]);
  assert.deepEqual(huanglong2.tileRegions, [
    {
      minColumn: 0,
      maxColumn: 8,
      minRow: 10,
      maxRow: 16,
    },
  ]);
});

test("KURO tile layout normalizes source coordinates into a local grid", () => {
  const layout = parseTileLayout(
    ["906_-1_4", "906_0_4", "906_-1_5", "906_0_5"],
    906,
  );

  assert.equal(layout.columns, 2);
  assert.equal(layout.rows, 2);
  assert.deepEqual(
    layout.tiles.map(({ id, column, row, leafletY }) => ({
      id,
      column,
      row,
      leafletY,
    })),
    [
      { id: "906_-1_4", column: 0, row: 1, leafletY: -1 },
      { id: "906_0_4", column: 1, row: 1, leafletY: -1 },
      { id: "906_-1_5", column: 0, row: 0, leafletY: -2 },
      { id: "906_0_5", column: 1, row: 0, leafletY: -2 },
    ],
  );
});

test("KURO coordinates and marker data are converted into tile-local pixels", () => {
  const layout = parseTileLayout(
    ["906_-1_0", "906_0_0", "906_-1_1", "906_0_1"],
    906,
  );
  const pixel = gameToLocalPixel(-85000, -85000, 768, layout);
  assert.deepEqual(pixel, { x: 768, y: 0 });

  const pack = buildKuroMapPack({
    stateId: 906,
    stateName: "Test map",
    tileSize: 768,
    tileExtension: "webp",
    tileWebPrefix: "map-packs/private/maps/906",
    layout,
    retrievedAt: "2026-07-31T00:00:00.000Z",
    iconWebPathBySource: new Map([
      [
        "adminConfig/61/props_namephoto/chest.png",
        "map-packs/private/icons/chest.webp",
      ],
    ]),
    layerEntries: [
      {
        id: "-1/40",
        label: "First floor",
        groupId: "40",
        groupLabel: "Tower",
        tiles: {
          src: "map-packs/private/layers/906/-1_40/{x}_{y}.webp",
          tileSize: 768,
          columns: 2,
          rows: 2,
          availableTiles: ["0,-1"],
        },
      },
    ],
    positionData: [
      {
        id: "qzx_01",
        name: "Chest",
        icon: "adminConfig/61/props_namephoto/chest.png",
        location: [
          {
            id: "marker-1",
            stateId: 906,
            countryId: 4,
            floorId: "40",
            level: "-1/40",
            x: -85000,
            y: -85000,
          },
        ],
      },
    ],
  });

  assert.equal(pack.tiles.columns, 2);
  assert.equal(pack.tiles.rows, 2);
  assert.deepEqual(pack.tiles.availableTiles, [
    "0,-1",
    "1,-1",
    "0,-2",
    "1,-2",
  ]);
  assert.equal(pack.markers.length, 1);
  assert.deepEqual(
    { x: pack.markers[0].x, y: pack.markers[0].y },
    { x: 768, y: 0 },
  );
  assert.equal(pack.categories[0].label, "Rương đơn sơ");
  assert.equal(
    pack.categories[0].imageSrc,
    "map-packs/private/icons/chest.webp",
  );
  assert.equal(pack.markers[0].floorId, "40");
  assert.equal(pack.markers[0].levelId, "-1/40");
  assert.equal(pack.layers[0].id, "-1/40");
});

test("KURO state regions filter countries, categories, and floor layers", () => {
  const layout = parseTileLayout(
    ["8_-1_0", "8_0_0", "8_-1_1", "8_0_1"],
    8,
  );
  const pack = buildKuroMapPack({
    stateId: 8,
    stateName: "Hoàng Long",
    countryId: 1,
    mapId: "wuwa-kuro-state-8-country-1",
    progressMapId: "wuwa-kuro-state-8",
    tileRegions: [
      {
        minColumn: 1,
        maxColumn: 1,
        minRow: 0,
        maxRow: 0,
      },
    ],
    initialView: {
      minX: 800,
      minY: 100,
      maxX: 1400,
      maxY: 700,
    },
    tileSize: 768,
    tileExtension: "webp",
    tileWebPrefix: "map-packs/private/maps/8",
    layout,
    retrievedAt: "2026-07-31T00:00:00.000Z",
    layerEntries: [
      {
        id: "-1/1",
        label: "Huanglong floor",
        groupId: "1",
        groupLabel: "Huanglong",
        tiles: {
          src: "map-packs/private/layers/8/-1_1/{x}_{y}.webp",
          tileSize: 768,
          columns: 2,
          rows: 2,
          availableTiles: ["1,-2"],
        },
      },
      {
        id: "-1/8",
        label: "Rinascita floor",
        groupId: "8",
        groupLabel: "Rinascita",
        tiles: {
          src: "map-packs/private/layers/8/-1_8/{x}_{y}.webp",
          tileSize: 768,
          columns: 2,
          rows: 2,
          availableTiles: ["1,-1"],
        },
      },
    ],
    positionData: [
      {
        id: "qzx_01",
        name: "Chest",
        location: [
          {
            id: "huanglong-marker",
            stateId: 8,
            countryId: 1,
            level: "-1/1",
            x: -85000,
            y: -85000,
          },
          {
            id: "rinascita-marker",
            stateId: 8,
            countryId: 3,
            level: "-1/8",
            x: 0,
            y: 0,
          },
        ],
      },
      {
        id: "huanglong-outside",
        name: "Huanglong outside",
        location: [
          {
            id: "huanglong-outside-marker",
            stateId: 8,
            countryId: 1,
            level: "0",
            x: -170000,
            y: -85000,
          },
        ],
      },
      {
        id: "rinascita-only",
        name: "Rinascita only",
        location: [
          {
            id: "rinascita-only-marker",
            stateId: 8,
            countryId: 3,
            level: "0",
            x: 0,
            y: 0,
          },
        ],
      },
    ],
  });

  assert.equal(pack.id, "wuwa-kuro-state-8-country-1");
  assert.equal(pack.progressMapId, "wuwa-kuro-state-8");
  assert.deepEqual(pack.bounds, {
    minX: 768,
    minY: 0,
    maxX: 1536,
    maxY: 768,
  });
  assert.equal(pack.title, "Hoàng Long");
  assert.deepEqual(pack.initialView, {
    minX: 800,
    minY: 100,
    maxX: 1400,
    maxY: 700,
  });
  assert.deepEqual(pack.tiles.availableTiles, ["1,-2"]);
  assert.deepEqual(
    pack.markers.map((marker) => marker.id),
    ["kuro:huanglong-marker"],
  );
  assert.deepEqual(
    pack.categories.map((category) => category.id),
    ["qzx_01"],
  );
  assert.deepEqual(
    pack.layers.map((layer) => layer.id),
    ["-1/1"],
  );
  assert.deepEqual(pack.layers[0].tiles.availableTiles, ["1,-2"]);
});

test("KURO layered tile paths use the same normalized grid as basemap tiles", () => {
  const layout = parseTileLayout(
    ["906_-1_4", "906_0_4", "906_-1_5", "906_0_5"],
    906,
  );
  assert.deepEqual(parseLayerTilePath("/40/-2/-1_5.png", layout), {
    groupPath: "40",
    floorPath: "-2",
    sourceX: -1,
    sourceY: 5,
    column: 0,
    leafletY: -2,
  });

  const entries = buildLayerEntries({
    stateId: 906,
    layout,
    tileSize: 768,
    tileExtension: "webp",
    layerData: [
      {
        id: "40",
        name: "Tower",
        floors: [
          {
            id: "-2/40",
            name: "Second floor",
            tiles: ["/40/-2/-1_5.png"],
          },
        ],
      },
    ],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tiles.availableTiles[0], "0,-2");
  assert.equal(
    entries[0].tiles.src,
    "map-packs/private/layers/906/-2_40/{x}_{y}.webp",
  );
});
