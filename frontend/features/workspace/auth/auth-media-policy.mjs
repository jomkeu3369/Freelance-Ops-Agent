/** Only explicit, root-relative public assets may become authentication-page media. */
export function isAuthMediaPath(value) {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && [...value].every(character => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127);
}

/** @param {readonly { src: string, type: string }[]} sources */
export function normalizeAuthMediaSources(sources = []) {
  const seen = new Set();
  return sources.filter(source => {
    if (!isAuthMediaPath(source.src) || !["video/mp4", "video/webm"].includes(source.type)) return false;
    const key = `${source.type}:${source.src}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ src, type }) => ({ src, type }));
}

export function authMediaPolicy({ hasSources = false, reducedMotion = false, saveData = false, hidden = false, inViewport = false, userPaused = false, blocked = false, failed = false } = {}) {
  const canLoad = hasSources && !reducedMotion && !saveData && !failed;
  return { canLoad, canPlay: canLoad && !hidden && inViewport && !userPaused && !blocked };
}

/**
 * Owns a decorative video's entire lifecycle. Sources are attached only after
 * client preferences and initial viewport visibility are known. The static
 * fallback is owned by React and is never removed by this controller.
 *
 * @param {{ video: HTMLVideoElement, host: HTMLElement, sources?: readonly {src: string, type: string}[], onStateChange: (state: {status: string, paused: boolean, canToggle: boolean}) => void, environment?: Window & typeof globalThis }} options
 */
export function createAuthMediaController({ video, host, sources = [], onStateChange, environment = window }) {
  const safeSources = normalizeAuthMediaSources(sources);
  const document = environment.document;
  const motion = environment.matchMedia?.("(prefers-reduced-motion: reduce)");
  // Network Information is deliberately optional; browsers without it still
  // honor reduced motion, visibility, viewport and the explicit pause control.
  const connection = environment.navigator?.connection;
  let disposed = false;
  let inViewport = !environment.IntersectionObserver;
  let userPaused = false;
  let blocked = false;
  let failed = false;
  let playing = false;
  let pending = false;
  let attempt = 0;
  let previousState = "";
  const sourceNodes = [];
  const sourceCleanups = [];
  const failedSources = new Set();
  const cleanups = [];

  const policy = () => authMediaPolicy({
    hasSources: safeSources.length > 0,
    reducedMotion: motion?.matches === true,
    saveData: connection?.saveData === true,
    hidden: document.hidden,
    inViewport, userPaused, blocked, failed,
  });

  function notify() {
    if (disposed) return;
    const allowed = policy();
    const status = !safeSources.length ? "absent"
      : motion?.matches || connection?.saveData ? "disabled"
      : failed ? "error"
      : blocked ? "blocked"
      : !allowed.canPlay ? "paused"
      : playing ? "playing" : "loading";
    const state = { status, paused: userPaused || blocked, canToggle: allowed.canLoad };
    const signature = JSON.stringify(state);
    if (signature !== previousState) {
      previousState = signature;
      onStateChange(state);
    }
  }

  function pause() {
    attempt += 1;
    pending = false;
    playing = false;
    video.pause();
  }

  function unload() {
    if (!sourceNodes.length) return;
    for (const cleanup of sourceCleanups.splice(0)) cleanup();
    failedSources.clear();
    for (const source of sourceNodes.splice(0)) source.remove();
    video.removeAttribute("src");
    // With no source this cancels an in-flight request and releases the decoder.
    video.load();
  }

  function reconcile() {
    if (disposed) return;
    const allowed = policy();
    if (!allowed.canPlay) {
      pause();
      if (!allowed.canLoad) unload();
      notify();
      return;
    }
    if (!sourceNodes.length) {
      for (const source of safeSources) {
        const node = document.createElement("source");
        node.src = source.src;
        node.type = source.type;
        sourceNodes.push(node);
        const onSourceError = () => {
          if (disposed) return;
          failedSources.add(node);
          if (failedSources.size === safeSources.length) {
            failed = true;
            reconcile();
          }
        };
        node.addEventListener("error", onSourceError);
        sourceCleanups.push(() => node.removeEventListener("error", onSourceError));
        video.appendChild(node);
      }
      video.load();
    }
    notify();
    if (playing || pending) return;
    // Set these before each attempt, including user-initiated resumes.
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    pending = true;
    const currentAttempt = ++attempt;
    function rejected() {
      if (disposed || currentAttempt !== attempt) return;
      pending = false;
      blocked = true;
      pause();
      notify();
    }
    try {
      const result = video.play();
      result?.then(() => {
        if (disposed || currentAttempt !== attempt) return;
        pending = false;
        // A resolved play promise alone is not evidence a frame is visible.
        notify();
      }, rejected);
    } catch {
      rejected();
    }
  }

  function listen(target, event, listener) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, listener);
    cleanups.push(() => target.removeEventListener(event, listener));
  }

  listen(video, "playing", () => {
    if (disposed) return;
    if (!policy().canPlay) { pause(); notify(); return; }
    pending = false;
    playing = true;
    notify();
  });
  listen(video, "pause", () => { playing = false; notify(); });
  listen(video, "error", () => {
    failed = true;
    reconcile();
  });
  listen(document, "visibilitychange", reconcile);
  listen(connection, "change", reconcile);
  if (motion?.addEventListener) listen(motion, "change", reconcile);
  else if (motion?.addListener) {
    motion.addListener(reconcile);
    cleanups.push(() => motion.removeListener(reconcile));
  }

  const observer = environment.IntersectionObserver
    ? new environment.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target !== host) continue;
        inViewport = entry.isIntersecting;
        reconcile();
      }
    }, { threshold: 0 }) : null;
  observer?.observe(host);
  reconcile();

  return {
    toggle() {
      if (disposed || !policy().canLoad) return;
      userPaused = blocked ? false : !userPaused;
      blocked = false;
      reconcile();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      for (const cleanup of cleanups) cleanup();
      pause();
      unload();
    },
  };
}
