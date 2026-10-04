import * as THREE from "three";

export type SurfaceKind = "node" | "lane" | "card";
export const surfacePadding = 14;

/** One antialiased contour replaces the front/back wireframe around each pane. */
export function createWorkflowSurface(kind: SurfaceKind) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      time: { value: 0 }, energy: { value: 0 }, size: { value: new THREE.Vector2(1, 1) },
      kind: { value: kind === "lane" ? 1 : kind === "card" ? 2 : 0 },
      base: { value: new THREE.Color(kind === "card" ? "#19151f" : "#141219") },
      top: { value: new THREE.Color(kind === "card" ? "#32243f" : "#25202e") },
      tint: { value: new THREE.Color("#bca2f0") }
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec2 vUv;
      uniform float time, energy, kind;
      uniform vec2 size;
      uniform vec3 base, top, tint;
      float roundedRect(vec2 p, vec2 halfSize, float radius) {
        vec2 q=abs(p)-halfSize+radius;
        return min(max(q.x,q.y),0.)+length(max(q,0.))-radius;
      }
      void main(){
        vec2 extent=size+${surfacePadding * 2}.;
        vec2 p=(vUv-.5)*extent;
        vec2 uv=p/size+.5;
        float lane=1.-step(.5,abs(kind-1.));
        float card=step(1.5,kind);
        float d=roundedRect(p,size*.5,12.);
        float aa=max(fwidth(d)*.65,.35);
        float inside=1.-smoothstep(-aa,aa,d);
        float rim=1.-smoothstep(.55-aa,.55+aa,abs(d+.7));
        float corner=exp(-dot((uv-vec2(.12,1.))*vec2(1.,1.4),(uv-vec2(.12,1.))*vec2(1.,1.4))*3.);
        float reflection=exp(-pow((uv.x*.55+uv.y*.8-.86)*5.,2.));
        vec3 color=mix(base,top,clamp(uv.y,0.,1.)*.65);
        color+=tint*(corner*(.018+energy*.075)+reflection*.008)*(1.-lane);
        float edgeLight=(.075+corner*.38+energy*.19)*(1.-lane);
        color=mix(color,tint,rim*edgeLight);
        // Only the active pane carries a quiet, broad light sweep.
        float sweep=exp(-pow((uv.y-fract(time*.045))*12.,2.));
        color+=tint*sweep*energy*.012*(1.-lane);
        float alpha=mix(.94,.98,card)*inside;
        alpha=mix(alpha,inside*(.06+.20*pow(clamp(uv.y,0.,1.),2.)),lane);
        float glow=exp(-max(d,0.)/4.)*(.008+energy*.055)*(1.-inside)*(1.-lane);
        color=mix(color,tint,1.-inside);
        gl_FragColor=vec4(color,alpha+glow);
        #include <colorspace_fragment>
      }`
  });
}
