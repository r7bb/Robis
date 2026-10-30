import { type ClaimedJob, claimJobs, completeJob, type Database, failJob } from '@robis/database';

/**
 * The worker loop.
 *
 * Looks for due jobs when woken (or on a fallback poll), runs them, and
 * records the outcome. Kept separate from
 * `main.ts` so tests can drive it a tick at a time instead of racing a timer.
 */

export type JobHandler = (payload: unknown, context: { db: Database }) => Promise<void>;
export type Handlers = Record<string, JobHandler>;

export type RunnerOptions = {
  db: Database;
  handlers: Handlers;
  workerId?: string;
  /** Jobs claimed per tick. */
  batchSize?: number;
  /** Claim only these kinds. Defaults to every kind. */
  kinds?: readonly string[];
  /**
   * How long to wait, idle, before looking again without being woken: the
   * fallback poll. The worker sets 30 seconds and is woken by `wake()` as
   * each job is queued (stage 3, item 26).
   */
  idleDelayMs?: number;
  /** While idle after a poll that reached the queue, `onPoll` is called this often. */
  beatMs?: number;
  /**
   * Called after every poll that reached the queue, whether or not it found
   * work, after every job, and every `beatMs` while idle after such a poll.
   * The container health check hangs off this: a worker whose loop has
   * stalled, or whose database was gone at its last poll, stops calling it,
   * while one working through a slow batch keeps calling it.
   */
  onPoll?: () => void;
};

/** The heartbeat's limit is 30 s; a beat every 10 s leaves room for a slow one. */
const BEAT_MS = 10_000;

export type TickResult = { claimed: number; completed: number; failed: number; dead: number };

export class Runner {
  private readonly db: Database;
  private readonly handlers: Handlers;
  private readonly workerId: string;
  private readonly batchSize: number;
  private readonly idleDelayMs: number;
  private readonly kinds: readonly string[] | undefined;
  private readonly onPoll: (() => void) | undefined;
  private readonly beatMs: number;

  private running = false;
  /** Set by `wake()`; the next idle wait returns at once. */
  private woken = false;
  private interrupt: (() => void) | null = null;

  constructor(options: RunnerOptions) {
    this.db = options.db;
    this.handlers = options.handlers;
    this.workerId = options.workerId ?? `worker-${crypto.randomUUID().slice(0, 8)}`;
    this.batchSize = options.batchSize ?? 5;
    this.idleDelayMs = options.idleDelayMs ?? 1000;
    this.kinds = options.kinds;
    this.onPoll = options.onPoll;
    this.beatMs = Math.min(options.beatMs ?? BEAT_MS, this.idleDelayMs);
  }

  /** Look for work now: a job was queued. Harmless while already working. */
  wake(): void {
    this.woken = true;
    this.interrupt?.();
  }

  /**
   * Wait until woken or `idleDelayMs` passes. With `beat`, the last poll
   * reached the queue, and the loop says it is alive every `beatMs` on the
   * way without asking the database again; after a failed poll it stays
   * quiet, so the health check sees the database is gone.
   */
  private async idle(beat: boolean): Promise<void> {
    const deadline = Date.now() + this.idleDelayMs;
    while (this.running && !this.woken && Date.now() < deadline) {
      const wait = Math.min(this.beatMs, deadline - Date.now());
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait);
        this.interrupt = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.interrupt = null;
      if (beat && this.running && !this.woken) this.onPoll?.();
    }
    this.woken = false;
  }

  get id(): string {
    return this.workerId;
  }

  /** Claim and process one batch. Returns what happened, for tests and metrics. */
  async tick(): Promise<TickResult> {
    const result: TickResult = { claimed: 0, completed: 0, failed: 0, dead: 0 };

    const batch = await claimJobs(this.db, this.workerId, this.batchSize, new Date(), this.kinds);
    result.claimed = batch.length;

    // Sequential rather than parallel: these are database-bound, and running a
    // batch concurrently would multiply this worker's connection use for no
    // throughput gain that adding a second worker would not give more simply.
    for (const job of batch) {
      const outcome = await this.run(job);
      this.onPoll?.();
      if (outcome === 'completed') result.completed++;
      else if (outcome === 'dead') result.dead++;
      else result.failed++;
    }

    return result;
  }

  private async run(job: ClaimedJob): Promise<'completed' | 'retrying' | 'dead'> {
    const handler = this.handlers[job.kind];

    if (!handler) {
      // An unknown kind is a deploy-ordering problem, not a transient fault.
      // Retrying would spin until the attempt budget runs out, so fail it to
      // the dead-letter state immediately.
      await failJob(this.db, { ...job, attempts: job.maxAttempts }, `No handler for "${job.kind}"`);
      return 'dead';
    }

    try {
      await handler(job.payload, { db: this.db });
      await completeJob(this.db, job.id);
      return 'completed';
    } catch (error) {
      return failJob(this.db, job, error);
    }
  }

  /** Poll until `stop()`. */
  async start(): Promise<void> {
    this.running = true;

    while (this.running) {
      let worked = 0;

      try {
        worked = (await this.tick()).claimed;
        this.onPoll?.();
      } catch (error) {
        // A failure here is the queue itself being unreachable, not a job
        // failing. Back off rather than spinning against a dead database.
        console.error('worker: tick failed', error);
        await this.idle(false);
        continue;
      }

      // Only pause when there was nothing to do; a full batch probably means
      // more is waiting.
      if (worked === 0) await this.idle(true);
    }
  }

  stop(): void {
    this.running = false;
    this.interrupt?.();
  }
}
