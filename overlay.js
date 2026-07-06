// Hover-follow save button for social sites and generic page videos.
(function () {
  const BTN_ID = "downpour-save-btn";
  const STYLE_ID = "downpour-save-style";
  const MIN_SIDE = 160;

  let tracked = [];
  let btn = null;
  let currentMedia = null;
  let hideTimer = null;
  let pending = null;
  let platform = null;
  let contentTabId = null;
  let jobPollTimer = null;
  const mediaJobs = new WeakMap();
  const activeMedia = new Set();
  const finishTimers = new WeakMap();

  const ICONS = {
    download:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 0 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20.3 6.3a1 1 0 0 1 0 1.4l-9.5 9.5a1 1 0 0 1-1.4 0l-4.7-4.7a1 1 0 1 1 1.4-1.4l4 4 8.8-8.8a1 1 0 0 1 1.4 0Z"/></svg>',
    error:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 12.1a1 1 0 0 1-1.4 1.4L12 13.4l-2.1 2.1a1 1 0 1 1-1.4-1.4l2.1-2.1-2.1-2.1a1 1 0 1 1 1.4-1.4l2.1 2.1 2.1-2.1a1 1 0 0 1 1.4 1.4L13.4 12l2.1 2.1Z"/></svg>',
    cancel:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8.3 7.7a1 1 0 0 1 1.4 0L12 10.1l2.3-2.4a1 1 0 1 1 1.4 1.4L13.4 12l2.3 2.3a1 1 0 0 1-1.4 1.4L12 13.4l-2.3 2.3a1 1 0 1 1-1.4-1.4l2.3-2.3-2.3-2.3a1 1 0 0 1 0-1.4Z"/></svg>'
  };

  function currentPlatform() {
    return DownpourPlatforms.getOverlayPlatform(location.href);
  }

  function isGenericPlatform() {
    return platform === "generic";
  }

  function usesTabFetch() {
    return isGenericPlatform();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${BTN_ID} {
  position: fixed;
  z-index: 2147483646;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  -webkit-backdrop-filter: blur(8px) saturate(140%);
  backdrop-filter: blur(8px) saturate(140%);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transform: translateY(-4px) scale(0.9);
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease, background-color 0.16s ease;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${BTN_ID}.downpour-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
#${BTN_ID}:hover {
  background: rgba(0, 0, 0, 0.72);
  transform: translateY(0) scale(1.06);
}
#${BTN_ID}:active { transform: translateY(0) scale(0.96); }
#${BTN_ID} svg { display: block; }
#${BTN_ID}.downpour-success { background: rgba(34, 160, 90, 0.9); opacity: 1; }
#${BTN_ID}.downpour-error { background: rgba(214, 41, 75, 0.9); opacity: 1; }
#${BTN_ID}.downpour-loading { background: rgba(0, 0, 0, 0.62); opacity: 1; }
#${BTN_ID}.downpour-cancellable { cursor: pointer; }
#${BTN_ID}.downpour-cancellable:hover { background: rgba(214, 41, 75, 0.82); }
.downpour-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: downpour-spin 0.7s linear infinite;
}
@keyframes downpour-spin { to { transform: rotate(360deg); } }
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function isProfilePic(el) {
    const alt = (el.getAttribute("alt") || "").toLowerCase();
    return alt.includes("profile picture");
  }

  function largeEnough(el) {
    const r = el.getBoundingClientRect();
    return r.width >= MIN_SIDE && r.height >= MIN_SIDE;
  }

  function instagramCdnHint(el) {
    const parts = [
      el.currentSrc,
      el.src,
      el.getAttribute("src"),
      el.getAttribute("data-src"),
      el.getAttribute("srcset")
    ].filter(Boolean);
    for (const part of parts) {
      if (/(?:cdninstagram|fbcdn)/i.test(part)) return true;
      const urls = String(part).split(/\s*,\s*/);
      for (const entry of urls) {
        const url = entry.trim().split(/\s+/)[0];
        if (url && /(?:cdninstagram|fbcdn)/i.test(url)) return true;
      }
    }
    return false;
  }

  function isDecorativeVideo(el) {
    if (!el || el.tagName !== "VIDEO") return false;
    if (el.getAttribute("aria-hidden") === "true") return true;
    const hint = `${el.id || ""} ${el.className || ""}`.toLowerCase();
    if (/banner|advert|advertisement|preroll|companion|promo-ad/.test(hint)) return true;
    return false;
  }

  function qualifies(el) {
    if (!platform) return false;

    if (platform === "instagram") {
      if (el.tagName === "VIDEO") return largeEnough(el);
      if (el.tagName === "IMG") {
        if (isProfilePic(el)) return false;
        if (!instagramCdnHint(el)) return false;
        return largeEnough(el);
      }
      return false;
    }

    if (el.tagName !== "VIDEO") return false;
    if (!largeEnough(el)) return false;
    if (isGenericPlatform() && isDecorativeVideo(el)) return false;
    return true;
  }

  function rescan() {
    const next = [];
    const selector = platform === "instagram" ? "img, video" : "video";
    document.querySelectorAll(selector).forEach((el) => {
      if (qualifies(el)) next.push(el);
    });
    tracked = next;
  }

  function buildButton() {
    if (btn) return;
    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.setAttribute("aria-label", "Save media");
    btn.innerHTML = ICONS.download;
    btn.addEventListener("click", onDownloadClick);
    btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    document.body.appendChild(btn);
  }

  function setState(state, title) {
    if (!btn) return;
    btn.classList.remove("downpour-loading", "downpour-cancellable", "downpour-success", "downpour-error");
    if (state === "loading") {
      btn.classList.add("downpour-loading");
      const cancelling = /cancell/i.test(title || "");
      if (cancelling) {
        btn.innerHTML = '<span class="downpour-spinner"></span>';
        btn.setAttribute("aria-label", "Cancelling download");
        btn.title = title || "Cancelling…";
      } else {
        btn.classList.add("downpour-cancellable");
        btn.innerHTML = ICONS.cancel;
        btn.setAttribute("aria-label", "Cancel download");
        btn.title = title && title !== "Saving…" ? `${title} — click to cancel` : "Click to cancel";
      }
    } else if (state === "success") {
      btn.classList.add("downpour-success");
      btn.innerHTML = ICONS.check;
    } else if (state === "error") {
      btn.classList.add("downpour-error");
      btn.innerHTML = ICONS.error;
    } else {
      btn.innerHTML = ICONS.download;
      btn.setAttribute("aria-label", "Save media");
      if (title) btn.title = title;
    }
  }

  function createJobRef() {
    return {
      saveGen: 0,
      jobId: null,
      cdnUrl: null,
      pageUrl: null,
      altUrls: [],
      altIndex: 0,
      cancelRequested: false,
      status: "idle",
      progress: "",
      handledFailureId: null,
      ytDlpTried: false,
      twitterM3u8Tried: false
    };
  }

  function isCurrentSave(ref, gen) {
    return !!ref && ref.saveGen === gen;
  }

  function abortIfCancelled(media, ref, gen) {
    if (!isCurrentSave(ref, gen) || !ref.cancelRequested) return false;
    resetAfterCancel(media, ref);
    return true;
  }

  function jobRefFor(media) {
    return media ? mediaJobs.get(media) : null;
  }

  function ensureJobRef(media) {
    let ref = mediaJobs.get(media);
    if (!ref) {
      ref = createJobRef();
      mediaJobs.set(media, ref);
    }
    return ref;
  }

  function mediaForJobId(jobId) {
    for (const media of activeMedia) {
      const ref = mediaJobs.get(media);
      if (ref && ref.jobId === jobId) return media;
    }
    return null;
  }

  function isMediaActive(media) {
    const ref = jobRefFor(media);
    return !!ref && (ref.status === "starting" || ref.status === "running");
  }

  function reflectMediaState(media) {
    if (!btn || media !== currentMedia) return;
    const ref = jobRefFor(media);
    if (!ref || ref.status === "idle") {
      setState("idle", "Save");
      return;
    }
    if (ref.cancelRequested) {
      setState("loading", "Cancelling…");
      return;
    }
    if (ref.status === "starting") {
      setState("loading", "Saving…");
      return;
    }
    if (ref.status === "running") {
      setState("loading", ref.progress || "Saving…");
      return;
    }
    if (ref.status === "success") setState("success", "Saved");
    else if (ref.status === "error") setState("error", ref.progress || "Save failed");
    else setState("idle", "Save");
  }

  function shouldAbortSave(ref) {
    return !!(ref && ref.cancelRequested);
  }

  function onJobStarted(jobId, media, ref, gen) {
    if (jobId == null || !isCurrentSave(ref, gen)) return;
    ref.jobId = jobId;
    if (ref.cancelRequested) {
      chrome.runtime.sendMessage({ action: "cancelJob", jobId }, () => {});
      resetAfterCancel(media, ref);
      return;
    }
    ref.status = "running";
    activeMedia.add(media);
    reflectMediaState(media);
    startJobPoll();
  }

  function requestCancel(media, ref) {
    if (!ref || !isMediaActive(media) || ref.cancelRequested) return;
    ref.cancelRequested = true;
    reflectMediaState(media);
    if (ref.jobId != null) {
      chrome.runtime.sendMessage({ action: "cancelJob", jobId: ref.jobId }, () => {});
    }
  }

  function resetAfterCancel(media, ref) {
    if (ref) {
      ref.cancelRequested = false;
      ref.status = "idle";
      ref.jobId = null;
      ref.cdnUrl = null;
      ref.pageUrl = null;
      ref.altUrls = [];
      ref.altIndex = 0;
      ref.progress = "";
      ref.handledFailureId = null;
      ref.ytDlpTried = false;
      ref.twitterM3u8Tried = false;
    }
    activeMedia.delete(media);
    if (activeMedia.size === 0) stopJobPoll();
    reflectMediaState(media);
  }

  function positionFor(media) {
    if (!btn || !media) return false;
    const r = media.getBoundingClientRect();
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const size = 38;
    const pad = 12;
    btn.style.left = Math.round(r.right - size - pad) + "px";
    btn.style.top = Math.round(r.top + pad) + "px";
    return true;
  }

  function showFor(media) {
    if (!btn) return;
    currentMedia = media;
    if (positionFor(media)) {
      btn.classList.add("downpour-visible");
      reflectMediaState(media);
    }
  }

  function hide() {
    if (!btn) return;
    const media = currentMedia;
    if (media) {
      const timer = finishTimers.get(media);
      if (timer) {
        clearTimeout(timer);
        finishTimers.delete(media);
      }
      const ref = jobRefFor(media);
      if (ref && (ref.status === "success" || ref.status === "error")) {
        resetAfterCancel(media, ref);
      }
    }
    btn.classList.remove("downpour-visible");
    setState("idle");
    currentMedia = null;
  }

  function visibleVideoHeight(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    return Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  }

  function tikTokVideoForPointer(x, y) {
    const feedItem = DownpourPlatforms.getViewportFeedItem();
    if (feedItem) {
      const fr = feedItem.getBoundingClientRect();
      if (x >= fr.left && x <= fr.right && y >= fr.top && y <= fr.bottom) {
        let best = null;
        let bestScore = -1;
        for (const el of tracked) {
          if (!el.isConnected) continue;
          const r = el.getBoundingClientRect();
          if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
          const visible = visibleVideoHeight(el);
          if (visible < window.innerHeight * 0.45) continue;
          const centerDist = Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2);
          const score = visible * 2 - centerDist;
          if (score > bestScore) {
            bestScore = score;
            best = el;
          }
        }
        if (best) return best;
      }
    }
    return null;
  }

  function mediaAtPoint(x, y) {
    if (platform === "tiktok") {
      const tt = tikTokVideoForPointer(x, y);
      if (tt) return tt;
    }

    if (platform === "tiktok") {
      let best = null;
      let bestScore = -1;
      for (const el of tracked) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const visible = visibleVideoHeight(el);
        if (visible < window.innerHeight * 0.45) continue;
        const centerDist = Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2);
        const score = visible * 2 - centerDist;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
      return best;
    }

    // Instagram / X: smallest tracked rect under the cursor (front-most).
    let best = null;
    let bestArea = Infinity;
    for (const el of tracked) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  function onPointerMove(e) {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      const onBtn = e.target === btn || (btn && btn.contains(e.target));
      if (onBtn) {
        clearTimeout(hideTimer);
        return;
      }
      const media = mediaAtPoint(e.clientX, e.clientY);
      if (media) {
        clearTimeout(hideTimer);
        showFor(media);
      } else if (currentMedia) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 120);
      }
    });
  }

  function onScroll() {
    if (!currentMedia) return;
    if (!currentMedia.isConnected || !positionFor(currentMedia)) {
      hide();
      return;
    }
    if (btn && btn.classList.contains("downpour-visible")) reflectMediaState(currentMedia);
  }

  function resolveTabId(cb) {
    if (contentTabId != null) {
      cb(contentTabId);
      return;
    }
    chrome.runtime.sendMessage({ action: "getTabId" }, (resp) => {
      if (!chrome.runtime.lastError && resp && resp.tabId != null) contentTabId = resp.tabId;
      cb(contentTabId);
    });
  }

  function stopJobPoll() {
    if (jobPollTimer) {
      clearInterval(jobPollTimer);
      jobPollTimer = null;
    }
  }

  function startJobPoll() {
    if (jobPollTimer) return;
    jobPollTimer = setInterval(() => {
      if (activeMedia.size === 0) {
        stopJobPoll();
        return;
      }
      chrome.runtime.sendMessage({ action: "getJobs" }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.jobs) return;
        for (const media of Array.from(activeMedia)) {
          const ref = mediaJobs.get(media);
          if (!ref || ref.jobId == null) continue;
          const job = resp.jobs.find((j) => j.id === ref.jobId);
          if (job) syncJob(job, media, ref);
        }
      });
    }, 700);
  }

  function startYtDlp(pageUrl, mediaEl, ref, gen) {
    if (abortIfCancelled(mediaEl, ref, gen)) return;
    const normalized = DownpourPlatforms.normalizeSocialPageUrl(platform, pageUrl);
    ref.pageUrl = normalized;
    ref.cdnUrl = null;
    resolveTabId((tabId) => {
      if (!isCurrentSave(ref, gen)) return;
      chrome.runtime.sendMessage({
        action: "downloadSocial",
        platform,
        url: normalized,
        filename: DownpourPlatforms.makeSocialFilename(platform),
        quality: "normal",
        tabId
      }, (resp) => {
        if (!isCurrentSave(ref, gen)) return;
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          failSave(mediaEl, ref, "Save failed", gen);
          return;
        }
        onJobStarted(resp.jobId, mediaEl, ref, gen);
      });
    });
  }

  function startStreamDownload(url, filename, mediaEl, ref, gen) {
    if (abortIfCancelled(mediaEl, ref, gen)) return;
    ref.cdnUrl = url;
    ref.pageUrl = null;
    const socialFetch = !isGenericPlatform();
    const tabFetch = usesTabFetch();
    resolveTabId((tabId) => {
      if (!isCurrentSave(ref, gen)) return;
      chrome.runtime.sendMessage({
        action: "downloadStream",
        url,
        filename,
        socialFetch,
        tabFetch,
        tabId
      }, (resp) => {
      if (!isCurrentSave(ref, gen)) return;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        const pageUrl = isGenericPlatform() ? null : DownpourPlatforms.resolveSocialPageUrlForVideo(platform, mediaEl);
        if (pageUrl && !ref.ytDlpTried) {
          ref.ytDlpTried = true;
          ref.progress = "Trying alternate…";
          reflectMediaState(mediaEl);
          startYtDlp(pageUrl, mediaEl, ref, gen);
          return;
        }
        failSave(mediaEl, ref, "Save failed", gen);
        return;
      }
      onJobStarted(resp.jobId, mediaEl, ref, gen);
    });
    });
  }

  function tryAlternateSave(mediaEl, ref, failedJobId) {
    if (shouldAbortSave(ref)) return false;
    if (failedJobId != null) {
      if (ref.handledFailureId === failedJobId) return false;
      ref.handledFailureId = failedJobId;
      ref.jobId = null;
      ref.status = "starting";
    }
    if (platform === "instagram" && mediaEl && mediaEl.tagName === "IMG") {
      return false;
    }
    if (isGenericPlatform() && mediaEl) {
      while (ref.altIndex < (ref.altUrls || []).length) {
        const alt = ref.altUrls[ref.altIndex++];
        if (!alt || alt === ref.cdnUrl || !DownpourPlatforms.isLikelyVideoResource(alt)) continue;
        ref.progress = "Trying alternate…";
        reflectMediaState(mediaEl);
        if (DownpourPlatforms.isStreamMediaUrl(alt)) {
          startStreamDownload(alt, DownpourPlatforms.makeGenericFilename(alt), mediaEl, ref, ref.saveGen);
        } else {
          startDirectDownload(alt, DownpourPlatforms.makeGenericFilename(alt), mediaEl, ref);
        }
        return true;
      }
    }
    if (platform === "tiktok" && mediaEl) {
      while (ref.altIndex < (ref.altUrls || []).length) {
        const alt = ref.altUrls[ref.altIndex++];
        if (!alt || alt === ref.cdnUrl || !DownpourPlatforms.isTikTokMp4Url(alt)) continue;
        ref.progress = "Trying alternate…";
        reflectMediaState(mediaEl);
        startDirectDownload(alt, DownpourPlatforms.makeSocialFilename(platform), mediaEl, ref);
        return true;
      }
      const pageUrl = ref.pageUrl
        || DownpourPlatforms.resolveSocialPageUrlForVideo("tiktok", mediaEl);
      if (pageUrl && !ref.ytDlpTried) {
        ref.ytDlpTried = true;
        ref.progress = "Trying alternate…";
        reflectMediaState(mediaEl);
        startYtDlp(pageUrl, mediaEl, ref, ref.saveGen);
        return true;
      }
    }
    if (platform === "twitter" && mediaEl) {
      const m3u8 = DownpourPlatforms.pickTwitterM3u8(mediaEl);
      if (m3u8 && !ref.twitterM3u8Tried) {
        ref.twitterM3u8Tried = true;
        ref.progress = "Trying stream…";
        reflectMediaState(mediaEl);
        startStreamDownload(m3u8, DownpourPlatforms.makeSocialFilename(platform), mediaEl, ref, ref.saveGen);
        return true;
      }
    }
    const pageUrl = DownpourPlatforms.resolveSocialPageUrlForVideo(platform, mediaEl);
    if (pageUrl && !ref.ytDlpTried) {
      ref.ytDlpTried = true;
      ref.progress = "Trying alternate…";
      reflectMediaState(mediaEl);
      startYtDlp(pageUrl, mediaEl, ref, ref.saveGen);
      return true;
    }
    return false;
  }

  function startDirectDownload(url, filename, mediaEl, ref, options) {
    const gen = ref.saveGen;
    if (abortIfCancelled(mediaEl, ref, gen)) return;
    ref.cdnUrl = url;
    ref.pageUrl = null;
    const socialFetch = !isGenericPlatform();
    const tabFetch = usesTabFetch();
    const imageDownload = !!(options && options.imageDownload);
    resolveTabId((tabId) => {
      if (!isCurrentSave(ref, gen)) return;
      chrome.runtime.sendMessage({
        action: "downloadDirect",
        url,
        filename,
        socialFetch,
        tabFetch,
        imageDownload,
        tabId
      }, (resp) => {
      if (!isCurrentSave(ref, gen)) return;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        if (!tryAlternateSave(mediaEl, ref)) {
          failSave(mediaEl, ref, "Save failed", gen);
        }
        return;
      }
      onJobStarted(resp.jobId, mediaEl, ref, gen);
    });
    });
  }

  async function saveInstagram(mediaEl, ref, gen) {
    DownpourInstagram.tagElement(mediaEl);
    const { url, type, error } = await DownpourInstagram.extractMediaUrl(mediaEl);
    if (abortIfCancelled(mediaEl, ref, gen)) return;
    if (!url) throw new Error(error || "no-url");

    const isImage = mediaEl.tagName === "IMG" || type === "image";
    if (isImage) {
      startDirectDownload(
        url,
        DownpourInstagram.makeFilename(url, "image"),
        mediaEl,
        ref,
        { imageDownload: true }
      );
      return;
    }
    if (type === "video" && /\.mp4/i.test(url)) {
      startDirectDownload(url, DownpourInstagram.makeFilename(url, type), mediaEl, ref);
      return;
    }

    const pageUrl = DownpourPlatforms.resolveSocialPageUrlForVideo("instagram", mediaEl);
    if (!pageUrl) throw new Error("no-page-url");
    startYtDlp(pageUrl, mediaEl, ref, gen);
  }

  function requestTabVideoState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getVideos" }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          resolve({ videos: [], tiktokUrl: null, twitterUrl: null });
          return;
        }
        resolve(resp);
      });
    });
  }

  async function saveTikTok(mediaEl, ref, gen) {
    const filename = DownpourPlatforms.makeSocialFilename("tiktok");
    let extracted = { pageUrl: "", cdnUrl: "", streamUrl: "", altUrls: [], videoId: "", error: "", debug: {} };

    if (typeof DownpourTikTok !== "undefined") {
      DownpourTikTok.tagElement(mediaEl);
      extracted = await DownpourTikTok.extractForVideo(mediaEl);
    }
    if (abortIfCancelled(mediaEl, ref, gen)) return;

    ref.altUrls = extracted.altUrls || [];
    ref.altIndex = 0;
    const videoId = extracted.videoId
      || DownpourPlatforms.getTikTokVideoIdFromElement(mediaEl)
      || extracted.debug?.videoId
      || "";
    const viewportFeed = DownpourPlatforms.getViewportFeedItem();
    ref.pageUrl = extracted.pageUrl
      || DownpourPlatforms.pageUrlFromTikTokElement(mediaEl, videoId)
      || DownpourPlatforms.pageUrlFromTikTokFeedItem(viewportFeed, videoId)
      || DownpourPlatforms.resolveSocialPageUrlForVideo("tiktok", mediaEl);

    if (extracted.cdnUrl && DownpourPlatforms.isTikTokMp4Url(extracted.cdnUrl)) {
      startDirectDownload(extracted.cdnUrl, filename, mediaEl, ref);
      return;
    }
    if (extracted.streamUrl && DownpourPlatforms.isTikTokM3u8Url(extracted.streamUrl)) {
      startStreamDownload(extracted.streamUrl, filename, mediaEl, ref, gen);
      return;
    }

    const ttCdn = DownpourPlatforms.pickTikTokCdnUrl(mediaEl);
    if (ttCdn) {
      startDirectDownload(ttCdn, filename, mediaEl, ref);
      return;
    }

    if (ref.pageUrl) {
      startYtDlp(ref.pageUrl, mediaEl, ref, gen);
      return;
    }

    throw new Error(extracted.error || "no-page-url");
  }

  async function saveGeneric(mediaEl, ref, gen) {
    const tabState = await requestTabVideoState();
    if (abortIfCancelled(mediaEl, ref, gen)) return;
    let picked = DownpourPlatforms.pickGenericVideoUrl(mediaEl, tabState.videos);
    if ((!picked || !picked.url) && DownpourPlatforms.isEromeHost(location.href)) {
      const eromeUrls = DownpourPlatforms.collectEromeVideoUrls(mediaEl);
      if (eromeUrls.length) {
        picked = { type: "direct", url: eromeUrls[0], altUrls: eromeUrls.slice(1) };
      }
    }
    if (!picked || !picked.url) throw new Error("no-url");

    ref.altUrls = picked.altUrls || [];
    ref.altIndex = 0;
    const filename = DownpourPlatforms.makeGenericFilename(picked.url);

    if (picked.type === "stream") {
      startStreamDownload(picked.url, filename, mediaEl, ref, gen);
      return;
    }
    startDirectDownload(picked.url, filename, mediaEl, ref);
  }

  async function saveVideoPlatform(mediaEl, ref, gen) {
    const filename = DownpourPlatforms.makeSocialFilename(platform);
    let extracted = { pageUrl: "", cdnUrl: "", streamUrl: "", error: "" };

    if (typeof DownpourSocial !== "undefined" && DownpourSocial.isActive()) {
      extracted = await DownpourSocial.extractForVideo(mediaEl, platform);
    }
    if (abortIfCancelled(mediaEl, ref, gen)) return;

    if (platform === "twitter") {
      if (extracted.streamUrl && /\.m3u8/i.test(extracted.streamUrl)) {
        startStreamDownload(extracted.streamUrl, filename, mediaEl, ref, gen);
        return;
      }
      if (extracted.cdnUrl && DownpourPlatforms.isUsableTwitterMp4(extracted.cdnUrl)) {
        startDirectDownload(extracted.cdnUrl, filename, mediaEl, ref);
        return;
      }
    }

    let pageUrl = extracted.pageUrl
      || DownpourPlatforms.resolveSocialPageUrlForVideo(platform, mediaEl)
      || DownpourPlatforms.resolveSocialPageUrl(platform);

    const tabState = await requestTabVideoState();
    if (abortIfCancelled(mediaEl, ref, gen)) return;
    if (!pageUrl && platform === "twitter" && tabState.twitterUrl) pageUrl = tabState.twitterUrl;

    if (platform === "twitter") {
      const m3u8 = DownpourPlatforms.pickTwitterM3u8(mediaEl)
        || (tabState.videos || []).filter((u) => /\.m3u8/i.test(u) && /twimg\.com/i.test(u)).pop();
      if (m3u8) {
        startStreamDownload(m3u8, filename, mediaEl, ref, gen);
        return;
      }
    }

    const cdnUrl = DownpourPlatforms.pickDirectCdnUrl(platform, mediaEl)
      || (tabState.videos || []).filter((u) => {
        if (platform === "twitter") return DownpourPlatforms.isUsableTwitterMp4(u);
        return false;
      }).pop();

    if (cdnUrl) {
      startDirectDownload(cdnUrl, filename, mediaEl, ref);
      return;
    }

    if (pageUrl) {
      startYtDlp(pageUrl, mediaEl, ref, gen);
      return;
    }

    throw new Error(extracted.error || "no-page-url");
  }

  async function onDownloadClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!currentMedia) return;

    const media = currentMedia;
    const ref = ensureJobRef(media);

    if (isMediaActive(media)) {
      requestCancel(media, ref);
      return;
    }

    const gen = (ref.saveGen || 0) + 1;
    Object.assign(ref, createJobRef(), { saveGen: gen });
    mediaJobs.set(media, ref);
    ref.status = "starting";
    activeMedia.add(media);
    reflectMediaState(media);

    try {
      if (platform === "instagram") {
        await saveInstagram(media, ref, gen);
      } else if (platform === "tiktok") {
        await saveTikTok(media, ref, gen);
      } else if (platform === "twitter") {
        await saveVideoPlatform(media, ref, gen);
      } else if (platform === "generic") {
        await saveGeneric(media, ref, gen);
      }
    } catch (err) {
      if (!isCurrentSave(ref, gen)) return;
      if (shouldAbortSave(ref)) {
        resetAfterCancel(media, ref);
        return;
      }
      console.warn("[Downpour]", err);
      const msg = err && (err.message === "no-page-url" || err.message === "no-url")
        ? "Play video first"
        : "Save failed";
      ref.status = "error";
      ref.progress = msg;
      reflectMediaState(media);
      finishInteraction(media, ref, false, gen);
    }
  }

  function failSave(media, ref, msg, gen) {
    if (!isCurrentSave(ref, gen)) return;
    ref.status = "error";
    ref.progress = msg || "Save failed";
    reflectMediaState(media);
    finishInteraction(media, ref, false, gen);
  }

  function finishInteraction(media, ref, immediate, gen) {
    if (!isCurrentSave(ref, gen)) return;
    if (ref.status === "running") ref.status = "success";
    const prev = finishTimers.get(media);
    if (prev) clearTimeout(prev);
    const delay = immediate ? 0 : 1400;
    const timer = setTimeout(() => {
      finishTimers.delete(media);
      if (!isCurrentSave(ref, gen)) return;
      resetAfterCancel(media, ref);
      if (currentMedia === media) hide();
    }, delay);
    finishTimers.set(media, timer);
  }

  function jobUrlsMatch(job, ref) {
    const targets = [job.url, job.watchUrl].filter(Boolean);
    const refs = [ref.pageUrl, ref.cdnUrl].filter(Boolean);
    if (ref.jobId != null && job.id === ref.jobId) return true;
    for (const target of targets) {
      for (const r of refs) {
        if (target === r) return true;
        const norm = DownpourPlatforms.normalizeSocialPageUrl(platform, target);
        if (norm && norm === r) return true;
      }
    }
    return false;
  }

  function syncJob(job, media, ref) {
    if (!job || !ref || !media) return;
    if (!jobUrlsMatch(job, ref)) return;

    if (job.state === "done") {
      ref.status = "success";
      reflectMediaState(media);
      finishInteraction(media, ref, false, ref.saveGen);
    } else if (job.state === "error") {
      const msg = job.message || "";
      if (/too small|stream header|audio-only/i.test(msg) && tryAlternateSave(media, ref, job.id)) {
        return;
      }
      ref.status = "error";
      ref.progress = msg.replace(/^ERROR:\s*/i, "").slice(0, 48) || "Save failed";
      reflectMediaState(media);
      finishInteraction(media, ref, false, ref.saveGen);
    } else if (job.state === "cancelled") {
      resetAfterCancel(media, ref);
    } else if (job.state === "running" || job.state === "saving" || job.state === "queued") {
      if (ref.cancelRequested) return;
      ref.status = "running";
      ref.progress = job.progress ? `${job.progress}%` : "Saving…";
      reflectMediaState(media);
    }
  }

  let booted = false;
  let mo = null;

  function refreshPlatform() {
    const next = currentPlatform();
    if (next === platform) return;
    platform = next;
    tracked = [];
    currentMedia = null;
    if (!platform) {
      hide();
      return;
    }
    rescan();
  }

  function shouldRunOverlay() {
    return !!currentPlatform();
  }

  function hookHistory() {
    if (hookHistory._done) return;
    hookHistory._done = true;
    const wrap = (fn) => function (...args) {
      const out = fn.apply(this, args);
      refreshPlatform();
      rescan();
      return out;
    };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener("popstate", () => {
      refreshPlatform();
      rescan();
    });
  }

  function init() {
    if (!document.body) return;
    platform = currentPlatform();
    if (!shouldRunOverlay()) return;
    injectStyles();
    buildButton();
    rescan();
    hookHistory();

    if (!mo) {
      mo = new MutationObserver(() => {
        clearTimeout(init._t);
        init._t = setTimeout(rescan, 300);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    resolveTabId(() => {});

    if (!booted) {
      booted = true;
      document.addEventListener("mousemove", onPointerMove, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", () => currentMedia && positionFor(currentMedia), { passive: true });
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.action !== "jobUpdate" || !msg.job) return;
        const media = mediaForJobId(msg.job.id);
        if (!media) return;
        const ref = mediaJobs.get(media);
        if (ref) syncJob(msg.job, media, ref);
      });
    }
  }

  function boot() {
    if (document.body) init();
    else window.addEventListener("DOMContentLoaded", init, { once: true });
  }

  boot();
})();