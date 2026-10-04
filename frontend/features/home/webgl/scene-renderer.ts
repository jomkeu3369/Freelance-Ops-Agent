import * as THREE from "three";
import { createLightRibbon } from "./light-ribbon";

export type SceneKind = "hero" | "footer";
export type SceneController = ReturnType<typeof createScene>;

/** Decorative light only; the interactive workflow has its own shared camera. */
export function createScene(canvas: HTMLCanvasElement, kind: SceneKind, compact: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !compact, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, 1, .1, 100);
  camera.position.set(0, 0, 20);
  const ribbon = createLightRibbon(scene, compact, kind === "footer");
  let pointerX = 0, pointerY = 0;
  let disposed = false;
  return {
    resize(width: number, height: number) {
      if (disposed || width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width / height < 1 ? 28 : 20;
      camera.updateProjectionMatrix();
    },
    render(time: number, delta: number, moving: boolean, pointer: { x: number; y: number }) {
      if (disposed) return;
      pointerX = moving ? THREE.MathUtils.damp(pointerX, pointer.x, 5, delta) : 0;
      pointerY = moving ? THREE.MathUtils.damp(pointerY, pointer.y, 5, delta) : 0;
      ribbon.update(time, pointerX, pointerY);
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true; ribbon.dispose(); scene.clear(); renderer.dispose();
    }
  };
}
