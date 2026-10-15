const settledDocuments = new WeakSet();

/** 첫 로드 시 애니메이션 초기화로 중단된 해시 위치 이동을 보정한다.
 * 새로고침은 해시를 따르고 뒤로가기는 브라우저의 스크롤 복원을 유지한다.
 * 이후 앵커 이동에는 관여하지 않는다.
 *
 * @param {HTMLElement | null} root
 * @param {() => void} onRestore
 */
export function restoreInitialAnchor(root, onRestore) {
  const document = root?.ownerDocument;
  const window = document?.defaultView;
  const noop = () => {};
  if (!root || !document || !window || settledDocuments.has(document)) return noop;
  const skip = () => {
    settledDocuments.add(document);
    return noop;
  };
  const navigation = window.performance.getEntriesByType("navigation")[0];
  const initialURL = window.location.href;
  // 클라이언트 경로 전환으로 열린 소개 페이지는 첫 문서 로드로 취급하지 않는다.
  if (
    navigation?.type === "back_forward" ||
    (navigation?.name && new URL(navigation.name).pathname !== window.location.pathname)
  )
    return skip();
  let id;
  try {
    id = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return skip();
  }
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
    // 효과 재실행 중에는 같은 URL을 유지한다. 페이지를 떠나면 초기 이동 요청은 소비한다.
    // 프로그램에 의한 경로 변경에 입력 이벤트가 없더라도 동일하게 처리한다.
    if (window.location.href !== initialURL) settledDocuments.add(document);
    cancelled = true;
    window.cancelAnimationFrame(frame);
    window.removeEventListener("load", onLoad);
    inputEvents.forEach((event) => window.removeEventListener(event, onInput, true));
    navigationEvents.forEach((event) => window.removeEventListener(event, cancel, true));
  };
  const cancel = () => {
    settledDocuments.add(document);
    cleanup();
  };
  const onInput = (event) => {
    if (event.isTrusted) cancel();
  };
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
      // instant로 CSS 부드러운 스크롤을 건너뛰되 기존 스크롤 여백은 따른다.
      // 위치 보정이 끝난 뒤 애니메이션 기준점을 갱신한다.
      target.scrollIntoView({ behavior: "instant", block: "start" });
      onRestore();
    });
  };
  function onLoad() {
    loaded = true;
    schedule();
  }
  if (!loaded) window.addEventListener("load", onLoad, { once: true });
  inputEvents.forEach((event) => window.addEventListener(event, onInput, { passive: true, capture: true }));
  navigationEvents.forEach((event) => window.addEventListener(event, cancel, { capture: true }));
  Promise.resolve(document.fonts?.ready).then(() => {
    fontsReady = true;
    schedule();
  }, cancel);
  return cleanup;
}
