// TikTok CDN extraction via page-context API capture (tiktok-injected.js).
const DownpourTikTok = (function () {
  const RELAY_ID = "downpour-tt-relay";
  let idCounter = 0;
  let injected = false;

  function ensureRelay() {
    let relay = document.getElementById(RELAY_ID);
    if (!relay) {
      relay = document.createElement("div");
      relay.id = RELAY_ID;
      relay.style.display = "none";
      (document.documentElement || document.body).appendChild(relay);
    }
    return relay;
  }

  function injectPageScript() {
    if (injected) return;
    injected = true;
    DownpourInject.pageScript("tiktok-injected.js");
  }

  function tagElement(el) {
    if (!el.dataset.downpourTtId) {
      el.dataset.downpourTtId = "t" + (++idCounter);
    }
    return el.dataset.downpourTtId;
  }

  function extractForVideo(el) {
    return new Promise((resolve) => {
      if (!el || !el.isConnected) {
        resolve({ pageUrl: "", cdnUrl: "", streamUrl: "", altUrls: [], videoId: "", type: "video", error: "no-element", debug: { error: "no-element" } });
        return;
      }
      injectPageScript();
      const relay = ensureRelay();
      const reqId = String(++idCounter);
      const targetId = tagElement(el);

      let timeout = null;
      const onResult = () => {
        if (relay.getAttribute("data-res-id") !== reqId) return;
        relay.removeEventListener("downpour-tt:result", onResult);
        clearTimeout(timeout);
        let altUrls = [];
        try {
          altUrls = JSON.parse(relay.getAttribute("data-alt-urls") || "[]");
        } catch (e) {}
        let debug = {};
        try {
          debug = JSON.parse(relay.getAttribute("data-debug") || "{}");
        } catch (e) {}
        resolve({
          pageUrl: relay.getAttribute("data-page-url") || "",
          cdnUrl: relay.getAttribute("data-cdn-url") || "",
          streamUrl: relay.getAttribute("data-stream-url") || "",
          videoId: relay.getAttribute("data-video-id") || "",
          altUrls: Array.isArray(altUrls) ? altUrls : [],
          type: relay.getAttribute("data-type") || "video",
          error: relay.getAttribute("data-error") || "",
          debug
        });
      };

      relay.addEventListener("downpour-tt:result", onResult);
      timeout = setTimeout(() => {
        relay.removeEventListener("downpour-tt:result", onResult);
        resolve({ pageUrl: "", cdnUrl: "", streamUrl: "", altUrls: [], videoId: "", type: "video", error: "timeout", debug: { error: "timeout" } });
      }, 6000);

      relay.setAttribute("data-req-id", reqId);
      relay.setAttribute("data-target-id", targetId);
      relay.dispatchEvent(new Event("downpour-tt:extract"));
    });
  }

  function init() {
    if (!DownpourPlatforms.isTikTokHost(location.href)) return;
    injectPageScript();
    ensureRelay();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  return { extractForVideo, tagElement, isActive: () => DownpourPlatforms.isTikTokHost(location.href) };
})();