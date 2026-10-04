"use client";

import { ArrowRightIcon, RobotIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { PendingQuestion } from "@/lib/types";

export function QuestionPanel({ pending, onAnswer }: { pending: PendingQuestion; onAnswer: (answers: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(pending.questions.map(({ question }) => [question, ""])));
  const ready = pending.questions.every(({ question }) => answers[question]?.trim());
  const chooseOption = (question: PendingQuestion["questions"][number], label: string) => {
    setAnswers((current) => {
      if (!question.multiSelect) return { ...current, [question.question]: label };
      const selected = current[question.question]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
      const next = selected.includes(label) ? selected.filter((value) => value !== label) : [...selected, label];
      return { ...current, [question.question]: next.join(", ") };
    });
  };

  return (
    <section aria-label="Decision required" className="reveal w-full max-w-[min(680px,92%)] rounded-3 border border-[var(--callout-line)] bg-[var(--callout)] p-5 shadow-[0_10px_30px_-26px_rgba(30,42,35,.5)]">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-[var(--on-ink)]"><RobotIcon size={14} /></div>
        <div><p className="text-xs font-semibold">Decision required</p><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Claude is waiting for your answer. The terminal stays available.</p></div>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (ready) onAnswer(answers); }}>
        <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {pending.questions.map((question, index) => (
            <fieldset key={question.question} className="py-4 first:pt-3 last:pb-3">
              <legend className="font-mono text-[9px] font-semibold uppercase tracking-[.14em] text-[var(--accent)]">{question.header}</legend>
              <p className="mt-2 text-[11px] font-medium leading-4">{question.question}</p>
              {question.options.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{question.options.map((option) => {
                const selected = answers[question.question]?.split(",").map((value) => value.trim()).includes(option.label);
                return <button key={option.label} type="button" title={option.description} onClick={() => chooseOption(question, option.label)} className={`rounded-md border px-2 py-1.5 text-[10px] transition active:translate-y-px ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line)] bg-[var(--raised)] text-[var(--ink)] hover:border-[var(--line-strong)]"}`}>{option.label}</button>;
              })}</div>}
              <label htmlFor={`question-answer-${index}`} className="mt-3 block text-[10px] text-[var(--muted)]">Your answer</label>
              <textarea id={`question-answer-${index}`} rows={2} value={answers[question.question] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.question]: event.target.value }))} placeholder="Write your answer…" className="field mt-1.5 resize-none text-[11px] leading-4" />
            </fieldset>
          ))}
        </div>
        <button type="submit" disabled={!ready} className="mt-4 flex w-full items-center justify-between rounded-lg bg-[var(--ink)] px-3 py-2.5 text-[11px] font-semibold text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"><span>Send to Claude</span><ArrowRightIcon size={13} /></button>
      </form>
    </section>
  );
}
