import { isSupabaseConfigured, supabase } from "../../lib/supabase.js";

const SAFE_TABLES = new Set([
  "arc_programs",
  "custom_habits",
  "custom_habit_definitions",
  "ritual_snapshots",
  "daily_ritual_entries",
  "weekly_reflections",
  "monthly_reflections",
]);

const SAFE_CONFLICT_TARGETS = {
  arc_programs: "id",
  custom_habits: "id",
  custom_habit_definitions: "id",
  ritual_snapshots: "id",
  daily_ritual_entries: "id",
  weekly_reflections: "id",
  monthly_reflections: "id",
};

export const MIGRATION_DUPLICATE_STRATEGY = Object.freeze({
  conflictColumn: "id",
  ignoreDuplicates: true,
  usesImportTimestamps: false,
});

const MIGRATION_COLUMNS = {
  arc_programs: ["id", "user_id", "start_date", "source_schema_version"],
  custom_habits: ["id", "program_id", "user_id", "source_habit_id", "archived", "display_order", "created_at"],
  custom_habit_definitions: ["id", "custom_habit_id", "program_id", "user_id", "version", "effective_from", "title", "habit_type", "unit", "goal", "icon", "theme", "short_description", "archived", "display_order"],
  ritual_snapshots: ["id", "program_id", "user_id", "snapshot_date", "ritual_id", "custom_habit_id", "position", "definition"],
  daily_ritual_entries: ["id", "program_id", "user_id", "entry_date", "ritual_id", "custom_habit_id", "record_kind", "completed", "value", "completed_at", "sleep_time", "wake_time", "application_times"],
  weekly_reflections: ["id", "program_id", "user_id", "week_start", "wins", "challenges", "focus"],
  monthly_reflections: ["id", "program_id", "user_id", "month", "intention"],
};

function unavailable() {
  return { data: null, error: { code: "CLOUD_UNAVAILABLE" } };
}

async function safeRequest(request) {
  if (!isSupabaseConfigured || !supabase) return unavailable();
  try {
    const { data, error } = await request();
    return error ? { data: null, error: { code: error.code || "CLOUD_REQUEST_FAILED" } } : { data, error: null };
  } catch {
    return { data: null, error: { code: "CLOUD_REQUEST_FAILED" } };
  }
}

export async function getAuthenticatedUserId() {
  const result = await safeRequest(() => supabase.auth.getUser());
  if (result.error) return result;
  return result.data?.user?.id
    ? { data: result.data.user.id, error: null }
    : { data: null, error: { code: "AUTHENTICATION_REQUIRED" } };
}

export async function listAuthenticatedPrograms() {
  return safeRequest(() => supabase
    .from("arc_programs")
    .select("id, start_date, source_schema_version, created_at")
    .order("created_at", { ascending: true }));
}

export async function insertMigrationRows(table, rows) {
  if (!SAFE_TABLES.has(table) || !Array.isArray(rows) || rows.length === 0) {
    return rows?.length === 0
      ? { data: [], error: null }
      : { data: null, error: { code: "INVALID_MIGRATION_WRITE" } };
  }
  return safeRequest(() => supabase
    .from(table)
    .upsert(rows, { onConflict: SAFE_CONFLICT_TARGETS[table], ignoreDuplicates: MIGRATION_DUPLICATE_STRATEGY.ignoreDuplicates })
    .select("id"));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function equalDatabaseValue(column, expected, actual) {
  if (expected === actual) return true;
  if (expected == null || actual == null) return expected === actual;
  if (["value", "goal", "version", "display_order", "position", "source_schema_version"].includes(column)) {
    return Number(expected) === Number(actual);
  }
  if (["created_at", "effective_from", "completed_at"].includes(column)) {
    return Date.parse(expected) === Date.parse(actual);
  }
  return JSON.stringify(canonical(expected)) === JSON.stringify(canonical(actual));
}

export async function verifyMigrationPayload(payload) {
  for (const [table, property] of [
    ["arc_programs", "program"],
    ["custom_habits", "customHabits"],
    ["custom_habit_definitions", "customHabitDefinitions"],
    ["ritual_snapshots", "ritualSnapshots"],
    ["daily_ritual_entries", "dailyRitualEntries"],
    ["weekly_reflections", "weeklyReflections"],
    ["monthly_reflections", "monthlyReflections"],
  ]) {
    const expectedRows = property === "program" ? [payload.program] : payload[property];
    const columns = MIGRATION_COLUMNS[table];
    let query = supabase.from(table).select(columns.join(","));
    if (table === "arc_programs") query = query.eq("id", payload.program.id);
    else query = query.eq("program_id", payload.program.id);
    const result = await safeRequest(() => query);
    if (result.error) return { verified: false, error: result.error };
    const actualRows = result.data || [];
    if (actualRows.length !== expectedRows.length) {
      return {
        verified: false,
        error: {
          code: "MIGRATION_VERIFY_COUNT_MISMATCH", table,
          expectedCount: expectedRows.length, actualCount: actualRows.length,
        },
      };
    }
    const actualById = new Map(actualRows.map((row) => [row.id, row]));
    for (const expected of expectedRows) {
      const actual = actualById.get(expected.id);
      if (!actual) {
        return { verified: false, error: { code: "MIGRATION_VERIFY_CONTENT_MISMATCH", table, mismatch: "expected_record_missing" } };
      }
      const differingColumns = columns.filter((column) => !equalDatabaseValue(column, expected[column], actual[column]));
      if (differingColumns.length) {
        return {
          verified: false,
          error: { code: "MIGRATION_VERIFY_CONTENT_MISMATCH", table, mismatch: "field_mismatch", fields: differingColumns },
        };
      }
    }
    const expectedIds = new Set(expectedRows.map((row) => row.id));
    if (actualRows.some((row) => !expectedIds.has(row.id))) {
      return { verified: false, error: { code: "MIGRATION_VERIFY_CONTENT_MISMATCH", table, mismatch: "unexpected_record" } };
    }
  }
  return { verified: true, error: null };
}
