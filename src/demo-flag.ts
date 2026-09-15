// Does THIS instance hand out demo households?
//
// One line, its own file, because having it written down twice broke the demo in production.
//
// WHAT HAPPENED. The flag was renamed `HATCH_DEMO_SEED` -> `HATCH_DEMO_ENABLED` ("it is a
// FLAG, not a seed"). `demoSeedEnabled` in routes/demo.ts was updated to accept both names,
// so everything demo-FACING kept working: `/health` reported `demo: true`, `/demo` minted
// households, the kid app knew it was on a demo instance. But `parentAuth` in auth.ts had its
// own private copy that read only the OLD name, and it was not updated.
//
// So on the live demo instance `parentAuth`'s demo branch was silently dead, and EVERY
// on-tablet approval answered 401 — the routine path in waiting.js as much as the chore path.
// The demo's entire point is that a visitor plays both parts and watches NIM land, and the
// one call that lands it had been refusing for as long as the rename.
//
// It stayed invisible because nothing disagreed OUT LOUD: the instance said `demo: true`,
// the household carried `demo_at`, the kid app offered the tap, and only the last call in
// the chain knew it was on a different flag.
//
// Both names, forever. The live env files are edited separately from a deploy, so requiring
// them to change together would mean a flag day where whichever landed second switched the
// judge demo off.
export const demoSeedEnabled = () =>
  process.env.HATCH_DEMO_ENABLED === "1" || process.env.HATCH_DEMO_SEED === "1";
