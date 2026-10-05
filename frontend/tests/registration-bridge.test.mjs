import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const auth = await readFile(new URL("../features/workspace/auth/auth-gate.tsx", import.meta.url), "utf8");

test("signup requires explicit age confirmation before any registration request", () => {
  assert.match(auth, /const ageAtLeast14 = data\.get\("ageAtLeast14"\) === "true"/);
  const guard = auth.indexOf('if (mode === "register" && !ageAtLeast14)');
  assert.ok(guard > 0 && guard < auth.indexOf("await register("));
  assert.match(auth.slice(guard, auth.indexOf("setBusy(true)", guard)), /namedItem\("ageAtLeast14"\).*\?\.focus\(\);\s*return;/);
  const input = auth.match(/<input\s+id="auth-age-at-least-14"[\s\S]*?\/>/)?.[0];
  assert.ok(input);
  assert.match(input, /type="checkbox"/);
  assert.match(input, /\srequired\s/);
  assert.doesNotMatch(input, /defaultChecked|\schecked=/);
  assert.match(input, /aria-invalid=/);
  assert.match(input, /aria-describedby=/);
  assert.match(auth, /<label htmlFor="auth-age-at-least-14">/);
  assert.match(auth, /id="auth-age-error" className="form-error" role="alert"/);
  assert.doesNotMatch(auth, /name="(?:dateOfBirth|birthDate|birthday|identityDocument)"/);
});
