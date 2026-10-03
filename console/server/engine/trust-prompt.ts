/**
 * The folder trust dialog of Claude Code, read off the terminal. It is drawn
 * before any hook can fire and before a transcript exists, so the output of the
 * session is the only place it can be seen from.
 *
 * Everything known about that dialog lives here: its wording, how to tell it is
 * on screen, and the keystrokes it takes. Observed on Claude Code 2.1.288, in a
 * directory it had never been started in (tests/unit/fixtures/trust-dialog.json
 * is that output, path replaced):
 *
 *   Accessing workspace:
 *   <directory>
 *   Quick safety check: Is this a project you created or one you trust? (…)
 *   Claude Code'll be able to read, edit, and execute files here.
 *   Security guide
 *   ❯ No, exit
 *     Yes, I trust this folder
 *   Enter to confirm · Esc to cancel
 *
 * The words are not separated by spaces but by cursor moves (`ESC[<column>G`),
 * and the frame arrives cut anywhere across writes, so the text is compared
 * with every escape sequence and every blank removed. A dialog reworded by a
 * later version matches nothing and the run behaves as before this existed:
 * nothing shown, the terminal tab as the only way to answer. That is the
 * intended failure, the opposite one being a card that blocks a healthy run.
 */

/** Every phrase that must be on screen, blanks removed and lowercased. */
const REQUIRED = ["accessingworkspace:", "no,exit", "yes,itrustthisfolder"];
/** Any of these in later output means the dialog is being drawn again, not left. */
const MARKERS = [...REQUIRED, "quicksafetycheck", "entertoconfirm"];
const SELECTED_NO = "❯no,exit";
const SELECTED_YES = "❯yes,itrustthisfolder";

/** The dialog is the first thing a session draws: past this much output without it, it is not coming. */
const WATCH_BUDGET = 16_000;
/** How much raw output is kept to match against. The whole dialog is about 1 100 bytes. */
const WINDOW = 8_000;
/** Output this long with no trace of the dialog means the session moved on to its own screen. */
const LEFT_AFTER = 400;

/** OSC strings, CSI sequences, charset selections and the two-character escapes, in that order. */
const ESCAPES = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[()][0-9A-Za-z]|\u001b[@-Z\\^_=>78]/g;
/** An escape sequence the write was cut in the middle of: held back until the rest arrives. */
const TORN_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*|\][^\u0007\u001b]*|[()])?$/;
const BLANKS = /[\s\u0000-\u001f\u007f]+/g;

/** What a terminal would show of this output, with no blank left in it: the only form the dialog is compared in. */
export function visibleText(raw: string) {
  return raw.replace(TORN_ESCAPE, "").replace(ESCAPES, "").replace(BLANKS, "").toLowerCase();
}

/** Whether the whole dialog is in this output, in the order it is drawn. */
export function matchesTrustDialog(raw: string) {
  const text = visibleText(raw);
  let from = 0;
  for (const phrase of REQUIRED) {
    const at = text.indexOf(phrase, from);
    if (at < 0) return false;
    from = at + phrase.length;
  }
  return true;
}

/** The option the cursor was last drawn on, when the output says. */
function selectedOption(raw: string): "no" | "yes" | undefined {
  const text = visibleText(raw);
  const no = text.lastIndexOf(SELECTED_NO);
  const yes = text.lastIndexOf(SELECTED_YES);
  if (no < 0 && yes < 0) return undefined;
  return yes > no ? "yes" : "no";
}

const DOWN = "\u001b[B";
const ENTER = "\r";
const ESCAPE = "\u001b";

/**
 * The keystrokes for an answer. Refusing is the Escape the dialog itself offers,
 * wherever the cursor is. Accepting confirms "Yes" once the cursor is on it: the
 * dialog opens on "No, exit", one line above. Should the cursor not be where it
 * was last seen, the worst an acceptance can turn into is a refusal.
 *
 * Only the refusal's Escape is in the dialog's own text. Neither answer was
 * sent to a real Claude Code: accepting writes to the user's configuration.
 */
export function trustAnswerKeys(decision: "accept" | "refuse", selected: "no" | "yes"): string[] {
  if (decision === "refuse") return [ESCAPE];
  return selected === "yes" ? [ENTER] : [DOWN, ENTER];
}

export type TrustPromptChange = "shown" | "gone";

/**
 * Follows the dialog across the writes of one session. `feed` takes every chunk
 * of output and says when the dialog appeared and when it left; nothing else
 * changes its mind, so a caller that learnt the answer some other way (a hook,
 * an exit) simply stops listening.
 */
export function createTrustPromptWatcher() {
  let raw = "";
  let watched = 0;
  let shown = false;
  let selected: "no" | "yes" = "no";

  return {
    get shown() { return shown; },
    get selected() { return selected; },
    feed(chunk: string): TrustPromptChange | undefined {
      if (!shown) {
        if (watched > WATCH_BUDGET) return undefined;
        watched += chunk.length;
        raw = (raw + chunk).slice(-WINDOW);
        if (!matchesTrustDialog(raw)) return undefined;
        shown = true;
        selected = selectedOption(raw) ?? "no";
        raw = "";
        return "shown";
      }
      raw = (raw + chunk).slice(-WINDOW);
      const text = visibleText(raw);
      selected = selectedOption(raw) ?? selected;
      // The dialog drawn again, whole or in part: a resize, the cursor moving.
      if (MARKERS.some((marker) => text.includes(marker))) { raw = ""; return undefined; }
      if (text.length < LEFT_AFTER) return undefined;
      shown = false;
      raw = "";
      return "gone";
    },
    /** The answer was sent: whatever comes next is looked at afresh, the dialog drawn again included. */
    answered() {
      shown = false;
      raw = "";
    },
  };
}
