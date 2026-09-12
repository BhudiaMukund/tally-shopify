"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { HOME_PATH, safeCallbackUrl } from "@/lib/auth/routes";

export interface LoginState {
  error?: string;
  /** Echoed back so a failed attempt does not clear the field they got right. */
  email?: string;
}

/**
 * One message for every failure.
 *
 * Distinguishing "no such account" from "wrong password" hands an attacker a
 * list of who works here. It says what to do rather than apologising, and it
 * names the thing that actually goes wrong on a phone.
 */
const FAILED =
  "That email and password do not match. Check for a capital letter the keyboard added.";

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeCallbackUrl(String(formData.get("callbackUrl") ?? "")) ?? HOME_PATH;

  if (email === "" || password === "") {
    return { error: "Enter your email and password.", email };
  }

  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) return { error: FAILED, email };
    // A successful sign-in redirects by throwing. Swallowing that here would
    // leave the user on the login screen having just logged in successfully.
    throw error;
  }

  return {};
}
