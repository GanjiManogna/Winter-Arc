import { useEffect, useId, useState } from "react";

const EMPTY = {
  title: "",
  type: "boolean",
  goal: "",
  unit: "",
};

function CustomHabitModal({ open, onClose, onCreate }) {
  const titleId = useId();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setForm(EMPTY);
    setError("");

    const onKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleSubmit = (event) => {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setError("Give the habit a name.");
      return;
    }

    if (form.type === "measurable") {
      const goal = Number(form.goal);
      if (!Number.isFinite(goal) || goal <= 0) {
        setError("Add a target greater than zero.");
        return;
      }
    }

    onCreate({
      title,
      type: form.type,
      goal: form.type === "measurable" ? Number(form.goal) : null,
      unit: form.type === "measurable" ? form.unit.trim() : null,
    });
  };

  return (
    <div className="habit-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="habit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="habit-modal-kicker">YOUR WINTER</p>
        <h2 id={titleId}>Add a custom habit</h2>
        <p className="habit-modal-copy">
          Something small enough to keep. Something true enough to matter.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Habit name
            <input
              autoFocus
              type="text"
              maxLength={48}
              placeholder="Study DSA"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>

          <fieldset>
            <legend>Habit type</legend>
            <div className="habit-type-row">
              <button
                type="button"
                className={form.type === "boolean" ? "is-active" : ""}
                onClick={() => setForm({ ...form, type: "boolean" })}
              >
                Daily yes / no
              </button>
              <button
                type="button"
                className={form.type === "measurable" ? "is-active" : ""}
                onClick={() => setForm({ ...form, type: "measurable" })}
              >
                With a target
              </button>
            </div>
          </fieldset>

          {form.type === "measurable" ? (
            <div className="habit-measure-row">
              <label>
                Target
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="60"
                  value={form.goal}
                  onChange={(event) => setForm({ ...form, goal: event.target.value })}
                />
              </label>
              <label>
                Unit
                <input
                  type="text"
                  maxLength={20}
                  placeholder="minutes"
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                />
              </label>
            </div>
          ) : null}

          {error ? <p className="habit-modal-error">{error}</p> : null}

          <div className="habit-modal-actions">
            <button type="button" className="habit-modal-cancel" onClick={onClose}>
              Not now
            </button>
            <button type="submit" className="habit-modal-save">
              Add habit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CustomHabitModal;
