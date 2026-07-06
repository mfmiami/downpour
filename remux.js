// Flatten a fragmented MP4 (mux.js output: ftyp + empty moov + moof/mdat pairs)
// into a progressive/"flat" MP4 (ftyp + moov-with-sample-tables + mdat). QuickTime
// plays flat MP4 reliably but renders mux.js's fragmented output as black video
// with truncated audio, so we rebuild the sample tables here before saving.
//
// Assumes the favourable shape mux.js actually emits: one moof+mdat per track,
// each with a single trun describing all of that track's samples.
(function (global) {
  "use strict";

  function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; }
  function s32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n | 0); return b; }
  function str(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  function concat(arrs) {
    let len = 0; for (const a of arrs) len += a.length;
    const out = new Uint8Array(len); let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  function box(type, ...parts) {
    const body = concat(parts);
    return concat([u32(body.length + 8), str(type), body]);
  }
  function fullbox(type, version, flags, ...parts) {
    return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
  }

  function flattenFragmentedMp4(input) {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const rU32 = (o) => dv.getUint32(o);
    const rS32 = (o) => dv.getInt32(o);
    const typeAt = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);

    function children(start, end) {
      const out = []; let off = start;
      while (off + 8 <= end) {
        let size = rU32(off); const type = typeAt(off + 4); let hdr = 8;
        if (size === 1) { size = Number(dv.getBigUint64(off + 8)); hdr = 16; }
        if (size < hdr || off + size > end) break;
        out.push({ type, off, hdr, size, dataStart: off + hdr, dataEnd: off + size });
        off += size;
      }
      return out;
    }
    const find = (list, type) => list.find((b) => b.type === type);
    const slice = (b) => buf.subarray(b.off, b.dataEnd);

    const top = children(0, buf.length);
    const ftyp = find(top, "ftyp");
    const moov = find(top, "moov");
    if (!ftyp || !moov) throw new Error("not an MP4 (missing ftyp/moov)");
    const moovKids = children(moov.dataStart, moov.dataEnd);
    const mvhd = find(moovKids, "mvhd");
    const traks = moovKids.filter((b) => b.type === "trak");

    // tfhd/trun parser for one traf.
    function parseTraf(traf) {
      const kids = children(traf.dataStart, traf.dataEnd);
      const tfhd = find(kids, "tfhd"), trun = find(kids, "trun");
      const tflags = rU32(tfhd.dataStart) & 0xffffff;
      let p = tfhd.dataStart + 4; const trackId = rU32(p); p += 4;
      if (tflags & 0x000001) p += 8;
      if (tflags & 0x000002) p += 4;
      let defDur = 0, defSize = 0, defFlags = 0;
      if (tflags & 0x000008) { defDur = rU32(p); p += 4; }
      if (tflags & 0x000010) { defSize = rU32(p); p += 4; }
      if (tflags & 0x000020) { defFlags = rU32(p); p += 4; }
      const trVer = buf[trun.dataStart];
      const trFlags = rU32(trun.dataStart) & 0xffffff;
      let q = trun.dataStart + 4; const count = rU32(q); q += 4;
      if (trFlags & 0x000001) q += 4;
      let firstFlags = null;
      if (trFlags & 0x000004) { firstFlags = rU32(q); q += 4; }
      const samples = [];
      for (let i = 0; i < count; i++) {
        let dur = defDur, size = defSize, flags = defFlags, cto = 0;
        if (trFlags & 0x000100) { dur = rU32(q); q += 4; }
        if (trFlags & 0x000200) { size = rU32(q); q += 4; }
        if (trFlags & 0x000400) { flags = rU32(q); q += 4; }
        else if (i === 0 && firstFlags !== null) { flags = firstFlags; }
        if (trFlags & 0x000800) { cto = trVer === 1 ? rS32(q) : rU32(q); q += 4; }
        samples.push({ dur, size, flags, cto });
      }
      return { trackId, samples };
    }

    // Gather samples + data per track from all moof/mdat pairs.
    const fragByTrack = {};
    for (let i = 0; i < top.length; i++) {
      if (top[i].type !== "moof") continue;
      const moof = top[i], mdat = top[i + 1];
      if (!mdat || mdat.type !== "mdat") throw new Error("moof not followed by mdat");
      const traf = find(children(moof.dataStart, moof.dataEnd), "traf");
      const { trackId, samples } = parseTraf(traf);
      if (!fragByTrack[trackId]) fragByTrack[trackId] = { samples: [], data: [] };
      fragByTrack[trackId].samples.push(...samples);
      fragByTrack[trackId].data.push(buf.subarray(mdat.dataStart, mdat.dataEnd));
    }

    // movie timescale (for mvhd/tkhd durations)
    const mvVer = buf[mvhd.dataStart];
    const movTimescale = rU32(mvhd.dataStart + 4 + (mvVer === 1 ? 16 : 8));
    let maxMovieDur = 0;

    const tracks = [];
    for (const trak of traks) {
      const trakKids = children(trak.dataStart, trak.dataEnd);
      const tkhd = find(trakKids, "tkhd");
      const tkVer = buf[tkhd.dataStart];
      const trackId = rU32(tkhd.dataStart + 4 + (tkVer === 1 ? 16 : 8));
      const frag = fragByTrack[trackId];
      if (!frag) continue;
      tracks.push({ trak, trakKids, tkhd, trackId, samples: frag.samples, data: concat(frag.data) });
    }
    if (tracks.length === 0) throw new Error("no track fragments found");

    // Build a flat stbl + patched trak for one track.
    function rebuildTrak(t, chunkOffset) {
      const mdia = find(t.trakKids, "mdia");
      const mdiaKids = children(mdia.dataStart, mdia.dataEnd);
      const mdhd = find(mdiaKids, "mdhd");
      const mdhdVer = buf[mdhd.dataStart];
      const timescale = rU32(mdhd.dataStart + 4 + (mdhdVer === 1 ? 16 : 8));
      const minf = find(mdiaKids, "minf");
      const minfKids = children(minf.dataStart, minf.dataEnd);
      const stbl = find(minfKids, "stbl");
      const stblKids = children(stbl.dataStart, stbl.dataEnd);
      const stsd = find(stblKids, "stsd");
      const stsdBuf = slice(stsd);

      const samples = t.samples;
      const totalDur = samples.reduce((a, s) => a + s.dur, 0);
      const movieDur = Math.round((totalDur / timescale) * movTimescale);
      if (movieDur > maxMovieDur) maxMovieDur = movieDur;

      // stts (run-length encoded durations)
      const stts = []; let i = 0;
      while (i < samples.length) { let j = i + 1; while (j < samples.length && samples[j].dur === samples[i].dur) j++; stts.push([j - i, samples[i].dur]); i = j; }
      const sttsBuf = fullbox("stts", 0, 0, u32(stts.length), concat(stts.map(([c, d]) => concat([u32(c), u32(d)]))));
      const stszBuf = fullbox("stsz", 0, 0, u32(0), u32(samples.length), concat(samples.map((s) => u32(s.size))));
      const stscBuf = fullbox("stsc", 0, 0, u32(1), concat([u32(1), u32(samples.length), u32(1)]));
      const stcoBuf = fullbox("stco", 0, 0, u32(1), u32(chunkOffset));

      const parts = [stsdBuf, sttsBuf, stscBuf, stszBuf, stcoBuf];
      const sync = [];
      samples.forEach((s, idx) => { if (((s.flags >> 16) & 0x1) === 0) sync.push(idx + 1); });
      if (sync.length > 0 && sync.length < samples.length) {
        parts.push(fullbox("stss", 0, 0, u32(sync.length), concat(sync.map((n) => u32(n)))));
      }
      if (samples.some((s) => s.cto !== 0)) {
        const ctts = []; let k = 0;
        while (k < samples.length) { let j = k + 1; while (j < samples.length && samples[j].cto === samples[k].cto) j++; ctts.push([j - k, samples[k].cto]); k = j; }
        parts.push(fullbox("ctts", 1, 0, u32(ctts.length), concat(ctts.map(([c, o]) => concat([u32(c), s32(o)])))));
      }
      const newStbl = box("stbl", ...parts);
      const newMinf = box("minf", ...minfKids.map((b) => (b.type === "stbl" ? newStbl : slice(b))));

      // patch mdhd duration
      const mdhdBuf = slice(mdhd).slice(); // copy; offsets below are box-relative
      const mdv = new DataView(mdhdBuf.buffer);
      if (mdhdVer === 1) mdv.setBigUint64(8 + 4 + 8 + 8 + 4, BigInt(totalDur)); // v1: 64-bit times
      else mdv.setUint32(8 + 4 + 4 + 4 + 4, totalDur >>> 0); // v0: dur at box offset 24
      const newMdia = box("mdia", ...mdiaKids.map((b) => (b.type === "minf" ? newMinf : b.type === "mdhd" ? mdhdBuf : slice(b))));

      // patch tkhd duration (movie timescale)
      const tkhdBuf = slice(t.tkhd).slice();
      const tkv = new DataView(tkhdBuf.buffer);
      const tkVer = tkhdBuf[8];
      if (tkVer === 1) tkv.setBigUint64(8 + 4 + 8 + 8 + 4 + 4, BigInt(movieDur));
      else tkv.setUint32(8 + 4 + 4 + 4 + 4 + 4, movieDur >>> 0);
      const newTrak = box("trak", ...t.trakKids.map((b) => (b.type === "mdia" ? newMdia : b.type === "tkhd" ? tkhdBuf : slice(b))));
      return newTrak;
    }

    function buildMoov(chunkOffsets) {
      maxMovieDur = 0;
      const newTraks = tracks.map((t, ti) => rebuildTrak(t, chunkOffsets[ti]));
      // patch mvhd duration
      const mvhdBuf = slice(mvhd).slice();
      const mv = new DataView(mvhdBuf.buffer);
      if (mvVer === 1) mv.setBigUint64(8 + 4 + 8 + 8 + 4, BigInt(maxMovieDur));
      else mv.setUint32(8 + 4 + 4 + 4 + 4, maxMovieDur >>> 0);
      return box("moov", mvhdBuf, ...newTraks);
    }

    // Two passes: first to size moov, second with real chunk offsets.
    const moov1 = buildMoov(tracks.map(() => 0));
    const ftypBuf = slice(ftyp);
    let base = ftypBuf.length + moov1.length + 8; // + mdat header
    const chunkOffsets = []; let acc = base;
    for (const t of tracks) { chunkOffsets.push(acc); acc += t.data.length; }
    const moov2 = buildMoov(chunkOffsets);
    if (moov2.length !== moov1.length) throw new Error("moov size changed between passes");

    const mdatBody = concat(tracks.map((t) => t.data));
    const mdat = concat([u32(mdatBody.length + 8), str("mdat"), mdatBody]);
    return concat([ftypBuf, moov2, mdat]);
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { flattenFragmentedMp4 };
  global.flattenFragmentedMp4 = flattenFragmentedMp4;
})(typeof self !== "undefined" ? self : globalThis);
