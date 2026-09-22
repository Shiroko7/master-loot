import type { LootDocument } from "./types";

/** Keep older saved headlines/decks readable without ever promoting the paper name. */
export function resolveNewspaperHeading(
  doc: LootDocument,
  story: { headline?: string; subhead?: string },
): { headline: string; deck: string } {
  return {
    headline: (doc.newspaperHeadline?.trim() || story.headline ||
      (doc.newspaperHeadline === undefined ? doc.newspaperSubtitle : "") || "").trim(),
    deck: (doc.newspaperDeck?.trim() || story.subhead ||
      (doc.newspaperDeck === undefined && story.headline ? doc.newspaperSubtitle : "") || "").trim(),
  };
}
