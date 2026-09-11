import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspacePath, parseWorkspacePath, parseWorkspaceLocation } from "../app/lib/workspace-navigation.mjs";

test("each menu has an independently reloadable workspace address", () => {
  const menus = { pipeline: "projects", clients: "clients", knowledge: "knowledge", settings: "settings" };
  for (const [view, folder] of Object.entries(menus)) {
    assert.equal(buildWorkspacePath({ view }), `/workspace/${folder}`);
    assert.deepEqual(parseWorkspacePath(`/workspace/${folder}`), { view });
  }
});

test("project links preserve the project and every workbench step", () => {
  for (const step of ["intake", "agent", "quote", "outcome"]) {
    const location = { view: "project", projectId: "project / 한글", step };
    assert.deepEqual(parseWorkspacePath(buildWorkspacePath(location)), location);
  }
});

test("old query links resolve to the matching new address", () => {
  assert.equal(buildWorkspacePath(parseWorkspaceLocation("?view=clients")), "/workspace/clients");
  assert.equal(buildWorkspacePath(parseWorkspaceLocation("?view=project&project=id-7&step=quote")), "/workspace/projects/id-7/quote");
  assert.equal(buildWorkspacePath(parseWorkspaceLocation("?view=settings")), "/workspace/settings");
  assert.equal(buildWorkspacePath(parseWorkspaceLocation("")), "/workspace/projects");
});

test("invalid or incomplete links return a safe workspace destination", () => {
  assert.equal(buildWorkspacePath(parseWorkspaceLocation("?view=project")), "/workspace/projects");
  assert.deepEqual(parseWorkspacePath("/workspace/projects/id-7/missing"), { view: "project", projectId: "id-7", step: "intake" });
  assert.deepEqual(parseWorkspacePath("/workspace/projects/%broken/agent"), { view: "pipeline" });
  assert.equal(buildWorkspacePath({ view: "https://example.com" }), "/workspace/projects");
});

test("authentication preserves legacy project deep links before the server redirect renders", () => {
  const pendingUrl = new URL("http://localhost/workspace?view=project&project=id-7&step=quote");
  const afterLogin = parseWorkspacePath(pendingUrl.pathname, pendingUrl.search);
  assert.deepEqual(afterLogin, { view: "project", projectId: "id-7", step: "quote" });
  const canonicalPath = buildWorkspacePath(afterLogin);
  assert.equal(canonicalPath, "/workspace/projects/id-7/quote");
  assert.deepEqual(parseWorkspacePath(canonicalPath), afterLogin);
  assert.deepEqual(parseWorkspacePath("/workspace/", "?view=clients"), { view: "clients" });
});

test("canonical route paths take precedence over obsolete query parameters", () => {
  assert.deepEqual(parseWorkspacePath("/workspace/settings", "?view=clients"), { view: "settings" });
  assert.deepEqual(parseWorkspacePath("/workspace/projects/id-8/agent", "?view=project&project=id-7&step=quote"), {
    view: "project", projectId: "id-8", step: "agent"
  });
});
