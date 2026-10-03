"use strict";
if (!globalThis.TubiHoverCore && typeof importScripts === "function") importScripts("core.js");

const C = globalThis.TubiHoverCore;
const pending = new Map();
const pages = new Map();
const TTL = 30 * 60 * 1000;
const MAX_PAGES = 12;
const tmdbPages = new Map();
const tmdbPending = new Map();
const TMDB_TTL = 6 * 60 * 60 * 1000;
const MAX_TMDB_PAGES = 160;

async function titlePage(target) {
  const cached = pages.get(target.key);
  if (cached && Date.now() - cached.at < TTL) return cached.html;
  if (pending.has(target.key)) return pending.get(target.key);
  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(target.url, { credentials: "omit", signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 429 ? "Tubi is busy. Try again in a moment." : `Tubi could not return details (HTTP ${response.status}).`);
      const finalURL = C.titleURL(response.url || target.url);
      if (!finalURL || finalURL.id !== target.id || finalURL.kind !== target.kind) throw new Error("Tubi redirected this title. Open its page for details.");
      if (!(response.headers.get("content-type") || "").includes("text/html")) throw new Error("Tubi did not return a title page.");
      const html = await response.text();
      if (html.length > 4000000) throw new Error("This Tubi page is too large to read.");
      pages.delete(target.key);
      pages.set(target.key, { at: Date.now(), html });
      while (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value);
      return html;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Tubi took too long to respond. Try again.");
      throw error;
    } finally { clearTimeout(timeout); }
  })();
  pending.set(target.key, task);
  try { return await task; } finally { pending.delete(target.key); }
}

function storedTMDBKey() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get("tmdbApiKey", result => resolve(C.apiKey(result?.tmdbApiKey)));
    } catch (_) { resolve(""); }
  });
}

function yearNumber(value) {
  return Number(C.text(value, 40).match(/\b(?:18|19|20)\d{2}\b/)?.[0] || 0);
}

function normalizedTitle(value) {
  return C.text(value, 300).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tmdbCandidate(item, mediaType) {
  if (!item || typeof item !== "object") return null;
  const rating = C.tmdbRating({
    score: item.vote_average,
    votes: item.vote_count,
    id: item.id,
    mediaType
  });
  return rating ? { rating, title: C.text(item.title || item.name, 300), year: yearNumber(item.release_date || item.first_air_date) } : null;
}

function selectSearchResult(results, title, year) {
  const targetTitle = normalizedTitle(title);
  const candidates = (Array.isArray(results) ? results : [])
    .filter(item => item?.media_type === "movie" || item?.media_type === "tv")
    .map(item => tmdbCandidate(item, item.media_type))
    .filter(Boolean);
  if (!candidates.length) return null;
  const exact = candidates.find(item => normalizedTitle(item.title) === targetTitle && (!year || !item.year || item.year === year));
  if (exact) return exact;
  const sameYear = year ? candidates.find(item => item.year === year) : null;
  return sameYear || candidates[0];
}

async function tmdbJSON(url, key) {
  const request = new URL(url);
  request.searchParams.set("api_key", key);
  request.searchParams.set("language", "en-US");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(request.href, {
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 401) throw new Error("TMDB rejected the API key. Check it in the extension settings.");
    if (response.status === 429) throw new Error("TMDB rate limit reached. Try again later.");
    if (!response.ok) throw new Error(`TMDB returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("TMDB took too long to respond.");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function tmdbLookup(target) {
  const key = await storedTMDBKey();
  if (!key) return null;
  const imdbId = C.imdbID(target.imdb);
  const title = C.text(target.title, 300);
  const year = yearNumber(target.year);
  const cacheKey = imdbId || `${normalizedTitle(title)}|${year || ""}`;
  if (!cacheKey) return null;
  const cached = tmdbPages.get(cacheKey);
  if (cached && Date.now() - cached.at < TMDB_TTL) return cached.rating;
  if (tmdbPending.has(cacheKey)) return tmdbPending.get(cacheKey);
  const task = (async () => {
    let selected = null;
    if (imdbId) {
      const endpoint = `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}`;
      const data = await tmdbJSON(endpoint, key);
      const groups = [[data.movie_results, "movie"], [data.tv_results, "tv"], [data.tv_episode_results, "tv"]];
      for (const [items, mediaType] of groups) {
        const candidate = Array.isArray(items) ? tmdbCandidate(items[0], mediaType) : null;
        if (candidate) { selected = candidate; break; }
      }
    }
    if (!selected && title) {
      const endpoint = new URL("https://api.themoviedb.org/3/search/multi");
      endpoint.searchParams.set("query", title);
      endpoint.searchParams.set("include_adult", "false");
      const data = await tmdbJSON(endpoint.href, key);
      selected = selectSearchResult(data.results, title, year);
    }
    const rating = selected?.rating || null;
    tmdbPages.set(cacheKey, { at: Date.now(), rating });
    while (tmdbPages.size > MAX_TMDB_PAGES) tmdbPages.delete(tmdbPages.keys().next().value);
    return rating;
  })();
  tmdbPending.set(cacheKey, task);
  try { return await task; } finally { tmdbPending.delete(cacheKey); }
}

function senderIsTubi(sender) {
  try {
    const senderURL = new URL(sender.url || sender.tab?.url || "");
    return senderURL.protocol === "https:" && ["tubitv.com", "www.tubitv.com", "tubi.tv", "www.tubi.tv"].includes(senderURL.hostname);
  } catch (_) { return false; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "TUBI_HOVER_FETCH" && message?.type !== "TUBI_HOVER_TMDB") return false;
  const senderOK = senderIsTubi(sender);
  if (message.type === "TUBI_HOVER_TMDB") {
    if (!senderOK) { respond({ ok: false, error: "This request is not from a Tubi page." }); return false; }
    const target = {
      imdb: C.imdbURL(message.imdb),
      title: C.text(message.title, 300),
      year: C.text(message.year, 40)
    };
    tmdbLookup(target).then(rating => respond({ ok: true, rating })).catch(error => respond({ ok: false, error: error.message || "TMDB details are unavailable." }));
    return true;
  }
  const target = C.titleURL(message.url);
  if (!senderOK || !target) { respond({ ok: false, error: "This request is not a Tubi title." }); return false; }
  if (message.force === true) pages.delete(target.key);
  titlePage(target).then(html => respond({ ok: true, html })).catch(error => respond({ ok: false, error: error.message || "Details are unavailable. Try again." }));
  return true;
});
