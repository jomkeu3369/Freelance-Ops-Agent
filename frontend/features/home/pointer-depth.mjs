/** Bounded decorative response; coordinates never affect layout or content. */
export function pointerDepth(clientX, clientY, rect) {
  const clamp = value => Math.max(-1, Math.min(1, value));
  const x = clamp((clientX - rect.left) / Math.max(1, rect.width) * 2 - 1);
  const y = clamp((clientY - rect.top) / Math.max(1, rect.height) * 2 - 1);
  return { rx: -y * 1.8, ry: x * 2.2, x: (x + 1) * 50, y: (y + 1) * 50 };
}
