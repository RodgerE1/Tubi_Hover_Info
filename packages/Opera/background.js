"use strict";
if (!globalThis.TubiHoverCore && typeof importScripts === "function") importScripts("core.js");

const C = globalThis.TubiHoverCore;
const pending = new Map();
const pages = new Map();
const TTL = 30 * 60 * 1000;
const MAX_PAGES = 12;

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

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "TUBI_HOVER_FETCH") return false;
  let senderOK = false;
  try {
    const senderURL = new URL(sender.url || sender.tab?.url || "");
    senderOK = senderURL.protocol === "https:" && ["tubitv.com", "www.tubitv.com", "tubi.tv", "www.tubi.tv"].includes(senderURL.hostname);
  } catch (_) { /* Reject non-Tubi senders. */ }
  const target = C.titleURL(message.url);
  if (!senderOK || !target) { respond({ ok: false, error: "This request is not a Tubi title." }); return false; }
  if (message.force === true) pages.delete(target.key);
  titlePage(target).then(html => respond({ ok: true, html })).catch(error => respond({ ok: false, error: error.message || "Details are unavailable. Try again." }));
  return true;
});
