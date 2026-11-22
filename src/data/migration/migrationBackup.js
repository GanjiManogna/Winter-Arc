import { PROGRESS_STORAGE_KEY } from "../storage.js";

export const MIGRATION_BACKUP_KEY = `${PROGRESS_STORAGE_KEY}.migration-backup.v1`;

function browserStorage(storage) {
  return storage || (typeof window !== "undefined" ? window.localStorage : null);
}

/** Save the exact serialized source separately; never rewrite or remove it. */
export function backupLocalData({ storage: providedStorage } = {}) {
  const storage = browserStorage(providedStorage);
  if (!storage) return { backedUp: false, error: { code: "LOCAL_STORAGE_UNAVAILABLE" } };
  let source;
  try {
    source = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return { backedUp: false, error: { code: "LOCAL_STORAGE_UNAVAILABLE" } };
  }
  if (source === null) return { backedUp: false, error: { code: "LOCAL_DATA_MISSING" } };
  try {
    const existing = storage.getItem(MIGRATION_BACKUP_KEY);
    if (existing !== null && existing !== source) {
      return { backedUp: false, error: { code: "BACKUP_ALREADY_EXISTS_DIFFERENT_SOURCE" } };
    }
    if (existing === null) storage.setItem(MIGRATION_BACKUP_KEY, source);
    return { backedUp: true, reused: existing !== null, error: null };
  } catch {
    return { backedUp: false, error: { code: "BACKUP_WRITE_FAILED" } };
  }
}
