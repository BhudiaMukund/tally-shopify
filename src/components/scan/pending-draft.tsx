"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PhotoCapture } from "@/components/capture/photo-capture";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { useToast } from "@/components/ui/toast";
import type { CapturedPhoto } from "@/lib/capture/use-photo-capture";
import type { LookupPending } from "@/lib/scan/lookup-client";

/**
 * A scan that matched a draft already on its way (BUILD_PLAN §9) — a third
 * state alongside "in the catalogue" and "not in the catalogue at all".
 * **Add to count** is the primary action here, never a fresh capture: staff
 * working through a carton scan the same item repeatedly, and that has to
 * accumulate in `counts[]`, not start a second draft.
 */

export interface PendingDraftProps {
  pending: LookupPending;
  barcode: string;
  onDone: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Captured — queued",
  enriching: "Being written up",
  pending_review: "Awaiting review",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  queued: "queued",
  enriching: "queued",
  pending_review: "queued",
};

function isReadyToSave(photo: CapturedPhoto): boolean {
  return (
    photo.status === "uploaded" &&
    photo.key !== null &&
    photo.publicUrl !== null &&
    photo.width !== null &&
    photo.height !== null &&
    photo.bytes !== null
  );
}

/** Where "price is different" and "recapture" send staff — an ordinary capture, with the same parent when there is one. */
function toIntakeParams(barcode: string, reason: string, pending: LookupPending): URLSearchParams {
  const params = new URLSearchParams({ barcode, reason });
  if (pending.parent === null) {
    // No live product to attach to yet — this is the same not-yet-created
    // product, at a different price, so the two drafts link up (§9).
    if (reason === "different-price") params.set("siblingOf", pending.draftId);
  } else {
    params.set("parentProductId", pending.parent.productId);
    params.set("parentTitle", pending.parent.productTitle);
    params.set("parentPosOnly", String(pending.parent.posOnly));
    params.set("parentOptionNames", pending.parent.optionName);
  }
  return params;
}

export function PendingDraft({ pending, barcode, onDone }: PendingDraftProps) {
  const router = useRouter();
  const toast = useToast();

  const [countScanId] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState(0);
  const [touched, setTouched] = useState(false);
  const [countedQty, setCountedQty] = useState(pending.countedQty);
  const [submittingCount, setSubmittingCount] = useState(false);

  const [retrying, setRetrying] = useState(false);

  const [addingPhotos, setAddingPhotos] = useState(false);
  const [newPhotos, setNewPhotos] = useState<CapturedPhoto[]>([]);
  const [savingPhotos, setSavingPhotos] = useState(false);

  function goTo(reason: string) {
    router.push(`/intake?${toIntakeParams(barcode, reason, pending).toString()}`);
  }

  async function addToCount() {
    setSubmittingCount(true);
    try {
      const response = await fetch(`/api/drafts/${pending.draftId}/count`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId: countScanId, qty }),
      });
      const body = (await response.json().catch(() => null)) as {
        countedQty?: number;
        message?: string;
      } | null;

      if (!response.ok) {
        toast({
          title: "Count not saved",
          description: body?.message ?? "Try again.",
          tone: "error",
        });
        return;
      }

      setCountedQty(body?.countedQty ?? countedQty + qty);
      toast({ title: "Count added", tone: "success" });
      onDone();
    } catch {
      toast({
        title: "Count not saved",
        description: "Check the connection and try again.",
        tone: "error",
      });
    } finally {
      setSubmittingCount(false);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      const response = await fetch(`/api/drafts/${pending.draftId}/retry`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        toast({ title: "Retry failed", description: body?.message ?? "Try again.", tone: "error" });
        return;
      }
      toast({ title: "Queued for another try", tone: "success" });
      onDone();
    } catch {
      toast({
        title: "Retry failed",
        description: "Check the connection and try again.",
        tone: "error",
      });
    } finally {
      setRetrying(false);
    }
  }

  async function savePhotos() {
    const uploaded = newPhotos.filter(isReadyToSave);
    if (uploaded.length === 0) return;

    setSavingPhotos(true);
    try {
      const response = await fetch(`/api/drafts/${pending.draftId}/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: uploaded.map((photo) => ({
            key: photo.key,
            url: photo.publicUrl,
            width: photo.width,
            height: photo.height,
            bytes: photo.bytes,
          })),
        }),
      });
      if (!response.ok) {
        toast({ title: "Photos not saved", description: "Try again.", tone: "error" });
        return;
      }
      toast({ title: "Photos added", tone: "success" });
      onDone();
    } catch {
      toast({
        title: "Photos not saved",
        description: "Check the connection and try again.",
        tone: "error",
      });
    } finally {
      setSavingPhotos(false);
    }
  }

  if (pending.status === "rejected") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-ink-soft text-sm">Already captured</p>
          <p className="text-ink font-mono text-xl tabular-nums">{barcode}</p>
        </div>
        <div className="border-stop bg-stop/8 rounded-md border p-4">
          <p className="text-ink text-sm font-semibold">This capture was rejected</p>
          {pending.rejectedReason !== null ? (
            <p className="text-ink-soft mt-1.5 text-sm">{pending.rejectedReason}</p>
          ) : null}
        </div>
        <Button size="touch" fullWidth onClick={() => goTo("new")}>
          Recapture
        </Button>
        <Button variant="ghost" size="md" onClick={onDone}>
          Scan again
        </Button>
      </div>
    );
  }

  if (pending.status === "failed") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-ink-soft text-sm">Captured — not in Shopify yet</p>
          <p className="text-ink font-mono text-xl tabular-nums">{barcode}</p>
        </div>
        <Badge tone="failed">Capture failed</Badge>
        {pending.error !== null ? (
          <p className="text-stop text-sm">{pending.error.message}</p>
        ) : null}
        <Button size="touch" fullWidth loading={retrying} onClick={() => void retry()}>
          Retry
        </Button>
        <Button variant="ghost" size="md" onClick={onDone}>
          Scan again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        {pending.imageUrl === null ? (
          <span aria-hidden="true" className="bg-paper size-14 shrink-0 rounded-md" />
        ) : (
          <Image
            src={pending.imageUrl}
            alt=""
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-md object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <Badge tone={STATUS_TONE[pending.status] ?? "neutral"}>
            {STATUS_LABEL[pending.status] ?? pending.status}
          </Badge>
          <p className="text-ink-soft mt-1 text-xs">
            Captured {new Date(pending.capturedAt).toLocaleDateString()}
          </p>
        </div>
        <span className="text-ink font-mono text-lg tabular-nums">${pending.price}</span>
      </div>

      <div className="bg-paper border-line flex items-center justify-between rounded-md border px-4 py-3">
        <span className="text-ink-soft text-sm">Counted so far</span>
        <span className="text-ink font-mono text-lg tabular-nums">{countedQty}</span>
      </div>

      {addingPhotos ? (
        <div className="flex flex-col gap-3">
          <PhotoCapture onPhotosChange={setNewPhotos} />
          <Button
            size="touch"
            fullWidth
            loading={savingPhotos}
            disabled={!newPhotos.some(isReadyToSave)}
            onClick={() => void savePhotos()}
          >
            Save photos
          </Button>
        </div>
      ) : (
        <>
          <NumberField
            label="Add to count"
            value={qty}
            onValueChange={(next) => {
              setQty(next);
              setTouched(true);
            }}
            fullWidth
          />
          <Button
            size="touch"
            fullWidth
            loading={submittingCount}
            disabled={!touched}
            onClick={() => void addToCount()}
          >
            Add to count
          </Button>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setAddingPhotos(true)}
              className="text-ink-soft hover:text-ink text-sm underline underline-offset-4"
            >
              Add photos
            </button>
            <button
              type="button"
              onClick={() => goTo("different-price")}
              className="text-ink-soft hover:text-ink text-sm underline underline-offset-4"
            >
              Price on this one is different
            </button>
          </div>
        </>
      )}

      <Button variant="ghost" size="md" onClick={onDone}>
        Scan again
      </Button>
    </div>
  );
}
