"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createDownscaleClient, type DownscaleClient } from "./downscale-client";
import {
  deletePendingPhoto,
  listPendingPhotos,
  savePendingPhoto,
  type StoredPhoto,
} from "./offline-store";
import { uploadPhoto } from "./upload-photo";

/**
 * Capture → downscale → upload, one photo at a time, order preserved.
 *
 * "First photo is the hero" (BUILD_PLAN §9) is never a separate flag — it is
 * always `photos[0]`, so reordering the array *is* changing the hero, and
 * there is no second piece of state that could disagree with the order shown
 * on screen.
 */

export const MAX_PHOTOS = 4;

export type PhotoStatus = "processing" | "uploading" | "uploaded" | "failed" | "queued-offline";

export interface CapturedPhoto {
  id: string;
  /** An object URL for the thumbnail strip. Revoked when the photo is removed. */
  previewUrl: string;
  status: PhotoStatus;
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** Set once uploaded — what a draft's `images[]` entry will carry (commit 10). */
  key: string | null;
  publicUrl: string | null;
  error: string | null;
}

interface PhotoRecord extends CapturedPhoto {
  blob: Blob | null;
}

function toCaptured({ blob: _blob, ...rest }: PhotoRecord): CapturedPhoto {
  return rest;
}

export interface UsePhotoCapture {
  photos: CapturedPhoto[];
  /** True until at least one photo has finished uploading — the hero exists once this is true. */
  addPhoto: (file: File | Blob) => Promise<void>;
  movePhoto: (id: string, direction: -1 | 1) => void;
  removePhoto: (id: string) => void;
  retryPhoto: (id: string) => void;
  atLimit: boolean;
}

export function usePhotoCapture(): UsePhotoCapture {
  const [records, setRecords] = useState<PhotoRecord[]>([]);
  const downscaler = useRef<DownscaleClient | null>(null);
  const blobs = useRef(new Map<string, { blob: Blob; width: number; height: number }>());

  const ensureDownscaler = useCallback((): DownscaleClient => {
    downscaler.current ??= createDownscaleClient();
    return downscaler.current;
  }, []);

  /** A crash or a closed tab must not lose a photo that never made it out — pick up where it left off. */
  useEffect(() => {
    let cancelled = false;

    void listPendingPhotos().then((pending) => {
      if (cancelled || pending.length === 0) return;
      for (const stored of pending) {
        blobs.current.set(stored.id, {
          blob: stored.blob,
          width: stored.width,
          height: stored.height,
        });
      }
      setRecords((current) => [...current, ...pending.map(recordFromStored)]);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      downscaler.current?.terminate();
      for (const record of records) URL.revokeObjectURL(record.previewUrl);
    };
    // Runs once, on unmount — re-running per render would revoke a preview
    // still on screen the moment any other state in this hook changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRecord = useCallback((id: string, patch: Partial<PhotoRecord>) => {
    setRecords((current) =>
      current.map((record) => (record.id === id ? { ...record, ...patch } : record)),
    );
  }, []);

  const runUpload = useCallback(
    (id: string, blob: Blob, dimensions: { width: number; height: number }) => {
      updateRecord(id, { status: "uploading", error: null });

      void uploadPhoto(blob)
        .then(({ key, publicUrl }) => {
          updateRecord(id, { status: "uploaded", key, publicUrl });
          void deletePendingPhoto(id).catch(() => {});
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          updateRecord(id, { status: "failed", error: message });
          void savePendingPhoto({
            id,
            blob,
            width: dimensions.width,
            height: dimensions.height,
            capturedAt: Date.now(),
          }).catch(() => {});
        });
    },
    [updateRecord],
  );

  const addPhoto = useCallback(
    async (file: File | Blob) => {
      if (records.length >= MAX_PHOTOS) return;

      const id = crypto.randomUUID();
      const processingPreview = URL.createObjectURL(file);
      const record: PhotoRecord = {
        id,
        previewUrl: processingPreview,
        status: "processing",
        width: null,
        height: null,
        bytes: null,
        key: null,
        publicUrl: null,
        error: null,
        blob: null,
      };
      setRecords((current) => [...current, record]);

      try {
        const bitmap = await createImageBitmap(file);
        const { blob, width, height } = await ensureDownscaler().downscale(bitmap);

        URL.revokeObjectURL(processingPreview);
        const previewUrl = URL.createObjectURL(blob);
        blobs.current.set(id, { blob, width, height });

        updateRecord(id, { previewUrl, width, height, bytes: blob.size, blob });
        runUpload(id, blob, { width, height });
      } catch (error) {
        updateRecord(id, {
          status: "failed",
          error: error instanceof Error ? error.message : "Could not process that photo.",
        });
      }
    },
    [records.length, ensureDownscaler, updateRecord, runUpload],
  );

  const movePhoto = useCallback((id: string, direction: -1 | 1) => {
    setRecords((current) => {
      const index = current.findIndex((record) => record.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.length) return current;

      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved === undefined) return current;
      next.splice(target, 0, moved);
      return next;
    });
  }, []);

  const removePhoto = useCallback((id: string) => {
    setRecords((current) => {
      const record = current.find((entry) => entry.id === id);
      if (record !== undefined) URL.revokeObjectURL(record.previewUrl);
      return current.filter((entry) => entry.id !== id);
    });
    blobs.current.delete(id);
    void deletePendingPhoto(id).catch(() => {});
  }, []);

  const retryPhoto = useCallback(
    (id: string) => {
      const entry = blobs.current.get(id);
      if (entry === undefined) return;
      runUpload(id, entry.blob, { width: entry.width, height: entry.height });
    },
    [runUpload],
  );

  return {
    photos: records.map(toCaptured),
    addPhoto,
    movePhoto,
    removePhoto,
    retryPhoto,
    atLimit: records.length >= MAX_PHOTOS,
  };
}

function recordFromStored(stored: StoredPhoto): PhotoRecord {
  return {
    id: stored.id,
    previewUrl: URL.createObjectURL(stored.blob),
    status: "queued-offline",
    width: stored.width,
    height: stored.height,
    bytes: stored.blob.size,
    key: null,
    publicUrl: null,
    error: "Not uploaded yet — check the connection and retry.",
    blob: stored.blob,
  };
}
