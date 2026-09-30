"use client";

import { ArrowDownIcon, ChatCircleDotsIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { messageBlocks } from "@/lib/conversation";
import type { ConversationMessage, PendingQuestion } from "@/lib/types";
import { InlineText } from "./inline-text";
import { QuestionPanel } from "./question-panel";

function MessageBody({ text }: { text: string }) {
  return <>{messageBlocks(text).map((block, index) => block.kind === "code"
    ? <pre key={index} className="scrollbar-thin mt-2 overflow-x-auto rounded-2.5 border border-[var(--line)] bg-[var(--sunken)] p-3 font-mono text-[10px] leading-4 first:mt-0">{block.content}</pre>
    : <p key={index} className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 first:mt-0"><InlineText text={block.content} /></p>)}</>;
}

/** Claude Code only writes a message to its transcript once the action that followed it has returned, so the panel says it is waiting rather than looking finished, and names the action it is waiting on. */
function WritingHint({ action }: { action?: string }) {
  return (
    <div aria-live="polite" title="Claude Code n’écrit son message qu’à la fin de l’action en cours : le terminal est en avance sur ce panneau." className="px-1">
      <p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">
        <span aria-hidden="true" className="status-breathe size-1.5 rounded-full bg-[var(--accent)]" />
        Claude réfléchit…
      </p>
      {/* Aligned on the label above, past the dot and its gap. */}
      {action && <p className="mt-1 pl-3.5 font-mono text-[9px] leading-4 text-[var(--faint)]">{action}</p>}
    </div>
  );
}

export function ConversationPanel({ messages, pendingQuestion, writing, action, stalled, live = true, canSend, visible, onSend, onAnswer, onCheckTerminal }: { messages: ConversationMessage[]; pendingQuestion?: PendingQuestion; writing: boolean; action?: string; stalled: boolean; live?: boolean; canSend: boolean; visible: boolean; onSend: (text: string) => void; onAnswer: (answers: Record<string, string>) => void; onCheckTerminal: () => void }) {
  // The flow of terminal output falls silent during a long command, and a named
  // action is proof on its own that the turn is still running.
  const busy = writing || Boolean(action);
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
    if (!list || !pendingQuestion || !visible) return;
    pinnedRef.current = true;
    setPinned(true);
    list.scrollTop = list.scrollHeight;
  }, [pendingQuestion?.id, visible]);

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
    onSend(draft.trim());
    setDraft("");
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
          {messages.length === 0 && !pendingQuestion ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="grid size-10 place-items-center rounded-full border border-dashed border-[var(--line)] text-[var(--muted)]"><ChatCircleDotsIcon size={18} /></div>
            {!live ? (
              <p className="max-w-70 text-xs leading-5 text-[var(--muted)]">Aucun échange n’a été relu pour ce run. Sa session est fermée : ses documents et ses preuves restent consultables.</p>
            ) : stalled ? (
              <>
                <p className="max-w-70 text-xs leading-5 text-[var(--muted)]">Le run progresse mais aucun message n’a pu être lu depuis le transcript. La session peut attendre une confirmation invisible ici, comme la confiance du dossier.</p>
                <button type="button" onClick={onCheckTerminal} className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--raised)] active:translate-y-px">Vérifier l’onglet Terminal</button>
              </>
            ) : (
              <>
                <p className="max-w-70 text-xs leading-5 text-[var(--muted)]">Les échanges avec Claude apparaissent ici. Les appels d’outils et les agents restent dans l’onglet Terminal.</p>
                {busy && <WritingHint action={action} />}
              </>
            )}
          </div> : messages.map((message, index) => (
            <article key={message.id} className={`reveal flex flex-col ${message.author === "user" ? "items-end" : "items-start"}`} style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
              <div className="mb-1.5 flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">
                {message.author === "claude" && <span className="size-1.5 rounded-full bg-[var(--accent)]" />}
                <span>{message.author === "claude" ? "Claude" : "Toi"}</span>
                <span aria-hidden="true">·</span>
                <span>{new Date(message.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                {message.pending && <span title="Claude prendra cette instruction à la fin de son tour" className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-800">en attente</span>}
              </div>
              <div className={`max-w-[min(680px,92%)] rounded-3 px-4 py-3 ${message.author === "user" ? "bg-[var(--accent-soft)] text-[var(--ink)]" : "border border-[var(--line)] bg-[var(--raised)] shadow-[0_10px_30px_-26px_rgba(30,42,35,.5)]"}`}>
                <MessageBody text={message.text} />
              </div>
            </article>
          ))}
          {pendingQuestion && <div className="flex flex-col items-start"><QuestionPanel key={pendingQuestion.id} pending={pendingQuestion} onAnswer={onAnswer} /></div>}
          {messages.length > 0 && busy && !pendingQuestion && <WritingHint action={action} />}
        </div>
        {!pinned && (
          <button
            type="button"
            onClick={jumpToBottom}
            title="Aller au dernier message"
            aria-label="Aller au dernier message"
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
          <label className="sr-only" htmlFor="instruction">Instruction pour Claude</label>
          <textarea
            id="instruction"
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
            rows={1}
            disabled={!canSend}
            placeholder={canSend ? "Transmettre une instruction à Claude…" : "Aucune session active."}
            className="field max-h-32 resize-none text-[12.5px] leading-5 disabled:opacity-50"
          />
          <button type="submit" disabled={!draft.trim() || !canSend} aria-label="Envoyer l’instruction" className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-[var(--ink)] text-[var(--on-ink)] transition hover:bg-[var(--ink-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35">
            <PaperPlaneTiltIcon size={16} weight="fill" />
          </button>
        </div>
        <p className="mt-2 text-[10px] text-[var(--muted)]">Entrée pour envoyer, Maj+Entrée pour un saut de ligne.</p>
      </form>
    </>
  );
}
