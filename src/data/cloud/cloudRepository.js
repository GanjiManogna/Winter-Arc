import { isSupabaseConfigured, supabase } from "../../lib/supabase.js";
import { repositoryResult } from "../repositories/repositoryContract.js";
import { reconstructCloudProgress } from "./reconstructCloudProgress.js";

const CLOUD_UNAVAILABLE = { code: "CLOUD_UNAVAILABLE", message: "Cloud data is not configured." };
const CLOUD_REQUEST_FAILED = { code: "CLOUD_REQUEST_FAILED", message: "The cloud data request could not be completed." };
const AUTH_REQUIRED = { code: "AUTHENTICATION_REQUIRED", message: "Sign in to access cloud data." };
const PROGRAM_REQUIRED = { code: "PROGRAM_NOT_FOUND", message: "No Winter Arc program exists for this account." };
const CLOUD_CONFLICT = { code: "CLOUD_CONFLICT", message: "A newer cloud value exists. The latest value has been loaded; review it before making another change." };

export const CLOUD_CLIENT_KEY_ENV = "VITE_SUPABASE_ANON_KEY";

function publicFailure(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (
    error?.status === 401
    || ["authsessionmissingerror", "authinvalidjwterror", "invalid_jwt", "pgrst301"].includes(code)
    || /jwt (has )?expired|session (is )?missing/.test(message)
  ) {
    return { code: "AUTHENTICATION_REQUIRED", message: AUTH_REQUIRED.message };
  }
  if (
    error instanceof TypeError
    || ["networkerror", "fetcherror"].includes(code)
    || /network|fetch failed|failed to fetch|load failed|connection/i.test(message)
  ) {
    return { code: "CLOUD_NETWORK_ERROR", message: "The cloud service is temporarily unreachable." };
  }
  return { code: error?.code || CLOUD_REQUEST_FAILED.code, message: CLOUD_REQUEST_FAILED.message };
}

function mapDailyRow(row) {
  return {
    date: row.entry_date,
    ritualId: row.ritual_id,
    completed: row.completed,
    value: row.value,
    completedAt: row.completed_at,
    ...(row.sleep_time != null ? { sleepTime: row.sleep_time } : {}),
    ...(row.wake_time != null ? { wakeTime: row.wake_time } : {}),
    applicationTimes: row.application_times || [],
    revision: Number(row.revision) || 1,
  };
}

function mapHabit(habit, definition) {
  return {
    id: habit.source_habit_id,
    title: definition?.title || "",
    type: definition?.habit_type || "boolean",
    unit: definition?.unit ?? null,
    goal: definition?.goal ?? null,
    icon: definition?.icon || "✦",
    theme: definition?.theme || "clarity",
    shortDescription: definition?.short_description || "",
    createdAt: habit.created_at,
    archived: habit.archived,
    order: habit.display_order,
    revision: Number(habit.revision) || 1,
    definitionRevision: Number(definition?.revision) || 1,
  };
}

function databaseMonth(monthKey) {
  return /^\d{4}-\d{2}$/.test(monthKey) ? `${monthKey}-01` : monthKey;
}

function applicationMonth(monthDate) {
  return typeof monthDate === "string" ? monthDate.slice(0, 7) : monthDate;
}

/** Create an authenticated-client repository. RLS remains the ownership boundary. */
export function createCloudRepository({ client = supabase, configured = isSupabaseConfigured } = {}) {
  async function request(operation) {
    if (!client || (!configured && client === supabase)) return repositoryResult(null, CLOUD_UNAVAILABLE);
    try {
      const { data, error } = await operation();
      return error ? repositoryResult(null, publicFailure(error)) : repositoryResult(data, null);
    } catch (error) {
      return repositoryResult(null, publicFailure(error));
    }
  }

  async function context(expectedOwner = null) {
    const auth = await request(() => client.auth.getUser());
    if (auth.error) return auth;
    const userId = auth.data?.user?.id;
    if (!userId) return repositoryResult(null, AUTH_REQUIRED);
    if (expectedOwner?.userId && expectedOwner.userId !== userId) {
      return repositoryResult(null, { code: "AUTHENTICATION_CHANGED", message: "The active account changed." });
    }
    const programs = await request(() => {
      let query = client
        .from("arc_programs")
        .select("id, user_id, start_date, source_schema_version, created_at, updated_at, revision")
        .eq("user_id", userId);
      if (expectedOwner?.programId) query = query.eq("id", expectedOwner.programId);
      return query.order("created_at", { ascending: true });
    });
    if (programs.error) return programs;
    const program = programs.data?.[0];
    if (!program) return repositoryResult(null, PROGRAM_REQUIRED);
    if (expectedOwner?.programId && program.id !== expectedOwner.programId) {
      return repositoryResult(null, { code: "PROGRAM_NOT_FOUND", message: PROGRAM_REQUIRED.message });
    }
    return repositoryResult({ userId, program }, null);
  }

  async function readProgramRows(table, columns, extra = null, expectedOwner = null) {
    const owner = await context(expectedOwner);
    if (owner.error) return owner;
    const result = await request(() => {
      let query = client.from(table).select(columns)
        .eq("program_id", owner.data.program.id)
        .eq("user_id", owner.data.userId);
      if (extra) query = extra(query);
      return query;
    });
    return result.error ? result : repositoryResult({ owner: owner.data, rows: result.data || [] });
  }

  async function compareAndSwap(table, identity, payload, expectedRevision, columns) {
    const result = Number.isInteger(expectedRevision) && expectedRevision > 0
      ? await request(() => {
        let query = client.from(table).update({ ...payload, revision: expectedRevision + 1 });
        for (const [column, value] of Object.entries(identity)) query = query.eq(column, value);
        return query.eq("revision", expectedRevision).select(columns).maybeSingle();
      })
      : await request(() => client.from(table).insert({ ...payload, revision: 1 }).select(columns).single());
    if (result.error?.code === "23505" || (!result.error && !result.data)) {
      return repositoryResult(null, CLOUD_CONFLICT);
    }
    return result;
  }

  async function findCustomHabit(customHabitId, owner) {
    return request(() => client.from("custom_habits")
      .select("id, source_habit_id, archived, display_order, created_at, revision")
      .eq("program_id", owner.program.id)
      .eq("user_id", owner.userId)
      .eq("source_habit_id", customHabitId)
      .maybeSingle());
  }

  const repository = {
    async loadProgress() {
      const owner = await context();
      if (owner.error) return owner;
      const programId = owner.data.program.id;
      const userId = owner.data.userId;
      const specifications = [
        ["daily_ritual_entries", "program_id, user_id, entry_date, ritual_id, record_kind, completed, value, completed_at, sleep_time, wake_time, application_times, revision"],
        ["ritual_snapshots", "program_id, user_id, snapshot_date, ritual_id, position, definition, revision"],
        ["custom_habits", "program_id, user_id, id, source_habit_id, archived, display_order, created_at, revision"],
        ["custom_habit_definitions", "program_id, user_id, custom_habit_id, version, effective_from, title, habit_type, unit, goal, icon, theme, short_description, archived, display_order, revision"],
        ["weekly_reflections", "program_id, user_id, week_start, wins, challenges, focus, revision"],
        ["monthly_reflections", "program_id, user_id, month, intention, revision"],
      ];
      const results = await Promise.all(specifications.map(([table, columns]) => request(() => client
        .from(table)
        .select(columns)
        .eq("program_id", programId)
        .eq("user_id", userId))));
      const failed = results.find((result) => result.error);
      if (failed) return failed;
      const [dailyEntries, ritualSnapshots, customHabits, customHabitDefinitions, weeklyReflections, monthlyReflections] = results.map((result) => result.data || []);
      return reconstructCloudProgress({
        program: owner.data.program,
        dailyEntries,
        ritualSnapshots,
        customHabits,
        customHabitDefinitions,
        weeklyReflections,
        monthlyReflections,
      });
    },

    async getProgramMetadata() {
      const result = await context();
      if (result.error) return result;
      const { id, user_id: userId, start_date: startDate, source_schema_version: sourceSchemaVersion } = result.data.program;
      return repositoryResult({ id, userId, startDate, sourceSchemaVersion }, null);
    },

    async readDailyEntries(dateISO = null, expectedOwner = null) {
      const result = await readProgramRows(
        "daily_ritual_entries",
        "id, program_id, user_id, entry_date, ritual_id, custom_habit_id, record_kind, completed, value, completed_at, sleep_time, wake_time, application_times, revision",
        dateISO ? (query) => query.eq("entry_date", dateISO) : (query) => query.order("entry_date", { ascending: true }),
        expectedOwner,
      );
      return result.error ? result : repositoryResult(result.data.rows.map(mapDailyRow), null);
    },

    async writeDailyEntry(dateISO, ritualId, entry, expectedOwner = null, expectedRevision = entry?.revision ?? null) {
      const owner = await context(expectedOwner);
      if (owner.error) return owner;
      let customHabitId = null;
      if (entry.customHabitId) {
        if (entry.customHabitId !== ritualId) {
          return repositoryResult(null, { code: "CUSTOM_HABIT_NOT_FOUND", message: "The custom habit could not be verified." });
        }
        const habit = await findCustomHabit(entry.customHabitId, owner.data);
        if (habit.error) return habit;
        if (!habit.data) {
          return repositoryResult(null, { code: "CUSTOM_HABIT_NOT_FOUND", message: "The custom habit could not be verified." });
        }
        customHabitId = habit.data.id;
      }
      const recordKind = entry.recordKind
        || (ritualId === "sleep-tracker" ? "informational" : entry.value != null ? "measurable" : "boolean");
      const payload = {
        program_id: owner.data.program.id,
        user_id: owner.data.userId,
        entry_date: dateISO,
        ritual_id: ritualId,
        custom_habit_id: customHabitId,
        record_kind: recordKind,
        completed: recordKind === "informational" ? false : Boolean(entry.completed),
        value: entry.value ?? null,
        completed_at: recordKind === "informational" ? null : entry.completedAt ?? null,
        sleep_time: entry.sleepTime ?? null,
        wake_time: entry.wakeTime ?? null,
        application_times: entry.applicationTimes || [],
      };
      const result = await compareAndSwap("daily_ritual_entries", {
        program_id: owner.data.program.id, user_id: owner.data.userId, entry_date: dateISO, ritual_id: ritualId,
      }, payload, expectedRevision, "entry_date, ritual_id, custom_habit_id, record_kind, completed, value, completed_at, sleep_time, wake_time, application_times, revision");
      return result.error ? result : repositoryResult(mapDailyRow(result.data), null);
    },

    async readRitualSnapshots(dateISO = null) {
      const result = await readProgramRows(
        "ritual_snapshots",
        "snapshot_date, ritual_id, position, definition",
        dateISO
          ? (query) => query.eq("snapshot_date", dateISO).order("position", { ascending: true })
          : (query) => query.order("snapshot_date", { ascending: true }).order("position", { ascending: true }),
      );
      return result.error ? result : repositoryResult(result.data.rows.map((row) => ({
        date: row.snapshot_date, ritualId: row.ritual_id, position: row.position, definition: row.definition,
      })), null);
    },

    async readCustomHabits() {
      const habits = await readProgramRows("custom_habits", "id, source_habit_id, archived, display_order, created_at, revision", (query) => query.order("display_order", { ascending: true }));
      if (habits.error) return habits;
      if (!habits.data.rows.length) return repositoryResult([], null);
      const definitions = await request(() => client.from("custom_habit_definitions")
        .select("custom_habit_id, version, title, habit_type, unit, goal, icon, theme, short_description, revision")
        .eq("program_id", habits.data.owner.program.id)
        .eq("user_id", habits.data.owner.userId)
        .in("custom_habit_id", habits.data.rows.map((habit) => habit.id))
        .order("version", { ascending: false }));
      if (definitions.error) return definitions;
      const latest = new Map();
      for (const definition of definitions.data || []) {
        if (!latest.has(definition.custom_habit_id)) latest.set(definition.custom_habit_id, definition);
      }
      return repositoryResult(habits.data.rows.map((habit) => mapHabit(habit, latest.get(habit.id))), null);
    },

    async writeCustomHabit(habit, expectedOwner = null) {
      const owner = await context(expectedOwner);
      if (owner.error) return owner;
      const existing = await findCustomHabit(habit.id, owner.data);
      if (existing.error) return existing;
      const id = globalThis.crypto?.randomUUID?.();
      const cloudId = existing.data?.id || habit.cloudId || id;
      if (!cloudId) return repositoryResult(null, { code: "UUID_UNAVAILABLE", message: CLOUD_REQUEST_FAILED.message });
      if (existing.data) {
        const sameCreate = Boolean(existing.data.archived) === Boolean(habit.archived)
          && Number(existing.data.display_order) === (Number.isFinite(habit.order) ? habit.order : 0)
          && new Date(existing.data.created_at).toISOString() === new Date(habit.createdAt).toISOString();
        if (!sameCreate) return repositoryResult(null, CLOUD_CONFLICT);
        return repositoryResult({ ...habit, id: existing.data.source_habit_id, cloudId: existing.data.id,
          createdAt: existing.data.created_at, archived: existing.data.archived, order: existing.data.display_order,
          revision: Number(existing.data.revision) || 1 }, null);
      }
      const result = await request(() => client.from("custom_habits").insert({
        id: cloudId,
        program_id: owner.data.program.id,
        user_id: owner.data.userId,
        source_habit_id: habit.id,
        archived: Boolean(habit.archived),
        display_order: Number.isFinite(habit.order) ? habit.order : 0,
        ...(habit.createdAt ? { created_at: habit.createdAt } : {}),
        revision: 1,
      }).select("id, source_habit_id, archived, display_order, created_at, revision")
        .single());
      if (result.error?.code === "23505") return repositoryResult(null, CLOUD_CONFLICT);
      if (result.error) return result;
      return repositoryResult({
        ...habit,
        cloudId: result.data.id,
        id: result.data.source_habit_id,
        createdAt: result.data.created_at,
        archived: result.data.archived,
        order: result.data.display_order,
        revision: Number(result.data.revision) || 1,
      }, null);
    },

    async archiveCustomHabit(habit, expectedOwner = null) {
      const owner = await context(expectedOwner);
      if (owner.error) return owner;
      if (!habit?.id || !Number.isInteger(Number(habit.revision)) || Number(habit.revision) < 1) {
        return repositoryResult(null, { code: "CLOUD_DATA_INVALID", message: "Refresh the habit before archiving it." });
      }
      const existing = await findCustomHabit(habit.id, owner.data);
      if (existing.error) return existing;
      if (!existing.data) {
        return repositoryResult(null, { code: "CUSTOM_HABIT_NOT_FOUND", message: "The custom habit could not be found." });
      }
      if (existing.data.archived) {
        return repositoryResult({ ...habit, archived: true, revision: Number(existing.data.revision) || 1 }, null);
      }
      if (Number(existing.data.revision) !== Number(habit.revision)) {
        return repositoryResult(null, CLOUD_CONFLICT);
      }
      const updated = await request(() => client.from("custom_habits")
        .update({ archived: true, revision: Number(habit.revision) + 1 })
        .eq("id", existing.data.id)
        .eq("program_id", owner.data.program.id)
        .eq("user_id", owner.data.userId)
        .eq("revision", Number(habit.revision))
        .select("id, source_habit_id, archived, display_order, created_at, revision")
        .maybeSingle());
      if (updated.error) return updated;
      if (!updated.data) return repositoryResult(null, CLOUD_CONFLICT);
      return repositoryResult({
        ...habit,
        id: updated.data.source_habit_id,
        cloudId: updated.data.id,
        archived: updated.data.archived,
        order: updated.data.display_order,
        createdAt: updated.data.created_at,
        revision: Number(updated.data.revision) || Number(habit.revision) + 1,
      }, null);
    },

    async readCustomHabitDefinitions(customHabitId = null) {
      const owner = await context();
      if (owner.error) return owner;
      const habit = customHabitId ? await findCustomHabit(customHabitId, owner.data) : null;
      if (habit?.error) return habit;
      if (customHabitId && !habit.data) return repositoryResult([], null);
      const habits = await request(() => client.from("custom_habits")
        .select("id, source_habit_id")
        .eq("program_id", owner.data.program.id)
        .eq("user_id", owner.data.userId));
      if (habits.error) return habits;
      const sourceIds = new Map((habits.data || []).map((row) => [row.id, row.source_habit_id]));
      const result = await request(() => {
        let query = client.from("custom_habit_definitions")
        .select("id, custom_habit_id, version, effective_from, title, habit_type, unit, goal, icon, theme, short_description, archived, display_order, revision")
          .eq("program_id", owner.data.program.id)
          .eq("user_id", owner.data.userId)
          .order("effective_from", { ascending: true });
        if (habit) query = query.eq("custom_habit_id", habit.data.id);
        return query;
      });
      if (result.error) return result;
      return repositoryResult((result.data || []).map((row) => ({
        id: row.id,
        customHabitId: sourceIds.get(row.custom_habit_id) || customHabitId,
        version: row.version,
        effectiveFrom: row.effective_from,
        definition: {
          title: row.title, type: row.habit_type, unit: row.unit, goal: row.goal,
          icon: row.icon, theme: row.theme, shortDescription: row.short_description,
          archived: row.archived, order: row.display_order,
          revision: Number(row.revision) || 1,
        },
      })), null);
    },

    async writeCustomHabitDefinition(customHabitId, definition, expectedOwner = null, expectedRevision = null) {
      const owner = await context(expectedOwner);
      if (owner.error) return owner;
      const habit = await findCustomHabit(customHabitId, owner.data);
      if (habit.error) return habit;
      if (!habit.data) return repositoryResult(null, { code: "CUSTOM_HABIT_NOT_FOUND", message: "The custom habit does not exist." });
      const versions = await request(() => client.from("custom_habit_definitions")
        .select("id, version, effective_from, title, habit_type, unit, goal, icon, theme, short_description, archived, display_order, revision")
        .eq("custom_habit_id", habit.data.id)
        .eq("program_id", owner.data.program.id)
        .eq("user_id", owner.data.userId)
        .order("version", { ascending: false })
        .limit(1));
      if (versions.error) return versions;
      const latest = versions.data?.[0] || null;
      const version = Number.isInteger(definition.version) && definition.version > 0
        ? definition.version
        : (latest?.version || 0) + 1;
      const id = definition.id || globalThis.crypto?.randomUUID?.();
      if (!id) return repositoryResult(null, { code: "UUID_UNAVAILABLE", message: CLOUD_REQUEST_FAILED.message });
      const measurable = definition.type === "measurable" || definition.habit_type === "measurable";
      const row = {
        id,
        custom_habit_id: habit.data.id,
        program_id: owner.data.program.id,
        user_id: owner.data.userId,
        version,
        effective_from: definition.effectiveFrom || definition.createdAt || new Date().toISOString(),
        title: definition.title,
        habit_type: measurable ? "measurable" : "boolean",
        unit: measurable ? (definition.unit || null) : null,
        goal: measurable ? (definition.goal ?? null) : null,
        icon: definition.icon || "✦",
        theme: definition.theme || "clarity",
        short_description: definition.shortDescription || definition.short_description || "",
        archived: Boolean(definition.archived),
        display_order: Number.isFinite(definition.order) ? definition.order : (definition.display_order || 0),
        revision: 1,
      };
      const existing = await request(() => client.from("custom_habit_definitions").select("id, custom_habit_id, version, effective_from, title, habit_type, unit, goal, icon, theme, short_description, archived, display_order, revision")
        .eq("id", id).eq("program_id", owner.data.program.id).eq("user_id", owner.data.userId).maybeSingle());
      if (existing.error) return existing;
      if (existing.data) {
        const sameDefinition = Object.entries(row).every(([key, value]) => (
          key === "revision" || String(existing.data[key]) === String(value)
        ));
        if (!sameDefinition) return repositoryResult(null, CLOUD_CONFLICT);
        return repositoryResult({
          id: existing.data.id, version: existing.data.version, effectiveFrom: existing.data.effective_from,
          title: existing.data.title, type: existing.data.habit_type, unit: existing.data.unit, goal: existing.data.goal,
          icon: existing.data.icon, theme: existing.data.theme, shortDescription: existing.data.short_description,
          archived: existing.data.archived, order: existing.data.display_order, revision: Number(existing.data.revision) || 1,
        }, null);
      }
      if (latest
        ? (!Number.isInteger(expectedRevision) || Number(latest.revision) !== expectedRevision || version !== Number(latest.version) + 1)
        : version !== 1) return repositoryResult(null, CLOUD_CONFLICT);
      const result = await request(() => client.from("custom_habit_definitions").insert(row)
        .select("id, version, effective_from, title, habit_type, unit, goal, icon, theme, short_description, archived, display_order, revision")
        .single());
      if (result.error?.code === "23505") return repositoryResult(null, CLOUD_CONFLICT);
      if (result.error) return result;
      return repositoryResult({
        id: result.data.id,
        version: result.data.version,
        effectiveFrom: result.data.effective_from,
        title: result.data.title,
        type: result.data.habit_type,
        unit: result.data.unit,
        goal: result.data.goal,
        icon: result.data.icon,
        theme: result.data.theme,
        shortDescription: result.data.short_description,
        archived: result.data.archived,
        order: result.data.display_order,
        revision: Number(result.data.revision) || 1,
      }, null);
    },

    async writeRitualSnapshots(dateISO, definitions, expectedOwner = null) {
      const owner = await context(expectedOwner);
      if (owner.error) return owner;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !Array.isArray(definitions) || definitions.length === 0) {
        return repositoryResult(null, { code: "CLOUD_DATA_INVALID", message: "The daily ritual snapshot is incomplete." });
      }
      const current = await readProgramRows(
        "ritual_snapshots", "snapshot_date, ritual_id, position, definition, revision",
        (query) => query.eq("snapshot_date", dateISO).order("position", { ascending: true }), expectedOwner,
      );
      if (current.error) return current;
      const existingById = new Map(current.data.rows.map((row) => [row.ritual_id, row]));
      const expectedById = new Map(definitions.map((definition, position) => [definition?.id, { definition, position }]));
      if (expectedById.size !== definitions.length || expectedById.has(undefined)) {
        return repositoryResult(null, { code: "CLOUD_DATA_INVALID", message: "The daily ritual snapshot contains an invalid definition." });
      }
      for (const row of current.data.rows) {
        const expected = expectedById.get(row.ritual_id);
        if (!expected || Number(row.position) !== expected.position || JSON.stringify(row.definition) !== JSON.stringify(expected.definition)) {
          return repositoryResult(null, CLOUD_CONFLICT);
        }
      }
      const rows = [];
      for (const [position, definition] of definitions.entries()) {
        if (existingById.has(definition.id)) continue;
        let customHabitId = null;
        if (definition.source === "custom") {
          const habit = await findCustomHabit(definition.id, owner.data);
          if (habit.error) return habit;
          if (!habit.data) {
            return repositoryResult(null, { code: "CUSTOM_HABIT_NOT_FOUND", message: "The custom habit could not be verified." });
          }
          customHabitId = habit.data.id;
        }
        rows.push({
          program_id: owner.data.program.id,
          user_id: owner.data.userId,
          snapshot_date: dateISO,
          ritual_id: definition.id,
          custom_habit_id: customHabitId,
          position,
          definition,
          revision: 1,
        });
      }
      if (rows.length === 0) {
        return repositoryResult(current.data.rows.map((row) => ({
          date: row.snapshot_date, ritualId: row.ritual_id, position: row.position, definition: row.definition,
        })), null);
      }
      const result = await request(() => client.from("ritual_snapshots").insert(rows)
        .select("snapshot_date, ritual_id, position, definition").order("position", { ascending: true }));
      if (result.error?.code === "23505") return repositoryResult(null, CLOUD_CONFLICT);
      if (result.error) return result;
      const combined = [...current.data.rows, ...(result.data || [])].sort((a, b) => Number(a.position) - Number(b.position));
      return repositoryResult(combined.map((row) => ({
        date: row.snapshot_date,
        ritualId: row.ritual_id,
        position: row.position,
        definition: row.definition,
      })), null);
    },

    async readWeeklyReflections(weekStart = null) {
      const result = await readProgramRows(
        "weekly_reflections", "week_start, wins, challenges, focus, revision",
        weekStart ? (query) => query.eq("week_start", weekStart) : (query) => query.order("week_start", { ascending: true }),
      );
      return result.error ? result : repositoryResult(result.data.rows.map((row) => ({
        weekStart: row.week_start, wins: row.wins, challenges: row.challenges, focus: row.focus, revision: Number(row.revision) || 1,
      })), null);
    },

    async writeWeeklyReflection(weekStart, reflection, expectedOwner = null, expectedRevision = null) {
      const owner = await context(expectedOwner);
      if (owner.error) return owner;
      const payload = {
        program_id: owner.data.program.id, user_id: owner.data.userId,
        week_start: weekStart,
        wins: reflection.wins ?? "", challenges: reflection.challenges ?? "", focus: reflection.focus ?? "",
      };
      const result = await compareAndSwap("weekly_reflections", {
        program_id: owner.data.program.id, user_id: owner.data.userId, week_start: weekStart,
      }, payload, expectedRevision, "week_start, wins, challenges, focus, revision");
      return result.error ? result : repositoryResult({
        weekStart: result.data.week_start, wins: result.data.wins, challenges: result.data.challenges, focus: result.data.focus,
        revision: Number(result.data.revision) || 1,
      }, null);
    },

    async readMonthlyReflections(month = null) {
      const result = await readProgramRows(
        "monthly_reflections", "month, intention, revision",
        month ? (query) => query.eq("month", databaseMonth(month)) : (query) => query.order("month", { ascending: true }),
      );
      return result.error ? result : repositoryResult(result.data.rows.map((row) => ({ month: applicationMonth(row.month), intention: row.intention, revision: Number(row.revision) || 1 })), null);
    },

    async writeMonthlyReflection(month, reflection, expectedOwner = null, expectedRevision = null) {
      const owner = await context(expectedOwner);
      if (owner.error) return owner;
      const payload = {
        program_id: owner.data.program.id,
        user_id: owner.data.userId,
        month: databaseMonth(month),
        intention: reflection.intention ?? "",
      };
      const result = await compareAndSwap("monthly_reflections", {
        program_id: owner.data.program.id, user_id: owner.data.userId, month: payload.month,
      }, payload, expectedRevision, "month, intention, revision");
      return result.error ? result : repositoryResult({
        month: applicationMonth(result.data.month), intention: result.data.intention,
        revision: Number(result.data.revision) || 1,
      }, null);
    },
  };

  return Object.freeze(repository);
}

const cloudRepository = createCloudRepository();

// Retained for the pre-existing Phase 13C cloud availability check.
export async function listPrograms() {
  if (!isSupabaseConfigured || !supabase) return repositoryResult(null, CLOUD_UNAVAILABLE);
  try {
    const auth = await supabase.auth.getUser();
    if (auth.error) return repositoryResult(null, publicFailure(auth.error));
    const userId = auth.data?.user?.id;
    if (!userId) return repositoryResult(null, AUTH_REQUIRED);
    const { data, error } = await supabase.from("arc_programs")
      .select("id, user_id, start_date, source_schema_version, created_at, updated_at, revision")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    return error ? repositoryResult(null, publicFailure(error)) : repositoryResult(data || [], null);
  } catch (error) {
    return repositoryResult(null, publicFailure(error));
  }
}

export { cloudRepository };
