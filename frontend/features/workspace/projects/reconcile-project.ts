import type { Project } from "../../../app/lib/api";

// Status-only writes still return a full Project. A delayed response must not
// replace newer details saved from another screen while the request was pending.
export function reconcileProject(current: Project, incoming: Project): Project {
  const currentTime = Date.parse(current.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  if (!Number.isFinite(currentTime)) return incoming;
  if (!Number.isFinite(incomingTime) || currentTime > incomingTime) return current;
  if (currentTime === incomingTime) {
    // The API uses Instant; preserve its sub-millisecond ordering as well.
    const fraction = (value: string) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "").padEnd(9, "0").slice(3, 9);
    if (fraction(current.updatedAt) > fraction(incoming.updatedAt)) return current;
  }
  return incoming;
}
