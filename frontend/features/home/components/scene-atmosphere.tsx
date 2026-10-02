/** Original vector atmosphere. No images, video, canvas loop, or external assets. */
const heroThreads = Array.from({ length: 30 }, (_, index) => {
  const fan = index * 13 + Math.sin(index * 1.73) * 18;
  return {
    path: `M1510 ${-170 + fan} C ${1160 + Math.sin(index) * 56} ${60 + fan * .3} ${750 + Math.cos(index * .9) * 34} ${340 + fan * .3} ${541 + Math.sin(index * 1.3) * 3} ${602 + index * .25} C ${440 + Math.cos(index) * 9} ${733 + index * .6} ${950 + Math.sin(index * .6) * 120} ${735 + fan * .55} 1510 ${1020 + fan}`,
    cool: index % 7 === 3,
    opacity: .16 + (index % 5) * .105,
    width: index % 6 === 0 ? 1.7 : index % 3 === 0 ? .85 : .45
  };
});
const footerThreads = Array.from({ length: 22 }, (_, index) => ({
  path: `M-90 ${415 + index * 10 + Math.sin(index) * 22} C ${360 + Math.sin(index * .7) * 95} ${120 + index * 8} ${740 + Math.cos(index * 1.2) * 120} ${610 - index * 8} 1540 ${65 + index * 11}`,
  cool: index % 6 === 1,
  opacity: .18 + index % 4 * .12
}));

export function HeroAtmosphere({ paused }: { paused: boolean }) {
  return <div className="scene-hero-light" data-ambient data-ambient-visible="false" data-playing={!paused} aria-hidden="true"><svg className="scene-light-canvas" viewBox="0 0 1440 920" preserveAspectRatio="xMidYMid slice"><defs>
    <linearGradient id="scene-hero-thread"><stop stopColor="#a575d3" stopOpacity=".06" /><stop offset=".42" stopColor="#d2a7f4" stopOpacity=".72" /><stop offset=".56" stopColor="#fff2ff" /><stop offset=".75" stopColor="#bf80e7" stopOpacity=".5" /><stop offset="1" stopColor="#8a7dcc" stopOpacity="0" /></linearGradient>
    <radialGradient id="scene-pinch-glow"><stop stopColor="#efd8ff" stopOpacity=".65" /><stop offset=".16" stopColor="#d5adf2" stopOpacity=".36" /><stop offset=".5" stopColor="#a876cd" stopOpacity=".08" /><stop offset="1" stopColor="#86629e" stopOpacity="0" /></radialGradient>
  </defs><ellipse className="scene-pinch-bloom" cx="522" cy="660" rx="170" ry="162" fill="url(#scene-pinch-glow)" /><path className="scene-haze" d="M1510 -70 C 1180 80 750 400 543 607 C 442 738 1030 825 1510 1150" />
    {heroThreads.map((thread,index)=><path className={`scene-thread${thread.cool ? " is-cool" : ""}`} key={index} d={thread.path} style={{opacity:thread.opacity,strokeWidth:thread.width}} />)}
    {heroThreads.filter((_,index)=>index % 4 === 0).map((thread,index)=><path className={`scene-travel${thread.cool ? " is-cool" : ""}`} key={index} d={thread.path} pathLength="1000" style={{animationDuration:`${8 + index * .7}s`,animationDelay:`${-index * 1.45}s`}} />)}
    <g className="scene-particles">{Array.from({length:18},(_,index)=><circle className={index % 4 === 0 ? "is-cool" : ""} key={index} cx={570 + index * 53 % 720} cy={70 + index * 137 % 720} r={index % 5 === 0 ? 3 : 1.2} style={{animationDuration:`${6 + index % 5}s`,animationDelay:`${-index * .63}s`}} />)}</g>
  </svg></div>;
}

export function MiddleAtmosphere() {
  return <>
    <div className="scene-middle-strands" aria-hidden="true"><svg viewBox="0 0 1440 2300" preserveAspectRatio="none"><defs><linearGradient id="scene-middle-thread"><stop stopColor="#b98bdd" stopOpacity="0" /><stop offset=".35" stopColor="#d8b7ee" stopOpacity=".34" /><stop offset=".7" stopColor="#a89bdb" stopOpacity=".18" /><stop offset="1" stopColor="#a275bd" stopOpacity="0" /></linearGradient></defs>{Array.from({length:11},(_,index)=><path key={index} d={`M-240 ${290 + index * 7} C ${250 + Math.sin(index) * 80} ${810 + index * 15} ${1320 + Math.cos(index) * 80} ${-100 + index * 5} 1620 ${390 + index * 12} S ${-170 + index * 9} ${940 + index * 12} ${435 + index * 6} ${1570 + index * 4} S 1450 ${1670 + index * 9} 1550 ${2310 + index * 4}`} />)}</svg></div>
    {[1,2].map(index=><div className={`scene-fog scene-fog-${index}`} data-ambient data-ambient-visible="false" aria-hidden="true" key={index}><div className="scene-fog-drift" /><div className="scene-fog-cool" /></div>)}
  </>;
}

/** A broad, softly focused bend joins the evidence rows to the fine footer light. */
export function EvidenceAtmosphere() {
  const bend = "M1310 -170 C950 15 250 90 102 340 C-80 620 395 610 950 800";
  return <div className="scene-evidence-light" data-ambient data-ambient-visible="false" aria-hidden="true"><svg viewBox="0 0 1440 800" preserveAspectRatio="none"><defs><linearGradient id="scene-evidence-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a784c3" stopOpacity=".08" /><stop offset=".38" stopColor="#b495d1" stopOpacity=".4" /><stop offset=".61" stopColor="#eddbff" stopOpacity=".86" /><stop offset="1" stopColor="#a18abe" stopOpacity=".12" /></linearGradient></defs><g className="scene-evidence-ribbon"><path className="scene-evidence-haze" d={bend} /><path className="scene-evidence-core" d={bend} /><path className="scene-evidence-cool" d="M1400 -100 C930 40 260 135 114 345 C-25 540 470 665 1050 850" /></g></svg></div>;
}

export function FooterAtmosphere() {
  return <div className="scene-footer-light" data-ambient data-ambient-visible="false" aria-hidden="true"><svg viewBox="0 0 1440 1000" preserveAspectRatio="none"><defs><linearGradient id="scene-footer-thread"><stop stopColor="#879bdb" stopOpacity=".24" /><stop offset=".4" stopColor="#c99be8" stopOpacity=".7" /><stop offset=".68" stopColor="#f1d6ff" /><stop offset="1" stopColor="#9e78c9" stopOpacity=".12" /></linearGradient></defs><path className="scene-footer-haze" d={footerThreads[9].path} />{footerThreads.map((thread,index)=><path className={`scene-footer-thread${thread.cool ? " is-cool" : ""}`} key={index} d={thread.path} style={{opacity:thread.opacity}} />)}{footerThreads.filter((_,index)=>index % 5 === 0).map((thread,index)=><path className={`scene-travel${thread.cool ? " is-cool" : ""}`} d={thread.path} key={index} pathLength="1000" style={{animationDuration:`${11 + index}s`,animationDelay:`${-index * 2.3}s`}} />)}</svg></div>;
}
