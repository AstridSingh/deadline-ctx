# Deadline Ctx

Pass a deadline through nested calls without a framework. Each context carries an absolute deadline timestamp; children share the parent's clock and clamp their own budget against it.

```js
import { DeadlineCtx, DeadlineError } from "deadline-ctx";

// Give the whole operation 1000ms from now.
const root = new DeadlineCtx(1000);

function doWork(ctx) {
  ctx.check(); // throws DeadlineError if expired
  // Slice out 200ms for this step.
  const step = ctx.child(200);
  return runSubStep(step);
}

function runSubStep(ctx) {
  ctx.check("sub-step deadline expired");
  // ... work ...
}
```

For deterministic tests, pass a clock function and a duration:

```js
let now = 0;
const clock = () => now;
const ctx = new DeadlineCtx(clock, { duration: 500 });
now += 200;
ctx.remaining(); // 300
```

## Why this exists

Long operations composed of nested steps often need a single shared deadline: an outer caller sets the budget, and every inner step must respect the same wall-clock endpoint. Re-threading a `deadline` number through every function signature is noisy, and storing it in module globals breaks under concurrency.

This library keeps the model small on purpose: one `DeadlineCtx` object per call frame, one absolute deadline per object. Children compute the earlier of "my own budget" and "my parent's deadline", which means a buggy inner step asking for more time than its parent has simply inherits the parent's deadline — it cannot widen the budget. That is the deliberate trade-off: tighter and safer than per-step budgets, at the cost of losing the ability for a child to declare a genuinely larger budget than its parent.

## The awkward edge

`remaining()` returns a signed number and goes **negative** after the deadline passes. `isExpired()` treats any non-positive remaining as expired, so a deadline that lands exactly at `0` is already expired. This matches the semantics of `check()` and makes the boundary deterministic rather than a coin flip at `remaining === 0`.

`child()` accepts any non-negative finite `budgetMs`, including `0`, which yields an already-expired context. That is occasionally useful for "try this step only if there is any budget left at all" checks done out of band, but if you pass `0` by accident the child will fail its first `check()`.

## Exports

- `DeadlineCtx` — the context class.
- `DeadlineError` — thrown by `check()` and by invalid constructor/`child()` arguments.

Constructor: `new DeadlineCtx(deadlineOrClock?, opts?)`
- `new DeadlineCtx(durationMs)` — uses the default clock (`Date.now`).
- `new DeadlineCtx(clock, { duration })` — uses the supplied clock function.
- `new DeadlineCtx(undefined, { clock, duration })` — explicit options form.

Methods: `deadline` (getter), `remaining()`, `isExpired()`, `check(message?)`, `child(budgetMs)`.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Contributing

Issues and pull requests are welcome. Please keep the dependency list empty —
that constraint is the point of the project, not an oversight.

