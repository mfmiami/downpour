// Downpour popup — starts jobs and shows status. Downloads run in the background.
const logEl = document.getElementById("log");
const debugPanel = document.getElementById("debugPanel");
const debugToggle = document.getElementById("debugToggle");
const debugChevron = document.getElementById("debugChevron");
let debugVisible = false;
let logBuffer = "";
const LOG_BUFFER_MAX = 400;

function setDebugVisible(open) {
  debugVisible = open;
  if (debugPanel) debugPanel.classList.toggle("open", open);
  if (debugToggle) {
    debugToggle.setAttribute("aria-expanded", open ? "true" : "false");
    const label = debugToggle.querySelector("span");
    if (label) label.textContent = open ? "Hide developer log" : "Show developer log";
  }
  if (debugChevron) debugChevron.textContent = open ? "▴" : "▾";
  if (open && logEl) {
    logEl.textContent = logBuffer;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function log(msg, obj) {
  const time = new Date().toLocaleTimeString();
  let line = `[${time}] ${msg}`;
  if (obj !== undefined) {
    try { line += " " + (typeof obj === "string" ? obj : JSON.stringify(obj)); } catch (e) { line += " " + String(obj); }
  }
  logBuffer += line + "\n";
  if (logBuffer.length > LOG_BUFFER_MAX * 120) {
    logBuffer = logBuffer.slice(-LOG_BUFFER_MAX * 80);
  }
  if (debugVisible && logEl) {
    logEl.textContent = logBuffer;
    logEl.scrollTop = logEl.scrollHeight;
    console.log(line);
  }
}

window.addEventListener("error", (e) => log("JS ERROR:", e.message));
window.addEventListener("unhandledrejection", (e) => log("PROMISE REJECTION:", (e.reason && e.reason.message) || String(e.reason)));

const buttonsByUrl = new Map();
const cancelButtonsByUrl = new Map();
const qualitySelectsByUrl = new Map();
const progressByUrl = new Map();
const jobIdByUrl = new Map();
let jobPollTimer = null;

function jobInProgress(job) {
  return job && (job.state === "queued" || job.state === "running" || job.state === "saving");
}

function startJobPoll() {
  if (jobPollTimer) return;
  jobPollTimer = setInterval(() => {
    chrome.runtime.sendMessage({ action: "getJobs" }, (resp) => {
      if (chrome.runtime.lastError) return;
      const jobs = (resp && resp.jobs) || [];
      let anyActive = false;
      for (const job of jobs) {
        if (jobInProgress(job)) anyActive = true;
        applyJobState(job);
      }
      if (!anyActive) stopJobPoll();
    });
  }, 700);
}

function stopJobPoll() {
  if (!jobPollTimer) return;
  clearInterval(jobPollTimer);
  jobPollTimer = null;
}

function shortJobMessage(message) {
  if (!message) return "";
  return String(message)
    .replace(/^ERROR:\s*/i, "")
    .replace(/^Saved →\s*/i, "")
    .slice(0, 72);
}

function progressFromJob(job) {
  if (typeof job.progress === "number") return job.progress;
  if (!job.message) return null;
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(String(job.message));
  return match ? Math.min(100, Math.floor(parseFloat(match[1]))) : null;
}

function displayProgress(job) {
  const pct = progressFromJob(job);
  if (pct == null) return null;
  if (job.state !== "done") return Math.min(99, pct);
  return pct;
}

function jobUiUrl(job) {
  return job.watchUrl || job.url;
}

function findUiUrlForJob(job) {
  const primary = jobUiUrl(job);
  if (buttonsByUrl.has(primary)) return primary;
  if (job.watchUrl) {
    const pageKey = `page:${job.watchUrl}`;
    if (buttonsByUrl.has(pageKey)) return pageKey;
  }
  for (const [url, id] of jobIdByUrl.entries()) {
    if (id === job.id) return url;
  }
  return primary;
}

function setBtnVariant(btn, variant) {
  btn.classList.remove("btn-primary", "btn-success", "btn-warning", "btn-danger", "btn-ghost");
  btn.classList.add(variant);
}

function applyJobState(job) {
  if (debugVisible && job.message) log(`job ${job.id}:`, job.message);
  const uiUrl = findUiUrlForJob(job);
  jobIdByUrl.set(uiUrl, job.id);
  const btn = buttonsByUrl.get(uiUrl);
  const cancelBtn = cancelButtonsByUrl.get(uiUrl);
  const qualitySelect = qualitySelectsByUrl.get(uiUrl);
  if (!btn) return;

  const inProgress = jobInProgress(job);
  if (inProgress) startJobPoll();
  if (cancelBtn) cancelBtn.style.display = inProgress ? "inline-flex" : "none";

  const progressEl = progressByUrl.get(uiUrl);
  if (progressEl) {
    progressEl.container.classList.toggle("active", inProgress);
    if (inProgress) {
      const pct = displayProgress(job);
      const known = pct != null;
      progressEl.bar.classList.toggle("indeterminate", !known);
      if (known) {
        progressEl.bar.style.width = `${Math.max(0, pct)}%`;
        const detail = shortJobMessage(job.message);
        const prefix = job.state === "saving" ? "Saving" : `${pct}%`;
        progressEl.label.textContent = detail
          ? (job.state === "saving" ? `Saving — ${detail}` : `${pct}% — ${detail}`)
          : prefix;
      } else {
        progressEl.bar.style.width = "";
        progressEl.label.textContent = job.state === "saving"
          ? (shortJobMessage(job.message) || "Saving…")
          : (shortJobMessage(job.message) || "Downloading…");
      }
    } else if (job.state === "done") {
      progressEl.bar.classList.remove("indeterminate");
      progressEl.bar.style.width = "100%";
      progressEl.label.textContent = shortJobMessage(job.message) || "Done";
    }
  }

  if (job.state === "done") {
    btn.textContent = "Done";
    setBtnVariant(btn, "btn-success");
    btn.disabled = false;
    if (qualitySelect) qualitySelect.disabled = false;
  } else if (job.state === "error") {
    btn.textContent = "Retry";
    setBtnVariant(btn, "btn-warning");
    btn.disabled = false;
    if (qualitySelect) qualitySelect.disabled = false;
    const progressEl = progressByUrl.get(uiUrl);
    if (progressEl) {
      progressEl.container.classList.add("active");
      progressEl.label.textContent = shortJobMessage(job.message) || "Failed";
    }
    if (debugVisible) log("job error:", job.message || job.id);
  } else if (job.state === "cancelled") {
    setBtnVariant(btn, "btn-primary");
    btn.textContent = job.kind === "youtube" ? "Download"
      : job.kind === "stream" ? "Process" : "Download";
    btn.disabled = false;
    if (qualitySelect) qualitySelect.disabled = false;
  } else if (job.state === "saving") {
    setBtnVariant(btn, "btn-primary");
    btn.textContent = "Saving…";
    btn.disabled = true;
  } else {
    setBtnVariant(btn, "btn-primary");
    btn.textContent = job.state === "saving"
      ? "Saving…"
      : (typeof job.progress === "number" ? `${Math.min(99, job.progress)}%` : "Downloading…");
    btn.disabled = true;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.action === "jobUpdate" && msg.job) applyJobState(msg.job);
});

document.addEventListener("DOMContentLoaded", async () => {
  if (debugToggle) {
    debugToggle.onclick = () => setDebugVisible(!debugVisible);
  }

  if (isChromeBrowser()) {
    chrome.runtime.sendMessage({ action: "pingNative" }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        log("native helper:", "not installed — tube-site downloads need install-native-host.sh");
      }
    });
  }

  const bmcBtn = document.getElementById("bmcBtn");
  if (bmcBtn) {
    bmcBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const url = bmcBtn.href;
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  }

  const copyLogBtn = document.getElementById("copyLogBtn");
  if (copyLogBtn) {
    copyLogBtn.onclick = () => {
      navigator.clipboard.writeText(logBuffer || "");
      copyLogBtn.textContent = "Copied!";
      setTimeout(() => { copyLogBtn.textContent = "Copy log"; }, 1500);
    };
  }

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    log("active tab:", tab ? (tab.id + " " + (tab.url || "")) : "none");
  } catch (e) {
    log("tabs.query failed:", e.message);
  }

  const videoList = document.getElementById("videoList");
  const videoContainer = document.getElementById("videoContainer");
  const clearBtn = document.getElementById("clearBtn");

  function pageBaseName() {
    let base = (tab && (tab.title || "")).trim();
    if (!base && tab && tab.url) {
      try { base = new URL(tab.url).hostname.replace(/^www\./, ""); } catch (e) {}
    }
    base = base.replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!base) base = "video";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `${base}_${stamp}`;
  }

  function directFilename(url) {
    let name = "";
    try { name = decodeURIComponent(url.split("/").pop().split(/[?#]/)[0] || ""); } catch (e) {}
    if (!name || !name.includes(".")) name = `${pageBaseName()}.mp4`;
    return name;
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

  function socialOverlayPlatform(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
      if (host === "tiktok.com" || host.endsWith(".tiktok.com")
        || host === "vm.tiktok.com" || host === "vt.tiktok.com") return "TikTok";
      if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com")) return "X";
      if (host === "instagram.com" || host.endsWith(".instagram.com")) return "Instagram";
    } catch (e) {}
    return null;
  }

  function isSocialOverlayHost(url) {
    return socialOverlayPlatform(url) != null;
  }

  function isSocialPageUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
      if (host === "tiktok.com" || host.endsWith(".tiktok.com")
        || host === "vm.tiktok.com" || host === "vt.tiktok.com") {
        return /\/video\/\d+/.test(u.pathname) || /\/photo\/\d+/.test(u.pathname)
          || /^\/t\/[A-Za-z0-9]+/.test(u.pathname);
      }
      if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com")) {
        return /\/status\/\d+/.test(u.pathname);
      }
      if (host === "instagram.com" || host.endsWith(".instagram.com")) {
        return /^\/reels?\//.test(u.pathname) || /^\/p\//.test(u.pathname) || /^\/tv\//.test(u.pathname);
      }
    } catch (e) {}
    return false;
  }

  function resolveYoutubePageUrl(responseYoutubeUrl) {
    if (responseYoutubeUrl) return responseYoutubeUrl;
    if (tab && tab.url && isYoutubeWatchUrl(tab.url)) return normalizeYoutubeUrl(tab.url);
    return null;
  }

  function isGoogleVideoCdn(url) {
    return /googlevideo\.com\/(?:videoplayback|initplayback|api\/manifest|file\/)/i.test(url)
      || /manifest\.googlevideo\.com/i.test(url);
  }

  function isSocialCdn(url) {
    return /tiktokcdn(?:-[a-z]+)?\.com|tiktokv\.com|tiktokv\.eu|byteoversea\.com|muscdn\.com/i.test(url)
      || /video\.twimg\.com|pbs\.twimg\.com\/.*\/vid\//i.test(url)
      || /cdninstagram\.com|fbcdn\.net.*\.mp4/i.test(url);
  }

  function isFragmentUrl(url) {
    if (/\.m3u8|\.mpd/i.test(url)) return false;
    return /\.m4s(\?|$)|\.ts(\?|$)/i.test(url);
  }

  function isThumbUrl(url) {
    return /thumb-cdn|\/thumbs?\//i.test(url) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
  }

  function videoListScore(url) {
    let score = 0;
    if (/\.m3u8/i.test(url)) score += 280;
    if (/video_1440p|video_1080p/i.test(url)) score += 200;
    if (/video_720p/i.test(url)) score += 160;
    if (/video_480p|video_360p/i.test(url)) score += 90;
    if (/\.mp4/i.test(url)) score += 80;
    if (/xvideos-cdn\.com/i.test(url)) score += 60;
    return score;
  }

  function isChromeBrowser() {
    try {
      return (chrome.runtime.getManifest().permissions || []).includes("scripting");
    } catch (e) {
      return false;
    }
  }

  function shouldPreferPageDownload(tabUrl, detectedCount) {
    return isChromeBrowser()
      && DownpourPlatforms.shouldPreferChromePageDownload(tabUrl, detectedCount);
  }

  function pageDownloadKey(tabUrl) {
    return `page:${tabUrl}`;
  }

  function queueDownload(uiUrl, opts, btn, cancelBtn, qualitySelect) {
    btn.disabled = true;
    if (qualitySelect) qualitySelect.disabled = true;
    btn.textContent = "Starting…";
    log("start:", `${opts.action} ${opts.url}`);
    chrome.runtime.sendMessage(opts, (resp) => {
      if (chrome.runtime.lastError) {
        log("start failed:", chrome.runtime.lastError.message);
        btn.textContent = "Retry";
        setBtnVariant(btn, "btn-warning");
        btn.disabled = false;
        if (qualitySelect) qualitySelect.disabled = false;
        const progressEl = progressByUrl.get(uiUrl);
        if (progressEl) {
          progressEl.container.classList.add("active");
          progressEl.label.textContent = chrome.runtime.lastError.message;
        }
        return;
      }
      log("queued job:", resp && resp.jobId);
      if (resp && resp.jobId) jobIdByUrl.set(uiUrl, resp.jobId);
      btn.textContent = "Downloading…";
      if (cancelBtn) cancelBtn.style.display = "inline-flex";
      const progressEl = progressByUrl.get(uiUrl);
      if (progressEl) {
        progressEl.container.classList.add("active");
        progressEl.bar.classList.add("indeterminate");
        progressEl.bar.style.width = "";
        progressEl.label.textContent = "Queued…";
      }
      startJobPoll();
    });
  }

  function appendPageDownloadCard(tabUrl) {
    const pageUrl = DownpourPlatforms.pageDownloadUrl(tabUrl) || tabUrl;
    const key = pageDownloadKey(pageUrl);
    const li = document.createElement("li");
    li.className = "video-item page-download-item";

    const cardTop = document.createElement("div");
    cardTop.className = "card-top";
    const badge = document.createElement("span");
    badge.className = "badge badge-file";
    badge.textContent = "This page";
    cardTop.appendChild(badge);

    const labelDiv = document.createElement("div");
    labelDiv.className = "video-title";
    const title = (tab && tab.title || "").trim()
      .replace(/\s*[-–—|]\s*XVIDEOS\.COM\s*$/i, "")
      .replace(/\s*[-–—|]\s*xHamster\s*$/i, "")
      .replace(/\s*[-–—|]\s*SpankBang\s*$/i, "")
      .trim();
    labelDiv.textContent = title || "Download this video";
    labelDiv.title = tabUrl;

    const hintDiv = document.createElement("div");
    hintDiv.className = "video-url";
    hintDiv.style.marginTop = "4px";
    hintDiv.textContent = "Uses yt-dlp on this page URL. If that fails, try a Direct or HLS link below.";

    const progressWrap = document.createElement("div");
    progressWrap.className = "download-progress";
    const progressTrack = document.createElement("div");
    progressTrack.className = "download-progress-track";
    const progressBar = document.createElement("div");
    progressBar.className = "download-progress-bar";
    progressTrack.appendChild(progressBar);
    const progressLabel = document.createElement("div");
    progressLabel.className = "download-progress-label";
    progressWrap.appendChild(progressTrack);
    progressWrap.appendChild(progressLabel);
    progressByUrl.set(key, { container: progressWrap, bar: progressBar, label: progressLabel });

    const cardActions = document.createElement("div");
    cardActions.className = "card-actions";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Download";
    btn.title = "Download via yt-dlp using this page URL (recommended on Chrome)";
    buttonsByUrl.set(key, btn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-danger";
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.display = "none";
    cancelButtonsByUrl.set(key, cancelBtn);
    cancelBtn.onclick = () => {
      const id = jobIdByUrl.get(key);
      if (id == null) return;
      cancelBtn.textContent = "Cancelling…";
      cancelBtn.disabled = true;
      chrome.runtime.sendMessage({ action: "cancelJob", jobId: id }, () => {
        cancelBtn.textContent = "Cancel";
        cancelBtn.disabled = false;
      });
    };

    btn.onclick = () => {
      queueDownload(key, {
        action: "downloadPage",
        url: pageUrl,
        pageUrl: pageUrl,
        filename: `${pageBaseName()}.mp4`,
        tabId: tab && tab.id,
        quality: "normal"
      }, btn, cancelBtn, null);
    };

    cardActions.appendChild(cancelBtn);
    cardActions.appendChild(btn);
    li.appendChild(cardTop);
    li.appendChild(labelDiv);
    li.appendChild(hintDiv);
    li.appendChild(progressWrap);
    li.appendChild(cardActions);
    videoList.insertBefore(li, videoList.firstChild);
  }

  function youtubeVideoTitle() {
    let title = (tab && tab.title || "").trim();
    return title.replace(/\s*[-–—|]\s*YouTube(\s+Music)?\s*$/i, "").trim() || null;
  }

  function badgeClass(isYoutube, isUnsupported, isStream) {
    if (isYoutube) return "badge-youtube";
    if (isUnsupported) return "badge-mse";
    if (isStream) return "badge-stream";
    return "badge-file";
  }

  function setEmptyState(title, message) {
    const heading = videoContainer.querySelector("h2");
    const copy = videoContainer.querySelector("p");
    if (heading) heading.textContent = title;
    if (copy) copy.textContent = message;
  }

  const updateList = (videos, youtubePageUrl, tabUrl) => {
    buttonsByUrl.clear();
    cancelButtonsByUrl.clear();
    qualitySelectsByUrl.clear();
    progressByUrl.clear();

    const socialPlatform = tabUrl ? socialOverlayPlatform(tabUrl) : null;
    if (socialPlatform) {
      videoContainer.style.display = "block";
      videoList.innerHTML = "";
      setEmptyState(
        `${socialPlatform} uses in-page save`,
        `Tap the Downpour button on the video to save it. Social videos are not listed here.`
      );
      return;
    }

    let list = videos.slice().filter((url) => !isGoogleVideoCdn(url) && !isSocialCdn(url) && !isSocialPageUrl(url)
      && !isFragmentUrl(url) && !isThumbUrl(url));
    list.sort((a, b) => videoListScore(b) - videoListScore(a));
    if (youtubePageUrl) {
      list = list.filter((url) => !/^(blob:|data:|mediasource:)/i.test(url));
      if (!list.includes(youtubePageUrl)) list.unshift(youtubePageUrl);
    }

    const preferPageDownload = tabUrl && shouldPreferPageDownload(tabUrl, list.length);

    if (list.length === 0 && !preferPageDownload) {
      videoContainer.style.display = "block";
      videoList.innerHTML = "";
      setEmptyState("No videos yet", "Play a video on this page, then reopen Downpour to download it.");
      return;
    }
    videoContainer.style.display = "none";
    videoList.innerHTML = "";

    if (preferPageDownload) {
      appendPageDownloadCard(tabUrl);
    }

    list.forEach((url) => {
      const li = document.createElement("li");
      li.className = "video-item";

      const isYoutube = isYoutubeWatchUrl(url);
      const isUnsupported = !isYoutube && /^(blob:|data:|mediasource:)/i.test(url);
      const isStream = !isYoutube && (url.includes(".m3u8") || url.includes(".mpd"));
      const type = isYoutube ? "YouTube" : isUnsupported ? "MSE" : isStream ? "HLS/DASH" : "Direct";

      const cardTop = document.createElement("div");
      cardTop.className = "card-top";
      const badge = document.createElement("span");
      badge.className = `badge ${badgeClass(isYoutube, isUnsupported, isStream)}`;
      badge.textContent = type;

      const copyBtn = document.createElement("button");
      copyBtn.className = "btn btn-ghost";
      copyBtn.type = "button";
      copyBtn.textContent = "Copy URL";
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(url);
        copyBtn.textContent = "Copied";
        setTimeout(() => { copyBtn.textContent = "Copy URL"; }, 1600);
      };

      cardTop.appendChild(badge);
      cardTop.appendChild(copyBtn);

      const labelDiv = document.createElement("div");
      if (isYoutube) {
        const title = youtubeVideoTitle();
        labelDiv.className = title ? "video-title" : "video-url";
        labelDiv.textContent = title || url;
        labelDiv.title = title ? `${title}\n${url}` : url;
      } else {
        labelDiv.className = "video-url";
        labelDiv.textContent = url;
        labelDiv.title = url;
      }

      const progressWrap = document.createElement("div");
      progressWrap.className = "download-progress";
      const progressTrack = document.createElement("div");
      progressTrack.className = "download-progress-track";
      const progressBar = document.createElement("div");
      progressBar.className = "download-progress-bar";
      progressTrack.appendChild(progressBar);
      const progressLabel = document.createElement("div");
      progressLabel.className = "download-progress-label";
      progressWrap.appendChild(progressTrack);
      progressWrap.appendChild(progressLabel);
      progressByUrl.set(url, { container: progressWrap, bar: progressBar, label: progressLabel });

      const cardActions = document.createElement("div");
      cardActions.className = "card-actions";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      buttonsByUrl.set(url, btn);

      if (isUnsupported) {
        btn.textContent = "Unsupported";
        btn.disabled = true;
        setBtnVariant(btn, "btn-ghost");
        btn.title = "In-page Media Source stream — not directly downloadable.";
      } else if (isYoutube) {
        btn.textContent = "Download";
        btn.title = "Download this YouTube video at the selected quality";
      } else {
        btn.textContent = isStream ? "Process" : "Download";
      }

      let qualitySelect = null;
      if (isYoutube) {
        qualitySelect = document.createElement("select");
        qualitySelect.className = "quality-select";
        qualitySelect.title = "Choose download quality";
        qualitySelectsByUrl.set(url, qualitySelect);
        [
          { value: "normal", label: "Normal (720p)" },
          { value: "best", label: "Best quality" }
        ].forEach((opt) => {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          qualitySelect.appendChild(option);
        });
        cardActions.appendChild(qualitySelect);
      }

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-danger";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.display = "none";
      cancelButtonsByUrl.set(url, cancelBtn);
      cancelBtn.onclick = () => {
        const id = jobIdByUrl.get(url);
        if (id == null) return;
        cancelBtn.textContent = "Cancelling…";
        cancelBtn.disabled = true;
        chrome.runtime.sendMessage({ action: "cancelJob", jobId: id }, () => {
          cancelBtn.textContent = "Cancel";
          cancelBtn.disabled = false;
        });
      };

      btn.onclick = () => {
        if (isUnsupported) return;
        const action = isYoutube ? "downloadYoutube" : isStream ? "downloadStream" : "downloadDirect";
        const quality = qualitySelect ? qualitySelect.value : null;
        const qualityTag = quality === "best" ? "_best" : quality === "normal" ? "_720p" : "";
        const filename = (isYoutube || isStream) ? `${pageBaseName()}${qualityTag}.mp4` : directFilename(url);
        const pageUrl = tabUrl || (tab && tab.url) || "";
        queueDownload(url, {
          action,
          url,
          filename,
          tabId: tab && tab.id,
          quality,
          pageUrl: pageUrl || undefined
        }, btn, cancelBtn, qualitySelect);
      };

      cardActions.appendChild(cancelBtn);
      cardActions.appendChild(btn);

      li.appendChild(cardTop);
      li.appendChild(labelDiv);
      li.appendChild(progressWrap);
      li.appendChild(cardActions);
      videoList.appendChild(li);
    });

    chrome.runtime.sendMessage({ action: "getJobs" }, (resp) => {
      if (chrome.runtime.lastError) return;
      const jobs = (resp && resp.jobs) || [];
      jobs.forEach(applyJobState);
      if (jobs.some(jobInProgress)) startJobPoll();
    });
  };

  if (!tab) {
    log("no active tab — cannot query videos");
  } else {
    log("requesting detected videos…");
    chrome.runtime.sendMessage({ action: "getVideos", tabId: tab.id }, async (response) => {
      if (chrome.runtime.lastError) { log("getVideos lastError:", chrome.runtime.lastError.message); return; }
      const vids = (response && response.videos) || [];
      let freshTab = tab;
      try { freshTab = await chrome.tabs.get(tab.id); } catch (e) {}
      const tabUrl = (freshTab && freshTab.url) || (tab && tab.url) || "";
      let youtubePageUrl = resolveYoutubePageUrl(response && response.youtubeUrl);
      if (!youtubePageUrl) {
        try {
          const pageResp = await chrome.tabs.sendMessage(tab.id, { action: "getYoutubePage" });
          if (pageResp && pageResp.url) {
            youtubePageUrl = pageResp.url;
            chrome.runtime.sendMessage({ action: "setYoutubePage", tabId: tab.id, url: youtubePageUrl });
          }
        } catch (e) {
          log("getYoutubePage failed:", e.message);
        }
      }
      log("detected videos:", vids.length, youtubePageUrl ? "youtube: " + youtubePageUrl : "");
      updateList(vids, youtubePageUrl, tabUrl);
    });
  }

  clearBtn.onclick = () => {
    if (tab) chrome.runtime.sendMessage({ action: "clearVideos", tabId: tab.id });
    updateList([], null, tab && tab.url);
  };
});