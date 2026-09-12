export function PetArt({ kind, state = "idle" }: { kind: string; state?: string }) {
  return (
    <svg className={`pet-art pet-${kind} pet-${state}`} viewBox="0 0 140 128" fill="none" aria-hidden="true">
      <ellipse cx="70" cy="117" rx="39" ry="7" fill="currentColor" opacity=".08" />
      <g className="pet-body" stroke="#383345" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {kind === "cat" ? <>
          <path d="M102 102q34-5 22-28q-8-8-11 2" stroke="#c88c66" strokeWidth="12" />
          <ellipse cx="70" cy="88" rx="30" ry="27" fill="#e6ad88" />
          <path d="M38 52L39 20L60 34Q72 30 83 35L103 21L105 57Q103 82 70 84Q36 80 38 52Z" fill="#f3c8a7" />
          <path d="M44 39L44 29L54 39M89 40L98 30L99 44" stroke="#bd7c77" strokeWidth="4" />
          <path d="M43 60L25 57M43 67L27 71M98 60L115 57M98 68L113 72" strokeWidth="2" />
          <path d="M64 63L70 68L76 63" fill="#a66d75" />
          <path d="M70 69v5m0-1q-5 5-9 0m9 0q5 5 9 0" />
        </> : kind === "turtle" ? <>
          <ellipse cx="70" cy="91" rx="37" ry="27" fill="#a2c5a1" />
          <path d="M42 89L56 76L79 76L96 91L80 105H57Z" fill="#79a982" />
          <path d="M57 77L60 93L80 104M60 93L80 78M60 93L43 100" stroke="#608a6d" />
          <ellipse cx="70" cy="49" rx="29" ry="26" fill="#d2e4b7" />
          <path d="M37 104L31 112M103 104L109 112" stroke="#d2e4b7" strokeWidth="13" />
          <path d="M62 64q8 7 16 0" />
        </> : <>
          <path d="M37 53L38 26L58 34Q70 29 82 34L102 26L103 54Q117 108 71 113Q24 107 37 53Z" fill="#b8a9dd" />
          <ellipse cx="70" cy="83" rx="24" ry="25" fill="#e8e0f4" stroke="none" />
          <path d="M37 69q-14 14 0 34M103 69q14 14 0 34" fill="#9583bf" />
          <circle cx="54" cy="53" r="17" fill="#faf4df" /><circle cx="86" cy="53" r="17" fill="#faf4df" />
          <path d="M64 65L70 73L76 65Z" fill="#eab772" />
          <path d="M57 90l4 4l4-4m10 0l4 4l4-4" stroke="#b8a9dd" />
        </>}
        <g className="pet-eyes" fill="#383345" stroke="none"><ellipse cx="55" cy="53" rx="3.2" ry="5" /><ellipse cx="85" cy="53" rx="3.2" ry="5" /></g>
        <path d="M51 113h12m14 0h12" strokeWidth="6" />
      </g>
      {state === "working" && <g className="pet-paper"><rect x="91" y="85" width="29" height="32" rx="4" fill="#fffaf1" stroke="#bdb3a5" /><path d="M98 94h15m-15 7h12m-12 7h9" stroke="#8a8198" strokeWidth="2" /></g>}
      {state === "waiting" && <g><circle cx="114" cy="24" r="13" fill="#ffdea2" /><text x="114" y="30" textAnchor="middle" fontSize="18" fill="#594026">?</text></g>}
    </svg>
  );
}
