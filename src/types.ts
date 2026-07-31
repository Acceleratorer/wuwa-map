export type SchemaVersion = 1;

export type MapIconName =
  | "activity"
  | "boss"
  | "chest"
  | "collection"
  | "default"
  | "elite"
  | "enemy"
  | "exploration"
  | "location"
  | "resource";

export interface MapCategoryGroup {
  id: string;
  label: string;
  icon: MapIconName;
}

export interface MapCategory {
  id: string;
  label: string;
  color: string;
  symbol: string;
  groupId?: string;
  icon?: MapIconName;
}

export interface MapMarker {
  id: string;
  categoryId: string;
  title: string;
  x: number;
  y: number;
  description?: string;
}

export interface MapImageSource {
  src: string;
  width: number;
  height: number;
}

export interface MapTileSource {
  src: string;
  tileSize: number;
  columns: number;
  rows: number;
  availableTiles?: string[];
}

export interface MapPack {
  schemaVersion: SchemaVersion;
  id: string;
  title: string;
  subtitle?: string;
  attribution: string;
  image?: MapImageSource;
  tiles?: MapTileSource;
  categoryGroups?: MapCategoryGroup[];
  categories: MapCategory[];
  defaultVisibleCategoryIds?: string[];
  markers: MapMarker[];
}

export interface MapCatalogEntry {
  id: string;
  title: string;
  pack: string;
}

export interface MapCatalog {
  schemaVersion: SchemaVersion;
  defaultMapId: string;
  maps: MapCatalogEntry[];
}

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProgressRecord {
  id: string;
  mapId: string;
  markerId: string;
  profileId: string;
  done: boolean;
  updatedAt: string;
  pendingSync?: boolean;
}

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
}

export interface BackupPayload {
  schemaVersion: SchemaVersion;
  exportedAt: string;
  profiles: Profile[];
  progress: ProgressRecord[];
  settings: AppSetting[];
}
