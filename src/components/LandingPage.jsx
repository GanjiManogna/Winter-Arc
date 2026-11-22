import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
import { signOut } from "../auth/authService.js";
import { getAccountDataMode } from "../data/accountDataMode.js";
import { useAccountDataLifecycle } from "../data/useAccountDataLifecycle.js";
import {
  ARC_DURATION_DAYS,
  getSleepSummaryFromProgress,
  loadProgress,
  toISODate,
} from "../data/storage.js";
import { formatSleepDuration } from "../data/sleepDuration.js";
import { challengeRepository } from "../data/challengeRepository.js";
import {
  formatArcDateRange,
  getLandingArcState,
  getLandingPromiseState,
  LANDING_CREATOR_STORY,
  loadLandingChallengeSummary,
} from "../data/landingExperience.js";

function formatLocalClockTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getHeroTimeTheme(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function LandingPage() {
  const landingRef = useRef(null);
  const navigate = useNavigate();
  const { user, displayName, isAuthenticated, loading: authLoading } = useAuth();
  const account = useAccountDataLifecycle();
  const accountMode = getAccountDataMode(account.status);
  const [, setLocalProgressRevision] = useState(0);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [promiseConfirmationKey, setPromiseConfirmationKey] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [challengeSummary, setChallengeSummary] = useState({ status: "loading" });
  const heroTimeTheme = getHeroTimeTheme(currentDate);

  useLayoutEffect(() => {
    const root = landingRef.current;
    if (!root || typeof IntersectionObserver === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined;

    root.classList.add("motion-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });

    root.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const beginRoute = isAuthenticated || authLoading ? "/today" : "/login";

  useEffect(() => {
    const syncProgress = () => setLocalProgressRevision((revision) => revision + 1);
    const refreshDate = () => setCurrentDate(new Date());
    window.addEventListener("winter-arc-progress", syncProgress);
    window.addEventListener("focus", syncProgress);
    const timer = window.setInterval(refreshDate, 60_000);
    window.addEventListener("focus", refreshDate);
    return () => {
      window.removeEventListener("winter-arc-progress", syncProgress);
      window.removeEventListener("focus", syncProgress);
      window.clearInterval(timer);
    };
  }, []);

  const localProgress = isAuthenticated && account.identityKey && accountMode !== "loading" && accountMode !== "cloud-read-only"
    ? loadProgress()
    : null;
  const progress = accountMode === "cloud-read-only" ? account.progress : localProgress;
  const dateISO = toISODate(currentDate);
  const arc = isAuthenticated
    ? getLandingArcState(progress, currentDate, accountMode === "cloud-read-only")
    : getLandingArcState(null, currentDate);
  const sleepSummary = isAuthenticated && progress
    ? getSleepSummaryFromProgress(progress, dateISO)
    : null;

  useEffect(() => {
    let active = true;
    if (authLoading || !user?.id) return () => { active = false; };
    loadLandingChallengeSummary(challengeRepository).then((summary) => {
      if (active) setChallengeSummary({ ...summary, identity: user.id });
    });
    return () => { active = false; };
  }, [authLoading, user?.id]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    const result = await signOut();
    if (result?.error) {
      setSignOutError("Couldn't sign out. Please try again.");
      setSigningOut(false);
      return;
    }
    navigate("/", { replace: true });
  };

  const handleHeroPointerMove = (event) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      || window.matchMedia?.("(pointer: coarse)")?.matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 12;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 8;
    event.currentTarget.style.setProperty("--hero-pointer-x", `${x.toFixed(1)}px`);
    event.currentTarget.style.setProperty("--hero-pointer-y", `${y.toFixed(1)}px`);
  };

  const resetHeroPointer = (event) => {
    event.currentTarget.style.setProperty("--hero-pointer-x", "0px");
    event.currentTarget.style.setProperty("--hero-pointer-y", "0px");
  };

  const arcAction = arc.hasStarted ? "Continue My Journey" : "Begin My Journey";
  const visibleChallengeSummary = authLoading
    ? { status: "loading" }
    : !user?.id
      ? { status: "signed-out" }
      : challengeSummary.identity === user.id
        ? challengeSummary
        : { status: "loading" };
  const activeChallenge = visibleChallengeSummary.status === "active";
  const promiseKey = `${user?.id || "public"}:${arc.startDate || "unstarted"}`;
  const promiseConfirmed = promiseConfirmationKey === promiseKey;
  const promiseState = getLandingPromiseState(arc, promiseConfirmed);
  const challengeEntryRoute = (kind) => isAuthenticated ? `/challenge/${kind}` : "/login";

  return (
    <div ref={landingRef} className="winter-app landing-v2">
      <section
        className="hero-scene"
        data-time-theme={heroTimeTheme}
        onMouseMove={handleHeroPointerMove}
        onMouseLeave={resetHeroPointer}
        aria-labelledby="landing-title"
      >
        <div className="hero-atmosphere" aria-hidden="true">
          <span className="hero-star hero-star--one">✦</span>
          <span className="hero-star hero-star--two">✧</span>
          <span className="hero-star hero-star--three">✦</span>
          <span className="hero-theme-symbol hero-theme-symbol--morning">☼</span>
          <span className="hero-theme-symbol hero-theme-symbol--afternoon">✧</span>
          <span className="hero-theme-symbol hero-theme-symbol--evening">☾</span>
          <span className="hero-theme-symbol hero-theme-symbol--night">☾</span>
          <span className="hero-orbit hero-orbit--one" />
          <span className="hero-orbit hero-orbit--two" />
          <div className="hero-sun" />
          <div className="hero-mountain hero-mountain--back" />
          <div className="hero-mountain hero-mountain--front" />
        </div>

        <header className="landing-header">
          <nav className="landing-nav" aria-label="Landing page">
            <Link className="brand" to="/" aria-label="Winter Arc home">
              <span className="brand-mark" aria-hidden="true">✦</span>
              <span>WINTER ARC</span>
            </Link>
            <div className="nav-actions">
              <Link className="nav-button" to={beginRoute}>
                {arc.hasStarted ? "Continue" : "Begin"}
              </Link>
              {isAuthenticated ? (
                <button className="landing-signout" type="button" onClick={handleSignOut} disabled={signingOut}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              ) : null}
              {signOutError ? <span className="landing-signout-error" role="alert">{signOutError}</span> : null}
            </div>
          </nav>
        </header>

        <div className="hero-layout">
          <div className="hero-content" data-reveal="hero-copy">
            <p className="landing-eyebrow"><span aria-hidden="true">✦</span> {displayName && isAuthenticated ? `A SEASON FOR ${displayName}` : `THE ${ARC_DURATION_DAYS}-DAY JOURNEY`}</p>
            <h1 id="landing-title">Guided by<br /><em>something greater.</em></h1>
            <p className="hero-description">Build better habits. Find a calmer mind.<br className="desktop-break" /> Become the person you want to meet.</p>
            <div className="hero-actions" data-reveal="hero-actions">
              <Link className="primary-button" to={beginRoute}>{arcAction}<span aria-hidden="true">↗</span></Link>
              <a className="text-button" href="#idea">Explore the journey <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-mantra"><span aria-hidden="true">✦</span> GUIDED BY GOD · BUILT BY YOU <span aria-hidden="true">✦</span></p>
          </div>
        </div>

        <div className="hero-bottom" aria-label="Your Winter Arc progress">
          <span>{arc.hasStarted ? `${String(arc.dayNumber).padStart(2, "0")} / ${ARC_DURATION_DAYS}` : "A SEASON OF SHOWING UP"}</span>
          <span className="hero-date-range">{arc.startDate ? formatArcDateRange(arc.startDate, arc.endDate) : "YOUR WINTER ARC"}</span>
        </div>
      </section>

      <main className="landing-main">
        <section className="connection-rest-section" data-reveal="connection-atmosphere" aria-labelledby="connection-title">
          <div className="connection-heading" data-reveal="connection-heading">
            <p className="section-kicker">CONNECTION + REST</p>
            <h2 id="connection-title">A life is built <em>together and slowly.</em></h2>
            <span className="guidance-star" aria-hidden="true">✦</span>
          </div>
          <div className="connection-grid">
            <article className="connection-panel friends-panel" data-reveal="friends-content">
              <p className="section-kicker">WALK THIS SEASON TOGETHER</p>
              {activeChallenge ? (
                <>
                  <h3>{visibleChallengeSummary.name}</h3>
                  <p className="connection-copy">Keep showing up alongside the people sharing this season.</p>
                  <div className="challenge-aggregate">
                    <span>{visibleChallengeSummary.memberCount ?? "—"} {visibleChallengeSummary.memberCount === 1 ? "member" : "members"}</span>
                    {visibleChallengeSummary.aggregateProgress !== null ? <span>Shared progress · {visibleChallengeSummary.aggregateProgress}%</span> : null}
                  </div>
                  <Link className="panel-action" to={`/challenge/${visibleChallengeSummary.id}`}>Open Challenge</Link>
                </>
              ) : visibleChallengeSummary.status === "loading" ? (
                <>
                  <h3>Grow together.</h3>
                  <p className="connection-copy" role="status">Preparing your shared season…</p>
                </>
              ) : visibleChallengeSummary.status === "unavailable" ? (
                <>
                  <h3>Grow together.</h3>
                  <p className="connection-copy" role="status">Your challenges are temporarily unavailable.</p>
                  {isAuthenticated ? <Link className="panel-action" to="/challenge">Open Friends Challenge</Link> : null}
                </>
              ) : visibleChallengeSummary.status === "empty" || visibleChallengeSummary.status === "signed-out" ? (
                <>
                  <h3>Walk this season together.</h3>
                  <p className="connection-copy">A little encouragement can make a long journey feel closer.</p>
                  <div className="panel-actions">
                    <Link className="panel-action" to={challengeEntryRoute("create")}>Create Challenge</Link>
                    <Link className="panel-action panel-action--quiet" to={challengeEntryRoute("join")}>Join Challenge</Link>
                  </div>
                </>
              ) : (
                <>
                  <h3>{visibleChallengeSummary.name}</h3>
                  <p className="connection-copy">This shared season has ended. Its story remains with you.</p>
                  <p className="challenge-aggregate">{visibleChallengeSummary.memberCount ?? "—"} members</p>
                  <div className="panel-actions">
                    <Link className="panel-action" to="/challenge">Open Challenge</Link>
                    <Link className="panel-action panel-action--quiet" to={challengeEntryRoute("create")}>Create Another</Link>
                  </div>
                </>
              )}
            </article>

            <article className="connection-panel sleep-panel" data-reveal="sleep-content">
              <p className="section-kicker">REST IS PART OF THE WORK</p>
              <h3>Your sleep</h3>
              {sleepSummary?.durationMinutes !== null && sleepSummary ? (
                <>
                  <strong className="sleep-duration">{formatSleepDuration(sleepSummary.durationMinutes)}</strong>
                  <p className="sleep-times">{formatLocalClockTime(sleepSummary.sleepTime)} <span aria-hidden="true">→</span> {formatLocalClockTime(sleepSummary.wakeTime)}</p>
                </>
              ) : sleepSummary ? (
                <p className="connection-copy">
                  {sleepSummary.sleepTime && sleepSummary.wakeTime
                    ? "These times do not form a supported sleep duration."
                    : sleepSummary.sleepTime
                      ? `Bedtime recorded at ${formatLocalClockTime(sleepSummary.sleepTime)} · wake time still needed.`
                      : sleepSummary.wakeTime
                        ? `Wake time recorded at ${formatLocalClockTime(sleepSummary.wakeTime)} · bedtime is still needed.`
                        : "A quiet invitation to begin tracking your rest."}
                </p>
              ) : !isAuthenticated ? (
                <p className="connection-copy">Sign in to see your sleep summary, or begin tracking your rest.</p>
              ) : accountMode === "loading" ? (
                <p className="connection-copy" role="status">Loading your sleep summary…</p>
              ) : (
                <p className="connection-copy">Your sleep summary is not available yet. Open the tracker to record your rest.</p>
              )}
              {sleepSummary?.durationMinutes === null && sleepSummary?.manualHours !== null ? (
                <p className="sleep-legacy">Previously recorded · {sleepSummary.manualHours} hours</p>
              ) : null}
              <Link className="panel-action" to={isAuthenticated ? "/ritual/sleep-tracker" : "/login"}>View Sleep Tracker</Link>
            </article>
          </div>
        </section>

        <section className="idea-section" id="idea" data-reveal="idea-atmosphere" aria-labelledby="idea-title">
          <div className="idea-mark" aria-hidden="true" data-reveal="idea-star">✦</div>
          <div className="idea-copy" data-reveal="idea-copy">
            <p className="section-kicker">A QUIETER BEGINNING</p>
            <h2 id="idea-title">This is more than a habit tracker.<br /><em>It is a way to return to what matters.</em></h2>
            <p>Winter Arc is a {ARC_DURATION_DAYS}-day journey built around the small things that shape a life.</p>
            <p className="idea-ritual-line">Wake. Move. Nourish. Work. Learn. Reflect. Rest.</p>
            <p>Each ritual carries its own feeling, inspired by qualities we find in the divine.</p>
          </div>
        </section>

        <section className="moments-section" data-reveal="moments-atmosphere" aria-labelledby="moments-title">
          <div className="moments-heading" data-reveal="moments-heading">
            <p className="section-kicker">THE DAY UNFOLDS INTO A LIFE</p>
            <h2 id="moments-title">Four moments.<br /><em>One direction.</em></h2>
          </div>
          <ol className="moments-grid">
            <li className="moment moment-rise" data-reveal="moment"><span className="moment-mark" aria-hidden="true">☼</span><div className="moment-copy"><span className="moment-number">01 <span>· INTENTION</span></span><h3>Rise</h3><p>Begin with intention.</p></div></li>
            <li className="moment moment-build" data-reveal="moment"><span className="moment-mark" aria-hidden="true">✦</span><div className="moment-copy"><span className="moment-number">02 <span>· STRENGTH</span></span><h3>Build</h3><p>Strength is built.</p></div></li>
            <li className="moment moment-learn" data-reveal="moment"><span className="moment-mark" aria-hidden="true">❋</span><div className="moment-copy"><span className="moment-number">03 <span>· CURIOSITY</span></span><h3>Learn</h3><p>Let knowledge grow.</p></div></li>
            <li className="moment moment-still" data-reveal="moment"><span className="moment-mark" aria-hidden="true">◐</span><div className="moment-copy"><span className="moment-number">04 <span>· STILLNESS</span></span><h3>Be Still</h3><p>Let quiet be enough.</p></div></li>
          </ol>
          <div className="quiet-transition" data-reveal="moments-close" aria-label="Wake. Move. Nourish. Learn. Reflect. Rest. Small things become a life.">
            <span>Wake. Move. Nourish. Learn. Reflect. Rest.</span>
            <strong>Small things become a life.</strong>
            <span className="guidance-star" aria-hidden="true">✦</span>
          </div>
        </section>

        <section className="promise-section" data-reveal="promise-atmosphere" aria-labelledby="promise-title">
          <span className="promise-light" aria-hidden="true">✦</span>
          <div className="promise-content">
            <p className="section-kicker" data-reveal="promise-kicker">THE PROMISE</p>
            <p className="promise-number" data-reveal="promise-number">{ARC_DURATION_DAYS}</p>
            <h2 id="promise-title" data-reveal="promise-title">Days of<br /><em>showing up.</em></h2>
            <p className="promise-copy" data-reveal="promise-copy">Not perfection. Not punishment.<br />Just one small promise to yourself,<br />kept again and again.</p>
            {promiseState === "started" || promiseState === "complete" ? (
              <div className="promise-state" role="status" data-reveal="promise-action">
                <strong>You made a promise to yourself. ✦</strong>
                <span>{promiseState === "complete" ? `${ARC_DURATION_DAYS} / ${ARC_DURATION_DAYS} · COMPLETE` : `DAY ${String(arc.dayNumber).padStart(2, "0")} / ${ARC_DURATION_DAYS}`}</span>
                <span>{promiseState === "complete" ? "Your saved journey is still here." : "Keep going, one day at a time."}</span>
                <Link className="primary-button" to="/today">{promiseState === "complete" ? "Review My Journey" : "Continue My Journey"}</Link>
              </div>
            ) : promiseState === "confirmed" ? (
              <div className="promise-state" role="status" data-reveal="promise-action">
                <strong>You promised yourself. ✦</strong>
                <span>{ARC_DURATION_DAYS} days. One day at a time.</span>
                <span>Your Winter Arc begins when you choose to begin.</span>
                <Link className="primary-button" to={beginRoute}>{arcAction}<span aria-hidden="true">↗</span></Link>
              </div>
            ) : (
                <button className="primary-button" type="button" data-reveal="promise-action" onClick={() => setPromiseConfirmationKey(promiseKey)}>Make My Promise</button>
            )}
          </div>
        </section>

        <section className="personal-ending-section" data-reveal="ending-atmosphere" aria-labelledby="creator-story-title">
          <div className="creator-story" data-reveal="creator-story">
            <div className="creator-story-mark" aria-hidden="true">✦</div>
            <div className="creator-story-content">
              <p className="section-kicker">{LANDING_CREATOR_STORY.label}</p>
              <h2 id="creator-story-title">{LANDING_CREATOR_STORY.heading}</h2>
              <p className="creator-story-placeholder">
                {LANDING_CREATOR_STORY.story.map((paragraph, index) => (
                  <Fragment key={paragraph}>
                    {index > 0 && <><br /><br /></>}
                    {paragraph}
                  </Fragment>
                ))}
              </p>
              <p className="creator-story-principle">Become better without becoming cruel to yourself.<br />Guided by God · Built by you.</p>
              <span className="creator-signature">{LANDING_CREATOR_STORY.signature}</span>
            </div>
          </div>
          <span className="ending-transition-star" data-reveal="ending-star" aria-hidden="true">✦</span>
          <div className="final-section" aria-labelledby="final-title" data-reveal="final-cta">
            <p className="section-kicker">A NEW SEASON, ONE DAY AT A TIME</p>
            <h2 id="final-title">Your winter<br /><em>starts here.</em></h2>
            <p className="final-supporting">The person you’re becoming is waiting.</p>
            <Link className="primary-button" to={beginRoute}>{arc.hasStarted ? "Continue Your Winter Arc" : "Begin Your Winter Arc"}<span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <Link className="footer-brand" to="/"><span aria-hidden="true">✦</span> WINTER ARC</Link>
        <p>{ARC_DURATION_DAYS} days · peace · discipline · purpose</p>
        <span>© 2026</span>
      </footer>
    </div>
  );
}

export default LandingPage;
