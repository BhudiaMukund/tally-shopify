# Tally

An internal stock and product-intake tool for a single Shopify store. Staff scan barcodes on an
Android phone to update stock or capture a new product; an AI drafts the listing; an admin reviews
and publishes it to the Point of Sale channel.

Shopify is the source of truth. Inventory writes go straight to the Admin API with an idempotency
key and never wait for review; new products always do.

## Requirements

- Node 22+
- pnpm 10 (`corepack enable pnpm`)
- Docker, for the local MongoDB, Valkey and MinIO in [docker-compose.dev.yml](docker-compose.dev.yml)

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in every key
docker compose -f docker-compose.dev.yml up -d
pnpm db:indexes
pnpm dev
```

The compose stack is Mongo, Valkey and MinIO with the bucket created. Mongo runs **standalone and
without auth**, on a port bound to your own machine. Standalone deliberately matches the deploy:
every write in Tally touches a single document, so nothing needs a transaction or a change stream,
and a local replica set would let code that reached for one pass here and fail only after deploy.
The defaults in `.env.example` already point at it.

Every variable in `.env.example` is required. `src/lib/env.ts` validates them with Zod and the
server refuses to start if any are missing, printing the full list at once rather than one per
restart.

## Scripts

| Script            | What it does                              |
| ----------------- | ----------------------------------------- |
| `pnpm dev`        | Dev server                                |
| `pnpm build`      | Production build (`output: 'standalone'`) |
| `pnpm start`      | Serve the production build                |
| `pnpm typecheck`  | `next typegen` then `tsc --noEmit`        |
| `pnpm lint`       | ESLint                                    |
| `pnpm format`     | Prettier                                  |
| `pnpm test`       | Vitest                                    |
| `pnpm db:indexes` | Create any missing Mongo index            |

CI runs typecheck, lint and test on every push and pull request, plus a gitleaks scan of the full
history. A pre-commit hook runs the same scan against the staged diff and fails closed — install
[gitleaks](https://github.com/gitleaks/gitleaks) before your first commit.

## Accounts and access

There is no sign-up screen. Accounts are made from the CLI:

```bash
pnpm create-user --email sam@example.com --name "Sam" --role staff
```

The password is prompted for with the echo off, or read from `TALLY_PASSWORD`
when there is no terminal. It is never accepted as a flag, so it stays out of
shell history. Passwords are hashed with argon2id.

Two roles. `staff` gets the scanning app; `admin` additionally gets `/admin/*`.
Everything except `/login` needs a session, including `/api/*` — `/api/inventory`
writes to a live store. Sessions last 30 days so nobody is asked to sign in
mid-shift.

Sessions are JWTs, which is not a preference: `@auth/core` rejects a credentials
sign-in when the session strategy is `database`, and configuring an adapter is
what selects that strategy. The consequence is that deactivating an account does
not invalidate a token already issued, so `requireUser()` re-reads the `users`
row on every guarded page and route. Route protection in `src/proxy.ts` is a
cheap cookie check; the guards in `src/lib/auth/guards.ts` are the real one.

## Deploy

The web service builds from the [Dockerfile](Dockerfile): multi-stage, `node:22-alpine`, Next's
standalone output, non-root, no dev dependencies in the final layer. It runs behind a reverse proxy
terminating TLS — the phone scanner needs a secure context, so plain http on a LAN IP will not do.

Configuration is entirely environment variables at run time; nothing is baked into a layer. A
container started with an incomplete environment exits immediately and prints every missing key.
Indexes are created on boot, so a fresh database needs no migration step; `pnpm db:indexes` does
the same thing by hand.

## This repo is public

No store data is committed. Product types, vendors, barcodes, prices and IDs come from the Shopify
Admin API at runtime or via setup scripts — never from a file in the repo. Test fixtures use
synthetic GTINs. See `docs/BUILD_PLAN.md` §11.

## Licence

Apache-2.0 — see [LICENSE](LICENSE).
