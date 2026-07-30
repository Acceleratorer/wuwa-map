import type {
  AppSetting,
  BackupPayload,
  MapPack,
  Profile,
  ProgressRecord,
} from "./types";

const DATABASE_NAME = "wayfinder-map";
const DATABASE_VERSION = 1;

type StoreName = "profiles" | "progress" | "settings" | "mapPacks";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    );
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed")),
    );
  });
}

export class LocalDatabase {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(): Promise<LocalDatabase> {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("profiles")) {
        database.createObjectStore("profiles", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("progress")) {
        const progressStore = database.createObjectStore("progress", {
          keyPath: "id",
        });
        progressStore.createIndex("byProfile", "profileId");
        progressStore.createIndex("byMap", "mapId");
      }
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("mapPacks")) {
        database.createObjectStore("mapPacks", { keyPath: "id" });
      }
    });

    const database = await requestToPromise(request);
    return new LocalDatabase(database);
  }

  private store(
    name: StoreName,
    mode: IDBTransactionMode = "readonly",
  ): IDBObjectStore {
    return this.database.transaction(name, mode).objectStore(name);
  }

  async getAllProfiles(): Promise<Profile[]> {
    return requestToPromise(this.store("profiles").getAll());
  }

  async putProfile(profile: Profile): Promise<void> {
    await requestToPromise(this.store("profiles", "readwrite").put(profile));
  }

  async getProgress(profileId: string, mapId: string): Promise<ProgressRecord[]> {
    const all = await requestToPromise<ProgressRecord[]>(
      this.store("progress").index("byProfile").getAll(profileId),
    );
    return all.filter((record) => record.mapId === mapId);
  }

  async getAllProgress(): Promise<ProgressRecord[]> {
    return requestToPromise(this.store("progress").getAll());
  }

  async putProgress(record: ProgressRecord): Promise<void> {
    await requestToPromise(this.store("progress", "readwrite").put(record));
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const result = await requestToPromise<AppSetting<T> | undefined>(
      this.store("settings").get(key),
    );
    return result?.value;
  }

  async getAllSettings(): Promise<AppSetting[]> {
    return requestToPromise(this.store("settings").getAll());
  }

  async putSetting<T>(key: string, value: T): Promise<void> {
    await requestToPromise(
      this.store("settings", "readwrite").put({ key, value }),
    );
  }

  async getMapPack(id: string): Promise<MapPack | undefined> {
    return requestToPromise(this.store("mapPacks").get(id));
  }

  async putMapPack(mapPack: MapPack): Promise<void> {
    await requestToPromise(this.store("mapPacks", "readwrite").put(mapPack));
  }

  async exportBackup(): Promise<BackupPayload> {
    const [profiles, progress, settings] = await Promise.all([
      this.getAllProfiles(),
      this.getAllProgress(),
      this.getAllSettings(),
    ]);

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profiles,
      progress,
      settings,
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    const transaction = this.database.transaction(
      ["profiles", "progress", "settings"],
      "readwrite",
    );

    for (const profile of payload.profiles) {
      transaction.objectStore("profiles").put(profile);
    }
    for (const record of payload.progress) {
      transaction.objectStore("progress").put(record);
    }
    for (const setting of payload.settings) {
      transaction.objectStore("settings").put(setting);
    }

    await transactionToPromise(transaction);
  }
}

export function progressRecordId(
  profileId: string,
  mapId: string,
  markerId: string,
): string {
  return `${profileId}::${mapId}::${markerId}`;
}
