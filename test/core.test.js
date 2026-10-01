import { test } from "node:test";
import assert from "node:assert/strict";

import { DeadlineCtx, DeadlineError } from "../src/core.js";

// Deterministic clock factory: a clock whose `now` advances only
// when the test explicitly calls `tick(ms)`.
function makeClock(start = 0) {
  let now = start;
  return {
    tick(ms) { now += ms; },
    set(v) { now = v; },
    get value() { return now; },
    clock: () => now,
  };
}

test("DeadlineCtx computes deadline relative to supplied clock", () => {
  const c = makeClock(1000);
  const ctx = new DeadlineCtx(c.clock, { duration: 500 });
  assert.equal(ctx.deadline, 1500);
  assert.equal(ctx.remaining(), 500);
  assert.equal(ctx.isExpired(), false);
});

test("DeadlineCtx accepts a bare duration with the default clock path", () => {
  const c = makeClock(10);
  const ctx = new DeadlineCtx(20, { clock: c.clock });
  assert.equal(ctx.deadline, 30);
  assert.equal(ctx.remaining(), 20);
});

test("remaining() decreases as the clock advances and goes negative", () => {
  const c = makeClock(0);
  const ctx = new DeadlineCtx(c.clock, { duration: 100 });
  assert.equal(ctx.remaining(), 100);
  c.tick(40);
  assert.equal(ctx.remaining(), 60);
  c.tick(60);
  assert.equal(ctx.remaining(), 0);
  assert.equal(ctx.isExpired(), true);
  c.tick(5);
  assert.equal(ctx.remaining(), -5);
  assert.equal(ctx.isExpired(), true);
});

test("check() throws DeadlineError when expired", () => {
  const c = makeClock(0);
  const ctx = new DeadlineCtx(c.clock, { duration: 10 });
  c.tick(10);
  assert.equal(ctx.isExpired(), true);
  assert.throws(() => ctx.check(), (e) => {
    assert.ok(e instanceof DeadlineError);
    assert.equal(e.name, "DeadlineError");
    assert.equal(e.remaining, 0);
    assert.match(e.message, /expired/);
    return true;
  });
});

test("check() does not throw when there is budget left", () => {
  const c = makeClock(0);
  const ctx = new DeadlineCtx(c.clock, { duration: 100 });
  c.tick(10);
  ctx.check("still alive"); // should not throw
  assert.equal(ctx.remaining(), 90);
});

test("check() uses the provided message", () => {
  const c = makeClock(0);
  const ctx = new DeadlineCtx(c.clock, { duration: 0 });
  assert.throws(() => ctx.check("custom message"), (e) => {
    assert.equal(e.message, "custom message");
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("child() does not exceed parent deadline even when budget is larger", () => {
  const c = makeClock(0);
  const parent = new DeadlineCtx(c.clock, { duration: 100 });
  const child = parent.child(1000);
  assert.equal(child.deadline, 100); // clamped to parent
  assert.equal(child.remaining(), 100);
});

test("child() can shrink the deadline when budget is smaller", () => {
  const c = makeClock(0);
  const parent = new DeadlineCtx(c.clock, { duration: 100 });
  c.tick(10); // parent has 90 left
  const child = parent.child(20);
  assert.equal(child.deadline, 30); // 10 (now) + 20
  assert.equal(child.remaining(), 20);
});

test("child() with zero budget yields an immediately-expired context", () => {
  const c = makeClock(0);
  const parent = new DeadlineCtx(c.clock, { duration: 100 });
  const child = parent.child(0);
  assert.equal(child.deadline, 0);
  assert.equal(child.remaining(), 0);
  assert.equal(child.isExpired(), true);
});

test("child() shares the same clock as the parent", () => {
  const c = makeClock(0);
  const parent = new DeadlineCtx(c.clock, { duration: 100 });
  const child = parent.child(50);
  c.tick(30);
  assert.equal(parent.remaining(), 70);
  assert.equal(child.remaining(), 20);
});

test("constructor throws DeadlineError when duration is negative", () => {
  const c = makeClock(0);
  assert.throws(() => new DeadlineCtx(c.clock, { duration: -1 }), (e) => {
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("constructor throws DeadlineError when duration is not finite", () => {
  const c = makeClock(0);
  assert.throws(() => new DeadlineCtx(c.clock, { duration: Infinity }), (e) => {
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("constructor throws DeadlineError when clock is given without duration", () => {
  const c = makeClock(0);
  assert.throws(() => new DeadlineCtx(c.clock), (e) => {
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("constructor throws DeadlineError when no arguments are given", () => {
  assert.throws(() => new DeadlineCtx(), (e) => {
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("constructor throws DeadlineError when first arg is an unexpected type", () => {
  assert.throws(() => new DeadlineCtx("100"), (e) => {
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("child() throws DeadlineError when budget is negative", () => {
  const c = makeClock(0);
  const parent = new DeadlineCtx(c.clock, { duration: 100 });
  assert.throws(() => parent.child(-1), (e) => {
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("child() throws DeadlineError when budget is not finite", () => {
  const c = makeClock(0);
  const parent = new DeadlineCtx(c.clock, { duration: 100 });
  assert.throws(() => parent.child(Infinity), (e) => {
    assert.ok(e instanceof DeadlineError);
    return true;
  });
});

test("nested children transitively clamp to the root deadline", () => {
  const c = makeClock(0);
  const root = new DeadlineCtx(c.clock, { duration: 100 });
  const a = root.child(1000); // clamped to 100
  c.tick(20); // now=20
  const b = a.child(50);     // 20+50=70 < root(100)
  assert.equal(b.deadline, 70);
  const d = a.child(1000);   // 20+1000=1020 > root(100)
  assert.equal(d.deadline, 100);
});

test("default-clock path is constructed with a numeric duration", () => {
  // We don't assert on Date.now directly; we just verify the object
  // shape so that the default-clock constructor branch is exercised.
  const ctx = new DeadlineCtx(1000);
  assert.equal(typeof ctx.deadline, "number");
  assert.equal(typeof ctx.remaining(), "number");
  assert.equal(typeof ctx.isExpired(), "boolean");
});
