"use client";

import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { MAX_PHOTOS, usePhotoCapture, type CapturedPhoto } from "@/lib/capture/use-photo-capture";

/**
 * Shoot 1–4 photos, reorder, delete, first is the hero (BUILD_PLAN §9).
 *
 * The native file input with `capture="environment"` opens the phone's own
 * camera app rather than a custom `getUserMedia` viewfinder — unlike `/scan`,
 * nothing here needs a live decode loop, so the extra weight and permission
 * handling of a bespoke camera UI buys nothing. One photo per tap, immediately
 * handed to the capture hook, which owns downscaling and upload from there.
 */

const STATUS_LABEL: Record<CapturedPhoto["status"], string> = {
  processing: "Processing…",
  uploading: "Uploading…",
  uploaded: "Uploaded",
  failed: "Upload failed",
  "queued-offline": "Waiting for connection",
};

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
      <path
        d={direction === "up" ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "bg-card border-line text-ink flex size-9 items-center justify-center rounded-md border",
        "hover:bg-paper disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export interface PhotoCaptureProps {
  onPhotosChange?: (photos: CapturedPhoto[]) => void;
}

export function PhotoCapture({ onPhotosChange }: PhotoCaptureProps) {
  const { photos, addPhoto, movePhoto, removePhoto, retryPhoto, atLimit } = usePhotoCapture();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onPhotosChange?.(photos);
  }, [photos, onPhotosChange]);

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so shooting the same frame twice in a row still fires onChange.
          event.target.value = "";
          if (file) void addPhoto(file);
        }}
      />

      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <div className="border-line bg-paper relative aspect-square overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element -- next/image cannot load a blob: object URL */}
                <img src={photo.previewUrl} alt="" className="size-full object-cover" />

                {index === 0 ? (
                  <Badge tone="matched" size="sm" className="absolute top-1.5 left-1.5">
                    Hero
                  </Badge>
                ) : null}

                {photo.status !== "uploaded" ? (
                  <div className="bg-ink/60 absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center">
                    {photo.status === "processing" || photo.status === "uploading" ? (
                      <Spinner size="sm" tone="current" className="text-white" />
                    ) : (
                      <>
                        <Badge tone="failed" size="sm">
                          {STATUS_LABEL[photo.status]}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => retryPhoto(photo.id)}
                          className="text-xs font-medium text-white underline underline-offset-2"
                        >
                          Retry
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="mt-1.5 flex items-center justify-between">
                <div className="flex gap-1">
                  <IconButton
                    label="Move earlier"
                    disabled={index === 0}
                    onClick={() => movePhoto(photo.id, -1)}
                  >
                    <ChevronIcon direction="up" />
                  </IconButton>
                  <IconButton
                    label="Move later"
                    disabled={index === photos.length - 1}
                    onClick={() => movePhoto(photo.id, 1)}
                  >
                    <ChevronIcon direction="down" />
                  </IconButton>
                </div>
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  className="text-stop flex h-9 items-center px-2 text-sm font-medium"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        variant={photos.length === 0 ? "primary" : "secondary"}
        size="touch"
        fullWidth
        disabled={atLimit}
        onClick={() => inputRef.current?.click()}
      >
        {photos.length === 0 ? "Take photo" : `Take another (${photos.length}/${MAX_PHOTOS})`}
      </Button>
    </div>
  );
}
