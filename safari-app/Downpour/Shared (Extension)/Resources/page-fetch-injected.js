// Page-context fetch bridge. Runs in MAIN world (page cookies + Referer).
(function () {
  "use strict";
  if (window.__downpourPageFetch) return;
  window.__downpourPageFetch = true;

  const STREAM_CHUNK = 1024 * 1024;

  function base64FromBytes(bytes) {
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function emitStreamChunk(id, bytes) {
    window.postMessage({
      type: "VSD_PAGE_FETCH_STREAM_CHUNK",
      id,
      data: base64FromBytes(bytes),
      bytes: bytes.length
    }, "*");
  }

  async function streamFetchRequest({ id, url, credentials, headers }) {
    const init = { credentials: credentials === "include" ? "include" : "omit" };
    if (headers && typeof headers === "object") init.headers = headers;
    try {
      const r = await fetch(url, init);
      if (!r.ok) {
        window.postMessage({ type: "VSD_PAGE_FETCH_STREAM_DONE", id, error: `HTTP ${r.status}` }, "*");
        return;
      }
      const total = parseInt(r.headers.get("Content-Length") || "0", 10);
      window.postMessage({ type: "VSD_PAGE_FETCH_STREAM_META", id, total }, "*");

      if (!r.body || !r.body.getReader) {
        emitStreamChunk(id, new Uint8Array(await r.arrayBuffer()));
        window.postMessage({ type: "VSD_PAGE_FETCH_STREAM_DONE", id, ok: true }, "*");
        return;
      }

      const reader = r.body.getReader();
      let pending = new Uint8Array(0);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending);
        merged.set(value, pending.length);
        pending = merged;
        while (pending.length >= STREAM_CHUNK) {
          emitStreamChunk(id, pending.subarray(0, STREAM_CHUNK));
          pending = pending.subarray(STREAM_CHUNK);
        }
      }
      if (pending.length > 0) emitStreamChunk(id, pending);
      window.postMessage({ type: "VSD_PAGE_FETCH_STREAM_DONE", id, ok: true }, "*");
    } catch (e) {
      window.postMessage({
        type: "VSD_PAGE_FETCH_STREAM_DONE",
        id,
        error: e && e.message ? e.message : String(e)
      }, "*");
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "VSD_PAGE_FETCH_STREAM_REQUEST") {
      const { id, url, credentials, headers } = event.data;
      if (!id || !url) return;
      streamFetchRequest({ id, url, credentials, headers });
      return;
    }

    if (event.data.type !== "VSD_PAGE_FETCH_REQUEST") return;
    const { id, url, wantText, credentials, headers } = event.data;
    if (!id || !url) return;

    const init = { credentials: credentials === "include" ? "include" : "omit" };
    if (headers && typeof headers === "object") init.headers = headers;

    fetch(url, init)
      .then((r) => {
        if (!r.ok) {
          window.postMessage({ type: "VSD_PAGE_FETCH_RESULT", id, error: `HTTP ${r.status}` }, "*");
          return;
        }
        if (wantText) {
          return r.text().then((text) => {
            window.postMessage({ type: "VSD_PAGE_FETCH_RESULT", id, text }, "*");
          });
        }
        return r.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          window.postMessage({
            type: "VSD_PAGE_FETCH_RESULT",
            id,
            data: base64FromBytes(bytes),
            length: bytes.length
          }, "*");
        });
      })
      .catch((e) => {
        window.postMessage({
          type: "VSD_PAGE_FETCH_RESULT",
          id,
          error: e && e.message ? e.message : String(e)
        }, "*");
      });
  });
})();