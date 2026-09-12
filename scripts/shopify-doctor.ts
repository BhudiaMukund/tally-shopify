/**
 * `pnpm shopify:doctor` — prove the token works, print the two IDs that have to
 * go into `.env.local`, and say whether the webhooks are pointing at this app.
 *
 * Read-only by default, so it stays safe to run against the live store at any
 * time. `--register` is the one thing here that writes: it creates the four
 * mirror webhooks, or re-points them when `APP_URL` has moved. That is a real
 * mutation on a live store, so it is a deliberate flag rather than something
 * that happens because someone ran a diagnostic.
 */
import { closeShopifyClient, throttleSnapshot } from "@/lib/shopify/client";
import { ShopifyGraphQLError, ShopifyHttpError } from "@/lib/shopify/errors";
import { getShop } from "@/lib/shopify/operations/get-shop";
import { listLocations } from "@/lib/shopify/operations/list-locations";
import { isPointOfSale, listPublications } from "@/lib/shopify/operations/list-publications";
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  planWebhooks,
  updateWebhookSubscription,
} from "@/lib/shopify/operations/webhook-subscriptions";
import { webhookTopic, WEBHOOK_PATH } from "@/lib/shopify/webhooks";

import { loadEnvFiles } from "./load-env";

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Marks the value already in the environment, so a re-run reads as a check. */
function marker(id: string, configured: string | undefined): string {
  if (configured === undefined || configured === "") return "";
  return id === configured ? "  <- already in .env.local" : "";
}

/**
 * The four topics that keep the mirror fresh, and whether they are wired up.
 *
 * A subscription pointing at an old tunnel is worse than none at all: Shopify
 * keeps trying, the deliveries fail, and after two days it deletes the
 * subscription — so this reports the URI it found rather than only whether a
 * topic exists.
 */
async function checkWebhooks(register: boolean): Promise<void> {
  const uri = `${process.env.APP_URL ?? ""}${WEBHOOK_PATH}`;
  heading("Webhooks");

  if (!uri.startsWith("https://")) {
    console.log(`  APP_URL must be an https URL for Shopify to deliver to it.`);
    console.log(`  Found: ${process.env.APP_URL ?? "(unset)"}`);
    return;
  }

  const existing = await listWebhookSubscriptions();
  const plan = planWebhooks(existing, uri, webhookTopic.options);

  for (const entry of plan) {
    const state =
      entry.action === "keep"
        ? "ok"
        : entry.action === "create"
          ? "MISSING"
          : `points at ${entry.existing?.uri ?? "?"}`;
    console.log(`  ${entry.topic.padEnd(24)} ${state}`);
  }

  const changes = plan.filter((entry) => entry.action !== "keep");
  if (changes.length === 0) {
    console.log(`
  All four deliver to ${uri}`);
    return;
  }

  if (!register) {
    console.log(`
  ${changes.length} to fix. Run \`pnpm shopify:doctor --register\` to point`);
    console.log(`  them at ${uri}`);
    return;
  }

  for (const entry of changes) {
    if (entry.action === "create") {
      const created = await createWebhookSubscription(entry.topic, uri);
      console.log(`  created  ${entry.topic}  ${created.apiVersion.handle}`);
    } else if (entry.existing !== undefined) {
      const updated = await updateWebhookSubscription(entry.existing.id, uri);
      console.log(`  repointed  ${entry.topic}  ${updated.apiVersion.handle}`);
    }
  }
}

async function main(): Promise<void> {
  loadEnvFiles();

  const shop = await getShop();
  heading("Shop");
  console.log(`  ${shop.name}`);
  console.log(`  ${shop.myshopifyDomain}  ${shop.plan.displayName}  ${shop.currencyCode}`);

  const configuredLocation = process.env.SHOPIFY_LOCATION_ID;
  const locations = await listLocations();
  heading(`Locations (${locations.length})`);
  for (const location of locations) {
    const state = location.isActive ? "active" : "INACTIVE";
    console.log(`  ${location.id}${marker(location.id, configuredLocation)}`);
    console.log(`    ${location.name}  (${state})`);
  }

  const configuredPublication = process.env.SHOPIFY_POS_PUBLICATION_ID;
  const publications = await listPublications();
  heading(`Publications (${publications.length})`);
  for (const publication of publications) {
    const pos = isPointOfSale(publication) ? "  ** Point of Sale **" : "";
    console.log(`  ${publication.id}${marker(publication.id, configuredPublication)}`);
    console.log(`    ${publication.name}${pos}`);
  }

  heading("What to put in .env.local");
  const pos = publications.find(isPointOfSale);

  if (locations.length === 1 && locations[0] !== undefined) {
    console.log(`  SHOPIFY_LOCATION_ID=${locations[0].id}`);
  } else {
    console.log(`  SHOPIFY_LOCATION_ID=<pick the stockroom's location from the list above>`);
  }

  if (pos !== undefined) {
    console.log(`  SHOPIFY_POS_PUBLICATION_ID=${pos.id}`);
  } else {
    console.log(`  SHOPIFY_POS_PUBLICATION_ID=<no Point of Sale channel found>`);
    console.log(`  Tally publishes to Point of Sale only. Add the channel to the store first.`);
  }

  await checkWebhooks(process.argv.includes("--register"));

  const throttle = throttleSnapshot();
  if (throttle !== undefined) {
    console.log(
      `\nRate limit: ${Math.round(throttle.currentlyAvailable)}/${throttle.maximumAvailable} points, ` +
        `restoring at ${throttle.restoreRate}/s.`,
    );
  }
  console.log();
}

main()
  .catch((error: unknown) => {
    if (error instanceof ShopifyHttpError && error.status === 401) {
      console.error(
        "\nShopify rejected the token (HTTP 401).\n" +
          "Run `pnpm shopify:install` to mint a new one.\n",
      );
    } else if (error instanceof ShopifyGraphQLError && error.isAccessDenied) {
      console.error(
        `\nThe token is missing a scope: ${error.message}\n` +
          "Update the app's scopes in the Dev Dashboard, then run `pnpm shopify:install` again.\n",
      );
    } else {
      console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  })
  .finally(() => closeShopifyClient());
