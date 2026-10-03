const settledDocuments = new WeakSet();

/**
 * Repair a hard-load fragment after smooth native scrolling has been interrupted
 * by animation setup. Reloads honor the URL fragment; history traversals retain
 * their own scroll restoration. This never owns later anchor navigation.
 *
 * @param {HTMLElement | null} root
 * @param {() => void} onRestore
 */
export function restoreInitialAnchor(root, onRestore) {
  const document = root?.ownerDocument;
  const window = document?.defaultView;
  const noop = () => {};
  if (!root || !document || !window || settledDocuments.has(document)) return noop;
  const skip = () => { settledDocuments.add(document); return noop; };
  const navigation = window.performance.getEntriesByType("navigation")[0];
  const initialURL = window.location.href;
  // A landing page mounted after a client-side route change is not a hard load.
  if (navigation?.type === "back_forward" || (navigation?.name &&
      new URL(navigation.name).pathname !== window.location.pathname)) return skip();
  let id;
  try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return skip(); }
  if (!id || id.toLowerCase() === "top") return skip();
  const initialTarget = document.getElementById(id);
  if (!initialTarget || !root.contains(initialTarget)) return skip();

  let cancelled = false;
  let frame = 0;
  let fontsReady = false;
  let loaded = document.readyState === "complete";
  const inputEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
  const navigationEvents = ["hashchange", "popstate", "pagehide"];
  const cleanup = () => {
    // Effect replay keeps the same URL; leaving this page consumes its initial
    // intent even when a programmatic route change has produced no input event.
    if (window.location.href !== initialURL) settledDocuments.add(document);
    cancelled = true;
    window.cancelAnimationFrame(frame);
    window.removeEventListener("load", onLoad);
    inputEvents.forEach(event => window.removeEventListener(event, onInput, true));
    navigationEvents.forEach(event => window.removeEventListener(event, cancel, true));
  };
  const cancel = () => { settledDocuments.add(document); cleanup(); };
  const onInput = event => { if (event.isTrusted) cancel(); };
  const schedule = () => {
    if (cancelled || !loaded || !fontsReady || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (cancelled) return;
      const target = document.getElementById(id);
      if (window.location.href !== initialURL || !root.isConnected || !target || !root.contains(target)) {
        cancel();
        return;
      }
      cancel();
      // Explicit instant bypasses CSS smooth scrolling and respects the existing
      // scroll padding/margin. Refresh only after the corrected position exists.
      target.scrollIntoView({ behavior: "instant", block: "start" });
      onRestore();
    });
  };
  function onLoad() { loaded = true; schedule(); }
  if (!loaded) window.addEventListener("load", onLoad, { once: true });
  inputEvents.forEach(event => window.addEventListener(event, onInput, { passive: true, capture: true }));
  navigationEvents.forEach(event => window.addEventListener(event, cancel, { capture: true }));
  Promise.resolve(document.fonts?.ready).then(() => {
    fontsReady = true;
    schedule();
  }, cancel);
  return cleanup;
}
