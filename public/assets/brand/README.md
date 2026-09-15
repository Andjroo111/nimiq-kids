# nimiq.kids brand mark

`NIMIQ.kids` — the Nimiq hexagon holding the duotone high-five (a big hand and a small
hand), with an all-caps `NIMIQ` and a lowercase gold `.kids`.

## Files

| File | Use |
|---|---|
| `nimiq-kids-lockup-dark.svg` | **Primary.** Navy surfaces. `NIMIQ.` white, `kids` gold |
| `nimiq-kids-lockup-light.svg` | Light surfaces. Solid navy throughout, `kids` at weight 700 |
| `nimiq-kids-lockup-mono.svg` | Single colour, inherits `currentColor`. Inline it, don't `<img>` it |
| `nimiq-kids-mark.svg` | Hexagon + hands, no wordmark |
| `nimiq-kids-icon-512.svg` | PWA / maskable tile. Shipped as `/icon.svg` |
| `nimiq-kids-favicon.svg` | Browser tab. Shipped as `/favicon.svg` |

## Rules

**Never retype the wordmark.** `NIMIQ` is the verbatim logotype path lifted from Nimiq's
own `logos-nimiq-horizontal`. `.kids` is *outlined* from Mulish 700, so these files need no
font to render correctly. Setting the wordmark as live `<text>` will drift.

**The tracking is 0.0836em, not a guess.** It was solved from the real artwork's own
N-ink-start to Q-ink-end span; the model reproduces the Q's ink edge to within 0.01% of cap
height. Mulish 700 is the matching weight (stem/cap 0.1818 against the artwork's 0.1836, a
1% match; 600 is off 7.8%, 800 off 9.0%). The `Q` is genuinely custom, about 6% wider than
Mulish's, which is why the real path is kept rather than typeset.

**The period spacing is measured against Mulish, not eyeballed.** The `NIMIQ` logotype is
tracked much wider than the outlined `.kids`, and the join between them was never tuned, so
the period inherited the wide gap on its left and Mulish's tight sidebearing on its right.
The ground truth: setting `NIMIQ.kids` in real Mulish 700 at this file's own 0.0836em gives
`Q` to period = **0.1655** and period to `k` = **0.2158**, both as a fraction of the
wordmark's ink height. Note the period sits *closer to the Q than to the k*, which is normal
typography and the opposite of what centring it in the gap produces. Measured on a 1600px
render, the original artwork was 12px too loose before the period and 21px too tight after
it. Each lockup now carries a `translate` on the period path and another on the `.kids` run
that lands both gaps within 0.4px of Mulish. If the emitter is rerun, fold this in.

**The lockup uses the SOLID hand, not the high five.** This file already said to drop to the
solid glyph below ~48px. In the site header the lockup renders at 176px wide, which puts the
hexagon at **30.7px**, well under that line, and the eight parallel strokes of the high five
merged into a smudge on a phone. All three lockups now carry the same solid `hand` group the
favicon uses, transplanted verbatim rather than redrawn. The high five remains correct at
large sizes; if a big lockup is ever needed, take it back from git history.

**The suffix is Mulish 700 on every surface, and that is a FLEET rule, not a kids one.**
Every `NIMIQ.x` mark sets the run after the dot at 700 — `.cool` and `.ninja` measure 700,
and so do the dark and mono lockups here. The light file used to set `kids` at 400, which
split the sub-brand the way `logos-developer-center-horizontal` splits its own, but it also
made kids the one mark in the fleet whose suffix changed thickness between its own two
files. Weight is now fixed and colour is the only thing that varies. Measure before you
trust a claim like this: ink area over ink height squared is scale-invariant for a fixed
string and rises monotonically with weight, so the shipped artwork reads straight off a
curve built from the variable font.

**Gold `kids` is for dark surfaces only.** Gold on white is 1.94:1 and fails WCAG at every
size, so the light lockup is solid navy end to end — never gold, and never a dimmed grey.
That leaves the light variant with no sub-brand split in the type at all; the gold hexagon
is what carries it there.

**Never invert the hexagon.** It is always the gold radial gradient. A navy hexagon is not a
variant, it breaks the brand mark.

**There is no navy app tile.** Nimiq's own icons are a gold hexagon on `#F6F6F8` at 68.9% of
the canvas (`apple-touch-icon.png`), or full-bleed with no tile (`android-chrome`). These
ship full-bleed.

**The hands are optically corrected.** `duotone-high-five` ships at stroke 1.2 with its
second hand at 40% opacity; at logo scale on gold that hand disappears. The lockups use
stroke 1.5 / 60%.

**Stroked hands in the lockup, the SOLID `hand` glyph below ~48px.** Two overlapping hands
is eight parallel strokes and they merge small; a stroke/fit sweep from 1.5/56% to 3.2/92%
failed at every setting (thin scribbles, thick blobs). Dropping to one stroked hand was not
enough either: an *outline* thinner than a pixel fills in and smears. `/icon.svg` and
`/favicon.svg` therefore use the solid `hand` icon, which is a different real Nimiq glyph,
not a redraw of the high five.

**The hand is navy, never a white knockout.** Navy on gold is 7.79:1; white on gold is
1.94:1, the same failing ratio as gold on white. In a light Chrome tab strip a white
knockout reads as an undifferentiated gold blob. Note the hexagon itself is only 1.48:1
against a light tab strip (true of Nimiq's own favicon too), so the internal contrast is
what carries recognition at tab size.

## Source of truth

Regenerated by the emitter used to build them; the geometry constants (cap height 10.688,
baseline 14.344, `N` ink start 27.76, `Q` ink end 75.99) come from
`logos-nimiq-horizontal` in the `nimiq-branding-cli` asset library. The `.kids` outlines
were cross-checked glyph-for-glyph against that library's own Mulish and match exactly.
