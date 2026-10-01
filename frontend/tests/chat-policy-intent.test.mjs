import test from "node:test";
import assert from "node:assert/strict";
import { parseChatPolicyIntent } from "../app/lib/chat-policy-intent.mjs";

test("explicit Korean settings sentence becomes typed percentages", () => {
  assert.deepEqual(parseChatPolicyIntent("기본 세율 10%, 위험 버퍼 15%, 최대 할인 20%로 변경"), {
    valid: true,
    values: { defaultTaxRate: .1, defaultRiskBufferRate: .15, maximumDiscountRate: .2 },
  });
});

test("English settings sentence and partial update", () => {
  assert.deepEqual(parseChatPolicyIntent("pricing settings: tax rate 8.5%"), {
    valid: true,
    values: { defaultTaxRate: .085 },
  });
});

test("ordinary requests preserve their original text for agent runs", () => {
  assert.equal(parseChatPolicyIntent("이 프로젝트의 견적 초안을 검토해 줘"), null);
  assert.equal(parseChatPolicyIntent("Review the project requirements"), null);
});

test("ambiguous or out-of-range settings requests cannot produce a proposal", () => {
  assert.deepEqual(parseChatPolicyIntent("견적 설정 바꿔줘"), { valid: false, values: {} });
  assert.deepEqual(parseChatPolicyIntent("기본 세율 110%"), { valid: false, values: {} });
});
