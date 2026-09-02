import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRequestedMapPackId } from "../src/map-selection.ts";

test("official catalog default replaces a stale demo selection", () => {
  assert.equal(
    resolveRequestedMapPackId({
      storedMapPackId: "clean-room-demo",
      catalogDefaultMapId: "official-default",
      bundledMapPackId: undefined,
      demoMapPackId: "clean-room-demo",
    }),
    "official-default",
  );
});

test("a stored official map remains selected", () => {
  assert.equal(
    resolveRequestedMapPackId({
      storedMapPackId: "official-map",
      catalogDefaultMapId: "official-default",
      bundledMapPackId: undefined,
      demoMapPackId: "clean-room-demo",
    }),
    "official-map",
  );
});

test("the demo remains available when no official catalog is loaded", () => {
  assert.equal(
    resolveRequestedMapPackId({
      storedMapPackId: "clean-room-demo",
      catalogDefaultMapId: undefined,
      bundledMapPackId: undefined,
      demoMapPackId: "clean-room-demo",
    }),
    "clean-room-demo",
  );
});
