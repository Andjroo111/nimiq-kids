# nimiq.kids Roadmap

What is live today, what my own family tests next, and what only becomes a promise after it
survives our kitchen table. Written 2026-07-31. This mirrors the roadmap on the homepage; if the
two ever disagree, the homepage is the one people read.

## Live now: a working family ecosystem

Not an allowance app. Kids do chores, routines and activities, and the parent rewards them for
finishing.

It runs as a mini app inside the **Nimiq Pay app**, and just as well in **any plain browser**,
because the wallet is built into the page itself. A kid opens a link and their money is there: no
app store, no extension, no seed phrase, parent-managed underneath. Five languages ship in
`src/locales/` (de, en, es, fr, pt), with amounts shown in 14 display currencies at live rates.

The loop that makes it work:

1. The parent funds the family budget.
2. A kid finishes a chore, a routine or an activity.
3. The parent approves, and the payout funds a claim link (a Nimiq Cashlink) the kid claims on
   their own device.
4. The kid spends it in the **Treasure Box** on things the parent already gives them anyway:
   screen time, a new toy, a trip to the pool.
5. That spend returns to the family wallet, which funds the next round.

Nobody in the family loses a dollar, and along the way the kid is learning to be their own bank:
checking a balance, saving toward something, deciding when to spend.

Also shipped: multi-household isolation (test-proven), a per-family payout budget on the shared
hot wallet, a 6-digit pairing code for tablets or any device a magic link cannot reach, a weekly
sticker chart, and self-serve onboarding in a few taps. MIT licensed.

**One automatic behaviour, stated plainly.** `STREAK_BONUS_LUNA` (`src/routes/cashlinks.ts`)
defaults to 1 NIM and `STREAK_MILESTONE_EVERY` to 7, so every seventh claimed payout mints one
extra bonus link without a fresh parent tap. It is capped by the same family budget, it is
best-effort so a failed bonus never breaks a claim, and setting `STREAK_BONUS_LUNA=0` switches it
off. This is why the copy says the parent "approves every chore before it pays" rather than
"approves every transaction".

## August: testing it with my own kids

My two kids, seven and four, run their real chore routines on it for a full month, on their own
tablets. A community feedback button goes into the parent account at the same time.

The point is to troubleshoot what breaks and hear what they liked and what they did not, which is
what shows me what to build, what to remove, what to simplify, and what needs to be more
engaging. Nothing further down this document is allowed to jump ahead of what that month turns up.

### A Rive animator to gamify the app

A **Nimiq Community Council proposal** asks **$4,500** to hire a professional Rive animator for the
kid-facing side. To be unambiguous, that figure is the size of the grant request to the Community
Council; it is not a prize amount and it is not money from the competition.

**The figure used to read "5 to 10 thousand" and that was wrong.** Research into every proposal the
Council has decided since it was elected in March 2026 (`docs/funding/COUNCIL-RESEARCH.md`) found
that **$4,500 is the largest sum it has ever approved**, and that every request above that has been
rejected, several explicitly on budget. An $11,000 ask came back approved at $2,900 once it was
narrowed to a single deliverable.

Most of that budget goes to the characters rather than to the egg. A shared rig with swapped
artwork would make every character move identically, which is the opposite of what makes the moment
worth watching, so each starter character gets its own performance. The full request is drafted at
`docs/funding/RIVE-PROPOSAL.md`.

**It cannot be submitted yet.** The Council ruled on 15 July 2026 that it does not fund mini apps
while they are active participants in the Mini Apps Competition. Cycle III closes 11 October 2026.

I am already part of the Rive community and will take quotes from two or three animators.
Duolingo is the reference for playfulness, Fortnite for customization depth. Everything the
funding pays for ships open source in this repo, so the ecosystem inherits the work.

### Recurring allowance and steady releases

A month of real use is how I find the next features. The main one I am building now is an
allowance the parent sets and controls, that repeats, plus bonuses. Under the hood that may use
scheduled transactions or a small escrow design; both are under evaluation and whichever ships
will be documented here.

## September: a grassroots push to get families on it

A lot of crypto asks people to invest first. That is backwards: solve a real problem, then give
people a reason to use it.

I have two kids, seven and four, so I am around parents constantly, through their activities, my
small business, and my own friends with kids. I hand them a cashlink and ask them to try it with
their own kids. This phase is about real families using it, getting listed on the App Store, and
starting real marketing once there is something to point at.

## Future goals

### Scheduled drops, the way Fortnite does it

New sticker packs, backgrounds and characters arriving on a schedule rather than all at once,
drawn by Rive animators I bring in. Parents decide whether their kid can buy at all. Opening it
up so outside creators can submit and get paid is a maybe, not a promise.

### Paying kids for learning, not just chores (research phase)

Connecting to apps that teach: reading, math, music, coding. Ello, Khan Academy Kids and
Yousician are the kind of thing I mean. I will be selective, nothing that is only a game.

The goal is to use **HTLCs** (hash time locked contracts) so the reward releases once the criteria
are met, rather than requiring a parent tap for every lesson.

This is genuinely a research phase and the page says so. Known constraint: Ello has no public
API, and the only integration hook found so far is its weekly parent-report emails. Nothing here
is committed.

## The rules that never change

- No ads, no tracking, nothing predatory.
- The parent funds everything and approves every chore before it pays.
- It stays open source under MIT.

## Guardrails

Permanent, and not traded away for a deadline.

1. **Parent-managed allowance.** The parent funds, approves, and can revoke. Kids never hold keys
   beyond a one-shot claim link. Never described as a "crypto wallet for kids". Any automatic
   behaviour, including the streak bonus above, must be disclosed and switchable off.
2. **Plain-language privacy.** No accounts for kids, no tracking, minimal data, on-device where
   possible, stated in words a parent can actually read.
3. **Real, nameable beta families.** No farmed usage, no seeded numbers, no demo families dressed
   up as users.
4. **No simulated settlement path** reachable in a shipped build.

## Ideas under consideration, not commitments

Nothing here is promised. It is written down so the thinking is public.

- Invite-a-family bonus for both households after the invited family's first completed week. The
  share link and attribution already ship; the bonus does not.
- Shareable milestone cards a parent can post.
- Grandparent gifting via claim links, so the giver needs no wallet.
- Family versus family chore-streak challenges, device-based, no kid accounts.
- Seasonal allowance match promotions.
- A dog-care chore pack (feed, walk, train), cross-promoted through my dog-training business.
- School or sports-team task boards. A much bigger custody design; not before the family core is
  proven.
- More assets over time (stablecoins, Bitcoin), only once the integration is real. This was
  previously written here as a headline promise and has been demoted on purpose.
- Sticker album, hatchling evolution, streak shields, payday notes, goal jars, parent match, wish
  list, photo proof, open chore packs, co-parent mode.
