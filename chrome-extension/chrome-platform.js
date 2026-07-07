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

const NATIVE_CHUNK = 4 * 1024 * 1024;
const DATA_URL_MAX = 48 * 1024 * 1024;

function blobUrlSaveAvailable() {
  return typeof globalThis.URL !== "undefined"
    && typeof globalThis.URL.createObjectURL === "function";
}

function base64FromBytes(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function saveViaNativeHost(bytes, saveName, job) {
  const updateFn = typeof globalThis.__downpourUpdateJob === "function"
    ? globalThis.__downpourUpdateJob
    : null;
  if (bytes.length <= NATIVE_CHUNK) {
    const resp = await globalThis.__downpourSendNative({
      type: "saveToDownloads",
      filename: saveName,
      data: base64FromBytes(bytes)
    });
    if (resp && resp.ok) return resp.path;
    throw new Error((resp && (resp.error || JSON.stringify(resp))) || "native save returned no response");
  }

  const begin = await globalThis.__downpourSendNative({ type: "saveBegin", filename: saveName });
  if (!begin || !begin.ok || !begin.token) throw new Error((begin && begin.error) || "saveBegin failed");
  const token = begin.token;
  try {
    const total = bytes.length;
    for (let off = 0; off < total; off += NATIVE_CHUNK) {
      if (job && job.cancelled) throw new Error("cancelled");
      const end = Math.min(off + NATIVE_CHUNK, total);
      const resp = await globalThis.__downpourSendNative({
        type: "saveChunk",
        token,
        data: base64FromBytes(bytes.subarray(off, end))
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "saveChunk failed");
      if (job && updateFn) {
        updateFn(job, {
          state: "saving",
          progress: Math.round((end / total) * 100),
          message: `saving ${Math.round(end / 1048576)}/${Math.round(total / 1048576)} MB…`
        });
      }
    }
    const fin = await globalThis.__downpourSendNative({ type: "saveEnd", token, filename: saveName });
    if (fin && fin.ok) return fin.path;
    throw new Error((fin && fin.error) || "saveEnd failed");
  } catch (e) {
    try { await globalThis.__downpourSendNative({ type: "saveAbort", token }); } catch (_) {}
    throw e;
  }
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

async function saveViaChromeDownloads(url, saveName, job) {
  const downloadId = await new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
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
}

globalThis.__downpourSaveToDownloads = async function (bytes, filename, job) {
  const saveName = sanitizeFilename(filename);

  if (blobUrlSaveAvailable()) {
    const blob = new Blob([bytes]);
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await saveViaChromeDownloads(objectUrl, saveName, job);
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    }
  }

  if (typeof globalThis.__downpourSendNative === "function") {
    try {
      return await saveViaNativeHost(bytes, saveName, job);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (!/native messaging|specified native|not found|access denied/i.test(msg)) throw e;
    }
  }

  if (bytes.length <= DATA_URL_MAX) {
    const dataUrl = `data:application/octet-stream;base64,${base64FromBytes(bytes)}`;
    return saveViaChromeDownloads(dataUrl, saveName, job);
  }

  throw new Error(
    "Cannot save large files in Chrome without the Downpour native helper. "
    + "Run chrome-extension/native-host/install-native-host.sh with your extension ID, then quit and reopen Chrome."
  );
};