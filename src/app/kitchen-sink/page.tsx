import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { Spinner } from "@/components/ui/spinner";

import { CountDemo, LoadingButtonDemo, SheetDemo, ToastDemo } from "./demos";

export const metadata: Metadata = {
  title: "Tally — design system",
  description: "Every primitive in every state.",
};

/* -------------------------------------------------------------------------- */

const SECTIONS = [
  ["01", "Palette", "palette"],
  ["02", "Type", "type"],
  ["03", "Button", "button"],
  ["04", "Input", "input"],
  ["05", "Number field", "number-field"],
  ["06", "Badge", "badge"],
  ["07", "Sheet", "sheet"],
  ["08", "Toast", "toast"],
  ["09", "Spinner", "spinner"],
  ["10", "Empty state", "empty-state"],
  ["11", "In context", "in-context"],
] as const;

function Section({
  index,
  title,
  id,
  note,
  children,
}: {
  index: string;
  title: string;
  id: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-line scroll-mt-20 border-t pt-8 pb-14">
      <header className="mb-6 flex items-baseline gap-3">
        <span className="text-ink-soft font-mono text-xs tabular-nums">{index}</span>
        <h2 className="font-display text-ink text-2xl font-bold font-stretch-97%">{title}</h2>
      </header>
      {note ? <p className="text-ink-soft mb-6 max-w-prose text-sm">{note}</p> : null}
      {children}
    </section>
  );
}

/** The mono caption under each example — the spec, not decoration. */
function Spec({ children }: { children: ReactNode }) {
  return <p className="text-ink-soft text-2xs mt-2.5 font-mono">{children}</p>;
}

function Example({ spec, children }: { spec: string; children: ReactNode }) {
  return (
    <div>
      {children}
      <Spec>{spec}</Spec>
    </div>
  );
}

function Swatch({ token, hex, note }: { token: string; hex: string; note?: string }) {
  return (
    <li className="min-w-[7.5rem] flex-1">
      <div
        className="border-line h-20 border"
        style={{ backgroundColor: `var(--color-${token})` }}
      />
      <p className="text-ink mt-2 text-sm font-medium">--{token}</p>
      <p className="text-ink-soft text-2xs font-mono uppercase">{hex}</p>
      {note ? <p className="text-ink-soft mt-1 text-xs">{note}</p> : null}
    </li>
  );
}

const BADGE_TONES: { tone: BadgeTone; label: string; meaning: string }[] = [
  { tone: "matched", label: "In catalogue", meaning: "Barcode found in Shopify" },
  { tone: "new", label: "New product", meaning: "Nothing matched this barcode" },
  { tone: "queued", label: "Waiting for review", meaning: "Drafted, not published" },
  { tone: "failed", label: "Publish failed", meaning: "Shopify returned userErrors" },
  { tone: "neutral", label: "Draft", meaning: "No state worth colouring" },
];

/* -------------------------------------------------------------------------- */

export default function KitchenSink() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-24 sm:px-8">
      <header className="border-ink border-b-2 pt-10 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h1 className="font-display text-ink text-5xl font-bold font-stretch-90%">Tally</h1>
          <p className="text-ink-soft text-2xs font-mono">
            design system — palette &ldquo;foil&rdquo;
          </p>
        </div>
        <p className="text-ink-soft mt-4 max-w-prose text-base">
          Every primitive in every state. A tool for the stockroom of a party shop, used one-handed,
          on a phone, under fluorescent light, by someone holding a box of balloons.
        </p>
      </header>

      <nav
        aria-label="Sections"
        className="border-line flex flex-wrap gap-x-5 gap-y-2 border-b py-4"
      >
        {SECTIONS.map(([index, title, id]) => (
          <a
            key={id}
            href={`#${id}`}
            className="text-ink-soft hover:text-ink flex items-baseline gap-1.5 text-sm transition-colors"
          >
            <span className="text-2xs font-mono tabular-nums">{index}</span>
            {title}
          </a>
        ))}
      </nav>

      <main className="mt-2">
        {/* 01 ------------------------------------------------------------- */}
        <Section
          index="01"
          id="palette"
          title="Palette"
          note="Cool silver-blue paper, deep ink, one hot accent. Status colour is information, not decoration — it never appears without a label or a shape beside it."
        >
          <ul className="flex flex-wrap gap-4">
            <Swatch token="paper" hex="#EEF1F5" note="App background" />
            <Swatch token="card" hex="#FFFFFF" note="Raised surface" />
            <Swatch token="ink" hex="#14181F" note="Text" />
            <Swatch token="ink-soft" hex="#5A6472" note="Secondary text" />
            <Swatch token="accent" hex="#E8175D" note="Primary action only" />
          </ul>
          <ul className="mt-6 flex flex-wrap gap-4">
            <Swatch token="ok" hex="#0F8A5F" note="Matched, saved" />
            <Swatch token="warn" hex="#C77700" note="Needs review" />
            <Swatch token="stop" hex="#C42B1C" note="Failed, conflict" />
            <Swatch token="line" hex="#D3DAE3" note="Hairlines, borders" />
          </ul>
          <ul className="mt-6 flex flex-wrap gap-4">
            <Swatch token="ok-ink" hex="#0C7953" note="Text-safe --ok" />
            <Swatch token="warn-ink" hex="#9B5B00" note="Text-safe --warn" />
          </ul>

          <table className="border-line mt-8 w-full border-t text-sm">
            <caption className="text-ink-soft pt-4 pb-3 text-left text-sm">
              Measured against WCAG 1.4.3, both surfaces the app actually paints text on.
            </caption>
            <thead>
              <tr className="text-ink-soft border-line border-b text-left text-xs">
                <th className="py-2 font-medium">As text</th>
                <th className="py-2 text-right font-medium">on --card</th>
                <th className="py-2 text-right font-medium">on --paper</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y font-mono text-xs tabular-nums">
              {[
                ["--ink-soft", "6.00", "5.30", true],
                ["--stop", "5.66", "5.00", true],
                ["--ok-ink", "5.42", "4.78", true],
                ["--warn-ink", "5.40", "4.76", true],
                ["--accent", "4.46", "3.93", false],
                ["--ok", "4.36", "3.84", false],
                ["--warn", "3.46", "3.06", false],
              ].map(([token, card, paper, passes]) => (
                <tr key={token as string} className={passes ? "text-ink" : "text-ink-soft"}>
                  <td className="py-2">{token}</td>
                  <td className="py-2 text-right">{card}</td>
                  <td className="py-2 text-right">{paper}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-ink-soft mt-6 max-w-prose text-sm">
            The rows in grey are below 4.5:1 and are fills, not text.{" "}
            <span className="text-ink font-medium">
              Note that --accent measures 4.46:1 on white, not the 4.6 the build plan claims
            </span>{" "}
            — white on a raspberry button is marginally under the floor at the md size, where the
            label is 16px. Darkening the token to #D61455 would fix it; that is a brand decision, so
            it has not been made here.
          </p>
          <p className="text-ink-soft mt-3 max-w-prose text-sm">
            Where a status word genuinely wants to be coloured, use the ink variants:{" "}
            <span className="text-ok-ink font-medium">stock updated</span>,{" "}
            <span className="text-warn-ink font-medium">waiting for review</span>,{" "}
            <span className="text-stop font-medium">publish failed</span>. Badges and chips still
            keep an ink label and give the hue to the shape, because at badge sizes the label is
            small and the shape is what carries across a scuffed screen.
          </p>
        </Section>

        {/* 02 ------------------------------------------------------------- */}
        <Section
          index="02"
          id="type"
          title="Type"
          note="Bricolage Grotesque for headings and the scan result. IBM Plex Sans for everything you read. IBM Plex Mono for digit strings that get compared by eye, and nothing else."
        >
          <div className="space-y-6">
            <Example spec="font-display text-5xl font-stretch-90% font-bold — scan result">
              <p className="font-display text-ink text-5xl font-bold font-stretch-90%">
                Foil balloon
              </p>
            </Example>
            <Example spec="font-display text-3xl font-stretch-95% font-bold — page heading">
              <p className="font-display text-ink text-3xl font-bold font-stretch-95%">
                Waiting for review
              </p>
            </Example>
            <Example spec="font-display text-xl font-bold — section heading">
              <p className="font-display text-ink text-xl font-bold">
                Three variants share this barcode
              </p>
            </Example>
            <Example spec="text-base — body, IBM Plex Sans 400">
              <p className="text-ink max-w-prose text-base">
                Point the camera at the barcode. If the product is already in the catalogue you go
                straight to a count; if it is not, Tally takes photos and drafts the listing.
              </p>
            </Example>
            <Example spec="text-sm text-ink-soft — secondary body">
              <p className="text-ink-soft max-w-prose text-sm">
                Scanned products land here for review. Nothing publishes without an admin.
              </p>
            </Example>
            <Example spec="font-mono text-6xl tabular-nums — count numeral">
              <p className="text-ink font-mono text-6xl font-medium tabular-nums">36</p>
            </Example>
            <Example spec="font-mono text-lg tabular-nums — barcode, SKU, price">
              <p className="text-ink flex flex-wrap gap-x-6 gap-y-1 font-mono text-lg tabular-nums">
                <span>50123456789012</span>
                <span>£4.00</span>
                <span>PS-4471</span>
              </p>
            </Example>
          </div>
        </Section>

        {/* 03 ------------------------------------------------------------- */}
        <Section
          index="03"
          id="button"
          title="Button"
          note="Buttons name the action that happens, and the toast repeats the verb. Every size clears the 44px touch floor; touch is the 56px bar for the one primary action on a phone."
        >
          <div className="space-y-8">
            {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
              <div key={variant}>
                <p className="text-ink-soft text-2xs mb-3 font-mono">
                  variant=&quot;{variant}&quot;
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant={variant}>Update stock</Button>
                  <Button variant={variant} disabled>
                    Update stock
                  </Button>
                  <Button variant={variant} loading>
                    Updating stock
                  </Button>
                </div>
                <Spec>default, disabled, loading</Spec>
              </div>
            ))}

            <div>
              <p className="text-ink-soft text-2xs mb-3 font-mono">size</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Rescan</Button>
                <Button size="md">Send for review</Button>
                <Button size="touch">Publish 6 products</Button>
              </div>
              <Spec>sm 44px, md 48px, touch 56px</Spec>
            </div>

            <div>
              <p className="text-ink-soft text-2xs mb-3 font-mono">
                press it — the spinner is real
              </p>
              <LoadingButtonDemo />
              <Spec>size=&quot;touch&quot; loading toggles for 1.8s</Spec>
            </div>

            <div className="max-w-sm">
              <p className="text-ink-soft text-2xs mb-3 font-mono">
                the bottom action bar, at 360px
              </p>
              <div
                className="bg-card border-line shadow-bar rounded-lg border p-4"
                style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}
              >
                <Button size="touch" fullWidth>
                  Update stock
                </Button>
              </div>
              <Spec>size=&quot;touch&quot; fullWidth</Spec>
            </div>
          </div>
        </Section>

        {/* 04 ------------------------------------------------------------- */}
        <Section
          index="04"
          id="input"
          title="Input"
          note="Errors say what happened and what to do. They do not apologise and they are never vague."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <Example spec="default">
              <Input label="Product title" placeholder="Foil balloon, star, gold 45cm" />
            </Example>
            <Example spec="hint">
              <Input
                label="Vendor"
                defaultValue="Alpen"
                hint="Only vendors already used in the catalogue."
              />
            </Example>
            <Example spec="prefix + inputMode + mono">
              <Input label="Price" prefix="£" defaultValue="4.00" inputMode="decimal" mono />
            </Example>
            <Example spec="suffix">
              <Input label="Pack size" defaultValue="12" suffix="per pack" mono />
            </Example>
            <Example spec="mono — a scanned digit string">
              <Input label="Barcode" defaultValue="50123456789012" mono inputMode="numeric" />
            </Example>
            <Example spec="error">
              <Input
                label="Barcode"
                defaultValue="501234"
                mono
                error="6 digits is not a valid barcode. Scan again or type all 13."
              />
            </Example>
            <Example spec="disabled">
              <Input label="Shopify variant" defaultValue="Default Title" disabled />
            </Example>
            <Example spec='size="touch" — 56px, hideLabel'>
              <Input
                label="Barcode"
                hideLabel
                size="touch"
                mono
                inputMode="numeric"
                placeholder="Type the barcode"
              />
            </Example>
          </div>
        </Section>

        {/* 05 ------------------------------------------------------------- */}
        <Section
          index="05"
          id="number-field"
          title="Number field"
          note="64px steppers, a mono numeral, and press-and-hold to run the count up. Every change ticks so a press that did nothing is obvious."
        >
          <div className="space-y-8">
            <div>
              <CountDemo />
              <Spec>size=&quot;touch&quot; controlled, hold to repeat</Spec>
            </div>
            <div className="flex flex-wrap items-start gap-8">
              <Example spec='size="md" — desktop admin'>
                <NumberField label="Counted" size="md" defaultValue={12} />
              </Example>
              <Example spec="at max — the + stepper disables">
                <NumberField label="Counted" size="md" defaultValue={20} max={20} />
              </Example>
              <Example spec="disabled">
                <NumberField label="Counted" size="md" defaultValue={8} disabled />
              </Example>
            </div>
            <div className="max-w-xs">
              <NumberField
                label="New count"
                size="md"
                defaultValue={0}
                error="A till sale changed this quantity mid-count. Rescan and count again."
              />
              <Spec>error</Spec>
            </div>
            <div className="max-w-sm">
              <NumberField label="New count" defaultValue={24} fullWidth />
              <Spec>fullWidth — fills the rail at 360px</Spec>
            </div>
          </div>
        </Section>

        {/* 06 ------------------------------------------------------------- */}
        <Section
          index="06"
          id="badge"
          title="Badge"
          note="Each state gets its own silhouette as well as its own hue, so it survives colourblindness, glare and a scuffed phone screen."
        >
          <ul className="divide-line border-line divide-y border-y">
            {BADGE_TONES.map(({ tone, label, meaning }) => (
              <li
                key={tone}
                className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="sm:w-44">
                  <Badge tone={tone} size="md">
                    {label}
                  </Badge>
                </span>
                <span className="text-ink-soft flex-1 text-sm">{meaning}</span>
                <span className="text-ink-soft text-2xs font-mono">tone=&quot;{tone}&quot;</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Badge tone="matched">In catalogue</Badge>
            <Badge tone="matched" mono>
              +12
            </Badge>
            <Badge tone="failed" mono>
              −3
            </Badge>
            <Badge tone="queued" mono size="md">
              6 waiting
            </Badge>
          </div>
          <Spec>size=&quot;sm&quot; is the default, mono for numerals</Spec>
        </Section>

        {/* 07 ------------------------------------------------------------- */}
        <Section
          index="07"
          id="sheet"
          title="Sheet"
          note="Bottom on a phone, where the thumb is. A side panel on desktop, so the list it came from stays on screen. Escape, the scrim and a downward swipe all close it."
        >
          <SheetDemo />
          <Spec>side=&quot;bottom&quot; and side=&quot;right&quot;</Spec>
        </Section>

        {/* 08 ------------------------------------------------------------- */}
        <Section
          index="08"
          id="toast"
          title="Toast"
          note="The toast repeats the verb from the button that caused it. Errors stay twice as long, because they have to be read."
        >
          <ToastDemo />
          <Spec>tone success, error with an action, info</Spec>
        </Section>

        {/* 09 ------------------------------------------------------------- */}
        <Section
          index="09"
          id="spinner"
          title="Spinner"
          note="Marked as essential motion: reduced-motion slows it rather than freezing it, because a stopped spinner reads as a hung app."
        >
          <div className="flex flex-wrap items-center gap-8">
            <Example spec="size sm, md, lg">
              <div className="text-ink-soft flex items-center gap-4">
                <Spinner size="sm" />
                <Spinner size="md" />
                <Spinner size="lg" />
              </div>
            </Example>
            <Example spec="tone accent, soft">
              <div className="flex items-center gap-4">
                <Spinner size="md" tone="accent" />
                <Spinner size="md" tone="soft" />
              </div>
            </Example>
            <Example spec="inline, with a label">
              <p className="text-ink-soft flex items-center gap-2 text-sm">
                <Spinner size="sm" tone="soft" label="Working" />
                Enriching 3 drafts
              </p>
            </Example>
          </div>
        </Section>

        {/* 10 ------------------------------------------------------------- */}
        <Section
          index="10"
          id="empty-state"
          title="Empty state"
          note="An instruction, not an illustration. An empty screen is a chance to say what to do next, so it says it."
        >
          <div className="grid gap-10 sm:grid-cols-2">
            <Example spec="no action — the queue fills itself">
              <EmptyState
                title="Nothing waiting"
                instruction="Scanned products land here for review."
              />
            </Example>
            <Example spec="with an action">
              <EmptyState
                title="No scans today"
                instruction="Open the scanner and point the camera at a barcode to start counting."
                action={<Button>Open the scanner</Button>}
              />
            </Example>
          </div>
        </Section>

        {/* 11 ------------------------------------------------------------- */}
        <Section
          index="11"
          id="in-context"
          title="In context"
          note="The count screen, assembled from the primitives above and set at the narrowest phone width we support."
        >
          <div className="border-line bg-paper w-[360px] max-w-full border">
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <span className="font-display text-ink text-xl font-bold">Tally</span>
              <Badge tone="queued" mono>
                12 queued
              </Badge>
            </div>

            <div aria-hidden="true" className="flex gap-1 px-4">
              {[true, true, false, false].map((done, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${done ? "bg-ink" : "bg-line"}`}
                />
              ))}
            </div>

            <div className="bg-card border-line mx-4 mt-4 border p-4">
              <Badge tone="matched">In catalogue</Badge>
              <p className="font-display text-ink mt-3 text-3xl font-bold font-stretch-95%">
                Foil balloon, star, gold
              </p>
              <p className="text-ink-soft mt-1 text-sm">Alpen, 45cm</p>
              <p className="text-ink mt-3 font-mono text-sm tabular-nums">50123456789012</p>
              <div className="border-line mt-4 flex items-baseline justify-between border-t pt-3">
                <span className="text-ink-soft text-sm">On hand</span>
                <span className="text-ink font-mono text-3xl font-medium tabular-nums">24</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-ink-soft text-sm">Price</span>
                <span className="text-ink font-mono text-xl font-medium tabular-nums">£4.00</span>
              </div>
            </div>

            <div className="mt-5 px-4">
              <NumberField label="New count" defaultValue={24} fullWidth />
            </div>

            <div className="border-line bg-card mt-6 border-t p-4">
              <Button size="touch" fullWidth>
                Update stock
              </Button>
              <button
                type="button"
                className="text-ink-soft hover:text-ink mt-1 flex h-11 w-full cursor-pointer items-center justify-center text-sm underline underline-offset-4 transition-colors"
              >
                The price on this one is different
              </button>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
