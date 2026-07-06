// mux.js runs here in the service worker so transmuxing/downloading continues
// even after the popup is closed. importScripts works because this is a classic
// (non-module) service worker.
importScripts("mux.min.js");

// ---------------------------------------------------------------------------
// fragmented-MP4 -> flat-MP4 flattener. mux.js emits a fragmented MP4 (empty
// moov + moof/mdat) which QuickTime renders as black video + truncated audio.
// We rebuild the sample tables into a progressive MP4 (ftyp + moov + mdat) here.
// Kept inline (rather than a separate importScripts file) so no Xcode project
// resource entry is needed. Source of truth: ../videodownload/remux.js (tested).
// ---------------------------------------------------------------------------
(function (global) {
  "use strict";
  function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; }
  function s32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n | 0); return b; }
  function str(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  function concat(arrs) {
    let len = 0; for (const a of arrs) len += a.length;
    const out = new Uint8Array(len); let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  function box(type, ...parts) { const body = concat(parts); return concat([u32(body.length + 8), str(type), body]); }
  function fullbox(type, version, flags, ...parts) {
    return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
  }

  function flattenFragmentedMp4(input) {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const rU32 = (o) => dv.getUint32(o);
    const rS32 = (o) => dv.getInt32(o);
    const typeAt = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);

    function children(start, end) {
      const out = []; let off = start;
      while (off + 8 <= end) {
        let size = rU32(off); const type = typeAt(off + 4); let hdr = 8;
        if (size === 1) { size = Number(dv.getBigUint64(off + 8)); hdr = 16; }
        if (size < hdr || off + size > end) break;
        out.push({ type, off, hdr, size, dataStart: off + hdr, dataEnd: off + size });
        off += size;
      }
      return out;
    }
    const find = (list, type) => list.find((b) => b.type === type);
    const slice = (b) => buf.subarray(b.off, b.dataEnd);

    const top = children(0, buf.length);
    const ftyp = find(top, "ftyp");
    const moov = find(top, "moov");
    if (!ftyp || !moov) throw new Error("not an MP4 (missing ftyp/moov)");
    const moovKids = children(moov.dataStart, moov.dataEnd);
    const mvhd = find(moovKids, "mvhd");
    const traks = moovKids.filter((b) => b.type === "trak");

    function parseTraf(traf) {
      const kids = children(traf.dataStart, traf.dataEnd);
      const tfhd = find(kids, "tfhd"), trun = find(kids, "trun");
      const tflags = rU32(tfhd.dataStart) & 0xffffff;
      let p = tfhd.dataStart + 4; const trackId = rU32(p); p += 4;
      if (tflags & 0x000001) p += 8;
      if (tflags & 0x000002) p += 4;
      let defDur = 0, defSize = 0, defFlags = 0;
      if (tflags & 0x000008) { defDur = rU32(p); p += 4; }
      if (tflags & 0x000010) { defSize = rU32(p); p += 4; }
      if (tflags & 0x000020) { defFlags = rU32(p); p += 4; }
      const trVer = buf[trun.dataStart];
      const trFlags = rU32(trun.dataStart) & 0xffffff;
      let q = trun.dataStart + 4; const count = rU32(q); q += 4;
      if (trFlags & 0x000001) q += 4;
      let firstFlags = null;
      if (trFlags & 0x000004) { firstFlags = rU32(q); q += 4; }
      const samples = [];
      for (let i = 0; i < count; i++) {
        let dur = defDur, size = defSize, flags = defFlags, cto = 0;
        if (trFlags & 0x000100) { dur = rU32(q); q += 4; }
        if (trFlags & 0x000200) { size = rU32(q); q += 4; }
        if (trFlags & 0x000400) { flags = rU32(q); q += 4; }
        else if (i === 0 && firstFlags !== null) { flags = firstFlags; }
        if (trFlags & 0x000800) { cto = trVer === 1 ? rS32(q) : rU32(q); q += 4; }
        samples.push({ dur, size, flags, cto });
      }
      return { trackId, samples };
    }

    const fragByTrack = {};
    for (let i = 0; i < top.length; i++) {
      if (top[i].type !== "moof") continue;
      const moof = top[i], mdat = top[i + 1];
      if (!mdat || mdat.type !== "mdat") throw new Error("moof not followed by mdat");
      const traf = find(children(moof.dataStart, moof.dataEnd), "traf");
      const { trackId, samples } = parseTraf(traf);
      if (!fragByTrack[trackId]) fragByTrack[trackId] = { samples: [], data: [] };
      fragByTrack[trackId].samples.push(...samples);
      fragByTrack[trackId].data.push(buf.subarray(mdat.dataStart, mdat.dataEnd));
    }

    const mvVer = buf[mvhd.dataStart];
    const movTimescale = rU32(mvhd.dataStart + 4 + (mvVer === 1 ? 16 : 8));
    let maxMovieDur = 0;

    const tracks = [];
    for (const trak of traks) {
      const trakKids = children(trak.dataStart, trak.dataEnd);
      const tkhd = find(trakKids, "tkhd");
      const tkVer = buf[tkhd.dataStart];
      const trackId = rU32(tkhd.dataStart + 4 + (tkVer === 1 ? 16 : 8));
      const frag = fragByTrack[trackId];
      if (!frag) continue;
      tracks.push({ trak, trakKids, tkhd, trackId, samples: frag.samples, data: concat(frag.data) });
    }
    if (tracks.length === 0) throw new Error("no track fragments found");

    function rebuildTrak(t, chunkOffset) {
      const mdia = find(t.trakKids, "mdia");
      const mdiaKids = children(mdia.dataStart, mdia.dataEnd);
      const mdhd = find(mdiaKids, "mdhd");
      const mdhdVer = buf[mdhd.dataStart];
      const timescale = rU32(mdhd.dataStart + 4 + (mdhdVer === 1 ? 16 : 8));
      const minf = find(mdiaKids, "minf");
      const minfKids = children(minf.dataStart, minf.dataEnd);
      const stbl = find(minfKids, "stbl");
      const stblKids = children(stbl.dataStart, stbl.dataEnd);
      const stsd = find(stblKids, "stsd");
      const stsdBuf = slice(stsd);

      const samples = t.samples;
      const totalDur = samples.reduce((a, s) => a + s.dur, 0);
      const movieDur = Math.round((totalDur / timescale) * movTimescale);
      if (movieDur > maxMovieDur) maxMovieDur = movieDur;

      const stts = []; let i = 0;
      while (i < samples.length) { let j = i + 1; while (j < samples.length && samples[j].dur === samples[i].dur) j++; stts.push([j - i, samples[i].dur]); i = j; }
      const sttsBuf = fullbox("stts", 0, 0, u32(stts.length), concat(stts.map(([c, d]) => concat([u32(c), u32(d)]))));
      const stszBuf = fullbox("stsz", 0, 0, u32(0), u32(samples.length), concat(samples.map((s) => u32(s.size))));
      const stscBuf = fullbox("stsc", 0, 0, u32(1), concat([u32(1), u32(samples.length), u32(1)]));
      const stcoBuf = fullbox("stco", 0, 0, u32(1), u32(chunkOffset));

      const parts = [stsdBuf, sttsBuf, stscBuf, stszBuf, stcoBuf];
      const sync = [];
      samples.forEach((s, idx) => { if (((s.flags >> 16) & 0x1) === 0) sync.push(idx + 1); });
      if (sync.length > 0 && sync.length < samples.length) {
        parts.push(fullbox("stss", 0, 0, u32(sync.length), concat(sync.map((n) => u32(n)))));
      }
      if (samples.some((s) => s.cto !== 0)) {
        const ctts = []; let k = 0;
        while (k < samples.length) { let j = k + 1; while (j < samples.length && samples[j].cto === samples[k].cto) j++; ctts.push([j - k, samples[k].cto]); k = j; }
        parts.push(fullbox("ctts", 1, 0, u32(ctts.length), concat(ctts.map(([c, o]) => concat([u32(c), s32(o)])))));
      }
      const newStbl = box("stbl", ...parts);
      const newMinf = box("minf", ...minfKids.map((b) => (b.type === "stbl" ? newStbl : slice(b))));

      const mdhdBuf = slice(mdhd).slice();
      const mdv = new DataView(mdhdBuf.buffer);
      if (mdhdVer === 1) mdv.setBigUint64(8 + 4 + 8 + 8 + 4, BigInt(totalDur));
      else mdv.setUint32(8 + 4 + 4 + 4 + 4, totalDur >>> 0);
      const newMdia = box("mdia", ...mdiaKids.map((b) => (b.type === "minf" ? newMinf : b.type === "mdhd" ? mdhdBuf : slice(b))));

      const tkhdBuf = slice(t.tkhd).slice();
      const tkv = new DataView(tkhdBuf.buffer);
      const tkVer = tkhdBuf[8];
      if (tkVer === 1) tkv.setBigUint64(8 + 4 + 8 + 8 + 4 + 4, BigInt(movieDur));
      else tkv.setUint32(8 + 4 + 4 + 4 + 4 + 4, movieDur >>> 0);
      return box("trak", ...t.trakKids.map((b) => (b.type === "mdia" ? newMdia : b.type === "tkhd" ? tkhdBuf : slice(b))));
    }

    function buildMoov(chunkOffsets) {
      maxMovieDur = 0;
      const newTraks = tracks.map((t, ti) => rebuildTrak(t, chunkOffsets[ti]));
      const mvhdBuf = slice(mvhd).slice();
      const mv = new DataView(mvhdBuf.buffer);
      if (mvVer === 1) mv.setBigUint64(8 + 4 + 8 + 8 + 4, BigInt(maxMovieDur));
      else mv.setUint32(8 + 4 + 4 + 4 + 4, maxMovieDur >>> 0);
      return box("moov", mvhdBuf, ...newTraks);
    }

    const moov1 = buildMoov(tracks.map(() => 0));
    const ftypBuf = slice(ftyp);
    let base = ftypBuf.length + moov1.length + 8;
    const chunkOffsets = []; let acc = base;
    for (const t of tracks) { chunkOffsets.push(acc); acc += t.data.length; }
    const moov2 = buildMoov(chunkOffsets);
    if (moov2.length !== moov1.length) throw new Error("moov size changed between passes");

    const mdatBody = concat(tracks.map((t) => t.data));
    const mdat = concat([u32(mdatBody.length + 8), str("mdat"), mdatBody]);
    return concat([ftypBuf, moov2, mdat]);
  }

  global.flattenFragmentedMp4 = flattenFragmentedMp4;
})(typeof self !== "undefined" ? self : globalThis);

const detectedVideos = {};
const youtubePages = {}; // tabId -> normalized watch URL
const tiktokPages = {}; // tabId -> normalized TikTok video URL
const twitterPages = {}; // tabId -> normalized X/Twitter status URL
const instagramPages = {}; // tabId -> normalized Instagram media URL
const youtubeStreamUrls = {}; // tabId -> Set of captured googlevideo URLs

// Listen for network requests to detect video files and streams
const VIDEO_REGEX = /\.(mp4|webm|m3u8|mpd|ogv|mov|flv|avi|mkv|m4s)(?:$|\?|#)/i;
const GOOGLEVIDEO_REGEX = /googlevideo\.com\/(?:videoplayback|initplayback|api\/manifest|file\/)|manifest\.googlevideo\.com/i;
const TIKTOK_VIDEO_REGEX = /tiktokcdn(?:-[a-z0-9-]+)?\.com|tiktokv\.com|byteoversea\.com|muscdn\.com/i;
const TIKTOK_VIDEO_PATH = /\/video\/tos\/|tiktok\.com\/video\//i;

function isDetectedVideoUrl(url) {
  return VIDEO_REGEX.test(url) || GOOGLEVIDEO_REGEX.test(url)
    || (TIKTOK_VIDEO_REGEX.test(url) && TIKTOK_VIDEO_PATH.test(url));
}

function youtubeStreamStore(tabId) {
  if (!youtubeStreamUrls[tabId]) youtubeStreamUrls[tabId] = new Set();
  return youtubeStreamUrls[tabId];
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

function pickYoutubeStreamFromData(streamingData) {
  if (!streamingData) return null;
  if (streamingData.hlsManifestUrl) {
    return { kind: "stream", url: streamingData.hlsManifestUrl, source: "hls" };
  }
  const progressive = (streamingData.formats || [])
    .filter((f) => f.url && (f.mimeType || "").includes("video"))
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (progressive[0]) return { kind: "direct", url: progressive[0].url, source: "progressive" };
  const adaptiveVideo = (streamingData.adaptiveFormats || [])
    .filter((f) => f.url && (f.mimeType || "").includes("video") && !(f.mimeType || "").includes("audio"))
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (adaptiveVideo[0]) return { kind: "direct", url: adaptiveVideo[0].url, source: "adaptive-video" };
  if (streamingData.dashManifestUrl) {
    return { kind: "stream", url: streamingData.dashManifestUrl, source: "dash" };
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseProgressFromMessage(message) {
  if (!message) return null;
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(String(message));
  return match ? Math.min(99, Math.floor(parseFloat(match[1]))) : null;
}

async function runYtDlpNativeJob(job) {
  let token = null;
  try {
    ensureNotCancelled(job);
    if (job.watchUrl) job.url = job.watchUrl;
    const watchUrl = resolveYtDlpWatchUrl(job);
    if (!watchUrl) throw new Error("No video page URL available for yt-dlp");
    const begin = await sendNative({
      type: "youtubeBegin",
      url: watchUrl,
      filename: job.filename,
      quality: job.quality || "normal"
    });
    if (!begin || !begin.ok || !begin.token) {
      throw new Error((begin && begin.error) || "yt-dlp download unavailable");
    }
    token = begin.token;
    while (true) {
      ensureNotCancelled(job);
      const status = await sendNative({ type: "youtubeStatus", token });
      if (!status) throw new Error("yt-dlp status failed");
      if (status.error && !status.state) throw new Error(status.error);
      if (status.state === "done") {
        update(job, { state: "done", progress: 100, message: `Saved → ${status.path}`, path: status.path });
        return;
      }
      if (status.state === "error") throw new Error(status.error || "yt-dlp failed");
      if (status.state === "cancelled") throw new Error("cancelled");
      const message = status.message || job.message || "downloading with yt-dlp…";
      const progress = status.progress != null
        ? status.progress
        : (parseProgressFromMessage(message) ?? job.progress ?? 0);
      update(job, { state: "running", progress, message });
      await sleep(500);
    }
  } catch (e) {
    if (token) try { await sendNative({ type: "youtubeAbort", token }); } catch (_) {}
    throw e;
  }
}

function usesChromeDownloads() {
  return typeof globalThis.__downpourSaveToDownloads === "function";
}

function isNativeHostMissingError(message) {
  return /native messaging host not found/i.test(message || "");
}

function isNativeHostExitedError(message) {
  return /native host has exited/i.test(message || "");
}

function nativeHostHelpMessage() {
  return "Reinstall the YouTube helper: chrome-extension/native-host/install-native-host.sh YOUR_EXTENSION_ID";
}

let nativeHostPingCache = null;

async function nativeHostReachable() {
  if (nativeHostPingCache && Date.now() - nativeHostPingCache.at < 60000) {
    return nativeHostPingCache.ok;
  }
  try {
    const resp = await sendNative({ type: "ping" });
    const ok = !!(resp && resp.ok);
    nativeHostPingCache = { ok, at: Date.now() };
    return ok;
  } catch (e) {
    nativeHostPingCache = { ok: false, at: Date.now() };
    return false;
  }
}

function isYoutubeManifestUrl(url) {
  return /manifest\.googlevideo\.com/i.test(url)
    || /googlevideo\.com\/api\/manifest/i.test(url)
    || (/googlevideo|youtube/i.test(url) && /\.m3u8(\?|$)/i.test(url));
}

async function queryYoutubeStreams(job) {
  if (job.tabId == null) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const streams = await chrome.tabs.sendMessage(job.tabId, {
        action: "getYoutubeStreams",
        quality: job.quality || "normal"
      });
      if (streams && !streams.error && streams.url) return streams;
      if (attempt < 3) await sleep(400);
    } catch (e) {
      if (attempt < 3) await sleep(400);
    }
  }
  return null;
}

function pickBestVideoplayback(urls, quality) {
  const list = Array.from(urls);
  if (!list.length) return null;
  if (quality === "normal") {
    const prefer720 = list.filter((u) => /[?&]itag=(22|136|135|298|299)\b/.test(u));
    if (prefer720.length) {
      list.length = 0;
      prefer720.forEach((u) => list.push(u));
    }
  }
  const score = (u) => {
    let s = 0;
    const itag = u.match(/[?&]itag=(\d+)/);
    if (itag) {
      const n = parseInt(itag[1], 10);
      if (n === 18 || n === 22) s += 1000;
      else s += n;
    }
    if (/mime=video[^&]*mp4|mp4/i.test(u)) s += 200;
    if (/[?&]aitags=/.test(u)) s += 150;
    if (u.includes("videoplayback")) s += 50;
    return s;
  };
  list.sort((a, b) => score(b) - score(a));
  return list[0];
}

const YOUTUBE_AUDIO_ITAGS = new Set([139, 140, 141, 171, 249, 250, 251, 256, 258, 325, 328]);

function isUsableVideoplaybackUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!/googlevideo\.com\/videoplayback/i.test(url)) return false;
  if (/initplayback|\/file\/|\/api\/manifest/i.test(url)) return false;
  const itag = url.match(/[?&]itag=(\d+)/);
  if (!itag) return false;
  return !YOUTUBE_AUDIO_ITAGS.has(parseInt(itag[1], 10));
}

function collectYoutubePlaybackUrls(job) {
  if (job.tabId == null) return [];
  const quality = job.quality || "normal";
  const urls = [];
  const captured = youtubeStreamUrls[job.tabId];
  if (captured) {
    for (const u of captured) {
      if (isUsableVideoplaybackUrl(u)) urls.push(u);
    }
  }
  const detected = detectedVideos[job.tabId];
  if (detected) {
    for (const u of detected) {
      if (isUsableVideoplaybackUrl(u)) urls.push(u);
    }
  }
  const seen = new Set();
  const unique = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
  }
  unique.sort((a, b) => {
    const score = (u) => {
      let s = 0;
      const tag = u.match(/[?&]itag=(\d+)/);
      if (tag) {
        const n = parseInt(tag[1], 10);
        if (n === 18 || n === 22) s += 1000;
        else s += n;
      }
      if (/mime=video[^&]*mp4|mp4/i.test(u)) s += 200;
      return s;
    };
    return score(b) - score(a);
  });
  if (quality === "normal") {
    const prefer720 = unique.filter((u) => /[?&]itag=(22|136|135|298|299)\b/.test(u));
    if (prefer720.length) {
      return prefer720.concat(unique.filter((u) => !prefer720.includes(u)));
    }
  }
  return unique;
}

async function collectYoutubeStreamCandidates(job) {
  const streams = [];
  const direct = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || item.error || !item.url || seen.has(item.url)) return;
    seen.add(item.url);
    if (item.kind === "stream") streams.push(item);
    else direct.push(item);
  };

  const picked = await queryYoutubeStreams(job);
  add(picked);
  if (picked && Array.isArray(picked.alternates)) {
    for (const alt of picked.alternates) add(alt);
  }

  if (job.tabId != null && detectedVideos[job.tabId]) {
    for (const u of detectedVideos[job.tabId]) {
      if (isYoutubeManifestUrl(u)) add({ kind: "stream", url: u, source: "network-hls" });
    }
  }

  if (!picked || picked.error || !picked.url) {
    for (const url of collectYoutubePlaybackUrls(job)) {
      add({ kind: "direct", url, source: "network" });
    }
  }

  return [...streams, ...direct];
}

function isYoutubeWatchUrl(url) {
  if (!url) return false;
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
    if (host === "youtu.be") return `https://www.youtube.com/watch?v=${u.pathname.slice(1).split("/")[0]}`;
    if (u.pathname.startsWith("/shorts/")) return `https://www.youtube.com${u.pathname}`;
    if (u.pathname.startsWith("/live/")) return `https://www.youtube.com${u.pathname}`;
    if (u.pathname === "/watch" && u.searchParams.has("v")) {
      return `https://www.youtube.com/watch?v=${u.searchParams.get("v")}`;
    }
    if (u.pathname.startsWith("/embed/")) return `https://www.youtube.com${u.pathname}`;
  } catch (e) {}
  return url;
}

function isTikTokWatchUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return u.pathname.length > 1;
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      const p = u.pathname;
      return /\/video\/\d+/.test(p) || /\/photo\/\d+/.test(p)
        || /^\/t\/[A-Za-z0-9]+/.test(p) || /^\/v\/\d+/.test(p);
    }
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

function resolveYoutubeWatchUrl(job) {
  if (job.watchUrl && isYoutubeWatchUrl(job.watchUrl)) return normalizeYoutubeUrl(job.watchUrl);
  if (job.tabId != null && youtubePages[job.tabId]) return youtubePages[job.tabId];
  if (isYoutubeWatchUrl(job.url)) return normalizeYoutubeUrl(job.url);
  return null;
}

function resolveTikTokWatchUrl(job) {
  if (job.watchUrl && isTikTokWatchUrl(job.watchUrl)) return normalizeTikTokUrl(job.watchUrl);
  if (job.tabId != null && tiktokPages[job.tabId]) return tiktokPages[job.tabId];
  if (isTikTokWatchUrl(job.url)) return normalizeTikTokUrl(job.url);
  return null;
}

function resolveTwitterWatchUrl(job) {
  if (job.watchUrl && isTwitterWatchUrl(job.watchUrl)) return normalizeTwitterUrl(job.watchUrl);
  if (job.tabId != null && twitterPages[job.tabId]) return twitterPages[job.tabId];
  if (isTwitterWatchUrl(job.url)) return normalizeTwitterUrl(job.url);
  return null;
}

function resolveInstagramWatchUrl(job) {
  if (job.watchUrl && isInstagramWatchUrl(job.watchUrl)) return normalizeInstagramUrl(job.watchUrl);
  if (job.tabId != null && instagramPages[job.tabId]) return instagramPages[job.tabId];
  if (isInstagramWatchUrl(job.url)) return normalizeInstagramUrl(job.url);
  return null;
}

function resolveYtDlpWatchUrl(job) {
  if (job.kind === "tiktok") return resolveTikTokWatchUrl(job);
  if (job.kind === "twitter") return resolveTwitterWatchUrl(job);
  if (job.kind === "instagram") return resolveInstagramWatchUrl(job);
  return resolveYoutubeWatchUrl(job);
}

function isTwitterWatchUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (!(host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com"))) return false;
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
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (!(host === "instagram.com" || host.endsWith(".instagram.com"))) return false;
    const p = new URL(url).pathname;
    return /^\/reels?\//.test(p) || /^\/p\//.test(p) || /^\/tv\//.test(p);
  } catch (e) {}
  return false;
}

function normalizeInstagramUrl(url) {
  try {
    const u = new URL(url);
    if (isInstagramWatchUrl(url)) return `https://www.instagram.com${u.pathname}`;
  } catch (e) {}
  return url;
}

function storeSocialPageUrl(tabId, url) {
  if (tabId < 0 || !url) return;
  if (isTikTokWatchUrl(url)) {
    tiktokPages[tabId] = normalizeTikTokUrl(url);
    return;
  }
  const tiktokMatch = url.match(/https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/?#'"]+\/(?:video|photo)\/\d+/i);
  if (tiktokMatch) {
    tiktokPages[tabId] = normalizeTikTokUrl(tiktokMatch[0]);
    return;
  }
  if (isTwitterWatchUrl(url)) {
    twitterPages[tabId] = normalizeTwitterUrl(url);
    return;
  }
  const twitterMatch = url.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/?#'"]+\/status\/\d+/i);
  if (twitterMatch) twitterPages[tabId] = normalizeTwitterUrl(twitterMatch[0]);
  if (isInstagramWatchUrl(url)) {
    instagramPages[tabId] = normalizeInstagramUrl(url);
    return;
  }
  const igMatch = url.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reels?|p|tv)\/[^/?#'"]+/i);
  if (igMatch) instagramPages[tabId] = normalizeInstagramUrl(igMatch[0]);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const tabId = details.tabId;
    if (tabId < 0) return;
    storeSocialPageUrl(tabId, url);
    if (isDetectedVideoUrl(url)) {
      if (!detectedVideos[tabId]) detectedVideos[tabId] = new Set();
      detectedVideos[tabId].add(url);
      if (/googlevideo\.com\/videoplayback/i.test(url)) {
        youtubeStreamStore(tabId).add(url);
      }
    }
  },
  { urls: ["<all_urls>"] }
);

// ---------------------------------------------------------------------------
// Download jobs. These run entirely in the background so they survive the popup
// being closed. Progress is surfaced on the toolbar badge and pushed to any open
// popup via "jobUpdate" messages; the popup can also pull current state on open.
// ---------------------------------------------------------------------------

const jobs = {}; // id -> { id, url, filename, kind, state, progress, message, path }
let jobSeq = 0;

function broadcast(job) {
  const payload = { action: "jobUpdate", job };
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch (e) {}
  if (job.tabId != null) {
    try {
      chrome.tabs.sendMessage(job.tabId, payload).catch(() => {});
    } catch (e) {}
  }
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

function refreshBadge() {
  const live = Object.values(jobs).filter((j) => j.state === "running" || j.state === "saving");
  const queued = Object.values(jobs).filter((j) => j.state === "queued").length;
  if (live.length === 1) {
    badge(live[0].progress != null ? `${live[0].progress}%` : "…", "#4688F1");
  } else if (live.length + queued > 0) {
    badge(String(live.length + queued), "#4688F1");
  }
}

function update(job, patch) {
  Object.assign(job, patch);
  if (job.state === "running" || job.state === "saving") {
    refreshBadge();
  } else if (job.state === "done") {
    badge("✓", "#4CAF50");
    setTimeout(() => badge("", "#4688F1"), 8000);
  } else if (job.state === "error") {
    badge("!", "#d9534f");
  } else if (job.state === "cancelled") {
    refreshBadge();
    if (!Object.values(jobs).some((j) => j.state === "running" || j.state === "saving" || j.state === "queued")) {
      badge("", "#4688F1");
    }
  }
  broadcast(job);
}

function isYoutubeCdn(url) {
  return /googlevideo\.com|youtube\.com\/api\/manifest|manifest\.googlevideo\.com|youtube\.com\/hls/i.test(url);
}

function isInstagramCdn(url) {
  return /cdninstagram\.com|fbcdn\.net/i.test(url);
}

function isTikTokCdn(url) {
  return /tiktokcdn(?:-[a-z0-9-]+)?\.com|tiktokv\.com|tiktokv\.eu|byteoversea\.com|muscdn\.com/i.test(url)
    || /(?:webapp|v\d+).*\.tiktok\.com\/video\//i.test(url);
}

function isTwitterCdn(url) {
  return /video\.twimg\.com|pbs\.twimg\.com/i.test(url);
}

function isEromeCdn(url) {
  return /\/\/v\d+\.erome\.com\//i.test(url);
}

function eromeRefererForCdn(url) {
  const m = String(url).match(/erome\.com\/\d+\/([A-Za-z0-9]+)\//i);
  return m ? `https://www.erome.com/a/${m[1]}` : "https://www.erome.com/";
}

function isSocialCdn(url) {
  return isInstagramCdn(url) || isTikTokCdn(url) || isTwitterCdn(url);
}

function fetchInit(url, signal) {
  const init = { credentials: (isYoutubeCdn(url) || isSocialCdn(url)) ? "include" : "omit", signal };
  if (isYoutubeCdn(url)) {
    init.headers = { Referer: "https://www.youtube.com/", Origin: "https://www.youtube.com" };
  } else if (isInstagramCdn(url)) {
    init.headers = { Referer: "https://www.instagram.com/" };
  } else if (isTikTokCdn(url)) {
    init.headers = { Referer: "https://www.tiktok.com/" };
  } else if (isTwitterCdn(url)) {
    init.headers = { Referer: "https://x.com/" };
  } else if (isEromeCdn(url)) {
    init.headers = { Referer: eromeRefererForCdn(url) };
  }
  return init;
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function fetchViaTab(tabId, url, mode) {
  const resp = await chrome.tabs.sendMessage(tabId, { action: "tabFetch", url, mode });
  if (!resp || !resp.ok) throw new Error((resp && resp.error) || "tab fetch failed");
  if (mode === "text") return resp.text;
  return base64ToBytes(resp.data);
}

async function fetchText(url, signal, tabId, forceTab) {
  if (tabId != null && (forceTab || isYoutubeCdn(url) || isSocialCdn(url) || isEromeCdn(url))) {
    try { return await fetchViaTab(tabId, url, "text"); } catch (e) {
      if (isEromeCdn(url) || isYoutubeCdn(url)) throw e;
    }
  }
  if (isEromeCdn(url)) {
    throw new Error("Stay on the erome album page and try again");
  }
  const r = await fetch(url, fetchInit(url, signal));
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching manifest`);
  return r.text();
}

async function fetchBytes(url, signal, tabId, forceTab) {
  if (tabId != null && (forceTab || isYoutubeCdn(url) || isSocialCdn(url) || isEromeCdn(url))) {
    try { return await fetchViaTab(tabId, url, "bytes"); } catch (e) {
      if (isEromeCdn(url) || isYoutubeCdn(url)) throw e;
    }
  }
  if (isEromeCdn(url)) {
    throw new Error("Stay on the erome album page and try again");
  }
  const r = await fetch(url, fetchInit(url, signal));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Like fetchBytes, but streams the body so a single-file download reports
// progress (via Content-Length). Falls back to a plain read if streaming or the
// length header is unavailable.
async function fetchBytesWithProgress(url, job, signal) {
  const useTab = job.tabId != null && (job.youtubeFetch || job.socialFetch || job.tabFetch || isYoutubeCdn(url) || isSocialCdn(url) || isEromeCdn(url));
  if (useTab) {
    try {
      update(job, { message: "downloading via page…" });
      return await fetchViaTab(job.tabId, url, "bytes");
    } catch (e) {
      if (isEromeCdn(url) || isYoutubeCdn(url)) throw e;
    }
  }
  if (isEromeCdn(url)) {
    throw new Error("Stay on the erome album page and try again");
  }
  const r = await fetch(url, fetchInit(url, signal));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (!r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());

  const total = parseInt(r.headers.get("Content-Length") || "0", 10);
  const reader = r.body.getReader();
  const chunks = [];
  let received = 0, lastPct = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      const pct = Math.round((received / total) * 100);
      if (pct !== lastPct) { lastPct = pct; update(job, { progress: pct }); }
    } else {
      update(job, { progress: 0, message: `downloading ${Math.round(received / 1048576)} MB…` });
    }
  }
  return concatChunks(chunks);
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    if (relative.startsWith("http")) return relative;
    const baseUrl = base.substring(0, base.lastIndexOf("/") + 1);
    return baseUrl + relative;
  }
}

function base64FromBytes(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function sendNative(message) {
  if (typeof globalThis.__downpourSendNative === "function") {
    return globalThis.__downpourSendNative(message);
  }
  return new Promise((resolve, reject) => {
    try {
      const ret = chrome.runtime.sendNativeMessage(message, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
      if (ret && typeof ret.then === "function") ret.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

// Hand the finished bytes to the native app extension, which writes the file
// straight into ~/Downloads (files.downloads.read-write entitlement). There is
// no browser/anchor fallback here because the service worker has no DOM.
//
// Large files are streamed in chunks: base64-encoding the whole buffer at once
// builds a ~1.3x-size JS string (UTF-16, so ~2.6x bytes) plus the message copy,
// which OOMs the service worker. Each chunk is encoded, sent, and freed in turn.
const NATIVE_CHUNK = 4 * 1024 * 1024;

async function saveToDownloads(bytes, filename, job) {
  if (typeof globalThis.__downpourSaveToDownloads === "function") {
    return globalThis.__downpourSaveToDownloads(bytes, filename, job);
  }
  if (bytes.length <= NATIVE_CHUNK) {
    const resp = await sendNative({ type: "saveToDownloads", filename, data: base64FromBytes(bytes) });
    if (resp && resp.ok) return resp.path;
    throw new Error((resp && (resp.error || JSON.stringify(resp))) || "native save returned no response");
  }

  const begin = await sendNative({ type: "saveBegin", filename });
  if (!begin || !begin.ok || !begin.token) throw new Error((begin && begin.error) || "saveBegin failed");
  const token = begin.token;
  try {
    const total = bytes.length;
    for (let off = 0; off < total; off += NATIVE_CHUNK) {
      if (job && job.cancelled) throw new Error("cancelled");
      const end = Math.min(off + NATIVE_CHUNK, total);
      const resp = await sendNative({ type: "saveChunk", token, data: base64FromBytes(bytes.subarray(off, end)) });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "saveChunk failed");
      if (job) {
        update(job, {
          state: "saving",
          progress: Math.round((end / total) * 100),
          message: `saving ${Math.round(end / 1048576)}/${Math.round(total / 1048576)} MB…`
        });
      }
    }
    const fin = await sendNative({ type: "saveEnd", token, filename });
    if (fin && fin.ok) return fin.path;
    throw new Error((fin && fin.error) || "saveEnd failed");
  } catch (e) {
    try { await sendNative({ type: "saveAbort", token }); } catch (_) {}
    throw e;
  }
}

// Concatenate downloaded segment byte-arrays (and optional init) into one buffer.
function concatChunks(chunks) {
  const total = chunks.reduce((a, c) => a + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

function assertFetchable(url) {
  if (/^(blob:|data:|mediasource:)/i.test(url)) {
    throw new Error("Media Source stream (e.g. YouTube) — these in-page blob streams can't be downloaded directly.");
  }
}

// Cancellation: each running job has an AbortController (kept out of the job
// object itself, which gets structured-cloned when broadcast to the popup).
const controllers = {}; // job id -> AbortController
function ensureNotCancelled(job) { if (job.cancelled) throw new Error("cancelled"); }
function wasCancelled(job, e) { return job.cancelled || (e && e.name === "AbortError"); }

async function runStreamJob(job, options) {
  const rethrow = options && options.rethrow;
  const ctrl = controllers[job.id];
  const signal = ctrl && ctrl.signal;
  try {
    ensureNotCancelled(job);
    assertFetchable(job.url);
    update(job, { state: "running", progress: 0, message: "fetching manifest…" });

    let manifestUrl = job.url;
    const tabFetch = job.youtubeFetch || job.socialFetch || job.tabFetch;
    let text = await fetchText(manifestUrl, signal, job.tabId, tabFetch);

    // Master playlist: pick the highest-bandwidth variant.
    if (text.includes("#EXT-X-STREAM-INF")) {
      const lines = text.split("\n");
      let bestStreamUrl = "";
      let maxBandwidth = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("#EXT-X-STREAM-INF")) {
          const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
          const bw = bwMatch ? parseInt(bwMatch[1]) : 0;
          const nextLine = lines[i + 1] && lines[i + 1].trim();
          if (nextLine && !nextLine.startsWith("#") && bw >= maxBandwidth) {
            maxBandwidth = bw;
            bestStreamUrl = nextLine;
          }
        }
      }
      if (bestStreamUrl) {
        manifestUrl = resolveUrl(manifestUrl, bestStreamUrl);
        text = await fetchText(manifestUrl, signal, job.tabId, tabFetch);
      }
    }

    if (text.includes("#EXT-X-KEY")) {
      throw new Error("This stream is encrypted (DRM/AES) and cannot be downloaded.");
    }

    const lines = text.split("\n");
    const segments = [];
    let initSegmentUrl = null;
    const mapMatch = text.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch) initSegmentUrl = resolveUrl(manifestUrl, mapMatch[1]);
    for (let line of lines) {
      line = line.trim();
      if (line && !line.startsWith("#")) segments.push(resolveUrl(manifestUrl, line));
    }
    if (segments.length === 0) throw new Error("No video segments found in playlist.");

    // Decide TS-vs-fMP4 from the first segment's actual bytes, not the URL.
    // Many HLS CDNs serve MPEG-TS from paths that contain ".mp4"
    // (e.g. ".../movie.mp4/seg-1.ts"), which would misroute a TS stream.
    const sniffUrl = initSegmentUrl || segments[0];
    const sniffBytes = await fetchBytes(sniffUrl, signal, job.tabId, tabFetch);
    const isMpegTs = sniffBytes[0] === 0x47 && (sniffBytes.length <= 188 || sniffBytes[188] === 0x47);
    update(job, { message: `${segments.length} segments — ${isMpegTs ? "MPEG-TS (transmux)" : "fMP4 (concat)"}` });

    let finalBytes;

    if (!isMpegTs) {
      // fMP4: concatenate init + media segments as-is.
      const parts = [];
      if (initSegmentUrl) parts.push(sniffBytes);
      let downloaded = 0;
      for (let i = 0; i < segments.length; i++) {
        ensureNotCancelled(job);
        try {
          const buf = (!initSegmentUrl && i === 0) ? sniffBytes : await fetchBytes(segments[i], signal, job.tabId, tabFetch);
          parts.push(buf);
        } catch (e) { if (wasCancelled(job, e)) throw e; /* else skip failed segment */ }
        downloaded++;
        update(job, { progress: Math.round((downloaded / segments.length) * 100) });
      }
      finalBytes = concatChunks(parts);
      try {
        finalBytes = flattenFragmentedMp4(finalBytes);
      } catch (e) {
        update(job, { message: `flatten failed (${e.message}); saving raw concat` });
      }
    } else {
      // MPEG-TS: transmux to fragmented MP4. Push every segment, flush once, and
      // let mux.js normalise the base timestamp to 0 so QuickTime accepts it.
      const transmuxer = new muxjs.mp4.Transmuxer();
      let initSegment = null;
      const mediaSegments = [];
      transmuxer.on("data", (event) => {
        if (!initSegment) initSegment = event.initSegment;
        mediaSegments.push(event.data);
      });

      let downloaded = 0;
      for (let i = 0; i < segments.length; i++) {
        ensureNotCancelled(job);
        try {
          const arrayBuffer = (i === 0) ? sniffBytes : await fetchBytes(segments[i], signal, job.tabId, tabFetch);
          transmuxer.push(arrayBuffer);
        } catch (e) { if (wasCancelled(job, e)) throw e; /* else skip failed segment */ }
        downloaded++;
        update(job, { progress: Math.round((downloaded / segments.length) * 100) });
      }
      transmuxer.flush();

      if (!initSegment || mediaSegments.length === 0) {
        throw new Error("Transmuxer produced no output.");
      }
      // mux.js gives a fragmented MP4; flatten it to a progressive MP4 so it
      // plays in QuickTime (otherwise: black video + truncated audio).
      let fragmented = concatChunks([initSegment, ...mediaSegments]);
      // Release mux.js's buffers now that they're concatenated, to cap peak memory.
      initSegment = null;
      mediaSegments.length = 0;
      try {
        finalBytes = flattenFragmentedMp4(fragmented);
        fragmented = null; // flat copy made; drop the fragmented one
      } catch (e) {
        update(job, { message: `flatten failed (${e.message}); saving fragmented` });
        finalBytes = fragmented;
      }
    }

    ensureNotCancelled(job);
    update(job, { state: "saving", progress: 100, message: `saving ${job.filename}…` });
    const path = await saveToDownloads(finalBytes, job.filename, job);
    finalBytes = null;
    update(job, { state: "done", message: `Saved → ${path}`, path });
  } catch (e) {
    if (rethrow) throw e;
    if (wasCancelled(job, e)) update(job, { state: "cancelled", message: "Cancelled" });
    else update(job, { state: "error", message: `ERROR: ${e.message}` });
  } finally {
    if (!rethrow) delete controllers[job.id];
  }
}

function mp4HandlerTypes(bytes) {
  const types = new Set();
  for (let i = 0; i < bytes.length - 16; i++) {
    if (bytes[i] === 0x68 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x6c && bytes[i + 3] === 0x72) {
      types.add(String.fromCharCode(bytes[i + 12], bytes[i + 13], bytes[i + 14], bytes[i + 15]));
    }
  }
  return types;
}

function mp4HasVideoTrack(bytes) {
  return mp4HandlerTypes(bytes).has("vide");
}

function mp4IsAudioOnly(bytes) {
  const types = mp4HandlerTypes(bytes);
  return types.has("soun") && !types.has("vide");
}

function mp4HasMoof(bytes) {
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x6d && bytes[i + 1] === 0x6f && bytes[i + 2] === 0x6f && bytes[i + 3] === 0x66) return true;
  }
  return false;
}

function imageExtensionFromBytes(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return null;
}

function filenameWithImageExtension(filename, bytes) {
  const ext = imageExtensionFromBytes(bytes);
  if (!ext) return filename;
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${ext}`;
}

async function runNativeUrlDownload(job, options) {
  let token = null;
  try {
    ensureNotCancelled(job);
    assertFetchable(job.url);
    update(job, { state: "running", progress: 0, message: "downloading…" });
    const begin = await sendNative({
      type: "downloadUrlBegin",
      url: job.url,
      filename: job.filename,
      referer: options && options.referer
    });
    if (!begin || !begin.ok || !begin.token) {
      throw new Error((begin && begin.error) || "native download unavailable");
    }
    token = begin.token;
    while (true) {
      ensureNotCancelled(job);
      const status = await sendNative({ type: "downloadUrlStatus", token });
      if (!status) throw new Error("native download status failed");
      if (status.state === "done") {
        update(job, { state: "done", progress: 100, message: `Saved → ${status.path}`, path: status.path });
        return;
      }
      if (status.state === "error") throw new Error(status.error || "native download failed");
      if (status.state === "cancelled") throw new Error("cancelled");
      update(job, {
        state: status.state === "saving" ? "saving" : "running",
        progress: typeof status.progress === "number" ? status.progress : job.progress,
        message: status.message || job.message
      });
      await sleep(400);
    }
  } catch (e) {
    if (token) try { await sendNative({ type: "downloadUrlAbort", token }); } catch (_) {}
    throw e;
  }
}

async function runEromeNativeDownload(job) {
  try {
    await runNativeUrlDownload(job, { referer: eromeRefererForCdn(job.url) });
  } catch (e) {
    if (wasCancelled(job, e)) update(job, { state: "cancelled", message: "Cancelled" });
    else update(job, { state: "error", message: `ERROR: ${e.message}` });
  } finally {
    delete controllers[job.id];
  }
}

async function runDirectJob(job, options) {
  const rethrow = options && options.rethrow;
  if (isEromeCdn(job.url) && !globalThis.__downpourSkipEromeNative) return runEromeNativeDownload(job);
  const ctrl = controllers[job.id];
  const signal = ctrl && ctrl.signal;
  try {
    ensureNotCancelled(job);
    assertFetchable(job.url);
    update(job, { state: "running", progress: 0, message: "downloading…" });
    let bytes = await fetchBytesWithProgress(job.url, job, signal);
    ensureNotCancelled(job);
    const looksLikeVideo = /\.mp4|\/video\//i.test(job.url);
    if (bytes.length < 32768 && looksLikeVideo) {
      throw new Error("Download too small — got a stream header, not the full video. Play the video and try again.");
    }
    if (isTikTokCdn(job.url) && looksLikeVideo && mp4IsAudioOnly(bytes)) {
      throw new Error("Download is audio-only — play the video and try again.");
    }
    if (isTikTokCdn(job.url) && mp4HasMoof(bytes) && mp4HasVideoTrack(bytes)) {
      try {
        update(job, { message: "remuxing for QuickTime…" });
        bytes = flattenFragmentedMp4(bytes);
      } catch (e) {
        update(job, { message: `remux skipped (${e.message})` });
      }
    }
    let saveName = job.filename;
    if (job.imageDownload) {
      saveName = filenameWithImageExtension(saveName, bytes);
      if (bytes.length < 512) {
        throw new Error("Download too small — image may be unavailable. Try opening the post first.");
      }
    }
    update(job, { state: "saving", progress: 95, message: `saving ${saveName}…` });
    const path = await saveToDownloads(bytes, saveName, job);
    update(job, { state: "done", message: `Saved → ${path}`, path });
  } catch (e) {
    if (rethrow) throw e;
    if (wasCancelled(job, e)) update(job, { state: "cancelled", message: "Cancelled" });
    else update(job, { state: "error", message: `ERROR: ${e.message}` });
  } finally {
    if (!rethrow) delete controllers[job.id];
  }
}

// Chrome: download captured googlevideo/HLS URLs via the open YouTube tab (no native host).
// Safari / Chrome with native host installed: fall back to yt-dlp on the watch-page URL.
async function runYoutubeJob(job) {
  try {
    ensureNotCancelled(job);
    if (usesChromeDownloads()) {
      update(job, { state: "running", progress: 0, message: "resolving stream…" });
      const candidates = await collectYoutubeStreamCandidates(job);
      let lastError = null;
      for (let i = 0; i < candidates.length; i++) {
        const picked = candidates[i];
        try {
          job.url = picked.url;
          job.youtubeFetch = true;
          update(job, {
            state: "running",
            progress: 0,
            message: i === 0
              ? `downloading (${picked.source || picked.kind})…`
              : `retrying (${picked.source || picked.kind})…`
          });
          if (picked.kind === "stream") {
            await runStreamJob(job, { rethrow: true });
          } else {
            await runDirectJob(job, { rethrow: true });
          }
          return;
        } catch (e) {
          if (wasCancelled(job, e)) throw e;
          lastError = e;
          if (!/403/.test(e.message)) throw e;
        }
      }
      if (candidates.length === 0) {
        throw new Error("No stream captured — play the video for a few seconds, then try again.");
      }
      if (lastError && !/403/.test(lastError.message)) throw lastError;
    }
    if (!(await nativeHostReachable())) {
      throw new Error(
        usesChromeDownloads()
          ? "Tab download failed and YouTube helper is unavailable. Play the video and retry, or reinstall the native helper."
          : "YouTube helper is unavailable."
      );
    }
    if (!job.watchUrl) {
      const watchUrl = resolveYtDlpWatchUrl(job);
      if (watchUrl) job.watchUrl = watchUrl;
    }
    if (job.watchUrl) job.url = job.watchUrl;
    update(job, { state: "running", progress: 0, message: "starting yt-dlp…" });
    await runYtDlpNativeJob(job);
  } catch (e) {
    if (wasCancelled(job, e)) update(job, { state: "cancelled", message: "Cancelled" });
    else if (usesChromeDownloads() && isNativeHostExitedError(e.message)) {
      update(job, {
        state: "error",
        message: `ERROR: YouTube helper crashed. Quit Chrome, run: chrome-extension/native-host/install-native-host.sh YOUR_EXTENSION_ID — then reopen Chrome.`
      });
    } else if (usesChromeDownloads() && isNativeHostMissingError(e.message)) {
      update(job, {
        state: "error",
        message: `ERROR: Play the video for a few seconds, then try again. ${nativeHostHelpMessage()}`
      });
    } else if (usesChromeDownloads() && /403/.test(e.message)) {
      update(job, {
        state: "error",
        message: `ERROR: Stream expired — play the video for a few seconds, then try again. ${nativeHostHelpMessage()}`
      });
    } else update(job, { state: "error", message: `ERROR: ${e.message}` });
  } finally {
    delete controllers[job.id];
  }
}

// Platform CDN URLs are session-locked and return 403 outside the player.
// Always use the watch-page URL with bundled yt-dlp.
async function runYtDlpJob(job) {
  try {
    ensureNotCancelled(job);
    if (!job.watchUrl) {
      const watchUrl = resolveYtDlpWatchUrl(job);
      if (watchUrl) job.watchUrl = watchUrl;
    }
    update(job, { state: "running", progress: 0, message: "starting yt-dlp…" });
    await runYtDlpNativeJob(job);
  } catch (e) {
    if (wasCancelled(job, e)) update(job, { state: "cancelled", message: "Cancelled" });
    else if (usesChromeDownloads() && isNativeHostMissingError(e.message)) {
      update(job, { state: "error", message: `ERROR: ${nativeHostHelpMessage()}` });
    } else update(job, { state: "error", message: `ERROR: ${e.message}` });
  } finally {
    delete controllers[job.id];
  }
}

// Run multiple downloads in parallel (capped to limit peak memory use).
const MAX_PARALLEL_JOBS = 4;
const pendingQueue = [];
let activeRunners = 0;

function drainJobQueue() {
  while (activeRunners < MAX_PARALLEL_JOBS && pendingQueue.length > 0) {
    const job = pendingQueue.shift();
    if (job.cancelled) {
      update(job, { state: "cancelled", message: "Cancelled" });
      delete controllers[job.id];
      continue;
    }
    activeRunners++;
    const runner = job._runner;
    Promise.resolve(runner(job)).finally(() => {
      activeRunners--;
      drainJobQueue();
    });
  }
}

function enqueueJob(job, runner) {
  job._runner = runner;
  pendingQueue.push(job);
  drainJobQueue();
}

function removeQueuedJob(jobId) {
  const idx = pendingQueue.findIndex((j) => j.id === jobId);
  if (idx < 0) return false;
  pendingQueue.splice(idx, 1);
  return true;
}

function startJob(kind, url, filename, tabId, options) {
  const job = { id: ++jobSeq, url, filename, kind, tabId, state: "queued", progress: 0, message: "queued", cancelled: false };
  if (kind === "youtube" || kind === "tiktok" || kind === "twitter" || kind === "instagram") {
    if (kind === "youtube") {
      if (isYoutubeWatchUrl(url)) job.watchUrl = normalizeYoutubeUrl(url);
      else if (tabId != null && youtubePages[tabId]) job.watchUrl = youtubePages[tabId];
    } else if (kind === "tiktok") {
      if (isTikTokWatchUrl(url)) job.watchUrl = normalizeTikTokUrl(url);
      else if (tabId != null && tiktokPages[tabId]) job.watchUrl = tiktokPages[tabId];
    } else if (kind === "twitter") {
      if (isTwitterWatchUrl(url)) job.watchUrl = normalizeTwitterUrl(url);
      else if (tabId != null && twitterPages[tabId]) job.watchUrl = twitterPages[tabId];
    } else {
      if (isInstagramWatchUrl(url)) job.watchUrl = normalizeInstagramUrl(url);
      else if (tabId != null && instagramPages[tabId]) job.watchUrl = instagramPages[tabId];
    }
    if (job.watchUrl) job.url = job.watchUrl;
    job.quality = (options && options.quality === "best") ? "best" : "normal";
  }
  jobs[job.id] = job;
  controllers[job.id] = new AbortController();
  const runner = kind === "stream" ? runStreamJob
    : kind === "youtube" ? runYoutubeJob
    : (kind === "tiktok" || kind === "twitter" || kind === "instagram") ? runYtDlpJob
    : runDirectJob;
  enqueueJob(job, runner);
  return job;
}

function cancelJob(jobId) {
  const job = jobs[jobId];
  if (!job) return;
  if (job.state === "done" || job.state === "error" || job.state === "cancelled") return;
  job.cancelled = true;
  const ctrl = controllers[jobId];
  if (ctrl) ctrl.abort();
  if (removeQueuedJob(jobId) || job.state === "queued") {
    update(job, { state: "cancelled", message: "Cancelled" });
    delete controllers[job.id];
    return;
  }
  update(job, { message: "cancelling…" });
}

// Handle messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadStream") {
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    const job = startJob("stream", request.url, request.filename, tabId);
    if (request.socialFetch) job.socialFetch = true;
    if (request.tabFetch) job.tabFetch = true;
    sendResponse({ ok: true, jobId: job.id });
  } else if (request.action === "downloadDirect") {
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    const job = startJob("direct", request.url, request.filename, tabId);
    if (request.socialFetch) job.socialFetch = true;
    if (request.tabFetch) job.tabFetch = true;
    if (request.imageDownload) job.imageDownload = true;
    sendResponse({ ok: true, jobId: job.id });
  } else if (request.action === "downloadYoutube") {
    const job = startJob("youtube", request.url, request.filename, request.tabId, { quality: request.quality });
    sendResponse({ ok: true, jobId: job.id });
  } else if (request.action === "downloadTikTok") {
    const job = startJob("tiktok", request.url, request.filename, request.tabId, { quality: request.quality });
    sendResponse({ ok: true, jobId: job.id });
  } else if (request.action === "downloadSocial") {
    const platform = request.platform || "tiktok";
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    const job = startJob(platform, request.url, request.filename, tabId, { quality: request.quality });
    sendResponse({ ok: true, jobId: job.id });
  } else if (request.action === "cancelJob") {
    cancelJob(request.jobId);
    sendResponse({ ok: true });
  } else if (request.action === "injectPageScript") {
    const tabId = sender.tab && sender.tab.id;
    const file = request.file;
    if (tabId == null || !file || !chrome.scripting || !chrome.scripting.executeScript) {
      sendResponse({ ok: false, error: "inject-unavailable" });
      return true;
    }
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      files: [file]
    }).then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true;
  } else if (request.action === "getTabId") {
    sendResponse({ tabId: sender.tab && sender.tab.id != null ? sender.tab.id : null });
    return true;
  } else if (request.action === "getJobs") {
    sendResponse({ jobs: Object.values(jobs) });
  } else if (request.action === "getVideos") {
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    sendResponse({
      videos: Array.from(detectedVideos[tabId] || []),
      youtubeUrl: youtubePages[tabId] || null,
      tiktokUrl: tiktokPages[tabId] || null,
      twitterUrl: twitterPages[tabId] || null
    });
  } else if (request.action === "clearVideos") {
    const tabId = request.tabId;
    if (detectedVideos[tabId]) detectedVideos[tabId].clear();
    delete youtubePages[tabId];
    delete tiktokPages[tabId];
    delete twitterPages[tabId];
    delete instagramPages[tabId];
  } else if (request.action === "socialPage") {
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    if (tabId != null && request.url && request.platform) {
      storeSocialPageUrl(tabId, request.url);
    }
  } else if (request.action === "youtubePage" || request.action === "setYoutubePage") {
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    if (tabId != null && request.url) youtubePages[tabId] = normalizeYoutubeUrl(request.url);
  } else if (request.action === "tiktokPage" || request.action === "setTikTokPage") {
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    if (tabId != null && request.url) tiktokPages[tabId] = normalizeTikTokUrl(request.url);
  } else if (request.action === "youtubeStreamCaptured") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null && request.url) {
      youtubeStreamStore(tabId).add(request.url);
      if (!detectedVideos[tabId]) detectedVideos[tabId] = new Set();
      detectedVideos[tabId].add(request.url);
    }
  } else if (request.action === "videosFound") {
    const tabId = sender.tab.id;
    if (!detectedVideos[tabId]) detectedVideos[tabId] = new Set();
    request.videos.forEach((v) => detectedVideos[tabId].add(v));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedVideos[tabId];
  delete youtubePages[tabId];
  delete tiktokPages[tabId];
  delete twitterPages[tabId];
  delete instagramPages[tabId];
  delete youtubeStreamUrls[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    delete detectedVideos[tabId];
    delete youtubePages[tabId];
    delete tiktokPages[tabId];
    delete twitterPages[tabId];
    delete instagramPages[tabId];
    delete youtubeStreamUrls[tabId];
  }
  const url = changeInfo.url || (changeInfo.status === "complete" && tab && tab.url);
  if (url) {
    storeSocialPageUrl(tabId, url);
    if (isYoutubeWatchUrl(url)) youtubePages[tabId] = normalizeYoutubeUrl(url);
  }
});
