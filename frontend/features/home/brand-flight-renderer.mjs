/** Reuse transform setters; a gsap.set inside onUpdate would allocate a tween
 * retained by its owning context on every scroll frame. The caller captures
 * the initial pose in that context so its ordinary revert still restores it. */
export function createBrandFlightRenderer(animation, target) {
  const setX = animation.quickSetter(target, "x", "px");
  const setY = animation.quickSetter(target, "y", "px");
  const setScale = animation.quickSetter(target, "scale");
  return ({ x, y, scale }) => {
    setX(x);
    setY(y);
    setScale(scale);
  };
}
