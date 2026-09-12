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
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-12 sm:px-8">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-display text-ink text-4xl font-bold font-stretch-93%">Tally</h1>
        <p className="text-ink-soft mt-2 text-base">Stock and product intake.</p>

        {reason === "session-ended" ? (
          // Arriving here from /signed-out. Being logged out with no
          // explanation reads as a bug; say which thing happened.
          <p className="border-line bg-card text-ink mt-6 rounded-md border px-3.5 py-3 text-sm">
            Your session ended because the account is no longer active. An admin can turn it back
            on.
          </p>
        ) : null}

        <LoginForm callbackUrl={safeCallbackUrl(raw)} />

        <p className="text-ink-soft mt-8 text-xs">
          Accounts are created by an admin. Ask for one rather than signing up.
        </p>
      </div>
    </main>
  );
}
