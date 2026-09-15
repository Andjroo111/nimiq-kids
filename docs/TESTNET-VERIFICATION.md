# Testnet verification

Every money path in nimiq.kids was executed against the **live Nimiq TestAlbatross chain**
on **2026-07-31** and verified from chain state, not from application logs. This document
records what was run, what the chain says, and how to check it independently.

Every hash below is real and resolvable. Paste any of them into
`https://test.nimiqscan.com/transactions/<hash>`, or query a testnet node directly:

```bash
curl -s -X POST <testnet-rpc> -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"getTransactionByHash","params":["<hash>"],"id":1}'
```

---

## The verification rule

**A returned transaction hash is not proof that anything happened.**

`sendRawTransaction` returning a hash means the node accepted the transaction into its
mempool. On Albatross a transaction can be accepted, included in a block, and report
`state: "confirmed"` while **failing at execution and moving nothing**. This was not a
theoretical concern — it was observed repeatedly during this run and is the single most
important thing learned from it (see [Negative results](#negative-results)).

So every claim on this page is backed by an **account balance delta** read from the chain
before and after, via `getAccountByAddress`. Where a balance delta was not usable, the
method is stated explicitly.

---

## Environment

| | |
|---|---|
| Network | TestAlbatross (`NIMIQ_NETWORK=test`, `NIMIQ_NETWORK_ID=5`) |
| Node | self-hosted `@nimiq/core` light-client JSON-RPC sidecar, consensus established |
| Explorer | `https://test.nimiqscan.com` |
| Faucet | `https://faucet.pos.nimiq-testnet.com/tapit` |
| Validator | `NQ08 N4RH FQDL TE7S 8C66 65LT KYDU Q382 YG7U` |
| App | `sim: false` — simulated settlement disabled, real signing and broadcast throughout |

The node exposes `getBlockNumber`, `getLatestBlock`, `getAccountByAddress`,
`getTransactionByHash`, `getTransactionsByAddress` and `sendRawTransaction` — which is
exactly the set `nimiq-settlement`'s `RpcSender` calls, so the app ran unmodified.

---

## Verified transfers

Each row was driven through the real product endpoints (not a test harness) and confirmed
by reading both sides of the transfer on chain.

| Path | Block | Value (luna) | Transaction |
|---|---|---|---|
| Chore payout, family wallet → kid | 7499727 | 100,000 | `8908eeed13362050c84bf39a283289562cb89482ed458cd1102516974c672a47` |
| Kid → sibling | 7499757 | 40,000 | `b43ede9d891d7f59127dd5b447aea9f28de51db12286688c8d04726f970fb684` |
| Kid → parent | 7507384 | 30,000,000 | `8bd4691b8276753fd5e9f2dd91587a158f5a0007936f6e2ce7676e205186d75f` |
| Treasure Box purchase, kid → family wallet | 7507436 | 400,000,000 | `8f24bef01c6d15be6c8b3ad67385beab7e9abc56924b3def2e4ee7beaf00299f` |
| Treasure Box refund on parent reject | 7507454 | 400,000,000 | `fbf28ce6dfd72c23570ce079da17e074c4f9b5f73cfc3d98ab7bad58609d4731` |
| Send to a typed/scanned address | 7507508 | 25,000,000 | `82a76f06b6368778542a748d60240c992ab010e1567a1538aeba4b0b29cc08ce` |

The Treasure Box pair round-trips to the luna: the kid's account returned to its exact
starting balance after the refund.

### Cashlinks

A Cashlink was minted through the real path — kid requests, parent approves — and then
**claimed**, both confirmed by balance delta:

- **Funding:** the kid's account fell by the Cashlink value and the freshly derived
  Cashlink address rose by exactly that amount, from zero.
- **Claim:** the Cashlink address fell to zero and an unrelated recipient rose by the full
  amount, using the claim key decoded from the Cashlink URL by the app's own codec.
- The generated URL was loaded against the live `hub.nimiq-testnet.com` and rendered the
  correct amount with a working **Claim** action.

Note that nimiq.kids never executes a claim in its own code. The claim leg lives in the
Nimiq Hub by design, which is correct for a bearer link; the app only *detects* a claim by
observing the balance.

### Parent top-up

A transaction signed with `@nimiq/core` (the same serialized hex a Hub or Nimiq Pay wallet
returns) was posted to the app's broadcast endpoint. The family wallet balance rose by the
transaction value on chain and the family's payout budget was credited by the same amount.
Re-posting an identical transaction credited nothing — the double-credit guard holds.

---

## Staking

Staking is the deepest path and the one that produced the most findings.

### A stake executes and genuinely locks

| | |
|---|---|
| `createStaker`, 100 NIM | block **7507206**, `d2bb0408d8413164fa5bea6db07e93a8ff5f29794b5321bb4799b112482b9385` |
| Account before / after | `11,000,000,000` → `10,990,000,000` luna |

With the stake confirmed, spending it is refused: a send larger than the remaining
spendable balance returned `insufficient_funds`, while a send within it settled on chain.
Unstaking more than is staked returned `insufficient_stake`. **The lock is real.**

### The 100 NIM minimum is a chain rule

Bisected against the node:

| Amount (luna) | Result |
|---|---|
| 9,999,999 | rejected — `Transaction has invalid value` |
| 10,000,000 | accepted and executed |

Albatross enforces a 100 NIM minimum stake. The app now surfaces this as `minStakeLuna`
and blocks below-minimum amounts at the keypad.

---

## Negative results

These are the most valuable findings, and they are recorded here because they are the
reason the verification rule above exists.

### A stake delegated to an unregistered validator is mined and does nothing

| | |
|---|---|
| `createStaker`, 100 NIM | block **7499820**, `32c3551a162c4ba5f9e3c041bf48ecce668bf45506c2c22de06aec71217b5ea1` |
| Reported state | `confirmed` |
| Value moved | **0** |

The transaction is in a block. The explorer shows it. The account was never debited.
Delegating to an address that is not a registered validator **on the network you are
actually pointed at** fails silently at execution.

A validator listed by a public validators API is not sufficient evidence. The reliable
check is `getTransactionsByAddress` on the staking contract showing that address doing
real staking work.

### Retire and remove are accepted from an account with nothing to retire

The unstake round trip, on one account:

| Block | Operation | Value moved | Transaction |
|---|---|---|---|
| 7507206 | `createStaker` | **10,000,000** ✅ | `d2bb0408d8413164fa5bea6db07e93a8ff5f29794b5321bb4799b112482b9385` |
| 7507227 | `retireStake` | 0 | `b26210239f488924fd40463807fed42320634300a1d072a286031ea7f5ba2fcd` |
| 7507293 | `removeStake` | 0 | `fce8cbeec1e6f02621a3722e08022965b0cc9d47cdb6e9a33f5ed3a46c8d0756` |
| 7507397 | `removeStake` | 0 | `e8825c8aedff9ba2e53e2969b8c87874d2961919cfa3e7d22a7d83158f325352` |
| 7507502 | `removeStake` | 0 | `3b972148049891265f9c284675f6c06b03b5b5bd2cb24c35b5092295284c365a` |

Three retry attempts, every one accepted into a block, none moving anything — the real
Albatross release window had not elapsed. Throughout, the app held the unstake as
`pending` and never told the child their NIM had come back.

An earlier build would have marked it complete at block 7507227.

### A never-funded account produces a well-formed transaction

A transaction signed by an account with a zero balance is structurally valid, so the node
accepts it and returns a hash. It never executes. Any code that treats that hash as proof
of payment can be made to credit value that does not exist. This was demonstrated against
the top-up path and is now guarded by requiring the recipient balance to actually rise.

---

## Scope

This document covers **TestAlbatross**, the Nimiq test network. Every transaction listed
above was executed there, through the product's own endpoints, against a real node, with
simulated settlement disabled.

Claiming was verified by decoding the Cashlink URL with the app's own codec and sweeping
the funds with the resulting key — the mechanism a claim actually uses. nimiq.kids never
executes a claim in its own code; that leg belongs to the Nimiq Hub by design, and the app
only detects a claim by observing the balance.

Verification on other networks is tracked separately.

---

## Reproducing this

1. Run a testnet node exposing the six JSON-RPC methods listed above.
2. Configure `NIMIQ_NETWORK=test`, `NIMIQ_NETWORK_ID=5`, `NIMIQ_RPC_URL=<node>`,
   `HATCH_VALIDATOR_ADDRESS=<a validator registered on testnet>`, plus a funded
   `DEV_PARENT_PRIV` and a `HATCH_MASTER_SEED`. Leave `NIMIQ_SIM` unset — `/health` must
   report `"sim": false`.
3. Fund the family wallet from the faucet.
4. Drive the product endpoints, and after each one read both accounts with
   `getAccountByAddress` and assert the delta. **Do not assert on the returned hash.**
