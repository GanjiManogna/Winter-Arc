import "./AccountDataNotice.css";

function AccountDataNotice({ mode, error, onRetry, surface = "analysis" }) {
  if (mode === "cloud-read-only") {
    if (error) {
      return (
        <div className="account-data-notice account-data-notice--error" role="alert">
          <span>The latest cloud refresh failed. Showing your last confirmed account data.</span>
          <button type="button" onClick={onRetry}>Retry sync</button>
        </div>
      );
    }
    return (
      <div className="account-data-notice" role="status">
        {surface === "today" || surface === "ritual"
          ? "Showing your cloud progress for this account."
          : "Showing your cloud progress for this account."}
      </div>
    );
  }

  if (mode === "local-no-cloud-program") {
    return (
      <div className="account-data-notice" role="status">
        This account has no cloud program yet. Showing this browser's local progress.
      </div>
    );
  }

  if (mode === "local-cloud-error") {
    return (
      <div className="account-data-notice account-data-notice--error" role="alert">
        <span>
          {error?.message || "Cloud progress could not be loaded."} Showing this browser's local progress instead.
        </span>
        <button type="button" onClick={onRetry}>Retry cloud loading</button>
      </div>
    );
  }

  return null;
}

export function AccountDataLoading({ children = "Preparing your Winter Arc…" }) {
  return <p className="account-data-loading" role="status">{children}</p>;
}

export default AccountDataNotice;
