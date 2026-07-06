// Page-context media + permalink extraction for TikTok and X (blob src → real CDN URL).
(function () {
  "use strict";
  if (window.__downpourSocialInjected) return;
  window.__downpourSocialInjected = true;

  const RELAY_ID = "downpour-social-relay";

  function getFiber(el) {
    for (const key in el) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
        return el[key];
      }
    }
    return null;
  }

  function collectUrls(root, test) {
    const out = [];
    const seen = new WeakSet();
    const stack = [[root, 0]];
    let budget = 12000;
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
        if (typeof val === "string" && val.length > 20 && /^https?:\/\//.test(val) && test(val)) {
          out.push(val);
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

  function isActiveVideo(el) {
    return el && el.tagName === "VIDEO" && !el.paused && !el.ended;
  }

  function isTikTokCdnHost(url) {
    return /tiktokcdn(?:-[a-z0-9-]+)?\.com|tiktokv\.com|tiktokv\.eu|byteoversea\.com|muscdn\.com/i.test(url)
      || /(?:webapp|v\d+).*\.tiktok\.com\/video\//i.test(url);
  }

  function isTikTokMp4Url(url) {
    if (!url || /^blob:|^data:/i.test(url) || /\.m3u8/i.test(url)) return false;
    if (!isTikTokCdnHost(url)) return false;
    if (/\.mp4/i.test(url)) return true;
    if (/\/video\/tos\//i.test(url)) return true;
    if (/tiktok\.com\/video\//i.test(url)) return true;
    if (/\.(json|jpe?g|webp|png|aac|mp3)/i.test(url)) return false;
    return /\/video\//i.test(url);
  }

  function bestTikTokMp4() {
    try {
      const entries = performance
        .getEntriesByType("resource")
        .filter((e) => isTikTokMp4Url(e.name))
        .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0));
      const best = entries.find((e) => (e.transferSize || 0) > 32768) || entries[0];
      return best ? best.name : "";
    } catch (e) {}
    return "";
  }

  function recentMedia(platform) {
    try {
      if (platform === "tiktok") {
        const mp4 = bestTikTokMp4();
        const m3u8 = performance.getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => /\.m3u8/i.test(n) && isTikTokCdnHost(n));
        const out = [];
        if (mp4) out.push(mp4);
        out.push(...m3u8);
        return out;
      }
      if (platform === "twitter") {
        return performance.getEntriesByType("resource").map((e) => e.name)
          .filter((n) => /video\.twimg\.com|pbs\.twimg\.com/i.test(n) && /\.(mp4|m3u8)/i.test(n));
      }
    } catch (e) {}
    return [];
  }

  function isTwitterInitMp4(url) {
    if (!url || !/\.mp4/i.test(url) || !/twimg\.com/i.test(url)) return false;
    if (/\/init[\/.]|init\.mp4/i.test(url)) return true;
    return !/\/vid\//i.test(url);
  }

  function isUsableTwitterMp4(url) {
    return /\.mp4/i.test(url) && /twimg\.com/i.test(url) && !isTwitterInitMp4(url);
  }

  function mediaFromFiber(el, platform) {
    const test = platform === "tiktok"
      ? (u) => /tiktokcdn|tiktokv|byteoversea|muscdn/i.test(u)
      : (u) => /video\.twimg\.com|pbs\.twimg\.com/i.test(u);
    let fiber = getFiber(el);
    let hops = 0;
    while (fiber && hops < 40) {
      const urls = [];
      if (fiber.memoizedProps) urls.push(...collectUrls(fiber.memoizedProps, test));
      if (fiber.memoizedState) urls.push(...collectUrls(fiber.memoizedState, test));
      if (fiber.pendingProps) urls.push(...collectUrls(fiber.pendingProps, test));
      if (urls.length) {
        const m3u8 = uniq(urls.filter((u) => /\.m3u8/i.test(u)));
        const mp4 = uniq(urls.filter((u) => {
          if (platform === "tiktok") return isTikTokMp4Url(u);
          if (platform === "twitter") return /\.mp4/i.test(u) && isUsableTwitterMp4(u);
          return /\.mp4/i.test(u);
        }));
        if (platform === "twitter" && m3u8.length) return { cdnUrl: "", streamUrl: m3u8[m3u8.length - 1] };
        if (platform === "tiktok" && m3u8.length) return { cdnUrl: mp4[0] || "", streamUrl: m3u8[m3u8.length - 1] };
        if (mp4.length) return { cdnUrl: mp4[0], streamUrl: "" };
        if (m3u8.length) return { cdnUrl: "", streamUrl: m3u8[m3u8.length - 1] };
      }
      fiber = fiber.return;
      hops++;
    }
    return { cdnUrl: "", streamUrl: "" };
  }

  function mediaFromElement(el, platform) {
    const out = { cdnUrl: "", streamUrl: "" };
    const src = el.currentSrc || el.src || "";
    if (src && !/^blob:|^data:/i.test(src)) {
      if (/\.mp4/i.test(src)) out.cdnUrl = src;
      else if (/\.m3u8/i.test(src)) out.streamUrl = src;
    }
    el.querySelectorAll?.("source").forEach((s) => {
      const u = s.src || s.getAttribute("src") || "";
      if (!u || /^blob:|^data:/i.test(u)) return;
      if (/\.mp4/i.test(u)) out.cdnUrl = u;
      else if (/\.m3u8/i.test(u)) out.streamUrl = u;
    });

    const fiber = mediaFromFiber(el, platform);
    if (!out.cdnUrl && fiber.cdnUrl) out.cdnUrl = fiber.cdnUrl;
    if (!out.streamUrl && fiber.streamUrl) out.streamUrl = fiber.streamUrl;

    if (isActiveVideo(el)) {
      const recent = recentMedia(platform);
      for (let i = recent.length - 1; i >= 0; i--) {
        const u = recent[i];
        if (/\.m3u8/i.test(u)) out.streamUrl = u;
        if (!out.cdnUrl) {
          if (platform === "tiktok" && isTikTokMp4Url(u)) out.cdnUrl = u;
          else if (platform === "twitter" && /\.mp4/i.test(u) && isUsableTwitterMp4(u)) out.cdnUrl = u;
          else if (platform !== "twitter" && platform !== "tiktok" && /\.mp4/i.test(u)) out.cdnUrl = u;
        }
      }
    }
    return out;
  }

  function findTikTokPageUrl(el) {
    let node = el;
    for (let depth = 0; depth < 20 && node; depth++) {
      const links = node.querySelectorAll
        ? node.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]')
        : [];
      for (const link of links) {
        if (link.href && /\/(video|photo)\/\d+/.test(link.href)) return link.href.split("?")[0];
      }
      const wrapper = node.matches?.('[id^="xgwrapper-"]') ? node : node.querySelector?.('[id^="xgwrapper-"]');
      if (wrapper?.id) {
        const vid = wrapper.id.split("-").pop();
        const scope = wrapper.closest('[data-e2e="feed-item"], [data-e2e="recommend-list-item"]') || wrapper.parentElement;
        const authorLink = scope?.querySelector('a[href*="/@"]');
        const author = authorLink?.pathname?.match(/@([^/]+)/)?.[1]
          || scope?.querySelector('[data-e2e="browse-username"]')?.textContent?.replace(/^@/, "").trim();
        if (vid && author) return `https://www.tiktok.com/@${author}/video/${vid}`;
      }
      node = node.parentElement;
    }
    return "";
  }

  function findTwitterPageUrl(el) {
    let node = el;
    for (let depth = 0; depth < 20 && node; depth++) {
      const root = node.matches?.('[data-testid="tweet"], article') ? node : node.querySelector?.('[data-testid="tweet"], article');
      const scope = root || node;
      const timeLink = scope.querySelector?.("time")?.closest("a[href*='/status/']");
      if (timeLink?.href && /\/status\/\d+/.test(timeLink.href)) return timeLink.href.split("?")[0];
      for (const link of scope.querySelectorAll?.('a[href*="/status/"]') || []) {
        if (link.href && /\/status\/\d+/.test(link.href)) return link.href.split("?")[0];
      }
      node = node.parentElement;
    }
    return "";
  }

  function resolveForElement(el, platform) {
    const result = { pageUrl: "", cdnUrl: "", streamUrl: "", type: "video", error: "" };
    if (!el || !el.isConnected) {
      result.error = "element-gone";
      return result;
    }

    const media = mediaFromElement(el, platform);
    result.cdnUrl = media.cdnUrl;
    result.streamUrl = media.streamUrl;

    if (platform === "tiktok") result.pageUrl = findTikTokPageUrl(el);
    else if (platform === "twitter") result.pageUrl = findTwitterPageUrl(el);

    if (!result.cdnUrl && !result.streamUrl && !result.pageUrl) {
      result.error = "no-url";
    }
    return result;
  }

  function handleExtract() {
    const relay = document.getElementById(RELAY_ID);
    if (!relay) return;
    const reqId = relay.getAttribute("data-req-id");
    const targetId = relay.getAttribute("data-target-id");
    const platform = relay.getAttribute("data-platform") || "";
    if (!reqId) return;

    const result = { pageUrl: "", cdnUrl: "", streamUrl: "", type: "video", error: "" };
    try {
      const el = document.querySelector(`[data-downpour-social-id="${targetId}"]`);
      if (!el) result.error = "element-gone";
      else Object.assign(result, resolveForElement(el, platform));
    } catch (e) {
      result.error = "exception:" + (e && e.message ? e.message : "unknown");
    }

    relay.setAttribute("data-page-url", result.pageUrl);
    relay.setAttribute("data-cdn-url", result.cdnUrl);
    relay.setAttribute("data-stream-url", result.streamUrl);
    relay.setAttribute("data-type", result.type);
    relay.setAttribute("data-error", result.error);
    relay.setAttribute("data-res-id", reqId);
    relay.dispatchEvent(new Event("downpour-social:result"));
  }

  function ensureRelay() {
    let relay = document.getElementById(RELAY_ID);
    if (!relay) {
      relay = document.createElement("div");
      relay.id = RELAY_ID;
      relay.style.display = "none";
      (document.documentElement || document.body).appendChild(relay);
    }
    relay.addEventListener("downpour-social:extract", handleExtract);
    return relay;
  }

  ensureRelay();
})();