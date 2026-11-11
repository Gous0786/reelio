// Original inline SVG illustrations authored for this project (no third-party assets).
export function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 200" className={className} fill="none" role="img" aria-label="A wide video turning into three vertical clips">
      <defs>
        <linearGradient id="hg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#d946ef" /></linearGradient>
        <linearGradient id="hg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient>
      </defs>
      {/* wide source video */}
      <rect x="8" y="58" width="132" height="84" rx="12" fill="#14141f" stroke="#ffffff22" />
      <rect x="16" y="66" width="116" height="68" rx="7" fill="url(#hg2)" opacity=".22" />
      <path d="M62 86v28l26-14z" fill="#fff" opacity=".9" />
      <path d="M16 126q22-16 40-4t38-6 38 8" stroke="#ffffff55" strokeWidth="2" strokeLinecap="round" />
      {/* arrow */}
      <path d="M150 100h26m-8-8 8 8-8 8" stroke="#a78bfa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* vertical clips */}
      {[0, 1, 2].map(i => (
        <g key={i} transform={`translate(${190 + i * 42} ${44 + (i === 1 ? -10 : 0) + (i === 2 ? 8 : 0)})`}>
          <rect width="34" height="60" rx="8" fill="#14141f" stroke="#ffffff22" />
          <rect x="4" y="4" width="26" height="40" rx="5" fill={i === 1 ? 'url(#hg1)' : 'url(#hg2)'} opacity=".5" />
          <path d="M14 18v12l10-6z" fill="#fff" />
          <rect x="4" y="50" width="26" height="3" rx="1.5" fill="#ffffff2a" />
          <rect x="4" y="50" width={[16, 22, 10][i]} height="3" rx="1.5" fill="#a78bfa" />
        </g>
      ))}
      {/* timeline ruler */}
      <g stroke="#ffffff30" strokeLinecap="round">{Array.from({ length: 22 }, (_, i) => <path key={i} d={`M${12 + i * 13} 170v${i % 5 === 0 ? 10 : 5}`} />)}</g>
      <rect x="200" y="164" width="62" height="14" rx="7" fill="#8b5cf6" opacity=".3" stroke="#a78bfa" />
      {/* sparkles */}
      <path d="M296 30l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#f0abfc" />
      <path d="M26 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#7dd3fc" />
    </svg>
  )
}

export function EmptyIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 140" className={className} fill="none" role="img" aria-label="An empty vertical video frame with a magnifying glass">
      <rect x="44" y="12" width="64" height="108" rx="14" fill="#14141f" stroke="#ffffff2a" strokeWidth="2" />
      <rect x="52" y="22" width="48" height="74" rx="8" stroke="#ffffff22" strokeDasharray="4 5" />
      <rect x="62" y="104" width="28" height="4" rx="2" fill="#ffffff22" />
      <circle cx="108" cy="86" r="22" fill="#07070c" stroke="#a78bfa" strokeWidth="4" />
      <path d="M124 102l16 16" stroke="#a78bfa" strokeWidth="6" strokeLinecap="round" />
      <path d="M99 86h18" stroke="#ffffff55" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
