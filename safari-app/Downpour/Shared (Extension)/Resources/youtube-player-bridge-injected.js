// Reads ytInitialPlayerResponse from the page context on request.
(function () {
  "use strict";
  if (window.__downpourYtPlayerBridge) return;
  window.__downpourYtPlayerBridge = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "VSD_YT_PLAYER_REQUEST") return;
    const tag = event.data.tag;
    if (!tag) return;
    window.postMessage({ type: tag, player: window.ytInitialPlayerResponse || null }, "*");
  });
})();