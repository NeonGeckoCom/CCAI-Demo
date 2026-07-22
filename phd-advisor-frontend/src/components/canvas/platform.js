// Tiny helper so keyboard shortcut hints adapt to the user's OS.
// Detect once at module load — we don't expect platform to change mid-session.
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const MOD_LABEL = isMac ? 'Cmd' : 'Ctrl';
