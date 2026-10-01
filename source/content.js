(function () {
  "use strict";
  if (document.getElementById("tubi-hover-info-root")) return;
  const C = globalThis.TubiHoverCore;
  const M = globalThis.TubiHoverMetadata;
  const TILE = '[data-test-id="web-ui-content-tile"],.web-content-tile,[data-content-id]';
  const cache = new Map();
  let preferences = C.settings();
  let active = null, candidate = null, pinned = false, blockedKey = "";
  let showTimer = null, hideTimer = null, ticket = 0, castExpanded = false;
  let lastURL = location.href;
  let currentData = null;

  const host = document.createElement("div");
  host.id = "tubi-hover-info-root";
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = chrome.runtime.getURL("panel.css");
  shadow.append(style);
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "thi-title");
  // Static markup only. All Tubi content is added with textContent or checked URLs.
  panel.innerHTML = `<div class="bar"><span class="brand">Tubi Hover Info</span><button class="pin" type="button" aria-pressed="false" title="Keep these details open">Pin</button><button class="close" type="button" aria-label="Close details" title="Close (Esc)">\u00d7</button></div>
    <div class="body"><div class="intro"><img class="poster" hidden alt="" referrerpolicy="no-referrer"><div class="intro-text"><p class="kind"></p><h2 id="thi-title"></h2><div class="facts"></div></div></div>
    <div class="genres"></div><p class="description"></p><dl class="credits"></dl>
    <div class="status" role="status"><span></span><button class="retry" type="button" hidden>Retry</button></div>
    <div class="actions"><a class="primary tubi-link">Open on Tubi</a><a class="imdb-link" target="_blank" rel="noopener noreferrer">IMDb</a></div>
    <p class="footer">Details from Tubi \u00b7 Pin to keep open \u00b7 Esc to close</p></div>`;
  shadow.append(panel);
  document.documentElement.append(host);
  const $ = selector => shadow.querySelector(selector);

  function setStatus(message = "", loading = false, error = false) {
    const status = $(".status");
    status.hidden = !message;
    status.dataset.loading = String(loading);
    status.dataset.error = String(error);
    status.querySelector("span").textContent = message;
    $(".retry").hidden = !error;
  }

  function applyAppearance() {
    host.style.setProperty("--thi-font", `${preferences.fontSize}px`);
    $(".poster").hidden = !preferences.showArtwork || !currentData?.poster;
    if (!host.hidden) position();
  }

  function position() {
    if (!active || host.hidden) return;
    const margin = 12, width = Math.min(430, innerWidth - 2 * margin);
    const maxHeight = Math.max(100, Math.min(680, innerHeight - 2 * margin));
    host.style.setProperty("width", `${Math.max(200, width)}px`, "important");
    host.style.setProperty("--thi-height", `${maxHeight}px`);
    const rect = active.anchor.getBoundingClientRect();
    const height = Math.min(panel.getBoundingClientRect().height || 380, maxHeight);
    let left, top;
    if (rect.right + margin + width <= innerWidth - margin) { left = rect.right + margin; top = rect.top; }
    else if (rect.left - margin - width >= margin) { left = rect.left - margin - width; top = rect.top; }
    else {
      left = Math.min(Math.max(margin, rect.left), innerWidth - width - margin);
      top = rect.bottom + margin;
      if (top + height > innerHeight - margin) top = rect.top - height - margin;
    }
    host.style.setProperty("left", `${Math.max(margin, left)}px`, "important");
    host.style.setProperty("top", `${Math.max(margin, Math.min(top, innerHeight - height - margin))}px`, "important");
  }

  function render(data) {
    currentData = data;
    $("#thi-title").textContent = data.title || "Tubi title";
    $(".kind").textContent = data.kind || "Movie or show";
    const poster = $(".poster");
    const posterURL = C.imageURL(data.poster);
    if (posterURL) {
      if (poster.getAttribute("src") !== posterURL) poster.src = posterURL;
      poster.alt = `${data.title} poster`;
    } else poster.removeAttribute("src");
    poster.hidden = !preferences.showArtwork || !posterURL;
    const facts = $(".facts");
    facts.replaceChildren();
    for (const value of [data.year, data.duration, data.rating, data.seasons ? `${data.seasons} season${data.seasons === 1 ? "" : "s"} on Tubi` : ""]) {
      if (!value) continue;
      const span = document.createElement("span"); span.className = "fact"; span.textContent = value; facts.append(span);
    }
    const genres = $(".genres"); genres.replaceChildren();
    for (const value of data.genres || []) {
      const span = document.createElement("span"); span.className = "genre"; span.textContent = value; genres.append(span);
    }
    genres.hidden = !genres.childElementCount;
    $(".description").textContent = data.description || "Loading the synopsis\u2026";
    const credits = $(".credits"); credits.replaceChildren();
    function credit(label, value) {
      if (!value) return null;
      const row = document.createElement("div"); row.className = "credit";
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = value;
      row.append(dt, dd); credits.append(row); return row;
    }
    credit(data.directors?.length > 1 ? "Directors" : "Director", data.directors?.join(", "));
    const cast = data.cast || [];
    const castRow = credit("Cast", (castExpanded ? cast : cast.slice(0, 5)).join(", "));
    if (castRow && cast.length > 5) {
      const button = document.createElement("button"); button.type = "button"; button.className = "cast-toggle";
      button.textContent = castExpanded ? "Show less" : `Show all ${cast.length} cast members`;
      button.setAttribute("aria-expanded", String(castExpanded));
      button.addEventListener("click", () => {
        castExpanded = !castExpanded; render(currentData);
        $(".cast-toggle")?.focus({ preventScroll: true }); clearTimeout(hideTimer);
      }); castRow.append(button);
    }
    credit("Language", data.language);
    credit("Subtitles", data.subtitles?.join(", "));
    $(".tubi-link").href = active.url;
    $(".imdb-link").href = C.imdbURL(data.imdb) || `https://www.imdb.com/find/?q=${encodeURIComponent(data.title || "")}&s=tt`;
    $(".imdb-link").textContent = C.imdbURL(data.imdb) ? "IMDb" : "Find on IMDb";
    applyAppearance();
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, response => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error("Reload this Tubi tab after installing or updating the extension."));
          else if (!response?.ok) reject(new Error(response?.error || "Details are unavailable. Try again."));
          else resolve(response);
        });
      } catch (_) { reject(new Error("Reload this Tubi tab after installing or updating the extension.")); }
    });
  }

  async function requestPage(selection, force) {
    // Same-origin requests retain Tubi's normal page request context. Some
    // catalog responses omit their metadata when fetched from an extension.
    if (location.origin === "https://tubitv.com") {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const path = new URL(selection.url).pathname;
        const response = await fetch(path, {
          credentials: "omit", signal: controller.signal,
          cache: "no-store"
        });
        const finalURL = C.titleURL(response.url || selection.url);
        if (response.ok && finalURL?.id === selection.id && finalURL.kind === selection.kind && (response.headers.get("content-type") || "").includes("text/html")) {
          return { ok: true, html: await response.text() };
        }
      } catch (_) { /* Use the restricted background fallback if needed. */ }
      finally { clearTimeout(timeout); }
    }
    return send({ type: "TUBI_HOVER_FETCH", url: selection.url, force });
  }

  function readCard(selection) {
    return new Promise(resolve => {
      const nonce = crypto.randomUUID();
      let timeout;
      const finish = item => {
        clearTimeout(timeout); document.removeEventListener("tubi-hover-card-response", listener);
        try { resolve(M.fromItem(item, selection)); } catch (_) { resolve(null); }
      };
      const listener = event => {
        try {
          const data = JSON.parse(event.detail);
          if (data.nonce === nonce && data.id === selection.id) finish(data.item);
        } catch (_) { /* Ignore unrelated page messages. */ }
      };
      document.addEventListener("tubi-hover-card-response", listener);
      timeout = setTimeout(() => finish(null), 250);
      selection.anchor.dispatchEvent(new CustomEvent("tubi-hover-card-request", {
        bubbles: true, detail: JSON.stringify({ nonce, id: selection.id })
      }));
    });
  }

  async function load(selection, localTicket, force = false) {
    try {
      const card = await readCard(selection);
      if (ticket !== localTicket || active?.key !== selection.key || host.hidden) return;
      if (card?.description) {
        render({ ...selection.preview, ...card }); setStatus(); position();
        cache.set(selection.key, { at: Date.now(), data: card });
        while (cache.size > 80) cache.delete(cache.keys().next().value);
        if (selection.kind !== "series" || card.seasons) return;
      }
      let data = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await requestPage(selection, force || attempt > 0);
        data = M.parse(response.html, selection);
        if (data) break;
        if (ticket !== localTicket || active?.key !== selection.key || host.hidden) return;
      }
      if (!data) throw new Error("Tubi did not include readable details for this title.");
      cache.delete(selection.key);
      cache.set(selection.key, { at: Date.now(), data });
      while (cache.size > 80) cache.delete(cache.keys().next().value);
      if (ticket !== localTicket || active?.key !== selection.key || host.hidden) return;
      render({ ...selection.preview, ...data });
      if (!data.description) $(".description").textContent = "Tubi has not provided a synopsis for this title.";
      setStatus();
      position();
    } catch (error) {
      if (ticket !== localTicket || active?.key !== selection.key || host.hidden) return;
      if (currentData?.description) { setStatus(); return; }
      if (!currentData?.description) $(".description").textContent = "Open the title on Tubi to view its details.";
      setStatus(error.message, false, true);
      position();
    }
  }

  function open(selection) {
    if (!preferences.enabled || pinned || !selection.anchor.isConnected) return;
    clearTimeout(hideTimer);
    active = selection; candidate = null; castExpanded = false;
    const localTicket = ++ticket;
    panel.scrollTop = 0;
    host.hidden = false;
    $(".pin").textContent = "Pin";
    $(".pin").setAttribute("aria-pressed", "false");
    const cached = cache.get(selection.key);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) { render(cached.data); setStatus(); position(); return; }
    let pageData = null;
    try { pageData = M.read(document, selection); } catch (_) { /* The detail-page request remains available. */ }
    render({ ...selection.preview, ...pageData });
    setStatus(pageData?.description ? "Checking title details\u2026" : "Loading details from Tubi\u2026", true);
    position();
    void load(selection, localTicket);
  }

  function hide(block = false) {
    if (block) blockedKey = active?.key || candidate?.key || "";
    clearTimeout(showTimer); clearTimeout(hideTimer);
    const returnFocus = shadow.activeElement && active?.anchor.isConnected;
    if (returnFocus) active.anchor.focus({ preventScroll: true });
    host.hidden = true; pinned = false; active = null; candidate = null; currentData = null; ++ticket;
  }

  function queue(selection) {
    clearTimeout(hideTimer);
    if (!preferences.enabled || pinned || selection.key === blockedKey) return;
    if (active?.key === selection.key && !host.hidden) { active.anchor = selection.anchor; return; }
    if (candidate?.key === selection.key) return;
    clearTimeout(showTimer); ++ticket;
    candidate = selection;
    showTimer = setTimeout(() => open(selection), preferences.hoverDelay);
  }

  function scheduleHide() {
    if (pinned || shadow.activeElement) return;
    clearTimeout(showTimer); candidate = null;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (pinned || shadow.activeElement || panel.matches(":hover") || active?.container.matches(":hover")) return;
      hide();
    }, 450);
  }

  function selectionFor(element) {
    if (!(element instanceof Element) || element === host || host.contains(element)) return null;
    let anchor = element.closest("a[href]");
    let target = anchor && C.titleURL(anchor.getAttribute("href"), location.href);
    const tile = element.closest(TILE);
    if (!target && tile) {
      anchor = [...tile.querySelectorAll("a[href]")].find(link => C.titleURL(link.getAttribute("href"), location.href));
      target = anchor && C.titleURL(anchor.getAttribute("href"), location.href);
    }
    if (!target || !anchor) return null;
    const container = tile || anchor;
    const img = container.querySelector("img");
    const titleLink = container.querySelector(".web-content-tile__title");
    const title = C.text(titleLink?.textContent || img?.alt || anchor.title || anchor.getAttribute("aria-label") || anchor.textContent, 300).replace(/^Watch\s+(.+?)\s+(?:Movie|Show)$/i, "$1");
    const from = selector => C.text(container.querySelector(selector)?.textContent, 100);
    return { ...target, anchor, container, preview: {
      title: title || "Tubi title", kind: target.kind === "series" ? "TV show" : target.kind === "tv-shows" ? "Episode" : "Movie",
      year: from(".web-content-tile__year"), duration: from(".web-content-tile__duration"), rating: from(".web-rating"),
      genres: C.list(from(".web-content-tile__tags").split(/\u00b7/)), poster: C.imageURL(img?.currentSrc || img?.src),
      description: "", cast: [], directors: [], subtitles: [], url: target.url
    } };
  }

  document.addEventListener("pointerover", event => {
    if (event.pointerType === "touch" || event.composedPath().includes(host)) return;
    const selection = selectionFor(event.target);
    if (selection) queue(selection);
    else { blockedKey = ""; scheduleHide(); }
  }, true);
  document.addEventListener("pointerout", event => {
    if (event.composedPath().includes(host)) return;
    if (event.relatedTarget === host || selectionFor(event.relatedTarget)) return;
    blockedKey = ""; scheduleHide();
  }, true);
  document.addEventListener("focusin", event => {
    if (event.composedPath().includes(host)) { clearTimeout(hideTimer); return; }
    const selection = selectionFor(event.target);
    if (selection) queue(selection);
    else scheduleHide();
  }, true);
  panel.addEventListener("pointerenter", () => { clearTimeout(hideTimer); clearTimeout(showTimer); candidate = null; });
  panel.addEventListener("pointerleave", () => {
    if (active?.container.matches(":hover")) return;
    scheduleHide();
  });
  panel.addEventListener("focusout", () => { setTimeout(() => { if (!shadow.activeElement) scheduleHide(); }, 0); });
  $(".pin").addEventListener("click", () => {
    pinned = !pinned; clearTimeout(hideTimer);
    $(".pin").setAttribute("aria-pressed", String(pinned));
    $(".pin").textContent = pinned ? "Pinned" : "Pin";
    if (!pinned && !panel.matches(":hover")) scheduleHide();
  });
  $(".close").addEventListener("click", () => hide(true));
  $(".retry").addEventListener("click", () => {
    if (!active) return;
    setStatus("Loading details from Tubi\u2026", true);
    void load(active, ++ticket, true);
  });
  $(".poster").addEventListener("error", () => { $(".poster").hidden = true; position(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !host.hidden) { event.preventDefault(); hide(true); }
  }, true);
  document.addEventListener("scroll", event => { if (!pinned && !event.composedPath().includes(host)) hide(); }, true);
  window.addEventListener("resize", position);
  window.addEventListener("popstate", () => hide());
  document.addEventListener("visibilitychange", () => { if (document.hidden && !pinned) hide(); });
  new MutationObserver(() => {
    if (location.href !== lastURL) { lastURL = location.href; blockedKey = ""; hide(); }
    else if (active && !active.anchor.isConnected) hide();
  }).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.local.get("preferences", result => { preferences = C.settings(result.preferences); applyAppearance(); if (!preferences.enabled) hide(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.preferences) return;
    preferences = C.settings(changes.preferences.newValue); applyAppearance();
    if (!preferences.enabled) hide();
  });
})();
