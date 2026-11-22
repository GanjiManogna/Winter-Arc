export function getAccountDataMode(accountStatus) {
  if (accountStatus === "loaded") return "cloud-read-only";
  if (accountStatus === "loading") return "loading";
  if (accountStatus === "no-cloud-program") return "local-no-cloud-program";
  if (accountStatus === "cloud-load-error") return "local-cloud-error";
  return "local";
}
