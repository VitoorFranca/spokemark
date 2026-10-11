// Single source of truth for the product name (see docs/BRAND.md to change it).
export const APP_NAME = 'Spokemark';
export const APP_TAGLINE_EN = 'Live captions and transcripts for anything your Mac plays.';
export const APP_TAGLINE_PT = 'Legendas ao vivo e transcrições de tudo que o seu Mac toca.';
// Kept from the MVP on purpose: the TCC "System Audio Recording" grant is tied to the
// bundle identifier, so renaming the product does not force users to re-grant it.
export const BUNDLE_ID = 'dev.local.livecaptions';
// Data directories used by earlier builds; the first existing one is moved once to the new name.
export const LEGACY_DATA_DIR_NAMES = ['Earline', 'Live Captions'];
