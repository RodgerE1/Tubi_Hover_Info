/* Run against a separate Chromium/Opera debugging profile only.
   Usage: node browser.test.cjs PORT [path-to-result-json]
   Requires Node 22+ (built-in fetch and WebSocket); installs no packages. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Supply the test browser's local debugging port.");
const endpoint = `http://127.0.0.1:${port}`;
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = async (name, action) => { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextID = 1; this.pending = new Map(); this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => { this.ws.addEventListener("open", resolve); this.ws.addEventListener("error", reject, { once: true }); });
    this.ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const task = this.pending.get(message.id); if (!task) return;
        this.pending.delete(message.id); clearTimeout(task.timeout);
        message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result);
      } else for (const handler of this.listeners.get(message.method) || []) void handler(message.params);
    });
  }
  on(event, handler) { this.listeners.set(event, [...(this.listeners.get(event) || []), handler]); }
  async call(method, params = {}) {
    await this.ready; const id = this.nextID++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(Error(`Timed out: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timeout }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Hover extension test</title><style>
body{background:#101620;color:white;font:18px sans-serif;margin:70px}main{display:flex;gap:35px;padding-top:45px}.web-content-tile{width:165px;height:235px;background:#293344;border-radius:12px;padding:14px}.web-content-tile a{display:block;color:#fff1b5;text-decoration:none}.web-content-tile__poster-link{height:170px;border:1px solid #637388;border-radius:8px;padding:20px 8px}.web-content-tile__title{padding-top:12px}#empty{height:100px;margin-top:100px}</style></head><body><h1>Tubi Hover Info — browser test</h1><main>
<div class="web-content-tile" data-test-id="web-ui-content-tile"><a id="movie" class="web-content-tile__poster-link" href="/movies/100054094/anywhere" title="Anywhere">Movie card</a><a class="web-content-tile__title" href="/movies/100054094/anywhere">Anywhere</a></div>
<div class="web-content-tile" data-test-id="web-ui-content-tile"><a id="show" class="web-content-tile__poster-link" href="/series/300009559/farscape" title="Farscape">TV show card</a><a class="web-content-tile__title" href="/series/300009559/farscape">Farscape</a></div></main><div id="empty">Empty space</div></body></html>`;
const titleFixtures = {
  "/movies/100054094/anywhere": {
    "@type":"Movie", name:"Anywhere", description:"A deterministic movie synopsis used to check the hover panel's layout and interaction.",
    dateCreated:"2026-01-01", duration:"PT1H41M47S", contentRating:"TV-MA", genre:["Thriller","Crime","Drama"],
    director:[{name:"Adam Seidel"}], actor:["Hayley McFarland","Joshua Burge","Sean Gunn","Ryan Francis","Annie Funke","Mary Buss","Ben Hall","Jonathan Lipnicki"].map(name=>({name})),
    sameAs:["https://www.imdb.com/title/tt30874228/"]
  },
  "/series/300009559/farscape": {
    "@type":"TVSeries", name:"Farscape", description:"A deterministic series synopsis used to check the hover panel's cast and season fields.",
    dateCreated:"2003-01-01", contentRating:"TV-14", genre:["Sci-Fi","Action"], numberOfSeasons:4,
    actor:[{name:"Ben Browder"},{name:"Claudia Black"}]
  }
};

(async () => {
  const version = await (await fetch(`${endpoint}/json/version`)).json();
  const browserDebug = new CDP(version.webSocketDebuggerUrl);
  const graphics = (await browserDebug.call("SystemInfo.getInfo")).gpu.featureStatus;
  browserDebug.close();
  if (process.env.TUBI_HOVER_SOFTWARE_TEST === "1") {
    assert(/disabled|software/i.test(graphics.gpu_compositing), "The test browser must use software compositing.");
    console.log("SOFTWARE_RENDERING", JSON.stringify({compositing:graphics.gpu_compositing,rasterization:graphics.rasterization}));
  }
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const target = targets.find(t => t.type === "page" && t.url === "about:blank") || targets.find(t => t.type === "page");
  if (!target) throw Error("No page target in the separate test browser.");
  const page = new CDP(target.webSocketDebuggerUrl);
  let worker;
  const get = expression => page.evaluate(expression);
  const panelExpr = "document.getElementById('tubi-hover-info-root')";
  const shadowExpr = `${panelExpr}?.shadowRoot`;
  const waitFor = async (expression, timeout = 30000) => {
    const start = Date.now(); while (Date.now() - start < timeout) { if (await get(expression)) return; await pause(100); }
    throw Error(`Condition timed out: ${expression}`);
  };
  const mouse = async (x, y) => page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const point = async selector => get(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const hover = async selector => { const p = await point(selector); await mouse(p.x, p.y); };
  const clickPanel = async selector => {
    const p = await get(`(()=>{const r=${shadowExpr}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await mouse(p.x, p.y);
    await page.call("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await page.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  };
  const escape = async () => page.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  try {
    await page.call("Page.enable");
    await page.call("Emulation.setDeviceMetricsOverride", {width:1500,height:1000,deviceScaleFactor:1,mobile:false});
    await page.call("Fetch.enable", { patterns: [{ urlPattern: "https://tubitv.com/__tubi_hover_extension_test", requestStage: "Request" }, { urlPattern: "https://tubitv.com/movies/100054094/*", requestStage: "Request" }, { urlPattern: "https://tubitv.com/series/300009559/*", requestStage: "Request" }, { urlPattern: "https://tubitv.com/movies/99999999*", requestStage: "Request" }] });
    page.on("Fetch.requestPaused", async event => {
      const url = event.request.url;
      if (url.includes("999999998") || url.includes("999999995")) { await page.call("Fetch.failRequest", { requestId: event.requestId, errorReason: "InternetDisconnected" }); return; }
      let body = fixture;
      if (!url.includes("__tubi_hover_extension_test")) {
        const slow = url.includes("999999996"); await pause(slow ? 900 : 70);
        const data = titleFixtures[new URL(url).pathname] || {"@type":"Movie",name:slow?"Slow title":"Fast title",description:"Test synopsis for the selected title."};
        body = '<html><head><script type="application/ld+json">' + JSON.stringify({...data,url}) + '</script></head></html>';
      }
      await page.call("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: Buffer.from(body).toString("base64") });
    });
    await page.call("Page.navigate", { url: "https://tubitv.com/__tubi_hover_extension_test" });
    await checks("Actual extension content script and shadow styles load in Opera", async () => {
      await waitFor(`!!${shadowExpr}`);
      await waitFor(`getComputedStyle(${shadowExpr}.querySelector('.panel')).backgroundColor==='rgb(22, 27, 36)'`);
    });
    await checks("Brief pointer passes do not open a panel", async () => {
      await hover("#movie"); await pause(100); await hover("#empty"); await pause(600);
      assert.equal(await get(`${panelExpr}.hidden`), true);
    });
    await checks("Movie hover displays synopsis, cast, director, year and runtime", async () => {
      await hover("#movie");
      await waitFor(`${shadowExpr}.querySelector('#thi-title').textContent==='Anywhere' && ${shadowExpr}.querySelector('.status').hidden && !${panelExpr}.hidden`);
      const data = await get(`({title:${shadowExpr}.querySelector('#thi-title').textContent,text:${shadowExpr}.querySelector('.panel').textContent,description:${shadowExpr}.querySelector('.description').textContent})`);
      assert(data.description.length > 40); assert(data.text.includes("Adam Seidel")); assert(data.text.includes("Hayley McFarland")); assert(data.text.includes("2026")); assert(data.text.includes("1 hr 42 min"));
    });
    await checks("Panel stays open while reading and all-cast control expands", async () => {
      await clickPanel(".cast-toggle"); await pause(650);
      assert.equal(await get(`${panelExpr}.hidden`), false);
      assert((await get(`${shadowExpr}.querySelector('.credits').textContent`)).includes("Jonathan Lipnicki"));
    });
    await checks("Pin holds the selected movie while hovering a different show", async () => {
      await clickPanel(".pin"); await hover("#show"); await pause(800);
      assert.equal(await get(`${shadowExpr}.querySelector('#thi-title').textContent`), "Anywhere");
      assert.equal(await get(`${shadowExpr}.querySelector('.pin').getAttribute('aria-pressed')`), "true");
    });
    await checks("Escape closes a pinned panel", async () => { await escape(); await pause(80); assert.equal(await get(`${panelExpr}.hidden`), true); });
    await checks("TV-show hover displays cast and available-season metadata", async () => {
      await hover("#empty"); await hover("#show");
      await waitFor(`${shadowExpr}.querySelector('#thi-title').textContent==='Farscape' && ${shadowExpr}.querySelector('.status').hidden && !${panelExpr}.hidden`);
      assert((await get(`${shadowExpr}.querySelector('.panel').textContent`)).includes("Ben Browder"));
      assert((await get(`${shadowExpr}.querySelector('.facts').textContent`)).includes("on Tubi"));
    });
    await escape(); await hover("#empty");
    const extensionID = await get(`new URL(${shadowExpr}.querySelector('link').href).hostname`);
    const popup = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(`chrome-extension://${extensionID}/popup.html`)}`, {method:"PUT"})).json();
    worker = new CDP(popup.webSocketDebuggerUrl); await worker.ready;
    await worker.call("Runtime.enable");
    await page.call("Page.bringToFront");
    await checks("Preference changes disable the panel and update text size", async () => {
      await worker.evaluate("new Promise(r=>chrome.storage.local.set({preferences:{enabled:false,hoverDelay:150,fontSize:20,showArtwork:false}},r))");
      await pause(150); await hover("#movie"); await pause(600); assert.equal(await get(`${panelExpr}.hidden`), true);
      await worker.evaluate("new Promise(r=>chrome.storage.local.set({preferences:{enabled:true,hoverDelay:150,fontSize:20,showArtwork:false}},r))");
      await hover("#empty"); await hover("#movie"); await waitFor(`!${panelExpr}.hidden`);
      assert.equal(await get(`getComputedStyle(${shadowExpr}.querySelector('.panel')).fontSize`), "20px");
      assert.equal(await get(`${shadowExpr}.querySelector('.poster').hidden`), true);
    });
    await checks("Dynamically inserted cards work and fetch failures show Retry", async () => {
      await escape(); await hover("#empty");
      await get("(()=>{const d=document.createElement('div');d.className='web-content-tile';d.innerHTML='<a id=dynamic href=/movies/999999998/test-offline title=Offline-test>Newly-added card</a>';document.querySelector('main').append(d)})()");
      await hover("#dynamic"); await waitFor(`${shadowExpr}.querySelector('.status').dataset.error==='true' && !${panelExpr}.hidden`);
      assert.equal(await get(`${shadowExpr}.querySelector('.retry').hidden`), false);
      assert((await get(`${shadowExpr}.querySelector('.status').textContent`)).length > 10);
    });
    await checks("Async results cannot replace the title under a newer hover", async () => {
      await escape(); await hover("#empty");
      await get("(()=>{for(const [id,title] of [['999999996','Slow title'],['999999997','Fast title']]){const d=document.createElement('div');d.className='web-content-tile';if(id==='999999997'){d.style.position='absolute';d.style.left='80px';d.style.top='650px'}const a=document.createElement('a');a.id='test-'+id;a.href='/movies/'+id+'/test';a.title=title;a.textContent=title;d.append(a);document.querySelector('main').append(d)}})()");
      await hover("#test-999999996"); await pause(220); await hover("#test-999999997");
      await waitFor(`${shadowExpr}.querySelector('#thi-title').textContent==='Fast title' && ${shadowExpr}.querySelector('.status').hidden`);
      await pause(1050); assert.equal(await get(`${shadowExpr}.querySelector('#thi-title').textContent`), "Fast title");
    });
    await checks("Metadata parser handles malformed JSON, fallback state, and unsafe data", async () => {
      const source = fs.readFileSync(path.join(__dirname,"../source/core.js"),"utf8") + "\n" + fs.readFileSync(path.join(__dirname,"../source/metadata.js"),"utf8");
      await get(source);
      const html = '<html><head><script type="application/ld+json">broken</script><script>window.__data={"video":{"byId":{"77":{"id":"77","title":"Literal <img onerror=alert(1)>","description":"Fallback description","year":2024,"actors":["Actor"],"duration":1800,"ratings":[{"code":"PG"}],"lang":"English","subtitles":[{"lang":"English"}],"imdb_id":"tt77777","missing":undefined}}}}</script></head></html>';
      const data = await get(`TubiHoverMetadata.parse(${JSON.stringify(html)},TubiHoverCore.titleURL('/movies/77/test'))`);
      assert.equal(data.description,"Fallback description"); assert.equal(data.duration,"30 min"); assert.equal(data.language,"English"); assert.equal(data.title,"Literal <img onerror=alert(1)>");
      assert.equal(await get("TubiHoverMetadata.parse('<html><head><meta property=og:title content=Homepage></head></html>',TubiHoverCore.titleURL('/movies/77/test'))"),null);
    });
    await checks("Loaded card metadata works without requesting unavailable detail HTML", async () => {
      await escape(); await hover("#empty");
      await get("(()=>{const d=document.createElement('div');d.className='web-content-tile';d.id='bridge-card';Object.assign(d.style,{position:'absolute',left:'80px',top:'650px',zIndex:'2'});const a=document.createElement('a');a.id='bridge-link';a.href='/movies/999999995/card';a.title='Loaded card';a.textContent='Loaded card';d.append(a);d.__reactFiber$tubiHoverTest={memoizedProps:{content:{id:'999999995',title:'Loaded card',description:'This synopsis is already loaded in the selected card.',actors:['On-page Actor'],directors:['On-page Director'],year:2025,duration:1800}}};document.querySelector('main').append(d)})()");
      await hover("#bridge-link");
      await waitFor(`${shadowExpr}.querySelector('#thi-title').textContent==='Loaded card' && ${shadowExpr}.querySelector('.status').hidden && !${panelExpr}.hidden`);
      const text = await get(`${shadowExpr}.querySelector('.panel').textContent`);
      assert(text.includes("On-page Actor")); assert(text.includes("On-page Director")); assert(text.includes("30 min"));
      assert.equal(await get("TubiHoverMetadata.fromItem({id:'99',title:'Wrong title'},TubiHoverCore.titleURL('/movies/77/test'))"), null);
      await escape(); await get("document.getElementById('bridge-card').remove()");
    });
    await checks("Panel stays inside a narrow browser viewport", async () => {
      await escape(); await hover("#empty");
      await page.call("Emulation.setDeviceMetricsOverride", {width:640,height:720,deviceScaleFactor:1,mobile:false});
      await hover("#movie"); await waitFor(`!${panelExpr}.hidden`);
      const rect = await get(`(()=>{const r=${panelExpr}.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
      assert(rect.left>=0&&rect.right<=640&&rect.top>=0&&rect.bottom<=720);
      await page.call("Emulation.setDeviceMetricsOverride", {width:1500,height:1000,deviceScaleFactor:1,mobile:false});
    });
    await worker.evaluate("new Promise(r=>chrome.storage.local.set({preferences:{enabled:true,hoverDelay:450,fontSize:16,showArtwork:true}},r))");
    await escape(); await hover("#empty"); await hover("#movie"); await waitFor(`${shadowExpr}.querySelector('.status').hidden && !${panelExpr}.hidden`);
    const screenshot = await page.call("Page.captureScreenshot",{format:"png"});
    if (process.argv[3]) {
      const output = path.resolve(process.argv[3]);
      fs.writeFileSync(output, JSON.stringify({ browser:version.Browser,graphics,checks:results },null,2));
      fs.writeFileSync(output.replace(/\.json$/,".png"),Buffer.from(screenshot.data,"base64"));
    }
    console.log(JSON.stringify({browser:version.Browser,total:results.length,passed:results.length}));
  } finally {
    if(worker) {try {await worker.evaluate("if(globalThis._originalFetch)globalThis.fetch=globalThis._originalFetch");}catch(_){}worker.close();}
    page.close();
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
