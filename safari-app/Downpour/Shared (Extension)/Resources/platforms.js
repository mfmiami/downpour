// Shared social-platform helpers for Downpour overlay + background jobs.
const DownpourPlatforms = (function () {
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    } catch (e) {
      return "";
    }
  }

  function shadowRootOf(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.shadowRoot) return el.shadowRoot;
    try {
      const dom = (typeof chrome !== "undefined" && chrome.dom)
        || (typeof browser !== "undefined" && browser.dom);
      if (dom && typeof dom.openOrClosedShadowRoot === "function") {
        return dom.openOrClosedShadowRoot(el) || null;
      }
    } catch (e) {}
    return null;
  }

  function forEachDeep(root, selector, fn) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(selector).forEach(fn);
    root.querySelectorAll("*").forEach((el) => {
      const shadow = shadowRootOf(el);
      if (shadow) forEachDeep(shadow, selector, fn);
    });
  }

  function isTikTokHost(url) {
    const host = hostOf(url);
    return host === "tiktok.com" || host.endsWith(".tiktok.com")
      || host === "vm.tiktok.com" || host === "vt.tiktok.com";
  }

  function isTwitterHost(url) {
    const host = hostOf(url);
    return host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com");
  }

  function isInstagramHost(url) {
    const host = hostOf(url);
    return host === "instagram.com" || host.endsWith(".instagram.com");
  }

  function getSocialPlatform(url) {
    if (isTikTokHost(url)) return "tiktok";
    if (isTwitterHost(url)) return "twitter";
    if (isInstagramHost(url)) return "instagram";
    return null;
  }

  function isSocialOverlayHost(url) {
    return getSocialPlatform(url) != null;
  }

  function isYoutubeHost(url) {
    const host = hostOf(url);
    return host === "youtube.com" || host.endsWith(".youtube.com")
      || host === "youtu.be" || host.endsWith(".youtube-nocookie.com");
  }

  function isEromeHost(url) {
    const host = hostOf(url);
    return host === "erome.com" || host.endsWith(".erome.com");
  }

  function isEromeCdn(url) {
    return !!url && /\/\/v\d+\.erome\.com\//i.test(url);
  }

  function eromeAlbumUrlFromMediaUrl(url) {
    const m = String(url).match(/erome\.com\/\d+\/([A-Za-z0-9]+)\//i);
    return m ? `https://www.erome.com/a/${m[1]}` : null;
  }

  function eromeRefererForUrl(url, pageHref) {
    if (pageHref && isEromeHost(pageHref)) return String(pageHref).split("#")[0];
    const album = eromeAlbumUrlFromMediaUrl(url);
    return album || "https://www.erome.com/";
  }

  function isEromeVideoUrl(url) {
    if (!url || !isEromeCdn(url)) return false;
    return /\.mp4/i.test(url) && !/\/thumbs?\//i.test(url);
  }

  function getOverlayPlatform(url) {
    const social = getSocialPlatform(url);
    if (social) return social;
    if (isYoutubeHost(url)) return null;
    return "generic";
  }

  function isOverlayHost(url) {
    return getOverlayPlatform(url) != null;
  }

  function isFragmentMediaUrl(url) {
    if (!url || /\.m3u8(\?|$)|\.mpd(\?|$)/i.test(url)) return false;
    return /\.m4s(\?|$)|\.ts(\?|$)|\/seg(?:ment)?[-_/]|\/chunk[-_/]/i.test(url);
  }

  function isXvideosHost(url) {
    const host = hostOf(url);
    return host === "xvideos.com" || host.endsWith(".xvideos.com");
  }

  function isXvideosCdn(url) {
    return !!url && /xvideos-cdn\.com/i.test(url);
  }

  function isXvideosMp4Url(url) {
    return isXvideosCdn(url) && /\.mp4/i.test(url) && /video_\d+p/i.test(url);
  }

  function isDirectMediaUrl(url) {
    if (!url || /^blob:|^data:/i.test(url)) return false;
    if (isFragmentMediaUrl(url)) return false;
    try {
      const u = new URL(url);
      if (!/^https?:$/i.test(u.protocol)) return false;
    } catch (e) {
      return false;
    }
    return /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url)
      || /\/video\/|videoplayback|\.mp4\?/i.test(url);
  }

  function isStreamMediaUrl(url) {
    return !!url && /\.(m3u8|mpd)(\?|$)/i.test(url);
  }

  function isLikelyVideoResource(url) {
    if (!url || /^blob:|^data:/i.test(url)) return false;
    if (isFragmentMediaUrl(url)) return false;
    if (isSocialCdnUrl(url)) return false;
    if (/googlevideo\.com/i.test(url)) return false;
    if (/thumb-cdn\d*\.|\/thumbs?\//i.test(url) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return false;
    if (isEromeVideoUrl(url)) return true;
    if (isXvideosMp4Url(url)) return true;
    return isDirectMediaUrl(url) || isStreamMediaUrl(url)
      || /\/(?:hls|dash|manifest|playlist)(?:\/|\.)/i.test(url);
  }

  function genericVideoUrlScore(url) {
    if (!url) return -1;
    if (isFragmentMediaUrl(url)) return -1;
    if (/\.erome\.com/i.test(url) && (/\/thumbs?\//i.test(url) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) {
      return -1;
    }
    let score = 0;
    if (isEromeVideoUrl(url)) score += 650;
    if (isXvideosMp4Url(url)) score += 700;
    if (isStreamMediaUrl(url)) score += 500;
    if (/\.mp4/i.test(url)) score += 400;
    if (/\.webm/i.test(url)) score += 350;
    if (/video_1440p|video_1080p/i.test(url)) score += 140;
    if (/video_720p/i.test(url)) score += 110;
    if (/video_480p|video_360p/i.test(url)) score += 60;
    if (/1080|720|hd|_480p|_720p|_1080p/i.test(url)) score += 80;
    if (/preview|thumb|poster|sprite|storyboard|thumb-cdn/i.test(url)) score -= 500;
    score += Math.min(url.length, 200);
    return score;
  }

  function collectXvideosVideoUrls() {
    if (!isXvideosHost(location.href)) return [];
    const seen = new Set();
    const out = [];
    const add = (url) => {
      if (!isXvideosMp4Url(url) || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };
    try {
      const re = /https?:\/\/[^"'\s<>]+xvideos-cdn\.com\/[^"'\s<>]+video_\d+p\.mp4[^"'\s<>]*/gi;
      let m;
      while ((m = re.exec(document.documentElement.innerHTML)) !== null) add(m[0]);
    } catch (e) {}
    document.querySelectorAll('a[href*="xvideos-cdn.com"][href*=".mp4"]').forEach((a) => add(a.href));
    out.sort((a, b) => genericVideoUrlScore(b) - genericVideoUrlScore(a));
    return out;
  }

  function collectEromeVideoUrls(videoEl) {
    const seen = new Set();
    const out = [];
    const add = (url) => {
      if (!isEromeVideoUrl(url) || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };
    const scope = videoEl?.closest?.(".media-group, .album, .video, .video-lg, #player, article, main")
      || document;
    scope.querySelectorAll("video source[src], video[src]").forEach((node) => {
      add(node.getAttribute("src") || node.src);
    });
    if (videoEl) {
      videoEl.querySelectorAll("source[src]").forEach((s) => add(s.getAttribute("src") || s.src));
      add(videoEl.currentSrc);
      add(videoEl.src);
    }
    try {
      const re = /https:\/\/v\d+\.erome\.com\/[^"'\s<>]+\.mp4/gi;
      let m;
      while ((m = re.exec(document.documentElement.innerHTML)) !== null) add(m[0]);
    } catch (e) {}
    out.sort((a, b) => genericVideoUrlScore(b) - genericVideoUrlScore(a));
    return out;
  }

  function videoUrlsFromPerformance() {
    const out = [];
    try {
      performance.getEntriesByType("resource").forEach((e) => {
        if (isLikelyVideoResource(e.name)) out.push(e.name);
      });
    } catch (e) {}
    return out;
  }

  function collectGenericVideoUrls(videoEl, detectedUrls) {
    const seen = new Set();
    const out = [];
    const add = (url) => {
      if (!isLikelyVideoResource(url) || seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };
    if (videoEl) {
      add(videoEl.currentSrc);
      add(videoEl.src);
      videoEl.querySelectorAll("source").forEach((s) => add(s.src));
    }
    videoUrlsFromPerformance().forEach(add);
    (detectedUrls || []).forEach(add);
    if (isEromeHost(location.href)) collectEromeVideoUrls(videoEl).forEach(add);
    if (isXvideosHost(location.href)) collectXvideosVideoUrls().forEach(add);
    out.sort((a, b) => genericVideoUrlScore(b) - genericVideoUrlScore(a));
    return out;
  }

  function pickGenericVideoUrl(videoEl, detectedUrls) {
    const urls = collectGenericVideoUrls(videoEl, detectedUrls);
    if (!urls.length) return null;
    const best = urls[0];
    const type = isStreamMediaUrl(best) ? "stream" : "direct";
    return { type, url: best, altUrls: urls.slice(1) };
  }

  function makeGenericFilename(url) {
    let base = (document.title || "").trim()
      .replace(/[\/\\:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 72);
    if (!base) {
      try {
        base = new URL(location.href).hostname.replace(/^www\./, "");
      } catch (e) {
        base = "video";
      }
    }
    let ext = "mp4";
    if (url && /\.webm/i.test(url)) ext = "webm";
    else if (url && /\.m3u8/i.test(url)) ext = "mp4";
    else if (url && /\.mov/i.test(url)) ext = "mov";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `${base}_${stamp}.${ext}`;
  }

  function tikTokVideoPath(path) {
    return /\/video\/\d+/.test(path)
      || /\/photo\/\d+/.test(path)
      || /^\/t\/[A-Za-z0-9]+/.test(path)
      || /^\/v\/\d+/.test(path);
  }

  function isTikTokWatchUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
      if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return u.pathname.length > 1;
      if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return tikTokVideoPath(u.pathname);
    } catch (e) {}
    return false;
  }

  function normalizeTikTokUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
      if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
        return `${u.protocol}//${u.hostname}${u.pathname}`;
      }
      if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
        return `https://www.tiktok.com${u.pathname}`;
      }
    } catch (e) {}
    return url;
  }

  function isTwitterWatchUrl(url) {
    if (!url) return false;
    try {
      if (!isTwitterHost(url)) return false;
      return /\/status\/\d+/.test(new URL(url).pathname);
    } catch (e) {}
    return false;
  }

  function normalizeTwitterUrl(url) {
    try {
      const u = new URL(url);
      const match = u.pathname.match(/(^|\/)(?:i\/)?status\/(\d+)/);
      if (match) return `https://x.com/i/status/${match[2]}`;
    } catch (e) {}
    return url;
  }

  function isInstagramWatchUrl(url) {
    if (!url) return false;
    try {
      if (!isInstagramHost(url)) return false;
      const p = new URL(url).pathname;
      return /^\/reels?\//.test(p) || /^\/p\//.test(p) || /^\/tv\//.test(p);
    } catch (e) {}
    return false;
  }

  function normalizeInstagramUrl(url) {
    try {
      const u = new URL(url);
      if (isInstagramHost(url)) return `https://www.instagram.com${u.pathname}`;
    } catch (e) {}
    return url;
  }

  function readOgUrl() {
    return document.querySelector('meta[property="og:url"]')?.content
      || document.querySelector('meta[name="og:url"]')?.content
      || document.querySelector('link[rel="canonical"]')?.href
      || null;
  }

  let cachedTikTokPageUrl = "";

  function rememberTikTokPageUrl(url) {
    if (!url || !isTikTokWatchUrl(url)) return null;
    cachedTikTokPageUrl = normalizeTikTokUrl(url);
    return cachedTikTokPageUrl;
  }

  function readTikTokUrlFromPageData() {
    for (const id of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"]) {
      const el = document.getElementById(id);
      if (!el || !el.textContent) continue;
      try {
        const data = JSON.parse(el.textContent);
        const scope = data?.__DEFAULT_SCOPE__;
        const detail = scope?.["webapp.video-detail"]?.itemInfo?.itemStruct
          || scope?.["webapp.reflow.video.detail"]?.itemInfo?.itemStruct;
        if (detail?.id && detail?.author?.uniqueId) {
          const kind = detail.imagePost ? "photo" : "video";
          return `https://www.tiktok.com/@${detail.author.uniqueId}/${kind}/${detail.id}`;
        }
        const itemModule = data?.ItemModule;
        if (itemModule && typeof itemModule === "object") {
          for (const it of Object.values(itemModule)) {
            const uniqueId = it?.authorMeta?.uniqueId
              || (typeof it?.author === "string" ? it.author : it?.author?.uniqueId);
            if (it?.id && uniqueId) {
              const kind = it.imagePost ? "photo" : "video";
              return `https://www.tiktok.com/@${uniqueId}/${kind}/${it.id}`;
            }
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function getTikTokPageUrl() {
    if (cachedTikTokPageUrl) return cachedTikTokPageUrl;
    if (!isTikTokHost(location.href)) return null;
    if (isTikTokWatchUrl(location.href)) return normalizeTikTokUrl(location.href);
    const og = readOgUrl();
    if (og && isTikTokWatchUrl(og)) return normalizeTikTokUrl(og);
    const fromData = readTikTokUrlFromPageData();
    if (fromData) return normalizeTikTokUrl(fromData);
    const match = document.documentElement.innerHTML.match(
      /https?:\/\/(?:www\.)?tiktok\.com\/@[^/"'\\]+?\/(?:video|photo)\/\d+/
    );
    if (match && isTikTokWatchUrl(match[0])) return normalizeTikTokUrl(match[0]);
    return null;
  }

  function getTwitterPageUrl() {
    if (!isTwitterHost(location.href)) return null;
    if (isTwitterWatchUrl(location.href)) return normalizeTwitterUrl(location.href);
    const og = readOgUrl();
    if (og && isTwitterWatchUrl(og)) return normalizeTwitterUrl(og);
    const articles = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
    for (const article of articles) {
      const video = article.querySelector("video");
      if (!video) continue;
      const link = article.querySelector('a[href*="/status/"]');
      if (link?.href && isTwitterWatchUrl(link.href)) return normalizeTwitterUrl(link.href);
    }
    const link = document.querySelector('a[href*="/status/"]');
    if (link?.href && isTwitterWatchUrl(link.href)) return normalizeTwitterUrl(link.href);
    return null;
  }

  function getInstagramPageUrl() {
    if (!isInstagramHost(location.href)) return null;
    if (isInstagramWatchUrl(location.href)) return normalizeInstagramUrl(location.href);
    const og = readOgUrl();
    if (og && isInstagramWatchUrl(og)) return normalizeInstagramUrl(og);
    const link = document.querySelector('a[href*="/reel/"], a[href*="/p/"], a[href*="/tv/"]');
    if (link?.href && isInstagramWatchUrl(link.href)) return normalizeInstagramUrl(link.href);
    return null;
  }

  function resolveSocialPageUrl(platform) {
    if (platform === "tiktok") return getTikTokPageUrl();
    if (platform === "twitter") return getTwitterPageUrl();
    if (platform === "instagram") return getInstagramPageUrl();
    return null;
  }

  function findStatusLink(root) {
    if (!root || !root.querySelector) return null;
    const timeLink = root.querySelector("time")?.closest("a[href*='/status/']");
    if (timeLink?.href && isTwitterWatchUrl(timeLink.href)) return timeLink.href;
    for (const link of root.querySelectorAll('a[href*="/status/"]')) {
      if (link.href && isTwitterWatchUrl(link.href)) return link.href;
    }
    return null;
  }

  function findTikTokLink(root) {
    if (!root || !root.querySelectorAll) return null;
    for (const link of root.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]')) {
      if (link.href && isTikTokWatchUrl(link.href)) return link.href;
    }
    return null;
  }

  function isPlayingVideo(video) {
    return video && video.tagName === "VIDEO" && !video.paused && !video.ended && video.readyState > 2;
  }

  function isValidTikTokVideoId(id) {
    return !!id && /^\d{15,}$/.test(String(id));
  }

  function findTikTokCardRoot(fromEl) {
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

  function getViewportTikTokWrapper() {
    const wrappers = document.querySelectorAll('[id^="xgwrapper-"]');
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

  function getViewportTikTokCard() {
    const w = getViewportTikTokWrapper();
    return w ? findTikTokCardRoot(w) : null;
  }

  function readTikTokAuthorNode(node) {
    if (!node) return "";
    const href = node.href || node.getAttribute("href") || "";
    const fromHref = href.match(/\/@([^/?#]+)/);
    if (fromHref && fromHref[1]) return fromHref[1];
    const text = (node.textContent || "").trim().replace(/^@/, "");
    if (text && /^[A-Za-z0-9._]+$/.test(text) && text.length < 40) return text;
    return "";
  }

  function authorFromTikTokCard(root) {
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
        const author = readTikTokAuthorNode(node);
        if (author) return author;
      }
    }
    let node = root;
    for (let i = 0; i < 8 && node?.parentElement; i++) {
      node = node.parentElement;
      for (const sel of authorSelectors) {
        const hit = node.querySelector(sel);
        if (!hit) continue;
        const author = readTikTokAuthorNode(hit);
        if (author) return author;
      }
    }
    return "";
  }

  function authorNearTikTokWrapper(wrapper) {
    if (!wrapper) return "";
    let node = wrapper;
    for (let i = 0; i < 12; i++) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const child of parent.children) {
        if (child === node || child.contains(wrapper)) continue;
        const author = authorFromTikTokCard(child);
        if (author) return author;
      }
      node = parent;
    }
    return "";
  }

  function getViewportFeedItem() {
    const items = document.querySelectorAll(
      '[data-e2e="feed-item"], [data-e2e="recommend-list-item"], [data-e2e="recommend-list-item-container"], [data-e2e="browse-video"]'
    );
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
    return getViewportTikTokCard();
  }

  function videoIdFromTikTokFeedItem(feedItem) {
    if (!feedItem) return "";
    const stamped = feedItem.dataset?.downpourTtActiveId || "";
    if (isValidTikTokVideoId(stamped)) return stamped;

    const videos = feedItem.querySelectorAll("video");
    for (const video of videos) {
      const wrapper = video.closest('[id^="xgwrapper-"]');
      if (wrapper?.id) {
        const parts = wrapper.id.split("-").slice(1);
        for (let i = parts.length - 1; i >= 0; i--) {
          if (isValidTikTokVideoId(parts[i])) return parts[i];
        }
      }
    }

    const wrapper = feedItem.querySelector('[id^="xgwrapper-"]');
    if (wrapper?.id) {
      const parts = wrapper.id.split("-").slice(1);
      for (let i = parts.length - 1; i >= 0; i--) {
        if (isValidTikTokVideoId(parts[i])) return parts[i];
      }
    }

    const links = feedItem.querySelectorAll('a[href*="/video/"], a[href*="/photo/"], [href*="/video/"], [href*="/photo/"]');
    for (const link of links) {
      const href = link.href || link.getAttribute("href") || "";
      const m = href.match(/\/(video|photo)\/(\d{15,})/);
      if (m) return m[2];
    }
    const html = feedItem.innerHTML || "";
    const m = html.match(/\/(?:video|photo)\/(\d{15,})/);
    return m ? m[1] : "";
  }

  function pageUrlFromTikTokCard(card, videoId) {
    if (!card || !isValidTikTokVideoId(videoId)) return "";
    const links = card.querySelectorAll('a[href*="/video/"], a[href*="/photo/"], [href*="/video/"], [href*="/photo/"]');
    for (const link of links) {
      const href = link.href || link.getAttribute("href") || "";
      const m = href.match(/\/(video|photo)\/(\d{15,})/);
      if (m && m[2] === String(videoId)) return normalizeTikTokUrl(href);
    }
    let author = authorFromTikTokCard(card);
    if (!author) {
      const wrapper = card.querySelector('[id^="xgwrapper-"]') || getViewportTikTokWrapper();
      author = authorNearTikTokWrapper(wrapper);
    }
    if (author) return normalizeTikTokUrl(`https://www.tiktok.com/@${author}/video/${videoId}`);
    return "";
  }

  function pageUrlFromTikTokFeedItem(feedItem, videoId) {
    return pageUrlFromTikTokCard(feedItem, videoId);
  }

  function pageUrlFromTikTokElement(el, videoId) {
    if (!el) return "";
    const card = findTikTokCardRoot(el) || getViewportTikTokCard();
    return pageUrlFromTikTokCard(card, videoId);
  }

  function getTikTokVideoIdFromElement(el) {
    if (!el) return "";
    const viewportItem = getViewportFeedItem();
    const fromViewport = videoIdFromTikTokFeedItem(viewportItem);
    if (isValidTikTokVideoId(fromViewport)) return fromViewport;

    const feedItem = el.closest?.('[data-e2e="feed-item"], [data-e2e="recommend-list-item"], [data-e2e="browse-video"]');
    const fromFeed = videoIdFromTikTokFeedItem(feedItem);
    if (isValidTikTokVideoId(fromFeed)) return fromFeed;

    const wrapper = el.closest?.('[id^="xgwrapper-"]');
    if (wrapper?.id) {
      const parts = wrapper.id.split("-").slice(1);
      for (let i = parts.length - 1; i >= 0; i--) {
        if (isValidTikTokVideoId(parts[i])) return parts[i];
      }
    }
    return "";
  }

  function resolveTikTokUrlForVideo(video) {
    const videoId = getTikTokVideoIdFromElement(video);
    const fromElement = pageUrlFromTikTokElement(video, videoId);
    if (fromElement) return fromElement;

    const viewportItem = getViewportFeedItem();
    const fromViewport = pageUrlFromTikTokFeedItem(viewportItem, videoId);
    if (fromViewport) return fromViewport;

    const feedItem = video.closest?.(
      '[data-e2e="feed-item"], [data-e2e="recommend-list-item"], [data-e2e="recommend-list-item-container"], [data-e2e="browse-video"]'
    ) || viewportItem;
    const fromFeed = pageUrlFromTikTokFeedItem(feedItem, videoId);
    if (fromFeed) return fromFeed;

    if (isTikTokWatchUrl(location.href)) return normalizeTikTokUrl(location.href);
    return null;
  }

  function resolveTwitterUrlForVideo(video) {
    const scopes = [
      video.closest('[data-testid="tweet"]'),
      video.closest('article[data-testid="tweet"]'),
      video.closest('article[role="article"]'),
      video.closest('[data-testid="cellInnerDiv"]'),
      video.parentElement
    ].filter(Boolean);

    for (const scope of scopes) {
      const href = findStatusLink(scope);
      if (href) return normalizeTwitterUrl(href);
    }

    let node = video;
    for (let depth = 0; depth < 18 && node; depth++) {
      const href = findStatusLink(node);
      if (href) return normalizeTwitterUrl(href);
      node = node.parentElement;
    }

    if (isTwitterWatchUrl(location.href)) return normalizeTwitterUrl(location.href);
    return null;
  }

  function normalizeSocialPageUrl(platform, url) {
    if (!url) return null;
    if (platform === "tiktok") return normalizeTikTokUrl(url);
    if (platform === "twitter") return normalizeTwitterUrl(url);
    if (platform === "instagram") return normalizeInstagramUrl(url);
    return url;
  }

  function isTikTokCdnHost(url) {
    return /tiktokcdn(?:-[a-z0-9-]+)?\.com|tiktokv\.com|tiktokv\.eu|byteoversea\.com|muscdn\.com/i.test(url)
      || /(?:webapp|v\d+).*\.tiktok\.com\/video\//i.test(url);
  }

  function isTikTokAudioUrl(url) {
    if (!url) return false;
    return /mime_type=audio|mime-type=audio|audio_mp4/i.test(url)
      || /\/music\//i.test(url);
  }

  function tikTokVideoUrlScore(url) {
    if (!url || isTikTokAudioUrl(url)) return -1;
    let score = 0;
    if (/mime_type=video|video_mp4/i.test(url)) score += 3000;
    if (/\/video\/tos\//i.test(url)) score += 800;
    const br = (url.match(/[?&]br=(\d+)/i) || [])[1];
    if (br) score += parseInt(br, 10) * 2;
    const bt = (url.match(/[?&]bt=(\d+)/i) || [])[1];
    if (bt) score += parseInt(bt, 10);
    if (/play_addr|playaddr|play/i.test(url)) score += 120;
    if (/download/i.test(url)) score -= 250;
    if (/playwm|watermark/i.test(url)) score -= 300;
    score += Math.min(url.length, 400);
    return score;
  }

  function isTikTokVideoMp4Url(url) {
    if (!isTikTokMp4Url(url)) return false;
    return !isTikTokAudioUrl(url);
  }

  function isTikTokMp4Url(url) {
    if (!url || /^blob:|^data:/i.test(url) || /\.m3u8/i.test(url)) return false;
    if (!isTikTokCdnHost(url)) return false;
    if (isTikTokAudioUrl(url)) return false;
    if (/\.mp4/i.test(url)) return true;
    if (/\/video\/tos\//i.test(url)) return true;
    if (/tiktok\.com\/video\//i.test(url)) return true;
    if (/\.(json|jpe?g|webp|png|aac|mp3)/i.test(url)) return false;
    return /\/video\//i.test(url);
  }

  function pickBestTikTokVideoUrl(urls) {
    const list = (urls || []).filter((u) => isTikTokVideoMp4Url(u));
    if (!list.length) return "";
    list.sort((a, b) => tikTokVideoUrlScore(b) - tikTokVideoUrlScore(a));
    return list[0];
  }

  function isTikTokM3u8Url(url) {
    return !!url && /\.m3u8/i.test(url) && isTikTokCdnHost(url);
  }

  function pickTikTokCdnUrl(video) {
    const src = video?.currentSrc || video?.src || "";
    if (isTikTokVideoMp4Url(src)) return src;
    return null;
  }

  function pickTikTokM3u8() {
    try {
      const entries = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => isTikTokM3u8Url(n));
      if (entries.length) return entries[entries.length - 1];
    } catch (e) {}
    return null;
  }

  function isTwitterInitMp4(url) {
    if (!url || !/\.mp4/i.test(url) || !/twimg\.com/i.test(url)) return false;
    return /\/init[\/.]|init\.mp4/i.test(url);
  }

  function isUsableTwitterMp4(url) {
    return /\.mp4/i.test(url) && /twimg\.com/i.test(url) && !isTwitterInitMp4(url);
  }

  function pickTwitterMp4(video) {
    const candidates = [];
    const src = video?.currentSrc || video?.src || "";
    if (src && !/^blob:|^data:/i.test(src) && isUsableTwitterMp4(src)) candidates.push(src);
    try {
      performance.getEntriesByType("resource")
        .filter((e) => /\.mp4/i.test(e.name) && /twimg\.com/i.test(e.name))
        .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
        .forEach((e) => candidates.push(e.name));
    } catch (e) {}
    const filtered = candidates.filter((url) => isUsableTwitterMp4(url));
    const uniq = Array.from(new Set(filtered));
    return uniq.length ? uniq[0] : null;
  }

  function pickDirectCdnUrl(platform, video) {
    if (platform === "tiktok") return pickTikTokCdnUrl(video);
    if (platform === "twitter") return pickTwitterMp4(video);
    const candidates = [];
    const src = video?.currentSrc || video?.src || "";
    if (src && !/^blob:|^data:/i.test(src) && isSocialCdnUrl(src)) candidates.push(src);
    const uniq = Array.from(new Set(candidates));
    return uniq.length ? uniq[uniq.length - 1] : null;
  }

  function pickTwitterM3u8(video) {
    try {
      const entries = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => /video\.twimg\.com|pbs\.twimg\.com/i.test(n) && /\.m3u8/i.test(n));
      if (entries.length) return entries[entries.length - 1];
    } catch (e) {}
    const src = video?.currentSrc || video?.src || "";
    if (src && /\.m3u8/i.test(src) && /twimg\.com/i.test(src)) return src;
    return null;
  }

  function resolveInstagramUrlForVideo(video) {
    const scope = video.closest("article, main section, div[role='dialog']") || video.parentElement;
    const link = scope?.querySelector('a[href*="/reel/"], a[href*="/p/"], a[href*="/tv/"]')
      || video.closest('a[href*="/reel/"], a[href*="/p/"], a[href*="/tv/"]');
    if (link?.href && isInstagramWatchUrl(link.href)) return normalizeInstagramUrl(link.href);
    return getInstagramPageUrl();
  }

  function resolveSocialPageUrlForVideo(platform, video) {
    if (!video) return resolveSocialPageUrl(platform);
    if (platform === "tiktok") return resolveTikTokUrlForVideo(video);
    if (platform === "twitter") return resolveTwitterUrlForVideo(video);
    if (platform === "instagram") return resolveInstagramUrlForVideo(video);
    return resolveSocialPageUrl(platform);
  }

  function makeSocialFilename(platform) {
    let base = (document.title || "").trim()
      .replace(/\s*[-–—|]\s*(TikTok|X|Twitter|Instagram)\s*$/i, "")
      .replace(/[\/\\:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 72);
    if (!base) base = platform;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `${base}_${stamp}_720p.mp4`;
  }

  function isSocialCdnUrl(url) {
    return isTikTokMp4Url(url) || isTikTokM3u8Url(url)
      || (/twimg\.com/i.test(url) && /\.(mp4|m3u8)/i.test(url))
      || /cdninstagram\.com|fbcdn\.net.*\.mp4/i.test(url);
  }

  return {
    forEachDeep,
    shadowRootOf,
    getSocialPlatform,
    getOverlayPlatform,
    isOverlayHost,
    isYoutubeHost,
    isEromeHost,
    isEromeCdn,
    isEromeVideoUrl,
    eromeRefererForUrl,
    eromeAlbumUrlFromMediaUrl,
    collectEromeVideoUrls,
    isSocialOverlayHost,
    isSocialCdnUrl,
    isLikelyVideoResource,
    isStreamMediaUrl,
    isDirectMediaUrl,
    pickGenericVideoUrl,
    makeGenericFilename,
    isTikTokHost,
    isTikTokWatchUrl,
    normalizeTikTokUrl,
    rememberTikTokPageUrl,
    getTikTokPageUrl,
    getViewportFeedItem,
    getViewportTikTokCard,
    pageUrlFromTikTokElement,
    pageUrlFromTikTokCard,
    getTikTokVideoIdFromElement,
    isValidTikTokVideoId,
    pageUrlFromTikTokFeedItem,
    isTwitterHost,
    isTwitterWatchUrl,
    normalizeTwitterUrl,
    getTwitterPageUrl,
    isInstagramHost,
    isInstagramWatchUrl,
    normalizeInstagramUrl,
    getInstagramPageUrl,
    resolveSocialPageUrl,
    resolveSocialPageUrlForVideo,
    normalizeSocialPageUrl,
    pickDirectCdnUrl,
    pickTikTokCdnUrl,
    pickTikTokM3u8,
    isTikTokCdnHost,
    isTikTokAudioUrl,
    isTikTokVideoMp4Url,
    tikTokVideoUrlScore,
    pickBestTikTokVideoUrl,
    isTikTokMp4Url,
    isTikTokM3u8Url,
    pickTwitterM3u8,
    isUsableTwitterMp4,
    isTwitterInitMp4,
    makeSocialFilename
  };
})();