/* Tubi's own JSON-LD, embedded title data, and visible detail-page fallbacks. */
(function (root) {
  "use strict";
  const C = root.TubiHoverCore;
  const stateCache = new WeakMap();
  const mediaTypes = new Set(["Movie", "TVSeries", "TVEpisode", "VideoObject"]);
  const meta = (doc, name) => doc.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute("content") || "";
  const types = node => Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];

  function collect(value, output) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(item => collect(item, output)); return; }
    if (types(value).some(type => mediaTypes.has(type))) output.push(value);
    for (const key of ["@graph", "mainEntity", "video"]) if (value[key]) collect(value[key], output);
  }

  function pageItem(doc, target) {
    for (const script of doc.querySelectorAll("script:not([src])")) {
      const source = script.textContent || "";
      if (!source.includes("window.__data")) continue;
      let cached = stateCache.get(script);
      if (!cached || cached.source !== source) {
        cached = { source, value: C.assignedObject(source) };
        stateCache.set(script, cached);
      }
      const content = cached.value?.video || cached.value?.content;
      const item = content?.byId?.[target.id] || content?.idMap?.[target.id];
      if (item && C.text(item.id) === target.id) return item;
    }
    return null;
  }

  function section(doc, labels) {
    for (const heading of doc.querySelectorAll("h2,h3,h4,h5")) {
      if (!labels.includes(C.text(heading.textContent).toLowerCase())) continue;
      const sibling = heading.nextElementSibling;
      if (!sibling) continue;
      const links = [...sibling.querySelectorAll("a")].map(a => C.text(a.textContent));
      return links.length ? C.list(links) : C.list(C.text(sibling.textContent).split(/[,\u00b7]/));
    }
    return [];
  }

  function read(doc, target, suppliedItem = null) {
    const candidates = [];
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { collect(JSON.parse(script.textContent), candidates); } catch (_) { /* An unrelated malformed block is harmless. */ }
    }
    const matches = node => {
      const url = C.titleURL(node.url || node["@id"]?.split("#")[0], target.url);
      return url?.id === target.id && url.kind === target.kind;
    };
    let node = candidates.find(matches);
    const metaTarget = C.titleURL(meta(doc, "og:url") || doc.querySelector('link[rel="canonical"]')?.getAttribute("href"), target.url);
    const isDetail = metaTarget?.id === target.id && metaTarget.kind === target.kind;
    if (!node && isDetail) node = candidates.find(item => !item.url && !item["@id"]);
    node = node || {};
    const item = suppliedItem || pageItem(doc, target) || {};
    const hasData = Boolean(node.name || item.title || isDetail);
    if (!hasData) return null;
    const title = C.text(node.name || item.title || meta(doc, "og:title").replace(/\s*\(\d{4}\)\s*$/, ""), 300);
    const yearMatch = C.text(item.year || node.dateCreated || node.datePublished || node.startDate || node.releasedEvent?.startDate).match(/\b(?:18|19|20)\d{2}\b/);
    const rating = C.text(node.contentRating || item.ratings?.[0]?.code || item.ratings?.[0]?.value, 40);
    const genres = C.list(node.genre || item.tags);
    const cast = C.list(node.actor || item.actors);
    const directors = C.list(node.director || item.directors);
    const sameAs = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
    const imdb = sameAs.map(C.imdbURL).find(Boolean) || C.imdbURL(item.imdb_id);
    const seasonNumbers = new Set();
    if (target.kind === "series") {
      for (const link of doc.querySelectorAll('a[href]')) {
        const href = link.getAttribute("href");
        const series = C.titleURL(href.replace(/\/season-\d+\/?$/, ""), target.url);
        if (series?.kind !== "series" || series.id !== target.id) continue;
        const number = C.text(link.textContent).match(/^Season\s+(\d+)$/i)?.[1] || href.match(/\/season-(\d+)\/?$/)?.[1];
        if (number && Number(number) > 0) seasonNumbers.add(Number(number));
      }
    }
    const seasons = Math.max(Number(node.numberOfSeasons || item.seasons?.length || item.season_count || 0), seasonNumbers.size);
    const result = {
      title,
      description: C.text(node.description || item.description || (isDetail ? meta(doc, "og:description") || meta(doc, "description") : "")),
      year: yearMatch?.[0] || "",
      duration: C.duration(node.duration || item.duration),
      rating,
      kind: target.kind === "series" ? "TV show" : target.kind === "tv-shows" ? "Episode" : "Movie",
      genres: genres.length ? genres : isDetail ? section(doc, ["genres", "genre"]) : [],
      cast: cast.length ? cast : isDetail ? section(doc, ["cast", "starring"]) : [],
      directors: directors.length ? directors : isDetail ? section(doc, ["director", "directors"]) : [],
      poster: C.imageURL(node.image || item.posterarts || item.images?.posterarts || (isDetail ? meta(doc, "og:image") : "")),
      language: C.text(item.lang || node.inLanguage?.name || node.inLanguage, 100),
      subtitles: C.list(item.subtitles?.map(s => s.lang_translation || s.lang)),
      seasons: Number.isInteger(seasons) && seasons > 0 ? seasons : 0,
      imdb,
      url: target.url
    };
    return title ? result : null;
  }

  function parse(html, target) {
    if (typeof html !== "string" || html.length > 4000000) throw new Error("Tubi's response was too large to read.");
    return read(new DOMParser().parseFromString(html, "text/html"), target);
  }

  function fromItem(item, target) {
    if (!item || C.text(item.id) !== target.id) return null;
    return read(new DOMParser().parseFromString("", "text/html"), target, item);
  }

  root.TubiHoverMetadata = Object.freeze({ read, parse, fromItem });
})(globalThis);
