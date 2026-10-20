import * as THREE from "three";
import { createWorkflowSurface, surfacePadding, type SurfaceKind } from "./workflow-surface";

type Box = { x: number; y: number; width: number; height: number };
type Plate = {
  element: HTMLElement;
  mesh: THREE.Mesh;
  surface: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  kind: SurfaceKind;
  box: Box;
  depth: number;
  z: number;
};
export type WorkflowRenderer = ReturnType<typeof createWorkflowRenderer>;

/** 실제 메시와 상호작용하는 HTML에 같은 카메라 투영을 적용한다. */
export function createWorkflowRenderer(host: HTMLElement, canvas: HTMLCanvasElement, compact: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.debug.onShaderError = () => {
    throw new Error("Workflow light shader compilation failed");
  };
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, compact ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
  const ambient = new THREE.HemisphereLight("#e3cfff", "#1b1229", 1.5);
  scene.add(ambient);
  const key = new THREE.DirectionalLight("#f2dbff", 2.1);
  key.position.set(-350, 460, 600);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#b98bff", 1.7);
  rim.position.set(450, -180, 220);
  scene.add(rim);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const own = <T extends THREE.Material>(value: T) => {
    materials.add(value);
    return value;
  };
  const side = own(
    new THREE.MeshStandardMaterial({
      color: "#211b2c",
      metalness: 0.15,
      roughness: 0.48,
      transparent: true,
      opacity: 0.64,
      depthWrite: false
    })
  );
  const back = own(
    new THREE.MeshBasicMaterial({ color: "#120e19", transparent: true, opacity: 0.55, depthWrite: false })
  );
  const plates: Plate[] = [];
  const labelBounds = new Map<Plate, Box>();
  const stageElements = [...host.querySelectorAll<HTMLElement>(".spatial-stage")];
  const laneElements = [...host.querySelectorAll<HTMLElement>(".spatial-lane")];
  const cardElement = host.querySelector<HTMLElement>(".spatial-project-card")!;
  const boardElement = host.querySelector<HTMLElement>(".spatial-board")!;
  const projected = [...stageElements, ...laneElements, cardElement];
  const originalStyles = new Map(
    projected.map((element) => [element, element.style.getPropertyValue("--workflow-projection")])
  );
  const beamGroup = new THREE.Group();
  group.add(beamGroup);
  const beamMaterials: THREE.ShaderMaterial[] = [];
  let beamMaterialIndex = 0;
  const beamGeometry: THREE.BufferGeometry[] = [];
  const transform = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  let width = 1;
  let height = 1;
  let selected = 0;
  let column = 0;
  let currentX = 0;
  let fromX = 0;
  let toX = 0;
  let transfer = 1;
  let initialized = false;
  let disposed = false;
  let pointerX = 0;
  let pointerY = 0;
  let previousLayout = "";

  const bounds = (element: HTMLElement): Box => {
    let x = 0,
      y = 0;
    for (
      let current: HTMLElement | null = element;
      current && current !== host;
      current = current.offsetParent as HTMLElement | null
    ) {
      x += current.offsetLeft;
      y += current.offsetTop;
    }
    return { x, y, width: element.offsetWidth, height: element.offsetHeight };
  };
  const makePlate = (element: HTMLElement, z: number, depth: number, kind: SurfaceKind) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [back, side]);
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), own(createWorkflowSurface(kind)));
    geometries.add(surface.geometry);
    surface.position.z = depth / 2 + 0.15;
    mesh.add(surface);
    group.add(mesh);
    const plate: Plate = { element, mesh, surface, kind, z, depth, box: { x: 0, y: 0, width: 0, height: 0 } };
    plates.push(plate);
    return plate;
  };
  const nodes = stageElements.map((element, index) => makePlate(element, [34, 58, 28, 44, 78][index], 6, "node"));
  const lanes = laneElements.map((element) => makePlate(element, 0, 0, "lane"));
  const card = makePlate(cardElement, 56, 8, "card");

  const place = (plate: Plate, box: Box) => {
    if (plate.box.width !== box.width || plate.box.height !== box.height) {
      geometries.delete(plate.mesh.geometry);
      plate.mesh.geometry.dispose();
      const w = box.width / 2,
        h = box.height / 2,
        r = 12;
      const contour = new THREE.Shape();
      contour.moveTo(-w + r, -h);
      contour.lineTo(w - r, -h);
      contour.quadraticCurveTo(w, -h, w, -h + r);
      contour.lineTo(w, h - r);
      contour.quadraticCurveTo(w, h, w - r, h);
      contour.lineTo(-w + r, h);
      contour.quadraticCurveTo(-w, h, -w, h - r);
      contour.lineTo(-w, -h + r);
      contour.quadraticCurveTo(-w, -h, -w + r, -h);
      const geometry =
        plate.kind === "lane"
          ? new THREE.BufferGeometry()
          : new THREE.ExtrudeGeometry(contour, { depth: plate.depth, bevelEnabled: false, curveSegments: 10 });
      if (plate.kind !== "lane") geometry.translate(0, 0, -plate.depth / 2);
      plate.mesh.geometry = geometry;
      geometries.add(geometry);
      plate.surface.scale.set(box.width + surfacePadding * 2, box.height + surfacePadding * 2, 1);
      plate.surface.material.uniforms.size.value.set(box.width, box.height);
    }
    plate.box = box;
    plate.mesh.position.set(box.x + box.width / 2 - width / 2, height / 2 - box.y - box.height / 2, plate.z);
  };
  const clearBeams = () => {
    beamGeometry.forEach((value) => value.dispose());
    beamGeometry.length = 0;
    beamMaterialIndex = 0;
    beamGroup.clear();
  };
  const beamMaterial = (parameters: THREE.ShaderMaterialParameters) => {
    // 크기 변경은 곡선 좌표만 바꾼다. 이미 컴파일한 셰이더는 계속 사용한다.
    const index = beamMaterialIndex++;
    return (beamMaterials[index] ??= new THREE.ShaderMaterial(parameters));
  };
  const connect = (start: THREE.Vector3, end: THREE.Vector3, target: number) => {
    const dx = Math.max(22, (end.x - start.x) * 0.56);
    const curve = new THREE.CubicBezierCurve3(
      start,
      start.clone().add(new THREE.Vector3(dx, 0, 10)),
      end.clone().add(new THREE.Vector3(-dx, 0, 10)),
      end
    );
    // 빛줄기를 끊지 않고 넓은 광량 파동을 적용한다.
    for (const halo of [true, false]) {
      const geometry = new THREE.TubeGeometry(curve, compact ? 32 : 56, halo ? 3 : 0.7, 8, false);
      const material = beamMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, energy: { value: 0 }, halo: { value: halo ? 1 : 0 } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying vec2 vUv; uniform float time; uniform float energy; uniform float halo;
          void main(){float wave=pow(.5+.5*sin(vUv.x*5.0-time*1.2),3.); float brightness=.16+energy*(.48+wave*.4);
          vec3 color=mix(vec3(.48,.34,.72),vec3(.77,.65,.98),1.-halo);
          gl_FragColor=vec4(color*brightness, mix(.68,.055,halo));}`
      });
      material.userData.target = target;
      beamGeometry.push(geometry);
      beamGroup.add(new THREE.Mesh(geometry, material));
    }
    const glowGeometry = new THREE.PlaneGeometry(18, 18);
    const glowMaterial = beamMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, energy: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 vUv; uniform float energy; void main(){float r=length(vUv-.5); float glow=exp(-r*r*34.0);gl_FragColor=vec4(.67,.51,.94,glow*(.05+energy*.2));}`
    });
    glowMaterial.userData.target = target;
    const port = new THREE.Mesh(glowGeometry, glowMaterial);
    port.position.copy(end);
    port.position.z += 2;
    beamGeometry.push(glowGeometry);
    beamGroup.add(port);
  };
  const port = (node: Plate, right: boolean) =>
    new THREE.Vector3(
      node.mesh.position.x + node.box.width * (right ? 0.5 : -0.5),
      node.mesh.position.y,
      node.z + node.depth / 2 + 1
    );

  // 메시의 앞면을 원근이 포함된 CSS 사영 변환으로 바꾼다.
  // DOM은 React 트리에 남겨 기본 포커스와 클릭 동작을 유지한다.
  const project = (plate: Plate, box = plate.box, surfaceHeight = plate.box.height) => {
    const element = plate.element;
    if (!element) return;
    local.makeTranslation(-plate.box.width / 2, surfaceHeight / 2, plate.depth / 2 + 0.4);
    local.scale(new THREE.Vector3(1, -1, 1));
    transform
      .copy(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse)
      .multiply(plate.mesh.matrixWorld)
      .multiply(local);
    const m = transform.elements;
    const x = width / 2 - box.x;
    const y = height / 2 - box.y;
    const k = 1 / m[15];
    const values = [
      ((width / 2) * m[0] + x * m[3]) * k,
      ((-height / 2) * m[1] + y * m[3]) * k,
      0,
      m[3] * k,
      ((width / 2) * m[4] + x * m[7]) * k,
      ((-height / 2) * m[5] + y * m[7]) * k,
      0,
      m[7] * k,
      0,
      0,
      1,
      0,
      ((width / 2) * m[12] + x * m[15]) * k,
      ((-height / 2) * m[13] + y * m[15]) * k,
      0,
      1
    ];
    element.style.setProperty("--workflow-projection", `matrix3d(${values.join(",")})`);
  };

  return {
    prepare() {
      return renderer.compileAsync(scene, camera);
    },
    setState(nextStep: number, nextColumn: number) {
      selected = nextStep;
      if (nextColumn !== column) {
        column = nextColumn;
        fromX = currentX;
        transfer = 0;
      }
    },
    resize() {
      width = host.clientWidth;
      height = host.clientHeight;
      const nodeBounds = nodes.map(node => bounds(node.element!));
      const laneBounds = lanes.map(lane => bounds(lane.element!));
      const board = bounds(boardElement);
      const cardBounds = bounds(cardElement);
      const layout = JSON.stringify([width, height, nodeBounds, laneBounds, board, cardBounds]);
      if (layout === previousLayout) return;
      previousLayout = layout;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.set(0, 0, height / (2 * Math.tan(THREE.MathUtils.degToRad(19))));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      nodes.forEach((node, index) => place(node, nodeBounds[index]));
      lanes.forEach((lane, index) => {
        const label = laneBounds[index];
        labelBounds.set(lane, label);
        place(lane, { ...label, height: board.height });
      });
      place(card, cardBounds);
      toX = column ? (window.innerWidth <= 580 ? 30 : lanes[1].box.x - lanes[0].box.x) : 0;
      if (!initialized) {
        currentX = toX;
        fromX = toX;
        transfer = 1;
        initialized = true;
      }
      clearBeams();
      for (const [from, to] of [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 4],
        [1, 4]
      ])
        connect(port(nodes[from], true), port(nodes[to], false), to);
    },
    render(time: number, delta: number, moving: boolean, pointer: { x: number; y: number }) {
      if (disposed) return;
      pointerX = moving ? THREE.MathUtils.damp(pointerX, pointer.x, 6, delta) : 0;
      pointerY = moving ? THREE.MathUtils.damp(pointerY, pointer.y, 6, delta) : 0;
      const small = width < 450;
      group.rotation.set(
        (small ? 0.1 : 0.17) + pointerY * 0.025,
        (small ? -0.1 : -0.23) + pointerX * 0.055,
        small ? 0.004 : -0.01
      );
      group.scale.setScalar(small ? 0.87 : 0.86);
      group.position.set(small ? -2 : -7, small ? -1 : 10, 0);
      toX = column ? (window.innerWidth <= 580 ? 30 : lanes[1].box.x - lanes[0].box.x) : 0;
      transfer = moving ? Math.min(1, transfer + delta / 0.85) : 1;
      const ease = transfer < 0.5 ? 4 * transfer ** 3 : 1 - (-2 * transfer + 2) ** 3 / 2;
      currentX = THREE.MathUtils.lerp(fromX, toX, ease);
      const lift = Math.sin(transfer * Math.PI);
      card.mesh.position.x = card.box.x + card.box.width / 2 - width / 2 + currentX;
      card.mesh.position.z = card.z + lift * 54;
      card.mesh.rotation.y = lift * -0.08;
      cardElement.dataset.transferState = transfer < 1 ? "travelling" : "settled";
      nodes.forEach((node, index) => {
        const energy = node.surface.material.uniforms.energy;
        const target = index === selected ? 1 : index < selected ? 0.12 : 0;
        energy.value = moving ? THREE.MathUtils.damp(energy.value, target, 6, delta) : target;
      });
      plates.forEach((plate) => {
        plate.surface.material.uniforms.time.value = time;
      });
      card.surface.material.uniforms.energy.value = 0.3 + lift * 0.35;
      beamMaterials.forEach((material) => {
        material.uniforms.time.value = time;
        material.uniforms.energy.value =
          material.userData.target === selected ? 1 : material.userData.target < selected ? 0.4 : 0.05;
      });
      group.updateMatrixWorld(true);
      nodes.forEach((node) => project(node));
      lanes.forEach((lane) => project(lane, labelBounds.get(lane)!, lane.box.height));
      project(card);
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearBeams();
      beamMaterials.forEach((value) => value.dispose());
      beamMaterials.length = 0;
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
      scene.clear();
      renderer.dispose();
      originalStyles.forEach((value, element) => {
        if (value) element.style.setProperty("--workflow-projection", value);
        else element.style.removeProperty("--workflow-projection");
      });
    }
  };
}
