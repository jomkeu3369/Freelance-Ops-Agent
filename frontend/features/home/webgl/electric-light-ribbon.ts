import * as THREE from "three";

// Filaments and their wider light envelopes share one draw call. The centerline
// remains continuous; energy travels through it instead of moving solid bars.
const vertexShader = `
  attribute vec2 ribbon;
  attribute vec2 direction;
  attribute vec3 filament;
  uniform float time;
  uniform vec2 pointer;
  uniform float interaction;
  varying vec2 vRibbon;
  varying vec3 vFilament;
  varying float vField;
  void main() {
    float u = ribbon.x;
    float seed = filament.x;
    vec3 p = position;
    float envelope = sin(u * 3.14159265);
    float drift = sin(u * 18.0 - time * .8 + seed * .7) * .22
                + sin(u * 32.0 - time * 1.2 + seed * 12.0) * .045
                + sin(u * 53.0 - time * 1.65 + seed * 31.0) * .018;
    p.xy += direction * drift * envelope;
    vec2 offset = p.xy - pointer;
    float field = exp(-dot(offset, offset) / 3.2) * interaction;
    float side = dot(offset, direction);
    // Soft, local repulsion preserves the broad turn even under the cursor.
    p.xy += direction * (side / sqrt(side * side + .24)) * field * .78;
    p.z += field * .20;
    vField = field;
    vRibbon = ribbon;
    vFilament = filament;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = `
  uniform float time;
  varying vec2 vRibbon;
  varying vec3 vFilament;
  varying float vField;
  void main() {
    float u = vRibbon.x;
    float d = abs(vRibbon.y);
    float seed = vFilament.x;
    float strength = vFilament.y;
    float veil = vFilament.z;
    float family = floor(seed * 3.0);
    float speed = .075 + family * .014;
    float phase = fract(u - time * speed + family * .29 + fract(seed * 3.0) * .055);
    // Unequal soft leading edges and long decaying wakes, never a hard dash.
    float head = exp(-pow((phase - .58) / .045, 2.0));
    float wake = exp(-pow((phase - .46) / .16, 2.0));
    float second = exp(-pow((fract(u + seed * 2.7 - time * speed * 1.35) - .5) / .08, 2.0));
    float current = .075 + head * 1.08 + wake * .65 + second * .20;
    float weave = .88 + .12 * sin(u * 95.0 - time * 5.0 + seed * 39.0);
    float core = exp(-d * d * 145.0);
    float corona = exp(-d * d * 19.0) * .32;
    float air = exp(-d * d * 5.0) * .09;
    float profile = mix(core + corona + air, exp(-d * d * 3.6) * .34, veil);
    float taper = smoothstep(0.0, .055, u) * smoothstep(0.0, .09, 1.0 - u);
    vec3 violet = mix(vec3(.56, .30, .93), vec3(.45, .64, 1.0), step(.72, fract(seed * 4.1)));
    vec3 color = mix(violet, vec3(.98, .88, 1.0), core * (1.0 - veil) * .77 + head * .12);
    // Compensate where many filaments converge, retaining violet detail instead
    // of clipping the entire bend to a flat white wedge.
    float density = 1.0 - .82 * exp(-pow((u - .49) / .18, 2.0));
    float energy = (current * weave + vField * .12) * strength * density * (1.0 - vField * .22);
    gl_FragColor = vec4(color, profile * energy * taper);
  }
`;

export function createElectricLightRibbon(scene: THREE.Scene, compact: boolean) {
  const positions: number[] = [];
  const ribbons: number[] = [];
  const directions: number[] = [];
  const filaments: number[] = [];
  const indices: number[] = [];
  const count = compact ? 54 : 104;
  const veils = compact ? 6 : 10;
  const segments = compact ? 112 : 220;

  for (let strand = 0; strand < count + veils; strand++) {
    const veil = strand >= count;
    const index = veil ? strand - count : strand;
    const total = veil ? veils : count;
    const seed = (index * .61803398875) % 1;
    const fan = index / (total - 1) - .5;
    const depth = Math.sin(index * 2.13) * (veil ? .6 : 1.05);
    const bend = new THREE.Vector3(-3.2 + fan * 1.18, -4.3 + fan * 1.6, depth * .35);
    const radius = 3.85 + fan * .52;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    curve.add(new THREE.CubicBezierCurve3(new THREE.Vector3(14.5, 9.4 + fan * 11.8, depth), new THREE.Vector3(5.6, 5.9 + fan * 7.2, -depth), new THREE.Vector3(bend.x, bend.y + radius, bend.z), bend));
    curve.add(new THREE.CubicBezierCurve3(bend, new THREE.Vector3(bend.x, bend.y - radius, bend.z), new THREE.Vector3(6.1, -7.9 + fan * 6.4, -depth), new THREE.Vector3(15.5, -10.3 + fan * 11.4, depth)));
    const width = veil ? 1.2 + seed * 1.4 : index % 13 === 0 ? .34 : .12 + seed * .12;
    const strength = veil ? .40 : index % 13 === 0 ? .88 : .30 + seed * .28;
    const start = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const point = curve.getPoint(u);
      const tangent = curve.getTangent(u);
      const normal = new THREE.Vector2(-tangent.y, tangent.x).normalize();
      const spread = width * (1 + .2 * Math.sin(u * 10 + seed * 15));
      for (const side of [-1, 1]) {
        positions.push(point.x + normal.x * spread * side, point.y + normal.y * spread * side, point.z);
        ribbons.push(u, side);
        directions.push(normal.x, normal.y);
        filaments.push(seed, strength, veil ? 1 : 0);
      }
      if (i < segments) {
        const n = start + i * 2;
        indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("ribbon", new THREE.Float32BufferAttribute(ribbons, 2));
  geometry.setAttribute("direction", new THREE.Float32BufferAttribute(directions, 2));
  geometry.setAttribute("filament", new THREE.Float32BufferAttribute(filaments, 3));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthWrite: false, forceSinglePass: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 3 }, pointer: { value: new THREE.Vector2() }, interaction: { value: 0 } }
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Vertex deformation stays inside this allowance at every pointer position.
  geometry.computeBoundingSphere();
  geometry.boundingSphere!.radius += 1.2;
  scene.add(mesh);
  return {
    update(time: number, x: number, y: number, interaction: number) {
      material.uniforms.time.value = time;
      material.uniforms.pointer.value.set(x, y);
      material.uniforms.interaction.value = interaction;
    },
    dispose() {
      geometry.dispose(); material.dispose(); scene.remove(mesh);
    }
  };
}
