// Page-context YouTube stream URL capture (fetch/XHR hooks).
(function () {
  "use strict";
  if (window.__vsdCapture) return;
  window.__vsdCapture = true;

  function capture(url) {
    if (typeof url !== "string" || !url.includes("googlevideo.com/videoplayback")) return;
    window.postMessage({ type: "VSD_YT_STREAM", url }, "*");
  }

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const reqUrl = typeof input === "string" ? input : (input && input.url) || "";
    capture(reqUrl);
    return nativeFetch.apply(this, arguments).then(async (resp) => {
      try {
        capture(resp.url);
        if (reqUrl.includes("/youtubei/v1/player")) {
          const data = await resp.clone().json();
          if (data && data.streamingData) {
            window.postMessage({ type: "VSD_PLAYER", streamingData: data.streamingData }, "*");
          }
        }
      } catch (e) {}
      return resp;
    });
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    capture(url);
    return nativeOpen.apply(this, arguments);
  };
})();