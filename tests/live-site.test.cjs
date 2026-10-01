"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Supply the separate test browser's port.");
const endpoint = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
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

(async () => {
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const target = targets.find(t => t.type === "page" && t.url.includes("__tubi_hover_extension_test"));
  if (!target) throw Error("No extension test tab; this check will not use another browser tab.");
  const page = new CDP(target.webSocketDebuggerUrl);
  const get = expression => page.evaluate(expression);
  const waitFor = async expression => {
    const start = Date.now();
    while (Date.now()-start<25000) { if(await get(expression)) return; await pause(150); }
    throw Error(`Condition timed out: ${expression}`);
  };
  try {
    await page.call("Page.enable");
    await page.call("Network.enable");
    await page.call("Network.setBlockedURLs", { urls: ["*.m3u8*", "*.mp4*", "*.mpd*"] });
    await page.call("Fetch.disable");
    await page.call("Page.bringToFront");
    await page.call("Emulation.setDeviceMetricsOverride", {width:1500,height:1000,deviceScaleFactor:1,mobile:false});
    await page.call("Page.navigate", {url:"https://tubitv.com/category/action"});
    await waitFor("!!document.getElementById('tubi-hover-info-root')?.shadowRoot && !!document.querySelector('.web-content-tile a[href]')");
    await pause(1800);
    await get("(()=>{for(const b of document.querySelectorAll('button,a'))if(b.textContent.trim()==='Not now'&&b.getBoundingClientRect().width)b.click();window.scrollTo(0,220)})()");
    await pause(500);
    const card = await get(`(()=>{
      for(const a of document.querySelectorAll('.web-content-tile__poster-link')) {
        const r=a.getBoundingClientRect();
        if(r.width<40||r.height<60||r.top<100||r.bottom>850||r.right>1450)continue;
        const tile=a.closest('.web-content-tile');
        if(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.web-content-tile')!==tile)continue;
        return {x:r.left+r.width/2,y:r.top+r.height/2,title:tile.querySelector('.web-content-tile__title')?.textContent,url:a.href};
      }
      return null;
    })()`);
    assert(card,"No visible Tubi poster card in this test viewport.");
    await page.call("Input.dispatchMouseEvent", {type:"mouseMoved",x:card.x,y:card.y});
    const shadow="document.getElementById('tubi-hover-info-root').shadowRoot";
    await waitFor(`!document.getElementById('tubi-hover-info-root').hidden && ${shadow}.querySelector('.status').hidden && ${shadow}.querySelector('#thi-title').textContent===${JSON.stringify(card.title)}`);
    assert.equal(await get(`getComputedStyle(${shadow}.querySelector('.panel')).backgroundColor`),"rgb(22, 27, 36)");
    assert((await get(`${shadow}.querySelector('.description').textContent`)).length>25);
    const shot=await page.call("Page.captureScreenshot",{format:"png"});
    if(process.argv[3]) fs.writeFileSync(process.argv[3],Buffer.from(shot.data,"base64"));
    console.log(JSON.stringify({passed:true,title:card.title,url:card.url,check:"Live Tubi card, actual page styles, and native hover behavior"}));
    await page.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  } finally { page.close(); }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
