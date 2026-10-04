import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { createLightRibbon } from "./light-ribbon";

export type SceneKind = "hero" | "chart" | "footer";
export type SceneRow = { title: string; shortTitle?: string; days: number; value: string };
export type SceneController = {
  setRows: (rows: SceneRow[]) => void;
  resize: (width: number, height: number) => void;
  render: (time: number, delta: number, moving: boolean, pointer: { x: number; y: number }) => void;
  dispose: () => void;
};

/** Only imported when a scene enters the viewport. No external models or textures. */
export function createScene(canvas: HTMLCanvasElement, kind: SceneKind, host: HTMLElement, compact: boolean): SceneController {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !compact, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(kind === "chart" ? 35 : 44, 1, .1, 100);
  camera.position.set(0, 0, 20);
  const chart = kind === "chart";
  const ribbon = chart ? null : createLightRibbon(scene, compact, kind === "footer");
  const ownedGeometry = new Set<THREE.BufferGeometry>();
  const ownedMaterial = new Set<THREE.Material>();
  const geometry = <T extends THREE.BufferGeometry>(value: T) => { ownedGeometry.add(value); return value; };
  const material = <T extends THREE.Material>(value: T) => { ownedMaterial.add(value); return value; };
  let composer: EffectComposer | undefined;
  let bloom: UnrealBloomPass | undefined;
  let output: OutputPass | undefined;
  let renderPass: RenderPass | undefined;
  let environment: THREE.WebGLRenderTarget | undefined;
  let reflection: Reflector | undefined;
  let rows: SceneRow[] = [];
  let width = 1;
  let height = 1;
  let disposed = false;
  let pointerX = 0;
  let pointerY = 0;
  let rowSignature = "";
  const bars: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>; cap: THREE.Mesh; height: number; target: number; light: THREE.PointLight; base: THREE.Mesh }[] = [];
  const barGroup = new THREE.Group();
  const projection = new THREE.Vector3();
  const railMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 3.8) });
  ownedMaterial.add(railMaterial);
  let light: THREE.PointLight | undefined;

  if (chart) {
    scene.background = new THREE.Color("#0c0912");
    scene.fog = new THREE.FogExp2("#0c0912", .052);
    camera.position.set(4.4, 5.6, 12.5);
    camera.lookAt(0, 1.2, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(room, .08);
    scene.environment = environment.texture;
    room.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight("#d8c4ff", "#22122e", .45));
    const key = new THREE.SpotLight("#f4deff", 75, 40, .55, .75, 1.5);
    key.position.set(-3, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(compact ? 512 : 1024, compact ? 512 : 1024);
    key.shadow.bias = -.0004;
    key.shadow.normalBias = .025;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight("#b491ff", 3.2);
    rim.position.set(3, 4, -4); scene.add(rim);
    const fill = new THREE.DirectionalLight("#789bea", 1.15);
    fill.position.set(-5, 2, -1); scene.add(fill);
    light = new THREE.PointLight("#d2a3ff", 12, 10, 2);
    light.position.set(-3, 1, 2); scene.add(light);
    // A small planar reflection target reflects the actual meshes, including
    // changing heights. The dark tint and fixed blur keep it below the data.
    reflection = new Reflector(geometry(new THREE.PlaneGeometry(30, 30)), { textureWidth: compact ? 256 : 512, textureHeight: compact ? 256 : 512, multisample: 0, clipBias: .003 });
    reflection.rotation.x = -Math.PI / 2;
    reflection.position.y = -.035;
    (reflection.material as THREE.ShaderMaterial).fragmentShader = `
      uniform sampler2D tDiffuse; varying vec4 vUv;
      void main() {
        vec2 uv = vUv.xy / vUv.w;
        vec3 reflected = texture2D(tDiffuse, uv).rgb * .40;
        reflected += texture2D(tDiffuse, uv + vec2(.0025, 0.)).rgb * .15;
        reflected += texture2D(tDiffuse, uv - vec2(.0025, 0.)).rgb * .15;
        reflected += texture2D(tDiffuse, uv + vec2(0., .0025)).rgb * .15;
        reflected += texture2D(tDiffuse, uv - vec2(0., .0025)).rgb * .15;
        gl_FragColor = vec4(reflected * vec3(.15, .115, .18) + vec3(.004, .002, .007), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    scene.add(reflection);
    const floor = new THREE.Mesh(geometry(new THREE.PlaneGeometry(80, 80)), material(new THREE.ShadowMaterial({ color: "#000000", opacity: .45 })));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = -.025;
    scene.add(floor);
    const grid = new THREE.GridHelper(20, 25, "#705985", "#30203f");
    grid.position.y = -.015;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true; gridMaterial.opacity = .10;
    ownedGeometry.add(grid.geometry); ownedMaterial.add(gridMaterial); scene.add(grid);
    const rail = new THREE.CubicBezierCurve3(new THREE.Vector3(-7, .025, -.8), new THREE.Vector3(-3, .025, 1.65), new THREE.Vector3(3, .025, 1.65), new THREE.Vector3(7, .025, -.8));
    scene.add(new THREE.Mesh(geometry(new THREE.TubeGeometry(rail, 96, .025, 8, false)), railMaterial));
    scene.add(barGroup);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: compact ? 2 : 4 });
    composer = new EffectComposer(renderer, target);
    renderPass = new RenderPass(scene, camera);
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .38, .65, 1.05);
    output = new OutputPass();
    composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output);
  }

  const setRows = (next: SceneRow[]) => {
    rows = next;
    if (!chart) return;
    const signature = next.map(row => row.days).join(",");
    if (signature === rowSignature) return;
    rowSignature = signature;
    // Reuse shared unit geometry; height changes never allocate a new GPU mesh.
    while (bars.length < next.length) {
      const surface = material(new THREE.MeshPhysicalMaterial({ color: "#765090", metalness: .64, roughness: .21, clearcoat: .85, clearcoatRoughness: .16, envMapIntensity: .9 }));
      const mesh = new THREE.Mesh(geometry(new RoundedBoxGeometry(1.02, 1, 1.02, 3, .045)), surface);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const cap = new THREE.Mesh(geometry(new RoundedBoxGeometry(.94, .024, .94, 2, .012)), material(new THREE.MeshPhysicalMaterial({ color: "#e0c1ff", metalness: .35, roughness: .19, clearcoat: 1, emissive: "#87609e", emissiveIntensity: .16 })));
      const base = new THREE.Mesh(geometry(new RoundedBoxGeometry(1.32, .06, 1.32, 2, .025)), material(new THREE.MeshPhysicalMaterial({ color: "#493555", metalness: .6, roughness: .23, clearcoat: .65 })));
      base.receiveShadow = true;
      const localLight = new THREE.PointLight("#c597f1", .22, 2.5, 2);
      barGroup.add(mesh, cap, base, localLight);
      bars.push({ mesh, cap, base, height: .01, target: 0, light: localLight });
    }
    bars.forEach((bar, index) => {
      const row = next[index];
      bar.mesh.visible = bar.cap.visible = bar.base.visible = bar.light.visible = !!row;
      if (!row) return;
      const x = (index - (next.length - 1) / 2) * 2.15;
      bar.target = row.days * .62;
      bar.mesh.position.x = bar.cap.position.x = bar.base.position.x = x;
      bar.base.position.y = .025;
      bar.light.position.set(x, .16, .7);
    });
  };

  const positionLabel = (selector: string, x: number, y: number, z: number, offset: number) => {
    const label = host.querySelector<HTMLElement>(selector);
    if (!label) return;
    projection.set(x, y, z).project(camera);
    label.style.left = `${(projection.x * .5 + .5) * width}px`;
    label.style.top = `${(-projection.y * .5 + .5) * height + offset}px`;
    label.style.maxWidth = `${width / Math.max(rows.length, 3) * (width < 450 ? .62 : .44)}px`;
  };

  return {
    setRows,
    resize(nextWidth, nextHeight) {
      if (disposed || nextWidth < 1 || nextHeight < 1) return;
      width = nextWidth; height = nextHeight;
      renderer.setSize(width, height, false);
      composer?.setSize(width, height);
      camera.aspect = width / height;
      if (chart) {
        // Keep all four columns within the frame on narrow screens.
        camera.fov = width / height < 1.2 ? (width < 300 ? 47 : 40) : 28;
      } else {
        camera.fov = 44;
        camera.position.z = width / height < 1 ? 28 : 20;
      }
      camera.updateProjectionMatrix();
    },
    render(time, delta, moving, pointer) {
      if (disposed) return;
      pointerX = THREE.MathUtils.damp(pointerX, pointer.x, 5, delta);
      pointerY = THREE.MathUtils.damp(pointerY, pointer.y, 5, delta);
      if (chart) {
        camera.position.set(4.4 + pointerX * .65, 5.6 - pointerY * .35, 12.5);
        camera.lookAt(0, 1.2, 0);
        camera.updateMatrixWorld();
        if (light) {
          light.position.x = Math.sin(time * .55) * 4;
          light.intensity = 3.5 + Math.sin(time * .55);
        }
        bars.forEach((bar, index) => {
          if (!rows[index]) return;
          bar.height = moving ? THREE.MathUtils.damp(bar.height, bar.target, 5.5, delta) : bar.target;
          bar.mesh.scale.y = bar.height;
          bar.mesh.position.y = bar.height / 2 + .06;
          bar.cap.position.y = bar.height + .06;
          bar.mesh.material.emissive.set("#5e287d");
          bar.mesh.material.emissiveIntensity = .04 + .06 * Math.max(0, Math.sin(time * .55 - index * .65));
          positionLabel(`[data-webgl-value="${index}"]`, bar.mesh.position.x, bar.height + .22, 0, -16);
          positionLabel(`[data-webgl-label="${index}"]`, bar.mesh.position.x, 0, 1.03, 18);
        });
        composer!.render(delta);
      } else {
        ribbon!.update(time, pointerX, pointerY);
        renderer.render(scene, camera);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ribbon?.dispose();
      ownedGeometry.forEach(item => item.dispose());
      ownedMaterial.forEach(item => item.dispose());
      scene.traverse(object => { if (object instanceof THREE.Light && "shadow" in object) (object as THREE.SpotLight).shadow?.dispose(); });
      environment?.dispose(); reflection?.dispose(); bloom?.dispose(); output?.dispose(); renderPass?.dispose(); composer?.dispose();
      scene.clear(); renderer.dispose();
    }
  };
}
