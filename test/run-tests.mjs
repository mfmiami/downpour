#!/usr/bin/env node
/**
 * Minimal regression tests for Downpour pure-JS helpers.
 * Run: node test/run-tests.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "safari-extension");
const require = createRequire(import.meta.url);

function loadPlatforms() {
  const code = fs.readFileSync(path.join(root, "platforms.js"), "utf8");
  const sandbox = {
    URL,
    document: { querySelector: () => null },
    location: { href: "https://www.tiktok.com/" },
    performance: { getEntriesByType: () => [] },
    console
  };
  const ctx = vm.createContext(sandbox);
  return vm.runInContext(`${code}\n;DownpourPlatforms;`, ctx);
}

const P = loadPlatforms();

// URL normalizers
assert.equal(
  P.normalizeTikTokUrl("https://m.tiktok.com/@user/video/1234567890"),
  "https://www.tiktok.com/@user/video/1234567890"
);
assert.equal(
  P.normalizeTwitterUrl("https://twitter.com/handle/status/9988776655"),
  "https://x.com/i/status/9988776655"
);
assert.equal(
  P.normalizeInstagramUrl("https://www.instagram.com/reel/ABC123/"),
  "https://www.instagram.com/reel/ABC123/"
);

// TikTok URL scoring prefers video over audio/watermark
const videoUrl = "https://v16-webapp.tiktok.com/video/tos/useast2a/video_mp4/?br=1200&mime_type=video_mp4";
const audioUrl = "https://v16-webapp.tiktok.com/music/audio_mp4/?mime_type=audio_mp4";
const wmUrl = "https://v16-webapp.tiktok.com/video/playwm/123/?mime_type=video_mp4";
assert.ok(P.tikTokVideoUrlScore(videoUrl) > P.tikTokVideoUrlScore(wmUrl));
assert.equal(P.tikTokVideoUrlScore(audioUrl), -1);

const best = P.pickBestTikTokVideoUrl([wmUrl, audioUrl, videoUrl]);
assert.equal(best, videoUrl);

// Erome CDN requires album referer and rejects thumbnails
const eromeMp4 = "https://v202.erome.com/113/0Dup947V/clip_480p.mp4";
const eromeThumb = "https://s202.erome.com/113/0Dup947V/thumbs/clip.jpg";
assert.ok(P.isEromeVideoUrl(eromeMp4));
assert.equal(P.isEromeVideoUrl(eromeThumb), false);
assert.equal(
  P.eromeRefererForUrl(eromeMp4, null),
  "https://www.erome.com/a/0Dup947V"
);
const eromePick = P.pickGenericVideoUrl(null, [eromeThumb, eromeMp4]);
assert.equal(eromePick.url, eromeMp4);

// remux error handling
const { flattenFragmentedMp4 } = require(path.join(__dirname, "..", "remux.js"));
assert.throws(
  () => flattenFragmentedMp4(new Uint8Array([0, 1, 2, 3])),
  /not an MP4/
);

function loadInstagram() {
  const code = fs.readFileSync(path.join(root, "instagram.js"), "utf8");
  const el = { style: {}, setAttribute: () => {}, appendChild: () => {}, remove: () => {} };
  const sandbox = {
    URL,
    chrome: { runtime: { getURL: (p) => p } },
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: () => null,
      createElement: () => el,
      querySelector: () => null,
      documentElement: el,
      head: el,
      body: el
    },
    location: { href: "https://www.instagram.com/" },
    DownpourPlatforms: { isInstagramHost: () => true }
  };
  const ctx = vm.createContext(sandbox);
  return vm.runInContext(`${code}\n;DownpourInstagram;`, ctx);
}

const IG = loadInstagram();
assert.equal(
  IG.extensionFromUrl("https://cdninstagram.com/v/t51.2885-15/e35/abc.webp"),
  "webp"
);
assert.equal(
  IG.extensionFromUrl("https://cdninstagram.com/v/t51.2885-15/e35/abc?stp=dst-jpg_e35"),
  "jpg"
);
assert.equal(
  IG.extensionFromBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
  "png"
);
assert.match(IG.makeFilename("https://cdninstagram.com/foo/bar.webp", "image"), /\.webp$/);

console.log("All tests passed.");