import test from "node:test";
import assert from "node:assert/strict";
import { freeUsageReturnPath, freeUsageResetLabel, parseFreeUsageLimit } from "../app/lib/free-usage.mjs";
import { translateUi } from "../app/lib/ui-locale.mjs";

test("quota accepts only integer limits within server-supplied bounds, including pause zero", () => {
  for (const [input, expected] of [["0", 0], ["5", 5], ["100", 100], ["101", null], ["-1", null], ["1.5", null], ["1e1", null], ["", null], [" ", null], ["Infinity", null], [" 5", null], ["9007199254740992", null]]) assert.equal(parseFreeUsageLimit(input, 100), expected, input);
  assert.equal(parseFreeUsageLimit("5", 4), null);
  assert.equal(parseFreeUsageLimit("5", undefined), null);
});

test("quota return links allow only project workflow routes", () => {
  for (const step of ["agent", "intake", "quote", "outcome"]) {
    const path = `/workspace/projects/project-1/${step}`;
    assert.equal(freeUsageReturnPath(path), path);
  }
  for (const path of [null, "//attacker.test", "https://attacker.test", "javascript:alert(1)", "/workspace/projects/../admin", "/workspace/projects/x/agent?returnTo=bad", "/workspace/projects/x%2fy/agent", "/admin"]) assert.equal(freeUsageReturnPath(path), null);
});

test("reset date is rendered in Seoul, independently of browser timezone", () => {
  assert.match(freeUsageResetLabel("2026-10-31T15:00:00Z", "en"), /Nov 1, 2026.*00:00/);
  assert.equal(freeUsageResetLabel("garbage", "ko"), null);
  assert.equal(freeUsageResetLabel(null, "en"), null);
});

test("quota headline and counters are explicitly localized", () => {
  assert.equal(translateUi("더 이용하려면 API를 등록하세요!", "ko"), "더 이용하려면 API를 등록하세요!");
  assert.equal(translateUi("더 이용하려면 API를 등록하세요!", "en"), "Register an API key to keep going!");
  assert.equal(translateUi("사용 {used} / 월 {limit}회", "en", {used: 4, limit: 5}), "Used 4 / 5 this month");
});
