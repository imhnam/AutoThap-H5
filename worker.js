import {W,H,Gate,recognize,labels} from "./vision.mjs";

const specs = fetch(chrome.runtime.getURL("samples.json")).then(r=>r.json());
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
let session = null;
let note = "Mở tab game rồi chọn vùng chơi.";
const command = (s,method,params={}) => chrome.debugger.sendCommand({tabId:s.tabId},method,params);

function status() {
  return {mode:session?.mode || "idle", tabId:session?.tabId, note};
}

async function stop(reason) {
  const s = session;
  note = reason;
  if (!s || s.mode==="stopping") return;
  s.mode = "stopping";
  clearTimeout(s.expiry);
  try { await chrome.debugger.detach({tabId:s.tabId}); } catch {}
  if (session===s) session = null;
  await chrome.action.setBadgeText({tabId:s.tabId,text:""}).catch(()=>{});
}

async function viewport(s) {
  const {result} = await command(s,"Runtime.evaluate",{returnByValue:true,
    expression:"[innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio, visualViewport.scale]"});
  return result.value;
}

async function snapshot(s) {
  return (await command(s,"Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data;
}

async function prepare(tabId) {
  if (session) throw Error("Hãy dừng phiên hiện tại trước khi chọn lại vùng.");
  const tab = await chrome.tabs.get(tabId);
  const targets = await chrome.debugger.getTargets();
  const target = targets.find(t=>t.tabId===tabId && t.type==="page");
  if (!tab.active || !/^https?:\/\//.test(target?.url || "")) throw Error("Hãy mở tiện ích ngay trên tab web H5.");
  if (session) throw Error("Một phiên khác đang mở.");
  const s = session = {tabId,mode:"setup"};
  try {
    await chrome.debugger.attach({tabId},"1.3");
    await delay(450);
    s.view = await viewport(s);
    const image = await snapshot(s);
    if (session!==s || s.mode!=="setup") throw Error("Đã hủy chọn vùng.");
    note = "Kéo từ góc trên trái đến góc dưới phải của khung game.";
    s.expiry = setTimeout(()=>{ if (session===s && s.mode==="setup") void stop("Hết thời gian chọn vùng."); },180000);
    return {image};
  } catch (e) {
    if (session===s) await stop(e.message);
    throw e;
  }
}

function validBox(box) {
  return Array.isArray(box) && box.length===4 && box.every(Number.isFinite) &&
    box[0]>=0 && box[1]>=0 && box[2]<=1 && box[3]<=1 &&
    box[2]-box[0]>0.025 && box[3]-box[1]>0.05;
}

function start(tabId,box,preview) {
  const s = session;
  if (!s || s.tabId!==tabId || s.mode!=="setup" || !s.view || !validBox(box))
    throw Error("Chọn lại khung game trước khi chạy.");
  clearTimeout(s.expiry);
  s.box = box;
  s.mode = preview ? "preview" : "run";
  note = "Đang nhận diện màn hình…";
  void chrome.action.setBadgeText({tabId,text:preview ? "XEM" : "ON"});
  void loop(s).catch(e=>{ if (session===s && s.mode!=="stopping") void stop("Đã dừng · "+e.message); });
  return status();
}

async function frame(s,ctx) {
  const bytes = Uint8Array.from(atob(await snapshot(s)),ch=>ch.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes],{type:"image/png"}));
  try {
    const [l,t,r,b] = s.box;
    ctx.drawImage(bmp,l*bmp.width,t*bmp.height,(r-l)*bmp.width,(b-t)*bmp.height,0,0,W,H);
    return ctx.getImageData(0,0,W,H).data;
  } finally { bmp.close(); }
}

async function click(s,hit) {
  const [l,t,r,b] = s.box, [width,height] = s.view;
  const pos = {x:(l+hit.x/W*(r-l))*width, y:(t+hit.y/H*(b-t))*height,
               button:"left",clickCount:1};
  if (hit.id==="thang") {
    await command(s,"Input.dispatchMouseEvent",{type:"mouseMoved",x:pos.x,y:pos.y});
    if (session!==s || s.mode!=="run") return;
  }
  await command(s,"Input.dispatchMouseEvent",{...pos,type:"mousePressed",buttons:1});
  if (hit.id==="thang") await delay(65);
  await command(s,"Input.dispatchMouseEvent",{...pos,type:"mouseReleased",buttons:0});
}

async function loop(s) {
  const patterns = await specs, gate = new Gate();
  const ctx = new OffscreenCanvas(W,H).getContext("2d",{willReadFrequently:true});
  let lastProgress = Date.now(), lastAction = "";
  const running = ()=>session===s && (s.mode==="run" || s.mode==="preview");
  while (running()) {
    if (!(await chrome.tabs.get(s.tabId)).active) {
      note = "Đang chờ bạn quay lại tab game.";
      gate.lastFrame = null;
      lastProgress = Date.now();
    } else {
      const view = await viewport(s);
      if (String(view)!==String(s.view)) throw Error("Khung hiển thị đã đổi. Hãy chọn lại vùng game.");
      let hit = recognize(await frame(s,ctx),patterns);
      if (hit?.id==="thap" && gate.recovering) hit={id:"thap_recover",x:306,y:751};
      if (hit?.id==="thap_recover" && !gate.recovering) hit={id:"thap",x:211,y:410};
      if (!running()) return;
      if (gate.next(hit,Date.now())) {
        if (String(await viewport(s))!==String(s.view)) throw Error("Hãy chọn lại vùng sau khi đổi bố cục.");
        if (!running()) return;
        if (!(await chrome.tabs.get(s.tabId)).active || !running()) continue;
        if (s.mode==="run") await click(s,hit);
        lastAction = (s.mode==="run" ? "Đã bấm " : "Xem thử · ")+labels[hit.id]+". ";
        lastProgress = Date.now();
      }
      if (!running()) return;
      note = lastAction + (gate.waitingForTower ? "Đang chờ nút 1 ở tháp." :
          hit ? "Đang thấy "+labels[hit.id]+"." : "Đang chờ màn hình quen thuộc.");
      if (Date.now()-lastProgress>180000) throw Error("3 phút chưa có bước mới. Kiểm tra vùng chọn và màn hình game.");
    }
    const enteringBattle = gate.lastAction==="doihinh" && Date.now()-gate.lastTime<15000;
    await delay(enteringBattle ? 200 : 850);
  }
}

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if (sender.url!==chrome.runtime.getURL("popup.html")) return;
  (async()=>{
    switch (msg.type) {
      case "status": return status();
      case "prepare": return await prepare(msg.tabId);
      case "start": return start(msg.tabId,msg.box,msg.preview);
      case "stop": await stop("Đã dừng."); return status();
      default: throw Error("Lệnh không hợp lệ.");
    }
  })().then(result=>reply({result}),e=>reply({error:e.message}));
  return true;
});
chrome.tabs.onUpdated.addListener((id,change)=>{
  if (id===session?.tabId && change.status==="loading") void stop("Tab vừa chuyển trang. Hãy chọn lại vùng game.");
});
chrome.debugger.onDetach.addListener(({tabId})=>{
  if (tabId===session?.tabId && session.mode!=="stopping") {
    clearTimeout(session.expiry);
    session = null;
    note = "Đã ngắt kết nối với tab game.";
    void chrome.action.setBadgeText({tabId,text:""}).catch(()=>{});
  }
});
