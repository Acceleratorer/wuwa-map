import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function ensureParentDirectory(databasePath) {
  if (databasePath === ":memory:") {
    return;
  }
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
}

function mapProfile(row) {
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function mapProgress(row) {
  return {
    id: `${row.profile_id}::${row.map_id}::${row.marker_id}`,
    profileId: row.profile_id,
    mapId: row.map_id,
    markerId: row.marker_id,
    done: Boolean(row.done),
    updatedAt: row.updated_at,
    pendingSync: false,
  };
}

export class WayfinderRepository {
  constructor(databasePath) {
    ensureParentDirectory(databasePath);
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invites (
        code_hash TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS progress (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        map_id TEXT NOT NULL,
        marker_id TEXT NOT NULL,
        done INTEGER NOT NULL CHECK (done IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, map_id, marker_id)
      );

      CREATE INDEX IF NOT EXISTS sessions_by_expiry
        ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS progress_by_profile_map
        ON progress(profile_id, map_id);
    `);

    const seedProfile = this.database.prepare(`
      INSERT INTO profiles (id, name, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    seedProfile.run("owner", "Chủ map", "2026-07-30T00:00:00.000Z");
    seedProfile.run("friend", "Đồng đội", "2026-07-30T00:00:01.000Z");
  }

  close() {
    this.database.close();
  }

  getProfile(profileId) {
    return mapProfile(
      this.database
        .prepare("SELECT id, name, created_at FROM profiles WHERE id = ?")
        .get(profileId),
    );
  }

  createInvite({ codeHash, profileId, expiresAt, now }) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Unknown profile: ${profileId}`);
    }

    this.database
      .prepare(`
        INSERT INTO invites (
          code_hash, profile_id, expires_at, created_at, claimed_at
        ) VALUES (?, ?, ?, ?, NULL)
      `)
      .run(codeHash, profileId, expiresAt, now);
    return profile;
  }

  claimInvite({
    codeHash,
    sessionHash,
    sessionExpiresAt,
    now,
  }) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const invite = this.database
        .prepare(`
          SELECT profile_id
          FROM invites
          WHERE code_hash = ?
            AND claimed_at IS NULL
            AND expires_at > ?
        `)
        .get(codeHash, now);

      if (!invite) {
        this.database.exec("ROLLBACK");
        return undefined;
      }

      const update = this.database
        .prepare(`
          UPDATE invites
          SET claimed_at = ?
          WHERE code_hash = ? AND claimed_at IS NULL
        `)
        .run(now, codeHash);

      if (Number(update.changes) !== 1) {
        this.database.exec("ROLLBACK");
        return undefined;
      }

      this.database
        .prepare(`
          INSERT INTO sessions (
            token_hash, profile_id, expires_at, created_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          sessionHash,
          invite.profile_id,
          sessionExpiresAt,
          now,
          now,
        );
      this.database.exec("COMMIT");
      return this.getProfile(invite.profile_id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getSession(tokenHash, now) {
    const row = this.database
      .prepare(`
        SELECT
          sessions.token_hash,
          sessions.profile_id,
          sessions.expires_at,
          profiles.name,
          profiles.created_at
        FROM sessions
        INNER JOIN profiles ON profiles.id = sessions.profile_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `)
      .get(tokenHash, now);

    if (!row) {
      return undefined;
    }

    this.database
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(now, tokenHash);

    return {
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      profile: {
        id: row.profile_id,
        name: row.name,
        createdAt: row.created_at,
      },
    };
  }

  deleteSession(tokenHash) {
    this.database
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash);
  }

  getProgress(profileId, mapId) {
    return this.database
      .prepare(`
        SELECT profile_id, map_id, marker_id, done, updated_at
        FROM progress
        WHERE profile_id = ? AND map_id = ?
        ORDER BY marker_id
      `)
      .all(profileId, mapId)
      .map(mapProgress);
  }

  syncProgress(profileId, records) {
    const upsert = this.database.prepare(`
      INSERT INTO progress (
        profile_id, map_id, marker_id, done, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, map_id, marker_id)
      DO UPDATE SET
        done = excluded.done,
        updated_at = excluded.updated_at
    `);
    const canonical = [];

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) {
        const updatedAt = new Date().toISOString();
        upsert.run(
          profileId,
          record.mapId,
          record.markerId,
          record.done ? 1 : 0,
          updatedAt,
        );
        canonical.push(
          mapProgress({
            profile_id: profileId,
            map_id: record.mapId,
            marker_id: record.markerId,
            done: record.done ? 1 : 0,
            updated_at: updatedAt,
          }),
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return canonical;
  }

  cleanup(now) {
    this.database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(now);
    this.database
      .prepare(`
        DELETE FROM invites
        WHERE expires_at <= ? OR claimed_at IS NOT NULL
      `)
      .run(now - 7 * 24 * 60 * 60 * 1000);
  }
}
