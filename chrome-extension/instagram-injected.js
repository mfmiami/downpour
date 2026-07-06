// Runs in the page JS context so it can read React fiber data on Instagram DOM nodes.
// Instagram serves <video> elements with blob: srcs; the real .mp4 lives in component props.
(function () {
  "use strict";
  if (window.__downpourIgInjected) return;
  window.__downpourIgInjected = true;

  const RELAY_ID = "downpour-ig-relay";
  const CDN = /(cdninstagram|fbcdn)/;

  function getFiber(el) {
    for (const key in el) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
        return el[key];
      }
    }
    return null;
  }

  function collectCdnUrls(root) {
    const out = [];
    const seen = new WeakSet();
    const stack = [[root, 0]];
    let budget = 14000;
    while (stack.length && budget-- > 0) {
      const top = stack.pop();
      const v = top[0];
      const d = top[1];
      if (!v || typeof v !== "object" || d > 10) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      for (const key in v) {
        if (typeof key === "string" && key.startsWith("__")) continue;
        let val;
        try {
          val = v[key];
        } catch (e) {
          continue;
        }
        if (typeof val === "string") {
          if (val.length > 24 && /^https?:\/\//.test(val) && CDN.test(val)) out.push(val);
        } else if (val && typeof val === "object") {
          if (val instanceof Node || val === window) continue;
          stack.push([val, d + 1]);
        }
      }
    }
    return out;
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  function bestFromSrcset(img) {
    const srcset = img.getAttribute("srcset");
    if (srcset) {
      let best = null;
      let bestW = -1;
      for (const part of srcset.split(",")) {
        const seg = part.trim().split(/\s+/);
        const url = seg[0];
        const w = seg[1] ? parseInt(seg[1], 10) : 0;
        if (url && w >= bestW) {
          best = url;
          bestW = w;
        }
      }
      if (best) return best;
    }
    return img.currentSrc || img.src || null;
  }

  function recentMp4s() {
    try {
      return performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => /\.mp4/i.test(n) && CDN.test(n));
    } catch (e) {
      return [];
    }
  }

  function isIgVideoUrl(url) {
    if (!url || !CDN.test(url)) return false;
    return /\.mp4(\?|$)/i.test(url) || /\/v\/t16[\d.-]*\//i.test(url) || /\/video\//i.test(url);
  }

  function isIgImageUrl(url) {
    if (!url || !CDN.test(url) || isIgVideoUrl(url)) return false;
    if (/\.(jpe?g|png|webp|heic|gif)(\?|$)/i.test(url)) return true;
    if (/\/v\/t51[\d.-]*\//i.test(url)) return true;
    if (/\/e\d+\//i.test(url) && !/\/v\/t16/i.test(url)) return true;
    if (/[?&]stp=dst-(jpe?g|png|webp)/i.test(url)) return true;
    if (/[?&]oh=/i.test(url) && !/\.mp4/i.test(url)) return true;
    return false;
  }

  function imageUrlScore(url) {
    let score = 0;
    const dim = url.match(/s(\d+)x(\d+)/i);
    if (dim) score += parseInt(dim[1], 10) * parseInt(dim[2], 10);
    const e = url.match(/\/e(\d+)\//i);
    if (e) score += parseInt(e[1], 10) * 100;
    if (/\.jpe?g/i.test(url) || /stp=dst-jpe?g/i.test(url)) score += 40;
    if (/\.webp/i.test(url)) score += 20;
    if (/\.png/i.test(url)) score += 10;
    score += Math.min(url.length, 120);
    return score;
  }

  function bestImageUrl(urls) {
    const imgs = uniq(urls.filter(isIgImageUrl));
    if (!imgs.length) return null;
    imgs.sort((a, b) => imageUrlScore(b) - imageUrlScore(a));
    return imgs[0];
  }

  function resolveMedia(el) {
    const isVideo = el.tagName === "VIDEO";

    if (!isVideo) {
      const direct = bestFromSrcset(el);
      if (direct && !direct.startsWith("blob:") && !direct.startsWith("data:") && CDN.test(direct)) {
        return { url: direct, type: "image" };
      }
    }

    let fiber = getFiber(el);
    let hops = 0;
    while (fiber && hops < 40) {
      const urls = [];
      if (fiber.memoizedProps) urls.push(...collectCdnUrls(fiber.memoizedProps));
      if (fiber.memoizedState) urls.push(...collectCdnUrls(fiber.memoizedState));
      if (fiber.pendingProps) urls.push(...collectCdnUrls(fiber.pendingProps));
      if (urls.length) {
        if (isVideo) {
          const mp4 = uniq(urls.filter((u) => isIgVideoUrl(u) || /\.mp4/i.test(u)));
          if (mp4.length) return { url: mp4[0], type: "video" };
        } else {
          const best = bestImageUrl(urls);
          if (best) return { url: best, type: "image" };
        }
      }
      fiber = fiber.return;
      hops++;
    }

    if (!isVideo) {
      const direct = bestFromSrcset(el);
      if (direct && !direct.startsWith("blob:") && !direct.startsWith("data:")) {
        return { url: direct, type: "image" };
      }
    }

    if (isVideo) {
      const mp4s = uniq(recentMp4s());
      if (mp4s.length) return { url: mp4s[mp4s.length - 1], type: "video" };
      const src = el.currentSrc || el.src || "";
      if (src && !src.startsWith("blob:")) return { url: src, type: "video" };
      if (el.poster) return { url: el.poster, type: "image" };
    }
    return { url: null, type: isVideo ? "video" : "image" };
  }

  function handleExtract() {
    const relay = document.getElementById(RELAY_ID);
    if (!relay) return;
    const reqId = relay.getAttribute("data-req-id");
    const targetId = relay.getAttribute("data-target-id");
    if (!reqId) return;

    const result = { url: "", type: "", error: "" };
    try {
      const el = document.querySelector(`[data-downpour-ig-id="${targetId}"]`);
      if (!el) {
        result.error = "element-gone";
      } else {
        const r = resolveMedia(el);
        result.type = r.type;
        if (r.url) result.url = r.url;
        else result.error = "no-url";
      }
    } catch (e) {
      result.error = "exception:" + (e && e.message ? e.message : "unknown");
    }

    relay.setAttribute("data-url", result.url);
    relay.setAttribute("data-type", result.type);
    relay.setAttribute("data-error", result.error);
    relay.setAttribute("data-res-id", reqId);
    relay.dispatchEvent(new Event("downpour-ig:result"));
  }

  function ensureRelay() {
    let relay = document.getElementById(RELAY_ID);
    if (!relay) {
      relay = document.createElement("div");
      relay.id = RELAY_ID;
      relay.style.display = "none";
      (document.documentElement || document.body).appendChild(relay);
    }
    relay.addEventListener("downpour-ig:extract", handleExtract);
    return relay;
  }

  ensureRelay();
})();