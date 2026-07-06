// Page-context TikTok video URL capture via API responses + React fiber.
(function () {
  "use strict";
  if (window.__downpourTtInjected) return;
  window.__downpourTtInjected = true;

  const RELAY_ID = "downpour-tt-relay";
  const cache = { byId: {} };
  const activeCdnByVideoId = {};
  const feedBatch = { ids: [], ts: 0 };

  function getFiber(el) {
    for (const key in el) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
        return el[key];
      }
    }
    return null;
  }

  function collectStrings(root, test, budget) {
    const out = [];
    const seen = new WeakSet();
    const stack = [[root, 0]];
    let left = budget || 14000;
    while (stack.length && left-- > 0) {
      const top = stack.pop();
      const v = top[0];
      const d = top[1];
      if (!v || typeof v !== "object" || d > 12) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      for (const key in v) {
        if (typeof key === "string" && key.startsWith("__")) continue;
        let val;
        try { val = v[key]; } catch (e) { continue; }
        if (typeof val === "string" && val.length > 30 && /^https?:\/\//.test(val) && test(val)) {
          out.push(val);
        } else if (val && typeof val === "object") {
          if (val instanceof Node || val === window) continue;
          stack.push([val, d + 1]);
        }
      }
    }
    return out;
  }

  function normalizeUrl(url) {
    if (!url || typeof url !== "string") return "";
    return url
      .replace(/\\u0026/gi, "&")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .trim();
  }

  function isCdnUrl(url) {
    url = normalizeUrl(url);
    return /tiktokcdn|tiktokv|byteoversea|muscdn|tiktok\.com\/video/i.test(url);
  }

  function isAudioUrl(url) {
    url = normalizeUrl(url);
    return /mime_type=audio|mime-type=audio|audio_mp4/i.test(url)
      || /\/music\//i.test(url);
  }

  function videoUrlScore(url) {
    if (typeof DownpourPlatforms !== "undefined" && DownpourPlatforms.tikTokVideoUrlScore) {
      return DownpourPlatforms.tikTokVideoUrlScore(url);
    }
    if (isAudioUrl(url)) return -1;
    let score = 0;
    if (/mime_type=video|video_mp4/i.test(url)) score += 3000;
    if (/\/video\/tos\//i.test(url)) score += 800;
    const br = (url.match(/[?&]br=(\d+)/i) || [])[1];
    if (br) score += parseInt(br, 10) * 2;
    if (/download/i.test(url)) score -= 250;
    if (/playwm|watermark/i.test(url)) score -= 300;
    return score + Math.min(url.length, 400);
  }

  function pickBestUrl(urls) {
    const list = Array.from(new Set(urls.map(normalizeUrl).filter((u) => u && isCdnUrl(u))));
    if (!list.length) return "";
    const m3u8 = list.filter((u) => /\.m3u8/i.test(u) && !isAudioUrl(u));
    if (m3u8.length) return m3u8[m3u8.length - 1];
    const mp4 = list.filter((u) => !/\.m3u8/i.test(u) && !isAudioUrl(u));
    mp4.sort((a, b) => videoUrlScore(b) - videoUrlScore(a));
    return mp4[0] || "";
  }

  function pickAltVideoUrls(urls, best) {
    const list = Array.from(new Set(urls.map(normalizeUrl).filter((u) => u && isCdnUrl(u) && !/\.m3u8/i.test(u) && !isAudioUrl(u))));
    list.sort((a, b) => videoUrlScore(b) - videoUrlScore(a));
    return list.filter((u) => u !== best);
  }

  function urlsFromAddr(addr) {
    if (!addr) return [];
    if (typeof addr === "string") return [normalizeUrl(addr)];
    const list = addr.url_list || addr.UrlList || addr.urlList || [];
    return Array.isArray(list) ? list.map(normalizeUrl).filter(Boolean) : [];
  }

  function urlsFromVideo(video) {
    if (!video || typeof video !== "object") return [];
    const out = [];
    const rates = video.bitrateInfo || video.bit_rate || video.BitrateInfo || [];
    if (Array.isArray(rates) && rates.length) {
      const sorted = [...rates].sort((a, b) => {
        const ba = Number(a.Bitrate || a.bitrate || 0);
        const bb = Number(b.Bitrate || b.bitrate || 0);
        return bb - ba;
      });
      for (const br of sorted) {
        out.push(...urlsFromAddr(br.play_addr || br.PlayAddr));
      }
    }
    for (const key of ["playAddr", "play_addr"]) {
      out.push(...urlsFromAddr(video[key]));
    }
    for (const key of ["downloadAddr", "download_addr"]) {
      out.push(...urlsFromAddr(video[key]));
    }
    if (video.playApi) out.push(normalizeUrl(video.playApi));
    return out;
  }

  function urlsFromItem(item) {
    if (!item || typeof item !== "object") return [];
    const out = urlsFromVideo(item.video || item.aweme?.video);
    if (item.video) out.push(...urlsFromVideo(item.video));
    return out;
  }

  function rememberItem(item) {
    if (!item || typeof item !== "object") return;
    const id = String(item.id || item.aweme_id || item.awemeId || item.video?.id || "");
    const urls = urlsFromItem(item);
    const cdnUrl = pickBestUrl(urls);
    if (!cdnUrl && !id) return;
    const entry = { id, cdnUrl, urls, ts: Date.now() };
    if (id) cache.byId[id] = entry;
  }

  function inspectPayload(data) {
    if (!data || typeof data !== "object") return;
    const items = [];
    const push = (it) => { if (it) items.push(it); };

    push(data.itemInfo?.itemStruct);
    push(data.itemStruct);
    push(data.aweme_detail);
    push(data.aweme_detail?.aweme);
    if (Array.isArray(data.item_list)) data.item_list.forEach(push);
    if (Array.isArray(data.items)) data.items.forEach(push);
    if (data.ItemModule) Object.values(data.ItemModule).forEach(push);
    if (data.itemList) Object.values(data.itemList).forEach(push);

    const scope = data.__DEFAULT_SCOPE__;
    if (scope && typeof scope === "object") {
      for (const key of Object.keys(scope)) {
        push(scope[key]?.itemInfo?.itemStruct);
        push(scope[key]?.itemStruct);
      }
    }

    for (const it of items) rememberItem(it);

    const batch = [];
    if (Array.isArray(data.item_list)) batch.push(...data.item_list);
    if (Array.isArray(data.items)) batch.push(...data.items);
    if (batch.length) rememberFeedBatch(batch);
  }

  function rememberFeedBatch(items) {
    const ids = items
      .map((it) => String(it?.id || it?.aweme_id || it?.awemeId || ""))
      .filter(isValidVideoId);
    if (ids.length) {
      feedBatch.ids = ids;
      feedBatch.ts = Date.now();
    }
  }

  function feedItemSelector() {
    return [
      '[data-e2e="feed-item"]',
      '[data-e2e="recommend-list-item"]',
      '[data-e2e="recommend-list-item-container"]',
      '[data-e2e="browse-video"]'
    ].join(", ");
  }

  function allFeedItems() {
    const seen = new Set();
    const out = [];
    for (const el of document.querySelectorAll(feedItemSelector())) {
      if (!seen.has(el)) {
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  function findCardRoot(fromEl) {
    const wrapper = fromEl?.closest?.('[id^="xgwrapper-"]')
      || (fromEl?.id?.startsWith?.("xgwrapper") ? fromEl : null);
    if (!wrapper) return null;
    let node = wrapper;
    const minH = Math.max(320, window.innerHeight * 0.45);
    for (let depth = 0; depth < 28 && node; depth++) {
      const r = node.getBoundingClientRect();
      if (r.height >= minH && r.width >= 200) return node;
      node = node.parentElement;
    }
    return wrapper.parentElement || wrapper;
  }

  function getViewportWrapper() {
    const wrappers = Array.from(document.querySelectorAll('[id^="xgwrapper-"]'));
    if (!wrappers.length) return null;
    const cy = window.innerHeight / 2;
    let best = null;
    let bestScore = Infinity;
    for (const w of wrappers) {
      const r = w.getBoundingClientRect();
      if (r.height < 80) continue;
      const center = (r.top + r.bottom) / 2;
      const dist = Math.abs(center - cy);
      const covers = r.top <= cy && r.bottom >= cy;
      const score = dist - (covers ? 1e6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = w;
      }
    }
    return best;
  }

  function getViewportVideoCard() {
    const w = getViewportWrapper();
    return w ? findCardRoot(w) : null;
  }

  function getViewportFeedItem() {
    const items = allFeedItems();
    if (items.length) {
      const cy = window.innerHeight / 2;
      let best = null;
      let bestScore = Infinity;
      for (const item of items) {
        const r = item.getBoundingClientRect();
        if (r.height < 100) continue;
        const center = (r.top + r.bottom) / 2;
        const dist = Math.abs(center - cy);
        const covers = r.top <= cy && r.bottom >= cy;
        const score = dist - (covers ? 1e6 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = item;
        }
      }
      if (best) return best;
    }
    return getViewportVideoCard();
  }

  function readAuthorFromNode(node) {
    if (!node) return "";
    const href = node.href || node.getAttribute("href") || "";
    const fromHref = href.match(/\/@([^/?#]+)/);
    if (fromHref && fromHref[1]) return fromHref[1];
    const text = (node.textContent || "").trim().replace(/^@/, "");
    if (text && /^[A-Za-z0-9._]+$/.test(text) && text.length < 40) return text;
    return "";
  }

  function authorFromCard(root) {
    if (!root) return "";
    const authorSelectors = [
      '[data-e2e="browse-username"]',
      '[data-e2e="video-author-avatar"]',
      '[data-e2e="search-user-unique-id"]',
      '[data-e2e="user-link"]',
      'a[href^="/@"]',
      'a[href*="/@"]'
    ];
    for (const sel of authorSelectors) {
      for (const node of root.querySelectorAll(sel)) {
        const author = readAuthorFromNode(node);
        if (author) return author;
      }
    }
    let node = root;
    for (let i = 0; i < 8 && node?.parentElement; i++) {
      node = node.parentElement;
      for (const sel of authorSelectors) {
        const hit = node.querySelector(sel);
        if (!hit) continue;
        const author = readAuthorFromNode(hit);
        if (author) return author;
      }
    }
    return "";
  }

  function authorNearWrapper(wrapper) {
    if (!wrapper) return "";
    let node = wrapper;
    for (let i = 0; i < 12; i++) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const child of parent.children) {
        if (child === node || child.contains(wrapper)) continue;
        const author = authorFromCard(child);
        if (author) return author;
      }
      node = parent;
    }
    return "";
  }

  function pageUrlFromCard(card, videoId) {
    if (!card || !isValidVideoId(videoId)) return "";
    for (const href of linksFromRoot(card)) {
      if (videoIdFromHref(href) === String(videoId)) {
        return "https://www.tiktok.com" + new URL(href, location.origin).pathname;
      }
    }
    let author = authorFromCard(card);
    if (!author) {
      const wrapper = card.querySelector?.('[id^="xgwrapper-"]') || getViewportWrapper();
      author = authorNearWrapper(wrapper);
    }
    if (author) return `https://www.tiktok.com/@${author}/video/${videoId}`;
    return "";
  }

  function cdnUrlsFromPerformance(videoId) {
    const out = [];
    try {
      for (const e of performance.getEntriesByType("resource")) {
        const n = normalizeUrl(e.name);
        if (!isCdnUrl(n) || isAudioUrl(n)) continue;
        if (!/\/video\/tos\//i.test(n) && !/\.mp4/i.test(n) && !/\.m3u8/i.test(n)) continue;
        if (videoId && n.includes(String(videoId))) out.unshift(n);
        else out.push(n);
      }
    } catch (e) {}
    return out;
  }

  function feedIndexOf(feedItem) {
    if (!feedItem) return -1;
    return allFeedItems().indexOf(feedItem);
  }

  function linksFromRoot(root) {
    if (!root) return [];
    const out = [];
    const seen = new Set();
    root.querySelectorAll?.('a[href*="/video/"], a[href*="/photo/"], [href*="/video/"], [href*="/photo/"]')
      .forEach((node) => {
        const href = node.href || node.getAttribute("href") || "";
        if (href && !seen.has(href)) {
          seen.add(href);
          out.push(href);
        }
      });
    return out;
  }

  function videoIdFromHref(href) {
    const m = (href || "").match(/\/(video|photo)\/(\d{15,})/);
    return m ? m[2] : "";
  }

  function resolveVideoId(videoId) {
    if (isValidVideoId(videoId)) return String(videoId);
    const m = location.pathname.match(/\/(video|photo)\/(\d{15,})/);
    return m ? m[2] : "";
  }

  function readPageDataItem(videoId) {
    videoId = resolveVideoId(videoId);
    if (!videoId) return null;
    for (const id of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"]) {
      const el = document.getElementById(id);
      if (!el?.textContent) continue;
      try {
        const data = JSON.parse(el.textContent);
        if (data.ItemModule?.[videoId]) return data.ItemModule[videoId];
        const scope = data.__DEFAULT_SCOPE__ || {};
        for (const key of Object.keys(scope)) {
          const item = scope[key]?.itemInfo?.itemStruct;
          if (item && String(item.id) === String(videoId)) return item;
        }
        if (data.ItemModule) {
          for (const it of Object.values(data.ItemModule)) {
            if (String(it?.id) === String(videoId)) return it;
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function isValidVideoId(id) {
    return !!id && /^\d{15,}$/.test(String(id));
  }

  function videoIdFromWrapper(wrapper) {
    if (!wrapper?.id?.startsWith("xgwrapper")) return "";
    const parts = wrapper.id.split("-").slice(1);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (isValidVideoId(parts[i])) return parts[i];
    }
    return "";
  }

  function stampFeedItemVideoId(feedItem, videoEl) {
    if (!feedItem) return "";
    const stamped = feedItem.dataset.downpourTtActiveId || "";
    const wrapper = videoEl?.closest?.('[id^="xgwrapper-"]')
      || feedItem.querySelector('[id^="xgwrapper-"]');
    let id = videoIdFromWrapper(wrapper);
    if (!isValidVideoId(id)) {
      for (const href of linksFromRoot(feedItem)) {
        id = videoIdFromHref(href);
        if (isValidVideoId(id)) break;
      }
    }
    if (!isValidVideoId(id) && videoEl) {
      const fiberItem = itemFromElementFiber(videoEl, "");
      id = String(fiberItem?.id || fiberItem?.aweme_id || fiberItem?.awemeId || "");
    }
    if (isValidVideoId(id)) {
      feedItem.dataset.downpourTtActiveId = id;
      return id;
    }
    return isValidVideoId(stamped) ? stamped : "";
  }

  function videoIdFromFeedItemElement(feedItem) {
    if (!feedItem) return "";
    const stamped = feedItem.dataset.downpourTtActiveId || "";
    if (isValidVideoId(stamped)) return stamped;

    const videos = feedItem.querySelectorAll("video");
    for (const video of videos) {
      const wrapper = video.closest('[id^="xgwrapper-"]');
      const fromWrapper = videoIdFromWrapper(wrapper);
      if (isValidVideoId(fromWrapper)) return fromWrapper;
      if (!video.paused && !video.ended) {
        const fiberItem = itemFromElementFiber(video, "");
        const fromFiber = String(fiberItem?.id || fiberItem?.aweme_id || fiberItem?.awemeId || "");
        if (isValidVideoId(fromFiber)) return fromFiber;
      }
    }

    const wrapper = feedItem.querySelector('[id^="xgwrapper-"]');
    const fromWrapper = videoIdFromWrapper(wrapper);
    if (isValidVideoId(fromWrapper)) return fromWrapper;

    for (const href of linksFromRoot(feedItem)) {
      const id = videoIdFromHref(href);
      if (isValidVideoId(id)) return id;
    }

    const fiberItem = itemFromElementFiber(feedItem, "");
    const fromFiber = String(fiberItem?.id || fiberItem?.aweme_id || fiberItem?.awemeId || "");
    if (isValidVideoId(fromFiber)) return fromFiber;

    const html = feedItem.innerHTML || "";
    const m = html.match(/\/(?:video|photo)\/(\d{15,})/);
    if (m) return m[1];

    const idx = feedIndexOf(feedItem);
    if (idx >= 0 && isValidVideoId(feedBatch.ids[idx])) return feedBatch.ids[idx];
    return "";
  }

  function resolveActiveContext(el) {
    const viewportItem = getViewportFeedItem();
    if (viewportItem) {
      return { anchor: viewportItem, feedItem: viewportItem };
    }
    const localFeed = el?.closest?.(feedItemSelector()) || findCardRoot(el);
    return { anchor: localFeed || el, feedItem: localFeed };
  }

  function videoIdFromElement(el) {
    const { anchor, feedItem } = resolveActiveContext(el);

    const fromViewport = videoIdFromFeedItemElement(feedItem);
    if (isValidVideoId(fromViewport)) return fromViewport;

    const fromWrapper = videoIdFromWrapper(el?.closest?.('[id^="xgwrapper-"]'));
    if (isValidVideoId(fromWrapper)) return fromWrapper;

    const fiberItem = itemFromElementFiber(anchor, "");
    const fromFiber = fiberItem && String(fiberItem.id || fiberItem.aweme_id || fiberItem.awemeId || "");
    if (isValidVideoId(fromFiber)) return fromFiber;

    let fiber = getFiber(anchor);
    let hops = 0;
    while (fiber && hops < 30) {
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      const id = props.itemStruct?.id || props.item?.id || props.id || props.videoId || props.itemId;
      if (isValidVideoId(id)) return String(id);
      fiber = fiber.return;
      hops++;
    }
    return "";
  }

  function findItemInProps(obj, videoId, budget) {
    const queue = [obj];
    const seen = new WeakSet();
    let steps = 0;
    const limit = budget || 220;
    while (queue.length && steps++ < limit) {
      const cur = queue.shift();
      if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
      seen.add(cur);
      if (cur.video && (cur.id || cur.aweme_id || cur.awemeId)) {
        const id = String(cur.id || cur.aweme_id || cur.awemeId || "");
        if (!videoId || id === String(videoId)) return cur;
      }
      if (cur.itemStruct?.video) {
        const item = cur.itemStruct;
        if (!videoId || String(item.id) === String(videoId)) return item;
      }
      if (cur.itemInfo?.itemStruct?.video) {
        const item = cur.itemInfo.itemStruct;
        if (!videoId || String(item.id) === String(videoId)) return item;
      }
      for (const key in cur) {
        if (typeof key === "string" && key.startsWith("__")) continue;
        let val;
        try { val = cur[key]; } catch (e) { continue; }
        if (val && typeof val === "object") {
          if (val instanceof Node || val === window) continue;
          queue.push(val);
        }
      }
    }
    return null;
  }

  function itemFromElementFiber(el, videoId) {
    let fiber = getFiber(el);
    let hops = 0;
    while (fiber && hops < 60) {
      const buckets = [
        fiber.memoizedProps,
        fiber.pendingProps,
        fiber.memoizedState,
        fiber.memoizedState?.memoizedState
      ];
      for (const bucket of buckets) {
        const found = bucket && findItemInProps(bucket, videoId, 120);
        if (found) return found;
      }
      fiber = fiber.return;
      hops++;
    }
    return null;
  }

  function noteActiveVideoLoad(videoEl, startedAt) {
    const feedItem = videoEl?.closest?.(feedItemSelector()) || getViewportFeedItem();
    const id = stampFeedItemVideoId(feedItem, videoEl)
      || videoIdFromWrapper(videoEl?.closest?.('[id^="xgwrapper-"]'))
      || videoIdFromFeedItemElement(feedItem);
    if (!isValidVideoId(id)) return;
    const t0 = startedAt || performance.now();
    window.setTimeout(() => {
      try {
        const entries = performance.getEntriesByType("resource")
          .filter((e) => e.responseEnd >= t0 - 100 && e.responseEnd <= t0 + 4000)
          .map((e) => normalizeUrl(e.name))
          .filter((n) => isCdnUrl(n) && !isAudioUrl(n) && (/\/video\/tos\//i.test(n) || /\.mp4/i.test(n)));
        if (!entries.length) return;
        const best = pickBestUrl(entries);
        if (best) activeCdnByVideoId[id] = { url: best, ts: Date.now() };
      } catch (e) {}
    }, 200);
  }

  function bindVideoElement(video) {
    if (!video || video.dataset.downpourTtBound) return;
    video.dataset.downpourTtBound = "1";
    ["playing", "loadeddata", "loadstart"].forEach((evt) => {
      video.addEventListener(evt, () => noteActiveVideoLoad(video, performance.now()), { passive: true });
    });
  }

  function bindAllVideos() {
    document.querySelectorAll("video").forEach(bindVideoElement);
  }

  function pageUrlFromFeedItem(feedItem, videoId) {
    return pageUrlFromCard(feedItem, videoId);
  }

  function findPageUrl(el, videoId) {
    const card = findCardRoot(el) || getViewportVideoCard();
    const fromCard = pageUrlFromCard(card, videoId);
    if (fromCard) return fromCard;

    const { feedItem } = resolveActiveContext(el);
    const fromFeed = pageUrlFromCard(feedItem, videoId);
    if (fromFeed) return fromFeed;

    if (isValidVideoId(videoId) && /\/video\/\d{15,}/.test(location.pathname)) {
      return location.origin + location.pathname.split("?")[0];
    }
    return "";
  }

  function shortUrl(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      const tail = u.pathname.split("/").filter(Boolean).slice(-2).join("/");
      return `${u.hostname}/${tail}`;
    } catch (e) {
      return String(url).slice(0, 80);
    }
  }

  function buildDebug(ctx) {
    return {
      videoId: ctx.videoId || "",
      author: ctx.author || "",
      cardFound: !!ctx.cardFound,
      feedActiveId: ctx.feedActiveId || "",
      wrapperId: ctx.wrapperId || "",
      feedIdx: ctx.feedIdx,
      feedCount: ctx.feedCount,
      feedBatchHead: (ctx.feedBatchHead || []).join(","),
      feedBatchAgeMs: ctx.feedBatchAgeMs,
      urlCount: ctx.urlCount || 0,
      hadFiber: !!ctx.hadFiber,
      hadCache: !!ctx.hadCache,
      hadActiveCdn: !!ctx.hadActiveCdn,
      cdn: shortUrl(ctx.cdnUrl),
      page: ctx.pageUrl || "",
      error: ctx.error || ""
    };
  }

  function resolveForElement(el) {
    const result = { pageUrl: "", cdnUrl: "", streamUrl: "", altUrls: [], videoId: "", type: "video", error: "", debug: {} };
    if (!el || !el.isConnected) {
      result.error = "element-gone";
      result.debug = buildDebug({ error: "element-gone" });
      return result;
    }

    const videoEl = el.tagName === "VIDEO" ? el : el.querySelector?.("video");
    bindVideoElement(videoEl);

    const { anchor, feedItem } = resolveActiveContext(el);
    if (feedItem && videoEl) stampFeedItemVideoId(feedItem, videoEl);
    let videoId = videoIdFromElement(el);
    let urls = [];
    const playingSrc = normalizeUrl(videoEl?.currentSrc || videoEl?.src || "");
    if (playingSrc && isCdnUrl(playingSrc) && !isAudioUrl(playingSrc)) {
      urls.push(playingSrc);
    }
    const wrapper = (videoEl || el)?.closest?.('[id^="xgwrapper-"]')
      || feedItem?.querySelector?.('[id^="xgwrapper-"]');

    let fiberItem = isValidVideoId(videoId)
      ? itemFromElementFiber(anchor, videoId)
      : itemFromElementFiber(anchor, "");
    if (fiberItem) {
      const fiberId = String(fiberItem.id || fiberItem.aweme_id || fiberItem.awemeId || "");
      if (isValidVideoId(fiberId)) videoId = fiberId;
      rememberItem(fiberItem);
      urls.push(...urlsFromItem(fiberItem));
    }

    result.videoId = videoId;
    if (isValidVideoId(videoId)) {
      const pageItem = readPageDataItem(videoId);
      if (pageItem) {
        rememberItem(pageItem);
        urls.push(...urlsFromItem(pageItem));
      }
      if (cache.byId[videoId]) {
        urls.push(...(cache.byId[videoId].urls || []), cache.byId[videoId].cdnUrl);
      }
      if (activeCdnByVideoId[videoId]?.url) {
        urls.push(activeCdnByVideoId[videoId].url);
      }
      urls.push(...cdnUrlsFromPerformance(videoId));
    }

    const scoped = Array.from(new Set(urls.map(normalizeUrl).filter(Boolean)));
    let best = "";
    if (playingSrc && scoped.includes(playingSrc) && !/\.m3u8/i.test(playingSrc)) {
      best = playingSrc;
    } else {
      best = pickBestUrl(scoped);
    }
    if (/\.m3u8/i.test(best)) result.streamUrl = best;
    else if (best) {
      result.cdnUrl = best;
      result.altUrls = pickAltVideoUrls(scoped, best);
    }

    const card = feedItem || findCardRoot(el) || getViewportVideoCard();
    result.pageUrl = pageUrlFromCard(card, videoId) || findPageUrl(el, videoId);
    if (!result.pageUrl && isValidVideoId(videoId)) {
      const m = location.pathname.match(/\/@([^/]+)/);
      if (m) result.pageUrl = `https://www.tiktok.com/@${m[1]}/video/${videoId}`;
    }

    if (!result.cdnUrl && !result.streamUrl && !result.pageUrl) {
      result.error = videoId ? "no-url" : "no-video-id";
    } else if (!result.cdnUrl && !result.streamUrl && result.pageUrl) {
      result.error = "";
    }

    result.debug = buildDebug({
      videoId,
      author: authorFromCard(card),
      feedActiveId: feedItem?.dataset?.downpourTtActiveId || "",
      wrapperId: wrapper?.id || "",
      feedIdx: feedIndexOf(feedItem),
      feedCount: allFeedItems().length,
      cardFound: !!card,
      feedBatchHead: feedBatch.ids.slice(0, 6),
      feedBatchAgeMs: feedBatch.ts ? Date.now() - feedBatch.ts : -1,
      urlCount: scoped.length,
      hadFiber: !!fiberItem,
      hadCache: !!(videoId && cache.byId[videoId]),
      hadActiveCdn: !!(videoId && activeCdnByVideoId[videoId]),
      playingSrc: shortUrl(playingSrc),
      cdnUrl: result.cdnUrl || result.streamUrl,
      pageUrl: result.pageUrl,
      error: result.error
    });
    return result;
  }

  function handleExtract() {
    const relay = document.getElementById(RELAY_ID);
    if (!relay) return;
    const reqId = relay.getAttribute("data-req-id");
    const targetId = relay.getAttribute("data-target-id");
    if (!reqId) return;

    const result = { pageUrl: "", cdnUrl: "", streamUrl: "", altUrls: [], videoId: "", type: "video", error: "", debug: {} };
    try {
      const el = document.querySelector(`[data-downpour-tt-id="${targetId}"]`);
      if (!el) {
        result.error = "element-gone";
        result.debug = buildDebug({ error: "element-gone" });
      } else {
        Object.assign(result, resolveForElement(el));
      }
    } catch (e) {
      result.error = "exception:" + (e && e.message ? e.message : "unknown");
      result.debug = buildDebug({ error: result.error });
    }

    relay.setAttribute("data-page-url", result.pageUrl);
    relay.setAttribute("data-cdn-url", result.cdnUrl);
    relay.setAttribute("data-stream-url", result.streamUrl);
    relay.setAttribute("data-video-id", result.videoId || "");
    relay.setAttribute("data-alt-urls", JSON.stringify(result.altUrls || []));
    relay.setAttribute("data-type", result.type);
    relay.setAttribute("data-error", result.error);
    relay.setAttribute("data-debug", JSON.stringify(result.debug || {}));
    relay.setAttribute("data-res-id", reqId);
    relay.dispatchEvent(new Event("downpour-tt:result"));
  }

  function ensureRelay() {
    let relay = document.getElementById(RELAY_ID);
    if (!relay) {
      relay = document.createElement("div");
      relay.id = RELAY_ID;
      relay.style.display = "none";
      (document.documentElement || document.body).appendChild(relay);
    }
    relay.addEventListener("downpour-tt:extract", handleExtract);
    return relay;
  }

  function shouldInspectApi(url) {
    return /tiktok\.com/i.test(url)
      && (/\/api\//i.test(url) || /\/aweme\//i.test(url) || /item_list|item_detail|recommend/i.test(url));
  }

  function hookNetwork() {
    const _fetch = window.fetch;
    window.fetch = function (input, init) {
      const req = typeof input === "string" ? input : input && input.url || "";
      return _fetch.apply(this, arguments).then((resp) => {
        try {
          if (shouldInspectApi(req)) {
            resp.clone().json().then(inspectPayload).catch(() => {});
          }
        } catch (e) {}
        return resp;
      });
    };

    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (typeof url === "string" && shouldInspectApi(url)) {
          this.addEventListener("load", function () {
            try { inspectPayload(JSON.parse(this.responseText)); } catch (e) {}
          });
        }
      } catch (e) {}
      return _open.apply(this, arguments);
    };
  }

  function readEmbeddedPageData() {
    for (const id of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"]) {
      try {
        const el = document.getElementById(id);
        if (el?.textContent) inspectPayload(JSON.parse(el.textContent));
      } catch (e) {}
    }
  }

  function bootstrap() {
    ensureRelay();
    hookNetwork();
    readEmbeddedPageData();
    bindAllVideos();
    const mo = new MutationObserver(() => bindAllVideos());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => {
      readEmbeddedPageData();
      bindAllVideos();
    }, { once: true });
  }

  bootstrap();
})();