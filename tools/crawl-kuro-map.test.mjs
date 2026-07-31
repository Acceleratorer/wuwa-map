import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildKuroMapPack,
  gameToLocalPixel,
  parseTileLayout,
} from "./crawl-kuro-map.mjs";

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
            floorId: "",
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
});
