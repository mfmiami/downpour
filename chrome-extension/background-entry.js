// Chrome service worker entry — platform hooks, mux, then shared background logic.
importScripts("platforms.js", "chrome-platform.js", "mux.min.js", "background.js");

// Expose job updater for chrome-platform save progress callbacks.
globalThis.__downpourUpdateJob = typeof update === "function" ? update : null;