import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../features/workspace/auth/auth.css", import.meta.url), "utf8");

function rules(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(match => match[1]);
}

function declaration(rule, property) {
  const value = rule.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`))?.[1]?.trim();
  assert.ok(value, `Missing ${property} in ${rule}`);
  return value;
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map(value => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + .05) / (values[0] + .05);
}

test("auth placeholders preserve full-opacity normal-text contrast in both themes", () => {
  const placeholder = rules(".auth-page .auth-panel input::placeholder");
  assert.equal(placeholder.length, 1);
  assert.equal(declaration(placeholder[0], "opacity"), "1");
  assert.equal(declaration(placeholder[0], "color"), "var(--muted)");
  assert.equal(declaration(rules(".auth-page .auth-panel input")[0], "background"), "var(--bg)");
  for (const selector of [".auth-page", '[data-theme="dark"] .auth-page']) {
    const theme = rules(selector)[0];
    const ratio = contrast(declaration(theme, "--muted"), declaration(theme, "--bg"));
    assert.ok(ratio >= 4.5, `${selector} placeholder contrast is ${ratio.toFixed(2)}:1`);
  }
});

test("auth companion roles and assurance retain readable wrapping text at every breakpoint", () => {
  for (const selector of [".auth-page .auth-companion > span", ".auth-page .auth-assurance"]) {
    const matchingRules = rules(selector);
    assert.ok(matchingRules.length > 0);
    assert.ok(Number.parseFloat(declaration(matchingRules[0], "font-size")) >= 13, selector);
    assert.ok(Number.parseFloat(declaration(matchingRules[0], "line-height")) >= 1.5, selector);
    assert.equal(declaration(matchingRules[0], "white-space"), "normal");
    assert.equal(declaration(matchingRules[0], "overflow-wrap"), "anywhere");
    for (const rule of matchingRules) {
      for (const size of rule.matchAll(/font-size:\s*([\d.]+)px/g)) assert.ok(Number(size[1]) >= 13, selector);
      assert.doesNotMatch(rule, /white-space:\s*nowrap|text-overflow:\s*ellipsis/);
    }
  }
  assert.equal(declaration(rules(".auth-page .auth-companion > span")[0], "max-width"), "100%");
  assert.equal(declaration(rules(".auth-page .auth-companion > span")[0], "word-break"), "keep-all");
});

test("small auth screens give translated companion roles more room without shrinking text", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 400px)"), css.indexOf("@media (max-width: 340px)"));
  assert.equal(declaration(rules(".auth-page .auth-message", mobile)[0], "padding"), "28px 20px");
  assert.equal(declaration(rules(".auth-page .auth-companions", mobile)[0], "gap"), "8px");
  assert.equal(declaration(rules(".auth-page .auth-companion", mobile)[0], "padding"), "15px 6px");
  assert.equal(declaration(rules(".auth-page .auth-companions")[0], "grid-template-columns"), "repeat(3, minmax(0, 1fr))");
  assert.equal(declaration(rules(".auth-page .auth-companion")[0], "min-width"), "0");
});
