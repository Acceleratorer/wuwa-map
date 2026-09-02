import assert from "node:assert/strict";
import { test } from "node:test";
import { filterVisibleMarkers } from "../src/marker-visibility.ts";

const markers = [
  {
    id: "west-chest",
    categoryId: "chest",
    title: "West chest",
    x: 10,
    y: 10,
  },
  {
    id: "east-chest",
    categoryId: "chest",
    title: "East chest",
    x: 90,
    y: 90,
  },
];

test("marker visibility covers the whole atlas regardless of route area", () => {
  const visible = filterVisibleMarkers(markers, {
    activeFloorId: "",
    completedMarkerIds: new Set(),
    hideCompleted: false,
    normalizedSearchTerm: "",
    searchIndex: undefined,
    visibleCategoryIds: new Set(["chest"]),
  });

  assert.deepEqual(
    visible.map((marker) => marker.id),
    ["west-chest", "east-chest"],
  );
});

test("atlas visibility still respects category and completed filters", () => {
  const visible = filterVisibleMarkers(markers, {
    activeFloorId: "",
    completedMarkerIds: new Set(["west-chest"]),
    hideCompleted: true,
    normalizedSearchTerm: "",
    searchIndex: undefined,
    visibleCategoryIds: new Set(["chest"]),
  });

  assert.deepEqual(
    visible.map((marker) => marker.id),
    ["east-chest"],
  );
});
