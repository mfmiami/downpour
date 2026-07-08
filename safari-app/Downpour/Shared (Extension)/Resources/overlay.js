// Hover-follow save button for social sites and generic page videos.
(function () {
  const HOST_ID = "downpour-save-host";
  const MIN_SIDE = 160;

  let tracked = [];
  let btnHost = null;
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

  const RING_RADIUS = 15;
  const RING_CIRC = 2 * Math.PI * RING_RADIUS;
  const PROGRESS_RING =
    `<svg class="downpour-ring" viewBox="0 0 38 38" width="38" height="38" aria-hidden="true">` +
    `<circle class="downpour-ring-track" cx="19" cy="19" r="${RING_RADIUS}" fill="none" stroke-width="2.5"/>` +
    `<circle class="downpour-ring-fill" cx="19" cy="19" r="${RING_RADIUS}" fill="none" stroke-width="2.5" stroke-linecap="round"/>` +
    `</svg>`;

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
    return isGenericPlatform() || platform === "twitter" || platform === "tiktok" || platform === "instagram";
  }

  function buildButtonStyles() {
    return `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483646;
  width: 38px;
  height: 38px;
  opacity: 0;
  transform: translateY(-4px) scale(0.9);
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}
:host(.visible) {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
.dp-btn {
  all: unset;
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  background: rgba(12, 12, 14, 0.78);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  backdrop-filter: blur(10px) saturate(140%);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  transition: background-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.dp-btn:hover {
  background: rgba(18, 18, 22, 0.92);
  transform: scale(1.06);
}
.dp-btn:active { transform: scale(0.96); }
.dp-btn .downpour-icon svg {
  display: block;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.dp-btn.downpour-error {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35), inset 0 0 0 1.5px rgba(248, 113, 113, 0.75);
}
.dp-btn.downpour-error .downpour-icon { color: #f87171; }
.dp-btn.downpour-cancellable:hover {
  background: rgba(28, 16, 20, 0.92);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35), inset 0 0 0 1.5px rgba(248, 113, 113, 0.55);
}
.dp-btn .downpour-ring {
  position: absolute;
  inset: 0;
  width: 38px;
  height: 38px;
  max-width: 38px;
  max-height: 38px;
  transform: rotate(-90deg);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}
.dp-btn:not(.downpour-has-progress) .downpour-ring { display: none; }
.dp-btn.downpour-has-progress .downpour-ring {
  display: block;
  opacity: 1;
}
.downpour-ring-track { stroke: rgba(255, 255, 255, 0.14); }
.downpour-ring-fill {
  stroke: #2dd4bf;
  stroke-dasharray: ${RING_CIRC};
  stroke-dashoffset: ${RING_CIRC};
  transition: stroke-dashoffset 0.25s ease;
}
.dp-btn.downpour-progress-indeterminate .downpour-ring-fill {
  animation: downpour-ring-indeterminate 1.15s ease-in-out infinite;
}
@keyframes downpour-ring-indeterminate {
  0% { stroke-dashoffset: ${RING_CIRC * 0.85}; }
  50% { stroke-dashoffset: ${RING_CIRC * 0.25}; }
  100% { stroke-dashoffset: ${RING_CIRC * 0.85}; }
}
.dp-btn .downpour-icon {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dp-btn .downpour-pct {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  color: #e2e8f0;
}
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
  }

  function isProfilePic(el) {
    const alt = (el.getAttribute("alt") || "").toLowerCase();
    return alt.includes("profile picture");
  }

  function largeEnough(el) {
    const r = el.getBoundingClientRect();
    const min = platform === "twitter" || platform === "instagram" ? 120 : MIN_SIDE;
    return r.width >= min && r.height >= min;
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
    DownpourPlatforms.forEachDeep(document, selector, (el) => {
      if (qualifies(el)) next.push(el);
    });
    tracked = next;
  }

  function pointerOnOverlay(e) {
    if (!btnHost) return false;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    return path.includes(btnHost);
  }

  function climbToMedia(el) {
    const seen = new Set();
    let node = el;
    while (node && !seen.has(node)) {
      seen.add(node);
      if (qualifies(node)) return node;
      if (node.parentElement) {
        node = node.parentElement;
      } else {
        const root = node.getRootNode();
        node = root instanceof ShadowRoot ? root.host : null;
      }
    }
    return null;
  }

  function mediaFromPoint(x, y) {
    const stack = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint(x, y)].filter(Boolean);
    for (const el of stack) {
      const hit = climbToMedia(el);
      if (hit) return hit;
    }
    return null;
  }

  function buildButton() {
    if (btnHost) return;
    const legacyBtn = document.getElementById("downpour-save-btn");
    if (legacyBtn) legacyBtn.remove();
    const legacyStyle = document.getElementById("downpour-save-style");
    if (legacyStyle) legacyStyle.remove();
    btnHost = document.createElement("div");
    btnHost.id = HOST_ID;
    const shadow = btnHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = buildButtonStyles();
    btn = document.createElement("button");
    btn.className = "dp-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Save media");
    btn.innerHTML = `${PROGRESS_RING}<span class="downpour-icon">${ICONS.download}</span>`;
    btn.addEventListener("click", onDownloadClick);
    btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    shadow.appendChild(style);
    shadow.appendChild(btn);
    btnHost.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    document.body.appendChild(btnHost);
  }

  function setButtonIcon(html) {
    if (!btn) return;
    const icon = btn.querySelector(".downpour-icon");
    if (icon) icon.innerHTML = html;
  }

  function updateProgressRing(progressPct) {
    if (!btn) return;
    const fill = btn.querySelector(".downpour-ring-fill");
    if (!fill) return;
    const indeterminate = progressPct == null || progressPct <= 0;
    btn.classList.toggle("downpour-progress-indeterminate", indeterminate);
    if (!indeterminate) {
      const clamped = Math.max(0, Math.min(100, progressPct));
      fill.style.strokeDashoffset = String(RING_CIRC * (1 - clamped / 100));
    } else {
      fill.style.strokeDashoffset = "";
    }
  }

  function setState(state, title, progressPct) {
    if (!btn) return;
    btn.classList.remove(
      "downpour-loading", "downpour-cancellable", "downpour-error",
      "downpour-has-progress", "downpour-progress-indeterminate"
    );
    if (state === "loading") {
      btn.classList.add("downpour-loading");
      const cancelling = /cancell/i.test(title || "");
      if (cancelling) {
        setButtonIcon('<span class="downpour-spinner"></span>');
        btn.setAttribute("aria-label", "Cancelling download");
        btn.title = title || "Cancelling…";
      } else {
        btn.classList.add("downpour-cancellable", "downpour-has-progress");
        updateProgressRing(progressPct);
        const showPct = typeof progressPct === "number" && progressPct > 0;
        setButtonIcon(showPct
          ? `<span class="downpour-pct">${progressPct}</span>`
          : ICONS.cancel);
        btn.setAttribute("aria-label", "Cancel download");
        const pctLabel = typeof progressPct === "number" && progressPct > 0 ? `${progressPct}%` : null;
        const detail = pctLabel || (title && title !== "Saving…" ? title : null);
        btn.title = detail ? `${detail} — click to cancel` : "Click to cancel";
      }
    } else if (state === "error") {
      updateProgressRing(null);
      btn.classList.add("downpour-error");
      setButtonIcon(ICONS.error);
      btn.title = title || "Save failed";
    } else {
      updateProgressRing(null);
      setButtonIcon(ICONS.download);
      btn.setAttribute("aria-label", "Save media");
      btn.title = title || "Save";
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
      progressPct: null,
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
      setState("loading", "Saving…", null);
      return;
    }
    if (ref.status === "running") {
      setState("loading", ref.progress || "Saving…", ref.progressPct);
      return;
    }
    if (ref.status === "error") setState("error", ref.progress || "Save failed");
    else setState("idle", "Save");
  }

  function shouldAbortSave(ref) {
    return !!(ref && ref.cancelRequested);
  }

  function onJobStarted(jobId, media, ref, gen) {
    if (jobId == null || !isCurrentSave(ref, gen)) return;
    ref.jobId = jobId;
    if (ref.cancelRequested) {
      sendRuntimeMessage({ action: "cancelJob", jobId });
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
      sendRuntimeMessage({ action: "cancelJob", jobId: ref.jobId });
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
      ref.progressPct = null;
      ref.handledFailureId = null;
      ref.ytDlpTried = false;
      ref.twitterM3u8Tried = false;
    }
    activeMedia.delete(media);
    if (activeMedia.size === 0) stopJobPoll();
    reflectMediaState(media);
  }

  function positionFor(media) {
    if (!btnHost || !media) return false;
    const r = media.getBoundingClientRect();
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const size = 38;
    const pad = 12;
    btnHost.style.left = Math.round(r.right - size - pad) + "px";
    btnHost.style.top = Math.round(r.top + pad) + "px";
    return true;
  }

  function showFor(media) {
    if (!btnHost) return;
    currentMedia = media;
    if (positionFor(media)) {
      btnHost.classList.add("visible");
      reflectMediaState(media);
    }
  }

  function hide() {
    if (!btnHost) return;
    const media = currentMedia;
    if (media) {
      const timer = finishTimers.get(media);
      if (timer) {
        clearTimeout(timer);
        finishTimers.delete(media);
      }
      const ref = jobRefFor(media);
      if (ref && ref.status === "error") {
        resetAfterCancel(media, ref);
      }
    }
    btnHost.classList.remove("visible");
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
    const pointed = mediaFromPoint(x, y);
    if (platform !== "tiktok" && pointed) return pointed;

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
      return best || pointed;
    }

    if (pointed) return pointed;

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
      if (pointerOnOverlay(e)) {
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
    if (btnHost && btnHost.classList.contains("visible")) reflectMediaState(currentMedia);
  }

  function sendRuntimeMessage(message, callback) {
    DownpourBridge.sendMessage(message, (resp) => {
      if (callback) callback(resp);
    });
  }

  function resolveTabId(cb) {
    if (contentTabId != null) {
      cb(contentTabId);
      return;
    }
    if (!DownpourBridge.alive()) {
      cb(contentTabId);
      return;
    }
    sendRuntimeMessage({ action: "getTabId" }, (resp) => {
      if (resp && resp.tabId != null) contentTabId = resp.tabId;
      cb(contentTabId);
    });
  }

  function stopJobPoll() {
    if (jobPollTimer) {
      clearInterval(jobPollTimer);
      jobPollTimer = null;
    }
  }

  DownpourBridge.onInvalidated(stopJobPoll);

  function startJobPoll() {
    if (jobPollTimer) return;
    jobPollTimer = setInterval(() => {
      if (!DownpourBridge.alive()) {
        stopJobPoll();
        return;
      }
      if (activeMedia.size === 0) {
        stopJobPoll();
        return;
      }
      sendRuntimeMessage({ action: "getJobs" }, (resp) => {
        if (!resp || !resp.jobs) return;
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
    const normalized = isGenericPlatform()
      ? String(pageUrl || "").split("#")[0]
      : DownpourPlatforms.normalizeSocialPageUrl(platform, pageUrl);
    ref.pageUrl = normalized;
    ref.cdnUrl = null;
    resolveTabId((tabId) => {
      if (!isCurrentSave(ref, gen)) return;
      const payload = isGenericPlatform()
        ? {
          action: "downloadPage",
          url: normalized,
          pageUrl: normalized,
          filename: DownpourPlatforms.makeGenericFilename(normalized),
          quality: "normal",
          tabId
        }
        : {
          action: "downloadSocial",
          platform,
          url: normalized,
          filename: DownpourPlatforms.makeSocialFilename(platform),
          quality: "normal",
          tabId
        };
      sendRuntimeMessage(payload, (resp) => {
        if (!isCurrentSave(ref, gen)) return;
        if (!resp || !resp.ok) {
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
      sendRuntimeMessage({
        action: "downloadStream",
        url,
        filename,
        socialFetch,
        tabFetch,
        tabId,
        pageUrl: location.href.split("#")[0]
      }, (resp) => {
      if (!isCurrentSave(ref, gen)) return;
      if (!resp || !resp.ok) {
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
      const pageUrl = location.href.split("#")[0];
      if (pageUrl && !ref.ytDlpTried) {
        ref.ytDlpTried = true;
        ref.progress = "Trying alternate…";
        reflectMediaState(mediaEl);
        startYtDlp(pageUrl, mediaEl, ref, ref.saveGen);
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
      sendRuntimeMessage({
        action: "downloadDirect",
        url,
        filename,
        socialFetch,
        tabFetch,
        imageDownload,
        tabId,
        pageUrl: location.href.split("#")[0]
      }, (resp) => {
      if (!isCurrentSave(ref, gen)) return;
      if (!resp || !resp.ok) {
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
      sendRuntimeMessage({ action: "getVideos" }, (resp) => {
        if (!resp) {
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
    const prev = finishTimers.get(media);
    if (prev) clearTimeout(prev);
    const finalize = () => {
      finishTimers.delete(media);
      if (!isCurrentSave(ref, gen)) return;
      resetAfterCancel(media, ref);
      if (currentMedia === media) hide();
    };
    if (immediate) {
      finalize();
      return;
    }
    finishTimers.set(media, setTimeout(finalize, 1200));
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
      finishInteraction(media, ref, true, ref.saveGen);
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
      const rawPct = typeof job.progress === "number" ? job.progress : null;
      ref.progressPct = rawPct != null ? Math.min(99, rawPct) : null;
      if (job.state === "saving") {
        ref.progress = job.message ? String(job.message).replace(/^Saved →\s*/i, "").slice(0, 48) : "Saving…";
        if (!/saving/i.test(ref.progress)) ref.progress = `Saving… ${ref.progress}`.trim();
      } else {
        ref.progress = ref.progressPct != null && ref.progressPct > 0
          ? `${ref.progressPct}%`
          : (job.message || "Saving…");
      }
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
    if (window.top !== window) return;
    if (!document.body) return;
    platform = currentPlatform();
    if (!shouldRunOverlay()) return;
    document.documentElement.dataset.downpourOverlay = platform;
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

    if (!init._rescanInterval) {
      init._rescanInterval = setInterval(() => {
        if (!DownpourBridge.alive()) return;
        if (platform) rescan();
      }, 2000);
      DownpourBridge.onInvalidated(() => {
        if (init._rescanInterval) clearInterval(init._rescanInterval);
      });
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

  function tryBoot() {
    if (window.top !== window) return;
    init();
  }

  function boot() {
    tryBoot();
    if (!document.body) {
      const bodyWait = new MutationObserver(() => {
        if (document.body) {
          bodyWait.disconnect();
          tryBoot();
        }
      });
      bodyWait.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener("DOMContentLoaded", tryBoot, { once: true });
    }
    window.addEventListener("pageshow", tryBoot);
    window.addEventListener("focus", () => {
      refreshPlatform();
      rescan();
    });
  }

  boot();
})();