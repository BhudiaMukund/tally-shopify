import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Admin — Tally" };

/**
 * Admin-only, and gated twice: the proxy turns staff away before this renders,
 * and `requireAdmin` checks again here against the live `users` row. The
 * review console itself lands in commit 13.
 */
export default async function AdminPage() {
  const user = await requireAdmin();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8">
      <h1 className="font-display text-ink text-3xl font-bold font-stretch-95%">Admin</h1>
      <p className="text-ink-soft mt-3 max-w-prose text-base">
        Signed in as {user.name}, an admin account. The review console, the publish queue and the
        activity view are built in later plan items; this page exists so the role split can be
        exercised now.
      </p>
    </main>
  );
}
