"use strict";
const C = globalThis.TubiHoverCore;
const fields = Object.fromEntries(Object.keys(C.DEFAULTS).map(key => [key, document.getElementById(key)]));
const tmdbApiKey = document.getElementById("tmdbApiKey");
const clearApiKey = document.getElementById("clearApiKey");
let saveTicket = 0;
function labels() {
  document.getElementById("delayValue").textContent = `${(Number(fields.hoverDelay.value) / 1000).toFixed(2)} seconds`;
  document.getElementById("fontValue").textContent = `${fields.fontSize.value} px`;
}
function values() {
  return C.settings({ enabled: fields.enabled.checked, hoverDelay: Number(fields.hoverDelay.value), fontSize: Number(fields.fontSize.value), showArtwork: fields.showArtwork.checked });
}
for (const field of Object.values(fields)) {
  field.addEventListener("input", () => {
    labels();
    const thisTicket = ++saveTicket;
    chrome.storage.local.set({ preferences: values() }, () => {
      if (thisTicket !== saveTicket) return;
      document.getElementById("saved").textContent = chrome.runtime.lastError ? "Could not save settings. Reopen this popup." : "Saved. Your Tubi tabs are updated.";
    });
  });
}
function saveTMDBKey(message = "TMDB key saved locally. Your Tubi tabs are updated.") {
  const key = C.apiKey(tmdbApiKey.value);
  tmdbApiKey.value = key;
  chrome.storage.local.set({ tmdbApiKey: key }, () => {
    document.getElementById("saved").textContent = chrome.runtime.lastError ? "Could not save the TMDB key." : message;
  });
}
tmdbApiKey.addEventListener("change", () => saveTMDBKey());
tmdbApiKey.addEventListener("blur", () => saveTMDBKey());
clearApiKey.addEventListener("click", () => {
  tmdbApiKey.value = "";
  saveTMDBKey("TMDB key cleared. Tubi details still work without it.");
});
chrome.storage.local.get(["preferences", "tmdbApiKey"], result => {
  const preferences = C.settings(result.preferences);
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "checkbox") field.checked = preferences[key];
    else field.value = preferences[key];
  }
  tmdbApiKey.value = C.apiKey(result.tmdbApiKey);
  labels();
});
