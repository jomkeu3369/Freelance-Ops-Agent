import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, declarations]) => ({ selector: selector.trim(), declarations }));

test("project identity and permitted actions use one heading on every step", async () => {
  const source = await read("../features/workspace/project/project-workbench.tsx");
  assert.match(source, /<div className="project-heading">/);
  assert.doesNotMatch(source, /chat-project-heading/);
  const heading = source.slice(source.indexOf('<div className="project-heading">'), source.indexOf("{showDeleteConfirmation &&"));
  assert.match(heading, /className="project-status"/);
  assert.match(heading, /<h1>\{project.title\}<\/h1>/);
  assert.match(heading, /projectClientLabel\(project, clients, t\)/);
  assert.match(heading, /permissions.has\("project.write"\)/);
  assert.match(heading, /permissions.has\("project.delete"\)/);
  assert.doesNotMatch(heading, /activeStep/);
  assert.match(source, /aria-current=\{activeStep === id \? "step" : undefined\}/);
});

test("chat CSS preserves shared project heading and numbered tab presentation", async () => {
  const [chat, shared] = await Promise.all([
    read("../features/workspace/fullscreen-chat.css"),
    read("../features/workspace/professional-workspace.css"),
  ]);
  for (const rule of rules(chat)) {
    if (/\.is-chat\b/.test(rule.selector) && /\.(?:chat-project-heading|project-heading)\b/.test(rule.selector)) {
      assert.doesNotMatch(rule.declarations, /(?:clip-path\s*:|display\s*:\s*none|position\s*:\s*absolute|(?:width|height)\s*:\s*1px)/, rule.selector);
    }
    if (/\.is-chat\b/.test(rule.selector) && /\.workbench-steps\b/.test(rule.selector)) {
      // 줄어들지 않는 flex 항목은 구조이며 모양은 공통 스타일에서 정한다.
      // 휴대폰 줄바꿈과 단계 번호 표시도 공통 스타일에 포함한다.
      assert.doesNotMatch(rule.declarations, /(?:^|;)\s*(?:display|flex-wrap|flex-basis|gap|padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|font(?:-[\w-]+)?|border(?:-[\w-]+)?|background(?:-[\w-]+)?|min-height)\s*:/, rule.selector);
    }
  }
  const numberRule = rules(shared).find(rule => rule.selector === ".figma-workspace .workbench-steps button span");
  assert.ok(numberRule, "Number visibility is owned by the shared default tab rule");
  assert.match(numberRule.declarations, /display\s*:\s*inline\b/);
  assert.match(shared, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.workbench-steps button\s*\{[^}]*flex-basis:\s*calc\(50% - 4px\)/);
});

test("conversation retains shared gutters and has a scrollable fallback rather than clipped controls", async () => {
  const chat = await read("../features/workspace/fullscreen-chat.css");
  const mainRules = rules(chat).filter(rule => /\.conversation-workspace\s+\.workspace-main\b/.test(rule.selector));
  assert.ok(mainRules.some(rule => /overflow-y\s*:\s*auto/.test(rule.declarations)));
  for (const rule of mainRules) {
    assert.doesNotMatch(rule.declarations, /(?:^|;)\s*(?:max-width|padding(?:-[\w-]+)?)\s*:/, "Chat must inherit the common workspace gutters");
  }
  const chatRule = rules(chat).find(rule => rule.selector === ".figma-workspace .is-chat .agent-chat");
  assert.ok(chatRule);
  assert.ok(Number(chatRule.declarations.match(/min-height:\s*(\d+)px/)?.[1]) >= 200, "Reserve a usable conversation body beneath the full heading");
  assert.match(chat, /safe-area-inset-bottom/);
  assert.doesNotMatch(chat, /\.conversation-workspace\s*\{[^}]*--workspace-header-height\s*:/);
});

test("project route transitions reset inner main scroll without discarding pipeline restoration", async () => {
  const shell = await read("../features/workspace/workspace-shell.tsx");
  const effects = [...shell.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g)];
  const routeReset = effects.find(([, body, dependencies]) =>
    /workspaceContent\.current(?:\?\.)?\.?scroll(?:To|Top)/.test(body)
    && (/\bpathname\b/.test(dependencies) || (/\bprojectStep\b/.test(dependencies) && /\bselectedProjectId\b/.test(dependencies))));
  assert.ok(routeReset, "Inner scroll reset must observe project/step routes, including browser history");
  assert.match(routeReset[1], /(?:top:\s*0|scrollTop\s*=\s*0)/);
  assert.match(shell, /restorePipelinePosition\(\)/);
  assert.match(shell, /window.scrollTo\(\{ top: scrollY, behavior: "instant" \}\)/);
});


test("an empty narrow conversation does not scroll past its welcome message", async () => {
  const chat = await read("../features/workspace/project/analysis/agent-chat.tsx");
  assert.match(chat, /const hasConversation = timeline.length > 0/);
  assert.match(chat, /if \(!box \|\| !hasConversation\) return;/);
  assert.match(chat, /if \(!body \|\| !hasConversation\) return;/);
  assert.match(chat, /\[updateSignature, hasConversation\]/);
  assert.match(chat, /observer.disconnect\(\);\s*\}, \[hasConversation\]/);
});
