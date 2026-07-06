// Chrome-specific platform hooks loaded before background.js.
// Safari leaves these undefined and uses native app messaging instead.
"use strict";

globalThis.__downpourSkipEromeNative = true;

const NATIVE_HOST = "com.dtek.downpour";

globalThis.__downpourSendNative = function (message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
};

function sanitizeFilename(name) {
  const cleaned = String(name || "download.mp4")
    .replace(/[/\\:*?"<>|]/g, "_")
    .trim();
  return cleaned || "download.mp4";
}

function waitForDownload(downloadId, job, updateFn) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      if (err) reject(err);
      else resolve();
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state && delta.state.current === "complete") finish();
      if (delta.error) finish(new Error(delta.error.current || "Download failed"));
      if (job && updateFn && delta.bytesReceived && delta.totalBytes
          && delta.bytesReceived.current != null && delta.totalBytes.current > 0) {
        const pct = Math.round((delta.bytesReceived.current / delta.totalBytes.current) * 100);
        updateFn(job, {
          state: "saving",
          progress: Math.min(99, pct),
          message: `saving ${pct}%…`
        });
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError) {
        finish(new Error(chrome.runtime.lastError.message));
        return;
      }
      const item = items && items[0];
      if (item && item.state === "complete") finish();
      else if (item && item.error) finish(new Error(item.error));
    });
    setTimeout(() => finish(new Error("Download timed out")), 3600000);
  });
}

globalThis.__downpourSaveToDownloads = async function (bytes, filename, job) {
  const saveName = sanitizeFilename(filename);
  const blob = new Blob([bytes]);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: objectUrl,
        filename: saveName,
        conflictAction: "uniquify",
        saveAs: false
      }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (id == null) reject(new Error("Download failed"));
        else resolve(id);
      });
    });
    const updateFn = typeof globalThis.__downpourUpdateJob === "function"
      ? globalThis.__downpourUpdateJob
      : null;
    await waitForDownload(downloadId, job, updateFn);
    const items = await new Promise((resolve) => {
      chrome.downloads.search({ id: downloadId }, (result) => resolve(result || []));
    });
    const item = items[0];
    return (item && item.filename) || saveName;
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
};