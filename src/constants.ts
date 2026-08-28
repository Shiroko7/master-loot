export const EXT_ID = "com.shiro.master-loot";

/** Item metadata key on a token that holds its LootContainer. */
export const LOOT_KEY = `${EXT_ID}/loot`;
/** Item metadata key that marks an item as a loot badge attachment. */
export const BADGE_KEY = `${EXT_ID}/badge`;
/** Item metadata key that marks an item as a loot sparkle effect. */
export const SPARKLE_KEY = `${EXT_ID}/sparkle`;
/** Scene metadata key that stores the display order of loot containers. */
export const ORDER_KEY = `${EXT_ID}/container-order`;
/** Room metadata key for GM-wide settings (e.g. badge corner). */
export const SETTINGS_KEY = `${EXT_ID}/settings`;

export const LOOT_POPOVER_ID = `${EXT_ID}/loot-popover`;
export const DOC_MODAL_ID = `${EXT_ID}/document-modal`;
export const EDITOR_MODAL_ID = `${EXT_ID}/editor-modal`;

export const CTX_EDIT_ID = `${EXT_ID}/context-edit`;
export const CTX_OPEN_ID = `${EXT_ID}/context-open`;

/** Keep documents well under Owlbear Rodeo's per-item metadata size limit. */
export const MAX_DOC_CHARS = 10_000;

export const PREFS_STORAGE_KEY = `${EXT_ID}/prefs`;
export const BACKUP_STORAGE_PREFIX = `${EXT_ID}/backup/`;
