/** 인증 화면 미디어에는 명시한 공개 자산의 루트 상대 경로만 허용한다. */
export function isAuthMediaPath(value) {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    [...value].every((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
  );
}

/** @param {readonly { src: string, type: string }[]} sources */
export function normalizeAuthMediaSources(sources = []) {
  const seen = new Set();
  return sources
    .filter((source) => {
      if (!isAuthMediaPath(source.src) || !["video/mp4", "video/webm"].includes(source.type)) return false;
      const key = `${source.type}:${source.src}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ src, type }) => ({ src, type }));
}

export function authMediaPolicy({ hasSources = false, reducedMotion = false, saveData = false, hidden = false, inViewport = false, userPaused = false, blocked = false, failed = false } = {}) {
  const canLoad = hasSources && !reducedMotion && !saveData && !failed;
  return { canLoad, canPlay: canLoad && !hidden && inViewport && !userPaused && !blocked };
}

/** 장식 영상의 전체 수명을 관리한다. 동작 설정과 초기 화면 내 위치를 확인한 뒤
 * 소스를 연결한다. 정적 대체 화면은 React가 관리하며 이 제어기에서 제거하지 않는다.
 *
 * @param {{ video: HTMLVideoElement, host: HTMLElement, sources?: readonly {src: string, type: string}[], onStateChange: (state: {status: string, paused: boolean, canToggle: boolean}) => void, environment?: Window & typeof globalThis }} options
 */
export function createAuthMediaController({ video, host, sources = [], onStateChange, environment = window }) {
  const safeSources = normalizeAuthMediaSources(sources);
  const document = environment.document;
  const motion = environment.matchMedia?.("(prefers-reduced-motion: reduce)");
  // Network Information API는 선택 사항이다. 지원하지 않는 브라우저에서도
  // 동작 축소, 가시성, 화면 크기, 사용자의 일시정지 설정은 적용한다.
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

  const policy = () =>
    authMediaPolicy({
      hasSources: safeSources.length > 0,
      reducedMotion: motion?.matches === true,
      saveData: connection?.saveData === true,
      hidden: document.hidden,
      inViewport,
      userPaused,
      blocked,
      failed
    });

  function notify() {
    if (disposed) return;
    const allowed = policy();
    const status = !safeSources.length
      ? "absent"
      : motion?.matches || connection?.saveData
        ? "disabled"
        : failed
          ? "error"
          : blocked
            ? "blocked"
            : !allowed.canPlay
              ? "paused"
              : playing
                ? "playing"
                : "loading";
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
    // 소스를 비우면 진행 중 요청을 취소하고 디코더를 해제한다.
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
    // 사용자가 재개하는 경우를 포함해 재생을 시도하기 전에 설정한다.
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
        // play가 성공해도 프레임이 실제로 표시됐는지는 별도로 확인한다.
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
    if (!policy().canPlay) {
      pause();
      notify();
      return;
    }
    pending = false;
    playing = true;
    notify();
  });
  listen(video, "pause", () => {
    playing = false;
    notify();
  });
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
    ? new environment.IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target !== host) continue;
            inViewport = entry.isIntersecting;
            reconcile();
          }
        },
        { threshold: 0 }
      )
    : null;
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
    }
  };
}
