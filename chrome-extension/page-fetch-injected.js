// Page-context fetch bridge. Runs in MAIN world (page cookies + Referer).
(function () {
  "use strict";
  if (window.__downpourPageFetch) return;
  window.__downpourPageFetch = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "VSD_PAGE_FETCH_REQUEST") return;
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