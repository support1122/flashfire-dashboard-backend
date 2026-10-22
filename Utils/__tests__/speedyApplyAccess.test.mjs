// SpeedyApply access code rules: the code the team types, how it is compared,
// how long a session lasts, and the failed-login limiter.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_CODE_TTL_MS,
  generateAccessCode,
  normalizeAccessCode,
  accessCodesMatch,
  secretsMatch,
  sessionSeconds,
  createLoginLimiter,
} from "../speedyApplyAccess.js";

test("codes are 30 days, XXXX-XXXX, from an alphabet with no look-alikes", () => {
  assert.equal(ACCESS_CODE_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = generateAccessCode();
    assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    seen.add(c);
  }
  assert.equal(seen.size, 2000, "2000 codes should not collide");
});

test("typed codes ignore case, spaces and the dash", () => {
  assert.equal(normalizeAccessCode(" k7qm-4xzp "), "K7QM4XZP");
  assert.equal(normalizeAccessCode("K7QM 4XZP"), "K7QM4XZP");
  assert.equal(normalizeAccessCode("K7QM4XZ"), "");
  assert.equal(normalizeAccessCode(""), "");
  assert.equal(normalizeAccessCode(null), "");
  assert.ok(accessCodesMatch("k7qm4xzp", "K7QM-4XZP"));
  assert.ok(!accessCodesMatch("K7QM-4XZQ", "K7QM-4XZP"));
  assert.ok(!accessCodesMatch("", ""), "two empty codes never match");
});

test("secretsMatch compares exactly, any length", () => {
  assert.ok(secretsMatch("hunter2", "hunter2"));
  assert.ok(!secretsMatch("hunter2", "Hunter2"));
  assert.ok(!secretsMatch("hunter2", "hunter22"));
  assert.ok(!secretsMatch("", "x"));
});

test("a session lasts until its code expires, never less than a minute", () => {
  const now = Date.UTC(2026, 9, 22);
  assert.equal(sessionSeconds(new Date(now + 3600 * 1000), now), 3600);
  assert.equal(sessionSeconds(new Date(now + 5000), now), 60);
  assert.equal(sessionSeconds("not a date", now), 60);
});

test("the limiter blocks after max failures and forgets after the window", () => {
  const lim = createLoginLimiter({ max: 3, windowMs: 1000 });
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) {
    assert.equal(lim.check("a", t), 0);
    lim.fail("a", t);
  }
  assert.equal(lim.check("a", t + 100), 1);
  assert.equal(lim.check("b", t + 100), 0, "other keys are not affected");
  assert.equal(lim.check("a", t + 1001), 0, "the window slides");
  lim.fail("a", t + 1001);
  lim.reset("a");
  assert.equal(lim.check("a", t + 1002), 0);
});
