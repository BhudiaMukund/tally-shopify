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

The compose stack is Mongo, Valkey and MinIO with the bucket created. Mongo runs as a **single-node
replica set** — transactions and change streams need one — and without auth, on a port bound to
your own machine. The defaults in `.env.example` already point at it.

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
