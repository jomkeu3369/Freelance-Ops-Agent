import { RefObject, useRef, useEffect } from "react";

// Async server notices can appear while a settings or result panel is open.
// One ordered stack owns keyboard handling, body scrolling, and inert snapshots.
type DialogEntry = { element: HTMLElement; inertBackground: boolean };
const dialogs: DialogEntry[] = [];
const inertSnapshots = new Map<HTMLElement, boolean>();
let originalBodyOverflow = "";

function reconcileBackground() {
  for (const [element, inert] of inertSnapshots) element.toggleAttribute("inert", inert);
  inertSnapshots.clear();
  const top = dialogs.at(-1);
  if (!top?.inertBackground) return;
  let current: HTMLElement | null = top.element;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling !== current && sibling instanceof HTMLElement && !["SCRIPT", "STYLE"].includes(sibling.tagName)) {
        inertSnapshots.set(sibling, sibling.inert);
        sibling.setAttribute("inert", "");
      }
    }
    current = parent;
  }
}

export function useDialogFocusTrap(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  closeDisabled = false,
  enabled = true,
  inertBackground = false
) {
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    closeRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    const element = dialogRef.current;
    if (!enabled || !element) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = { element, inertBackground };
    if (!dialogs.length) originalBodyOverflow = document.body.style.overflow;
    dialogs.push(entry);
    document.body.style.overflow = "hidden";
    reconcileBackground();
    const getFocusable = () =>
      [...element.querySelectorAll<HTMLElement>(
        "button, input, textarea, select, summary, [href], [tabindex]:not([tabindex='-1'])"
      )].filter((candidate) => {
        const closedDetails = candidate.closest("details:not([open])");
        return (
          !candidate.matches(":disabled") &&
          !candidate.closest("[inert]") &&
          candidate.tabIndex >= 0 &&
          candidate.getAttribute("aria-hidden") !== "true" &&
          candidate.getClientRects().length > 0 &&
          (!closedDetails || closedDetails.querySelector(":scope > summary")?.contains(candidate))
        );
      });
    const initialFocusable = getFocusable();
    (initialFocusable.find((candidate) => candidate.hasAttribute("data-autofocus")) ?? initialFocusable[0])?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== entry) return;
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!element.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      const index = dialogs.indexOf(entry);
      if (index !== -1) dialogs.splice(index, 1);
      reconcileBackground();
      if (!dialogs.length) document.body.style.overflow = originalBodyOverflow;
      const top = dialogs.at(-1);
      if (previouslyFocused?.isConnected && (!top || top.element.contains(previouslyFocused))) previouslyFocused?.focus();
    };
  }, [dialogRef, enabled, inertBackground]);
}
