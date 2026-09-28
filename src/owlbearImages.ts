import OBR from "@owlbear-rodeo/sdk";

/**
 * Opens Owlbear's own asset picker over the user's uploaded images and
 * returns direct links to the chosen ones. Only the link is stored in the
 * document (never the upload's name), so pictures cost no room metadata.
 * Resolves to [] when the picker is cancelled or unavailable.
 */
export async function pickOwlbearImages(multiple = false): Promise<{ url: string }[]> {
  try {
    const picked = await OBR.assets.downloadImages(multiple);
    return picked
      .filter((download) => download.image?.url)
      .map((download) => ({ url: download.image.url }));
  } catch (error) {
    console.warn("Master Loot: Owlbear image picker failed", error);
    return [];
  }
}
