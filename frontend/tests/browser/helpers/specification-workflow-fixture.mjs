import { createHash } from "node:crypto";
import { analysisWorkflowFixture, requestBarrier } from "./analysis-workflow-fixture.mjs";
export { requestBarrier };
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);
const now = "2026-10-13T16:00:00.123456Z";

// Valid PDF carrier for browser download plumbing only. Actual Korean body and
// immutable server PDF bytes are verified by Spring/PostgreSQL/PDFBox tests.
function fixturePdf() {
  const stream = "BT /F1 12 Tf 72 720 Td (Synthetic UI fixture; server PDF tested separately) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = "%PDF-1.4\n", offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

export async function specificationWorkflowFixture(page) {
  const result = await analysisWorkflowFixture(page), { state, workflow, sourceMessages } = result;
  const specifications = { items: [], creates: [], revisions: [], confirms: [], requests: [], pdfs: [], documentReads: [], documents: [], ledger: new Map(), barriers: {}, lostResponses: {}, serial: 1 };
  const root = "/api/v2/workspaces/local-space/projects/project-one/specifications";
  const docsRoot = "/api/v2/workspaces/local-space/documents";
  const id = () => `c1000000-0000-4000-8000-${String(specifications.serial++).padStart(12, "0")}`;
  const latestDecision = () => workflow.decisions.find(value => value.status === "CONFIRMED");
  const current = value => !workflow.sourceStale && value.sourceProjectVersion === state.projects[0].version && latestDecision()?.id === value.sourceDecisionId;
  const response = value => ({ ...clone(value), sourceCurrent: current(value), indexStatus: value.status !== "CONFIRMED" ? "NOT_INDEXED"
    : specifications.documents.find(doc => doc.id === value.reusableDocumentId)?.retrievalEligible ? "KEYWORD_ONLY" : "SUPERSEDED" });
  const summary = value => { const detail = response(value); return Object.fromEntries(["id", "revisionNumber", "status", "title", "contentHash", "sourceDecisionId", "sourceDecisionVersion", "sourceCurrent", "createdAt", "confirmedAt"].map(key => [key, detail[key]])); };
  const barrier = async operation => { const gate = specifications.barriers[operation]; delete specifications.barriers[operation]; if (gate) await gate.wait(); };

  await page.route(`**${root}**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = method === "GET" ? null : request.postDataJSON();
    specifications.requests.push({ path, method, body: clone(body) });
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    const fail = (message, status = 409) => json({ message }, status);
    if (path === root && method === "GET") return json(specifications.items.map(summary));
    const operation = path === root ? "create" : path.endsWith("/revisions") ? "revise" : path.endsWith("/confirm") ? "confirm" : path.endsWith("/pdf") ? "pdf" : "get";
    const targetId = path.slice(root.length + 1).split("/")[0], target = specifications.items.find(value => value.id === targetId);
    if (operation === "get" && method === "GET") { const snapshot = target ? response(target) : null; await barrier("get"); return snapshot ? json(snapshot) : fail("Fixture specification not found", 404); }
    if (operation === "pdf" && method === "GET") {
      specifications.pdfs.push(targetId);
      if (!target) return fail("Fixture specification not found", 404);
      if (target.status !== "CONFIRMED") return fail("confirm the specification before PDF export");
      await barrier("pdf");
      return route.fulfill({ status: 200, contentType: "application/pdf", headers: { "X-Specification-Content-SHA256": target.contentHash, "Cache-Control": "private, no-store" }, body: fixturePdf() });
    }
    if (method !== "POST") return fail("Unexpected specification route", 404);
    if (!state.permissions.includes("project.write") || !state.permissions.includes("document.write")) return fail("Permission denied", 403);
    if (operation === "create") specifications.creates.push(clone(body));
    if (operation === "revise") specifications.revisions.push({ id: targetId, ...clone(body) });
    if (operation === "confirm") specifications.confirms.push({ id: targetId, ...clone(body) });
    const signature = hash(JSON.stringify({ operation, targetId, ...body, requestId: undefined })), saved = specifications.ledger.get(body.requestId);
    if (saved) return saved.signature === signature ? json(response(saved.value)) : fail("request ID was already used for different specification content");
    if (operation !== "create" && !target) return fail("Fixture specification not found", 404);
    if (operation === "confirm") {
      if (body.confirmation !== "CONFIRM_SPECIFICATION") return fail("explicit specification confirmation is required", 400);
      if (body.expectedContentHash !== target.contentHash) return fail("specification content changed; reload before continuing");
      if (target.status === "CONFIRMED") return json(response(target));
    }
    if (operation !== "create" && specifications.items[0]?.id !== target.id) return fail("a newer specification revision exists; reload before editing or confirming");
    let value;
    if (operation === "create") {
      const decision = workflow.decisions.find(item => item.id === body.decisionId);
      if (!body.requestId || !decision || decision.status !== "CONFIRMED") return fail("확정된 의견 정리만 명세의 출처로 사용할 수 있습니다.");
      if (workflow.sourceStale) return fail("confirmed result or project source changed; generate a new specification");
      const previous = specifications.items[0];
      value = previous?.sourceDecisionId === decision.id ? previous : { id: id(), workspaceId: "local-space", projectId: "project-one", revisionNumber: (previous?.revisionNumber ?? 0) + 1,
        supersedes: previous?.id ?? null, status: "DRAFT", title: `${state.projects[0].title} 명세서`, bodyText: decision.bodyText, contentHash: decision.contentHash,
        sourceDecisionId: decision.id, sourceDecisionVersion: decision.versionNumber, sourceDecisionHash: decision.contentHash, sourceBodyText: decision.bodyText,
        sourceRunId: decision.sourceRunId, sourceProjectVersion: decision.sourceProjectVersion, sourceProvenance: clone(decision), originalSources: clone(sourceMessages),
        createdBy: "local-user", createdAt: now, confirmedBy: null, confirmedAt: null, reusableDocumentId: null,
        downloadFileName: `${state.projects[0].title}-v${(previous?.revisionNumber ?? 0) + 1}.pdf` };
      if (value !== previous) specifications.items.unshift(value);
    } else if (operation === "revise") {
      if (!body.requestId || !body.title?.trim() || !body.bodyText?.trim()) return fail("specification title or content is invalid", 422);
      if (body.expectedContentHash !== target.contentHash) return fail("specification content changed; reload before continuing");
      value = body.title === target.title && body.bodyText === target.bodyText ? target : { ...clone(target), id: id(), supersedes: target.id, revisionNumber: target.revisionNumber + 1,
        status: "DRAFT", title: body.title, bodyText: body.bodyText, contentHash: hash(body.bodyText), confirmedBy: null, confirmedAt: null, reusableDocumentId: null,
        downloadFileName: `${body.title}-v${target.revisionNumber + 1}.pdf` };
      if (value !== target) specifications.items.unshift(value);
    } else if (operation === "confirm") {
      if (!current(target)) return fail("confirmed result or project source changed; generate a new specification");
      const documentId = id();
      specifications.documents.forEach(doc => { doc.confirmationStatus = "superseded"; doc.retrievalEligible = false; doc.version++; });
      target.status = "CONFIRMED"; target.confirmedBy = "local-user"; target.confirmedAt = now; target.reusableDocumentId = documentId; value = target;
      specifications.documents.unshift({ id: documentId, workspaceId: "local-space", sourceType: "PAST_PROJECT", title: target.title, sourceUri: `specification:${target.id}`, sourceVersion: `spec-v${target.revisionNumber}`,
        jurisdiction: null, effectiveFrom: null, effectiveUntil: null, contentSha256: target.contentHash, status: "ACTIVE", createdBy: "local-user", createdAt: now, version: 0,
        origin: "user", memoryType: "decision", confirmationStatus: "confirmed", retrievalEligible: true, projectId: "project-one", sourceRunId: null, sourceSpecificationId: target.id,
        sourceMessageIds: sourceMessages.map(source => source.id), parentDocumentIds: [], supersedes: specifications.documents[0]?.id ?? null, revisionNumber: target.revisionNumber,
        confirmedBy: "local-user", confirmedAt: now, sourceMessages: clone(sourceMessages),
        chunks: [{ id: id(), chunkIndex: 0, content: target.bodyText, embeddingModel: null, startOffset: 0, endOffset: target.bodyText.length }] });
    } else return fail("Unexpected specification operation", 404);
    if (body.requestId) specifications.ledger.set(body.requestId, { signature, value });
    const snapshot = response(value); await barrier(operation);
    if (specifications.lostResponses[operation] > 0) { specifications.lostResponses[operation]--; return route.abort("failed"); }
    return json(snapshot);
  });
  await page.route(`**${docsRoot}**`, async route => {
    const path = new URL(route.request().url()).pathname;
    specifications.documentReads.push(path);
    if (route.request().method() !== "GET") return route.fulfill({ status: 404, json: { message: "Unexpected document write" } });
    const value = path === docsRoot ? specifications.documents : specifications.documents.find(doc => doc.id === path.slice(docsRoot.length + 1));
    return route.fulfill({ status: value ? 200 : 404, json: value ? clone(value) : { message: "Fixture document not found" } });
  });
  return { ...result, specifications };
}
