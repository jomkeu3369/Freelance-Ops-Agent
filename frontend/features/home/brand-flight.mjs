const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const mix = (from, to, progress) => from * (1 - progress) + to * progress;
const smoothstep = progress => progress * progress * (3 - 2 * progress);

function cubic(from, first, second, to, progress) {
  // De Casteljau keeps interpolation bounded by its measured control points.
  const a = mix(from, first, progress);
  const b = mix(first, second, progress);
  const c = mix(second, to, progress);
  return mix(mix(a, b, progress), mix(b, c, progress), progress);
}

/**
 * Build once per layout refresh; sample freely in either scroll direction.
 * All positions use the mark's untranslated center as their common origin.
 * clearY is the safe CENTER height, including the compact mark's half-height
 * and a gap below both measured copy blocks. The destination must be below it
 * for copy clearance to be geometrically possible. An off-center start stays
 * between start.x and corridorX until it reaches clearY.
 *
 * @param {{ start?: { x?: number, y?: number, scale?: number }, corridorX?: number, clearY?: number, destination?: { x?: number, y?: number, scale?: number }, compactScale?: number }} geometry
 */
export function createBrandFlight(geometry = {}) {
  const start = geometry.start ?? {};
  const destination = geometry.destination ?? {};
  const from = { x: finite(start.x, 0), y: finite(start.y, 0), scale: Math.max(0, finite(start.scale, 1)) };
  const to = {
    x: finite(destination.x, from.x),
    y: finite(destination.y, from.y),
    scale: Math.max(0, finite(destination.scale, from.scale)),
  };
  const corridorX = finite(geometry.corridorX, from.x);
  const clearY = Math.max(from.y, finite(geometry.clearY, to.y));
  const descent = clearY - from.y;
  const entryLength = Math.hypot(corridorX - from.x, descent);
  const arrivalLength = Math.hypot(to.x - corridorX, to.y - clearY);
  const totalLength = entryLength + arrivalLength;
  const corridorProgress = totalLength > 0 ? clamp(entryLength / totalLength, .25, .8) : .5;
  const arrivalProgress = 1 - corridorProgress;

  // Matching derivatives in GLOBAL progress, not just matching handle lengths,
  // avoids a speed jump where the descent becomes the bend toward the hub.
  const tangent = Math.min(
    descent * .45 / corridorProgress,
    arrivalLength * .4 / arrivalProgress,
    Math.max(0, to.y - clearY) * .8 / arrivalProgress,
  );
  const entryHandle = tangent * corridorProgress;
  const arrivalHandle = tangent * arrivalProgress;
  const compactScale = clamp(finite(geometry.compactScale, .45), 0, Math.min(from.scale, to.scale));
  const shrinkEnd = corridorProgress * .3;
  const growStart = corridorProgress + arrivalProgress * .6;

  return {
    corridorProgress,
    sample(progress) {
      const p = clamp(Number.isNaN(progress) ? 0 : progress ?? 0, 0, 1);
      if (p === 0) return { ...from };
      if (p === 1) return { ...to };
      let x;
      let y;
      if (p <= corridorProgress) {
        const u = p / corridorProgress;
        x = cubic(from.x, from.x, corridorX, corridorX, u);
        y = cubic(from.y, from.y + descent * .35, clearY - entryHandle, clearY, u);
      } else {
        const u = (p - corridorProgress) / arrivalProgress;
        x = cubic(corridorX, corridorX, to.x, to.x, u);
        y = cubic(clearY, clearY + arrivalHandle, to.y, to.y, u);
      }
      const scale = p < shrinkEnd
        ? mix(from.scale, compactScale, smoothstep(p / shrinkEnd))
        : p > growStart
          ? mix(compactScale, to.scale, smoothstep((p - growStart) / (1 - growStart)))
          : compactScale;
      return { x, y, scale };
    },
  };
}
