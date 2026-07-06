// Page-context TikTok watch-page URL discovery for social reporting.
(function () {
  "use strict";
  if (window.__vsdTikTokCapture) return;
  window.__vsdTikTokCapture = true;

  function norm(u) {
    try {
      const x = new URL(u);
      if (x.hostname === "vm.tiktok.com" || x.hostname === "vt.tiktok.com") return x.origin + x.pathname;
      return "https://www.tiktok.com" + x.pathname;
    } catch (e) {
      return u;
    }
  }

  function watchPath(p) {
    return /\/video\/\d+/.test(p) || /\/photo\/\d+/.test(p) || /^\/t\/[A-Za-z0-9]+/.test(p) || /^\/v\/\d+/.test(p);
  }

  function post(url) {
    if (url) window.postMessage({ type: "VSD_TT_VIDEO", url: norm(url.split("?")[0]) }, "*");
  }

  function fromItem(item) {
    if (!item || !item.id) return null;
    const uid = (item.author && item.author.uniqueId)
      || (item.authorMeta && item.authorMeta.uniqueId)
      || (typeof item.author === "string" && item.author);
    if (!uid) return null;
    const kind = item.imagePost ? "photo" : "video";
    return `https://www.tiktok.com/@${uid}/${kind}/${item.id}`;
  }

  function extractUrl() {
    try {
      if (watchPath(location.pathname)) return norm(location.href);
    } catch (e) {}
    const og = document.querySelector('meta[property="og:url"]');
    if (og && og.content && og.content.indexOf("tiktok.com") !== -1) return norm(og.content);
    const ids = ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"];
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i]);
      if (!el || !el.textContent) continue;
      try {
        const data = JSON.parse(el.textContent);
        const scope = data.__DEFAULT_SCOPE__ || {};
        const keys = ["webapp.video-detail", "webapp.reflow.video.detail"];
        for (let j = 0; j < keys.length; j++) {
          const item = scope[keys[j]] && scope[keys[j]].itemInfo && scope[keys[j]].itemInfo.itemStruct;
          const built = fromItem(item);
          if (built) return built;
        }
        if (data.ItemModule) {
          for (const k in data.ItemModule) {
            const built2 = fromItem(data.ItemModule[k]);
            if (built2) return built2;
          }
        }
      } catch (e) {}
    }
    const scripts = document.querySelectorAll("script");
    for (let s = 0; s < scripts.length; s++) {
      const t = scripts[s].textContent || "";
      if (t.indexOf("tiktok.com") === -1) continue;
      const m = t.match(/https:\/\/www\.tiktok\.com\/@[^"'\s]+?\/(?:video|photo)\/\d+/);
      if (m) return norm(m[0]);
    }
    const wrapper = document.querySelector('[id^="xgwrapper-"]');
    if (wrapper && wrapper.id) {
      const vid = wrapper.id.split("-").pop();
      const author = document.querySelector('[data-e2e="browse-username"], [data-e2e="video-author-avatar"]');
      const handle = author && (author.getAttribute("href") || author.textContent || "").match(/@([^/?#\s]+)/);
      if (vid && handle) return `https://www.tiktok.com/@${handle[1]}/video/${vid}`;
    }
    return null;
  }

  function report() {
    post(extractUrl());
  }

  function inspectPayload(data) {
    if (!data || typeof data !== "object") return;
    const item = (data.itemInfo && data.itemInfo.itemStruct)
      || data.itemStruct
      || data.aweme_detail
      || (data.item_list && data.item_list[0])
      || (data.items && data.items[0]);
    const built = fromItem(item);
    if (built) post(built);
  }

  report();
  setInterval(report, 1200);
  new MutationObserver(report).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", report);

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const req = typeof input === "string" ? input : (input && input.url) || "";
    return nativeFetch.apply(this, arguments).then((resp) => {
      try {
        if (req.indexOf("tiktok.com") !== -1 && (req.indexOf("/api/") !== -1 || req.indexOf("/aweme/") !== -1)) {
          resp.clone().json().then(inspectPayload).catch(() => {});
        }
      } catch (e) {}
      return resp;
    });
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (typeof url === "string" && url.indexOf("tiktok.com") !== -1) {
        this.addEventListener("load", function () {
          try { inspectPayload(JSON.parse(this.responseText)); } catch (e) {}
        });
      }
    } catch (e) {}
    return nativeOpen.apply(this, arguments);
  };
})();