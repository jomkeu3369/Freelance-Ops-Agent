import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const source = await readFile(new URL("../features/workspace/shared/chat-markdown.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
const exports = {};
const modules = { react: React, "react/jsx-runtime": jsx, "react-markdown": { __esModule: true, default: Markdown }, "remark-gfm": { __esModule: true, default: remarkGfm }, "./chat-markdown.css": {} };
// No browser globals: the actual renderer must remain safe during SSR.
vm.runInNewContext(outputText, { exports, URL, require: name => { assert.ok(name in modules, name); return modules[name]; } });
const render = (children, locale = "en") => renderToStaticMarkup(React.createElement(exports.ChatMarkdown, { locale }, children));

test("renders CommonMark and GFM structures using React, with local code/table scroll regions", () => {
  const html = render("# 프로젝트\n\n**Strong** and *emphasis*, ~~old~~, `inline`\n\n- first\n  - nested\n\n1. ordered\n\n> quote\n\n| Key | 값 |\n| --- | --- |\n| scope | Website |\n\n```ts\nconst x = '<script>';\n```\n\n[Docs](https://example.com/docs)");
  for (const tag of ["h1", "strong", "em", "del", "code", "ul", "ol", "blockquote", "table", "thead", "tbody", "pre"]) assert.match(html, new RegExp(`<${tag}(?:\\s|>)`), tag);
  assert.match(html, /chat-markdown-table[^>]*tabindex="0"[^>]*role="region"/);
  assert.match(html, /<pre tabindex="0" role="region"/);
  assert.match(html, /Copy code/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});

test("blocks HTML, handlers, frames and automatic remote image requests without losing image alt text", () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://evil.invalid/x" onerror="alert(1)">\n\n<iframe src="https://evil.invalid"></iframe>\n\n![preview](https://evil.invalid/track.png)\n\n<svg onload="alert(1)"></svg>');
  assert.doesNotMatch(html, /<(?:script|img|iframe|svg)\b|onerror=|onload=|src=/i);
  assert.match(html, /Image: preview/);
});

test("unsafe and obfuscated links never become navigable", () => {
  for (const url of ["javascript:alert%281%29", "JaVaScRiPt:alert%281%29", "jav&#x61;script:alert%281%29", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox%281%29", "file:///etc/passwd", "//evil.invalid", "https://user:password@example.com", "javascript%3Aalert%281%29"]) {
    assert.doesNotMatch(render(`[unsafe](${url})`), /<a\b/, url);
  }
  for (const url of ["javascript:\nalert(1)", "https:\\evil.invalid", "\u0000https://example.com", "/\\evil.invalid"]) assert.equal(exports.safeMarkdownUrl(url), "", url);
  for (const url of ["https://example.com/a", "http://example.com", "mailto:hello@example.com", "/workspace/projects", "#section"]) assert.equal(exports.safeMarkdownUrl(url), url);
});

test("every partial streaming prefix renders, with open fences kept as escaped code", () => {
  const markdown = "## 요약\n\n**Streaming English 한글**\n\n| Task | 상태 |\n| --- | --- |\n| API | done |\n\n```html\n<img src=x onerror=alert(1)>\n</script>\n```\n\n[link](https://example.com)";
  for (let length = 0; length <= markdown.length; length++) assert.doesNotThrow(() => render(markdown.slice(0, length)), String(length));
  const partial = render("```html\n<img src=x onerror=alert(1)>");
  assert.match(partial, /<pre\b/);
  assert.match(partial, /&lt;img/);
  assert.doesNotMatch(partial, /<img\b/);
});

test("SSR localizes controls and preserves code whitespace, even without a fence language", () => {
  const markdown = "```\n  한글\n\n\tEnglish\n```";
  assert.match(render(markdown, "ko"), /코드 복사/);
  assert.match(render(markdown, "en"), /Copy code/);
  assert.match(render(markdown), / {2}한글\n\n\tEnglish\n<\/code>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|rehypeRaw|rehype-raw/);
});
