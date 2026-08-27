// src/components/SectionSelector.jsx
//
// Lets the user choose WHICH report sections to generate on the next call.
//
// Why this exists
// ---------------
// On a free tier a full insight is a single large request that either lands or
// is lost. Generating two sections at a time turns one all-or-nothing call into
// several small ones, each of which can be saved. It also makes the cost of a
// run predictable before it is spent.
//
// What every call still carries, regardless of selection:
//   - ALL the user's inputs. Selection narrows the OUTPUT, never the input.
//   - The full text of every section already generated, so the model writes the
//     next one in the context of what it has already said instead of
//     contradicting or repeating it.
//
// Sections already generated are shown ticked and disabled: re-generating one
// spends a request to replace work that is already done. Clearing the whole set
// is available separately.

import React from "react";

export default function SectionSelector({
  topics = [],
  selected = [],
  onChange,
  doneKeys = [],
  disabled = false,
  freeTier = true,
}) {
  const done = new Set(doneKeys);
  const outstanding = topics.filter((t) => !done.has(t.key));
  const allOutstandingSelected =
    outstanding.length > 0 && outstanding.every((t) => selected.includes(t.key));

  const toggle = (key) => {
    if (disabled || done.has(key)) return;
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <div
      className="rounded-lg border p-3 mb-3"
      style={{ borderColor: "#22304A", background: "#0E1520" }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#CFE0F2" }}>
          Sections to generate
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            data-plain
            disabled={disabled || outstanding.length === 0}
            onClick={() =>
              onChange(allOutstandingSelected ? [] : outstanding.map((t) => t.key))
            }
            className="text-[11px] underline"
            style={{ color: "#4DA3FF" }}
          >
            {allOutstandingSelected ? "Clear all" : "Select all remaining"}
          </button>
          <button
            type="button"
            data-plain
            disabled={disabled || outstanding.length === 0}
            onClick={() => onChange(outstanding.slice(0, 1).map((t) => t.key))}
            className="text-[11px] underline"
            style={{ color: "#4DA3FF" }}
          >
            Just the next one
          </button>
        </div>
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
        {topics.map((t) => {
          const isDone = done.has(t.key);
          const isOn = isDone || selected.includes(t.key);
          return (
            <label
              key={t.key}
              className="flex items-start gap-2 text-xs cursor-pointer"
              style={{ color: isDone ? "#6FC49A" : "#D7E5F7", opacity: disabled ? 0.55 : 1 }}
              title={isDone ? "Already generated — clear the partial insight to redo it" : ""}
            >
              <input
                type="checkbox"
                checked={isOn}
                disabled={disabled || isDone}
                onChange={() => toggle(t.key)}
                style={{ marginTop: 2, accentColor: isDone ? "#4DD091" : "#4DA3FF" }}
              />
              <span>
                {t.label}
                {isDone && <span style={{ color: "#6FC49A" }}> · done</span>}
              </span>
            </label>
          );
        })}
      </div>

      <div className="text-[11px] mt-2.5 leading-relaxed" style={{ color: "#8FA3BA" }}>
        {freeTier ? (
          <>
            <strong style={{ color: "#FFC79A" }}>On a free tier, generate a few sections at a time.</strong>{" "}
            Each run is a smaller request, so it is far less likely to be refused or cut
            short — and after each one, <em>Save session to file</em> in the panel on the
            left keeps that progress even if the key runs out afterwards.
          </>
        ) : (
          <>
            <strong style={{ color: "#9BD1AE" }}>On a paid key you can select everything at once.</strong>{" "}
            Generating in stages still works and remains the safer option for long reports.
          </>
        )}
        <div className="mt-1.5">
          Every run sends <strong>all your inputs</strong> and the <strong>full text of
          sections already generated</strong>, so each new section is written to fit what
          is already there. Choosing fewer sections narrows the output, never the input.
        </div>
      </div>
    </div>
  );
}
