import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackupFilename } from "../src/backup-filename.ts";

const exportedAt = new Date("2026-08-21T08:15:00.000Z");

test("backup filenames identify the active profile", () => {
  const ownerFilename = createBackupFilename(
    { id: "owner", name: "Chủ map" },
    exportedAt,
  );
  const friendFilename = createBackupFilename(
    { id: "friend", name: "Đồng đội" },
    exportedAt,
  );

  assert.equal(
    ownerFilename,
    "wayfinder-backup-chu-map-owner-2026-08-21.json",
  );
  assert.equal(
    friendFilename,
    "wayfinder-backup-dong-doi-friend-2026-08-21.json",
  );
  assert.notEqual(ownerFilename, friendFilename);
});

test("backup filenames sanitize custom profile names and identifiers", () => {
  assert.equal(
    createBackupFilename(
      { id: "co-op / 02", name: "  Bạn #2 / Rover!  " },
      exportedAt,
    ),
    "wayfinder-backup-ban-2-rover-co-op-02-2026-08-21.json",
  );
});
