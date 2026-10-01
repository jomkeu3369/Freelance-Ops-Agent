// Each product step owns its cumulative event boundary. All controls use this timeline.
export const workflowEventCounts = [1, 3, 4, 6, 7];
export function workflowPreviewEventCount(step) {
  return workflowEventCounts[step] ?? workflowEventCounts[0];
}
export function nextWorkflowStep(step) {
  return (step + 1) % workflowEventCounts.length;
}
