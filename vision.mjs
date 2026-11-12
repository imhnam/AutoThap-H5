export const W = 440, H = 784;
export const labels = {
  thap: "Nút 1 · Khiêu chiến ở tháp",
  chitiet: "Chi tiết tầng · Khiêu chiến",
  doihinh: "Đội hình · Bắt đầu",
  giautran: "Trong trận · Bỏ qua",
  thang: "Thắng · Ải sau",
  bai: "Bại · Xác nhận",
  lichluyen: "Lịch Luyện · Thông Thiên Tháp",
  thap_recover: "Tháp · Tứ Linh Tháp",
  linhmenu: "Tứ Linh Tháp · ô đang sáng"
};

function locate(frame, anchor, dy, offset=[0,0], dx=15) {
  const [x0,y0] = anchor.xy, [w,h] = anchor.size;
  const cx=x0+offset[0], cy=y0+offset[1];
  const points = anchor.points;
  let best = 24, match = null;
  for (let y=Math.max(0,cy-dy); y<=Math.min(H-h,cy+dy); y++) {
    for (let x=Math.max(0,cx-dx); x<=Math.min(W-w,cx+dx); x++) {
      let sum = 0, i = 0;
      for (; i<points.length; i++) {
        const [px,py,r,g,b] = points[i];
        const p = 4*((y+py)*W+x+px);
        sum += Math.abs(frame[p]-r)+Math.abs(frame[p+1]-g)+Math.abs(frame[p+2]-b);
        if ((i===7 || i===23) && sum > (i+1)*3*39) break;
      }
      const err = sum/(points.length*3);
      if (i===points.length && err<best) {
        best = err;
        match = [x-x0,y-y0];
      }
    }
  }
  return match;
}

function webSkip(frame, web) {
  const [settings, skip] = web.anchors;
  const above = locate(frame,settings,45);
  if (!above) return null;
  // The two controls are stacked on the right, independently of battle effects.
  const button = locate(frame,skip,9,above,5);
  if (!button) return null;
  return {id:"giautran", x:web.tap[0]+button[0], y:web.tap[1]+button[1]};
}

// Find gold button bodies near the foot of the selected area, including when it has side borders.
function goldButtons(frame) {
  const top = Math.floor(H*0.68), rows = H-top;
  const mask = new Uint8Array(W*rows);
  for (let i=0, p=4*W*top; i<mask.length; i++,p+=4) {
    const r=frame[p], g=frame[p+1], b=frame[p+2];
    mask[i] = r>180 && g>95 && g>b+30 && r>g+12;
  }
  const stack=new Int32Array(mask.length), boxes=[];
  for (let i=0;i<mask.length;i++) {
    if (!mask[i]) continue;
    let count=1, area=0, left=W, right=0, minY=rows, maxY=0;
    stack[0]=i; mask[i]=0;
    while (count) {
      const q=stack[--count], x=q%W, y=Math.floor(q/W);
      area++;
      left=Math.min(left,x); right=Math.max(right,x);
      minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      if (x && mask[q-1]) { mask[q-1]=0; stack[count++]=q-1; }
      if (x+1<W && mask[q+1]) { mask[q+1]=0; stack[count++]=q+1; }
      if (y && mask[q-W]) { mask[q-W]=0; stack[count++]=q-W; }
      if (y+1<rows && mask[q+W]) { mask[q+W]=0; stack[count++]=q+W; }
    }
    const w=right-left+1, h=maxY-minY+1;
    if (w>=42 && w<=164 && h>=16 && h<=62 && w/h>1.55 && w/h<5.1 && area>w*h*0.48)
      boxes.push({x:left,y:top+minY,w,h});
  }
  return boxes;
}

function labelError(frame,box,points) {
  let best=Infinity;
  for (let dy=-1;dy<=1;dy++) {
    for (let dx=-1;dx<=1;dx++) {
      let error=0;
      for (const [u,v,r,g,b] of points) {
        const x=box.x+Math.round(u*(box.w-1))+dx, y=box.y+Math.round(v*(box.h-1))+dy;
        const p=4*(y*W+x);
        error+=Math.abs(frame[p]-r)+Math.abs(frame[p+1]-g)+Math.abs(frame[p+2]-b);
      }
      best=Math.min(best,error/(3*points.length));
    }
  }
  return best;
}

function victoryButton(frame,labels) {
  const boxes=goldButtons(frame);
  for (const left of boxes) {
    for (const right of boxes) {
      const spacing=(right.x-left.x)/left.w;
      if (spacing<1.15 || spacing>1.9 || Math.abs(right.y-left.y)>4 ||
          Math.abs(right.w-left.w)>left.w*0.15 || Math.abs(right.h-left.h)>4) continue;
      let rewards=0;
      for (let y=Math.max(0,right.y-150);y<right.y-25;y+=2) {
        for (let x=Math.max(0,left.x);x<Math.min(W,right.x+right.w);x+=2) {
          const p=4*(y*W+x);
          if (frame[p+2]>110 && frame[p+2]>frame[p]+15) rewards++;
        }
      }
      if (rewards<600) continue;
      const nextError=labelError(frame,right,labels[1]);
      if (nextError<38 && nextError+4<labelError(frame,right,labels[0]) && labelError(frame,left,labels[0])<38)
        return {id:"thang",x:Math.round(right.x+(right.w-1)/2),y:Math.round(right.y+(right.h-1)/2)};
    }
  }
  return null;
}

function activeTower(frame,spec) {
  const scores=spec.choices.map(([left,top,right,bottom])=>{
    let total=0, count=0;
    for(let y=top;y<bottom;y+=5) {
      for(let x=left;x<right;x+=5) {
        const p=4*(y*W+x);
        const r=frame[p],g=frame[p+1],b=frame[p+2];
        total+=Math.max(r,g,b)-Math.min(r,g,b);
        count++;
      }
    }
    return total/count;
  });
  const winner=scores.indexOf(Math.max(...scores));
  const next=Math.max(...scores.filter((_,i)=>i!==winner));
  if (scores[winner]<20 || scores[winner]<next*1.35) return null;
  return {id:"linhmenu",x:spec.centers[winner][0],y:spec.centers[winner][1]};
}

export function recognize(frame, specs) {
  let result = null;
  for (const [id,spec] of Object.entries(specs)) {
    if (spec.buttonLabels) {
      const next=victoryButton(frame,spec.buttonLabels);
      if (next) {
        if (result) return null;
        result=next;
        continue;
      }
    }
    if (spec.web) {
      const hit = webSkip(frame,spec.web);
      if (hit) {
        if (result) return null;
        result = hit;
        continue;
      }
    }
    let active=spec;
    let anchors=active.anchors;
    let cues=anchors.slice(0,-1).every(a => locate(frame,a,22));
    if (!cues && spec.alternate) {
      active=spec.alternate;
      anchors=active.anchors;
      cues=anchors.slice(0,-1).every(a => locate(frame,a,35));
    }
    if (!cues) continue;
    let delta = locate(frame,anchors.at(-1),id==="thap" ? 270 : 22);
    if (!delta && spec.alternate && active===spec) {
      active=spec.alternate;
      anchors=active.anchors;
      if (anchors.slice(0,-1).every(a => locate(frame,a,35)))
        delta=locate(frame,anchors.at(-1),35);
    }
    if (!delta) continue;
    if (result) {
      if (id==="thap_recover" && result.id==="thap") continue;
      if (id==="thap" && result.id==="thap_recover") result=null;
      else return null;
    }
    result = spec.choices ? activeTower(frame,spec) :
      {id, x:active.tap[0]+delta[0], y:active.tap[1]+delta[1]};
  }
  return result;
}

export class Gate {
  lastFrame = null;
  lastAction = null;
  waitingForTower = false;
  recovering = false;
  count = 0;
  lastTime = 0;

  next(hit, now) {
    const prev = this.lastFrame;
    this.lastFrame = hit;
    if (!hit) return false;
    const immediateSkip = hit.id==="giautran" && this.lastAction!==hit.id;
    if (!immediateSkip && (!prev || hit.id!==prev.id ||
        Math.abs(hit.x-prev.x)>4 || Math.abs(hit.y-prev.y)>4)) return false;
    if (this.waitingForTower && !["thap","bai","lichluyen","thap_recover","linhmenu"].includes(hit.id)) return false;
    if (hit.id==="thap_recover" && !this.recovering) return false;
    if (hit.id==="thap" && this.recovering) return false;
    if (this.lastAction===hit.id) {
      // A lost input can be retried once if the same button is still visible.
      const retryAfter = hit.id==="giautran" ? 1500 : hit.id==="thang" ? 2200 : 9000;
      if (this.count>=2 || now-this.lastTime<retryAfter) return false;
    } else {
      this.count = 0;
    }
    this.lastTime = now;
    this.count++;
    this.lastAction = hit.id;
    if (hit.id==="bai") this.waitingForTower = true;
    if (hit.id==="thap") this.waitingForTower = false;
    if (hit.id==="lichluyen") {
      this.recovering = true;
      this.waitingForTower = false;
    }
    if (hit.id==="giautran" || hit.id==="thang" || hit.id==="bai") this.recovering = false;
    return true;
  }
}
