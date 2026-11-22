import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { signIn, signUp } from "../auth/authService";
import { useAuth } from "../auth/useAuth";
import { ARC_DURATION_DAYS } from "../data/storage.js";
import "./AuthPage.css";

function AuthPage({ mode = "login" }) {
  const isSignup = mode === "signup";
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");

    const result = isSignup
      ? await signUp({ email: email.trim(), password, displayName: name.trim() })
      : await signIn({ email: email.trim(), password });

    setSubmitting(false);

    if (result.error) {
      setErrorMessage(result.error.message);
      return;
    }

    if (result.data?.session) {
      navigate("/", { replace: true });
      return;
    }

    if (isSignup && result.data?.confirmationRequired) {
      setSuccessMessage("Account created. Please check your email to confirm your account.");
      return;
    }

    if (isSignup) {
      setSuccessMessage("If an account was created, check your email for next steps.");
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-atmosphere" aria-hidden="true">
        <span className="auth-orbit auth-orbit-one" />
        <span className="auth-orbit auth-orbit-two" />
        <span className="auth-sun" />
        <span className="auth-star auth-star-one">✦</span>
        <span className="auth-star auth-star-two">✧</span>
        <span className="auth-star auth-star-three">·</span>
        <span className="auth-star auth-star-four">✦</span>
      </div>

      <section className="auth-card" aria-labelledby="auth-title" aria-busy={authLoading || submitting}>
        <aside className="auth-story">
          <Link className="auth-brand" to="/" aria-label="Winter Arc home">
            <span className="auth-brand-mark">✦</span>
            <span>WINTER ARC</span>
          </Link>
          <div className="auth-story-copy">
            <p className="auth-kicker">A SEASON OF SMALL PROMISES</p>
            <p className="auth-story-line">One quiet choice can change the shape of a day.</p>
            <span className="auth-story-rule" />
            <p className="auth-story-caption">PEACE · DISCIPLINE · PURPOSE</p>
          </div>
          <span className="auth-story-orb" aria-hidden="true">✧</span>
        </aside>

        <div className="auth-form-panel">
          <div className="auth-form-content">
            <p className="auth-kicker auth-form-kicker">
              {isSignup ? `BEGIN YOUR ${ARC_DURATION_DAYS} DAYS` : "YOUR JOURNEY CONTINUES"}
            </p>
            <h1 id="auth-title" className="auth-title">
              {isSignup ? "Create your Winter Arc" : "Welcome back."}
            </h1>
            <p className="auth-description">
              {isSignup
                ? "Make room for the person you are becoming."
                : "Return to the small promises that bring you closer to yourself."}
            </p>

            <form className="auth-form" onSubmit={handleSubmit}>
              {isSignup && (
                <label className="auth-field">
                  <span>Name</span>
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    required
                    disabled={submitting || authLoading}
                  />
                </label>
              )}

              <label className="auth-field">
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={submitting || authLoading}
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={submitting || authLoading}
                />
              </label>

              {errorMessage && (
                <p className="auth-feedback auth-error" role="alert">
                  {errorMessage}
                </p>
              )}

              {successMessage && (
                <p className="auth-feedback auth-success" role="status">
                  {successMessage}
                </p>
              )}

              <button className="auth-submit" type="submit" disabled={submitting || authLoading}>
                {authLoading
                  ? "Checking your session…"
                  : submitting
                    ? (isSignup ? "Creating account…" : "Logging in…")
                    : (isSignup ? "Create account" : "Log in")}
                {!submitting && !authLoading && <span aria-hidden="true">↗</span>}
              </button>
            </form>

            <p className="auth-switch">
              {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
              <Link to={isSignup ? "/login" : "/signup"}>
                {isSignup ? "Log in" : "Create one"}
              </Link>
            </p>

            {successMessage && isSignup && (
              <p className="auth-return-link">
                <Link to="/login">Return to log in</Link>
              </p>
            )}
          </div>
        </div>
      </section>

      <p className="auth-page-footer">Guided by something greater · built one day at a time</p>
    </main>
  );
}

export default AuthPage;
