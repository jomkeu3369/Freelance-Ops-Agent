const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const mix = (from, to, progress) => from * (1 - progress) + to * progress;

/** 레이아웃 갱신마다 경로를 한 번 계산하고 스크롤 양방향에서 재사용한다.
 * 변환 전 중심을 공통 원점으로 삼고 위치와 크기에 같은 진행률을 적용한다.
 *
 * @param {{ start?: { x?: number, y?: number, scale?: number }, destination?: { x?: number, y?: number, scale?: number } }} geometry
 */
export function createBrandFlight(geometry = {}) {
  const start = geometry.start ?? {};
  const destination = geometry.destination ?? {};
  const from = { x: finite(start.x, 0), y: finite(start.y, 0), scale: Math.max(0, finite(start.scale, 1)) };
  const to = {
    x: finite(destination.x, from.x),
    y: finite(destination.y, from.y),
    scale: Math.max(0, finite(destination.scale, from.scale))
  };
  return {
    sample(progress) {
      const p = clamp(Number.isNaN(progress) ? 0 : (progress ?? 0), 0, 1);
      if (p === 0) return { ...from };
      if (p === 1) return { ...to };
      return { x: mix(from.x, to.x, p), y: mix(from.y, to.y, p), scale: mix(from.scale, to.scale, p) };
    }
  };
}
