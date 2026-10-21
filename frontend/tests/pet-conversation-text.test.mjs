import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {conversationText} from "../features/workspace/pets/pet-conversation-text.mjs";

for (const sample of JSON.parse(readFileSync(new URL("../../contracts/fixtures/pet-conversation-text.json",import.meta.url),"utf8"))) {
  test(`legacy pet prices are excluded without losing effort: ${sample.text}`,()=>{
    assert.equal(conversationText(sample.text),sample.expected);
  });
}
