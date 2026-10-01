/* Read only the selected card's public movie data already held by Tubi's UI. */
(function () {
  "use strict";
  const text = (v, n = 4000) => typeof v === "string" || typeof v === "number" ? String(v).slice(0, n) : "";
  const list = v => (Array.isArray(v) ? v : []).slice(0, 80).map(x => text(x && typeof x === "object" ? x.name || x.label || x.title : x, 160)).filter(Boolean);
  document.addEventListener("tubi-hover-card-request", event => {
    let request;
    try { request = JSON.parse(event.detail); } catch (_) { return; }
    if (!request || typeof request !== "object" || !/^\d+$/.test(request.id || "") || typeof request.nonce !== "string" || request.nonce.length > 80) return;
    const anchor = event.target;
    if (!(anchor instanceof Element)) return;
    const tile = anchor.closest('[data-test-id="web-ui-content-tile"],.web-content-tile,[data-content-id]') || anchor;
    const key = Object.keys(tile).find(k => k.startsWith("__reactFiber$"));
    let fiber = key && tile[key], item = null;
    // Walk the card's component parents, without reading stores or account state.
    for (let n = 0; fiber && n < 18; n++, fiber = fiber.return) {
      const value = fiber.memoizedProps?.content;
      if (value && text(value.id) === request.id && value.title) { item = value; break; }
    }
    let result = null;
    if (item) {
      result = {
        id: text(item.id, 30), title: text(item.title, 300), description: text(item.description),
        year: text(item.year, 20), duration: typeof item.duration === "number" ? item.duration : text(item.duration, 60),
        actors: list(item.actors), directors: list(item.directors), tags: list(item.tags || item.genres),
        ratings: [{ code: text(item.ratings?.[0]?.code || item.ratings?.[0]?.value, 40) }],
        lang: text(item.lang, 100), imdb_id: text(item.imdb_id, 100),
        posterarts: [text(item.posterarts?.[0] || item.images?.posterarts?.[0], 2000)],
        subtitles: (Array.isArray(item.subtitles) ? item.subtitles : []).slice(0, 80).map(s => ({ lang: text(s.lang_translation || s.lang, 100) })),
        season_count: Math.min(100, Array.isArray(item.seasons) ? item.seasons.length : 0)
      };
    }
    document.dispatchEvent(new CustomEvent("tubi-hover-card-response", {
      detail: JSON.stringify({ nonce: request.nonce, id: request.id, item: result })
    }));
  });
})();
