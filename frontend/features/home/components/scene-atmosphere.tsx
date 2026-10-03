/** Original atmosphere: live hero vectors and bundled, prerendered lower glows. */
const heroThreads = Array.from({ length: 46 }, (_, index) => {
  const fan = index * 8.4 + Math.sin(index * 1.73) * 18;
  return {
    path: `M1510 ${-170 + fan} C ${1160 + Math.sin(index) * 56} ${60 + fan * .3} ${750 + Math.cos(index * .9) * 34} ${340 + fan * .3} ${541 + Math.sin(index * 1.3) * 3} ${602 + index * .25} C ${440 + Math.cos(index) * 9} ${733 + index * .6} ${950 + Math.sin(index * .6) * 120} ${735 + fan * .55} 1510 ${1020 + fan}`,
    cool: index % 17 === 6,
    soft: index % 11 === 5,
    opacity: .56 + (index % 5) * .1,
    width: index % 11 === 5 ? 7 : index % 9 === 0 ? 3.4 : index % 4 === 0 ? 1.8 : index % 3 === 0 ? 1.1 : .65
  };
});
const footerThreads = Array.from({ length: 22 }, (_, index) => ({
  path: `M-90 ${415 + index * 10 + Math.sin(index) * 22} C ${360 + Math.sin(index * .7) * 95} ${120 + index * 8} ${740 + Math.cos(index * 1.2) * 120} ${610 - index * 8} 1540 ${65 + index * 11}`,
  cool: index % 6 === 1,
  opacity: .24 + index % 4 * .14
}));
// Unequal, adjacent bundles share a light envelope, so illumination moves through
// the fan instead of every strand blinking independently or the whole page fading.
const heroThreadGroups = [heroThreads.slice(0, 12), heroThreads.slice(12, 29), heroThreads.slice(29)];
// The hot core follows the middle filament through the same bend, with tapered ends.
const heroBendCore = "M711.2 450.9 C645.0 505.0 586.6 558.5 538.0 607.8 C509.2 646.7 537.7 682.8 603.5 722.9";

export function HeroAtmosphere({ paused }: { paused: boolean }) {
  return <div className="scene-hero-light" data-ambient data-ambient-visible="false" data-playing={!paused} aria-hidden="true"><svg className="scene-light-canvas" viewBox="0 0 1440 920" preserveAspectRatio="xMidYMid slice"><defs>
    <linearGradient id="scene-hero-thread"><stop stopColor="#e0c5fb" stopOpacity=".82" /><stop offset=".3" stopColor="#f5e8ff" /><stop offset=".56" stopColor="#fffaff" /><stop offset=".8" stopColor="#d3b3f0" stopOpacity=".88" /><stop offset="1" stopColor="#b5a4e4" stopOpacity=".42" /></linearGradient>
    <linearGradient id="scene-bend-core" gradientUnits="userSpaceOnUse" x1="0" y1="450" x2="0" y2="724"><stop stopColor="#e4c8ff" stopOpacity="0" /><stop offset=".3" stopColor="#f7edff" stopOpacity=".7" /><stop offset=".58" stopColor="#ffffff" /><stop offset=".78" stopColor="#fff5ff" /><stop offset="1" stopColor="#dcc0f7" stopOpacity="0" /></linearGradient>
    <radialGradient id="scene-pinch-glow"><stop stopColor="#fff6ff" /><stop offset=".12" stopColor="#eed8ff" stopOpacity=".87" /><stop offset=".4" stopColor="#c6a0e7" stopOpacity=".36" /><stop offset="1" stopColor="#9670b6" stopOpacity="0" /></radialGradient>
    <radialGradient id="scene-pinch-hotspot"><stop stopColor="#fffaff" stopOpacity=".94" /><stop offset=".3" stopColor="#f0ddff" stopOpacity=".62" /><stop offset="1" stopColor="#cda2ed" stopOpacity="0" /></radialGradient>
    <radialGradient id="scene-hero-aura"><stop stopColor="#debef7" stopOpacity=".45" /><stop offset=".42" stopColor="#b58bdd" stopOpacity=".19" /><stop offset="1" stopColor="#86629e" stopOpacity="0" /></radialGradient>
  </defs><g className="scene-hero-arrival">
    <ellipse className="scene-local-aura" cx="1060" cy="330" rx="390" ry="230" fill="url(#scene-hero-aura)" />
    <path className="scene-haze" d="M1510 -70 C 1180 80 750 400 543 607 C 442 738 1030 825 1510 1150" />
    <g className="scene-pinch-arrival"><ellipse className="scene-pinch-bloom" cx="522" cy="660" rx="205" ry="182" fill="url(#scene-pinch-glow)" /><path className="scene-bend-halo" d={heroBendCore} /><ellipse className="scene-pinch-hotspot" cx="531" cy="642" rx="76" ry="70" fill="url(#scene-pinch-hotspot)" /></g>
    {heroThreadGroups.map((threads, group) => <g className="scene-filament-cluster" key={group} style={{ animationDelay: `${-group * 1.45}s` }}>{threads.map((thread, index) => <path className={`scene-thread${thread.cool ? " is-cool" : ""}${thread.soft ? " is-soft" : ""}`} key={index} d={thread.path} style={{ opacity: thread.opacity, strokeWidth: thread.width }} />)}</g>)}
    <g className="scene-pinch-arrival"><path className="scene-bend-core" d={heroBendCore} /><path className="scene-travel scene-bend-travel" d={heroBendCore} pathLength="1000" style={{ animationDuration: "3.6s", animationDelay: "-1.3s" }} /></g>
    {heroThreads.filter((_,index)=>index % 6 === 0).map((thread,index)=><path className={`scene-travel${thread.cool ? " is-cool" : ""}`} key={index} d={thread.path} pathLength="1000" style={{animationDuration:`${8 + index * .7}s`,animationDelay:`${-index * 1.45}s`}} />)}
    <g className="scene-particles">{Array.from({length:18},(_,index)=><circle className={index % 4 === 0 ? "is-cool" : ""} key={index} cx={570 + index * 53 % 720} cy={70 + index * 137 % 720} r={index % 5 === 0 ? 3 : 1.2} style={{animationDuration:`${6 + index % 5}s`,animationDelay:`${-index * .63}s`}} />)}</g>
  </g></svg></div>;
}

export function MiddleAtmosphere() {
  return <>
    <div className="scene-middle-strands" aria-hidden="true"><svg viewBox="0 0 1440 2300" preserveAspectRatio="none"><defs><linearGradient id="scene-middle-thread"><stop stopColor="#b98bdd" stopOpacity="0" /><stop offset=".35" stopColor="#d8b7ee" stopOpacity=".34" /><stop offset=".7" stopColor="#a89bdb" stopOpacity=".18" /><stop offset="1" stopColor="#a275bd" stopOpacity="0" /></linearGradient></defs>{Array.from({length:11},(_,index)=><path key={index} d={`M-240 ${290 + index * 7} C ${250 + Math.sin(index) * 80} ${810 + index * 15} ${1320 + Math.cos(index) * 80} ${-100 + index * 5} 1620 ${390 + index * 12} S ${-170 + index * 9} ${940 + index * 12} ${435 + index * 6} ${1570 + index * 4} S 1450 ${1670 + index * 9} 1550 ${2310 + index * 4}`} />)}</svg></div>
    {[1,2].map(index=><div className={`scene-fog scene-fog-${index}`} data-ambient data-ambient-visible="false" aria-hidden="true" key={index}><div className="scene-fog-drift" /><div className="scene-fog-cool" /></div>)}
  </>;
}

/** A broad, softly focused bend joins the evidence rows to the fine footer light. */
export function EvidenceAtmosphere() {
  return <div className="scene-evidence-light" data-ambient data-ambient-visible="false" aria-hidden="true"><div className="scene-evidence-ribbon scene-evidence-material" /></div>;
}

export function FooterAtmosphere() {
  return <div className="scene-footer-light" data-ambient data-ambient-visible="false" aria-hidden="true"><div className="scene-footer-material" /><svg viewBox="0 0 1440 1000" preserveAspectRatio="none">
    {footerThreads.filter((_,index)=>index === 9).map((thread,index)=><path className="scene-travel" d={thread.path} key={index} pathLength="1000" style={{animationDuration:"11s",animationDelay:"-2.3s"}} />)}
  </svg></div>;
}
