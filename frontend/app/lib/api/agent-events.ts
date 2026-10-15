import type { WorkflowEvent } from "./contracts/agents";
import type { AuthSession } from "./contracts/auth";
import { apiBaseUrl } from "./http";

export async function streamRunEvents(session: AuthSession, runId: string, onEvent: (event: WorkflowEvent) => void, signal: AbortSignal, lastEventId?: number, onConnected?: () => void): Promise<void> {
  const headers = new Headers({
    Accept: "text/event-stream",
    Authorization: `Bearer ${session.accessToken}`
  });
  if (lastEventId != null && lastEventId > 0) headers.set("Last-Event-ID", String(lastEventId));
  const response = await fetch(`${apiBaseUrl()}/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/events`, {
    headers,
    signal
  });
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !response.body || !contentType.includes("text/event-stream")) {
    throw new Error("실시간 실행 스트림에 연결하지 못했습니다.");
  }
  onConnected?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const packets = buffer.split(/\r?\n\r?\n/);
    buffer = packets.pop() ?? "";
    for (const packet of packets) {
      const data = packet
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as WorkflowEvent);
      } catch {
        // 형식이 잘못된 공개 이벤트는 건너뛰고 스트림은 유지한다.
      }
    }
  }
}
