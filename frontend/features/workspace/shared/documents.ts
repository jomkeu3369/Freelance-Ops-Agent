import type { KnowledgeDocument, createDocument } from "../../../app/lib/api";

export async function prepareDocumentUpload(file: File, sourceType: KnowledgeDocument["sourceType"]
): Promise<Parameters<typeof createDocument>[1]> {
  const allowedExtensions = new Set(["txt", "md", "markdown", "csv", "json"]);
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  if (!allowedExtensions.has(extension))
    throw new Error("TXT, Markdown, CSV, JSON 문서만 업로드할 수 있습니다.");
  if (file.size > 5 * 1024 * 1024) throw new Error("문서는 5MB 이하의 텍스트 파일만 업로드할 수 있습니다.");
  const content = (await file.text()).trim();
  if (!content) throw new Error("비어 있는 문서는 업로드할 수 없습니다.");
  const chunks = Array.from({ length: Math.ceil(content.length / 18_000) }, (_, index) => {
    const startOffset = index * 18_000;
    const chunkContent = content.slice(startOffset, startOffset + 18_000);
    return {
      content: chunkContent,
      embedding: null,
      embeddingModel: null,
      startOffset,
      endOffset: startOffset + chunkContent.length
    };
  });
  return {
    sourceType,
    title: file.name.slice(0, 300),
    sourceUri: null,
    sourceVersion: `upload-${Date.now()}`,
    jurisdiction: "KR",
    effectiveFrom: null,
    effectiveUntil: null,
    chunks
  };
}

export const sourceTypeLabel: Record<KnowledgeDocument["sourceType"], string> = {
  PAST_PROJECT: "과거 프로젝트",
  POLICY: "내부 정책",
  PLATFORM_TERMS: "플랫폼 약관",
  USER_TEMPLATE: "사용자 자료",
  EXTERNAL_SOURCE: "외부 자료"
};
