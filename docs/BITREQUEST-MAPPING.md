# Bitrequest patterns: what applies to nimiq.kids

**Status:** ANALYSIS 2026-08-04. Nothing built, nothing queued. Written so the next agent does
not re-derive it, and does not apply the wrong half.

Companions: nimiq.sale `docs/LOCAL-FIRST.md` (data ownership), `nimiq-settlement`
`docs/MULTI-PROVIDER.md` (chain watching). Both came out of the same read of **Bitrequest**
(`bitrequest/bitrequest.github.io`).

> ⚖️ **Bitrequest is AGPL-3.0. Read the pattern, never copy the code.** Andjroo's explicit call
> 2026-08-04. Do not vendor, transcribe, or paste from that repo.

## The one that applies: multi-provider chain watching

nimiq.kids reaches the chain through **exactly one** node, and cannot fail over.

`src/nimiq/client.ts` resolves a single `RPC_URL` from `NIMIQ_RPC_URL`, with no secondary and no
health notion. **23 non-test source files import that client**, so every money path (payouts,
Cashlink claims, spend locks, custody boot) inherits it. `src/nimiq/chain-probe.ts` deliberately
bypasses `ChainClient` for its two boot-time reads, and it talks to the same single endpoint.

This is the same shape that blinded the nimiq.sale POS for roughly 60 hours on 2026-07-24, and
the reason `nimiq-settlement` exists as the place to fix it once. **Do not build failover here.**
Building it in nimiq.kids fixes one app. Building it in the shared package fixes this one,
nimiq.sale and the GDKC payment widget together. What nimiq.kids owes that effort is a clean seam,
and `ChainClient` is already the SIM-swappable interface, which is most of the work.

Read `nimiq-settlement/docs/MULTI-PROVIDER.md` first. nimiq.sale PRs **#67 + #71** already shipped
a working two-source version, and #71 carries the lesson that generalizes: **a demoted provider
must keep being probed, or failover is one-way.**

⚠️ Mainnet has no default RPC and requires `MAINNET_ARMED=1`. Any provider-list work must keep
that arm switch intact. A list of providers must not become a way to acquire a default.

## The one that does NOT apply: local-first data ownership

nimiq.sale is migrating toward user-owned local data because a single merchant on a single till
owns their own catalog and sales. **That reasoning does not transfer to nimiq.kids, and applying
it would break the product.**

A family is inherently multi-device and multi-user: a parent approves on their phone, a kid claims
on a tablet, and a second grown-up pays from their own wallet. The server-side SQLite
(`src/db.ts`, `bun:sqlite`) is not incidental storage that a browser could own. It is the shared
write path that lets those devices agree. LOCAL-FIRST.md names exactly this case as one of the
three things that cannot move to the client ("multi-till / multi-staff sync"), and a family is the
same problem wearing different clothes.

What *is* worth borrowing from that half is narrower: **user-driven export and backup**.
Bitrequest's backup is a file the user holds. nimiq.kids has real value in a family's history
(chore records, goal ladders, sticker collections) that today exists only in one SQLite file on
the Mini. That is a backup question, not an architecture migration, and it is not queued here.

## Not applicable

- **NFC reader over WebSocket.** A point-of-sale affordance. No till, no reader.
- **Printable receipts.** No receipt surface.
- **Stateless key-injecting proxy.** The kids server is not a secrets proxy for a static client.
  It holds custody policy and the write path. Shrinking it is not on the table.

## Related

- `nimiq-settlement/docs/MULTI-PROVIDER.md`, where the chain-watch work belongs
- nimiq.sale `docs/LOCAL-FIRST.md`, the data-ownership half, and why it is a different axis
  from custody
