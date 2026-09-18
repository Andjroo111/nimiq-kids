// nimiq.kids — confetti rig (canvas particles) for the timer hatch/celebration.
// Vanilla ES module, no deps. Fully parametric: one flexible emitter driven by a
// params object, so the playground (/kid/confetti-demo.html) can expose every dial.
//
// Reference feel (Andjroo, 2026-07-20/21): each "pop" is TWO+ concentric ring OUTLINES
// of radial ticks (one color per ring), a big pop on the subject + smaller pops
// elsewhere, two colors per burst. Every number below is a knob.
//
// API: createConfetti(canvas) ->
//   { fire(params), renderAt(ms, params), stop(), clear() }
// Params: see makeDefaults(). PARAMS describes each slider (min/max/step/group).

// PARAMS drives the playground UI (auto-generated sliders). Keep in sync with defaults.
export const PARAMS = [
  { key: "pops",           label: "Pops",             min: 1,  max: 6,    step: 1,    group: "Layout" },
  { key: "spread",         label: "Spread",           min: 0,  max: 1,    step: 0.05, group: "Layout" },
  { key: "mainScale",      label: "Main pop size",    min: 0.5, max: 2,   step: 0.05, group: "Layout" },
  { key: "secondaryScale", label: "Small pop size",   min: 0.2, max: 1.2, step: 0.05, group: "Layout" },
  { key: "rings",          label: "Rings per pop",    min: 1,  max: 4,    step: 1,    group: "Rings"  },
  { key: "ticksPerRing",   label: "Ticks per ring",   min: 4,  max: 40,   step: 1,    group: "Rings"  },
  { key: "innerRadius",    label: "Inner radius",     min: 8,  max: 80,   step: 1,    group: "Rings"  },
  { key: "ringGap",        label: "Ring gap",         min: 2,  max: 50,   step: 1,    group: "Rings"  },
  { key: "speed",          label: "Expand speed",     min: 20, max: 340,  step: 5,    group: "Motion" },
  { key: "speedJitter",    label: "Speed jitter",     min: 0,  max: 0.4,  step: 0.01, group: "Motion" },
  { key: "spin",           label: "Spin",             min: 0,  max: 12,   step: 0.2,  group: "Motion" },
  { key: "gravity",        label: "Gravity",          min: 0,  max: 1200, step: 20,   group: "Motion" },
  { key: "drag",           label: "Drag",             min: 0,  max: 4,    step: 0.1,  group: "Motion" },
  { key: "life",           label: "Lifetime (s)",     min: 0.4, max: 2.5, step: 0.05, group: "Motion" },
  { key: "tickLength",     label: "Tick length",      min: 3,  max: 30,   step: 0.5,  group: "Particle" },
  { key: "tickThickness",  label: "Tick thickness",   min: 1,  max: 8,    step: 0.5,  group: "Particle" },
  { key: "squareRatio",    label: "Square ratio",     min: 0,  max: 1,    step: 0.05, group: "Particle" },
  { key: "strays",         label: "Strays per pop",   min: 0,  max: 20,   step: 1,    group: "Particle" },
  { key: "burstInterval",  label: "Burst interval ms",min: 120,max: 1200, step: 20,   group: "Celebrate" },
  { key: "burstPops",      label: "Pops per burst",   min: 1,  max: 4,    step: 1,    group: "Celebrate" },
];

// Approved celebration config (Andjroo, 2026-07-21). These ARE the values the real
// timer-finish celebrate() uses; the playground starts + resets here. Tuned deltas
// from the first pass: tickLength 12->6 (shorter ticks), burstInterval 480->660.
export function makeDefaults() {
  return {
    pops: 3, spread: 0.55, mainScale: 1, secondaryScale: 0.5,
    rings: 2, ticksPerRing: 18, innerRadius: 24, ringGap: 20,
    speed: 120, speedJitter: 0.06, spin: 0, gravity: 0, drag: 1.5, life: 1.1,
    tickLength: 6, tickThickness: 3.5, squareRatio: 0.12, strays: 6,
    burstInterval: 660, burstPops: 2,
    // ⚠️ THE BRAND'S FOUR PAINTS, in the order the rings rotate through them (two per
    // burst: inner + outer). Andjroo, 2026-09-18: "everything needs to be updated,
    // including the confetti." blurple, yolk, grass, coral: ~/.claude/brands.json nimiq.kids.
    radial: true, colors: ["#5465EE", "#FED56C", "#1B985E", "#DD675D"], seed: 7,
  };
}

// mulberry32 — tiny seeded PRNG so a burst is reproducible for screenshots/replays.
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One particle: a dash (or square) that flies, maybe spins, and fades. Spawns at
// radius startR along its angle so a ring reads as an outline immediately.
function makeParticle(rng, ox, oy, angle, speed, color, p) {
  const startR = p.startR ?? 0;
  const radial = p.radial ?? true;
  const square = rng() < p.squareRatio;
  const len = p.tickLength * (0.8 + rng() * 0.4);
  const thick = p.tickThickness * (0.8 + rng() * 0.4);
  return {
    x: ox + Math.cos(angle) * startR,
    y: oy + Math.sin(angle) * startR,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rot: radial ? angle : rng() * Math.PI,
    vrot: radial ? (rng() - 0.5) * p.spin : (rng() - 0.5) * Math.max(4, p.spin),
    w: square ? thick : len,
    h: thick,
    color,
    gravity: p.gravity,
    life: 0,
    maxLife: p.life * (0.75 + rng() * 0.5),
  };
}

function colorsOf(p) {
  const cs = (p.colors || []).filter(Boolean);
  return cs.length ? cs : ["#5465EE"];
}

// ONE pop at (ox,oy): `rings` concentric ring outlines (one color per ring) + strays.
function emitPop(p, rng, ox, oy, scale, cols) {
  const parts = [];
  for (let r = 0; r < p.rings; r++) {
    const radius = (p.innerRadius + r * p.ringGap) * scale;
    const N = Math.max(3, Math.round(p.ticksPerRing * scale));
    const col = cols[r % cols.length];
    const sp = (p.speed + r * p.speed * 0.25) * scale;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rng() * 0.04;
      const jit = 1 + (rng() - 0.5) * 2 * p.speedJitter;
      parts.push(makeParticle(rng, ox, oy, a, sp * jit, col, { ...p, startR: radius }));
    }
  }
  const strays = Math.round(p.strays * scale);
  for (let k = 0; k < strays; k++) {
    const a = rng() * Math.PI * 2;
    parts.push(makeParticle(rng, ox, oy, a, (30 + rng() * 90) * scale,
      cols[(rng() * cols.length) | 0], { ...p, startR: 8 * scale, radial: false }));
  }
  return parts;
}

// One-shot burst: `pops` locations (first centered on the subject, rest scattered).
function emitConfetti(p, rng, w, h) {
  const parts = [];
  const cx = w / 2;
  const cy = h * 0.42;
  const cols = colorsOf(p);
  for (let popI = 0; popI < p.pops; popI++) {
    const isMain = popI === 0;
    const scale = isMain ? p.mainScale : p.secondaryScale;
    let ox = cx, oy = cy;
    if (!isMain) {
      const ang = rng() * Math.PI * 2;
      const dist = p.spread * Math.min(w, h) * (0.25 + rng() * 0.28);
      ox = cx + Math.cos(ang) * dist;
      oy = cy + Math.sin(ang) * dist;
    }
    parts.push(...emitPop(p, rng, ox, oy, scale, cols));
  }
  return parts;
}

export function createConfetti(canvas) {
  const ctx = canvas.getContext("2d");
  let particles = [];
  let active = makeDefaults();
  let raf = 0;
  let last = 0;
  let celebrateTimer = 0;   // interval handle for the continuous show
  let celebrating = false;
  let colorIdx = 0;         // rotates the palette so each pop's colors change

  function sizeToCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height };
  }

  function step(dt) {
    const drag = active.drag ?? 1.5;
    for (const p of particles) {
      p.life += dt;
      p.vx -= p.vx * drag * dt;
      p.vy -= p.vy * drag * dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
    }
    particles = particles.filter((p) => p.life < p.maxLife);
  }

  function paint(w, h) {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const r = canvas.getBoundingClientRect();
    step(dt);
    paint(r.width, r.height);
    if (particles.length) raf = requestAnimationFrame(loop);
    else raf = 0;
  }

  function fire(params = {}) {
    celebrating = false; clearTimeout(celebrateTimer);
    active = { ...makeDefaults(), ...params };
    const { w, h } = sizeToCanvas();
    particles = emitConfetti(active, makeRng(active.seed ?? ((Math.random() * 1e9) | 0)), w, h);
    last = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  // Integrate to an exact elapsed time and paint one frame (scrubber / screenshots).
  function renderAt(ms, params = {}) {
    celebrating = false; clearTimeout(celebrateTimer);
    active = { ...makeDefaults(), ...params };
    const { w, h } = sizeToCanvas();
    particles = emitConfetti(active, makeRng(active.seed ?? 7), w, h);
    const fixed = 1 / 120;
    for (let t = 0; t < ms / 1000; t += fixed) step(fixed);
    paint(w, h);
    cancelAnimationFrame(raf); raf = 0;
  }

  // Two consecutive palette colors (inner + outer ring), advancing each call so a
  // sustained show cycles through the colors instead of repeating one pair.
  function nextColors() {
    const cs = colorsOf(active);
    const pair = [cs[colorIdx % cs.length], cs[(colorIdx + 1) % cs.length]];
    colorIdx++;
    return pair;
  }

  // Continuous celebration: keep spawning pops at DIFFERENT random locations with
  // ROTATING colors, on `burstInterval`, until stop() (e.g. while the music plays).
  function celebrate(params = {}) {
    active = { ...makeDefaults(), ...params };
    const { w, h } = sizeToCanvas();
    const rng = makeRng(active.seed ?? ((Math.random() * 1e9) | 0));
    particles = [];
    colorIdx = 0;
    celebrating = true;
    clearTimeout(celebrateTimer);

    const tick = () => {
      if (!celebrating) return;
      const n = Math.max(1, Math.round(active.burstPops));
      for (let i = 0; i < n; i++) {
        const ox = w * (0.12 + rng() * 0.76);
        const oy = h * (0.12 + rng() * 0.64);
        const scale = active.secondaryScale + rng() * (active.mainScale - active.secondaryScale + 0.2);
        particles.push(...emitPop(active, rng, ox, oy, scale, nextColors()));
      }
      if (!raf) { last = 0; raf = requestAnimationFrame(loop); }
      celebrateTimer = setTimeout(tick, active.burstInterval);
    };
    tick();
  }

  function stop() {
    celebrating = false;
    clearTimeout(celebrateTimer);
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function clear() {
    stop();
    particles = [];
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
  }

  return { fire, renderAt, celebrate, stop, clear, isCelebrating: () => celebrating };
}
