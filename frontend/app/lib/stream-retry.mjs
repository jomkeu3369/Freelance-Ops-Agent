const ACTIVE_STREAM_STATUSES = new Set(["QUEUED", "RUNNING"]);

export function isActiveStreamStatus(status) {
  return status == null || ACTIVE_STREAM_STATUSES.has(status);
}

export function nextStreamCursor(current, eventId) {
  return Number.isSafeInteger(eventId) && eventId > current ? eventId : current;
}

export function streamReconnectDelay(attempt) {
  return Math.min(1_000 * (2 ** Math.max(0, attempt - 1)), 10_000);
}
