# nimiq.kids: Rive Animation for the Hatch Moment
## Draft funding proposal to the Nimiq Community Council
**Draft v1, 2026-08-03. Not yet submitted.** Fill every `[BRACKET]` with a real number before posting.

---

## §0. READ FIRST: post this eligibility question before the proposal

The Council rejected XcrowHub's $1,000 grant on 15 July purely because XcrowHub was an active Mini
Apps Competition participant. Do not walk nimiq.kids into the same wall. Post this short question in
the Proposals & Bounties category first, wait for the answer, and only then post the proposal below.

> **Eligibility question before submitting a proposal**
>
> Hi Council. Before I write up a full proposal I want to check one thing, because I saw the
> XcrowHub decision on 15 July.
>
> nimiq.kids is a family allowance app that pays kids in real NIM on mainnet. Its Cycle I mini app
> submission is still an unmerged PR in the submissions repo, so I am not sure whether it counts as
> an active participant.
>
> The funding I want to ask for is not marketing, user acquisition or server costs. It is a fixed
> scope of production art: hiring a professional Rive animator to build the kid-facing animation
> system, with every source file published open source in the public repo so any Nimiq app can reuse
> the components.
>
> Two questions:
> 1. Does the competition exclusion cover product art and animation production, or only the
>    promotional and operational costs listed in the XcrowHub reply?
> 2. If it does cover it, is the right move to submit after Cycle III closes on 11 October?
>
> Happy to wait either way. I would rather ask than waste your review time.

If the answer is "wait", the proposal below is ready to post on 12 October with updated usage
numbers, which will be stronger anyway.

---

## 1. Project Description

**nimiq.kids is a family allowance app that pays children in real NIM on Nimiq mainnet.** Parents set
chores and practice goals, kids complete them, and the payout is a real on-chain transaction to the
child's own address. It is live today at `[URL]`, currently at version `[vX.Y.Z]`, running on mainnet
with `[N]` families, and it is open source at `[github repo URL]`.

**The problem this proposal solves.** The money works. The moment does not. When a child finishes a
chore, a real mainnet NIM transaction settles to their address, and the app currently expresses that
with a hand-built canvas sequencer: an egg that wobbles, cracks and breaks to reveal the character
underneath. It works, but it was built by a developer, not an animator, and it is the single most
important screen in the product. It is the moment where a six-year-old learns that money arrived.

Everything else in the app exists to lead to that moment, and right now that moment underdelivers.

**What this proposal funds.** One professional Rive animator, for one fixed scope: rebuilding the
hatch moment as a proper Rive state machine, and giving the first 8 characters real, individual
performances. The art already exists and is signed off. The rigs are already prototyped. What is
missing is a professional hand on the animation itself.

The egg is the wrapper. **The character that comes out of it is the point**, and it is where most of
this budget goes.

**Who it serves.** Nimiq families first. Then the wider ecosystem, because every `.riv` source file,
every state machine and every integration note ships open source in the public repo under the same
licence as the rest of the app. Nimiq has no shared animation component library. This becomes the
start of one.

---

## 2. Project Goal

**Adoption.** The hatch moment is the app's retention mechanic. A child who wants to see the next
hatch asks a parent for the next chore. Every one of those is a mainnet NIM transaction. Unlike
marketing spend, an animation is bought once and keeps working on every future family.

**Nimiq-chain specificity.** This is not wallet-connection value. nimiq.kids settles real NIM on the
Nimiq blockchain: `[N]` payouts totalling `[N]` NIM to date, `[N]` distinct child addresses. The
animation being funded is the visual representation of a Nimiq mainnet transaction confirming. It
cannot be lifted onto another chain, because the thing it animates is a Nimiq payout.

**Ecosystem benefit beyond this app.** The deliverables are generic enough to be reused: a countdown
ring, a value-arrival celebration, a character rig with swappable art, and a set of transition
states. Published open, in Nimiq brand colours, following the Nimiq brandbook. Any Nimiq wallet,
mini app or POS screen can drop the payment-arrival animation straight in.

**Measurable outcomes**, reported publicly in this thread:
- Hatch completion rate before and after (how many kids watch the whole sequence rather than tapping through)
- Chores completed per active child per week, before and after
- Mainnet payout transactions per week, before and after
- Number of `.riv` components published and their download or fork count

---

## 3. Budget Request

**Total requested: $4,500 USD, payable in NIM, in three milestone tranches.** This is Phase 1. A
Phase 2 is costed at the end of this section for transparency and is explicitly not being requested.

Benchmarked against published Rive specialist rates (interactive state machine systems from $1,200,
character rigs from $250 with additional states at $100 each, UI micro-interaction sets from $350).

| Line | What | Cost |
|---|---|---|
| A | **Egg rig.** Rive state machine: idle wobble, face expressions, four-stage crack progression, break, shell pieces settling. | $1,100 |
| B | **Character base rig plus art-swap harness.** The shared skeleton every character is built on: bones, mesh deformation, face controls, and the harness that loads a character's artwork into it. | $850 |
| C | **Per-character personality passes, 8 characters at $150 each.** This is the line that matters most. A shared rig alone would make every character move identically, which is exactly what would make the moment boring. Each character gets its own arrival, idle and celebration timing, so a slow heavy one and a bouncy quick one read as genuinely different creatures. | $1,200 |
| D | **Payout moment.** NIM arriving, balance ticking up, celebration. The most reusable component for the rest of the ecosystem. | $400 |
| E | **Surround rig.** Countdown ring, pie sweep for time-limited chores, completion burst. | $350 |
| F | **Web runtime integration and handoff.** Replacing the existing canvas sequencer with the Rive runtime, plus written integration notes published with the source files. | $400 |
| G | **Revision reserve.** Two rounds of notes across the whole set. | $200 |
| | **Total** | **$4,500** |

**Where the money is concentrated, and why.** $2,050 of $4,500, just under half, goes to the
characters. The egg is the wrapper; the character that comes out of it is the payoff, and it is the
thing a child actually wants to see again. The remaining 21-character roster is already drawn and
can be added later at the cost of a personality pass each, once the base rig from line B exists.

**Notes on this budget:**
- **$4,100 of $4,500 (91%) goes to an external animator.** I am not paying myself a salary out of
  this. Line F is the only line that touches my own time and it is the integration work required to
  make the animator's output actually ship.
- **No tooling or software subscriptions are requested.** Rive licences, hosting, AI tooling and
  infrastructure are mine to cover.
- **No marketing, user acquisition or promotional spend is requested.**
- The app's running costs, hosting and the NIM funding the payouts themselves are all already
  covered by me and are not part of this ask.

**Not requested here, deliberately.** Sound design, the parent-facing app, seasonal sticker packs,
outside-creator submissions and the learning-app integrations are all on the roadmap and are all
explicitly outside this proposal.

### Phase 2, costed for transparency but NOT requested today

I am showing you Phase 2 so you can see where this goes, not asking you to fund it now. **The only
money requested in this proposal is the $4,500 above.** I would come back for Phase 2 as a separate
proposal, after Phase 1 has shipped and the metrics in §2 are on the table.

**Phase 2: an animatable Nimiq identicon.** Nimiq identicons are the ecosystem's own identity
system, generated deterministically from any address, and every Nimiq app already renders them.
Today they are static images. Phase 2 rigs one in Rive so that **any** identicon, generated from
**any** address, can be posed and animated by script.

| Line | What | Cost |
|---|---|---|
| A | **Base identicon rig.** Bones, mesh deformation and face controls built to accept a procedurally generated identicon rather than one fixed drawing. This is the hard part and the reason the result is reusable. | $1,800 |
| B | **Pose and view library.** A set of named views the rig can be driven to by script, at roughly $150 each. The exact list is set with the animator during Phase 2 scoping; the one confirmed so far is the character looking at a phone. | $900 |
| C | **Dual export.** Named linear clips for deterministic video rendering, plus a live state machine for interactive app use, off the same rig. | $600 |
| D | **Runtime integration and documentation**, published with the source files so other teams can adopt it. | $500 |
| E | Revision reserve | $200 |
| | **Phase 2 total, for information only** | **$4,000** |

Why this is worth flagging now: the deliverable is not a mascot for my app. It is a rig for Nimiq's
own avatar system, published open source. Any wallet, mini app or explorer could animate a user's
own identicon on the day it ships.

---

## 4. Timeline

**8 weeks from first tranche.** Animator selection happens before submission, so week 1 starts with a
contracted animator, not a search.

| Week | Work |
|---|---|
| 1 | Art direction lock with the animator against the existing signed-off art. No new artwork commissioned; the crack patterns, faces and characters already exist. |
| 2 to 3 | Egg rig built and integrated. Live in the app behind a flag. |
| 4 | Character base rig and art-swap harness. |
| 5 to 6 | The 8 starter characters, one personality pass each. |
| 7 | Payout moment, surround rig, device testing on real tablets, revisions. |
| 8 | Ship to all families. Publish `.riv` sources and integration notes. Public report posted in this thread. |

I will post progress updates in this thread at the end of weeks 3, 5 and 8, with screen recordings.

---

## 5. Terms of Completion

The project is complete when all of the following are true and demonstrable:

1. The hatch sequence in the shipped production app is driven by Rive, not by the current canvas
   sequencer, and the old code path is removed.
2. All 8 starter characters hatch correctly, each with visibly distinct motion, verified on a real
   tablet. The remaining roster art still loads through the same rig without new engineering.
3. Every `.riv` source file, plus written integration notes, is committed to the public repo under
   the project's open source licence.
4. All animation follows the Nimiq brandbook: correct colours, logo usage and typography.
5. A public report is posted in this thread with the before-and-after metrics listed in §2, and a
   screen recording of the finished sequence.
6. Any Council member can install the app, complete a chore as a test family, and watch the finished
   animation themselves.

---

## 6. Milestones

| Milestone | Deliverable | Verification | Amount |
|---|---|---|---|
| **M1** (end week 3) | Art direction locked. Egg rig complete: wobble, faces, crack, break, pieces. Running in the app. | Screen recording posted in this thread. `.riv` file committed to the public repo. | **$1,400** |
| **M2** (end week 6) | Character base rig and swap harness done. All 8 starter characters complete, each with its own personality pass. | Screen recording of all 8 hatching back to back, so you can see they move differently. Source files committed. | **$2,000** |
| **M3** (end week 8) | Payout moment and surround rig complete. Shipped to all families. All sources published. Public report with metrics. | Live in production. Report posted here. Repo public and browsable. | **$1,100** |

The final tranche is deliberately gated on the work actually being live and the sources actually
being published, not on the animation merely existing.

---

## 7. Legal Compliance

This proposal complies with the Nimiq Community Council Legal & Ethical Guideline Framework, with
specific attention to the paragraphs named in the proposal guidelines:

- **§3, core ethical principles.** The app is built for children, so this is the section I take most
  seriously. There is no gambling, no speculation and no chance mechanic anywhere in the product.
  Kids earn a fixed, parent-set amount for completing a defined task. Parents control everything:
  what the chore is, what it pays, and whether the child can spend at all.
- **§4, hard prohibitions.** None apply. No gambling or wagering, no financial advice, no trading
  signals, no promises of returns, no unlicensed financial services. The app is custodial only in
  the sense that a parent holds their own child's funds, which is the same arrangement as a piggy
  bank.
- **§6, compliance requirements.** Responsible lead: Andjroo, `[contact]`. Budget breakdown
  with compensation is in §3. Deliverables and milestones are in §5 and §6. Wallet address for
  funding: `[NQ...]`. **Risk note:** the app handles real funds and children's data. Funds are
  parent-controlled. The privacy note in the app states plainly what is collected. This proposal
  funds animation work only and does not change the custody model or the data handling.
- **§7, payout controls.** Milestone-based, as set out in §6. I accept suspension of tranches for
  non-delivery.
- **§8, transparency.** Everything here is public: the repo, the source files, the progress updates
  and the final metrics report, all posted in this thread.
- **§11, applicant attestation.** I confirm this project complies with the guidelines, and I accept
  milestone reporting and the possibility of payout suspension for non-compliance.

**Conflict of interest disclosure:** nimiq.kids has an unmerged Cycle I submission to the Nimiq Mini
Apps Competition (`[PR links]`). I raised this with the Council before submitting (see §0) and am
proceeding on the answer given.

---

## Appendix: pre-submission checklist

Against the pattern of what this Council funds and rejects. Every box must be ticked before posting.

- [ ] Eligibility question from §0 posted and answered
- [ ] Repo is **public** and browsable before the proposal goes up
- [ ] Licence file present and open source
- [ ] App is **live and installable by a Council member right now**, with no simulated or mock path visible
- [ ] Every `[BRACKET]` replaced with a real, defensible number
- [ ] Total **requested** is $4,500 or less, and the Phase 2 table clearly says "not requested"
- [ ] Phase 1 stands on its own, so a "Phase 1 only" answer is still a win
- [ ] Phase 2 pose list settled with the animator (not needed to submit Phase 1)
- [ ] No AI or software subscription appears as a budget line
- [ ] Nimiq brandbook compliance stated explicitly
- [ ] Wallet address included
- [ ] Animator identified and quoted before submitting, so week 1 is real
- [ ] Read once more for anything that would read the same on another chain, and cut it
- [ ] No em dashes anywhere in the posted text
