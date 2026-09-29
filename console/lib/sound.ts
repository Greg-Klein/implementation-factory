import type { AlertCue } from "./notifications";

/**
 * The workflow used to ask the model to play a system sound. That is wrong on
 * three counts: the prompt told it to play "right before asking", so the sound
 * always came early; the model could forget; and the files were Apple's, which
 * a public MIT repository has no business shipping.
 *
 * The interface knows the exact instant a decision starts waiting or a run
 * ends, because it already computes that transition for the notification. The
 * cue is synthesised here so there is no asset, no licence question and no
 * platform to detect.
 */

/** Two short arpeggios: rising when something is expected of the user, resolving when the run is over. */
const CUES: Record<AlertCue, number[]> = {
  attention: [880, 1174.66],
  done: [587.33, 783.99, 1046.5],
};

const NOTE_SPACING_S = 0.12;
const NOTE_LENGTH_S = 0.34;
const PEAK_GAIN = 0.18;

/**
 * Off until the user asks for it. A tool that makes noise on first use without
 * being asked is a tool people mute once and never unmute.
 */
const STORAGE_KEY = "impl.sound";

let context: AudioContext | null = null;

export function isSoundEnabled() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    // Private windows and blocked site data both throw on access.
    return false;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // The preference is then only good for this page, which beats failing.
  }
}

function audioContext() {
  if (context) return context;
  const Constructor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  context = new Constructor();
  return context;
}

/**
 * A page may only emit sound once the user has interacted with it, so the
 * context is created and resumed from a click. Starting a run is that click,
 * and it is also the moment the user says they are about to walk away.
 */
export function unlockSound() {
  try {
    void audioContext()?.resume();
  } catch {
    // A browser that refuses to make sound is not a reason to fail a run.
  }
}

export function playCue(cue: AlertCue) {
  try {
    if (!isSoundEnabled()) return;
    const ctx = context;
    // Never created, so nothing has been interacted with on this page yet.
    if (!ctx || ctx.state === "closed") return;
    void ctx.resume();
    const start = ctx.currentTime;
    for (const [index, frequency] of CUES[cue].entries()) {
      const at = start + index * NOTE_SPACING_S;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      // A square-edged envelope clicks, so both ends are ramped.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_LENGTH_S);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + NOTE_LENGTH_S + 0.02);
    }
  } catch {
    // Same here: the cue is a convenience, never a failure mode.
  }
}
