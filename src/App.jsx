import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import LandingPage from "./components/LandingPage.jsx";
import TodayDashboard from "./components/TodayDashboard";
import RitualPage from "./components/RitualPage";
import JourneyPage from "./components/JourneyPage";
import HistoryPage from "./components/HistoryPage";
import AuthPage from "./components/AuthPage";
import NotificationSettingsPage from "./components/NotificationSettingsPage.jsx";
import FriendsChallengePage from "./components/FriendsChallengePage.jsx";
import { useAuth } from "./auth/useAuth";
import { getProtectedRouteAccess } from "./auth/routeAccess.js";

const MigrationPreviewPage = import.meta.env.DEV
  ? lazy(() => import("./components/MigrationPreviewPage.jsx"))
  : null;
const MigrationImportPage = import.meta.env.DEV
  ? lazy(() => import("./components/MigrationImportPage.jsx"))
  : null;

/* =========================================
   APP ROUTER
========================================= */

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function RequireAuth() {
  const auth = useAuth();
  const access = getProtectedRouteAccess(auth);

  if (access === "loading") return null;
  if (access === "redirect") return <Navigate to="/login" replace />;
  return <Outlet />;
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />

      <Routes>

        <Route
          path="/"
          element={<LandingPage />}
        />

        <Route element={<RequireAuth />}>
          <Route path="/today" element={<TodayDashboard />} />
          <Route path="/challenge" element={<FriendsChallengePage />} />
          <Route path="/challenge/create" element={<FriendsChallengePage />} />
          <Route path="/challenge/join" element={<FriendsChallengePage />} />
          <Route path="/challenge/:challengeId" element={<FriendsChallengePage />} />
          <Route path="/ritual/:ritualId" element={<RitualPage />} />
          <Route path="/journey" element={<JourneyPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/reminders" element={<NotificationSettingsPage />} />
          <Route path="/settings/notifications" element={<NotificationSettingsPage />} />

          {import.meta.env.DEV ? (
            <>
              <Route
                path="/migration-preview"
                element={(
                  <Suspense fallback={<p>Opening read-only preview…</p>}>
                    <MigrationPreviewPage />
                  </Suspense>
                )}
              />
              <Route
                path="/migration-import"
                element={(
                  <Suspense fallback={<p>Opening developer migration tooling…</p>}>
                    <MigrationImportPage />
                  </Suspense>
                )}
              />
            </>
          ) : null}
        </Route>

        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />

      </Routes>

    </BrowserRouter>
  );
}

export default App;
