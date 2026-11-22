import { ARC_DURATION_DAYS, getArcEndDate, getCalendarDayDifference, toISODate } from "./storage.js";

export const LANDING_CREATOR_STORY = Object.freeze({
  label: "WHY I BUILT THIS",
  heading: "A gentler way to become stronger.",
  story: [
    "I’ve always believed that becoming a better version of yourself shouldn’t mean being hard on yourself every single day.",
    "There are days when we feel motivated, and days when we don’t. Days when everything goes according to plan, and days when simply showing up is an achievement.",
    "Winter Arc was created from that idea — that small, consistent choices can slowly shape the life we want.",
    "I wanted to build a space that brings together discipline, self-care, reflection, learning, movement, rest, and faith — without making growth feel like punishment.",
    "A place to remind yourself that you don't have to become someone else.",
    "You just have to keep becoming.",
  ],
  signature: "— Manogna Ganji",
});

function hasRecordedArcData(progress) {
  return Object.values(progress?.entries || {}).some((entries) => (
    entries && typeof entries === "object" && Object.keys(entries).length > 0
  )) || Object.keys(progress?.ritualSnapshots || {}).length > 0
    || (Array.isArray(progress?.customHabits) && progress.customHabits.length > 0);
}

/** Derive the landing state from an existing cloud program or recorded local progress. */
export function getLandingArcState(progress, date = new Date(), hasCloudProgram = false) {
  const startDate = progress?.startDate;
  if (!progress || typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
    || (!hasCloudProgram && !hasRecordedArcData(progress))) {
    return { status: "not-started", hasStarted: false, dayNumber: null, startDate: null, endDate: null };
  }

  const endDate = getArcEndDate(startDate);
  const currentDate = toISODate(date);
  const difference = getCalendarDayDifference(startDate, currentDate);
  if (difference < 0) {
    return { status: "upcoming", hasStarted: false, dayNumber: null, startDate, endDate };
  }
  if (currentDate > endDate) {
    return { status: "complete", hasStarted: true, dayNumber: ARC_DURATION_DAYS, startDate, endDate };
  }
  return {
    status: "active",
    hasStarted: true,
    dayNumber: difference + 1,
    startDate,
    endDate,
  };
}

export function formatArcDateRange(startDate, endDate) {
  if (!startDate || !endDate) return "";
  const format = (iso) => {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(startDate.slice(0, 4) !== endDate.slice(0, 4) ? { year: "numeric" } : {}),
    }).toUpperCase();
  };
  return `${format(startDate)} — ${format(endDate)}`;
}

export function getLandingPromiseState(arc, confirmationShown = false) {
  if (arc?.hasStarted) return arc.status === "complete" ? "complete" : "started";
  return confirmationShown ? "confirmed" : "unstarted";
}

function safeCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

/** Read one account-owned challenge and return only safe summary fields for Landing. */
export async function loadLandingChallengeSummary(repository) {
  try {
    const listResult = await repository.list();
    if (listResult?.error) return { status: "unavailable" };
    const challenges = Array.isArray(listResult?.data) ? listResult.data : [];
    const selected = challenges.find((challenge) => challenge?.status === "active") || challenges[0];
    if (!selected || typeof selected.id !== "string") return { status: "empty" };

    let aggregateProgress = null;
    if (selected.status === "active") {
      const detailResult = await repository.read(selected.id);
      const members = Array.isArray(detailResult?.data?.members) ? detailResult.data.members : [];
      const percentages = members
        .map((member) => Number(member?.progress_percent))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);
      if (!detailResult?.error && percentages.length) {
        aggregateProgress = Math.round(percentages.reduce((total, value) => total + value, 0) / percentages.length);
      }
    }

    return {
      status: selected.status === "ended" ? "ended" : "active",
      id: selected.id,
      name: typeof selected.name === "string" ? selected.name : "Winter Arc Challenge",
      memberCount: safeCount(selected.member_count),
      aggregateProgress,
    };
  } catch {
    return { status: "unavailable" };
  }
}
