export function isRangeRitual(ritual) {
  return Number.isFinite(ritual?.goalMin) && Number.isFinite(ritual?.goalMax);
}

export function isTargetRitual(ritual) {
  return Number.isFinite(ritual?.goal) && ritual.goal > 0;
}

export function isMeasurableRitual(ritual) {
  return isTargetRitual(ritual) || isRangeRitual(ritual);
}

export function isInformationalRitual(ritual) {
  return ritual?.id === "sleep-tracker";
}

const MEAL_MASK = 0b111;

export function getHealthyMealsMask(entry = null) {
  const value = Number(entry?.value);
  return Number.isInteger(value) && value >= 0 && value <= MEAL_MASK ? value : 0;
}

export function getHealthyMealsCount(entry = null) {
  const mask = getHealthyMealsMask(entry);
  return Number(Boolean(mask & 1)) + Number(Boolean(mask & 2)) + Number(Boolean(mask & 4));
}

export function toggleHealthyMeal(entry, mealIndex) {
  if (!Number.isInteger(mealIndex) || mealIndex < 0 || mealIndex > 2) return getHealthyMealsMask(entry);
  return getHealthyMealsMask(entry) ^ (1 << mealIndex);
}

export function getSunscreenApplicationCount(entry = null) {
  return (Array.isArray(entry?.applicationTimes) ? entry.applicationTimes : [])
    .filter((timestamp) => typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))).length;
}

export function canCompleteSkincareAt(date = new Date()) {
  return date instanceof Date && !Number.isNaN(date.getTime()) && date.getHours() >= 20;
}

export function canCompleteSleepOnTimeAt(date = new Date()) {
  return date instanceof Date && !Number.isNaN(date.getTime()) && date.getHours() < 23;
}

export function toNumericValue(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getProgressPercent(value, target) {
  if (!Number.isFinite(target) || target <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((toNumericValue(value) / target) * 100));
}

export function getRitualProgressPercent(ritual, value) {
  if (isRangeRitual(ritual)) {
    return getProgressPercent(value, ritual.goalMax);
  }
  if (isTargetRitual(ritual)) {
    return getProgressPercent(value, ritual.goal);
  }
  return 0;
}

export function getRitualStatus(ritual, entry = null) {
  if (ritual?.id === "sunscreen") {
    const count = getSunscreenApplicationCount(entry);
    const completed = count >= 2;
    return {
      key: completed ? "complete" : count === 1 ? "progress" : "empty",
      mark: completed ? "✓" : count === 1 ? "◐" : "○",
      completed,
      inProgress: count === 1,
      value: count,
    };
  }

  if (ritual?.id === "food") {
    // Legacy records stored only a boolean. Keep their historical completion
    // visible until meal-level tracking is explicitly started for that day.
    if ((entry?.value === null || entry?.value === undefined) && entry?.completed === true) {
      return { key: "complete", mark: "✓", completed: true, inProgress: false, value: null, legacy: true };
    }
    const count = getHealthyMealsCount(entry);
    const completed = count >= 2;
    return {
      key: completed ? "complete" : count === 1 ? "progress" : "empty",
      mark: completed ? "✓" : count === 1 ? "◐" : "○",
      completed,
      inProgress: count === 1,
      value: count,
    };
  }

  if (isRangeRitual(ritual)) {
    const value = toNumericValue(entry?.value);
    if (isInformationalRitual(ritual)) {
      const rangeState = value <= 0
        ? "empty"
        : value < ritual.goalMin
          ? "below"
          : value <= ritual.goalMax
            ? "within"
            : "above";
      return {
        key: rangeState,
        mark: value > 0 ? "·" : "—",
        completed: false,
        inProgress: false,
        rangeState,
        value,
      };
    }
    if (value <= 0) {
      return {
        key: "empty",
        mark: "—",
        completed: false,
        inProgress: false,
        rangeState: "empty",
        value,
      };
    }
    if (value < ritual.goalMin) {
      return {
        key: "below",
        mark: "◐",
        completed: false,
        inProgress: true,
        rangeState: "below",
        value,
      };
    }
    if (value <= ritual.goalMax) {
      return {
        key: "within",
        mark: "✓",
        completed: true,
        inProgress: false,
        rangeState: "within",
        value,
      };
    }
    return {
      key: "above",
      mark: "✦",
      completed: true,
      inProgress: false,
      rangeState: "above",
      value,
    };
  }

  if (isTargetRitual(ritual)) {
    const value = toNumericValue(entry?.value);
    if (value <= 0) {
      return {
        key: "empty",
        mark: "—",
        completed: false,
        inProgress: false,
        value,
      };
    }
    if (value < ritual.goal) {
      return {
        key: "progress",
        mark: "◐",
        completed: false,
        inProgress: true,
        value,
      };
    }
    return {
      key: "complete",
      mark: "✓",
      completed: true,
      inProgress: false,
      value,
    };
  }

  if (entry?.completed) {
    return {
      key: "complete",
      mark: "✓",
      completed: true,
      inProgress: false,
      value: null,
    };
  }

  return {
    key: "empty",
    mark: "○",
    completed: false,
    inProgress: false,
    value: null,
  };
}

export function deriveCompleted(ritual, { value = null, completed = false } = {}) {
  return getRitualStatus(ritual, { value, completed }).completed;
}
