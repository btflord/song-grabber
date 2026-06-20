/* Whoops — download page logic. 100% client-side, no backend. */
(() => {
  "use strict";

  const params = new URLSearchParams(location.hash.slice(1));
  const url = safeDecode(params.get("u"));
  const title = safeDecode(params.get("t")) || "Unknown track";
  const source = safeDecode(params.get("s")) || hostOf(url);
  const art = safeDecode(params.get("a"));

  const $ = (id) => document.getElementById(id);

  if (!url || !/^https?:\/\//i.test(url)) { $("empty").hidden = false; return; }

  // ---- Populate -----------------------------------------------------------
  $("track").hidden = false;
  $("empty").hidden = true;
  $("title").textContent = title;
  $("source").textContent = source || "—";
  if (art) { $("art").style.backgroundImage = `url("${cssEscape(art)}")`; $("art").textContent = ""; }

  const ext = extOf(url) || "audio";
  const nativeFmt = ext.toUpperCase();
  $("chipFormat").textContent = nativeFmt;
  $("downloadLabel").textContent = `Download ${nativeFmt}`;

  // ---- Preview player -----------------------------------------------------
  const audio = $("audio");
  audio.src = url;
  const hero = $("hero"), heroIcon = $("heroIcon");

  hero.addEventListener("click", () => { audio.paused ? audio.play().catch(onPlayErr) : audio.pause(); });
  audio.addEventListener("play", () => { hero.classList.add("playing"); heroIcon.textContent = "❚❚"; $("player").hidden = false; });
  audio.addEventListener("pause", () => { hero.classList.remove("playing"); heroIcon.textContent = "▶"; });
  audio.addEventListener("ended", () => { hero.classList.remove("playing"); heroIcon.textContent = "▶"; });
  audio.addEventListener("loadedmetadata", () => {
    if (isFinite(audio.duration)) { $("dur").textContent = fmtTime(audio.duration); $("chipDur").textContent = fmtTime(audio.duration); $("chipDur").hidden = false; }
  });
  audio.addEventListener("timeupdate", () => {
    if (!seeking && isFinite(audio.duration)) {
      $("seek").value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      $("cur").textContent = fmtTime(audio.currentTime);
    }
  });
  let seeking = false;
  const seek = $("seek");
  seek.addEventListener("input", () => { seeking = true; $("cur").textContent = fmtTime((seek.value / 1000) * (audio.duration || 0)); });
  seek.addEventListener("change", () => { if (isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration; seeking = false; });
  function onPlayErr() { toast("Couldn't preview — the source may block playback. Download still works."); }

  // ---- File size (best-effort HEAD) --------------------------------------
  (async () => {
    try {
      const r = await fetch(url, { method: "HEAD" });
      const len = +r.headers.get("content-length");
      if (len > 0) { $("chipSize").textContent = fmtBytes(len); $("chipSize").hidden = false; }
    } catch { /* CORS may block HEAD; harmless */ }
  })();

  // ---- Download (original) -----------------------------------------------
  $("download").addEventListener("click", async (e) => {
    const btn = e.currentTarget; busy(btn, true);
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      saveBlob(await res.blob(), fileName(title, ext));
      toast("Saved — choose “Save to Files”.");
    } catch (err) {
      const a = Object.assign(document.createElement("a"), { href: url, download: fileName(title, ext) });
      a.click();
      console.warn("fetch failed, used link fallback:", err);
    } finally { busy(btn, false); }
  });

  // ---- Share (Web Share API → iOS share sheet) ---------------------------
  $("share").addEventListener("click", async () => {
    try {
      // Try sharing the actual file; fall back to sharing the link.
      const res = await fetch(url).then(r => r.blob()).catch(() => null);
      const file = res && new File([res], fileName(title, ext), { type: res.type || mimeOf(ext) });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else if (navigator.share) {
        await navigator.share({ title, text: title, url: location.href });
      } else {
        await copyText(location.href); toast("Link copied (sharing unavailable).");
      }
    } catch (err) { if (err && err.name !== "AbortError") toast("Share canceled."); }
  });

  // ---- Copy link ----------------------------------------------------------
  $("copy").addEventListener("click", async () => {
    await copyText(location.href); toast("Link copied.");
  });

  // ---- Convert (ffmpeg.wasm) ---------------------------------------------
  const convertRow = $("convertRow");
  const targets = [
    { fmt: "mp3", label: "MP3" },
    { fmt: "m4a", label: "M4A" },
    { fmt: "wav", label: "WAV" },
  ].filter((t) => t.fmt !== ext);
  for (const t of targets) {
    const chip = document.createElement("button");
    chip.className = "fmt-chip"; chip.type = "button"; chip.textContent = t.label;
    chip.addEventListener("click", () => convert(chip, t.fmt));
    convertRow.appendChild(chip);
  }

  let ffmpeg = null;
  async function convert(chip, target) {
    busy(chip, true);
    const bar = $("bar"); const fill = bar.firstElementChild;
    bar.hidden = false; fill.style.width = "0%";
    try {
      if (!crossOriginIsolated) throw new Error("Reload once to enable in-browser conversion (the service worker turns it on), or use Download.");
      const ff = await loadFFmpeg((p) => fill.style.width = `${Math.round(p * 90)}%`);
      const inName = `in.${ext}`, outName = `out.${target}`;
      await ff.writeFile(inName, new Uint8Array(await (await fetch(url)).arrayBuffer()));
      await ff.exec(["-i", inName, outName]);
      const out = await ff.readFile(outName);
      fill.style.width = "100%";
      saveBlob(new Blob([out.buffer], { type: mimeOf(target) }), fileName(title, target));
      toast(`Converted to ${target.toUpperCase()}.`);
    } catch (err) { toast(err.message || "Conversion failed."); console.error(err); }
    finally { setTimeout(() => bar.hidden = true, 600); busy(chip, false); }
  }
  async function loadFFmpeg(onProgress) {
    if (ffmpeg) return ffmpeg;
    const base = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm";
    const coreBase = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    const { FFmpeg } = await import(`${base}/index.js`);
    const { toBlobURL } = await import("https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js");
    const ff = new FFmpeg();
    ff.on("progress", ({ progress }) => onProgress?.(Math.min(progress, 1)));
    await ff.load({
      coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return (ffmpeg = ff);
  }

  // ---- helpers ------------------------------------------------------------
  let toastT;
  function toast(msg) {
    const el = $("toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  }
  function busy(el, on) { el.dataset.busy = on ? "1" : ""; }
  function saveBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  }
  function fileName(t, e) { return (t.replace(/[\/\\:*?"<>|]+/g, "").trim().slice(0, 80) || "track") + "." + e; }
  function extOf(u) { const m = (u.split("?")[0].match(/\.([a-z0-9]{2,4})$/i) || [])[1]; return m ? m.toLowerCase() : ""; }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
  function mimeOf(f) { return { mp3:"audio/mpeg", m4a:"audio/mp4", wav:"audio/wav", flac:"audio/flac", ogg:"audio/ogg", opus:"audio/opus" }[f] || "audio/*"; }
  function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }
  function fmtBytes(n) { return n >= 1048576 ? (n/1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n/1024)) + " KB"; }
  function safeDecode(v) { try { return v ? decodeURIComponent(v) : ""; } catch { return v || ""; } }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }
})();
