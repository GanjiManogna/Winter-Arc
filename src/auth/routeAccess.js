export function getProtectedRouteAccess({ loading, isAuthenticated }) {
  if (loading) return "loading";
  return isAuthenticated ? "allow" : "redirect";
}
