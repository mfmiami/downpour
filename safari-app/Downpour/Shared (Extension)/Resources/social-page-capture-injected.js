// Page-context Instagram / X watch-page URL discovery.
(function () {
  "use strict";
  if (window.__vsdSocialCapture) return;
  window.__vsdSocialCapture = true;

  function post(platform, url) {
    if (url) window.postMessage({ type: "VSD_SOCIAL_VIDEO", platform, url }, "*");
  }

  function normTwitter(u) {
    try {
      const m = u.match(/\/status\/(\d+)/);
      return m ? `https://x.com/i/status/${m[1]}` : u;
    } catch (e) {
      return u;
    }
  }

  function normIg(u) {
    try {
      const x = new URL(u);
      return `https://www.instagram.com${x.pathname}`;
    } catch (e) {
      return u;
    }
  }

  function detectPlatform() {
    const host = location.hostname.replace(/^www\./, "");
    if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com")) return "twitter";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    return null;
  }

  function fromTwitter() {
    if (/\/status\/\d+/.test(location.pathname)) return normTwitter(location.href);
    const og = document.querySelector('meta[property="og:url"]');
    if (og && og.content && og.content.indexOf("/status/") !== -1) return normTwitter(og.content);
    const video = document.querySelector("article video");
    if (video) {
      const article = video.closest("article");
      const link = article && article.querySelector('a[href*="/status/"]');
      if (link) return normTwitter(link.href);
    }
    return null;
  }

  function fromInstagram() {
    if (/\/(reels?|p|tv)\//.test(location.pathname)) return normIg(location.href);
    const og = document.querySelector('meta[property="og:url"]');
    if (og && og.content && og.content.indexOf("instagram.com") !== -1) return normIg(og.content);
    const link = document.querySelector('a[href*="/reel/"], a[href*="/p/"], a[href*="/tv/"]');
    if (link) return normIg(link.href);
    return null;
  }

  const platform = detectPlatform();
  if (!platform) return;

  function report() {
    post(platform, platform === "twitter" ? fromTwitter() : fromInstagram());
  }

  report();
  setInterval(report, 1500);
  new MutationObserver(report).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", report);
})();