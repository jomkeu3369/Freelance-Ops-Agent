import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

type Box = { x: number; y: number; width: number; height: number };
type Plate = { element?: HTMLElement; mesh: THREE.Mesh; face: THREE.MeshPhysicalMaterial; box: Box; depth: number; z: number };
export type WorkflowRenderer = ReturnType<typeof createWorkflowRenderer>;

/** Real meshes and interactive HTML use exactly the same camera projection. */
export function createWorkflowRenderer(host: HTMLElement, canvas: HTMLCanvasElement, compact: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.debug.onShaderError = () => { throw new Error("Workflow light shader compilation failed"); };
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, compact ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .08);
  scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  const ambient = new THREE.HemisphereLight("#e3cfff", "#1b1229", 1.5);
  scene.add(ambient);
  const key = new THREE.DirectionalLight("#f2dbff", 2.1);
  key.position.set(-350, 460, 600);
  key.castShadow = true;
  key.shadow.mapSize.set(compact ? 512 : 1024, compact ? 512 : 1024);
  Object.assign(key.shadow.camera, { left: -650, right: 650, top: 750, bottom: -750, near: 1, far: 2000 });
  key.shadow.normalBias = .7;
  key.shadow.bias = -.0001;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#b98bff", 1.7);
  rim.position.set(450, -180, 220); scene.add(rim);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const own = <T extends THREE.Material>(value: T) => { materials.add(value); return value; };
  const side = own(new THREE.MeshPhysicalMaterial({ color: "#483055", metalness: .62, roughness: .38, clearcoat: .5, envMapIntensity: .35 }));
  const back = own(new THREE.MeshStandardMaterial({ color: "#130d1d", metalness: .4, roughness: .4 }));
  const plates: Plate[] = [];
  const labelBounds = new Map<Plate, Box>();
  const stageElements = [...host.querySelectorAll<HTMLElement>(".spatial-stage")];
  const laneElements = [...host.querySelectorAll<HTMLElement>(".spatial-lane")];
  const cardElement = host.querySelector<HTMLElement>(".spatial-project-card")!;
  const boardElement = host.querySelector<HTMLElement>(".spatial-board")!;
  const projected = [...stageElements, ...laneElements, cardElement];
  const originalStyles = new Map(projected.map(element => [element, element.style.getPropertyValue("--workflow-projection")]));
  const beamGroup = new THREE.Group(); group.add(beamGroup);
  const beamMaterials: THREE.ShaderMaterial[] = [];
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

  const bounds = (element: HTMLElement): Box => {
    let x = 0, y = 0;
    for (let current: HTMLElement | null = element; current && current !== host; current = current.offsetParent as HTMLElement | null) {
      x += current.offsetLeft; y += current.offsetTop;
    }
    return { x, y, width: element.offsetWidth, height: element.offsetHeight };
  };
  const makePlate = (element: HTMLElement | undefined, z: number, depth: number, color: string) => {
    const face = own(new THREE.MeshPhysicalMaterial({ color, metalness: .38, roughness: .32, clearcoat: .85, clearcoatRoughness: .25, envMapIntensity: .65 }));
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [side, side, side, side, face, back]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    const plate: Plate = { element, mesh, face, z, depth, box: { x: 0, y: 0, width: 0, height: 0 } };
    plates.push(plate);
    return plate;
  };
  const nodes = stageElements.map((element, index) => makePlate(element, [42, 78, 40, 54, 94][index], 20, "#191120"));
  const lanes = laneElements.map(element => makePlate(element, 0, 9, "#15101d"));
  const card = makePlate(cardElement, 64, 26, "#3b264d");
  const graphBase = makePlate(undefined, -10, 10, "#17111f");

  const place = (plate: Plate, box: Box) => {
    if (plate.box.width !== box.width || plate.box.height !== box.height) {
      geometries.delete(plate.mesh.geometry); plate.mesh.geometry.dispose();
      const geometry = new RoundedBoxGeometry(Math.max(1, box.width), Math.max(1, box.height), plate.depth, 3, Math.min(7, plate.depth / 3));
      plate.mesh.geometry = geometry; geometries.add(geometry);
    }
    plate.box = box;
    plate.mesh.position.set(box.x + box.width / 2 - width / 2, height / 2 - box.y - box.height / 2, plate.z);
  };
  const clearBeams = () => {
    beamGeometry.forEach(value => value.dispose()); beamGeometry.length = 0;
    beamMaterials.forEach(value => value.dispose()); beamMaterials.length = 0;
    beamGroup.clear();
  };
  const connect = (start: THREE.Vector3, end: THREE.Vector3, target: number) => {
    const dx = Math.max(26, (end.x - start.x) * .52);
    const curve = new THREE.CubicBezierCurve3(start, start.clone().add(new THREE.Vector3(dx, 0, 22)), end.clone().add(new THREE.Vector3(-dx, 0, 22)), end);
    // Continuous filaments: a broad intensity wave, no translating solid dash.
    for (const halo of [true, false]) {
      const geometry = new THREE.TubeGeometry(curve, compact ? 32 : 56, halo ? 4.5 : .85, 8, false);
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, energy: { value: 0 }, halo: { value: halo ? 1 : 0 } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying vec2 vUv; uniform float time; uniform float energy; uniform float halo;
          void main(){float wave=.5+.5*sin(vUv.x*7.0-time*1.6); float brightness=.24+energy*(.46+wave*.55);
          vec3 color=mix(vec3(.59,.30,.88),vec3(.95,.81,1.),1.-halo);
          gl_FragColor=vec4(color*brightness, mix(.85,.08,halo));}`
      });
      material.userData.target = target;
      beamMaterials.push(material); beamGeometry.push(geometry);
      beamGroup.add(new THREE.Mesh(geometry, material));
    }
    const glowGeometry = new THREE.PlaneGeometry(32, 32);
    const glowMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, energy: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 vUv; uniform float energy; void main(){float r=length(vUv-.5); float glow=exp(-r*r*42.0);gl_FragColor=vec4(.81,.55,1.,glow*(.16+energy*.54));}`
    });
    glowMaterial.userData.target = target;
    const port = new THREE.Mesh(glowGeometry, glowMaterial); port.position.copy(end); port.position.z += 2;
    beamMaterials.push(glowMaterial); beamGeometry.push(glowGeometry); beamGroup.add(port);
  };
  const port = (node: Plate, right: boolean) => new THREE.Vector3(node.mesh.position.x + node.box.width * (right ? .5 : -.5), node.mesh.position.y, node.z + node.depth / 2 + 1);

  // Convert the mesh's face plane to a CSS homography, including perspective.
  // The DOM stays in React's tree and retains native focus/click semantics.
  const project = (plate: Plate, box = plate.box, surfaceHeight = plate.box.height) => {
    const element = plate.element;
    if (!element) return;
    local.makeTranslation(-plate.box.width / 2, surfaceHeight / 2, plate.depth / 2 + .4);
    local.scale(new THREE.Vector3(1, -1, 1));
    transform.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(plate.mesh.matrixWorld).multiply(local);
    const m = transform.elements;
    const x = width / 2 - box.x;
    const y = height / 2 - box.y;
    const k = 1 / m[15];
    const values = [
      (width / 2 * m[0] + x * m[3]) * k, (-height / 2 * m[1] + y * m[3]) * k, 0, m[3] * k,
      (width / 2 * m[4] + x * m[7]) * k, (-height / 2 * m[5] + y * m[7]) * k, 0, m[7] * k,
      0, 0, 1, 0,
      (width / 2 * m[12] + x * m[15]) * k, (-height / 2 * m[13] + y * m[15]) * k, 0, 1
    ];
    element.style.setProperty("--workflow-projection", `matrix3d(${values.join(",")})`);
  };

  return {
    setState(nextStep: number, nextColumn: number) {
      selected = nextStep;
      if (nextColumn !== column) { column = nextColumn; fromX = currentX; transfer = 0; }
    },
    resize() {
      width = host.clientWidth; height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.set(0, 0, height / (2 * Math.tan(THREE.MathUtils.degToRad(19))));
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      nodes.forEach(node => place(node, bounds(node.element!)));
      const board = bounds(boardElement);
      lanes.forEach(lane => {
        const label = bounds(lane.element!);
        labelBounds.set(lane, label);
        place(lane, { ...label, height: board.height });
      });
      place(card, bounds(cardElement));
      const stages = bounds(host.querySelector<HTMLElement>(".spatial-stages")!);
      place(graphBase, { x: stages.x - 4, y: stages.y - 6, width: stages.width + 8, height: stages.height + 12 });
      graphBase.face.transparent = true; graphBase.face.opacity = .72;
      toX = column ? (window.innerWidth <= 580 ? 30 : lanes[1].box.x - lanes[0].box.x) : 0;
      if (!initialized) { currentX = toX; fromX = toX; transfer = 1; initialized = true; }
      clearBeams();
      for (const [from, to] of [[0, 1], [0, 2], [1, 3], [2, 4], [1, 4]]) connect(port(nodes[from], true), port(nodes[to], false), to);
    },
    render(time: number, delta: number, moving: boolean, pointer: { x: number; y: number }) {
      if (disposed) return;
      pointerX = moving ? THREE.MathUtils.damp(pointerX, pointer.x, 6, delta) : 0;
      pointerY = moving ? THREE.MathUtils.damp(pointerY, pointer.y, 6, delta) : 0;
      const small = width < 450;
      group.rotation.set((small ? .13 : .21) + pointerY * .035, (small ? -.14 : -.28) + pointerX * .075, small ? .008 : -.014);
      group.scale.setScalar(small ? .87 : .86);
      group.position.set(small ? -2 : -7, small ? -1 : 10, 0);
      toX = column ? (window.innerWidth <= 580 ? 30 : lanes[1].box.x - lanes[0].box.x) : 0;
      transfer = moving ? Math.min(1, transfer + delta / .85) : 1;
      const ease = transfer < .5 ? 4 * transfer ** 3 : 1 - (-2 * transfer + 2) ** 3 / 2;
      currentX = THREE.MathUtils.lerp(fromX, toX, ease);
      const lift = Math.sin(transfer * Math.PI);
      card.mesh.position.x = card.box.x + card.box.width / 2 - width / 2 + currentX;
      card.mesh.position.z = card.z + lift * 54;
      card.mesh.rotation.y = lift * -.08;
      cardElement.dataset.transferState = transfer < 1 ? "travelling" : "settled";
      nodes.forEach((node, index) => {
        node.face.color.set(index === selected ? "#382446" : index < selected ? "#20162a" : "#17111f");
        node.face.emissive.set(index === selected ? "#8e52af" : "#000000");
        node.face.emissiveIntensity = index === selected ? .12 : 0;
      });
      beamMaterials.forEach(material => {
        material.uniforms.time.value = time;
        material.uniforms.energy.value = material.userData.target === selected ? 1 : material.userData.target < selected ? .4 : .05;
      });
      group.updateMatrixWorld(true);
      nodes.forEach(node => project(node));
      lanes.forEach(lane => project(lane, labelBounds.get(lane)!, lane.box.height));
      project(card);
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearBeams(); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
      key.shadow.dispose(); environment.dispose(); scene.clear(); renderer.dispose();
      originalStyles.forEach((value, element) => {
        if (value) element.style.setProperty("--workflow-projection", value);
        else element.style.removeProperty("--workflow-projection");
      });
    }
  };
}
