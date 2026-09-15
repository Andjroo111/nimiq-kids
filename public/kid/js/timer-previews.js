// nimiq.kids kid app — mini static previews of the timer-style rigs, shared by
// the studio Timer sheet tiles and the Treasure Box item faces. Pure decorative
// snapshots of each rig's placeholder art (colors match the rig CSS defaults).

const SVGS = {
  egg: `
    <svg viewBox="0 0 220 260" xmlns="http://www.w3.org/2000/svg">
      <path d="M110 28 C 152 28 178 82 178 148 C 178 202 148 232 110 232 C 72 232 42 202 42 148 C 42 82 68 28 110 28 Z"
            fill="#fff" stroke="#2E2E48" stroke-width="10" />
      <path d="M62 140 L78 124 L95 148 L112 128 L130 150 L148 130 L162 142" fill="none"
            stroke="#2E2E48" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`,
  maker: `
    <svg viewBox="0 0 220 260" xmlns="http://www.w3.org/2000/svg">
      <rect x="82" y="32" width="56" height="30" rx="10" fill="#FFD66E" stroke="#2E2E48" stroke-width="7" />
      <rect x="30" y="52" width="160" height="150" rx="22" fill="#9FE0DC" stroke="#2E2E48" stroke-width="9" />
      <rect x="46" y="200" width="128" height="18" rx="9" fill="#2E2E48" />
      <circle cx="97" cy="120" r="46" fill="#fff" stroke="#2E2E48" stroke-width="7" />
      <circle cx="97" cy="120" r="34" fill="#FFE9A8" stroke="#E9B213" stroke-width="6" />
      <circle cx="163" cy="90" r="13" fill="#fff" stroke="#21BCA5" stroke-width="6" />
      <path d="M152 162 q 6 -7 12 0 M172 162 q 6 -7 12 0" fill="none" stroke="#2E2E48" stroke-width="5" stroke-linecap="round" />
    </svg>`,
  polaroid: `
    <svg viewBox="0 0 220 260" xmlns="http://www.w3.org/2000/svg">
      <rect x="48" y="104" width="124" height="140" rx="6" fill="#fff" stroke="#B5B8CE" stroke-width="5" />
      <rect x="60" y="116" width="100" height="92" rx="4" fill="#A0BEFF" />
      <circle cx="88" cy="146" r="14" fill="#FFD66E" />
      <path d="M60 190 l30 -26 24 20 20 -14 26 22 v16 H60 Z" fill="#21BCA5" />
      <rect x="14" y="10" width="192" height="86" rx="20" fill="#FFF6E8" stroke="#2E2E48" stroke-width="9" />
      <rect x="14" y="44" width="192" height="16" fill="#21BCA5" />
      <circle cx="110" cy="52" r="30" fill="#2E2E48" />
      <circle cx="110" cy="52" r="18" fill="#5C6284" />
      <rect x="160" y="22" width="26" height="14" rx="5" fill="#FFD66E" stroke="#2E2E48" stroke-width="5" />
      <rect x="46" y="96" width="128" height="10" rx="5" fill="#2E2E48" />
    </svg>`,
};

/** Inline mini preview of a timer style ('egg' | 'maker' | 'polaroid'). */
export function timerPreview(styleId, cls = "") {
  return `<span class="timer-prev ${cls}">${SVGS[styleId] ?? SVGS.egg}</span>`;
}
