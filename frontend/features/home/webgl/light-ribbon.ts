import * as THREE from "three";

/** Camera-facing ribbons have a soft radial falloff, not a moving solid segment. */
const vertexShader = `
  attribute float along;
  attribute float across;
  varying vec2 vRibbon;
  void main() {
    vRibbon = vec2(along, across);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  uniform float time;
  uniform float seed;
  uniform float strength;
  uniform float broadField;
  uniform vec3 tint;
  varying vec2 vRibbon;
  void main() {
    float u = vRibbon.x;
    float d = abs(vRibbon.y);
    float core = exp(-d * d * 130.0);
    float halo = exp(-d * d * mix(26.0, 18.0, broadField)) * mix(0.30, 0.24, broadField);
    float scatter = exp(-d * d * 4.8) * 0.055;
    // A broad asymmetric pulse rides an always-lit filament. No hard head/tail.
    float phase = fract(u * 0.64 - time * 0.115 + seed);
    float pulse = exp(-pow((phase - 0.5) / 0.13, 2.0));
    float wave = 0.86 + 0.14 * sin(u * 17.0 - time * 0.7 + seed * 20.0);
    float taper = smoothstep(0.0, 0.06, u) * smoothstep(0.0, 0.08, 1.0 - u);
    float pinch = exp(-pow((u - 0.52) / 0.11, 2.0));
    float light = mix(0.26 + pulse * .95 + pinch * .28, 0.34 + pulse * .74, broadField);
    float intensity = light * wave * strength * mix(1.0 - pinch * .36, 1.0, broadField);
    vec3 color = mix(tint, vec3(1.0, 0.94, 1.0), core * 0.86);
    gl_FragColor = vec4(color * intensity, (core + halo + scatter) * taper);
  }
`;

export function createLightRibbon(scene: THREE.Scene, compact: boolean, footer = false) {
  const group = new THREE.Group();
  const materials: THREE.ShaderMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const count = footer ? (compact ? 18 : 32) : (compact ? 44 : 72);
  for (let strand = 0; strand < count; strand++) {
    const fan = (strand / (count - 1) - .5);
    const depth = Math.sin(strand * 2.13) * .65;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    if (footer) {
      curve.add(new THREE.CubicBezierCurve3(new THREE.Vector3(-14, -5 + fan * 3, depth), new THREE.Vector3(-3, 4 + fan, depth), new THREE.Vector3(2, -5 + fan, -depth), new THREE.Vector3(14, 4 + fan * 4, depth)));
    } else {
      // A ribbon bundle turns through a volume, never through one shared pin.
      // Equal, long handles preserve the tangent and give the U-turn a broad radius.
      const bend = new THREE.Vector3(-3.2 + fan * .92, -4.3 + fan * 1.35, .35 + depth * .42);
      const radius = 3.6 + fan * .45;
      curve.add(new THREE.CubicBezierCurve3(new THREE.Vector3(14.5, 9.4 + fan * 10.8, depth), new THREE.Vector3(5.6, 5.9 + fan * 6.5, -depth), new THREE.Vector3(bend.x, bend.y + radius, bend.z), bend));
      curve.add(new THREE.CubicBezierCurve3(bend, new THREE.Vector3(bend.x, bend.y - radius, bend.z), new THREE.Vector3(6.1, -7.9 + fan * 5.9, -depth), new THREE.Vector3(15.5, -10.3 + fan * 10.6, depth)));
    }
    const positions: number[] = [];
    const along: number[] = [];
    const across: number[] = [];
    const indices: number[] = [];
    const segments = compact ? 96 : 160;
    const width = footer ? (strand % 9 === 0 ? .32 : .14 + (strand % 4) * .025) : (strand % 11 === 0 ? .48 : strand % 5 === 0 ? .32 : .19 + (strand % 4) * .03);
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const point = curve.getPoint(u);
      const tangent = curve.getTangent(u);
      const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      const spread = width * (1 + .25 * Math.sin(u * 8 + strand));
      for (const side of [-1, 1]) {
        positions.push(point.x + normal.x * spread * side, point.y + normal.y * spread * side, point.z);
        along.push(u); across.push(side);
      }
      if (i < segments) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
    geometry.setAttribute("across", new THREE.Float32BufferAttribute(across, 1));
    geometry.setIndex(indices);
    const material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 3 }, seed: { value: strand * .173 }, broadField: { value: footer ? 0 : 1 }, strength: { value: footer ? (strand % 9 === 0 ? 1.1 : .58) : (strand % 11 === 0 ? .76 : strand % 5 === 0 ? .58 : .4) }, tint: { value: new THREE.Color(strand % 11 === 3 ? "#8aaaff" : "#c59aef") } }
    });
    group.add(new THREE.Mesh(geometry, material));
    materials.push(material); geometries.push(geometry);
  }
  // A genuinely smooth light field surrounds the bend, bounded to this scene.
  const glowGeometry = new THREE.PlaneGeometry(footer ? 9 : 12, footer ? 8 : 11);
  const glowMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 3 }, broadField: { value: footer ? 0 : 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float time; uniform float broadField; void main(){ vec2 p=(vUv-.5)*2.0; float r=dot(p,p); float swell=.84+.16*sin(time*.62); float fog=exp(-r*mix(5.5,4.2,broadField))*mix(.13,.12,broadField); float halo=exp(-r*mix(42.0,16.0,broadField))*mix(.22,.12,broadField); float core=exp(-r*260.0)*.45*(1.0-broadField); gl_FragColor=vec4(mix(vec3(.58,.32,.83),vec3(1.0,.87,1.0),core*2.0), (fog+halo+core)*swell); }`
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.set(footer ? 1 : -3.2, footer ? -.5 : -4.3, -.2);
  group.add(glow);
  scene.add(group);
  return {
    update(time: number, x: number, y: number) {
      materials.forEach(material => { material.uniforms.time.value = time; });
      glowMaterial.uniforms.time.value = time;
      group.rotation.y = x * .022;
      group.rotation.x = y * .012;
    },
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      glowGeometry.dispose(); glowMaterial.dispose();
      scene.remove(group);
    }
  };
}
