import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeProgressForCategories } from "../src/progress.ts";

const markers = [
  { id: "chest-1", categoryId: "chest" },
  { id: "chest-2", categoryId: "chest" },
  { id: "resource-1", categoryId: "resource" },
  { id: "enemy-1", categoryId: "enemy" },
];

test("progress only includes markers from selected categories", () => {
  const summary = summarizeProgressForCategories(
    markers,
    new Set(["chest-1", "resource-1", "enemy-1"]),
    new Set(["chest", "resource"]),
  );

  assert.deepEqual(summary, {
    completed: 2,
    total: 3,
    percentage: 67,
  });
});

test("progress reaches 100 percent when every selected marker is completed", () => {
  const summary = summarizeProgressForCategories(
    markers,
    new Set(["chest-1", "chest-2", "enemy-1"]),
    new Set(["chest"]),
  );

  assert.deepEqual(summary, {
    completed: 2,
    total: 2,
    percentage: 100,
  });
});

test("completed markers outside the selected categories do not affect progress", () => {
  const summary = summarizeProgressForCategories(
    markers,
    new Set(["resource-1", "enemy-1"]),
    new Set(["chest"]),
  );

  assert.deepEqual(summary, {
    completed: 0,
    total: 2,
    percentage: 0,
  });
});

test("an empty category selection reports empty progress", () => {
  const summary = summarizeProgressForCategories(
    markers,
    new Set(["chest-1"]),
    new Set(),
  );

  assert.deepEqual(summary, {
    completed: 0,
    total: 0,
    percentage: 0,
  });
});
