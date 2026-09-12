import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guards";
import { HOME_PATH } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Not your account — Tally" };

/**
 * Where a signed-in staff member lands after asking for an admin route.
 *
 * A login form would be the wrong answer: they are signed in, and signing in
 * again as themselves changes nothing. Say which account they are on and what
 * it would take.
 */
export default async function DeniedPage({ searchParams }: PageProps<"/denied">) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const from = Array.isArray(params.from) ? params.from[0] : params.from;

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-12 sm:px-8">
      <div className="mx-auto w-full max-w-md">
        <h1 className="font-display text-ink text-3xl font-bold font-stretch-95%">
          That page needs an admin account
        </h1>
        <p className="text-ink-soft mt-3 text-base">
          You are signed in as {user.name} ({user.email}) — a staff account.{" "}
          {from === undefined ? "That page is admin-only." : <>{from} is admin-only.</>} An admin
          can change your role, or open the page for you.
        </p>
        <div className="mt-8">
          <Link href={HOME_PATH} className={buttonClassName({ variant: "secondary" })}>
            Back to scanning
          </Link>
        </div>
      </div>
    </main>
  );
}
