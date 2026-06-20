/*! coi-serviceworker v0.1.7 — Cross-Origin Isolation via service worker.
    Source: github.com/gzuidhof/coi-serviceworker (MIT). Lets ffmpeg.wasm use
    SharedArrayBuffer on static hosts (GitHub Pages) that can't set COOP/COEP headers. */
let coepCredentialless = false;
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("message", (ev) => {
    if (!ev.data) return;
    if (ev.data.type === "deregister") {
      self.registration.unregister().then(() =>
        self.clients.matchAll().then((cs) => cs.forEach((c) => c.navigate(c.url))));
    } else if (ev.data.type === "coepCredentialless") {
      coepCredentialless = ev.data.value;
    }
  });

  self.addEventListener("fetch", (event) => {
    const r = event.request;
    if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;
    const req = coepCredentialless && r.mode === "no-cors"
      ? new Request(r, { credentials: "omit" })
      : r;
    event.respondWith(
      fetch(req).then((response) => {
        if (response.status === 0) return response;
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy",
          coepCredentialless ? "credentialless" : "require-corp");
        if (!coepCredentialless) headers.set("Cross-Origin-Resource-Policy", "cross-origin");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }).catch((e) => console.error(e))
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
    window.sessionStorage.removeItem("coiReloadedBySelf");
    const coep = reloadedBySelf === "coepdegrade" ? "credentialless" : "require-corp";
    const n = navigator;
    if (n.serviceWorker && n.serviceWorker.controller) {
      n.serviceWorker.controller.postMessage({ type: "coepCredentialless", value: coep === "credentialless" });
    }
    if (!window.crossOriginIsolated && n.serviceWorker) {
      n.serviceWorker.register(window.document.currentScript.src).then(
        (reg) => {
          reg.addEventListener("updatefound", () => {
            window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
            window.location.reload();
          });
          if (reg.active && !n.serviceWorker.controller) {
            window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
            window.location.reload();
          }
        },
        (err) => console.error("COOP/COEP Service Worker failed to register:", err)
      );
    }
  })();
}
