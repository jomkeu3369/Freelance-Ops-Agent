// A delivered user response is authoritative while the asynchronous resume
// command is still reaching Agent. Its previous question is not a new pause.
export function isPendingResumeSnapshot(pending, view) {
  return !!pending && pending.runId === view.runId
    && view.status === "WAITING_FOR_USER"
    && view.interruption?.interruptionId === pending.interruptionId;
}
