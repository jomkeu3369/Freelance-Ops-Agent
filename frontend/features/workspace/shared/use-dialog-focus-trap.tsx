import { RefObject, useRef, useEffect } from "react";

export function useDialogFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  closeDisabled = false,
  enabled = true
) {
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    closeRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (!enabled) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getFocusable = () =>
      [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          "button, input, textarea, select, summary, [href], [tabindex]:not([tabindex='-1'])"
        ) ?? [])
      ].filter((element) => {
        const closedDetails = element.closest("details:not([open])");
        return (
          !element.matches(":disabled") &&
          element.tabIndex >= 0 &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0 &&
          (!closedDetails || closedDetails.querySelector(":scope > summary")?.contains(element))
        );
      });
    const initialFocusable = getFocusable();
    (
      initialFocusable.find((element) => element.hasAttribute("data-autofocus")) ?? initialFocusable[0]
    )?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [dialogRef, enabled]);
}
