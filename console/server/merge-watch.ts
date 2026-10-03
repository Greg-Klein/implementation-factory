import type { MergeRequestStatus } from "./domain.js";
import type { MergeWatch } from "./types.js";

export type MergeWatcherOptions = {
  /** The watches something in the queue is waiting for, read at every tick. */
  held(): MergeWatch[];
  /** Asks GitLab. A failure is an `unknown` answer, thrown or returned. */
  check(watch: MergeWatch): Promise<MergeRequestStatus>;
  /** Called with every answer; the owner updates or drops the watch. */
  apply(watch: MergeWatch, status: MergeRequestStatus): void | Promise<void>;
  intervalMs: number;
  /** Replaced in tests. */
  now?: () => number;
};

/**
 * Asks GitLab, on a timer of its own, whether the merge requests the queue is
 * waiting for have been merged. The timer exists only while something is held:
 * a console with nothing waiting asks nothing. Each merge request is asked at
 * most once per interval, however often the queue changes in between.
 */
export class MergeWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastCheck = new Map<string, number>();
  private ticking: Promise<void> | null = null;

  constructor(private readonly options: MergeWatcherOptions) {}

  get running() { return this.timer !== null; }

  /** Starts or stops the timer to match the queue. A watch never asked about is asked at once. */
  sync() {
    const held = this.options.held();
    if (held.length === 0) { this.stop(); return; }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
      this.timer.unref?.();
    }
    if (held.some((watch) => !this.lastCheck.has(watch.mergeRequestUrl))) void this.tick();
  }

  /** One round: every held watch that is due. Rounds never overlap. */
  tick(): Promise<void> {
    this.ticking ??= this.round().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  private async round() {
    const now = this.options.now ?? Date.now;
    // A copy: applying an answer may drop the watch from the owner's list.
    const held = [...this.options.held()];
    const urls = new Set(held.map((watch) => watch.mergeRequestUrl));
    for (const url of this.lastCheck.keys()) if (!urls.has(url)) this.lastCheck.delete(url);
    for (const watch of held) {
      const last = this.lastCheck.get(watch.mergeRequestUrl);
      if (last !== undefined && now() - last < this.options.intervalMs) continue;
      this.lastCheck.set(watch.mergeRequestUrl, now());
      const status = await this.options.check(watch).catch(() => "unknown" as const);
      await this.options.apply(watch, status);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
