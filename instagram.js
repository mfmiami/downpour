// Instagram CDN URL extraction via page-context React fiber (igdownloader pattern).
const DownpourInstagram = (function () {
  const RELAY_ID = "downpour-ig-relay";
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
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("instagram-injected.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  function tagElement(el) {
    if (!el.dataset.downpourIgId) {
      el.dataset.downpourIgId = "m" + (++idCounter);
    }
    return el.dataset.downpourIgId;
  }

  function extractMediaUrl(el) {
    return new Promise((resolve) => {
      if (!el || !el.isConnected) {
        resolve({ url: "", type: "", error: "no-element" });
        return;
      }
      injectPageScript();
      const relay = ensureRelay();
      const reqId = String(++idCounter);
      const targetId = tagElement(el);

      let timeout = null;
      const onResult = () => {
        if (relay.getAttribute("data-res-id") !== reqId) return;
        relay.removeEventListener("downpour-ig:result", onResult);
        clearTimeout(timeout);
        resolve({
          url: relay.getAttribute("data-url") || "",
          type: relay.getAttribute("data-type") || "",
          error: relay.getAttribute("data-error") || ""
        });
      };

      relay.addEventListener("downpour-ig:result", onResult);
      timeout = setTimeout(() => {
        relay.removeEventListener("downpour-ig:result", onResult);
        resolve({ url: "", type: "", error: "timeout" });
      }, 5000);

      relay.setAttribute("data-req-id", reqId);
      relay.setAttribute("data-target-id", targetId);
      relay.dispatchEvent(new Event("downpour-ig:extract"));
    });
  }

  function extensionFromUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      const pathExt = u.pathname.match(/\.(jpe?g|png|webp|heic|gif)$/i);
      if (pathExt) {
        const e = pathExt[1].toLowerCase();
        return e === "jpeg" ? "jpg" : e;
      }
      const stp = u.search.match(/[?&]stp=dst-(jpe?g|png|webp)/i);
      if (stp) {
        const e = stp[1].toLowerCase();
        return e === "jpeg" ? "jpg" : e;
      }
    } catch (e) {}
    if (/\.webp(\?|$)/i.test(url)) return "webp";
    if (/\.png(\?|$)/i.test(url)) return "png";
    if (/\.gif(\?|$)/i.test(url)) return "gif";
    if (/\.heic(\?|$)/i.test(url)) return "heic";
    if (/\.jpe?g(\?|$)/i.test(url)) return "jpg";
    return null;
  }

  function extensionFromBytes(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
    return null;
  }

  function makeFilename(url, mediaType) {
    let base = "instagram";
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last) base = last.replace(/\.(jpe?g|png|webp|heic|gif|mp4|mov)$/i, "");
    } catch (e) {}
    base = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "instagram";
    const ext = mediaType === "video" ? "mp4" : (extensionFromUrl(url) || "jpg");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `ig_${base}_${stamp}.${ext}`;
  }

  function init() {
    if (!DownpourPlatforms.isInstagramHost(location.href)) return;
    injectPageScript();
    ensureRelay();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  return { extractMediaUrl, tagElement, makeFilename, extensionFromUrl, extensionFromBytes };
})();