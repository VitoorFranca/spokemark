// Single source of truth for the product name (see docs/BRAND.md to change it).
export const APP_NAME = 'Spokemark';
export const APP_TAGLINE_EN = 'Live captions and transcripts for anything your Mac plays.';
export const APP_TAGLINE_PT = 'Legendas ao vivo e transcrições de tudo que o seu Mac toca.';
// Permanent identifier (reverse DNS of spokemark.app). macOS ties the "System Audio
// Recording" grant, Keychain items and preferences to it: changing it again makes every
// user grant the permission again. It was 'dev.local.livecaptions' up to v0.1.0.
export const BUNDLE_ID = 'app.spokemark.desktop';
// Data directories used by earlier builds; the first existing one is moved once to the new name.
export const LEGACY_DATA_DIR_NAMES = ['Earline', 'Live Captions'];
