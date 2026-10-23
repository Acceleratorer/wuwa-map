import type { MapArea, MapMarker, MapPack, ProgressRecord } from "./types";

function progressRecordId(profileId: string, mapId: string, markerId: string): string {
  return `${profileId}::${mapId}::${markerId}`;
}

export interface ProgressCompatibilitySnapshot {
  markerFingerprints: Record<string, string>;
  areaFingerprints: Record<string, string>;
  areaLabels: Record<string, string>;
}

export interface ProgressMigrationResult {
  records: ProgressRecord[];
  removeIds: string[];
  migratedCount: number;
  unmatchedCount: number;
}

function markerFingerprint(
  marker: Pick<MapMarker, "categoryId" | "x" | "y" | "floorId" | "levelId">,
): string {
  return JSON.stringify([
    marker.categoryId,
    marker.x,
    marker.y,
    marker.floorId ?? "",
    marker.levelId ?? "",
  ]);
}

function areaFingerprint(area: MapArea): string {
  return JSON.stringify([
    area.bounds.minX,
    area.bounds.minY,
    area.bounds.maxX,
    area.bounds.maxY,
  ]);
}

export function createProgressCompatibilitySnapshot(
  pack: Pick<MapPack, "markers" | "areas">,
): ProgressCompatibilitySnapshot {
  return {
    markerFingerprints: Object.fromEntries(
      pack.markers.map((marker) => [marker.id, markerFingerprint(marker)]),
    ),
    areaFingerprints: Object.fromEntries(
      (pack.areas ?? []).map((area) => [area.id, areaFingerprint(area)]),
    ),
    areaLabels: Object.fromEntries(
      (pack.areas ?? []).map((area) => [area.id, area.label]),
    ),
  };
}

export function parseProgressCompatibilitySnapshot(
  value: unknown,
): ProgressCompatibilitySnapshot | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Partial<ProgressCompatibilitySnapshot>;
  if (
    typeof candidate.markerFingerprints !== "object" ||
    candidate.markerFingerprints === null ||
    typeof candidate.areaFingerprints !== "object" ||
    candidate.areaFingerprints === null ||
    typeof candidate.areaLabels !== "object" ||
    candidate.areaLabels === null
  ) {
    return undefined;
  }
  const isStringRecord = (record: object): record is Record<string, string> =>
    Object.values(record).every((entry) => typeof entry === "string");
  return isStringRecord(candidate.markerFingerprints) &&
    isStringRecord(candidate.areaFingerprints) &&
    isStringRecord(candidate.areaLabels)
    ? {
        markerFingerprints: candidate.markerFingerprints,
        areaFingerprints: candidate.areaFingerprints,
        areaLabels: candidate.areaLabels,
      }
    : undefined;
}

export function migrateProgressRecords(
  records: readonly ProgressRecord[],
  previous: ProgressCompatibilitySnapshot,
  currentPack: Pick<MapPack, "markers">,
): ProgressMigrationResult {
  const currentMarkerIds = new Set(currentPack.markers.map((marker) => marker.id));
  const fingerprintToMarkerId = new Map<string, string | undefined>();
  for (const marker of currentPack.markers) {
    const fingerprint = markerFingerprint(marker);
    fingerprintToMarkerId.set(
      fingerprint,
      fingerprintToMarkerId.has(fingerprint)
        ? undefined
        : marker.id,
    );
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  const migrated = new Map<string, ProgressRecord>();
  const removeIds: string[] = [];
  let unmatchedCount = 0;

  for (const record of records) {
    if (currentMarkerIds.has(record.markerId)) {
      continue;
    }
    if (!(record.markerId in previous.markerFingerprints)) {
      continue;
    }
    const fingerprint = previous.markerFingerprints[record.markerId];
    const markerId = fingerprint
      ? fingerprintToMarkerId.get(fingerprint)
      : undefined;
    if (!markerId || markerId === record.markerId) {
      unmatchedCount += 1;
      continue;
    }

    const migratedRecord: ProgressRecord = {
      ...record,
      id: progressRecordId(record.profileId, record.mapId, markerId),
      markerId,
      pendingSync: record.pendingSync !== false,
    };
    const existing = byId.get(migratedRecord.id) ?? migrated.get(migratedRecord.id);
    if (existing) {
      const existingTime = Date.parse(existing.updatedAt);
      const migratedTime = Date.parse(migratedRecord.updatedAt);
      const latest = migratedTime >= existingTime ? migratedRecord : existing;
      migrated.set(migratedRecord.id, {
        ...latest,
        pendingSync: existing.pendingSync !== false || migratedRecord.pendingSync !== false,
      });
    } else {
      migrated.set(migratedRecord.id, migratedRecord);
    }
    removeIds.push(record.id);
  }

  return {
    records: [...migrated.values()],
    removeIds,
    migratedCount: removeIds.length,
    unmatchedCount,
  };
}

export function resolveCompatibleAreaId(
  storedAreaId: string,
  previous: ProgressCompatibilitySnapshot | undefined,
  currentAreas: readonly MapArea[] | undefined,
): string {
  if (!currentAreas || currentAreas.length === 0) {
    return "";
  }
  if (currentAreas.some((area) => area.id === storedAreaId)) {
    return storedAreaId;
  }
  const previousFingerprint = previous?.areaFingerprints[storedAreaId];
  const fingerprintMatches = previousFingerprint
    ? currentAreas.filter((area) => areaFingerprint(area) === previousFingerprint)
    : [];
  if (fingerprintMatches.length === 1) {
    return fingerprintMatches[0]?.id ?? "";
  }
  const previousLabel = previous?.areaLabels[storedAreaId];
  const labelMatches = previousLabel
    ? currentAreas.filter((area) => area.label === previousLabel)
    : [];
  return labelMatches.length === 1 ? labelMatches[0]?.id ?? "" : "";
}
