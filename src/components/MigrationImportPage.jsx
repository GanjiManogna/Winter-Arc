import { useEffect, useRef, useState } from "react";
import { PROGRESS_STORAGE_KEY } from "../data/storage.js";
import { createMigrationPreview, importToCloud } from "../data/migration/migrationService.js";
import { useAuth } from "../auth/useAuth.js";
import "./MigrationPreviewPage.css";

const ERROR_MESSAGES = {
  AUTHENTICATION_REQUIRED: "Sign in to the account that should own this data, then reload this page.",
  CLOUD_DATA_ALREADY_EXISTS: "Cloud Winter Arc data already exists. Import stopped to prevent overwrite.",
  LOCAL_DATA_MISSING: "No local Winter Arc data was found in this browser.",
  LOCAL_SOURCE_CHANGED_SINCE_PREVIEW: "Local data changed after this preview. Reload this page and review the updated preview before importing.",
  LOCAL_STORAGE_INTEGRITY_MISMATCH: "Local data changed during the import. The import is marked failed; keep the local copy and stop for review.",
  LOCAL_VALIDATION_FAILED: "Local data did not pass migration validation. No cloud data was written.",
  AUTHENTICATED_ACCOUNT_CHANGED: "The signed-in account changed after preview. Reload and review the destination account before importing.",
  MIGRATION_VERIFY_COUNT_MISMATCH: "Cloud read-back found a different record count. Import is marked failed; stop for review.",
  MIGRATION_VERIFY_CONTENT_MISMATCH: "Cloud read-back found a record that differs from the source. Import is marked failed; stop for review.",
};

function formatError(error) {
  if (!error) return "The import could not be completed. Stop for review.";
  const friendly = ERROR_MESSAGES[error.code] || `Import stopped (${error.code}). Keep your local data and stop for review.`;
  const detail = error.verification;
  if (!detail) return friendly;
  const specifics = [
    detail.table ? `Table: ${detail.table}.` : "",
    Number.isInteger(detail.expectedCount) ? `Expected ${detail.expectedCount} rows; read ${detail.actualCount}.` : "",
    detail.fields?.length ? `Differing fields: ${detail.fields.join(", ")}.` : "",
    detail.mismatch ? `Mismatch: ${detail.mismatch.replaceAll("_", " ")}.` : "",
  ].filter(Boolean).join(" ");
  return `${friendly} ${specifics}`;
}

export default function MigrationImportPage() {
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const previewedRawValue = useRef(null);

  useEffect(() => {
    if (authLoading) return undefined;
    let active = true;
    (async () => {
      try {
        const rawBefore = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
        previewedRawValue.current = rawBefore;
        const result = await createMigrationPreview();
        const rawAfter = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
        if (active) setPreview({
          ...result,
          sourceUnchanged: rawBefore === rawAfter,
          authenticated: Boolean(user?.id && result.authenticatedUserId === user.id),
          displayedUserId: user?.id ? `${user.id.slice(0, 8)}…${user.id.slice(-4)}` : null,
        });
      } catch {
        if (active) setPreviewError("The read-only preview failed. No import was attempted.");
      }
    })();
    return () => { active = false; };
  }, [authLoading, user?.id]);

  const ready = Boolean(
    preview?.sourcePresent && preview.sourceUnchanged && preview.authenticated
    && preview.cloudDataAlreadyExists === false && !preview.cloudCheckError
    && preview.validation?.errors?.length === 0,
  );

  async function handleImport() {
    if (!ready || !confirmed || running) return;
    setRunning(true);
    setOutcome(null);
    try {
      const result = await importToCloud({
        expectedUserId: preview.authenticatedUserId,
        expectedRawValue: previewedRawValue.current,
      });
      setOutcome(result);
    } catch {
      setOutcome({ state: "failed", error: { code: "MIGRATION_IMPORT_FAILED" } });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="migration-preview">
      <header className="migration-preview__header">
        <p className="migration-preview__eyebrow">DEVELOPER MIGRATION TOOLING · PHASE 13C-6B</p>
        <h1>IMPORT EXISTING WINTER ARC DATA</h1>
        <p className="migration-preview__notice">This will copy your existing local Winter Arc data to your authenticated cloud account. Your local data will be kept.</p>
      </header>

      {authLoading || (!preview && !previewError) ? <p role="status">Checking local data and account…</p> : null}
      {previewError ? <p className="migration-preview__error" role="alert">{previewError}</p> : null}
      {preview ? (
        <>
          <section className={`migration-preview__status ${ready ? "is-ready" : "needs-attention"}`}>
            <strong>{ready ? "PRECONDITIONS PASSED — REVIEW BEFORE IMPORT" : "IMPORT UNAVAILABLE — PRECONDITIONS NOT MET"}</strong>
            <span>Preview is read-only. No cloud writes have been made.</span>
          </section>
          <section className="migration-preview__card">
            <h2>Source and destination</h2>
            <dl>
              <dt>Source</dt><dd>{PROGRESS_STORAGE_KEY} · {preview.sourcePresent ? "present" : "missing"}</dd>
              <dt>Source unchanged during preview</dt><dd>{preview.sourceUnchanged ? "Yes" : "No"}</dd>
              <dt>Authenticated account</dt><dd>{preview.authenticated ? preview.displayedUserId : "Unavailable or mismatched"}</dd>
              <dt>Existing cloud program</dt><dd>{preview.cloudCheckError ? "Could not verify" : preview.cloudDataAlreadyExists === false ? "None" : preview.cloudDataAlreadyExists ? "Already exists" : "Unavailable"}</dd>
              <dt>Winter Arc start date</dt><dd>{preview.arcStartDate || "Unavailable"}</dd>
            </dl>
          </section>
          <section className="migration-preview__card">
            <h2>Data to be copied</h2>
            <dl>
              <dt>Recorded days</dt><dd>{preview.recordedDays}</dd>
              <dt>Daily ritual entries</dt><dd>{preview.dailyRitualRecords}</dd>
              <dt>Historical ritual snapshots</dt><dd>{preview.ritualSnapshots}</dd>
              <dt>Custom habits</dt><dd>{preview.customHabits}</dd>
              <dt>Custom-habit historical records</dt><dd>{preview.customHabitHistoricalRecords}</dd>
              <dt>Weekly reflections</dt><dd>{preview.weeklyReflections}</dd>
              <dt>Monthly reflections</dt><dd>{preview.monthlyReflections}</dd>
              <dt>Sunscreen application timestamps</dt><dd>{preview.sunscreenApplicationTimestamps}</dd>
              <dt>Sleep Tracker entries (informational)</dt><dd>{preview.sleepTrackerRecords}</dd>
            </dl>
          </section>
          {preview.validation?.warnings?.length ? (
            <section className="migration-preview__list migration-preview__list--warning">
              <h2>Warnings ({preview.validation.warnings.length})</h2>
              <ul>{preview.validation.warnings.map((warning, i) => <li key={`${warning.code}-${i}`}><strong>{warning.path || warning.code}</strong><span>{warning.message}</span></li>)}</ul>
            </section>
          ) : null}
          {preview.validation?.errors?.length ? (
            <section className="migration-preview__list migration-preview__list--error">
              <h2>Validation errors ({preview.validation.errors.length})</h2>
              <ul>{preview.validation.errors.map((error, i) => <li key={`${error.code}-${i}`}><strong>{error.path || error.code}</strong><span>{error.message}</span></li>)}</ul>
            </section>
          ) : null}
          <label className="migration-preview__confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!ready || running || outcome?.state === "verified"} />
            <span>I reviewed this preview and explicitly confirm copying this local data to the authenticated cloud account.</span>
          </label>
          <button className="migration-preview__button" type="button" onClick={handleImport} disabled={!ready || !confirmed || running || Boolean(outcome)}>
            {running ? "Importing and verifying…" : "Confirm and import existing Winter Arc data"}
          </button>
        </>
      ) : null}
      {outcome ? (
        <section className={`migration-preview__status ${outcome.state === "verified" ? "is-ready" : "needs-attention"}`} aria-live="polite">
          <strong>{outcome.state === "verified" ? "VERIFIED" : `IMPORT ${outcome.state.toUpperCase()}`}</strong>
          {outcome.error ? <span role="alert">{formatError(outcome.error)}</span> : null}
          {outcome.state !== "verified" ? <span>For review, this button is locked after an attempt. Reload only after reviewing the reported result; the importer will recheck existing cloud rows before any retry.</span> : null}
          {outcome.state === "verified" ? <>
            <span>Cloud read-back verification: {outcome.readbackVerified ? "passed" : "not available"}.</span>
            <span>Original localStorage unchanged: {outcome.localStorageUnchanged ? "Yes" : "No"}.</span>
          </> : null}
          {Object.keys(outcome.recordsWrittenByTable || {}).length ? (
            <ul>{Object.entries(outcome.recordsWrittenByTable).map(([table, count]) => <li key={table}>{table}: {count} newly written</li>)}</ul>
          ) : null}
          {outcome.verification ? <span>Verification detail: {outcome.verification.code}{outcome.verification.table ? ` · ${outcome.verification.table}` : ""}</span> : null}
        </section>
      ) : null}
    </main>
  );
}
