import { useEffect, useState } from "react";
import { createCustomHabit } from "../data/storage";
import "./AddHabitModal.css";

function AddHabitModal({
  open,
  onClose,
  onCreated,
  editingHabit = null,
  onUpdate,
  cloudMode = false,
  onPrepareCloudRequest,
  onCreateCloud,
  pendingCloudRequest = null,
  onPendingCloudRequestChange,
  canRetryCloudRequest = true,
}) {
  const [title, setTitle] = useState(editingHabit?.title || "");
  const [type, setType] = useState(editingHabit?.type || "boolean");
  const [goal, setGoal] = useState(editingHabit?.goal ? String(editingHabit.goal) : "");
  const [unit, setUnit] = useState(editingHabit?.unit || "minutes");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const clearPendingRequest = () => {
    onPendingCloudRequestChange?.(null);
    setError("");
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKey = (event) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (editingHabit) {
      const nextHabit = {
        ...editingHabit,
        title: title.trim(),
        type,
        goal: type === "measurable" ? Number(goal) : null,
        unit: type === "measurable" ? unit.trim() || "minutes" : null,
      };
      if (!nextHabit.title || (type === "measurable" && (!Number.isFinite(nextHabit.goal) || nextHabit.goal <= 0))) {
        setError(type === "measurable" ? "Name the habit and add a target greater than zero." : "Give the habit a name.");
        return;
      }
      setSaving(true);
      setError("");
      let result;
      try {
        result = await onUpdate?.(nextHabit);
      } catch {
        result = { error: { message: "Couldn't update this custom habit. Please try again." } };
      }
      setSaving(false);
      if (result?.error || !result?.data) {
        setError(result?.error?.message || "Couldn't update this custom habit. Please try again.");
        return;
      }
      onClose();
      return;
    }

    if (pendingCloudRequest && !canRetryCloudRequest) {
      setError("This save belongs to a different account. Cancel it before creating a habit here.");
      return;
    }

    if (cloudMode || pendingCloudRequest) {
      const request = pendingCloudRequest || onPrepareCloudRequest?.({ title, type, unit, goal });
      if (!request) {
        setError(type === "measurable"
          ? "Name a habit and add a target greater than zero."
          : "Give this habit a quiet name.");
        return;
      }
      onPendingCloudRequestChange?.(request);
      setSaving(true);
      setError("");
      let result;
      try {
        result = await onCreateCloud?.(request);
      } catch {
        result = { error: { message: "Couldn't save this habit to your account. Please retry." } };
      }
      setSaving(false);
      if (result?.error || !result?.data) {
        setError(result?.error?.message || "Couldn't save this habit to your account. Please retry.");
        return;
      }
      onCreated?.(result.data);
      onPendingCloudRequestChange?.(null);
      onClose();
      return;
    }

    const created = createCustomHabit({
      title,
      type,
      unit,
      goal,
    });

    if (!created) {
      setError(
        type === "measurable"
          ? "Name a habit and a target greater than zero."
          : "Give this habit a quiet name."
      );
      return;
    }

    onCreated?.(created);
    onClose();
  };

  return (
    <div className="habit-modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <div
        className="habit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="habit-modal-kicker">YOUR WINTER ARC</p>
        <h2 id="habit-modal-title">{editingHabit ? "Edit custom habit" : "Add a custom habit"}</h2>
        <p className="habit-modal-copy">
          {editingHabit ? "Shape this promise to fit your practice." : "Something small enough to keep."}
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Habit name
            <input
              autoFocus
              type="text"
              maxLength={48}
              value={title}
              disabled={saving}
              onChange={(event) => {
                setTitle(event.target.value);
                if (pendingCloudRequest) clearPendingRequest();
              }}
              placeholder="Study DSA"
            />
          </label>

          <fieldset>
            <legend>Habit type</legend>
            <label className="habit-modal-choice">
              <input
                type="radio"
                name="habit-type"
                checked={type === "boolean"}
                disabled={saving}
                onChange={() => {
                  setType("boolean");
                  if (pendingCloudRequest) clearPendingRequest();
                }}
              />
              Simple yes / no
            </label>
            <label className="habit-modal-choice">
              <input
                type="radio"
                name="habit-type"
                checked={type === "measurable"}
                disabled={saving}
                onChange={() => {
                  setType("measurable");
                  if (pendingCloudRequest) clearPendingRequest();
                }}
              />
              Measurable
            </label>
          </fieldset>

          {type === "measurable" ? (
            <div className="habit-modal-row">
              <label>
                Target
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={goal}
                  disabled={saving}
                  onChange={(event) => {
                    setGoal(event.target.value);
                    if (pendingCloudRequest) clearPendingRequest();
                  }}
                  placeholder="60"
                />
              </label>
              <label>
                Unit
                <input
                  type="text"
                  maxLength={20}
                  value={unit}
                  disabled={saving}
                  onChange={(event) => {
                    setUnit(event.target.value);
                    if (pendingCloudRequest) clearPendingRequest();
                  }}
                  placeholder="minutes"
                />
              </label>
            </div>
          ) : null}

          {error ? <p className="habit-modal-error">{error}</p> : null}

          {pendingCloudRequest && !canRetryCloudRequest ? (
            <p className="habit-modal-error" role="status">
              This cloud save is waiting for its original account. Reconnect to that account to retry, or cancel this draft.
            </p>
          ) : null}

          <div className="habit-modal-actions">
            <button
              type="button"
              className="habit-modal-ghost"
              disabled={saving}
              onClick={() => {
                clearPendingRequest();
                onClose();
              }}
            >
              Cancel
            </button>
            <button type="submit" className="habit-modal-submit" disabled={saving || (pendingCloudRequest && !canRetryCloudRequest)}>
              {saving ? "Saving…" : editingHabit ? "Save changes" : pendingCloudRequest ? "Retry save" : "Add habit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddHabitModal;
