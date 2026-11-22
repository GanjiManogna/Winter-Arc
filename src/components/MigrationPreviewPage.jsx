import { useEffect, useState } from "react";
import { PROGRESS_STORAGE_KEY } from "../data/storage.js";
import { createMigrationPreview } from "../data/migration/migrationService.js";
import { useAuth } from "../auth/useAuth.js";
import "./MigrationPreviewPage.css";

function ResultList({ title, items, kind }) {
  return (
    <section className={`migration-preview__list migration-preview__list--${kind}`}>
      <h2>{title} ({items.length})</h2>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.code}-${item.path}-${index}`}>
              <strong>{item.path || item.code}</strong>
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      ) : <p>None</p>}
    </section>
  );
}

export default function MigrationPreviewPage() {
  const { user, loading: authLoading } = useAuth();
  const [result, setResult] = useState(null);
  const [pageError, setPageError] = useState(null);

  useEffect(() => {
    if (authLoading) return undefined;
    let active = true;

    async function runReadOnlyPreview() {
      let rawBefore;
      try {
        rawBefore = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
      } catch {
        if (active) setPageError("Browser localStorage could not be read.");
        return;
      }

      try {
        const preview = await createMigrationPreview();
        const rawAfter = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
        if (active) {
          setResult({
            ...preview,
            sourceUnchanged: rawBefore === rawAfter,
            authenticated: Boolean(user?.id && preview.authenticatedUserId === user.id),
            displayedUserId: user?.id ? `${user.id.slice(0, 8)}…${user.id.slice(-4)}` : null,
          });
        }
      } catch {
        if (active) setPageError("The preview could not finish. No import was attempted.");
      }
    }

    runReadOnlyPreview();
    return () => { active = false; };
  }, [authLoading, user?.id]);

  const errors = result?.validation?.errors || [];
  const warnings = result?.validation?.warnings || [];
  const readyForReview = Boolean(
    result
    && result.sourceUnchanged
    && result.authenticated
    && !result.cloudCheckError
    && result.cloudDataAlreadyExists === false
    && errors.length === 0,
  );

  return (
    <main className="migration-preview">
      <header className="migration-preview__header">
        <p className="migration-preview__eyebrow">DEVELOPER VERIFICATION · PHASE 13C-6A</p>
        <h1>Winter Arc Migration Preview</h1>
        <p className="migration-preview__notice">READ-ONLY — No data will be uploaded.</p>
      </header>

      {authLoading || (!result && !pageError) ? (
        <p role="status">Reading the current browser data…</p>
      ) : null}
      {pageError ? <p className="migration-preview__error" role="alert">{pageError}</p> : null}

      {result ? (
        <>
          <section className={`migration-preview__status ${readyForReview ? "is-ready" : "needs-attention"}`} aria-live="polite">
            <strong>{readyForReview ? "READY FOR REVIEW" : "ATTENTION REQUIRED"}</strong>
            <span>Overall status is based on the local validation, current session, read-only cloud check, and source integrity.</span>
          </section>

          <section className="migration-preview__card">
            <h2>Source and account</h2>
            <dl>
              <dt>Source storage key</dt><dd>{PROGRESS_STORAGE_KEY}</dd>
              <dt>Source present</dt><dd>{result.sourcePresent ? "Yes" : "No"}</dd>
              <dt>Source version</dt><dd>{result.sourceVersion ?? "Unavailable"}</dd>
              <dt>Winter Arc start date</dt><dd>{result.arcStartDate || "Unavailable"}</dd>
              <dt>Authenticated</dt><dd>{result.authenticated ? "Yes" : "No"}</dd>
              <dt>User ID</dt><dd>{result.displayedUserId || "Unavailable"}</dd>
              <dt>Existing cloud program</dt>
              <dd>{result.cloudCheckError ? "Could not verify" : result.cloudDataAlreadyExists === null ? "Unavailable" : result.cloudDataAlreadyExists ? "Yes" : "No"}</dd>
            </dl>
          </section>

          <section className="migration-preview__card">
            <h2>Migration counts</h2>
            <dl>
              <dt>Recorded days</dt><dd>{result.recordedDays}</dd>
              <dt>Daily ritual records</dt><dd>{result.dailyRitualRecords}</dd>
              <dt>Completed boolean records</dt><dd>{result.completedBooleanRituals}</dd>
              <dt>Measurable records</dt><dd>{result.measurableRecords}</dd>
              <dt>Ritual snapshots</dt><dd>{result.ritualSnapshots}</dd>
              <dt>Custom habits</dt><dd>{result.customHabits}</dd>
              <dt>Custom-habit historical records</dt><dd>{result.customHabitHistoricalRecords}</dd>
              <dt>Weekly reflections</dt><dd>{result.weeklyReflections}</dd>
              <dt>Monthly reflections</dt><dd>{result.monthlyReflections}</dd>
            </dl>
          </section>

          <section className="migration-preview__card">
            <h2>Ritual safety checks</h2>
            <dl>
              <dt>Sunscreen days with applicationTimes</dt><dd>{result.sunscreenDaysWithApplicationTimes}</dd>
              <dt>Sunscreen days with timestamps</dt><dd>{result.sunscreenDaysWithTimestamps}</dd>
              <dt>Total sunscreen application timestamps</dt><dd>{result.sunscreenApplicationTimestamps}</dd>
              <dt>Sleep Tracker records</dt><dd>{result.sleepTrackerRecords}</dd>
              <dt>Sleep Tracker stays informational/non-completing</dt>
              <dd>{result.sleepTrackerRecords === result.sleepTrackerNonCompletionRecords ? "Yes" : "No — requires attention"}</dd>
            </dl>
          </section>

          <section className="migration-preview__card">
            <h2>Payload integrity checks</h2>
            <dl>
              <dt>Every destination record matches this authenticated owner</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.everyDestinationRecordHasAuthenticatedOwner ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Deterministic IDs stable on repeat conversion</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.deterministicIdsStable ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Stable row IDs unique within each table</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.stableIdsUniqueWithinEachTable ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Duplicate detection strategy</dt>
              <dd>{result.duplicateDetectionStrategy?.conflictColumn === "id" && result.duplicateDetectionStrategy?.ignoreDuplicates && !result.duplicateDetectionStrategy?.usesImportTimestamps ? "Stable row IDs; no import-time timestamp identity" : "Requires attention"}</dd>
              <dt>Daily dates and records preserved; no additions</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.dailyRecordsAndDatesPreservedWithoutAddingRecords ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Historical ritual snapshots and dates preserved</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.ritualSnapshotsAndDatesPreservedWithoutAddingDates ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Sunscreen timestamps ordered and unchanged</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.sunscreenApplicationTimesRemainOrderedAndUnchanged ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Custom habits and definitions preserved</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.customHabitIdsAndDefinitionsPreserved ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Weekly/monthly reflections preserved without new periods</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.weeklyReflectionsPreservedWithoutAddingPeriods && result.payloadIntegrityChecks.monthlyReflectionsPreservedWithoutAddingPeriods ? "Yes" : "No") : "Unavailable"}</dd>
              <dt>Sleep Tracker stays informational and values are preserved</dt>
              <dd>{result.payloadIntegrityChecks ? (result.payloadIntegrityChecks.sleepTrackerRemainsInformationalAndValuesPreserved ? "Yes" : "No") : "Unavailable"}</dd>
            </dl>
          </section>

          {result.sourceUnchanged ? (
            <p className="migration-preview__safe">Local storage unchanged: Yes</p>
          ) : (
            <p className="migration-preview__error" role="alert">ERROR: {PROGRESS_STORAGE_KEY} changed during preview. Do not continue or import.</p>
          )}
          <p className="migration-preview__safe">Cloud writes performed: 0</p>
          {result.cloudCheckError ? <p className="migration-preview__error">Cloud existence check failed: {result.cloudCheckError.code}</p> : null}

          <ResultList title="Validation warnings" items={warnings} kind="warning" />
          <ResultList title="Validation errors" items={errors} kind="error" />
        </>
      ) : null}
    </main>
  );
}
