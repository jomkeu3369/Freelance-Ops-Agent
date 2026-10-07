import * as THREE from "three";
import { createLightRibbon } from "./light-ribbon";
import { createElectricLightRibbon } from "./electric-light-ribbon";

export type SceneKind = "hero" | "footer";
export type LightVariant = "classic" | "electric";
export type SceneController = ReturnType<typeof createScene>;

/** Decorative light only; the interactive workflow has its own shared camera. */
export function createScene(canvas: HTMLCanvasElement, kind: SceneKind, compact: boolean, variant: LightVariant = "electric") {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !compact, powerPreference: "low-power" });
  renderer.debug.onShaderError = () => { throw new Error("Light shader could not compile"); };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, 1, .1, 100);
  camera.position.set(0, 0, 20);
  const electric = kind === "hero" && variant === "electric";
  const ribbon = electric ? createElectricLightRibbon(scene, compact) : createLightRibbon(scene, compact, kind === "footer");
  let pointerX = 0, pointerY = 0;
  let interaction = 0;
  let halfHeight = Math.tan(THREE.MathUtils.degToRad(22)) * 20;
  let disposed = false;
  return {
    resize(width: number, height: number) {
      if (disposed || width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width / height < 1 ? 28 : 20;
      camera.updateProjectionMatrix();
      halfHeight = Math.tan(THREE.MathUtils.degToRad(22)) * camera.position.z;
    },
    render(time: number, delta: number, moving: boolean, pointer: { x: number; y: number; active: boolean }) {
      if (disposed) return;
      if (electric) {
        // Keep the last location while fading out, rather than sweeping to center.
        if (pointer.active && moving) {
          pointerX = THREE.MathUtils.damp(pointerX, pointer.x * halfHeight * camera.aspect, 12, delta);
          pointerY = THREE.MathUtils.damp(pointerY, -pointer.y * halfHeight, 12, delta);
        }
        interaction = moving ? THREE.MathUtils.damp(interaction, pointer.active ? 1 : 0, pointer.active ? 7 : 4.5, delta) : 0;
        ribbon.update(time, pointerX, pointerY, interaction);
      } else {
        pointerX = moving ? THREE.MathUtils.damp(pointerX, pointer.active ? pointer.x : 0, 5, delta) : 0;
        pointerY = moving ? THREE.MathUtils.damp(pointerY, pointer.active ? pointer.y : 0, 5, delta) : 0;
        ribbon.update(time, pointerX, pointerY, 0);
      }
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true; ribbon.dispose(); scene.clear(); renderer.dispose();
    }
  };
}
