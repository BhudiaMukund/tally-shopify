"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { login, type LoginState } from "./actions";

const EMPTY: LoginState = {};

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, formAction, pending] = useActionState(login, EMPTY);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />

      {state.error ? (
        // Announced on arrival: a staff member who submitted with the keyboard
        // covering the field would otherwise get no feedback at all.
        <p
          role="alert"
          className="border-stop/35 bg-stop/6 text-ink rounded-md border px-3.5 py-3 text-sm"
        >
          {state.error}
        </p>
      ) : null}

      <Input
        label="Email"
        name="email"
        type="email"
        size="touch"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="email"
        required
        defaultValue={state.email}
        autoFocus
      />

      <Input
        label="Password"
        name="password"
        type="password"
        size="touch"
        autoComplete="current-password"
        required
      />

      <Button type="submit" size="touch" fullWidth loading={pending} className="mt-2">
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
