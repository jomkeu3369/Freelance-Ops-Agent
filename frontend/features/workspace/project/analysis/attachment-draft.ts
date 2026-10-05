export const attachmentLimits = { count: 6, bytes: 2 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, text: 40000 };
export function pasteThreshold(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1000 && parsed <= 50000 ? parsed : 8000;
}
export function pastedTextFile(text: string, threshold: number, remaining = 50000): File | null {
  if (text.length < threshold && text.length <= remaining) return null;
  // The Blob/File constructor with transparent endings preserves every character and newline.
  return new File([text], "pasted-text.txt", { type: "text/plain;charset=utf-8", endings: "transparent" });
}
export function validateAttachments(existing: File[], incoming: File[]): void {
  const files = [...existing, ...incoming];
  if (files.length > attachmentLimits.count) throw new Error("한 번에 파일 6개까지 첨부할 수 있습니다.");
  if (files.reduce((sum, file) => sum + file.size, 0) > attachmentLimits.totalBytes) throw new Error("첨부 합계는 8 MiB 이하여야 합니다.");
  for (const file of incoming) {
    // Filenames must reject control characters as well as path separators.
    if (!/\.(txt|csv|pdf|jpe?g|png|gif)$/i.test(file.name) || Array.from(file.name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || "/\\:".includes(char)) || file.name.length > 180)
      throw new Error("TXT, CSV, PDF, JPG, PNG, GIF 파일을 선택해 주세요.");
    if (!file.size || file.size > attachmentLimits.bytes) throw new Error("파일은 1바이트 이상, 2 MiB 이하여야 합니다.");
  }
}
