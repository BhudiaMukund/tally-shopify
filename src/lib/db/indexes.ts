import type { Db, IndexDescription } from "mongodb";

import { COLLECTIONS, type CollectionName } from "./collections";

/**
 * Every index Tally relies on, declared in one place so `ensureIndexes` can
 * create them and a test can assert none of them quietly disappeared.
 *
 * Names are explicit rather than driver-generated. A generated name changes
 * when the key changes, which turns "this index was altered" into "a second
 * index appeared" — and the unique ones here are load-bearing, not tuning.
 */

export interface TallyIndex {
  collection: CollectionName;
  name: string;
  key: Readonly<Record<string, 1 | -1>>;
  unique?: boolean;
  /** Why it exists. Read this before deleting one. */
  why: string;
}

export const indexes: readonly TallyIndex[] = [
  {
    collection: COLLECTIONS.productsMirror,
    name: "barcode",
    key: { barcode: 1 },
    why: "Scan lookup. Deliberately not unique — one printed code covers a size run.",
  },
  {
    collection: COLLECTIONS.productsMirror,
    name: "shopifyVariantId_unique",
    key: { shopifyVariantId: 1 },
    unique: true,
    why: "One document per variant. The webhook upsert keys on this.",
  },
  {
    collection: COLLECTIONS.productsMirror,
    name: "shopifyProductId",
    key: { shopifyProductId: 1 },
    why: "Group a barcode's matches by product, and apply a products/update webhook.",
  },
  {
    collection: COLLECTIONS.productsMirror,
    name: "updatedAtShopify_desc",
    key: { updatedAtShopify: -1 },
    why: "Nightly reconcile walks the catalogue newest-first to find drift.",
  },

  {
    collection: COLLECTIONS.drafts,
    name: "scanId_unique",
    key: { scanId: 1 },
    unique: true,
    why: "Idempotency for POST /api/intake. A resubmitted capture must not create a second draft.",
  },
  {
    collection: COLLECTIONS.drafts,
    name: "status_capturedAt_desc",
    key: { status: 1, capturedAt: -1 },
    why: "The review queue: one status, oldest capture first at the top of the console.",
  },
  {
    collection: COLLECTIONS.drafts,
    name: "barcode",
    key: { barcode: 1 },
    why: "A scan resolves against drafts as well as the mirror — pending is a third state.",
  },

  {
    collection: COLLECTIONS.inventoryEvents,
    name: "scanId_unique",
    key: { scanId: 1 },
    unique: true,
    why: "This is what makes an inventory retry safe. Without it the same count applies twice.",
  },

  {
    collection: COLLECTIONS.users,
    name: "email_unique",
    key: { email: 1 },
    unique: true,
    why: "The credentials provider looks accounts up by email; two would be ambiguous.",
  },
];

export interface IndexConflict {
  collection: CollectionName;
  name: string;
  wanted: TallyIndex;
  found: { key: unknown; unique: boolean };
}

export class IndexConflictError extends Error {
  readonly conflicts: readonly IndexConflict[];

  constructor(conflicts: readonly IndexConflict[]) {
    const lines = conflicts.map(
      (c) =>
        `  ${c.collection}.${c.name} — wanted ${describe(c.wanted.key, c.wanted.unique === true)}` +
        `, found ${describe(c.found.key, c.found.unique)}`,
    );
    super(
      `${conflicts.length} index${conflicts.length === 1 ? "" : "es"} already exist with a different definition:\n${lines.join("\n")}\n\n` +
        "Mongo will not redefine an index in place. Drop the listed ones and re-run.",
    );
    this.name = "IndexConflictError";
    this.conflicts = conflicts;
  }
}

function describe(key: unknown, unique: boolean): string {
  return `${JSON.stringify(key)}${unique ? " unique" : ""}`;
}

/** Key equality including field order — `{a:1,b:1}` and `{b:1,a:1}` are different indexes. */
function sameKey(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface EnsureIndexesReport {
  /** `collection.name` for each index this run created. */
  created: string[];
  /** Already present with the right definition. */
  existing: string[];
  durationMs: number;
}

/**
 * Creates any missing index and leaves the rest alone. Idempotent, so it is
 * safe on every boot and safe to run by hand while the app is serving.
 *
 * An index that exists with a *different* definition is reported rather than
 * silently tolerated: Mongo will not redefine one in place, so the alternative
 * is an app that quietly runs without the uniqueness constraint it assumes.
 */
export async function ensureIndexes(db: Db): Promise<EnsureIndexesReport> {
  const startedAt = performance.now();
  const report: EnsureIndexesReport = { created: [], existing: [], durationMs: 0 };
  const conflicts: IndexConflict[] = [];

  const byCollection = new Map<CollectionName, TallyIndex[]>();
  for (const index of indexes) {
    const list = byCollection.get(index.collection) ?? [];
    list.push(index);
    byCollection.set(index.collection, list);
  }

  for (const [name, wanted] of byCollection) {
    const collection = db.collection(name);
    const found = await listIndexes(db, name);
    const missing: IndexDescription[] = [];

    for (const index of wanted) {
      const match = found.get(index.name);
      if (match === undefined) {
        // `unique` is spread in only when it is set: the driver serialises an
        // explicit `undefined` as null, and Mongo rejects a null there.
        missing.push({
          name: index.name,
          key: index.key,
          ...(index.unique === true ? { unique: true } : {}),
        });
        continue;
      }

      const matches = sameKey(match.key, index.key) && match.unique === (index.unique === true);
      if (matches) report.existing.push(`${name}.${index.name}`);
      else conflicts.push({ collection: name, name: index.name, wanted: index, found: match });
    }

    if (missing.length > 0) {
      await collection.createIndexes(missing);
      for (const index of missing) report.created.push(`${name}.${index.name}`);
    }
  }

  if (conflicts.length > 0) throw new IndexConflictError(conflicts);

  report.durationMs = Math.round(performance.now() - startedAt);
  return report;
}

/** Existing indexes by name. An absent collection has none — it is created on first write. */
async function listIndexes(
  db: Db,
  name: CollectionName,
): Promise<Map<string, { key: unknown; unique: boolean }>> {
  const map = new Map<string, { key: unknown; unique: boolean }>();
  try {
    for (const index of await db.collection(name).listIndexes().toArray()) {
      map.set(index.name ?? "", { key: index.key, unique: index.unique === true });
    }
  } catch (error) {
    // NamespaceNotFound. Any other failure is a real problem and should surface.
    if ((error as { code?: number }).code !== 26) throw error;
  }
  return map;
}
