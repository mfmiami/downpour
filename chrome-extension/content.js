const lastSocialReport = {};

function injectPageScript(resource, datasetFlag) {
  return DownpourInject.pageScript(resource, datasetFlag);
}

function reportSocialPages() {
  const platform = DownpourPlatforms.getSocialPlatform(location.href);
  if (!platform) return;
  const url = DownpourPlatforms.resolveSocialPageUrl(platform);
  if (!url) return;
  if (lastSocialReport[platform] === url) return;
  lastSocialReport[platform] = url;
  DownpourBridge.sendMessage({ action: "socialPage", platform, url });
}

function rememberTikTokPageUrl(url) {
  const normalized = DownpourPlatforms.rememberTikTokPageUrl(url);
  if (normalized) reportSocialPages();
}

function isYoutubePage(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.length > 1;
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const p = u.pathname;
      return p === "/watch" || p.startsWith("/shorts/") || p.startsWith("/embed/")
        || p.startsWith("/live/") || p.startsWith("/v/") || u.searchParams.has("v");
    }
  } catch (e) {}
  return false;
}

function normalizeYoutubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return id ? `https://www.youtube.com/watch?v=${id}` : url;
    }
    if (u.pathname.startsWith("/shorts/")) return `https://www.youtube.com${u.pathname}`;
    if (u.pathname.startsWith("/live/")) return `https://www.youtube.com${u.pathname}`;
    if (u.pathname === "/watch" && u.searchParams.has("v")) {
      return `https://www.youtube.com/watch?v=${u.searchParams.get("v")}`;
    }
    if (u.pathname.startsWith("/embed/")) return `https://www.youtube.com${u.pathname}`;
  } catch (e) {}
  return url;
}

let lastReportedYoutube = "";

function reportYoutubePage() {
  const href = window.location.href;
  if (!isYoutubePage(href)) return;
  const normalized = normalizeYoutubeUrl(href);
  if (normalized === lastReportedYoutube) return;
  lastReportedYoutube = normalized;
  DownpourBridge.sendMessage({ action: "youtubePage", url: normalized });
}

function findVideos() {
  if (DownpourPlatforms.isSocialOverlayHost(location.href)) return;
  const videoUrls = new Set();

  // Find <video> tags
  const videos = document.querySelectorAll("video");
  videos.forEach((v) => {
    if (v.src) videoUrls.add(v.src);
    const sources = v.querySelectorAll("source");
    sources.forEach((s) => {
      if (s.src) videoUrls.add(s.src);
    });
  });

  // Find <a> tags that might be video links
  const links = document.querySelectorAll("a");
  const videoExtensions = [".mp4", ".webm", ".m3u8", ".mpd", ".ogv"];
  links.forEach((l) => {
    if (l.href) {
      const url = l.href.toLowerCase();
      if (videoExtensions.some((ext) => url.includes(ext))) {
        videoUrls.add(l.href);
      }
    }
  });

  if (videoUrls.size > 0) {
    DownpourBridge.sendMessage({
      action: "videosFound",
      videos: Array.from(videoUrls)
    });
  }
}

function hookTikTokNavigation() {
  if (!DownpourPlatforms.isTikTokHost(window.location.href) || window.__vsdTikTokNav) return;
  window.__vsdTikTokNav = true;
  const wrap = (fn) => function (...args) {
    const ret = fn.apply(this, args);
    lastSocialReport.tiktok = "";
    reportSocialPages();
    return ret;
  };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
}

function injectTikTokCapture() {
  if (!DownpourPlatforms.isTikTokHost(window.location.href)) return;
  injectPageScript("tiktok-page-capture-injected.js", "vsdTikTokCapture");
}

function injectSocialCapture() {
  const platform = DownpourPlatforms.getSocialPlatform(location.href);
  if (!platform || platform === "tiktok") return;
  if (document.documentElement.dataset.vsdSocialCapture) return;
  document.documentElement.dataset.vsdSocialCapture = platform;
  injectPageScript("social-page-capture-injected.js", "vsdSocialCapture");
}

// Initial scan
injectStreamCapture();
injectTikTokCapture();
injectSocialCapture();
hookTikTokNavigation();
reportYoutubePage();
reportSocialPages();
findVideos();

let socialReportInterval = null;
if (DownpourPlatforms.isSocialOverlayHost(location.href)) {
  socialReportInterval = setInterval(() => {
    if (!DownpourBridge.alive()) return;
    reportSocialPages();
  }, 2000);
  DownpourBridge.onInvalidated(() => {
    if (socialReportInterval) clearInterval(socialReportInterval);
  });
}

// YouTube/social sites are SPAs — re-report on navigation and DOM updates.
window.addEventListener("popstate", () => {
  if (!DownpourBridge.alive()) return;
  reportYoutubePage();
  reportSocialPages();
});
window.addEventListener("yt-navigate-finish", () => {
  if (DownpourBridge.alive()) reportYoutubePage();
});

const observer = new MutationObserver(() => {
  if (!DownpourBridge.alive()) {
    observer.disconnect();
    DownpourBridge.teardown();
    return;
  }
  reportYoutubePage();
  reportSocialPages();
  findVideos();
});

DownpourBridge.onInvalidated(() => observer.disconnect());

observer.observe(document.body, {
  childList: true,
  subtree: true
});

function youtubeVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0];
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2];
    if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2];
    return u.searchParams.get("v");
  } catch (e) {}
  return null;
}

function parseJsonAssignment(text, varName) {
  const needle = varName + " = ";
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  const start = text.indexOf("{", idx);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, quote = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

function readYtInitialPlayerResponseFromScripts() {
  for (const el of document.querySelectorAll("script")) {
    const t = el.textContent;
    if (!t || !t.includes("ytInitialPlayerResponse")) continue;
    const pr = parseJsonAssignment(t, "ytInitialPlayerResponse");
    if (pr && pr.streamingData) return pr;
  }
  return null;
}

function readYtInitialPlayerResponseFromPage() {
  return new Promise((resolve) => {
    const tag = "vsd-pr-" + Date.now();
    const handler = (event) => {
      if (event.source !== window || !event.data || event.data.type !== tag) return;
      window.removeEventListener("message", handler);
      resolve(event.data.player || null);
    };
    window.addEventListener("message", handler);
    injectPageScript("youtube-player-bridge-injected.js", "vsdYtPlayerBridge").then(() => {
      window.postMessage({ type: "VSD_YT_PLAYER_REQUEST", tag }, "*");
    });
    setTimeout(() => { window.removeEventListener("message", handler); resolve(null); }, 1500);
  });
}

async function readYtInitialPlayerResponse() {
  const fromPage = await readYtInitialPlayerResponseFromPage();
  if (fromPage && fromPage.streamingData) return fromPage;
  return readYtInitialPlayerResponseFromScripts();
}

function readInnertubeConfig() {
  const data = window.ytcfg && window.ytcfg.data_;
  if (data && data.INNERTUBE_API_KEY) {
    return { apiKey: data.INNERTUBE_API_KEY, context: data.INNERTUBE_CONTEXT };
  }
  for (const el of document.querySelectorAll("script")) {
    const t = el.textContent;
    if (!t || !t.includes("INNERTUBE_API_KEY")) continue;
    const keyMatch = t.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    if (!keyMatch) continue;
    const ctx = parseJsonAssignment(t, "INNERTUBE_CONTEXT");
    return {
      apiKey: keyMatch[1],
      context: ctx || {
        client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en", gl: "US" }
      }
    };
  }
  return null;
}

const INNERTUBE_CLIENTS = [
  null,
  { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en", gl: "US" },
  { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, hl: "en", gl: "US" },
  { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" }
];

async function fetchInnertubePlayer(videoId) {
  const cfg = readInnertubeConfig();
  if (!cfg) return null;
  for (const client of INNERTUBE_CLIENTS) {
    const context = client
      ? { client }
      : (cfg.context || { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en", gl: "US" } });
    const resp = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, videoId })
      }
    );
    if (!resp.ok) continue;
    const data = await resp.json();
    if (data && data.streamingData && pickYoutubeStream(data.streamingData)) return data;
  }
  return null;
}

function formatDirectUrl(format) {
  if (format.url) return format.url;
  const cipher = format.signatureCipher || format.cipher;
  if (!cipher) return null;
  const params = {};
  cipher.split("&").forEach((part) => {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  });
  return params.url || null;
}

function isChromeExtension() {
  try {
    return (chrome.runtime.getManifest().permissions || []).includes("scripting");
  } catch (e) {
    return false;
  }
}

function pickYoutubeStream(streamingData, quality) {
  if (!streamingData) return null;

  if (isChromeExtension() && streamingData.hlsManifestUrl) {
    return { kind: "stream", url: streamingData.hlsManifestUrl, source: "hls" };
  }

  const progressive = (streamingData.formats || [])
    .map((f) => ({ f, url: formatDirectUrl(f) }))
    .filter((x) => x.url && (x.f.mimeType || "").includes("video"))
    .sort((a, b) => (b.f.height || b.f.qualityOrdinal || 0) - (a.f.height || a.f.qualityOrdinal || 0));
  let progPick = progressive;
  if (quality === "normal") {
    const at720 = progressive.filter((x) => (x.f.height || x.f.qualityOrdinal || 0) <= 720);
    if (at720.length) progPick = at720;
  }
  if (progPick[0]) {
    return { kind: "direct", url: progPick[0].url, source: "progressive" };
  }

  if (streamingData.hlsManifestUrl) {
    return { kind: "stream", url: streamingData.hlsManifestUrl, source: "hls" };
  }

  const adaptiveVideo = (streamingData.adaptiveFormats || [])
    .map((f) => ({ f, url: formatDirectUrl(f) }))
    .filter((x) => x.url && (x.f.mimeType || "").includes("video") && !(x.f.mimeType || "").includes("audio"))
    .sort((a, b) => (b.f.height || b.f.qualityOrdinal || 0) - (a.f.height || a.f.qualityOrdinal || 0));
  let adaptPick = adaptiveVideo;
  if (quality === "normal") {
    const at720 = adaptiveVideo.filter((x) => (x.f.height || x.f.qualityOrdinal || 0) <= 720);
    if (at720.length) adaptPick = at720;
  }
  if (adaptPick[0]) {
    return { kind: "direct", url: adaptPick[0].url, source: "adaptive-video" };
  }

  if (streamingData.dashManifestUrl) {
    return { kind: "stream", url: streamingData.dashManifestUrl, source: "dash" };
  }

  return null;
}

function collectYoutubeAlternates(streamingData, primary, quality) {
  const alternates = [];
  const seen = new Set(primary && primary.url ? [primary.url] : []);
  const add = (item) => {
    if (!item || !item.url || seen.has(item.url)) return;
    seen.add(item.url);
    alternates.push(item);
  };
  if (streamingData.hlsManifestUrl) {
    add({ kind: "stream", url: streamingData.hlsManifestUrl, source: "hls" });
  }
  for (const f of streamingData.formats || []) {
    const url = formatDirectUrl(f);
    if (url && (f.mimeType || "").includes("video")) {
      add({ kind: "direct", url, source: "progressive" });
    }
  }
  for (const f of streamingData.adaptiveFormats || []) {
    const url = formatDirectUrl(f);
    if (url && (f.mimeType || "").includes("video") && !(f.mimeType || "").includes("audio")) {
      if (quality !== "normal" || (f.height || f.qualityOrdinal || 0) <= 720) {
        add({ kind: "direct", url, source: "adaptive-video" });
      }
    }
  }
  if (streamingData.dashManifestUrl) {
    add({ kind: "stream", url: streamingData.dashManifestUrl, source: "dash" });
  }
  return alternates;
}

function tabFetchBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function tabFetchHeaders(url) {
  const headers = {};
  if (/googlevideo\.com/i.test(url)) {
    headers.Referer = isYoutubePage(location.href) ? location.href : "https://www.youtube.com/";
    headers.Origin = "https://www.youtube.com";
  } else if (/cdninstagram\.com|fbcdn\.net/i.test(url)) {
    headers.Referer = "https://www.instagram.com/";
  } else if (DownpourPlatforms.isTikTokCdnHost(url)) {
    headers.Referer = "https://www.tiktok.com/";
  } else if (/twimg\.com/i.test(url)) {
    headers.Referer = "https://x.com/";
  } else if (typeof DownpourPlatforms !== "undefined" && DownpourPlatforms.isEromeCdn(url)) {
    headers.Referer = DownpourPlatforms.eromeRefererForUrl(url, location.href);
  } else {
    headers.Referer = location.href;
  }
  return headers;
}

function tabFetchUsesCredentials(url) {
  return /googlevideo\.com|twimg\.com|cdninstagram|fbcdn/i.test(url)
    || DownpourPlatforms.isTikTokCdnHost(url);
}

function needsPageContextFetch(url) {
  if (/googlevideo\.com/i.test(url)) return true;
  if (/youtube\.com\/api\/manifest|manifest\.googlevideo\.com|youtube\.com\/hls/i.test(url)) return true;
  return typeof DownpourPlatforms !== "undefined" && DownpourPlatforms.isEromeCdn(url);
}

let pageFetchSeq = 0;
const pageFetchWaiters = new Map();
let pageFetchBridgeReady = null;

function ensurePageFetchBridge() {
  if (pageFetchBridgeReady) return pageFetchBridgeReady;
  pageFetchBridgeReady = (async () => {
    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data || event.data.type !== "VSD_PAGE_FETCH_RESULT") return;
      const waiter = pageFetchWaiters.get(event.data.id);
      if (!waiter) return;
      pageFetchWaiters.delete(event.data.id);
      waiter(event.data);
    });
    await injectPageScript("page-fetch-injected.js", "vsdPageFetch");
  })();
  return pageFetchBridgeReady;
}

async function pageProxyFetch(url, mode) {
  await ensurePageFetchBridge();
  return new Promise((resolve, reject) => {
    const id = `pf_${++pageFetchSeq}_${Date.now()}`;
    const timer = setTimeout(() => {
      pageFetchWaiters.delete(id);
      reject(new Error("page fetch timeout"));
    }, 300000);
    pageFetchWaiters.set(id, (data) => {
      clearTimeout(timer);
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      if (mode === "text") resolve({ text: data.text });
      else resolve({ data: data.data, length: data.length });
    });
    window.postMessage({
      type: "VSD_PAGE_FETCH_REQUEST",
      id,
      url,
      wantText: mode === "text",
      credentials: tabFetchUsesCredentials(url) ? "include" : "omit",
      headers: tabFetchHeaders(url)
    }, "*");
  });
}

async function tabProxyFetch(url, mode) {
  if (needsPageContextFetch(url)) {
    return pageProxyFetch(url, mode);
  }
  const resp = await fetch(url, {
    credentials: tabFetchUsesCredentials(url) ? "include" : "omit",
    headers: tabFetchHeaders(url)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (mode === "text") return { text: await resp.text() };
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return { data: tabFetchBase64(bytes), length: bytes.length };
}

function scrapeVideoplaybackFromPage() {
  const html = document.documentElement.innerHTML;
  const matches = html.match(/https:\/\/[^"'\s\\]+googlevideo\.com\/videoplayback[^"'\s\\]*/g) || [];
  if (!matches.length) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

async function getYoutubeStreams(options) {
  const quality = (options && options.quality) || "normal";
  const videoId = youtubeVideoId(window.location.href);
  let player = await readYtInitialPlayerResponse();
  const initialPick = player && player.streamingData && pickYoutubeStream(player.streamingData, quality);
  if (!initialPick && videoId) {
    const fromApi = await fetchInnertubePlayer(videoId);
    if (fromApi) player = fromApi;
  }
  if (player) {
    if (player.playabilityStatus?.status === "LOGIN_REQUIRED") {
      return { error: "Video is unavailable or requires sign-in." };
    }
    if (player.playabilityStatus?.status && player.playabilityStatus.status !== "OK") {
      return { error: player.playabilityStatus.reason || "Video is not playable." };
    }
    const picked = player.streamingData && pickYoutubeStream(player.streamingData, quality);
    if (picked) {
      return {
        ...picked,
        alternates: collectYoutubeAlternates(player.streamingData, picked, quality)
      };
    }
  }
  const scraped = scrapeVideoplaybackFromPage();
  if (scraped) return { kind: "direct", url: scraped, source: "page", alternates: [] };
  return { error: "No stream captured yet — play the video for a few seconds, then try again." };
}

function injectStreamCapture() {
  injectPageScript("youtube-capture-injected.js", "vsdCapture");
}

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || !DownpourBridge.alive()) return;
  if (event.data.type === "VSD_YT_STREAM" && event.data.url) {
    DownpourBridge.sendMessage({ action: "youtubeStreamCaptured", url: event.data.url });
  }
  if (event.data.type === "VSD_TT_VIDEO" && event.data.url) {
    rememberTikTokPageUrl(event.data.url);
  }
  if (event.data.type === "VSD_SOCIAL_VIDEO" && event.data.url && event.data.platform) {
    DownpourBridge.sendMessage({
      action: "socialPage",
      platform: event.data.platform,
      url: event.data.url
    });
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!DownpourBridge.alive()) return;
  if (request.action === "getYoutubePage") {
    const href = window.location.href;
    sendResponse(isYoutubePage(href) ? { url: normalizeYoutubeUrl(href) } : { url: null });
    return true;
  }
  if (request.action === "getTikTokPage") {
    sendResponse({ url: DownpourPlatforms.getTikTokPageUrl() });
    return true;
  }
  if (request.action === "getSocialPage") {
    const platform = DownpourPlatforms.getSocialPlatform(location.href);
    sendResponse({
      platform,
      url: platform ? DownpourPlatforms.resolveSocialPageUrl(platform) : null
    });
    return true;
  }
  if (request.action === "getYoutubeStreams") {
    getYoutubeStreams({ quality: request.quality }).then(sendResponse);
    return true;
  }
  if (request.action === "tabFetch") {
    tabProxyFetch(request.url, request.mode || "bytes")
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }
});
