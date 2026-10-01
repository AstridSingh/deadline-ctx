/**
 * Deadline context implementation.
 */

/**
 * A clock function: returns the current time in milliseconds.
 * @typedef {() => number} Clock
 */

const DEFAULT_CLOCK = () => Date.now();

/**
 * Thrown when the deadline has expired or when an invalid deadline
 * configuration is supplied.
 */
export class DeadlineError extends Error {
  /**
   * @param {string} message  Human-readable detail.
   * @param {object} [info]   Extra fields callers may inspect.
   * @param {number} [info.remaining]  Remaining ms at throw time (if known).
   */
constructor(message, info) {
    super(message);
    this.name = "DeadlineError";
    if (info && info.remaining !== undefined) {
      this.remaining = info.remaining;
    }
  }
}

/**
 * Context that tracks an absolute deadline.
 *
 * This library uses absolute timestamps (an epoch-ms value) internally
 * rather than relative durations because nested operations each slice
 * their own piece of the remaining budget. Keeping a single absolute
 * endpoint means every child automatically shares the parent's real
 * wall-clock deadline — there is no risk of a child accidentally
 * extending the budget.
 *
 * Calls accept millisecond durations for ergonomics and convert them
 * to absolute deadlines internally.
 */
export class DeadlineCtx {
  /**
   * @param {number|Clock} deadlineOrClock  Either a duration in ms
   *   (interpreted relative to the supplied clock's current time) or
   *   a clock function. If omitted, the global Date.now is used.
   * @param {object}   [opts]
   * @param {number}   [opts.duration]  Duration in ms from `clock()`'s
   *   now. Used when the first argument is a clock.
   * @param {Clock}    [opts.clock]     Override the clock. Defaults to
   *   Date.now when the first argument is a number.
   */
  constructor(deadlineOrClock, opts = {}) {
    let clock;
    let absolute;

    if (typeof deadlineOrClock === "function") {
      clock = deadlineOrClock;
      if (opts.duration === undefined) {
        throw new DeadlineError(
          "opts.duration (ms) is required when passing a clock"
        );
      }
      if (typeof opts.duration !== "number" || !Number.isFinite(opts.duration) || opts.duration < 0) {
        throw new DeadlineError(`opts.duration must be a non-negative finite ms value, got ${opts.duration}`);
      }
      absolute = clock() + opts.duration;
    } else if (typeof deadlineOrClock === "number") {
      if (!Number.isFinite(deadlineOrClock) || deadlineOrClock < 0) {
        throw new DeadlineError(`duration must be a non-negative finite ms value, got ${deadlineOrClock}`);
      }
      clock = opts.clock || DEFAULT_CLOCK;
      absolute = clock() + deadlineOrClock;
    } else if (deadlineOrClock === undefined) {
      clock = opts.clock || DEFAULT_CLOCK;
      if (opts.duration === undefined) {
        throw new DeadlineError(
          "a duration (ms) or a clock+duration is required"
        );
      }
      if (typeof opts.duration !== "number" || !Number.isFinite(opts.duration) || opts.duration < 0) {
        throw new DeadlineError(`opts.duration must be a non-negative finite ms value, got ${opts.duration}`);
      }
      absolute = clock() + opts.duration;
    } else {
      throw new DeadlineError(
        `expected a duration (ms) or a clock function, got ${typeof deadlineOrClock}`
      );
    }

    this._clock = clock;
    this._deadline = absolute;
  }

  /**
   * The absolute deadline timestamp (epoch ms). Read-only.
   * @returns {number}
   */
  get deadline() {
    return this._deadline;
  }

  /**
   * Milliseconds remaining until the deadline. Can be negative once
   * the deadline has passed — callers should treat <= 0 as expired.
   * @returns {number}
   */
  remaining() {
    return this._deadline - this._clock();
  }

  /**
   * True when the deadline has passed. Exactly `remaining() <= 0`.
   * @returns {boolean}
   */
  isExpired() {
    return this.remaining() <= 0;
  }

  /**
   * Throw a DeadlineError if the deadline has expired.
   * Useful as a guard at the top of a long-running step.
   *
   * @param {string} [msg]  Optional message.
   */
  check(msg) {
    const r = this.remaining();
    if (r <= 0) {
      throw new DeadlineError(msg || "deadline expired", { remaining: r });
    }
  }

  /**
   * Build a child context sharing this parent's deadline but with its
   * own (smaller) remaining budget.
   *
   * The returned context's deadline is the earlier of:
   *   - this.parent's deadline, and
   *   - `budgetMs` ms from now.
   *
   * If `budgetMs` exceeds the parent's remaining budget, the child
   * simply inherits the parent's deadline. This is deliberate: it
   * mirrors how timeout propagation works in real systems, and avoids
   * silently widening a budget that the caller intended to keep tight.
   *
   * @param {number} budgetMs  Maximum additional budget for the child.
   * @returns {DeadlineCtx}
   */
  child(budgetMs) {
    if (typeof budgetMs !== "number" || !Number.isFinite(budgetMs) || budgetMs < 0) {
      throw new DeadlineError(`budgetMs must be a non-negative finite ms value, got ${budgetMs}`);
    }
    const now = this._clock();
    const childAbs = now + budgetMs;
    const merged = Math.min(childAbs, this._deadline);
    const ctx = Object.create(DeadlineCtx.prototype);
    ctx._clock = this._clock;
    ctx._deadline = merged;
    return ctx;
  }
}
