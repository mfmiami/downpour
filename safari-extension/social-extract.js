// X/Twitter page-context CDN + permalink extraction (relay to social-injected.js).
const DownpourSocial = (function () {
  const RELAY_ID = "downpour-social-relay";
  let idCounter = 0;
  let injected = false;

  function platform() {
    return DownpourPlatforms.getSocialPlatform(location.href);
  }

  function isActive() {
    const p = platform();
    return p === "twitter";
  }

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
    DownpourInject.pageScript("social-injected.js");
  }

  function tagElement(el) {
    if (!el.dataset.downpourSocialId) {
      el.dataset.downpourSocialId = "v" + (++idCounter);
    }
    return el.dataset.downpourSocialId;
  }

  function extractForVideo(el, platformName) {
    return new Promise((resolve) => {
      if (!el || !el.isConnected) {
        resolve({ pageUrl: "", cdnUrl: "", streamUrl: "", type: "video", error: "no-element" });
        return;
      }
      injectPageScript();
      const relay = ensureRelay();
      const reqId = String(++idCounter);
      const targetId = tagElement(el);
      const plat = platformName || platform();

      let timeout = null;
      const onResult = () => {
        if (relay.getAttribute("data-res-id") !== reqId) return;
        relay.removeEventListener("downpour-social:result", onResult);
        clearTimeout(timeout);
        resolve({
          pageUrl: relay.getAttribute("data-page-url") || "",
          cdnUrl: relay.getAttribute("data-cdn-url") || "",
          streamUrl: relay.getAttribute("data-stream-url") || "",
          type: relay.getAttribute("data-type") || "video",
          error: relay.getAttribute("data-error") || ""
        });
      };

      relay.addEventListener("downpour-social:result", onResult);
      timeout = setTimeout(() => {
        relay.removeEventListener("downpour-social:result", onResult);
        resolve({ pageUrl: "", cdnUrl: "", streamUrl: "", type: "video", error: "timeout" });
      }, 5000);

      relay.setAttribute("data-req-id", reqId);
      relay.setAttribute("data-target-id", targetId);
      relay.setAttribute("data-platform", plat);
      relay.dispatchEvent(new Event("downpour-social:extract"));
    });
  }

  function init() {
    if (!isActive()) return;
    injectPageScript();
    ensureRelay();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  return { extractForVideo, tagElement, isActive };
})();