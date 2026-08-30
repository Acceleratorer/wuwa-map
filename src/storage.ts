import type {
  AppSetting,
  BackupPayload,
  MapPack,
  Profile,
  ProgressRecord,
} from "./types";

const DATABASE_NAME = "wayfinder-map";
const DATABASE_VERSION = 2;
const PROGRESS_PROFILE_MAP_INDEX = "byProfileMap";

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
      let progressStore: IDBObjectStore;
      if (!database.objectStoreNames.contains("progress")) {
        progressStore = database.createObjectStore("progress", {
          keyPath: "id",
        });
      } else {
        const transaction = request.transaction;
        if (!transaction) {
          throw new Error("IndexedDB upgrade transaction is unavailable");
        }
        progressStore = transaction.objectStore("progress");
      }
      if (!progressStore.indexNames.contains("byProfile")) {
        progressStore.createIndex("byProfile", "profileId");
      }
      if (!progressStore.indexNames.contains("byMap")) {
        progressStore.createIndex("byMap", "mapId");
      }
      if (!progressStore.indexNames.contains(PROGRESS_PROFILE_MAP_INDEX)) {
        progressStore.createIndex(
          PROGRESS_PROFILE_MAP_INDEX,
          ["profileId", "mapId"],
        );
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
    return requestToPromise<ProgressRecord[]>(
      this.store("progress")
        .index(PROGRESS_PROFILE_MAP_INDEX)
        .getAll(IDBKeyRange.only([profileId, mapId])),
    );
  }

  async getAllProgress(): Promise<ProgressRecord[]> {
    return requestToPromise(this.store("progress").getAll());
  }

  async putProgress(record: ProgressRecord): Promise<void> {
    await this.putProgressBatch([record]);
  }

  async putProgressBatch(records: readonly ProgressRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const transaction = this.database.transaction("progress", "readwrite");
    const store = transaction.objectStore("progress");
    for (const record of records) {
      store.put(record);
    }
    await transactionToPromise(transaction);
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
