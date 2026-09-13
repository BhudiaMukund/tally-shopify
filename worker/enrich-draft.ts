import type { Draft } from "@/lib/db/schemas/drafts";

/**
 * The actual enrichment step — commit 12's job (`feat(ai): taxonomy-
 * constrained vision enrichment`), not this one. BUILD_PLAN's commit 11
 * paragraph never mentions Gemini or Claude; this commit builds the queue
 * mechanics (retry, backoff, dead-letter, status transitions) around a seam
 * that does nothing yet, so "a job that throws is retried three times, ends
 * in the dead-letter queue" is provable without any AI existing to fail.
 *
 * Commit 12 replaces this body with a real `VisionProvider.enrich()` call
 * and starts writing `draft.ai`. Until then, a draft reaches `pending_review`
 * with no `ai.*` content at all — an honest scaffold, not a fake result.
 */
export async function enrichDraft(_draft: Draft): Promise<void> {
  // No-op — see the module comment above.
}
