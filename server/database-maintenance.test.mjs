import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createDatabaseBackup } from "./database-maintenance.mjs";
import { WayfinderRepository } from "./database.mjs";

function createClaimedSession(repository, {
  codeHash,
  sessionHash,
  now,
  profileId = "friend",
}) {
  repository.createInvite({
    codeHash,
    profileId,
    expiresAt: now + 60_000,
    now,
  });
  const profile = repository.claimInvite({
    codeHash,
    sessionHash,
    sessionExpiresAt: now + 24 * 60 * 60 * 1000,
    now,
  });
  assert.equal(profile?.id, profileId);
}

test("database backup includes committed WAL data and passes integrity check", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wayfinder-backup-"));
  const databasePath = join(directory, "source.sqlite");
  const backupPath = join(directory, "backups", "snapshot.sqlite");
  const repository = new WayfinderRepository(databasePath);

  try {
    repository.syncProgress("friend", [
      {
        mapId: "clean-room-demo",
        markerId: "demo-chest-01",
        done: true,
      },
    ]);

    const result = await createDatabaseBackup(databasePath, backupPath);
    assert.equal(result.destinationPath, backupPath);
    assert.equal(existsSync(`${backupPath}-shm`), false);
    assert.equal(existsSync(`${backupPath}-wal`), false);
    await assert.rejects(
      createDatabaseBackup(databasePath, backupPath),
      /đã tồn tại/,
    );

    const backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const integrity = backupDatabase.prepare("PRAGMA quick_check").get();
      assert.equal(integrity.quick_check, "ok");

      const progress = backupDatabase
        .prepare(`
          SELECT profile_id, map_id, marker_id, done
          FROM progress
        `)
        .get();
      assert.equal(progress.profile_id, "friend");
      assert.equal(progress.map_id, "clean-room-demo");
      assert.equal(progress.marker_id, "demo-chest-01");
      assert.equal(progress.done, 1);
    } finally {
      backupDatabase.close();
    }
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("device sessions can be listed and revoked without deleting progress", () => {
  const directory = mkdtempSync(join(tmpdir(), "wayfinder-devices-"));
  const databasePath = join(directory, "source.sqlite");
  const repository = new WayfinderRepository(databasePath);
  const now = Date.now();
  const firstSessionHash = "a".repeat(64);
  const secondSessionHash = "b".repeat(64);

  try {
    createClaimedSession(repository, {
      codeHash: "c".repeat(64),
      sessionHash: firstSessionHash,
      now,
    });
    createClaimedSession(repository, {
      codeHash: "d".repeat(64),
      sessionHash: secondSessionHash,
      now: now + 1,
    });
    repository.syncProgress("friend", [
      {
        mapId: "clean-room-demo",
        markerId: "demo-chest-01",
        done: true,
      },
    ]);

    const sessions = repository.listSessions({
      profileId: "friend",
      now: now + 2,
    });
    assert.deepEqual(
      sessions.map((session) => session.id),
      ["bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"],
    );

    assert.equal(
      repository.revokeSessionByPrefix("a".repeat(16)),
      1,
    );
    assert.equal(repository.getSession(firstSessionHash, now + 2), undefined);
    assert.equal(
      repository.getSession(secondSessionHash, now + 2)?.profile.id,
      "friend",
    );
    assert.equal(
      repository.getProgress("friend", "clean-room-demo").length,
      1,
    );

    assert.equal(repository.revokeSessionsByProfile("friend"), 1);
    assert.equal(repository.getSession(secondSessionHash, now + 2), undefined);
    assert.equal(
      repository.getProgress("friend", "clean-room-demo").length,
      1,
    );
  } finally {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
