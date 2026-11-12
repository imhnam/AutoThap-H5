const el = id=>document.getElementById(id);
const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
let box=null, first=null, editing=false, busy=false, errorUntil=0;

async function request(type,data={}) {
  const response = await chrome.runtime.sendMessage({type,tabId:tab.id,...data});
  if (response.error) throw Error(response.error);
  return response.result;
}

function buttons(state) {
  el("prepare").disabled = state.mode!=="idle";
  el("stop").hidden = state.mode==="idle";
  el("preview").disabled = el("run").disabled = !editing || !box;
}
async function refresh() {
  if (busy) return;
  try {
    const state = await request("status");
    if (busy) return;
    if (state.mode!=="setup" && editing) reset();
    if (Date.now()>=errorUntil) {
      el("status").textContent = state.mode==="setup" && !editing
        ? "Phiên chọn vùng đang mở. Bấm Dừng để chọn lại." : state.note;
    }
    buttons(state);
  } catch (e) { el("status").textContent = e.message; }
}
function reset() {
  box=first=null; editing=false;
  el("picker").hidden=el("rect").hidden=el("selection").hidden=true;
  el("shot").removeAttribute("src");
}
async function act(fn) {
  if (busy) return;
  busy=true;
  errorUntil=0;
  for (const b of document.querySelectorAll("button")) b.disabled=true;
  try { await fn(); }
  catch (e) {
    el("status").textContent = e.message;
    errorUntil=Date.now()+12000;
  } finally {
    busy=false;
    try { buttons(await request("status")); el("stop").disabled=false; } catch {}
  }
}
el("prepare").onclick = ()=>act(async()=>{
  const {image}=await request("prepare");
  el("shot").src="data:image/png;base64,"+image;
  await el("shot").decode();
  el("picker").hidden=false;
  editing=true;
  el("status").textContent="Kéo trên ảnh từ góc trên trái đến góc dưới phải của toàn bộ vùng game dọc, bỏ phần viền.";
});
function point(e) {
  const r=el("shot").getBoundingClientRect();
  const clamp=n=>Math.max(0,Math.min(1,n));
  return [clamp((e.clientX-r.left)/r.width),clamp((e.clientY-r.top)/r.height)];
}
function draw(e) {
  const [x,y]=point(e), [a,b]=first;
  box=[Math.min(a,x),Math.min(b,y),Math.max(a,x),Math.max(b,y)];
  const [l,t,r,d]=box;
  Object.assign(el("rect").style,{left:l*100+"%",top:t*100+"%",width:(r-l)*100+"%",height:(d-t)*100+"%"});
  el("rect").hidden=false;
}
el("picker").onpointerdown=e=>{
  if (e.button!==0) return;
  first=point(e); el("picker").setPointerCapture(e.pointerId); draw(e);
};
el("picker").onpointermove=e=>{ if (first) draw(e); };
el("picker").onpointerup=e=>{
  if (!first) return;
  draw(e); first=null;
  const [l,t,r,b]=box, img=el("shot");
  const ratio=(r-l)*img.naturalWidth/((b-t)*img.naturalHeight);
  if (r-l<0.025 || b-t<0.05) box=null;
  el("selection").hidden=false;
  el("selection").textContent=!box ? "Vùng quá nhỏ. Kéo lại để chọn." :
    ratio<0.50 || ratio>0.64 ? "Mẫu game có tỉ lệ gần 9:16. Kiểm tra hai mép vùng chọn." :
    "Đã chọn khung game. Bạn có thể kéo lại để chỉnh.";
  buttons({mode:"setup"});
};
for (const id of ["preview","run"]) {
  el(id).onclick=()=>act(async()=>{
    const state=await request("start",{box,preview:id==="preview"});
    reset(); el("status").textContent=state.note;
  });
}
el("stop").onclick=()=>act(async()=>{
  const state=await request("stop"); reset(); el("status").textContent=state.note;
});
setInterval(refresh,1000);
await refresh();
