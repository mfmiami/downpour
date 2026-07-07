// Guards chrome.runtime calls after extension reload (context invalidated).
const DownpourBridge = (function () {
  let invalidated = false;
  const teardownHooks = new Set();

  function alive() {
    if (invalidated) return false;
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      invalidated = true;
      return false;
    }
  }

  function isInvalidatedError(message) {
    return /extension context invalidated|context invalidated/i.test(message || "");
  }

  function teardown() {
    if (invalidated) return;
    invalidated = true;
    for (const fn of teardownHooks) {
      try { fn(); } catch (e) {}
    }
    teardownHooks.clear();
  }

  function onInvalidated(fn) {
    teardownHooks.add(fn);
  }

  function sendMessage(message, callback) {
    if (!alive()) {
      teardown();
      return false;
    }
    try {
      chrome.runtime.sendMessage(message, (...args) => {
        const err = chrome.runtime.lastError;
        if (err && isInvalidatedError(err.message)) teardown();
        if (callback) callback(...args);
      });
      return true;
    } catch (e) {
      if (isInvalidatedError(e.message)) teardown();
      return false;
    }
  }

  function getURL(path) {
    if (!alive()) return path;
    try {
      return chrome.runtime.getURL(path);
    } catch (e) {
      if (isInvalidatedError(e.message)) teardown();
      return path;
    }
  }

  return { alive, sendMessage, getURL, onInvalidated, teardown, isInvalidatedError };
})();