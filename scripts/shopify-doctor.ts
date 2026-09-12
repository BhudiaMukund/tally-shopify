/**
 * `pnpm shopify:doctor` — prove the token works and print the two IDs that
 * have to go into `.env.local`.
 *
 * Read-only. Safe to run against the live store at any time.
 */
import { closeShopifyClient, throttleSnapshot } from "@/lib/shopify/client";
import { ShopifyGraphQLError, ShopifyHttpError } from "@/lib/shopify/errors";
import { getShop } from "@/lib/shopify/operations/get-shop";
import { listLocations } from "@/lib/shopify/operations/list-locations";
import { isPointOfSale, listPublications } from "@/lib/shopify/operations/list-publications";

import { loadEnvFiles } from "./load-env";

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Marks the value already in the environment, so a re-run reads as a check. */
function marker(id: string, configured: string | undefined): string {
  if (configured === undefined || configured === "") return "";
  return id === configured ? "  <- already in .env.local" : "";
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
