import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { api, account, installLiveGuards } from "./helpers/real-server.mjs";

installLiveGuards();

test("real tenant boundaries deny foreign customers, projects, pets and confirmed artifact paths", async ({ request }, testInfo) => {
  const owner = (await account(request)).session, intruder = (await account(request)).session;
  const ownerHeaders = { Authorization: `Bearer ${owner.accessToken}` }, intruderHeaders = { Authorization: `Bearer ${intruder.accessToken}` };
  const root = `${api}/api/v2/workspaces/${owner.workspaceId}`, foreign = `${api}/api/v2/workspaces/${intruder.workspaceId}`;
  const customer = await request.post(`${root}/clients`, { headers: ownerHeaders, data: { name: "격리 고객", companyName: "Synthetic", email: "tenant@example.invalid", phone: null, notes: "Synthetic only" } });
  expect(customer.status()).toBe(201); const client = await customer.json();
  const created = await request.post(`${root}/projects`, { headers: ownerHeaders, data: { clientId: client.id, title: "테넌트 격리", requirementText: "합성 고객 원문", currency: "KRW", deadline: null, budgetMin: null, budgetMax: null } });
  expect(created.status()).toBe(201); const project = await created.json();
  const composition = { id: randomUUID(), mutationId: randomUUID(), expectedRevision: 0, description: "친근한 일정 동료", resetPreferences: false };
  const petResponse = await request.post(`${root}/agent-pets`, { headers: ownerHeaders, data: composition });
  expect(petResponse.status()).toBe(200); const pet = await petResponse.json();
  const attempts = [];
  for (const target of [`${root}/clients`, `${root}/projects/${project.id}`, `${root}/agent-pets`, `${root}/projects/${project.id}/analysis-decisions`, `${root}/projects/${project.id}/specifications`, `${foreign}/projects/${project.id}`]) {
    const response = await request.get(target, { headers: intruderHeaders });
    expect([403, 404]).toContain(response.status()); attempts.push({ method: "GET", path: new URL(target).pathname, status: response.status() });
  }
  const collision = await request.post(`${foreign}/agent-pets`, { headers: intruderHeaders, data: composition });
  expect(collision.status()).toBe(409); attempts.push({ method: "POST", path: new URL(`${foreign}/agent-pets`).pathname, status: collision.status() });
  const after = await (await request.get(`${root}/agent-pets`, { headers: ownerHeaders })).json();
  expect(after.pets).toHaveLength(1); expect(after.pets[0].id).toBe(pet.id); expect(after.pets[0].revision).toBe(1);
  expect((await (await request.get(`${foreign}/agent-pets`, { headers: intruderHeaders })).json()).pets).toHaveLength(0);
  const file = testInfo.outputPath("tenant-http-evidence.json");
  await writeFile(file, JSON.stringify({ boundary: "Real Spring security and PostgreSQL; no API route mocks", attempts }, null, 2));
  await testInfo.attach("real-tenant-http-evidence", { contentType: "application/json", path: file });
});

