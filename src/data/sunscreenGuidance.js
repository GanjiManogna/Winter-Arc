/** Return the next local SPF reminder time, unless it reaches the 7 PM cutoff. */
export function getNextSunscreenApplicationTime(timestamp, now = new Date()) {
  const latest = new Date(timestamp);
  if (Number.isNaN(latest.getTime()) || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    return null;
  }

  const cutoff = new Date(
    latest.getFullYear(),
    latest.getMonth(),
    latest.getDate(),
    19,
    0,
    0,
    0
  );
  const next = new Date(latest.getTime() + 3 * 60 * 60 * 1000);
  if (next >= cutoff || now >= cutoff) {
    return null;
  }

  return next.toISOString();
}
