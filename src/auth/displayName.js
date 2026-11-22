export function getDisplayName(user) {
  const displayName = user?.user_metadata?.display_name;
  if (typeof displayName !== "string") return null;
  const trimmedName = displayName.trim();
  return trimmedName || null;
}
