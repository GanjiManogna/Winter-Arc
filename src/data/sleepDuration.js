const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_SLEEP_MINUTES = 16 * 60;

function minutesSinceMidnight(value) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Calculates elapsed local-clock time. A wake time earlier than the sleep time
 * is treated as the following day. Durations must be positive and at most 16h.
 * Returns null when either time is missing/invalid or the interval is implausible.
 */
export function calculateSleepDuration(sleepTime, wakeTime) {
  const sleepMinutes = minutesSinceMidnight(sleepTime);
  const wakeMinutes = minutesSinceMidnight(wakeTime);
  if (sleepMinutes === null || wakeMinutes === null) return null;

  let durationMinutes = wakeMinutes - sleepMinutes;
  if (durationMinutes <= 0) durationMinutes += 24 * 60;
  if (durationMinutes <= 0 || durationMinutes > MAX_SLEEP_MINUTES) return null;

  return {
    durationMinutes,
    durationHours: durationMinutes / 60,
  };
}

export function formatSleepDuration(durationMinutes) {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return "";
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function isLocalTime(value) {
  return typeof value === "string" && TIME_PATTERN.test(value);
}
