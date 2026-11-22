export const TIME_COPY = {
  morning: {
    heading: "Good morning.",
    supporting: "Begin gently.",
    message: "You don't need a perfect day. You just need to show up for yourself.",
  },
  afternoon: {
    heading: "Keep going.",
    supporting: "You're already on your way.",
    message: "Take a breath. Do the next thing that matters.",
  },
  evening: {
    heading: "You made it this far.",
    supporting: "Keep your light on.",
    message: "Finish what matters. Then give yourself permission to slow down.",
  },
  night: {
    heading: "Good night.",
    supporting: "You did enough for today.",
    message: "You showed up. Now let yourself rest.",
  },
};

export function personalizeGreetingHeading(heading, displayName) {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  if (!name || typeof heading !== "string") return heading;
  return heading.replace(/\.$/, `, ${name}.`);
}

export function getTimePeriod(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 22 || hour < 5) return "night";
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "morning";
}

export function delayUntilNextMinute(date = new Date()) {
  return 60000 - date.getSeconds() * 1000 - date.getMilliseconds();
}

export function getProgressMessage(count, total, period = "morning") {
  if (count <= 0) {
    return period === "night"
      ? "The day isn't a failure. Tomorrow is another beginning."
      : "Your journey begins with one small step.";
  }

  if (total > 0 && count >= total) {
    return period === "night"
      ? "You kept your promise to yourself. ✦ Rest well."
      : "You showed up for yourself today. ✦";
  }

  if (period === "night") {
    if (count <= 2) return "The day isn't a failure. Tomorrow is another beginning.";
    if (count <= 6) return "You showed up today. Let that be enough.";
    return "Almost everything done. Rest now. You can finish tomorrow.";
  }

  if (count <= 3) return "Keep going. You're building something.";
  if (count <= 6) return "You're showing up for yourself.";
  return "Almost there. Stay with it.";
}
