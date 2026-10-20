const queues = new WeakMap();

/** 첫 화면을 그린 뒤 GPU 장면을 하나씩 준비한다. 반환 함수는 대기 작업을 취소한다. */
export function queueSceneStartup(start, onError, view = window) {
  let cancelled = false;
  let frame = 0;
  let idle;
  let timer;
  let release;
  const previous = queues.get(view) ?? Promise.resolve();
  const next = previous.then(async () => {
    if (cancelled) return;
    await new Promise(resolve => {
      release = resolve;
      frame = view.requestAnimationFrame(() => {
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          const ready = () => {
            idle = undefined;
            timer = undefined;
            resolve();
          };
          if (view.requestIdleCallback) idle = view.requestIdleCallback(ready, { timeout: 1200 });
          else timer = view.setTimeout(ready, 0);
        });
      });
    });
    if (!cancelled) await start();
  }).catch(onError);
  // 한 장면의 실패가 다음 장면의 준비를 막지 않도록 한다.
  queues.set(view, next.catch(() => {}));
  return () => {
    cancelled = true;
    view.cancelAnimationFrame(frame);
    if (idle !== undefined) view.cancelIdleCallback(idle);
    if (timer !== undefined) view.clearTimeout(timer);
    release?.();
  };
}
