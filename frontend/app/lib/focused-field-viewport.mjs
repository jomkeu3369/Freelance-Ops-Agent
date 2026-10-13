/** Keep an already focused field reachable when a keyboard or window changes size. */
export function bindFocusedFieldViewport(field, viewport = window, region = field) {
  let pending = null;

  function scheduleVisibilityCheck() {
    if (pending !== null) return;
    pending = viewport.requestAnimationFrame(() => {
      pending = null;
      // Resizing must not move a reader or take focus from a dialog.
      if (field.isConnected && viewport.document.activeElement === field) {
        region.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      }
    });
  }

  viewport.addEventListener("resize", scheduleVisibilityCheck);
  viewport.visualViewport?.addEventListener("resize", scheduleVisibilityCheck);
  return () => {
    viewport.removeEventListener("resize", scheduleVisibilityCheck);
    viewport.visualViewport?.removeEventListener("resize", scheduleVisibilityCheck);
    if (pending !== null) viewport.cancelAnimationFrame(pending);
  };
}
