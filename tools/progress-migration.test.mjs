import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProgressCompatibilitySnapshot,
  migrateProgressRecords,
  resolveCompatibleAreaId,
} from "../src/progress-migration.ts";

const oldPack = {
  markers: [
    {
      id: "old-marker",
      categoryId: "chest",
      title: "Chest",
      x: 10,
      y: 20,
      levelId: "0",
    },
  ],
  areas: [
    {
      id: "old-area",
      label: "Old route",
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 40 },
    },
  ],
};

const newPack = {
  markers: [
    {
      id: "new-marker",
      categoryId: "chest",
      title: "Chest",
      x: 10,
      y: 20,
      levelId: "0",
    },
  ],
  areas: [
    {
      id: "new-area",
      label: "New route",
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 40 },
    },
  ],
};

test("catalog identifier changes preserve marker progress and route selection", () => {
  const snapshot = createProgressCompatibilitySnapshot(oldPack);
  const result = migrateProgressRecords(
    [
      {
        id: "owner::map::old-marker",
        profileId: "owner",
        mapId: "map",
        markerId: "old-marker",
        done: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
        pendingSync: false,
      },
    ],
    snapshot,
    newPack,
  );

  assert.equal(result.migratedCount, 1);
  assert.deepEqual(result.removeIds, ["owner::map::old-marker"]);
  assert.equal(result.records[0]?.id, "owner::map::new-marker");
  assert.equal(
    resolveCompatibleAreaId("old-area", snapshot, newPack.areas),
    "new-area",
  );
});
