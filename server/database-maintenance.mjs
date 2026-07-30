import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

function sqliteArtifacts(databasePath) {
  return [
    databasePath,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];
}

function removeSqliteArtifacts(databasePath) {
  for (const artifactPath of sqliteArtifacts(databasePath)) {
    rmSync(artifactPath, { force: true });
  }
}

export async function createDatabaseBackup(sourcePath, destinationPath) {
  const resolvedSource = resolve(sourcePath);
  const resolvedDestination = resolve(destinationPath);

  if (resolvedSource === resolvedDestination) {
    throw new Error("File backup phải khác database nguồn.");
  }
  if (!existsSync(resolvedSource) || !statSync(resolvedSource).isFile()) {
    throw new Error(`Không tìm thấy database nguồn: ${resolvedSource}`);
  }
  if (sqliteArtifacts(resolvedDestination).some(existsSync)) {
    throw new Error(
      `File backup hoặc SQLite sidecar đã tồn tại: ${resolvedDestination}`,
    );
  }

  mkdirSync(dirname(resolvedDestination), { recursive: true });
  const sourceDatabase = new DatabaseSync(resolvedSource, { readOnly: true });
  let destinationCreated = false;

  try {
    await backup(sourceDatabase, resolvedDestination);
    destinationCreated = true;

    const backupDatabase = new DatabaseSync(resolvedDestination);
    try {
      const journalMode = backupDatabase
        .prepare("PRAGMA journal_mode = DELETE")
        .get();
      if (journalMode?.journal_mode !== "delete") {
        throw new Error("Không thể chuẩn hóa journal mode của file backup.");
      }

      const check = backupDatabase.prepare("PRAGMA quick_check").get();
      if (check?.quick_check !== "ok") {
        throw new Error("SQLite quick_check không trả về ok.");
      }
    } finally {
      backupDatabase.close();
    }
    rmSync(`${resolvedDestination}-shm`, { force: true });
    rmSync(`${resolvedDestination}-wal`, { force: true });

    return {
      sourcePath: resolvedSource,
      destinationPath: resolvedDestination,
      sizeBytes: statSync(resolvedDestination).size,
    };
  } catch (error) {
    if (
      destinationCreated ||
      sqliteArtifacts(resolvedDestination).some(existsSync)
    ) {
      removeSqliteArtifacts(resolvedDestination);
    }
    throw error;
  } finally {
    sourceDatabase.close();
  }
}
