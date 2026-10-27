import type { AttemptManager } from './attempts.js';
import { nextCronRun, type Storage, type StoredSchedule } from './storage.js';

const MAX_DELAY_MS = 2_147_000_000;

/** One disposable next-fire timer over authoritative schedule definitions. */
export class SessionCron {
  readonly #storage: Storage;
  readonly #attempts: AttemptManager;
  readonly #now: () => Date;
  #timezone: string;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(
    storage: Storage,
    attempts: AttemptManager,
    timezone: string,
    now = () => new Date(),
  ) {
    this.#storage = storage;
    this.#attempts = attempts;
    this.#timezone = timezone;
    this.#now = now;
  }

  start(): void {
    this.wake();
  }

  wake(timezone = this.#timezone): void {
    if (this.#closed) return;
    this.#timezone = timezone;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    const now = this.#now();
    const projected = this.#storage
      .listSchedules()
      .filter((schedule) => schedule.enabled)
      .flatMap((schedule) => {
        // `wake` runs inside a timer callback, where a throw would take the
        // process down and every other schedule with it. The row is not lost:
        // the Context projection reports its `nextRunError` for the operator.
        try {
          return [
            {
              schedule,
              at: nextCronRun(schedule.expression, this.#timezone, now),
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((left, right) =>
        left.at === right.at
          ? left.schedule.id.localeCompare(right.schedule.id)
          : left.at.localeCompare(right.at),
      );
    const first = projected[0];
    if (first === undefined) {
      this.#timer = undefined;
      return;
    }
    const next = {
      at: first.at,
      schedules: projected
        .filter(({ at }) => at === first.at)
        .map(({ schedule }) => schedule),
    };
    const delay = Math.min(
      MAX_DELAY_MS,
      Math.max(0, Date.parse(first.at) - now.getTime()),
    );
    this.#timer = setTimeout(() => this.#fire(next), delay);
    this.#timer.unref();
  }

  close(): void {
    this.#closed = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #fire(next: { at: string; schedules: StoredSchedule[] }): void {
    this.#timer = undefined;
    if (Date.parse(next.at) > this.#now().getTime()) {
      this.wake();
      return;
    }
    for (const schedule of next.schedules) {
      void this.#attempts.enqueue({
        sessionId: schedule.sessionId,
        command: {
          kind: 'scheduled',
          name: schedule.name,
          prompt: schedule.prompt,
          ranAt: next.at,
        },
        emit: () => undefined,
      }).done;
    }
    this.wake();
  }
}
