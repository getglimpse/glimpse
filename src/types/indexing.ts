export type WatchStatus = "stopped" | "active" | "error";

export type StartupWarmStatus =
  | "idle"
  | "running"
  | "completed"
  | "aborted"
  | "error";

export type StartupWarmStats = {
  status: StartupWarmStatus;
  currentGroupId: string | null;
  currentGroupName: string | null;
  completedGroups: number;
  totalGroups: number;
  lastError: string | null;
};

export type GlobalSearchLoadStats = {
  cachedEngineCount: number;
  tantivyReaderCount: number;
  sqliteConnectionCount: number;
  lastTargetDatabaseCount: number;
  lastCacheMissCount: number;
  lastSearchLatencyMs: number;
  lastColdOpenLatencyMs: number;
  lastResultCount: number;
  processMemoryBytes: number | null;
  startupWarmMemoryBytes: number | null;
  updatedAt: string | null;
};

export type IndexingStats = {
  indexedItems: number;
  watchStatus: WatchStatus;
  lastScanAt: string | null;
  startupWarm: StartupWarmStats;
  globalSearchLoad: GlobalSearchLoadStats;
};

export type IndexingSettings = {
  ignoreHiddenFiles: boolean;
  ignorePatterns: string[];
  maxFileSizeBytes: number | null;
};

export type IndexingStatusResponse = {
  stats: IndexingStats;
  settings: IndexingSettings;
};
