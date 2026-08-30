import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMarkerSearchIndex,
  normalizeSearchText,
} from "../src/marker-search.ts";

const markers = [
  {
    id: "kuro:1453124163842928640",
    title: "Khởi động lại",
    categoryId: "puzzle",
    description: "Nhận sao và phần thưởng.",
  },
  {
    id: "chest-royal-01",
    title: "Rương huy quang",
    categoryId: "qzx_04",
  },
];

test("search index includes marker ids, categories, and descriptions", () => {
  const index = buildMarkerSearchIndex(markers);

  assert.match(index.get(markers[0].id), /1453124163842928640/);
  assert.match(index.get(markers[0].id), /puzzle/);
  assert.match(index.get(markers[0].id), /phan thuong/);
});

test("search normalization matches Vietnamese text without tone marks", () => {
  const index = buildMarkerSearchIndex(markers);

  assert.equal(
    index.get(markers[0].id)?.includes(normalizeSearchText("khoi dong lai")),
    true,
  );
  assert.equal(
    index.get(markers[1].id)?.includes(normalizeSearchText("qzx_04")),
    true,
  );
});
