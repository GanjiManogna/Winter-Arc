import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AppHeader from "./AppHeader.jsx";
import { useAuth } from "../auth/useAuth.js";
import { challengeRepository, generateChallengeInviteCode } from "../data/challengeRepository.js";
import { toISODate } from "../data/storage.js";
import "./FriendsChallengePage.css";

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatDateRange(start, end) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function messageFor(error) {
  const copy = {
    AUTH_REQUIRED: "Please sign in to continue.",
    INVALID_NAME: "Choose a challenge name between 2 and 80 characters.",
    INVALID_DATE_RANGE: "Choose an end date after the start date.",
    INVALID_INVITE: "That invite doesn't seem to be valid.",
    INVALID_INVITE_CODE: "We couldn't create a secure invite. Please try again.",
    CHALLENGE_ENDED: "This challenge has ended and can't accept new members.",
    ALREADY_MEMBER: "You're already part of this challenge.",
    OWNER_MUST_END: "As the owner, end the challenge to close it.",
    CHALLENGE_NOT_FOUND: "This challenge is no longer available to your account.",
    NETWORK_ERROR: "Check your connection and try again.",
  };
  return copy[error?.code] || "Friends Challenge couldn't load. Please try again.";
}

function FriendsChallengeContent({ displayName }) {
  const { challengeId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const route = location.pathname.endsWith("/create")
    ? "create"
    : location.pathname.endsWith("/join")
      ? "join"
      : challengeId
        ? "detail"
        : "list";
  const [loading, setLoading] = useState(route !== "create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [challenges, setChallenges] = useState([]);
  const [challenge, setChallenge] = useState(null);
  const [challengeName, setChallengeName] = useState("");
  const [startDate, setStartDate] = useState(() => toISODate());
  const [endDate, setEndDate] = useState("");
  const [inviteCode, setInviteCode] = useState(searchParams.get("code") || "");
  const [invitePreview, setInvitePreview] = useState(null);

  const load = useCallback(async () => {
    const result = route === "detail"
      ? await challengeRepository.read(challengeId)
      : await challengeRepository.list();
    setError(result.error ? messageFor(result.error) : "");
    if (result.error) {
      setError(messageFor(result.error));
      setChallenge(null);
      setChallenges([]);
    } else if (route === "detail") {
      setChallenge(result.data);
    } else {
      setChallenges(Array.isArray(result.data) ? result.data : []);
    }
    setLoading(false);
  }, [route, challengeId]);

  useEffect(() => {
    if (route === "create" || route === "join") {
      return undefined;
    }
    const refresh = () => { void Promise.resolve().then(load); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("winter-arc-progress", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("winter-arc-progress", refresh);
    };
  }, [load, route]);

  useEffect(() => {
    const code = searchParams.get("code");
    if (route !== "join" || !code) return;
    let active = true;
    challengeRepository.previewInvite(code).then((result) => {
      if (!active) return;
      setInvitePreview(result.data || null);
      setError(result.error ? messageFor(result.error) : "");
      setLoading(false);
    });
    return () => { active = false; };
  }, [route, searchParams]);

  const challengeLink = useMemo(() => {
    if (!challenge?.invite_code || typeof window === "undefined") return "";
    return `${window.location.origin}/challenge/join?code=${encodeURIComponent(challenge.invite_code)}`;
  }, [challenge?.invite_code]);

  const create = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const cleanName = challengeName.trim();
    if (cleanName.length < 2 || cleanName.length > 80 || !startDate || !endDate || endDate <= startDate) {
      setError("Add a challenge name and choose an end date after the start date.");
      return;
    }
    const code = generateChallengeInviteCode();
    if (!code) {
      setError("This device couldn't create a secure invite. Please try again in a supported browser.");
      return;
    }
    setBusy(true);
    const result = await challengeRepository.create({ name: cleanName, startDate, endDate, inviteCode: code });
    setBusy(false);
    if (result.error) {
      setError(messageFor(result.error));
      return;
    }
    navigate(`/challenge/${result.data}`, { replace: true });
  };

  const preview = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setInvitePreview(null);
    const result = await challengeRepository.previewInvite(inviteCode.trim());
    setBusy(false);
    if (result.error) setError(messageFor(result.error));
    else setInvitePreview(result.data);
  };

  const join = async () => {
    if (!invitePreview || busy) return;
    setBusy(true);
    setError("");
    const result = await challengeRepository.join(inviteCode.trim());
    setBusy(false);
    if (result.error) {
      setError(messageFor(result.error));
      return;
    }
    navigate(`/challenge/${result.data}`, { replace: true });
  };

  const leaveOrEnd = async () => {
    if (!challenge || busy) return;
    const isOwner = challenge.owner;
    const confirmed = window.confirm(isOwner
      ? "End this challenge? Members will keep its final results, and no one else can join."
      : "Leave this challenge? Your personal Winter Arc progress will remain unchanged.");
    if (!confirmed) return;
    setBusy(true);
    setError("");
    const result = isOwner
      ? await challengeRepository.end(challenge.id)
      : await challengeRepository.leave(challenge.id);
    setBusy(false);
    if (result.error) {
      setError(messageFor(result.error));
      return;
    }
    if (isOwner) {
      setNotice("This challenge has ended. Its results remain available to members.");
      await load();
    } else {
      navigate("/challenge", { replace: true });
    }
  };

  const copyInvite = async () => {
    if (!challengeLink) return;
    try {
      await navigator.clipboard.writeText(challengeLink);
      setNotice("Invite link copied.");
    } catch {
      setNotice(`Invite code: ${challenge.invite_code}`);
    }
  };

  const shareInvite = async () => {
    if (!challengeLink) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: challenge.name, text: "Join my Winter Arc Challenge.", url: challengeLink });
        setNotice("Invite ready to share.");
      } catch (shareError) {
        if (shareError?.name !== "AbortError") setError("Sharing isn't available right now. Copy the invite link instead.");
      }
    } else {
      await copyInvite();
    }
  };

  return (
    <main className="friends-challenge-page">
      <AppHeader />
      <div className="friends-challenge-content">
        <header className="friends-challenge-intro">
          <p className="friends-challenge-kicker">WINTER ARC · TOGETHER</p>
          <h1>{route === "detail" && challenge ? challenge.name : route === "create" ? "Create a Challenge" : route === "join" ? "Join a Challenge" : "Grow together."}</h1>
          <p>Everyone's path is different. Show up, keep going, and share the season.</p>
        </header>

        {error ? <p className="friends-challenge-feedback is-error" role="alert">{error}</p> : null}
        {notice ? <p className="friends-challenge-feedback" role="status">{notice}</p> : null}

        {route === "create" ? (
          <form className="friends-challenge-panel friends-challenge-form" onSubmit={create}>
            <p className="friends-challenge-kicker">A SHARED SEASON</p>
            <h2>Create your private challenge</h2>
            <p className="friends-challenge-muted">Your account name will be used automatically for your member display.</p>
            {displayName ? <p className="friends-challenge-identity">Created by {displayName}</p> : null}
            <label>
              <span>Challenge name</span>
              <input value={challengeName} onChange={(event) => setChallengeName(event.target.value)} maxLength={80} minLength={2} required autoComplete="off" />
            </label>
            <div className="friends-challenge-date-fields">
              <label>
                <span>Start date</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
              </label>
              <label>
                <span>End date</span>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} min={startDate || undefined} required />
              </label>
            </div>
            <button className="friends-challenge-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create a Challenge"}</button>
            <Link className="friends-challenge-back" to="/challenge">Back to Friends Challenge</Link>
          </form>
        ) : null}

        {route === "join" ? (
          <section className="friends-challenge-panel">
            <form className="friends-challenge-form" onSubmit={preview}>
              <label>
                <span>Invite code</span>
                <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} maxLength={24} minLength={12} autoCapitalize="characters" autoComplete="off" required />
              </label>
              <button className="friends-challenge-secondary" type="submit" disabled={busy}>{busy ? "Checking…" : "Find Challenge"}</button>
            </form>
            {invitePreview ? (
              <div className="friends-challenge-invite-preview">
                <p className="friends-challenge-kicker">INVITATION</p>
                <h2>{invitePreview.name}</h2>
                <p>{formatDateRange(invitePreview.start_date, invitePreview.end_date)}</p>
                <p>Created by {invitePreview.owner_name}</p>
                <p>{invitePreview.member_count} {invitePreview.member_count === 1 ? "member" : "members"}</p>
                {invitePreview.already_member ? (
                  <Link className="friends-challenge-primary as-link" to={`/challenge/${invitePreview.id}`}>Open Challenge</Link>
                ) : (
                  <button className="friends-challenge-primary" type="button" disabled={busy} onClick={() => { void join(); }}>Join Challenge</button>
                )}
              </div>
            ) : null}
            <Link className="friends-challenge-back" to="/challenge">Back to Friends Challenge</Link>
          </section>
        ) : null}

        {route === "list" ? (
          <section className="friends-challenge-list-section" aria-busy={loading}>
            <div className="friends-challenge-actions">
              <Link className="friends-challenge-primary as-link" to="/challenge/create">Create a Challenge</Link>
              <Link className="friends-challenge-secondary as-link" to="/challenge/join">Join a Challenge</Link>
            </div>
            <h2>Your Challenges</h2>
            {loading ? <p className="friends-challenge-muted" role="status">Opening your challenges…</p> : null}
            {!loading && challenges.length === 0 ? (
              <div className="friends-challenge-empty">
                <span aria-hidden="true">✦</span>
                <h3>Begin the season together.</h3>
                <p>Create a private challenge or join one with an invite code.</p>
              </div>
            ) : null}
            <div className="friends-challenge-cards">
              {challenges.map((item) => (
                <Link className="friends-challenge-card" key={item.id} to={`/challenge/${item.id}`}>
                  <span className={`friends-challenge-status ${item.status === "ended" ? "is-ended" : ""}`}>{item.status === "ended" ? "Ended" : "In progress"}</span>
                  <h3>{item.name}</h3>
                  <p>{formatDateRange(item.start_date, item.end_date)}</p>
                  <span>{item.member_count} {item.member_count === 1 ? "member" : "members"} · {item.role === "owner" ? "Owner" : "Member"}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {route === "detail" ? (
          <section className="friends-challenge-detail" aria-busy={loading}>
            {loading ? <p className="friends-challenge-muted" role="status">Opening your challenge…</p> : null}
            {!loading && challenge ? (
              <>
                <div className="friends-challenge-panel friends-challenge-summary">
                  <p className="friends-challenge-kicker">{challenge.status === "ended" ? "A SEASON COMPLETED" : "YOUR SHARED SEASON"}</p>
                  <h2>{formatDateRange(challenge.start_date, challenge.end_date)}</h2>
                  <p>{challenge.status === "ended"
                    ? "This challenge has ended. Its shared results remain here."
                    : challenge.challenge_day > 0
                      ? `Day ${challenge.challenge_day} of ${challenge.total_days}`
                      : "Your challenge begins soon."}</p>
                  <p className="friends-challenge-muted">Created by {challenge.owner_name} · {challenge.member_count} {challenge.member_count === 1 ? "member" : "members"}</p>
                  {challenge.status !== "ended" ? (
                    <div className="friends-challenge-invite-actions">
                      <span>Invite code <strong>{challenge.invite_code}</strong></span>
                      <button type="button" className="friends-challenge-secondary" onClick={() => { void copyInvite(); }}>Copy link</button>
                      <button type="button" className="friends-challenge-secondary" onClick={() => { void shareInvite(); }}>Invite Friends</button>
                    </div>
                  ) : null}
                </div>
                <div className="friends-challenge-members-heading">
                  <div><p className="friends-challenge-kicker">THE PEOPLE WALKING WITH YOU</p><h2>Members</h2></div>
                  <span>{challenge.members.length}</span>
                </div>
                <ol className="friends-challenge-members">
                  {challenge.members.map((member, index) => (
                    <li className="friends-challenge-member" key={`${member.display_name}-${member.role}-${index}`}>
                      <span className="friends-challenge-rank">{index + 1}</span>
                      <div className="friends-challenge-member-info">
                        <strong>{member.display_name}</strong>
                        {member.role === "owner" ? <span>Challenge owner</span> : null}
                      </div>
                      <div className="friends-challenge-score">
                        <strong>{member.progress_percent}%</strong>
                        <span>complete</span>
                        <div className="friends-challenge-score-track" aria-hidden="true"><span style={{ width: `${member.progress_percent}%` }} /></div>
                      </div>
                    </li>
                  ))}
                </ol>
                <button className="friends-challenge-leave" type="button" disabled={busy || (challenge.owner && challenge.status === "ended")} onClick={() => { void leaveOrEnd(); }}>
                  {challenge.owner ? challenge.status === "ended" ? "Challenge ended" : "End Challenge" : "Leave Challenge"}
                </button>
                <Link className="friends-challenge-back" to="/challenge">Back to Your Challenges</Link>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function FriendsChallengePage() {
  const { user, displayName } = useAuth();
  const location = useLocation();
  return <FriendsChallengeContent key={`${user?.id || "signed-out"}:${location.pathname}`} displayName={displayName} />;
}

export default FriendsChallengePage;
