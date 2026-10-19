import { createApiFixture } from "../scripts/lib/typescript-fixture.mjs";
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

const originalFetch = globalThis.fetch;
let fixtureRuntime;
let api;

before(async () => {
  fixtureRuntime = await createApiFixture();
  api = fixtureRuntime.api;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(async () => {
  await fixtureRuntime?.cleanup();
});

for (const status of [200, 204]) {
  test(`펫 선택과 삭제는 본문이 없는 ${status} 응답도 성공으로 처리한다`, async () => {
    const session = { workspaceId: "workspace-one", accessToken: "synthetic-token" };
    const pet = { id: "pet-one", revision: 3 };
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push(new Request(url, init));
      return new Response(null, { status });
    };

    assert.equal(await api.changeAgentPet(session, pet, "SELECT"), undefined);
    assert.equal(await api.deleteAgentPet(session, pet), undefined);
    assert.deepEqual(requests.map(request => request.method), ["PATCH", "DELETE"]);
    assert.deepEqual(await requests[0].json(), { action: "SELECT", expectedRevision: 3 });
    assert.equal(new URL(requests[1].url).searchParams.get("revision"), "3");
  });
}

test("성공 응답에 JSON이 있으면 객체와 null 값을 그대로 반환한다", async () => {
  for (const value of [{ id: "pet-one" }, null]) {
    globalThis.fetch = async () => Response.json(value);
    assert.deepEqual(await api.request("/api/v2/test-response"), value);
  }
});

test("성공 상태여도 잘못된 JSON 본문은 오류로 남긴다", async () => {
  globalThis.fetch = async () => new Response("{invalid", { status: 200 });
  await assert.rejects(api.request("/api/v2/test-response"), SyntaxError);
});

test("본문이 없는 실패 응답을 성공으로 처리하지 않는다", async () => {
  globalThis.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(api.request("/api/v2/test-response"), error => error instanceof api.ApiError && error.status === 403);
});
