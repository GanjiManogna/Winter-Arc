/** Reflection persistence is limited to the established local mode. */
export function saveReflectionForMode(mode, save, ...args) {
  if (mode === "cloud-read-only") return false;
  save(...args);
  return true;
}
