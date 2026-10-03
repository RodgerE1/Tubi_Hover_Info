/* Shared, dependency-free helpers. No remote JavaScript is evaluated. */
(function (root) {
  "use strict";
  const DEFAULTS = Object.freeze({ enabled: true, hoverDelay: 450, fontSize: 16, showArtwork: true });
  const allowedHosts = new Set(["tubitv.com", "www.tubitv.com", "tubi.tv", "www.tubi.tv"]);

  function titleURL(value, base = "https://tubitv.com/") {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, base);
      if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || url.username || url.password || url.port) return null;
      const match = url.pathname.match(/^\/(?:([a-z]{2}-[a-z]{2})\/)?(movies|series|tv-shows)\/(\d+)(?:\/([^/]*))?\/?$/i);
      if (!match) return null;
      const locale = (match[1] || "").toLowerCase();
      const kind = match[2].toLowerCase();
      const path = `/${locale ? `${locale}/` : ""}${kind}/${match[3]}${match[4] ? `/${match[4]}` : ""}`;
      return { url: `https://tubitv.com${path}`, id: match[3], kind, locale, key: `${locale}/${kind}/${match[3]}` };
    } catch (_) { return null; }
  }

  function settings(input = {}) {
    if (!input || typeof input !== "object") input = {};
    const clamp = (n, fallback, min, max) => Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Number(n))) : fallback;
    return {
      enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULTS.enabled,
      hoverDelay: clamp(input.hoverDelay, DEFAULTS.hoverDelay, 150, 1500),
      fontSize: clamp(input.fontSize, DEFAULTS.fontSize, 14, 20),
      showArtwork: typeof input.showArtwork === "boolean" ? input.showArtwork : DEFAULTS.showArtwork
    };
  }

  function text(value, max = 4000) {
    return typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  function list(value) {
    const items = value == null ? [] : Array.isArray(value) ? value : [value];
    return [...new Set(items.map(item => text(typeof item === "object" && item ? item.name || item.label || item.title : item, 160)).filter(Boolean))].slice(0, 80);
  }

  function duration(value) {
    if (!value) return "";
    let seconds;
    if (typeof value === "number") seconds = value;
    else {
      const match = String(value).match(/^P(?:(\d+)D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
      if (!match) return text(value, 60);
      seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
  }

  function imageURL(value) {
    if (Array.isArray(value)) value = value[0];
    if (value && typeof value === "object") value = value.url || value.contentUrl;
    if (typeof value !== "string") return "";
    try {
      const url = new URL(value, "https://tubitv.com/");
      if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
      return url.hostname === "tubitv.com" || url.hostname.endsWith(".tubitv.com") ? url.href : "";
    } catch (_) { return ""; }
  }

  function imdbURL(value) {
    const id = imdbID(value);
    return id ? `https://www.imdb.com/title/${id}/` : "";
  }

  function imdbID(value) {
    const match = text(value, 300).match(/^(?:https:\/\/(?:www\.)?imdb\.com\/title\/)?(tt\d+)\/?$/);
    return match ? match[1] : "";
  }

  function apiKey(value) {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return /^[A-Za-z0-9]{16,128}$/.test(normalized) ? normalized : "";
  }

  function tmdbRating(value) {
    if (!value || typeof value !== "object") return null;
    const score = Number(value.score);
    const votes = Number(value.votes);
    const id = Number(value.id);
    const mediaType = value.mediaType === "tv" ? "tv" : value.mediaType === "movie" ? "movie" : "";
    if (!Number.isFinite(score) || score <= 0 || score > 10 || !Number.isInteger(id) || id <= 0 || !mediaType) return null;
    return {
      score: Math.round(score * 10) / 10,
      votes: Number.isFinite(votes) && votes > 0 ? Math.floor(votes) : 0,
      id,
      mediaType,
      url: `https://www.themoviedb.org/${mediaType}/${id}`
    };
  }

  function tmdbLabel(value) {
    const rating = tmdbRating(value);
    return rating ? `TMDB ${rating.score.toFixed(1)}/10` : "";
  }

  /* Read serialized page data as JSON, replacing only bare undefined/NaN tokens.
     This never uses eval(), Function(), script injection, or a page-world bridge. */
  function assignedObject(source, name = "window.__data") {
    if (typeof source !== "string" || source.length > 4000000) return null;
    const prefix = source.indexOf(name);
    if (prefix < 0) return null;
    let start = prefix + name.length;
    while (/\s/.test(source[start] || "")) start++;
    if (source[start++] !== "=") return null;
    while (/\s/.test(source[start] || "")) start++;
    if (source[start] !== "{") return null;
    let depth = 0, quoted = false, escaped = false, result = "";
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        result += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; result += char; continue; }
      const token = (char === "u" || char === "N") ? source.slice(i, i + 40).match(/^(undefined|NaN)(?=\s*[,}\]])/) : null;
      if (token) { result += "null"; i += token[1].length - 1; continue; }
      if (char === "{" || char === "[") depth++;
      if (char === "}" || char === "]") depth--;
      result += char;
      if (depth === 0) {
        try { return JSON.parse(result); } catch (_) { return null; }
      }
    }
    return null;
  }

  const api = Object.freeze({ DEFAULTS, titleURL, settings, text, list, duration, imageURL, imdbURL, imdbID, apiKey, tmdbRating, tmdbLabel, assignedObject });
  root.TubiHoverCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
