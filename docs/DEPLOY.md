# Deploy — Fly.io + Cloudflare (canonical Nimiq mini-app)

This is the reference runbook for the Nimiq app fleet. Stateful apps (Bun + Hono +
`bun:sqlite`) deploy to **Fly.io**; static/SSG sites (e.g. nimiq.tech) stay on
**Cloudflare Pages**. Cloudflare always sits **in front** of the Fly app for DNS, TLS,
DDoS/WAF, and optional Access gating.

`nimiq-kids` (nimiq.kids) is a stateful app: it persists families, children, chores,
and cashlink records in SQLite, so it runs on Fly with a persistent volume rather than on
Cloudflare Pages.

## The shape

```
GitHub merge to main ──▶ Deploy workflow ─▶ flyctl deploy --remote-only
                                                  │
      Cloudflare (DNS proxy + TLS + WAF) ──▶ Fly app ──▶ /app/data volume (SQLite)
```

- **Fly** runs the container: Bun executes the TypeScript directly, no bundler.
- **Volume** at `/app/data` holds the SQLite file (`kids.db`), so data survives every redeploy.
- **Scale-to-zero** (`min_machines_running = 0`): idle machines stop, cost ~nothing, and
  auto-start on the next request.
- **Cloudflare** is the front door, never the runtime. The Fly origin is hidden behind it.

> **CI note:** this repo has no CI workflow yet, so `deploy.yml` triggers on `push` to
> `main` directly. The fleet default is to gate the deploy on a green CI run via
> `workflow_run`. Once a CI workflow named `CI` is added, switch the trigger in
> `.github/workflows/deploy.yml` (instructions are in that file's header comment).

## One-time bootstrap (per app)

Requires `flyctl` (authed) and `gh` (authed with `repo` + `workflow` scopes).

```bash
# 1. Create the Fly app (name is global; matches `app =` in fly.toml).
fly apps create nimiq-kids

# 2. Create the persistent volume (name matches [[mounts]].source in fly.toml).
fly volumes create nimiq_kids_data --region ord --size 1 --yes -a nimiq-kids

# 3. First deploy (builds remotely; no local Docker needed).
fly deploy --remote-only

# 4. Wire auto-deploy: app-scoped Fly token -> GitHub repo secret.
fly tokens create deploy -a nimiq-kids | gh secret set FLY_API_TOKEN -R Andjroo111/nimiq-kids
```

After this, every push to `main` redeploys automatically.

## Cloudflare front (security posture)

The app is reachable at `https://nimiq-kids.fly.dev`. To put Cloudflare in front:

1. In the Cloudflare zone (e.g. `nimiq.life`), add a **proxied** (orange-cloud) CNAME:
   `kids` → `nimiq-kids.fly.dev`.
2. Tell Fly about the custom hostname so it issues a cert:
   `fly certs create kids.nimiq.life -a nimiq-kids`
3. Cloudflare SSL mode: **Full (strict)** (Fly serves valid TLS on the origin).
4. Optional — gate internal/admin apps with **Cloudflare Access** (same zero-trust login
   used for the ops dashboards). Set `deploy.edge.access = true` in `nimiq-stack.json`.

Result: visitors hit Cloudflare (DDoS/WAF/TLS); only Cloudflare talks to Fly; the origin
IP is never exposed.

## Going live (SIM → real Cashlink payouts)

The pilot boots in `NIMIQ_SIM=1` (simulated payouts — the full UX runs with no faucet or
network). To mint **real Cashlinks** on testnet, drop `NIMIQ_SIM` and give the app a
funded parent key:

```bash
fly secrets set \
  DEV_PARENT_PRIV=<funded-testnet-private-key> \
  -a nimiq-kids

# and clear the SIM override (it's set in fly.toml [env]):
fly secrets unset NIMIQ_SIM -a nimiq-kids   # if present as a secret
# or edit fly.toml [env] to remove NIMIQ_SIM and redeploy.
```

For **mainnet**, also set `NIMIQ_NETWORK=main`. Note the live client connects over `wss`
and waits for PoS consensus; verify the Albatross light client boots in the Fly runtime
before flipping a production hostname.

## Teardown

```bash
fly apps destroy nimiq-kids   # removes the app + its volume
```

## Files

| File | Role |
|------|------|
| `Dockerfile` | Bun runtime image; frozen-lockfile install; runs `src/server.ts` |
| `.dockerignore` | keeps local state (db, .env, node_modules) out of the image |
| `fly.toml` | app config: scale-to-zero, volume mount, `/health` check, env |
| `.github/workflows/deploy.yml` | deploy on push to `main` (switch to `workflow_run(CI)` once CI exists) |
| `nimiq-stack.json` | alignment manifest — records the canonical stack + deploy/edge posture |
