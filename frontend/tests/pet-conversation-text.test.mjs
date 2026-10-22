import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {conversationReplyText,conversationText} from "../features/workspace/pets/pet-conversation-text.mjs";

for (const sample of JSON.parse(readFileSync(new URL("../../contracts/fixtures/pet-conversation-text.json",import.meta.url),"utf8"))) {
  test(`legacy pet prices are excluded without losing effort: ${sample.text}`,()=>{
    assert.equal(conversationText(sample.text),sample.expected);
  });
}

for (const sample of JSON.parse(readFileSync(new URL("../../contracts/fixtures/pet-conversation-replies.json",import.meta.url),"utf8"))) {
  test(`pet reply addresses match the actual recipient without changing the body: ${sample.text}`,()=>{
    const text=conversationReplyText(sample.text,sample.recipient,sample.names);
    assert.equal(text,sample.expected);
    assert.equal(conversationReplyText(text,sample.recipient,sample.names),text);
  });
}

test("reply normalization escapes every name metacharacter and keeps body markdown",()=>{
  const names=["A[1](x)*","누리"];
  assert.equal(conversationReplyText("A[1](x)*님: **누리의 제안**은 유지하자.","누리",names),"누리, **누리의 제안**은 유지하자.");
  assert.equal(conversationReplyText("A11x님: 원문은 바꾸지 말자.","누리",names),"누리, A11x님: 원문은 바꾸지 말자.");
});

test("a known recipient remains idempotent without a separately supplied name list",()=>{
  const text=conversationReplyText("입력값은 유지하자.","일원",[]);
  assert.equal(text,"일원, 입력값은 유지하자.");
  assert.equal(conversationReplyText(text,"일원",[]),text);
  assert.equal(conversationReplyText("일원님! 총액 300만원이야.","일원",[]),"");
});
