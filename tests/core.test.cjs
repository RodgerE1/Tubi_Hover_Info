"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../source/core.js");

test("Tubi movie, show, episode, and localized URLs are recognized", () => {
  assert.equal(C.titleURL("/movies/123/example?tracking=1#details").url, "https://tubitv.com/movies/123/example");
  assert.equal(C.titleURL("https://tubi.tv/series/300/example").kind, "series");
  assert.equal(C.titleURL("/tv-shows/501/example").id, "501");
  assert.equal(C.titleURL("/en-gb/movies/123/example").key, "en-gb/movies/123");
});
test("other sites, credentialed URLs, scripts, and unrelated Tubi paths are rejected", () => {
  for (const value of [undefined, null, "", "https://evil.example/movies/123/x", "https://tubitv.com.evil.example/movies/123/x", "https://user@tubitv.com/movies/123/x", "javascript:alert(1)", "https://tubitv.com:444/movies/123/x", "/category/horror", "/movies/not-a-number/x", "/movies/123/x/extra"]) assert.equal(C.titleURL(value), null, String(value));
});
test("runtime formats match the nearest minute", () => {
  assert.equal(C.duration("PT1H41M47S"), "1 hr 42 min");
  assert.equal(C.duration(2700), "45 min");
  assert.equal(C.duration("PT2H"), "2 hr");
  assert.equal(C.duration(0), "");
});
test("poster URLs accept only HTTPS Tubi images", () => {
  assert.equal(C.imageURL("//canvas-lb.tubitv.com/opts/image"), "https://canvas-lb.tubitv.com/opts/image");
  assert.equal(C.imageURL({ url: "https://canvas.tubitv.com/x" }), "https://canvas.tubitv.com/x");
  assert.equal(C.imageURL("https://evil.example/x"), "");
  assert.equal(C.imageURL("data:image/svg+xml,anything"), "");
});
test("exact IMDb identifiers are validated", () => {
  assert.equal(C.imdbURL("tt12345"), "https://www.imdb.com/title/tt12345/");
  assert.equal(C.imdbURL("https://www.imdb.com/title/tt12345/"), "https://www.imdb.com/title/tt12345/");
  assert.equal(C.imdbURL("https://evil.example/title/tt12345/"), "");
  assert.equal(C.imdbID("https://www.imdb.com/title/tt12345/"), "tt12345");
  assert.equal(C.imdbID("not-an-imdb-id"), "");
});
test("TMDB keys and ratings are normalized safely", () => {
  assert.equal(C.apiKey("  1234567890abcdef1234567890abcdef  "), "1234567890abcdef1234567890abcdef");
  assert.equal(C.apiKey("not a key"), "");
  assert.deepEqual(C.tmdbRating({ score: 7.36, votes: 1250, id: 123, mediaType: "movie" }), { score: 7.4, votes: 1250, id: 123, mediaType: "movie", url: "https://www.themoviedb.org/movie/123" });
  assert.equal(C.tmdbLabel({ score: 8, votes: 10, id: 7, mediaType: "tv" }), "TMDB 8.0/10");
  assert.equal(C.tmdbRating({ score: 0, votes: 0, id: 7, mediaType: "tv" }), null);
});
test("invalid preferences fall back and numeric preferences are bounded", () => {
  assert.deepEqual(C.settings(null), C.DEFAULTS);
  assert.equal(C.settings({ hoverDelay: 0 }).hoverDelay, 150);
  assert.equal(C.settings({ fontSize: 500 }).fontSize, 20);
  assert.equal(C.settings({ hoverDelay: "invalid" }).hoverDelay, 450);
  assert.equal(C.settings({ enabled: "false" }).enabled, true);
});
test("serialized state is parsed without evaluating remote code", () => {
  const value = C.assignedObject('window.__data={"video":{"byId":{"7":{"id":"7","title":"A {quoted} title","missing":undefined,"text":"undefined","nested":[{"x":NaN}]}}}};window.BAD=true;');
  assert.equal(value.video.byId["7"].title, "A {quoted} title");
  assert.equal(value.video.byId["7"].missing, null);
  assert.equal(value.video.byId["7"].text, "undefined");
  assert.equal(value.video.byId["7"].nested[0].x, null);
  assert.equal(C.assignedObject('window.__data={"x":(()=>{throw Error()})()}'), null);
});
test("malformed state is harmless", () => {
  assert.equal(C.assignedObject("window.__data={broken}"), null);
  assert.equal(C.assignedObject('window.__data={"x":1'), null);
  assert.equal(C.assignedObject("window.__data+= {}"), null);
});
