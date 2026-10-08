import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { translateUi } from "../app/lib/ui-locale.mjs";

// Render actual controls without network, a browser or an added DOM dependency.
const directory = await mkdtemp(join(tmpdir(), "feature-controls-"));
after(async () => { delete globalThis.__featureControlLocale; await rm(directory, { recursive: true, force: true }); });
async function compile(path, name, replace = source => source) {
  const source = replace(await readFile(new URL(path, import.meta.url), "utf8"));
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  for (const moduleName of ["react", "react/jsx-runtime", "@phosphor-icons/react"]) outputText = outputText.replaceAll(`from "${moduleName}"`, `from ${JSON.stringify(import.meta.resolve(moduleName))}`);
  await writeFile(join(directory, `${name}.mjs`), outputText);
  return import(pathToFileURL(join(directory, `${name}.mjs`)));
}
await writeFile(join(directory, "locale.mjs"), `import { translateUi } from ${JSON.stringify(new URL("../app/lib/ui-locale.mjs", import.meta.url).href)}; export const useUiLocale = () => globalThis.__featureControlLocale ?? "ko"; export const useT = () => (source, values) => translateUi(source, useUiLocale(), values);`);
const skillPath = "../features/workspace/skills/";
const catalog = JSON.parse(await readFile(new URL(`${skillPath}catalog.json`, import.meta.url)));
const rules = JSON.parse(await readFile(new URL(`${skillPath}routing.json`, import.meta.url)));
const categories = JSON.parse(await readFile(new URL(`${skillPath}categories.json`, import.meta.url)));
await compile(`${skillPath}skill-selection.ts`, "selection", source => source.replace('import catalog from "./catalog.json";', `const catalog = ${JSON.stringify(catalog)};`).replace('import rules from "./routing.json";', `const rules = ${JSON.stringify(rules)};`));
const { SkillSelector, SkillNames } = await compile(`${skillPath}skill-selector.tsx`, "selector", source => source.replace('"../../../app/lib/ui-language"', '"./locale.mjs"').replace('"./skill-selection"', '"./selection.mjs"').replace('import "./skills.css";', "").replace('import categories from "./categories.json";', `const categories = ${JSON.stringify(categories)};`));
await compile("../features/workspace/project/analysis/attachment-draft.ts", "attachment-draft");
const { ChatAttachmentButton, ChatAttachments } = await compile("../features/workspace/project/analysis/chat-attachments.tsx", "attachments", source => source.replace('"../../../../app/lib/ui-language"', '"./locale.mjs"').replace(/import \{[^\n]+\} from "\.\.\/\.\.\/\.\.\/\.\.\/app\/lib\/api";/, 'const readChatAttachment = () => { throw new Error("No network in rendering tests"); }; const removeChatAttachment = readChatAttachment;').replace('"./attachment-draft"', '"./attachment-draft.mjs"').replace('import "./chat-attachments.css";', ""));
const selection = (patch = {}) => ({ mode: "AUTO", manualIds: [], excludedIds: [], catalogVersion: "1.0.0", ...patch });
const render = (component, props, locale = "en") => { globalThis.__featureControlLocale = locale; return renderToStaticMarkup(createElement(component, props)); };
const noop = () => {};

test("skill controls render all 60 localized choices and disclose execution cost", () => {
  for (const locale of ["ko", "en"]) {
    const markup = render(SkillSelector, { draft: "Prepare a proposal", value: selection(), onChange: noop, disabled: false }, locale);
    assert.equal((markup.match(/<strong>/g) ?? []).length, 60);
    assert.match(markup, locale === "en" ? /AI execution uses actual API cost and your weekly limit/ : /AI 실행은 실제 API 비용과 주간 한도를 사용/);
    if (locale === "en") assert.doesNotMatch(markup, /[가-힣]/);
    else assert.match(markup, /<small>무료<\/small>/);
  }
});
test("manual-empty stays visible and a full selection disables only unselected skills", () => {
  const empty = render(SkillSelector, { draft: "Prepare a proposal", value: selection({ mode: "MANUAL" }), onChange: noop, disabled: false });
  assert.match(empty, /General assistance, no skill selected/);
  const chosen = catalog.skills.slice(0, 3).map(skill => skill.id);
  const markup = render(SkillSelector, { draft: "Prepare a proposal", value: selection({ mode: "MANUAL", manualIds: chosen }), onChange: noop, disabled: false });
  assert.equal((markup.match(/disabled="" aria-pressed="false"/g) ?? []).length, 57);
  assert.match(markup, /Manual \(3\)/);
});
test("stage notice explicitly says the deferred workflows were not loaded", async () => {
  const { cases } = JSON.parse(await readFile(new URL("../../agent/resources/builtin-skills/acceptance-cases.json", import.meta.url)));
  const markup = render(SkillSelector, { draft: cases.find(value => value.kind === "staging").prompt, value: selection(), onChange: noop, disabled: false });
  assert.match(markup, /Next stage needed:/); assert.match(markup, /These workflows are not loaded in this run/); assert.match(markup, /Milestone/);
});
test("history names render snapshot IDs independently of an empty new composer choice", () => {
  const saved = ["writing-proposal", "dev-bug-triage"];
  const before = render(SkillNames, { ids: saved });
  render(SkillSelector, { draft: "unrelated", value: selection({ mode: "MANUAL" }), onChange: noop, disabled: false });
  assert.equal(render(SkillNames, { ids: saved }), before); assert.match(before, /Proposal/); assert.match(before, /Bug/);
});
test("partial OCR controls localize UI while preserving source text and requiring review", () => {
  const state = { items: [{ key: "file", file: { name: "사용자-원문.png", size: 100 }, encoding: "auto", delimiter: "auto", preview: { id: "attachment-one", extraction: { status: "PARTIAL", text: "로그인 사용자 원문", units: 1, encoding: null, notice: "" } } }], reviewOpen: true, setReviewOpen: noop, reading: false, error: "", confirmed: false, ready: true, tooLarge: false, add: noop, remove: noop, options: noop, setConfirmed: noop, cancel: noop };
  const markup = render(ChatAttachments, { state, disabled: false });
  const picker = render(ChatAttachmentButton, { state, disabled: false });
  assert.match(picker, /Choose attachments/); assert.match(picker, /aria-label="Attach files"/);
  assert.match(markup, /Partially read/); assert.doesNotMatch(markup, /image and motion interpretation is unsupported/);
  assert.match(markup, /I reviewed the coverage, omissions and unsupported content/); assert.match(markup, /사용자-원문.png/); assert.match(markup, /로그인 사용자 원문/);
  assert.doesNotMatch(markup, /Text was extracted without truncation|checked=""/);
  assert.match(render(ChatAttachments, { state: { ...state, error: "파일은 1바이트 이상, 2 MiB 이하여야 합니다." }, disabled: false }), /Each file must be at least 1 byte/);
});
test("dynamic pet and attachment labels have English copy, with no unmarked Korean JSX", async () => {
  for (const path of ["../features/workspace/pets/pet-customizer.tsx", "../features/workspace/pets/pet-login-demo.tsx", "../features/workspace/pets/pet-profile.ts", "../features/workspace/pets/pet-workspace.tsx", "../features/workspace/project/analysis/chat-attachments.tsx", "../features/workspace/project/analysis/attachment-draft.ts"]) {
    const source = ts.createSourceFile(path, await readFile(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isStringLiteral(node) && /[가-힣]/.test(node.text)) assert.doesNotMatch(translateUi(node.text, "en"), /[가-힣]/, `${path}: ${node.text}`);
      if (ts.isJsxText(node) && /[가-힣]/.test(node.text)) assert.fail(`Unlocalized JSX in ${path}: ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});


test("fresh attachments render a compact named card without hidden review controls or promises", () => {
  const state = { items: [{ key: "file", file: { name: "long-synthetic-document.pdf", size: 100 }, encoding: "auto", delimiter: "auto" }], reading: false, reviewOpen: false, error: "", confirmed: false };
  const markup = render(ChatAttachments, { state, disabled: false });
  assert.match(markup, /View details for long-synthetic-document.pdf/);
  assert.match(markup, /aria-label="Remove long-synthetic-document.pdf"/);
  assert.match(markup, /attachment-file-icon pdf/);
  assert.doesNotMatch(markup, /<select|<input|chat-attachment-review|Text was extracted|Reviewed/);
  assert.match(markup, /Not read yet/);
});
