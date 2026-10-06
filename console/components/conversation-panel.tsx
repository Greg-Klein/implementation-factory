"use client";

import { ArrowDownIcon, ChatCircleDotsIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { messageBlocks } from "@/lib/conversation";
import type { ConversationMessage, PendingQuestion, SessionPrompt } from "@/lib/types";
import { InlineText } from "./inline-text";
import { QuestionPanel } from "./question-panel";
import { SessionPromptPanel } from "./session-prompt-panel";

function MessageBody({ text }: { text: string }) {
  return <>{messageBlocks(text).map((block, index) => block.kind === "code"
    ? <pre key={index} className="scrollbar-thin mt-2 overflow-x-auto rounded-2.5 border border-[var(--line)] bg-[var(--sunken)] p-3 font-mono text-[10px] leading-4 first:mt-0">{block.content}</pre>
    : <p key={index} className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 first:mt-0"><InlineText text={block.content} /></p>)}</>;
}

/** Claude Code only writes a message to its transcript once the action that followed it has returned, so the panel says it is waiting rather than looking finished, and names the action it is waiting on. */
function WritingHint({ action }: { action?: string }) {
  return (
    <div aria-live="polite" title="Claude Code only writes its message once the current action ends: the terminal is ahead of this panel." className="px-1">
      <p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">
        <span aria-hidden="true" className="status-breathe size-1.5 rounded-full bg-[var(--accent)]" />
        Claude is thinking…
      </p>
      {/* Aligned on the label above, past the dot and its gap. */}
      {action && <p className="mt-1 pl-3.5 font-mono text-[9px] leading-4 text-[var(--faint)]">{action}</p>}
    </div>
  );
}

export function ConversationPanel({ messages, pendingQuestion, sessionPrompt, connected = true, onAnswerPrompt, writing, action, stalled, live = true, canSend, visible, onSend, onAnswer, onCheckTerminal }: { messages: ConversationMessage[]; pendingQuestion?: PendingQuestion; sessionPrompt?: SessionPrompt; connected?: boolean; onAnswerPrompt?: (promptId: string, decision: "accept" | "refuse") => void; writing: boolean; action?: string; stalled: boolean; live?: boolean; canSend: boolean; visible: boolean; onSend: (text: string) => boolean; onAnswer: (answers: Record<string, string>) => void; onCheckTerminal: () => void }) {
  // The flow of terminal output falls silent during a long command, and a named
  // action is proof on its own that the turn is still running.
  const busy = writing || Boolean(action);
  // A question of the workflow or the prompt the session opened on: either one holds the run.
  const decisionId = pendingQuestion?.id ?? sessionPrompt?.id;
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);
  // The ref is read inside an effect that must not re-run on it; the state is
  // what the jump button renders from.
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const list = listRef.current;
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, busy]);

  // A decision blocks the whole run, so it is brought into view even when the
  // user had scrolled up to reread something.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !decisionId || !visible) return;
    pinnedRef.current = true;
    setPinned(true);
    list.scrollTop = list.scrollHeight;
  }, [decisionId, visible]);

  useEffect(() => {
    const composer = composerRef.current;
    // The panel stays mounted under `display: none` for as long as another tab
    // is selected, and every measurement taken there reads zero: the field
    // would be written down to the height of its own padding, and only a
    // keystroke would ever undo it. Measuring again when the tab comes back is
    // the other half of the same rule, since the draft has not changed.
    if (!composer || !visible) return;
    composer.style.height = "auto";
    // The field is border-box, so its borders have to be added back or the
    // textarea ends up two pixels short and shows a scrollbar when empty.
    composer.style.height = `${composer.scrollHeight + composer.offsetHeight - composer.clientHeight}px`;
  }, [draft, visible]);

  const pin = () => { pinnedRef.current = true; setPinned(true); };

  const jumpToBottom = () => {
    const list = listRef.current;
    if (!list) return;
    pin();
    list.scrollTop = list.scrollHeight;
  };

  const send = () => {
    if (!draft.trim() || !canSend) return;
    pin();
    // An instruction that did not leave stays in the field.
    if (onSend(draft.trim())) setDraft("");
  };

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          role="log"
          aria-label="Conversation"
          onScroll={() => { const list = listRef.current; if (!list) return; pinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; setPinned(pinnedRef.current); }}
          className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 md:px-7"
        >
          {messages.length === 0 && !decisionId ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="grid size-10 place-items-center rounded-full border border-dashed border-[var(--line)] text-[var(--muted)]"><ChatCircleDotsIcon size={18} /></div>
            {!live ? (
              <p className="max-w-70 text-xs leading-5 text-[var(--muted)]">No exchange was read back for this run. Its session is closed: its documents and evidence can still be read.</p>
            ) : stalled ? (
              <>
                <p className="max-w-70 text-xs leading-5 text-[var(--muted)]">The run is progressing but no message could be read from the transcript. The session may be waiting for a confirmation that is not visible here, such as folder trust.</p>
                <button type="button" onClick={onCheckTerminal} className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--raised)] active:translate-y-px">Check the Terminal tab</button>
              </>
            ) : (
              <>
                <p className="max-w-70 text-xs leading-5 text-[var(--muted)]">Exchanges with Claude appear here. Tool calls and agents stay in the Terminal tab.</p>
                {busy && <WritingHint action={action} />}
              </>
            )}
          </div> : messages.map((message, index) => (
            <article key={message.id} className={`reveal flex flex-col ${message.author === "user" ? "items-end" : "items-start"}`} style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
              <div className="mb-1.5 flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">
                {message.author === "claude" && <span className="size-1.5 rounded-full bg-[var(--accent)]" />}
                <span>{message.author === "claude" ? "Claude" : "You"}</span>
                <span aria-hidden="true">·</span>
                <span>{new Date(message.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                {message.pending && <span title="Claude will take this instruction at the end of its turn" className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-800">waiting</span>}
              </div>
              <div className={`max-w-[min(680px,92%)] rounded-3 px-4 py-3 ${message.author === "user" ? "bg-[var(--accent-soft)] text-[var(--ink)]" : "border border-[var(--line)] bg-[var(--raised)] shadow-[0_10px_30px_-26px_rgba(30,42,35,.5)]"}`}>
                <MessageBody text={message.text} />
              </div>
            </article>
          ))}
          {sessionPrompt && <div className="flex flex-col items-start"><SessionPromptPanel key={sessionPrompt.id} prompt={sessionPrompt} disabled={!connected} onAnswer={(decision) => onAnswerPrompt?.(sessionPrompt.id, decision)} /></div>}
          {pendingQuestion && <div className="flex flex-col items-start"><QuestionPanel key={pendingQuestion.id} pending={pendingQuestion} onAnswer={onAnswer} /></div>}
          {messages.length > 0 && busy && !decisionId && <WritingHint action={action} />}
        </div>
        {!pinned && (
          <button
            type="button"
            onClick={jumpToBottom}
            title="Go to the last message"
            aria-label="Go to the last message"
            className="reveal absolute bottom-4 right-5 grid size-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--raised)] text-[var(--ink)] shadow-[0_10px_24px_-14px_rgba(30,42,35,.55)] transition hover:bg-[var(--tint)] active:translate-y-px md:right-7"
          >
            <ArrowDownIcon size={15} />
          </button>
        )}
      </div>
      <form
        onSubmit={(event) => { event.preventDefault(); send(); }}
        className="shrink-0 border-t border-[var(--line)] bg-[var(--sunken)] p-4 md:px-7"
      >
        <div className="flex items-end gap-2.5">
          <label className="sr-only" htmlFor="instruction">Instruction for Claude</label>
          <textarea
            id="instruction"
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
            rows={1}
            disabled={!canSend}
            placeholder={canSend ? "Send an instruction to Claude…" : "No active session."}
            className="field max-h-32 resize-none text-[12.5px] leading-5 disabled:opacity-50"
          />
          <button type="submit" disabled={!draft.trim() || !canSend} aria-label="Send the instruction" className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-[var(--ink)] text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
            <PaperPlaneTiltIcon size={16} weight="fill" />
          </button>
        </div>
        <p className="mt-2 text-[10px] text-[var(--muted)]">Enter to send, Shift+Enter for a line break.</p>
      </form>
    </>
  );
}
