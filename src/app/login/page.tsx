import type { Metadata } from "next";

import { safeCallbackUrl } from "@/lib/auth/routes";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — Tally" };

/**
 * The first thing anyone sees, and the only screen a signed-out person can
 * reach. Server component; the form is the one client island.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-12 sm:px-8">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-display text-ink text-4xl font-bold font-stretch-93%">Tally</h1>
        <p className="text-ink-soft mt-2 text-base">Stock and product intake.</p>

        <LoginForm callbackUrl={safeCallbackUrl(raw)} />

        <p className="text-ink-soft mt-8 text-xs">
          Accounts are created by an admin. Ask for one rather than signing up.
        </p>
      </div>
    </main>
  );
}
