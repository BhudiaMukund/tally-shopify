import type { Collection, Db } from "mongodb";

import { getDb } from "./client";
import type { Draft } from "./schemas/drafts";
import type { InventoryEvent } from "./schemas/inventory-events";
import type { ProductMirror } from "./schemas/products-mirror";
import type { Taxonomy } from "./schemas/taxonomy";
import type { User } from "./schemas/users";

/**
 * Typed handles for the five collections.
 *
 * The schemas describe a document *without* `_id`; the driver adds it back as
 * `WithId<T>` on reads and generates one on insert. Taxonomy is the exception —
 * its `_id` is the set name, so it is part of the schema.
 */

export const COLLECTIONS = {
  productsMirror: "products_mirror",
  drafts: "drafts",
  inventoryEvents: "inventory_events",
  taxonomy: "taxonomy",
  users: "users",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export const productsMirror = (db: Db): Collection<ProductMirror> =>
  db.collection<ProductMirror>(COLLECTIONS.productsMirror);

export const drafts = (db: Db): Collection<Draft> => db.collection<Draft>(COLLECTIONS.drafts);

export const inventoryEvents = (db: Db): Collection<InventoryEvent> =>
  db.collection<InventoryEvent>(COLLECTIONS.inventoryEvents);

export const taxonomy = (db: Db): Collection<Taxonomy> =>
  db.collection<Taxonomy>(COLLECTIONS.taxonomy);

export const users = (db: Db): Collection<User> => db.collection<User>(COLLECTIONS.users);

/** All five at once, for a request handler that touches more than one. */
export async function getCollections(): Promise<{
  db: Db;
  productsMirror: Collection<ProductMirror>;
  drafts: Collection<Draft>;
  inventoryEvents: Collection<InventoryEvent>;
  taxonomy: Collection<Taxonomy>;
  users: Collection<User>;
}> {
  const db = await getDb();
  return {
    db,
    productsMirror: productsMirror(db),
    drafts: drafts(db),
    inventoryEvents: inventoryEvents(db),
    taxonomy: taxonomy(db),
    users: users(db),
  };
}
