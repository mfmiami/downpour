// Page-context fetch bridge (erome CDN Referer). Loaded via script src, not inline.
(function () {
  "use strict";
  if (window.__downpourPageFetch) return;
  window.__downpourPageFetch = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "VSD_PAGE_FETCH_REQUEST") return;
    const { id, url, wantText } = event.data;
    if (!id || !url) return;

    fetch(url, { credentials: "omit" })
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
          let binary = "";
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
          }
          window.postMessage({
            type: "VSD_PAGE_FETCH_RESULT",
            id,
            data: btoa(binary),
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