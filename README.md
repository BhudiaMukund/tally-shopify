# Tally

An internal stock and product-intake tool for a single Shopify store. Staff scan barcodes on an
Android phone to update stock or capture a new product; an AI drafts the listing; an admin reviews
and publishes it to the Point of Sale channel.

Shopify is the source of truth. Inventory writes go straight to the Admin API with an idempotency
key and never wait for review; new products always do.

## Requirements

- Node 22+
- pnpm 10 (`corepack enable pnpm`)
- MongoDB as a single-node replica set, Valkey and MinIO — a `docker-compose.dev.yml` lands with
  the database commit

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in every key
pnpm dev
```

Every variable in `.env.example` is required. `src/lib/env.ts` validates them with Zod and the
server refuses to start if any are missing, printing the full list at once rather than one per
restart.

## Scripts

| Script           | What it does                              |
| ---------------- | ----------------------------------------- |
| `pnpm dev`       | Dev server                                |
| `pnpm build`     | Production build (`output: 'standalone'`) |
| `pnpm start`     | Serve the production build                |
| `pnpm typecheck` | `next typegen` then `tsc --noEmit`        |
| `pnpm lint`      | ESLint                                    |
| `pnpm format`    | Prettier                                  |
| `pnpm test`      | Vitest                                    |

CI runs typecheck, lint and test on every push and pull request.

## This repo is public

No store data is committed. Product types, vendors, barcodes, prices and IDs come from the Shopify
Admin API at runtime or via setup scripts — never from a file in the repo. Test fixtures use
synthetic GTINs. See `docs/BUILD_PLAN.md` §11.

## Licence

Apache-2.0 — see [LICENSE](LICENSE).
