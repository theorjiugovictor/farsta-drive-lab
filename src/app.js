(()=>{
'use strict';
const $=s=>document.querySelector(s);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=Math.PI*2;
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
const P=store.get('fdl:progress',null)||{drives:[],quiz:{n:0,c:0,by:{}},video:[]};
if(!P.quiz)P.quiz={n:0,c:0,by:{}}; if(!P.video)P.video=[]; if(!P.drives)P.drives=[];
const saveP=()=>store.set('fdl:progress',P);
const CATS={
  predict:{en:'Predict and assess what happens next',sv:'Förutse och bedöma'},
  speed:{en:'Adjust speed to the circumstances',sv:'Anpassa hastigheten'},
  place:{en:'Adapt placement to the circumstances',sv:'Anpassa placeringen'},
  attention:{en:'Show good attention',sv:'Uppmärksamhet'},
  interact:{en:'Interact with other road users',sv:'Samspel'},
  maneuver:{en:'Routine maneuvering',sv:'Manövrering'},
  rules:{en:'Apply the traffic rules',sv:'Trafikregler'}
};
const ORD=['','1st','2nd','3rd','4th','5th','6th','7th'];
const DIR=['','right','straight ahead','left'];
const ASPH='#3b3e43', LINE='#eef0ee';
const VCOL=['#6b7c93','#b8bec6','#2f3a48','#8e2b23','#d9d4c7','#46607a','#a3a89b','#5a4a3f'];
const pick=a=>a[Math.floor(Math.random()*a.length)];

/* ---------- paths ---------- */
function finalize(raw){
  const pts=raw.map(p=>({x:p.x,y:p.y}));
  let s=0;
  for(let i=0;i<pts.length;i++){ if(i) s+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y); pts[i].s=s; }
  for(let i=0;i<pts.length;i++){ const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)]; const L=Math.hypot(b.x-a.x,b.y-a.y)||1; pts[i].tx=(b.x-a.x)/L; pts[i].ty=(b.y-a.y)/L; }
  for(let i=0;i<pts.length;i++){ const a=pts[Math.max(0,i-3)],b=pts[Math.min(pts.length-1,i+3)]; let d=Math.atan2(b.ty,b.tx)-Math.atan2(a.ty,a.tx); d=Math.atan2(Math.sin(d),Math.cos(d)); pts[i].k=d/((b.s-a.s)||1); }
  return {pts,len:s};
}
function buildPath(ctrl,step){
  step=step||2; const raw=[]; const P=i=>ctrl[clamp(i,0,ctrl.length-1)];
  for(let i=0;i<ctrl.length-1;i++){
    const p0=P(i-1),p1=P(i),p2=P(i+1),p3=P(i+2);
    const n=Math.max(1,Math.ceil(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])/step));
    for(let k=0;k<n;k++){ const t=k/n,t2=t*t,t3=t2*t; const f=(a,b,c,d)=>0.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3); raw.push({x:f(p0[0],p1[0],p2[0],p3[0]),y:f(p0[1],p1[1],p2[1],p3[1])}); }
  }
  const l=ctrl[ctrl.length-1]; raw.push({x:l[0],y:l[1]});
  return finalize(raw);
}
function polyline(raw,step){
  step=step||1.5; const out=[];
  for(let i=0;i<raw.length-1;i++){ const [x0,y0]=raw[i],[x1,y1]=raw[i+1]; const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/step)); for(let k=0;k<n;k++) out.push({x:x0+(x1-x0)*k/n,y:y0+(y1-y0)*k/n}); }
  const l=raw[raw.length-1]; out.push({x:l[0],y:l[1]});
  return finalize(out);
}
const reversePath=p=>finalize(p.pts.slice().reverse().map(q=>({x:q.x,y:q.y})));
function at(path,s){
  const p=path.pts;
  if(s<=0){const q=p[0];return {x:q.x,y:q.y,tx:q.tx,ty:q.ty,k:q.k};}
  if(s>=path.len){const q=p[p.length-1];return {x:q.x,y:q.y,tx:q.tx,ty:q.ty,k:q.k};}
  let lo=0,hi=p.length-1; while(hi-lo>1){const m=(lo+hi)>>1; if(p[m].s<s)lo=m; else hi=m;}
  const a=p[lo],b=p[hi],t=(s-a.s)/((b.s-a.s)||1);
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,tx:a.tx+(b.tx-a.tx)*t,ty:a.ty+(b.ty-a.ty)*t,k:a.k};
}
function project(path,x,y,hint){
  const p=path.pts; let best=0,bd=1e18,i0=0,i1=p.length-1;
  if(hint!=null){i0=Math.max(0,hint-80);i1=Math.min(p.length-1,hint+80);}
  for(let i=i0;i<=i1;i++){const dx=x-p[i].x,dy=y-p[i].y,d=dx*dx+dy*dy; if(d<bd){bd=d;best=i;}}
  if(hint!=null&&((best===i0&&i0>0)||(best===i1&&i1<p.length-1))) return project(path,x,y,null);
  const q=p[best],dx=x-q.x,dy=y-q.y;
  return {s:q.s+dx*q.tx+dy*q.ty,lat:-dx*q.ty+dy*q.tx,i:best,dist:Math.sqrt(bd)};
}

/* ---------- state ---------- */
const cv=$('#cv'), g=cv.getContext('2d');
const S={tab:'drive',lvlId:'roundabout',mode:'coach',keys:{},gpPrev:{},ai:[],peds:[],faults:[],faultKeys:new Set(),time:0,running:false,paused:false,ended:false,zoom:5,dpr:1,hint:'',hintT:-99,toast:null,instr:''};

function mkCar(x,y,h,v){return {x,y,h,v,steer:0,len:4.5,wid:1.8,ind:0,indOn:0,hAtInd:0,mirrorAgo:99,lookLAgo:99,lookRAgo:99,acc:0,lastRight:-99,lastLeft:-99,cruise:0,player:true,color:'#f4c514'};}
function mkVeh(o){const v=Object.assign({s:0,v:0,vDes:10,len:4.5,wid:1.8,color:pick(VCOL),kind:'car',lat:0,acc:0,done:false,ind:0,hold:null,ignorePlayer:false,accel:2.2},o); pose(v); return v;}
function pose(v){const q=at(v.path,v.s); v.x=q.x-q.ty*v.lat; v.y=q.y+q.tx*v.lat; v.h=Math.atan2(q.tx,-q.ty);}
function rel(o){const c=S.car,fx=Math.sin(c.h),fy=-Math.cos(c.h),dx=o.x-c.x,dy=o.y-c.y; return {f:dx*fx+dy*fy,l:-dx*fy+dy*fx};}
const angDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

function fault(cat,text,sev,key,tip){
  if(S.ended) return;
  if(key){ if(S.faultKeys.has(key)) return; S.faultKeys.add(key); }
  S.faults.push({cat,text,sev,tip:tip||'',t:S.time});
  if(S.mode==='coach'||sev==='intervention') showToast(text,sev);
  if(sev==='intervention' && !S.intervened){ S.intervened=true; S.intervT=0; $('#banner').hidden=false; }
}
function showToast(text,sev){S.toast={text,sev,t:S.time};}

/* ---------- physics ---------- */
function stepCar(dt){
  const c=S.car,k=S.keys;
  if(S.intervened){ c.v=Math.max(0,c.v-9*dt); c.acc=-9; c.x+=Math.sin(c.h)*c.v*dt; c.y-=Math.cos(c.h)*c.v*dt; if(c.v===0){S.intervT+=dt; if(S.intervT>1.2) finish();} return; }
  let thr=k.up?1:0, brk=k.down?1:0, st=(k.right?1:0)-(k.left?1:0);
  const gp=S.gp; if(gp){ thr=Math.max(thr,gp.thr); brk=Math.max(brk,gp.brk); if(Math.abs(gp.st)>0.08) st=gp.st; }
  if(brk>0.1) c.cruise=0;
  const maxSt=0.62/(1+c.v*0.22);
  const target=clamp(st,-1,1)*maxSt, rate=st===0?2.6:1.6;
  c.steer+=clamp(target-c.steer,-rate*dt,rate*dt);
  if(Math.abs(c.steer)>maxSt) c.steer=Math.sign(c.steer)*maxSt;
  let a=thr*3.4*(1-c.v/50)-brk*8-0.01*c.v-0.0006*c.v*c.v;
  if(!thr&&!brk){ if(c.cruise>0) a=clamp((c.cruise-c.v)*1.5,-1.5,1.5); else a-=0.35; }
  if(thr>0.1&&c.cruise>0) c.cruise=Math.max(c.cruise,c.v);
  const pv=c.v; c.v=Math.max(0,c.v+a*dt);
  c.acc=c.acc*0.85+((c.v-pv)/dt)*0.15;
  c.h+=c.v/2.7*Math.tan(c.steer)*dt;
  c.x+=Math.sin(c.h)*c.v*dt; c.y-=Math.cos(c.h)*c.v*dt;
  if(c.ind){
    c.indOn+=dt; if(c.ind===1)c.lastRight=S.time; else c.lastLeft=S.time;
    if(Math.abs(angDiff(c.h,c.hAtInd))>0.9&&Math.abs(c.steer)<0.03) c.ind=0;
    else if(c.indOn>16) fault('interact','Indicator left on long after the manoeuvre','minor','indOn','Cancel the signal once the lane change is done, or others will think you are about to turn.');
  }
  c.mirrorAgo+=dt; c.lookLAgo+=dt; c.lookRAgo+=dt;
  if(k.h_mirror)c.mirrorAgo=0; if(k.h_lookL)c.lookLAgo=0; if(k.h_lookR)c.lookRAgo=0;
}
function toggleInd(d){const c=S.car; if(!c)return; if(c.ind===d)c.ind=0; else {c.ind=d;c.indOn=0;c.hAtInd=c.h;}}
function act(a){
  const c=S.car; if(!c)return;
  if(a==='mirror')c.mirrorAgo=0; else if(a==='lookL')c.lookLAgo=0; else if(a==='lookR')c.lookRAgo=0;
  else if(a==='sigL')toggleInd(-1); else if(a==='sigR')toggleInd(1);
  else if(a==='cruise')c.cruise=c.cruise>0?0:c.v;
}

/* ---------- AI ---------- */
function updateAI(dt){
  for(const v of S.ai){
    if(v.done||v.parked) continue;
    let target=v.vDes;
    if(v.script) target=v.script(v,target,dt);
    const fx=Math.sin(v.h),fy=-Math.cos(v.h);
    if(!v.ownFollow) for(const o of S.ai.concat([S.car])){
      if(o===v||o.done) continue; if(o===S.car&&v.ignorePlayer) continue;
      if(Math.abs(angDiff(o.h,v.h))>2.3) continue;   // oncoming traffic is never the car in front
      const dx=o.x-v.x,dy=o.y-v.y,f=dx*fx+dy*fy,l=-dx*fy+dy*fx;
      if(f>0&&f<70&&Math.abs(l)<2.0){ const gap=f-(v.len+o.len)/2; target=Math.min(target,Math.max(0,o.v+(gap-3)/1.3)); }
    }
    if(v.hold&&v.hold.cond(v)){ const d=v.hold.s-v.s; if(d>-0.5) target=Math.min(target,Math.sqrt(Math.max(0,6*(d-0.3)))); }
    const acc=target>v.v?Math.min(v.accel,(target-v.v)/dt):Math.max(-7,(target-v.v)/dt);
    v.acc=acc; v.v=Math.max(0,v.v+acc*dt); v.s+=v.v*dt;
    if(v.s>=v.path.len-0.5) v.done=true;
    pose(v);
  }
}
function updatePeds(dt){
  for(const p of S.peds){
    if(p.state==='wait'&&p.trigger()) p.state='cross';
    if(p.state==='cross'){ p.lat+=p.dir*1.3*dt; if(Math.abs(p.lat)>(p.half||5.6)&&Math.sign(p.lat)===p.dir) p.state='done'; }
    const ox=p.ox!=null?p.ox:Math.cos(p.a)*p.r, oy=p.oy!=null?p.oy:Math.sin(p.a)*p.r, nx=Math.sin(p.a), ny=-Math.cos(p.a);
    p.x=ox+nx*p.lat; p.y=oy+ny*p.lat;
  }
}
function circles(o){const fx=Math.sin(o.h),fy=-Math.cos(o.h),n=Math.max(2,Math.round(o.len/2.2)),r=o.wid/2,out=[]; for(let i=0;i<n;i++){const t=(i/(n-1)-0.5)*(o.len-o.wid); out.push([o.x+fx*t,o.y+fy*t,r]);} return out;}
function minDist(a,b){let m=1e9; for(const p of circles(a)) for(const q of circles(b)) m=Math.min(m,Math.hypot(p[0]-q[0],p[1]-q[1])-p[2]-q[2]); return m;}
function collisions(){
  const c=S.car;
  for(const v of S.ai){ if(v.done) continue; if(Math.abs(v.x-c.x)>20||Math.abs(v.y-c.y)>20) continue; if(minDist(c,v)<0.35){ fault('interact',v.kind==='bike'?'Came dangerously close to the cyclist':'Came dangerously close to another vehicle','intervention','col'); return; } }
  for(const p of S.peds){ if(p.state!=='cross') continue; if(Math.hypot(p.x-c.x,p.y-c.y)<2.4){ fault('interact','Came dangerously close to a pedestrian','intervention','pcol'); return; } }
}

/* ---------- generic checks ---------- */
let overT=0,overST=0,hbT=0;
function genericChecks(dt){
  const c=S.car,kmh=c.v*3.6,L=S.level.checkLimit();
  const zone=S.level.zone?S.level.zone():'z';
  if(L){
    if(kmh>L+12){overST+=dt; if(overST>1) fault('speed',`Well over the limit: ${Math.round(kmh)} in a ${L} zone`,'serious','os'+zone,'Look for the limit signs and adjust before you pass them.');} else overST=0;
    if(kmh>L+4){overT+=dt; if(overT>2) fault('speed',`Over the speed limit (${L})`,'minor','o'+zone,'Keep an eye on the limit. Slightly under is fine, over is a fault.');} else overT=0;
  }
  if(c.acc<-5.2){hbT+=dt; if(hbT>0.3) fault('predict','Late, sharp braking','minor','hb'+Math.floor(S.time/8),'Look further ahead and start braking earlier and softer. Late braking shows the examiner you did not see it coming.');} else hbT=0;
  if(S.mode==='coach'){ for(const h of S.level.hints){ if(!S.hintsDone.has(h)&&h.when()){S.hintsDone.add(h);S.hint=h.t;S.hintT=S.time;} } }
}

/* ---------- levels ---------- */
function signAt(path,s,lat,type,val){const q=at(path,s); return {x:q.x-q.ty*lat,y:q.y+q.tx*lat,type,val};}

const RB={
  id:'roundabout',title:'Roundabout',rIn:12,rOut:19,rMid:15.5,
  arms:[{a:0},{a:-Math.PI/2},{a:Math.PI},{a:Math.PI/2}],
  init(o){
    this.exit=o.exit||1+Math.floor(Math.random()*3);
    S.car=mkCar(1.75,115,0,36/3.6);
    Object.assign(this,{phase:'approach',prevR:115,T:0,lastAng:0,yieldSpawned:false,ringPlaced:false,clearWait:0,spawnT:2});
    S.ai=[]; S.peds=[];
    this.spawn(1,2,0.5); this.spawn(0,3,0.28); this.spawn(2,1,0.2);
    S.peds.push(this.mkPed(Math.PI/2,5.5,-1,()=>Math.hypot(S.car.x,S.car.y)<74));
    if(Math.random()<0.7){ const ea=this.arms[this.exit-1].a; S.peds.push(this.mkPed(ea,-5.5,1,()=>this.phase==='ring'&&this.T>(this.exit-1)*Math.PI/2-0.6)); }
    this.signs=[{x:5.5,y:96,type:'limit',val:40},{x:5.5,y:52,type:'rb'},{x:5.5,y:23,type:'giveway'},{x:-5.5,y:30,type:'zebra'}];
    const ex=this.exit;
    const plan=ex===1?'Going right: signal right now and keep to the right part of your lane.':ex===2?'Going straight: keep to the middle of your lane. No signal on the way in.':'Going left: keep to the left part of your lane, close to the centre line.';
    this.hints=[
      {when:()=>this.r()<108,t:'Zebra crossing before the roundabout. Scan the pavements early: is someone about to cross? Be ready to stop.'},
      {when:()=>this.r()<60,t:plan},
      {when:()=>this.r()<36,t:'Look left into the roundabout. Traffic already in it has priority. Arrive slowly enough to stop at the give-way line.'},
      {when:()=>this.phase==='ring'&&ex>1&&this.T>(ex-1)*Math.PI/2-0.15,t:'You are passing the exit before yours: signal right now.'},
      {when:()=>this.phase==='exit',t:'Leaving: watch the crossing. Pedestrians on it have priority.'}
    ];
    S.instr=`Take the ${ORD[ex]} exit (${DIR[ex]})`;
  },
  r(){return Math.hypot(S.car.x,S.car.y);},
  mkPed(a,lat,dir,trigger){return {id:Math.random(),a,r:25.5,lat,dir,state:'wait',trigger,x:0,y:0};},
  rbPath(inA,k){
    const pts=[],ux=Math.cos(inA),uy=Math.sin(inA),nx=Math.sin(inA),ny=-Math.cos(inA);
    for(let r=130;r>=this.rOut+0.5;r-=3) pts.push([ux*r+nx*1.75,uy*r+ny*1.75]);
    const holdIdx=pts.length-1;
    const a0=inA-0.13,a1=inA-k*Math.PI/2+0.13;
    for(let a=a0;a>=a1;a-=0.06) pts.push([Math.cos(a)*this.rMid,Math.sin(a)*this.rMid]);
    const oa=inA-k*Math.PI/2,vx=Math.cos(oa),vy=Math.sin(oa),mx=Math.sin(oa),my=-Math.cos(oa);
    for(let r=this.rOut+0.5;r<=130;r+=3) pts.push([vx*r-mx*1.75,vy*r-my*1.75]);
    let hs=0; for(let i=1;i<=holdIdx;i++) hs+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    return {path:polyline(pts,1.5),holdS:hs};
  },
  conflict(a,self){
    const all=S.ai.concat([S.car]);
    for(const o of all){ if(o===self||o.done) continue; const r=Math.hypot(o.x,o.y); if(r<this.rIn-1||r>this.rOut+1) continue; const d=(((Math.atan2(o.y,o.x)-a)%TAU)+TAU)%TAU; if(d>0.05&&d<1.15) return true; }
    return false;
  },
  spawn(armIdx,k,frac){
    const a=this.arms[armIdx].a,{path,holdS}=this.rbPath(a,k);
    const v=mkVeh({path,s:frac*path.len,v:8,vDes:8.5});
    v.script=(vv,t)=>vv.s<holdS-14?Math.min(t,9.5):Math.min(t,7.5);
    if(v.s<holdS) v.hold={s:holdS,cond:vv=>this.conflict(a,vv)};
    if(k===1&&v.s<holdS+10) v.ind=1;
    pose(v); S.ai.push(v);
  },
  spawnYield(){
    const {path,holdS}=this.rbPath(this.arms[1].a,3);
    const v=mkVeh({path,s:holdS+2+this.rMid*Math.PI/2-4,v:7.5,vDes:7.5}); pose(v); S.ai.push(v);
  },
  armOf(c){ for(const arm of this.arms){ const along=c.x*Math.cos(arm.a)+c.y*Math.sin(arm.a), lat=c.x*Math.sin(arm.a)-c.y*Math.cos(arm.a); if(along>this.rOut-2&&Math.abs(lat)<3.9) return arm; } return null; },
  checkLimit(){return 40;}, hudLimit(){return {v:40};}, zone(){return 'rb';},
  step(dt){
    const c=S.car,r=this.r(),ang=Math.atan2(c.y,c.x),kmh=c.v*3.6,arm=this.armOf(c);
    this.spawnT-=dt; if(this.spawnT<=0){ this.spawnT=3.5+Math.random()*3.5; const ai=Math.floor(Math.random()*3); if(!S.ai.some(v=>!v.done&&v.s<25&&Math.abs(Math.atan2(v.y,v.x)-this.arms[ai].a)<0.3)) this.spawn(ai,1+Math.floor(Math.random()*3),0); }
    if(r<this.rIn-0.2) fault('maneuver','Drove over the central island','serious','island','Hold a steady arc around the island and look where you want to go.');
    if(r>this.rOut+1.2&&!arm){ fault('maneuver','Left the road','intervention','off'); return; }
    // zebra
    for(const p of S.peds){
      if(p.state!=='cross'||!arm||Math.abs(arm.a-p.a)>0.01) continue;
      const along=c.x*Math.cos(p.a)+c.y*Math.sin(p.a), lat=c.x*Math.sin(p.a)-c.y*Math.cos(p.a);
      if(Math.abs(along-p.r)<2.2&&c.v>0.8&&Math.abs(p.lat-lat)<4.5) fault('rules','Did not stop for a pedestrian on the zebra crossing','serious','zebra'+p.id,'At a zebra crossing you must let pedestrians cross who are on it or about to step onto it. Look at the pavements early.');
    }
    if(this.phase==='approach'){
      if(!this.yieldSpawned&&r<70&&(r-this.rOut)/Math.max(c.v,3)<3.6){this.yieldSpawned=true;this.spawnYield();}
      if(this.prevR>35&&r<=35){
        const x=c.x; let msg='';
        if(this.exit===3&&x>1.4) msg='Going left: keep to the left part of your lane, close to the centre line.';
        if(this.exit===1&&x<2.1) msg='Going right: keep to the right part of your lane.';
        if(this.exit===2&&(x<0.7||x>2.9)) msg='Going straight: keep to the middle of your lane.';
        if(msg) fault('place','Wrong position in the lane for your exit','minor','appPlace',msg);
        if(this.exit===1&&S.time-c.lastRight>1) fault('rules','No right signal on the way in for the 1st exit','minor','inSig','Turning right at the first exit: signal right already on the approach.');
      }
      if(this.prevR>23&&r<=23){
        if(kmh>42) fault('speed','Far too fast into the roundabout','serious','appSpd','Slow down early so you can look left and stop if needed. Around 20 to 25 km/h at the line.');
        else if(kmh>32) fault('speed','Too fast approaching the roundabout','minor','appSpd','Slow down early so you can look left and stop if needed.');
      }
      if(r<this.rOut+4&&c.v<0.4){
        const busy=this.conflictWide(ang,2.0)||S.peds.some(p=>p.state==='cross'&&Math.abs(p.a-Math.PI/2)<0.01);
        if(busy) this.clearWait=0; else { this.clearWait+=dt; if(this.clearWait>5) fault('interact','Waited although there was a safe gap','minor','hesitant','Hesitating also affects others. When the gap is clearly big enough, go.'); }
      }
      if(r<=this.rOut+0.2){
        this.phase='ring'; this.lastAng=ang; this.T=0;
        let worst=null;
        for(const v of S.ai){ if(v.done||v.v<1) continue; const rv=Math.hypot(v.x,v.y); if(rv<this.rIn-1||rv>this.rOut+0.5) continue; const d=(((Math.atan2(v.y,v.x)-ang)%TAU)+TAU)%TAU; if(d>0.05&&d<1.3&&(worst===null||d<worst)) worst=d; }
        if(worst!==null){ if(worst<0.5) fault('interact','Entered right in front of a car already in the roundabout','intervention','yieldI'); else fault('interact','Did not give way to traffic already in the roundabout','serious','yield','Traffic in the roundabout comes from your left and has priority. Look left early and arrive slowly enough to stop.'); }
      }
    } else if(this.phase==='ring'){
      this.T+=angDiff(this.lastAng,ang); this.lastAng=ang;
      if(kmh>32) fault('speed','Too fast in the roundabout','minor','ringSpd','Around 20 to 30 km/h in a small roundabout.');
      for(let k=1;k<this.exit;k++){ const e=k*Math.PI/2; if(this.T>e-0.45&&this.T<e+0.05&&c.ind===1) fault('interact',`Signalled right before passing the ${ORD[k]} exit, which is not yours`,'minor','early'+k,'Signal right only after you pass the exit before yours, so drivers waiting there do not think you are leaving.'); }
      if(!this.ringPlaced&&this.T>this.exit*Math.PI/4){
        this.ringPlaced=true;
        if(this.exit===3&&r>this.rMid+0.6) fault('place','Drove on the outer part of the circle although going left','minor','ringPlace','Going left in a one-lane roundabout: use the inner part of the circle.');
        if(this.exit===1&&r<this.rMid-0.6) fault('place','Cut to the inner part of the circle for the 1st exit','minor','ringPlace','Taking the first exit: stay on the outer part.');
      }
      if(arm&&r>this.rOut+1){
        const k=Math.round(this.T/(Math.PI/2));
        if(k!==this.exit) fault('place',`Took the ${ORD[k]||'wrong'} exit instead of the ${ORD[this.exit]}`,'minor','wrongExit','If you miss your exit, go round again or take the next one calmly. A wrong exit alone is not a fail.');
        if(S.time-c.lastRight>1.4) fault('rules','No right signal when leaving the roundabout','minor','exitSig','Always signal right before you leave, once you have passed the exit before yours.');
        this.phase='exit';
      }
    } else if(r>78) finish();
    this.prevR=r;
  },
  conflictWide(a,win){ for(const v of S.ai){ if(v.done) continue; const r=Math.hypot(v.x,v.y); if(r<this.rIn-1||r>this.rOut+8) continue; const d=(((Math.atan2(v.y,v.x)-a)%TAU)+TAU)%TAU; if(d>0.02&&d<win) return true; } return false; },
  ground:'#56704b',
  draw(g){
    g.fillStyle=ASPH;
    for(const arm of this.arms){ g.save(); g.rotate(arm.a); g.fillStyle='#8d918b'; g.fillRect(this.rOut+3,-6.2,140,2.4); g.fillRect(this.rOut+3,3.8,140,2.4); g.fillStyle=ASPH; g.fillRect(this.rOut-4,-3.6,144,7.2); g.restore(); }
    g.beginPath(); g.arc(0,0,this.rOut,0,TAU); g.fill();
    g.fillStyle='#77746d'; g.beginPath(); g.arc(0,0,this.rIn+1.4,0,TAU); g.fill();
    g.fillStyle='#4d6b43'; g.beginPath(); g.arc(0,0,this.rIn,0,TAU); g.fill();
    g.strokeStyle='#c9ccc5'; g.lineWidth=0.4; g.stroke();
    for(const arm of this.arms){
      g.save(); g.rotate(arm.a);
      g.fillStyle='#9ea39a'; g.fillRect(this.rOut+1.6,-0.6,21.9-this.rOut,1.2); g.fillRect(27.5,-0.6,7,1.2);
      g.fillStyle=LINE; for(let y=-3.3;y<3.4;y+=1.0) g.fillRect(24,y,3,0.5);
      g.beginPath(); for(let y=-3.4;y<-0.3;y+=0.75){ g.moveTo(this.rOut+0.5,y); g.lineTo(this.rOut+0.5,y+0.6); g.lineTo(this.rOut+1.5,y+0.3); g.closePath(); } g.fill();
      g.strokeStyle=LINE; g.lineWidth=0.15; g.setLineDash([3,6]); g.beginPath(); g.moveTo(35,0); g.lineTo(140,0); g.stroke(); g.setLineDash([]);
      g.restore();
    }
  },
  zoneName(){return 'Roundabout';}
};

const HW={
  id:'highway',title:'Motorway exit',
  init(){
    this.R=buildPath([[1.75,400],[1.75,-2600]],4); this.L=buildPath([[-1.75,400],[-1.75,-2600]],4);
    this.ramp=buildPath([[5.25,-1640],[5.6,-1700],[9,-1750],[20,-1800],[40,-1840],[70,-1866],[110,-1880],[170,-1886]],2);
    S.car=mkCar(1.75,0,0,100/3.6);
    Object.assign(this,{lane:1,lcT:-9,dwell:0,blockT:0,sideT:0,bm:0,slow:0,rampS:0,rh:null,spawnT:4,bsSpawned:false});
    S.ai=[]; S.peds=[];
    S.ai.push(mkVeh({path:this.R,s:520,v:85/3.6,vDes:85/3.6,kind:'truck',len:12,wid:2.5,color:'#d8d3c6'}));
    for(let i=0;i<6;i++) S.ai.push(mkVeh({path:this.R,s:540+i*17,v:85/3.6,vDes:85/3.6}));
    S.ai.push(mkVeh({path:this.R,s:355,v:28,vDes:30.5}));
    this.signs=[{x:7,y:-30,type:'limit',val:110},{x:7.5,y:-600,type:'mw',val:'Farsta 1000 m'},{x:7.5,y:-1100,type:'mw',val:'Farsta 500 m'},{x:9.5,y:-1440,type:'mw',val:'Farsta ↗'},{x:14,y:-1730,type:'limit',val:70}];
    const prog=()=>-S.car.y;
    this.hints=[
      {when:()=>prog()>20,t:'Truck ahead at 85 km/h with a tight queue in front of it. Before any overtake ask: is the left lane clear behind, can I pass decisively, and where do I go back in?'},
      {when:()=>prog()>560,t:'Exit in about 1 km. Plan now: be settled in the right lane well before it.'},
      {when:()=>prog()>1080,t:'500 m to the exit. No new overtakes from here.'},
      {when:()=>prog()>1320,t:'Exit lane ahead: mirrors (W), signal right (E), shoulder check (D), move over at motorway speed, then brake in the exit lane.'},
      {when:()=>this.surf==='ramp',t:'Ramp curve, limit 70. Get the speed down on the straight part before the bend.'}
    ];
    S.instr='Follow the motorway, then take the exit to Farsta';
  },
  surface(){
    const c=S.car,x=c.x,y=c.y;
    if(y<-1638){ const pr=project(this.ramp,x,y,this.rh); this.rh=pr.i; if(pr.s>0&&pr.s<this.ramp.len&&Math.abs(pr.lat)<2.9){this.rampS=pr.s;return 'ramp';} }
    if(Math.abs(x)<=4.5) return 'main';
    if(x>3.5&&x<=7.4&&y<=-1395&&y>=-1662) return 'exit';
    return 'off';
  },
  checkLimit(){return this.surf==='ramp'?(this.rampS>40?70:0):110;},
  hudLimit(){return {v:this.surf==='ramp'?70:110};},
  zone(){return this.surf==='ramp'?'ramp':'mw';},
  step(dt){
    const c=S.car,surf=this.surf=this.surface(),prog=-c.y,kmh=c.v*3.6;
    if(surf==='off'){fault('maneuver','Left the carriageway','intervention','off');return;}
    this.spawnT-=dt;
    if(this.spawnT<=0&&prog<1500){ this.spawnT=6+Math.random()*5; const ps=400-c.y, s0=ps-170; if(!S.ai.some(v=>v.path===this.L&&!v.done&&Math.abs(v.s-s0)<40)) S.ai.push(mkVeh({path:this.L,s:s0,v:33.5,vDes:33.5})); }
    if(!this.bsSpawned&&prog>260){ this.bsSpawned=true; const ps=400-c.y; S.ai.push(mkVeh({path:this.L,s:ps-26,v:c.v+0.6,vDes:Math.max(c.v+0.6,26)})); }
    const inR=v=>v.path===this.R, inL=v=>v.path===this.L;
    if(surf!=='ramp'){
      let L=this.lane;
      if(L===1&&c.x<-0.3)L=0; else if(L===0&&c.x>0.3)L=1; else if(L===1&&c.x>3.8)L=2; else if(L===2&&c.x<3.2)L=1;
      if(L!==this.lane){ laneChangeCheck(this.lane,L); if(this.lane===1&&L===0&&prog>1100) fault('predict','Started an overtake less than 400 m before your exit','serious','lateOT','Close to an exit, stay in the right lane. Overtaking is never required.'); this.lane=L; }
      if(c.x>3.7&&c.y>-1400) fault('place','Drove on the hard shoulder','minor','shoulder','Stay inside the edge line. The shoulder is for breakdowns.');
    }
    if(surf==='main'&&this.lane===0){
      let reason=false,follower=false,alongside=false;
      for(const v of S.ai){ if(v.done) continue; const r=rel(v); if(inR(v)&&r.f>-6&&r.f<90) reason=true; if(inR(v)&&Math.abs(r.f)<8) alongside=true; if(inL(v)&&r.f<-3&&r.f>-35) follower=true; }
      if(!reason){this.dwell+=dt; if(this.dwell>4) fault('place','Stayed in the left lane without overtaking','minor','dwell','On Swedish motorways the left lane is for overtaking. Return right as soon as it is safe.');} else this.dwell=0;
      if(follower){this.blockT+=dt; if(this.blockT>2.5) fault('interact','Held up faster traffic in the left lane','serious','block','Plan the overtake so you can return right. If you cannot get past, ease off and slot back in behind.');} else this.blockT=0;
      if(alongside){this.sideT+=dt; if(this.sideT>5) fault('predict','Stuck alongside the queue with no gap to return to','serious','stuck','Before you pull out, find the gap you will return into. A long queue with no gaps means: stay behind.');} else this.sideT=0;
      if(prog>1330) fault('predict','Still in the left lane close to your exit','serious','lateRight','Be settled in the right lane before the 500 m sign.');
    } else {this.dwell=0;this.blockT=0;this.sideT=0;}
    if(surf==='main'&&prog>1150&&prog<1660&&c.acc<-2.0&&kmh<98){
      this.bm+=dt;
      if(this.bm>0.7){ const fol=S.ai.some(v=>!v.done&&(this.lane===0?inL(v):inR(v))&&rel(v).f<-3&&rel(v).f>-16); fault('predict','Slowed down on the motorway before reaching the exit lane',fol?'serious':'minor','brakeMain','Keep motorway speed until you are fully in the exit lane, then brake there.'); }
    } else this.bm=0;
    if(surf==='main'&&prog<1330&&kmh<75){
      const ahead=S.ai.some(v=>{if(v.done)return false;const r=rel(v);return r.f>2&&r.f<70&&Math.abs(r.l)<1.8;});
      if(!ahead){this.slow+=dt; if(this.slow>3) fault('speed','Too slow for the motorway','minor','slow','Match the flow. On a 110 road aim for 100 to 110 when it is clear.');} else this.slow=0;
    } else this.slow=0;
    if(surf==='ramp'&&this.rampS>70){ if(kmh>90) fault('speed','Far too fast on the exit ramp','serious','rampF2','Brake on the straight part of the exit lane, before the curve.'); else if(kmh>78) fault('speed','Too fast into the ramp curve','minor','rampF','Brake on the straight part of the exit lane, before the curve.'); }
    if(surf==='main'&&c.y<-1720){ fault('predict','Missed the exit','minor','missed','A missed exit is not a fail if you carry on safely, but it shows the plan came too late. Position early.'); finish(); }
    if(surf==='ramp'&&this.rampS>this.ramp.len-20) finish();
  },
  ground:'#5a6f4f',
  draw(g){
    g.fillStyle='#7e8389'; g.fillRect(-5.8,-2600,0.7,3000);
    g.fillStyle=ASPH; g.fillRect(-4.6,-2600,9.2,3000);
    g.beginPath(); g.moveTo(3.5,-1380); g.lineTo(7.3,-1430); g.lineTo(7.3,-1665); g.lineTo(3.5,-1665); g.closePath(); g.fill();
    strokeOff(g,this.ramp,0,5.6,ASPH);
    g.strokeStyle=LINE; g.lineWidth=0.15;
    g.setLineDash([3,9]); line(g,0,350,0,-2600);
    g.setLineDash([]); g.lineWidth=0.2; line(g,-3.6,350,-3.6,-2600); line(g,3.6,350,3.6,-1420); line(g,3.6,-1665,3.6,-2600);
    g.lineWidth=0.35; g.setLineDash([1,1]); line(g,3.6,-1420,3.6,-1665); g.setLineDash([]);
    g.lineWidth=0.2; line(g,7.1,-1430,7.1,-1640);
    strokeOff(g,this.ramp,2.6,0.2,LINE); strokeOff(g,this.ramp,-2.6,0.2,LINE,null,40);
  }
};

const CR={
  id:'country',title:'Country road',
  init(){
    this.main=buildPath([[0,60],[0,-260],[12,-360],[35,-430],[30,-500],[-10,-570],[-40,-640],[-50,-720],[-50,-1100],[-50,-1500],[-50,-1850]],2);
    this.rev=reversePath(this.main);
    S.car=mkCar(1.75,40,0,70/3.6);
    Object.assign(this,{hint:null,cT:0,eT:0,gT:0,bendCar:false,cycCar:false,vilCar:false,jTrig:false,jChecked:false,jReleased:false,busSig:false,busGo:false,busChecked:false,cycPassed:false,cycF:undefined,jClose:false});
    S.ai=[]; S.peds=[];
    this.J=1160; const q=at(this.main,this.J); this.jx=q.x; this.jy=q.y;
    this.cyc=mkVeh({path:this.main,s:760,lat:3.0,v:5,vDes:5,kind:'bike',len:1.8,wid:0.7,color:'#2a6fb0',ignorePlayer:true});
    S.ai.push(this.cyc);
    const jx=this.jx,jy=this.jy;
    const jp=polyline([[jx+60,jy-1.75],[jx+5.5,jy-1.75],[jx+3.6,jy-2.4],[jx+2.4,jy-4],[jx+1.75,jy-6.5],[jx+1.75,jy-30],[jx+1.75,jy-900]],1.5);
    this.jc=mkVeh({path:jp,s:44,v:0,vDes:15,accel:2.4,color:'#8e2b23'});
    this.jc.hold={s:54,cond:()=>!this.jReleased};
    S.ai.push(this.jc);
    this.bus=mkVeh({path:this.main,s:1560,lat:2.3,v:0,vDes:0,kind:'bus',len:12,wid:2.55,color:'#c8102e',parked:true,accel:1.3});
    this.bus.script=(v,t,dt)=>{v.lat+=(1.75-v.lat)*Math.min(1,dt*0.8);return t;};
    S.ai.push(this.bus);
    this.signs=[signAt(this.main,25,5.5,'limit',80),signAt(this.main,285,5.5,'warn','bend'),signAt(this.main,1065,5.5,'warn','junction'),signAt(this.main,1398,5.8,'limit',50),signAt(this.main,1404,8.5,'town','Farsta'),signAt(this.main,1548,5.5,'bus')];
    this.trees=[]; let seed=7; const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
    for(let s=0;s<1380;s+=11){ if(Math.abs(s-this.J)<45) continue; const side=rnd()<0.5?-1:1; const q2=at(this.main,s); const l=side*(9+rnd()*22); this.trees.push({x:q2.x-q2.ty*l,y:q2.y+q2.tx*l,r:2.2+rnd()*2.2,c:rnd()<0.5?'#2f4a2c':'#3a5634'}); }
    this.houses=[]; for(let s=1430;s<1760;s+=38){ for(const side of [-1,1]){ if(side===1&&Math.abs(s-1556)<30) continue; const q2=at(this.main,s); const l=side*(15+rnd()*4); this.houses.push({x:q2.x-q2.ty*l,y:q2.y+q2.tx*l,h:Math.atan2(q2.tx,-q2.ty),w:7+rnd()*3,d:9+rnd()*3}); } }
    const ps=()=>this.ps||0;
    this.hints=[
      {when:()=>ps()>45,t:'Country road, 80. Look far ahead and keep asking what could happen: bends, side roads, cyclists, oncoming traffic.'},
      {when:()=>ps()>270,t:'Bend warning. Ease off now so you enter the bend at a steady speed, and keep to the right in your lane.'},
      {when:()=>ps()>620,t:'Cyclist ahead. Is something coming the other way? If so, wait behind, then pass with at least 1.5 m.'},
      {when:()=>ps()>1045,t:'Side road on the right with a car waiting. Ease off and cover the brake: what if it pulls out?'},
      {when:()=>ps()>1320,t:'Village ahead. Be down to 50 by the sign, not after it.'},
      {when:()=>ps()>1455,t:'Bus at the stop signalling left. In a 50 zone you must let it pull out.'}
    ];
    S.instr='Follow the road ahead towards Farsta';
  },
  checkLimit(){const s=this.ps||0; return s<1425?80:50;},
  hudLimit(){return {v:(this.ps||0)<1398?80:50};},
  zone(){return (this.ps||0)<1425?'r80':'r50';},
  onc(mainS,v){S.ai.push(mkVeh({path:this.rev,s:this.main.len-mainS,lat:1.75,v,vDes:v,onc:true}));},
  step(dt){
    const c=S.car,pr=project(this.main,c.x,c.y,this.hint); this.hint=pr.i;
    const s=pr.s,lat=pr.lat,kmh=c.v*3.6; this.ps=s;
    const onSide=c.x>this.jx+3&&Math.abs(c.y-this.jy)<3.8;
    if(Math.abs(lat)>4.8&&!onSide){fault('maneuver','Left the road','intervention','off');return;}
    if(!this.bendCar&&s>300){this.bendCar=true;this.onc(s+250,20);}
    if(!this.cycCar&&s>600){this.cycCar=true; const tp=Math.max(2,(this.cyc.s-s)/17.2); this.onc(this.cyc.s+5*tp+22*tp,22);}
    if(!this.vilCar&&s>1440){this.vilCar=true;this.onc(s+170,13.9);}
    const q=at(this.main,s),k=Math.abs(q.k),inBend=k>1/320;
    if(inBend){
      const vr=Math.min(80,Math.sqrt(2.4/k)*3.6);
      if(kmh>vr+10) fault('speed','Too fast into the bend','minor','bend'+Math.floor(s/150),'Read the warning sign and ease off before the bend so you can drive through it at a steady speed.');
      if(c.acc<-2.4&&k>1/250) fault('predict','Braked in the middle of the bend','minor','bendBrake'+Math.floor(s/150),'Brake on the straight before the bend, then hold a steady speed through it.');
      if(lat<0.4){ const onc=S.ai.some(v=>v.onc&&!v.done&&rel(v).f>0&&rel(v).f<110); fault('place','Cut across the centre line in the bend',onc?'serious':'minor','bendPlace','In bends keep well to the right in your lane. You cannot see what is coming round it.'); }
    }
    const passing=S.ai.some(v=>{if(v.done||v.onc)return false;const r=rel(v);return r.f>-10&&r.f<30&&(v.kind==='bike'||v.kind==='bus');});
    if(!inBend&&!passing&&lat<0.3){this.cT+=dt; if(this.cT>1.2) fault('place','Drove too close to the centre line','minor','center'+Math.floor(s/400),'Keep to the right part of your lane, about a metre in from the edge line.');} else this.cT=0;
    if(lat>3.0){this.eT+=dt; if(this.eT>1.5) fault('place','Drove too close to the road edge','minor','edge'+Math.floor(s/400),'Keep a margin to the edge for verges, cyclists and wildlife.');} else this.eT=0;
    // cyclist
    const cy=this.cyc;
    if(!cy.done){
      const r=rel(cy);
      if(this.cycF!==undefined&&this.cycF<0&&r.f>=0&&!this.cycPassed){ this.cycPassed=true; const gap=Math.abs(r.l)-1.25; if(gap<1.0) fault('interact','Passed the cyclist far too close','serious','cycGap','Give cyclists at least 1.5 m. If there is no room, wait behind.'); else if(gap<1.5) fault('interact','Passed the cyclist with less than 1.5 m','minor','cycGap','Give cyclists at least 1.5 m. If there is no room, wait behind.'); }
      if(r.f>-8&&r.f<8&&Math.abs(r.l)<3.6){ const onc=S.ai.some(v=>{if(!v.onc||v.done)return false;const q2=rel(v);return q2.f>0&&q2.f<100;}); if(onc) fault('predict','Passed the cyclist with oncoming traffic too close','serious','cycOnc','Slow down behind the cyclist, let the oncoming car pass, then overtake with a wide margin.'); }
      this.cycF=r.f;
    }
    // junction
    if(!this.jChecked&&s>=this.J-80){this.jChecked=true; if(kmh>72) fault('predict','Did not ease off approaching the side road with a waiting car','minor','junc','A car waiting at a side road may pull out. Ease off, cover the brake and be ready.');}
    if(!this.jReleased&&s>=this.J-58) this.jReleased=true;
    let lead=null,lf=1e9;
    for(const v of S.ai){ if(v.done||v.onc) continue; const r=rel(v); if(r.f>2&&r.f<120&&Math.abs(r.l)<1.8&&r.f<lf){lf=r.f;lead=v;} }
    if(lead&&c.v>3){
      const tg=(lf-(lead.len+4.5)/2)/c.v;
      if(lead===this.jc&&tg<0.8&&!this.jClose){this.jClose=true; fault('predict','Too close when the car pulled out: you were not ready for it','serious','jClose','Anticipate: ease off before the side road so you have time and space if it pulls out.');}
      if(tg<2&&c.v>8&&lead.kind!=='bike'&&lead.kind!=='bus'){this.gT+=dt; if(this.gT>3) fault('attention','Following too closely','minor','gap'+Math.floor(s/300),'On country roads keep at least 3 seconds to the vehicle ahead.');} else this.gT=0;
    } else this.gT=0;
    // bus
    if(!this.busSig&&s>1465){this.busSig=true;this.bus.ind=-1;}
    if(!this.busGo&&s>1505){this.busGo=true;this.bus.parked=false;this.bus.vDes=11;}
    if(this.busGo&&!this.busChecked&&!this.bus.done){ const r=rel(this.bus); if(r.f<0&&r.f>-14&&this.bus.v<9&&Math.abs(r.l)<4.5){this.busChecked=true; fault('rules','Did not let the bus pull out from the stop','serious','bus','Where the limit is 50 km/h or lower you must let a bus leave the stop when it signals.');} }
    if(this.bus.v>6) this.bus.ind=0;
    if(s>1745) finish();
  },
  ground:'#5b7150',
  draw(g){
    const jx=this.jx,jy=this.jy;
    g.fillStyle=ASPH; g.fillRect(jx+3,jy-3.6,70,7.2);
    strokeOff(g,this.main,0,7.6,ASPH);
    const qb=this.main; g.fillStyle='#8d918b';
    strokeOff(g,qb,5.4,2.2,'#8d918b',null,1530,1585);
    g.fillStyle=LINE; g.beginPath(); for(let y=jy-3.4;y<jy-0.3;y+=0.75){ g.moveTo(jx+4.2,y); g.lineTo(jx+4.2,y+0.6); g.lineTo(jx+5.2,y+0.3); g.closePath(); } g.fill();
    strokeOff(g,this.main,0,0.15,LINE,[3,9],0,1e9,p=>Math.abs(p.k)<1/400);
    strokeOff(g,this.main,0,0.15,LINE,null,0,1e9,p=>Math.abs(p.k)>=1/400);
    strokeOff(g,this.main,3.45,0.12,LINE,[1,2],0,1e9,p=>Math.abs(p.y-jy)>4);
    strokeOff(g,this.main,-3.45,0.12,LINE,[1,2]);
    for(const t of this.trees){ g.fillStyle=t.c; g.beginPath(); g.arc(t.x,t.y,t.r,0,TAU); g.fill(); }
    for(const h of this.houses){ g.save(); g.translate(h.x,h.y); g.rotate(h.h); g.fillStyle='#8e2b23'; g.fillRect(-h.w/2,-h.d/2,h.w,h.d); g.fillStyle='#e9e4da'; g.fillRect(-h.w/2,-0.25,h.w,0.5); g.restore(); }
  }
};
/* ---------- Farsta: real roads from OpenStreetMap ----------
   Data comes from data/farsta.level.js (built by tools/osm-to-level.mjs), the network helpers from
   src/osm-lib.js. Map data © OpenStreetMap contributors. */
const FD=window.FDL_FARSTA||null, OL=window.FDL_OSM||null;
function idxAt(path,s){ const p=path.pts; if(s<=0) return 0; if(s>=path.len) return p.length-1; let lo=0,hi=p.length-1; while(hi-lo>1){const m=(lo+hi)>>1; if(p[m].s<s)lo=m; else hi=m;} return lo; }
function relTo(v,o){const fx=Math.sin(v.h),fy=-Math.cos(v.h),dx=o.x-v.x,dy=o.y-v.y; return {f:dx*fx+dy*fy,l:-dx*fy+dy*fx};}
const capFirst=t=>t.charAt(0).toUpperCase()+t.slice(1);
const OSM={
  id:'farsta',title:'Farsta',ground:'#5f7653',maxAI:12,
  setup(){
    if(this.net) return;
    const net=this.net=new OL.Net(FD);
    this.bld=FD.bld.map(b=>{ const pts=[]; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(let i=1;i<b.length;i+=2){ pts.push([b[i],b[i+1]]); x0=Math.min(x0,b[i]); x1=Math.max(x1,b[i]); y0=Math.min(y0,b[i+1]); y1=Math.max(y1,b[i+1]); } return {lv:b[0],pts,bb:[x0,y0,x1,y1],cx:(x0+x1)/2,cy:(y0+y1)/2}; });
    this.bgrid=new Map(); this.bld.forEach(b=>{ for(let i=Math.floor(b.bb[0]/40);i<=Math.floor(b.bb[2]/40);i++) for(let j=Math.floor(b.bb[1]/40);j<=Math.floor(b.bb[3]/40);j++){ const k=i+','+j; let l=this.bgrid.get(k); if(!l) this.bgrid.set(k,l=[]); l.push(b); } });
    this.heads=[...net.lightAp.entries()].map(([de,ap])=>{ const e=net.eOf(de), p=net.pointAt(de,net.len(de)-ap.stop), off=e.half+0.9; return {cl:ap.cl,grp:ap.grp,x:p.x-p.ty*off,y:p.y+p.tx*off,sx:p.x,sy:p.y,tx:p.tx,ty:p.ty,half:e.half,ow:e.way.ow}; });
    this.zebras=FD.feats.filter(f=>f.t==='zebra').map(f=>{ const e=net.E[f.e], p=net.pointAt(2*f.e,f.s); return {x:f.x,y:f.y,tx:p.tx,ty:p.ty,w:e.way.w}; });
    this.teeth=[];
    for(const f of FD.feats){ if(f.t!=='give_way'&&f.t!=='stop') continue; const e=net.E[f.e], de=f.d===1?2*f.e:2*f.e+1, p=net.pointAt(de,f.d===1?f.s:e.len-f.s); this.teeth.push({x:p.x,y:p.y,tx:p.tx,ty:p.ty,half:e.half,ow:e.way.ow,stop:f.t==='stop'}); }
    for(let n=0;n<net.N;n++){
      const ring=net.out[n].find(d=>net.rb(d)); if(ring==null) continue;
      for(const d of net.inc[n]){ if(net.rb(d)) continue; const e=net.eOf(d), L=net.len(d), p=net.pointAt(d,Math.max(0,L-net.eOf(ring).half-0.6)); this.teeth.push({x:p.x,y:p.y,tx:p.tx,ty:p.ty,half:e.half,ow:e.way.ow}); }
    }
  },
  init(o){
    this.setup(); const net=this.net; this.maxAI=12; this.noScripted=false;
    let r=o.route&&o.route!=='random'?FD.routes.find(x=>x.id===o.route):null;
    if(!r&&(o.route==='random'||!FD.routes.length)){
      const g=net.generateFrom(FD.centre.x,FD.centre.y,{rb:3,sig:3,right:3,yield:2,zebra:1,bus:1,turn:1},OL.rng(Math.random()*4e9),{minLen:1500,maxLen:5000,tries:20});
      if(g) r={id:'random',name:'Random route',desc:`${(g.stats.len/1000).toFixed(1)} km`,de:g.de,s0:g.s0};
    }
    if(!r) r=FD.routes[0];
    this.route=r; this.goal=net.from(r.de[0]);
    Object.assign(this,{gen:0,offT:0,wrongT:0,orT:0,spawnT:0,res:new Map(),specials:0,reroutes:0,near:null,ps:0});
    S.ai=[]; S.peds=[];
    this.setRoute(r.de,r.s0);
    const p0=this.path.pts[0]; S.car=mkCar(p0.x,p0.y,Math.atan2(p0.tx,-p0.ty),0);
    this.prepScenery();
    for(let i=0;i<8;i++) this.spawnAI(45,260);
    S.instr=this.instrText();
  },
  subtitle(){ return this.route?this.route.name:''; },
  setRoute(de,s0){
    const net=this.net, pp=net.pathPoints(de,s0), path=finalize(pp.pts);
    let z=0,prev=null;
    path.pts.forEach((p,i)=>{ const q=pp.pts[i]; p.w=q.w; p.rb=q.rb; p.lim=OL.wayLimit(FD.ways[q.w]); if(prev!=null&&p.lim!==prev) z++; prev=p.lim; p.z=z; });
    this.path=path; this.de=de; this.hint=null; this.prevS=null; this.gen++;
    const ev=net.events(de,s0,pp.ends);
    for(const e of ev){ e.s=project(path,e.x,e.y,e.pi).s; e.key=this.gen+'_'+e.id; }
    ev.sort((a,b)=>a.s-b.s);
    let nRight=0,nZebra=0;
    for(const e of ev){
      if(e.t==='node'&&e.m==='rb'){ e.out=ev.find(x=>x.t==='rbout'&&x.s>=e.s); e.spawnRing=Math.random()<0.65; }
      if(e.t==='node'&&e.ctrl==='right'&&nRight<2){ nRight++; e.spawnRight=Math.random()<0.75; }
      if(e.t==='zebra'&&e.s>40&&nZebra<3&&Math.random()<0.6){ nZebra++; this.mkPed(e); }
    }
    this.busEv=ev.find(e=>e.t==='bus'&&e.lim<=50&&e.s>150)||null;
    this.ev=ev; this.nodes=ev.filter(e=>e.t==='node');
    this.hints=this.mkHints();
  },
  mkPed(e){
    const side=Math.random()<0.5?1:-1, half=e.half+1.4;
    S.peds.push({id:Math.random(),a:e.a,ox:e.x,oy:e.y,half,lat:side*half,dir:-side,state:'wait',ev:e,x:e.x,y:e.y,
      trigger:()=>{ const d=e.s-this.ps; return d>0&&d<Math.max(22,S.car.v*4.2); }});
  },
  reroute(){
    const c=S.car, st=this.net.nearestDe(c.x,c.y,c.h,15); if(!st) return;
    const r=this.net.route(st.de,this.goal); if(!r) return;
    S.peds=S.peds.filter(p=>p.state==='cross');
    this.setRoute(r,st.s); this.reroutes++;
    if(S.mode==='coach'){ S.hint='You left the planned route. That is not a fault on its own: follow the new directions.'; S.hintT=S.time; }
  },
  instrText(){
    const s=this.ps||0, nx=this.nodes.find(e=>e.s>s-3);
    if(nx&&nx.s-s<320){
      const d=nx.s-s, pre=d>30?`In ${Math.max(10,Math.round(d/10)*10)} m, `:'', onto=nx.name?` onto ${nx.name}`:'';
      if(nx.m==='rb') return capFirst(`${pre}at the roundabout, take the ${ORD[nx.n]||nx.n+'th'} exit${onto}`);
      if(nx.dir==='straight') return capFirst(`${pre}straight ahead ${nx.ctrl==='signals'?'at the lights':'at the junction'}`);
      if(nx.dir==='back') return capFirst(`${pre}turn around where it is safe`);
      return capFirst(`${pre}turn ${nx.dir}${nx.ctrl==='signals'?' at the lights':''}${onto}`);
    }
    if(this.path.len-s<250) return 'Drive back to the test centre';
    const w=FD.ways[this.path.pts[idxAt(this.path,s)].w]; return w&&w.n?`Follow ${w.n}`:'Follow the road';
  },
  mkHints(){
    const H=[], near=(e,dmax)=>()=>{ const d=e.s-(this.ps||0); return d>0&&d<dmax; };
    for(const e of this.ev){
      if(e.t==='node'&&e.m==='rb'){
        const plan=e.dir==='right'?'Going right: signal right already now and keep to the right part of your lane.':e.dir==='left'?'Going left: keep to the left part of your lane, close to the centre line.':'Going straight: keep to the middle of your lane. No signal on the way in.';
        H.push({when:near(e,160),t:`Roundabout ahead, ${ORD[e.n]||e.n+'th'} exit. ${plan} Give way to traffic already in it.`});
      } else if(e.t==='node'){
        let t='';
        if(e.dir==='left') t='Left turn ahead: mirrors, signal left early and move towards the centre line.';
        else if(e.dir==='right') t='Right turn ahead: mirrors, signal right, keep right and look over your right shoulder for cyclists.';
        if(e.ctrl==='right') t+=(t?' ':'')+'No signs at this junction, so högerregeln applies: give way to traffic from your right.';
        else if(e.ctrl==='stop') t+=(t?' ':'')+'Stop sign: stop completely at the line.';
        else if(e.ctrl==='give_way') t+=(t?' ':'')+'Give-way line ahead: slow down and be ready to stop.';
        else if(e.ctrl==='yield') t+=(t?' ':'')+'You are coming out onto a bigger road: expect to give way.';
        if(t) H.push({when:near(e,140),t});
      } else if(e.t==='light') H.push({when:near(e,130),t:'Traffic lights ahead. Watch them early: if they turn amber and you can stop safely, stop.'});
      else if(e.t==='zebra') H.push({when:near(e,90),t:'Zebra crossing ahead. Scan the pavements: is someone about to cross?'});
    }
    if(this.busEv){ const e=this.busEv; H.push({when:near(e,170),t:'Bus stop ahead. In a 50 zone you must let a bus pull out when it signals.'}); }
    const P=this.path.pts; for(let i=1;i<P.length;i++) if(P[i].lim<P[i-1].lim){ const s=P[i].s, lim=P[i].lim; H.push({when:()=>{const d=s-(this.ps||0); return d>0&&d<110;},t:`The limit drops to ${lim} ahead. Be down to ${lim} by the sign, not after it.`}); }
    return H;
  },
  checkLimit(){ const P=this.path.pts, s=this.ps||0; return Math.max(P[idxAt(this.path,s)].lim,P[idxAt(this.path,s-30)].lim); },
  hudLimit(){ return {v:this.path.pts[idxAt(this.path,this.ps||0)].lim}; },
  zone(){ return 'z'+this.gen+'_'+this.path.pts[idxAt(this.path,this.ps||0)].z; },
  step(dt){
    const c=S.car, net=this.net, pr=project(this.path,c.x,c.y,this.hint); this.hint=pr.i;
    const s=pr.s, prev=this.prevS==null?s:this.prevS; this.ps=s;
    const nr=this.near=net.nearest(c.x,c.y,30);
    if(!nr||nr.d>nr.half+1.8){ this.offT+=dt; if(this.offT>0.25){ fault('maneuver','Left the road','intervention','off'); return; } } else this.offT=0;
    if(nr&&nr.way.ow&&nr.d<nr.half&&c.v>1.5&&Math.cos(angDiff(c.h,nr.h))<-0.3){ this.wrongT+=dt; if(this.wrongT>1){ fault('rules','Drove against the direction of a one-way street','intervention','wrongway'); return; } } else this.wrongT=0;
    if(pr.dist>8&&c.v>0.5&&nr&&nr.d<nr.half+0.5){ this.orT+=dt; if(this.orT>0.8){ this.orT=0; this.reroute(); return; } } else this.orT=0;
    this.checks(s,prev,pr.lat);
    this.traffic(dt);
    S.instr=this.instrText();
    this.prevS=s;
    if(s>this.path.len-10&&pr.dist<8) finish();
  },
  checks(s,prev,lat){
    const c=S.car, kmh=c.v*3.6, cross=x=>prev<x&&s>=x;
    for(const e of this.ev){
      const d=e.s-s, K=e.key; if(d>200||d<-80) continue;
      if(e.t==='node'&&e.m==='turn'){
        const L=e.dir==='left', R=e.dir==='right';
        if((L||R)&&e.oneLane&&cross(e.s-22)){
          if(L&&lat>0.45) fault('place','Not positioned towards the centre line before turning left','minor','pos'+K,'Turning left: move over towards the centre line in good time, so traffic behind can pass on your right.');
          if(R&&lat<-0.6) fault('place','Not keeping to the right before turning right','minor','pos'+K,'Turning right: keep to the right part of your lane before the turn.');
        }
        if((L||R)&&cross(e.s-6)){
          const last=L?c.lastLeft:c.lastRight;
          if(S.time-last>1) fault('rules',`No signal before turning ${e.dir}`,'minor','sig'+K,'Signal in good time before every turn, after checking the mirrors.');
          else if(c.ind===(L?-1:1)&&c.indOn<1.5) fault('interact',`Signalled late before turning ${e.dir}`,'minor','sigl'+K,'Give the signal early enough for others to react, about 50 to 100 m before the turn in town.');
          if(c.mirrorAgo>8) fault('attention',`No mirror check before turning ${e.dir}`,'minor','mir'+K,'Mirrors before you signal and before you turn, every time.');
          if(R&&c.lookRAgo>6) fault('attention','No shoulder check to the right before turning right','minor','shr'+K,'Before a right turn, look over your right shoulder for cyclists and mopeds coming up beside you.');
        }
        if(Math.abs(e.angle)>1.0&&Math.abs(d)<6&&kmh>30) fault('speed',`Too fast through the ${e.dir} turn`,'minor','tsp'+K,'Slow down before the junction so you can turn smoothly and see what is there.');
        if(e.ctrl==='stop'){ if(d<15&&d>0) e.minV=Math.min(e.minV==null?99:e.minV,c.v); if(cross(e.s-1)&&(e.minV==null?99:e.minV)>0.6) fault('rules','Did not stop at the stop sign','serious','stop'+K,'At a stop sign you must stop completely at the line, even if the road looks clear.'); }
        if(e.ctrl==='right'){
          if(cross(e.s-15)&&kmh>32) fault('speed','Too fast into an unmarked junction','minor','rsp'+K,'At junctions without signs, traffic from the right has priority. Arrive slowly enough to stop.');
          if(e.spawnRight&&!this.noScripted&&e.dir!=='right'&&!e.spawned&&d<70&&d>25){ e.spawned=true; this.spawnRight(e); }
        }
        if(['give_way','stop','yield','right'].includes(e.ctrl)&&cross(e.s-3)&&this.conflictAt(e)){
          if(e.ctrl==='right') fault('rules','Did not give way to traffic from the right (högerregeln)','serious','gw'+K,'Junctions without signs: give way to vehicles coming from your right. Look right early and slow down.');
          else fault('rules','Did not give way at the junction','serious','gw'+K,e.assumed?'Coming out of a smaller road onto a bigger one you normally have to give way. Look for the sign and the line, and slow down early.':'A give-way sign or line means traffic on the other road goes first. Slow down early and look both ways.');
        }
      } else if(e.t==='node'&&e.m==='rb'){
        if(e.ring&&e.oneLane&&cross(e.s-28)){
          let msg='';
          if(e.dir==='left'&&lat>-0.25) msg='Going left: keep to the left part of your lane, close to the centre line.';
          if(e.dir==='right'&&lat<0.25) msg='Going right: keep to the right part of your lane.';
          if(e.dir==='straight'&&Math.abs(lat)>1.05) msg='Going straight: keep to the middle of your lane.';
          if(msg) fault('place','Wrong position in the lane for your exit','minor','rpos'+K,msg);
        }
        if(cross(e.s-14)&&e.n===1&&e.dir==='right'&&S.time-c.lastRight>1) fault('rules','No right signal on the way in for the 1st exit','minor','rin'+K,'Turning right at the first exit: signal right already on the approach.');
        if(cross(e.s-12)){ if(kmh>42) fault('speed','Far too fast into the roundabout','serious','rsp'+K,'Slow down early so you can look left and stop if needed. Around 20 to 25 km/h at the line.'); else if(kmh>32) fault('speed','Too fast approaching the roundabout','minor','rsp'+K,'Slow down early so you can look left and stop if needed.'); }
        if(e.spawnRing&&!this.noScripted&&!e.spawned&&d<80&&d>20&&d/Math.max(c.v,3)<4.5){ e.spawned=true; this.spawnRing(e); }
        if(cross(e.s)){ const v=this.ringConflict(e.node,c,2); if(v&&v.v>1){ if(Math.hypot(v.x-c.x,v.y-c.y)<9) fault('interact','Entered right in front of a car already in the roundabout','intervention','ryI'+K); else fault('interact','Did not give way to traffic already in the roundabout','serious','ry'+K,'Traffic in the roundabout comes from your left and has priority. Look left early and arrive slowly enough to stop.'); } }
        if(d<0&&e.out&&s<e.out.s&&kmh>32) fault('speed','Too fast in the roundabout','minor','rring'+K,'Around 20 to 30 km/h in a small roundabout.');
      } else if(e.t==='rbx'){
        if(cross(e.s-2.5)&&c.ind===1) fault('interact',`Signalled right before passing the ${ORD[e.idx]} exit, which is not yours`,'minor','rx'+K,'Signal right only after you pass the exit before yours, so drivers waiting there do not think you are leaving.');
      } else if(e.t==='rbout'){
        if(cross(e.s+3)&&S.time-c.lastRight>1.4) fault('rules','No right signal when leaving the roundabout','minor','rout'+K,'Always signal right before you leave, once you have passed the exit before yours.');
      } else if(e.t==='light'){
        if(cross(e.s)&&c.v>1.5){ const st=this.net.lightState(e.cl,e.grp,S.time);
          if(st.st==='R'&&st.t>0.3) fault('rules','Drove against a red light','serious','red'+K,'Red means stop at the stop line. Watch the lights early so you can stop smoothly.');
          else if(st.st==='Y'&&st.t>1.2) fault('predict','Drove through on amber although you could have stopped','minor','amb'+K,'Amber means stop if you can do it safely. Approach lights at a speed that lets you stop.'); }
      } else if(e.t==='zebra'){
        for(const p of S.peds){
          if(p.ev!==e||p.state==='done') continue;
          if(p.state==='cross'&&Math.abs(d)<2.2&&c.v>0.8){ const pl=(c.x-p.ox)*Math.sin(p.a)-(c.y-p.oy)*Math.cos(p.a); if(Math.abs(p.lat-pl)<4.5) fault('rules','Did not stop for a pedestrian on the zebra crossing','serious','zb'+K,'At a zebra crossing you must let pedestrians cross who are on it or about to step onto it. Look at the pavements early.'); }
          if(d>0&&d<25&&kmh>32) fault('speed','Too fast towards a zebra crossing with a pedestrian next to it','minor','zbs'+K,'When someone is at a zebra crossing, slow down early so you can stop.');
        }
      }
    }
    // bus leaving its stop
    const e=this.busEv;
    if(e&&!S.ended){
      const d=e.s-s;
      if(!e.bus&&d<160&&d>60){ const b=mkVeh({path:this.path,s:e.s-6,lat:3.0,v:0,vDes:0,kind:'bus',len:12,wid:2.55,color:'#c8102e',parked:true,accel:1.3}); b.script=(v,t,dt)=>{v.lat+=(0-v.lat)*Math.min(1,dt*0.8);return t;}; S.ai.push(b); e.bus=b; }
      const b=e.bus;
      if(b&&!b.done){
        if(!e.sig&&d<70){ e.sig=true; b.ind=-1; }
        if(!e.go&&d<42){ e.go=true; b.parked=false; b.vDes=Math.min(11,e.lim/3.6); }
        if(e.go&&!e.chk){ const r=rel(b); if(r.f<0&&r.f>-14&&b.v<9&&Math.abs(r.l)<4.5){ e.chk=true; fault('rules','Did not let the bus pull out from the stop','serious','bus'+e.key,'Where the limit is 50 km/h or lower you must let a bus leave the stop when it signals.'); } }
        if(b.v>6) b.ind=0;
      }
    }
  },
  /* an AI vehicle that will reach the junction within ~3 s, and that the player had to give way to */
  conflictAt(e){
    const c=S.car;
    for(const v of S.ai){
      if(v.done||!v.jn||v.v<1.2) continue;
      const j=v.jn.find(j=>j.node===e.node&&j.s>v.s-1); if(!j) continue;
      const dd=j.s-v.s; if(dd>32||dd/v.v>3.2) continue;
      if(Math.abs(angDiff(v.h,c.h))<0.6) continue;
      if(e.ctrl==='right'&&(e.dir==='right'||!(rel(v).l>2))) continue;   // högerregeln: only traffic from the right that crosses your path
      return v;
    }
    return null;
  },
  /* a vehicle in the roundabout that reaches this entry node within maxT seconds */
  ringConflict(node,self,maxT){
    const N=this.net.nodes[node];
    for(const o of S.ai.concat([S.car])){
      if(o===self||o.done||o.parked) continue;
      const dx=N.x-o.x, dy=N.y-o.y, d=Math.hypot(dx,dy); if(d>24) continue;
      const onRb=o===S.car?!!(this.near&&this.near.way.rb):!!(o.path&&o.path.pts[idxAt(o.path,o.s)].rb);
      if(!onRb||(o!==S.car&&o.v<0.8)) continue;
      if(dx*Math.sin(o.h)-dy*Math.cos(o.h)<-2) continue;
      if(d>6&&d/Math.max(o.v,0.5)>(maxT||2.5)) continue;
      return o;
    }
    return null;
  },
  /* one AI car at a time through an unsignalled junction; 30 s safety valve against deadlocks */
  reserve(node,v){ const r=this.res.get(node); if(!r||r.v===v||r.v.done||S.time-r.t>30){ this.res.set(node,{v,t:r&&r.v===v?r.t:S.time}); return true; } return false; },
  release(node,v){ const r=this.res.get(node); if(r&&r.v===v) this.res.delete(node); },
  /* ---- AI traffic ---- */
  traffic(dt){
    const c=S.car;
    for(const v of S.ai) if(v.net&&!v.done&&Math.hypot(v.x-c.x,v.y-c.y)>340) v.done=true;
    for(const [n,r] of this.res) if(r.v.done) this.res.delete(n);
    this.spawnT-=dt; if(this.spawnT>0) return; this.spawnT=0.6;
    if(S.ai.filter(v=>v.net&&!v.done).length<this.maxAI) this.spawnAI(150,280);
  },
  spawnAI(r0,r1){
    const net=this.net, c=S.car, es=net.edgesNear(c.x,c.y,r1); if(!es.length) return null;
    for(let t=0;t<8;t++){
      const e=es[Math.floor(Math.random()*es.length)]; if(OL.tier(e.way.hw)<1&&Math.random()<0.85) continue;
      const de=(!e.way.ow&&Math.random()<0.5)?2*e.i+1:2*e.i, sd=Math.random()*e.len, p=net.pointAt(de,sd), d=Math.hypot(p.x-c.x,p.y-c.y);
      if(d<r0||d>r1) continue;
      if(S.ai.some(v=>!v.done&&Math.hypot(v.x-p.x,v.y-p.y)<25)) continue;
      const v=this.mkAI(net.randomWalk(de,900+sd,Math.random),sd); if(v){ S.ai.push(v); return v; }
    }
    return null;
  },
  mkAI(des,s0,o){
    const net=this.net, pp=net.pathPoints(des,s0); if(pp.pts.length<3) return null;
    const path=finalize(pp.pts); path.pts.forEach((p,i)=>{ p.rb=pp.pts[i].rb; p.lim=OL.wayLimit(FD.ways[pp.pts[i].w]); });
    const jn=[];
    for(let k=0;k<des.length-1;k++){
      const n=net.to(des[k]), a=net.rb(des[k]), b=net.rb(des[k+1]); if(net.deg[n]<3&&a===b) continue;
      jn.push({node:n,s:path.pts[pp.ends[k]].s,entry:!a&&b,inRb:a,sig:net.lightNode.has(n)});
    }
    const lt=net.events(des,s0,pp.ends).filter(e=>e.t==='light').map(e=>({cl:e.cl,grp:e.grp,s:project(path,e.x,e.y,e.pi).s}));
    const lim=path.pts[0].lim/3.6;
    const v=mkVeh(Object.assign({path,s:0,v:lim*0.8,vDes:lim,net:true,ownFollow:true,jn,lt,drv:0.9+Math.random()*0.15},o||{}));
    v.script=(vv,t,dt)=>this.aiDrive(vv,t,dt);
    return v;
  },
  aiDrive(v,target,dt){
    const c=S.car, path=v.path, net=this.net;
    let t=Math.min(path.pts[idxAt(path,v.s)].lim/3.6*v.drv,v.assert?v.vDes:99);
    for(const dd of [4,10,18,28]){ const k=Math.abs(at(path,v.s+dd).k); if(k>0.01){ const vc=Math.sqrt(2.8/k); t=Math.min(t,Math.sqrt(vc*vc+4.4*Math.max(0,dd-3))); } }
    const stopAt=d=>Math.sqrt(Math.max(0,6.4*(d-0.5)));
    for(const L of v.lt){ const d=L.s-v.s; if(d<-1||d>70) continue; const st=net.lightState(L.cl,L.grp,S.time).st; if(st==='G') continue; if(st==='R'||d>v.v*v.v/7+2) t=Math.min(t,stopAt(d-1)); }
    for(const j of v.jn){
      const d=j.s-v.s; if(d>45) continue;
      if(d<-6){ this.release(j.node,v); continue; }
      if(j.inRb) continue;
      const N=net.nodes[j.node];
      if(j.entry){ if(d>0&&this.ringConflict(j.node,v)) t=Math.min(t,stopAt(d-4)); continue; }
      if(j.sig||v.assert) continue;
      if(d<8){ this.reserve(j.node,v); continue; }                                             // already in the junction: clear it
      const dp=Math.hypot(c.x-N.x,c.y-N.y), towards=(N.x-c.x)*Math.sin(c.h)-(N.y-c.y)*Math.cos(c.h)>0;
      if(d>1&&dp<22&&towards&&c.v>0.8&&Math.abs(angDiff(v.h,c.h))>0.5){ t=Math.min(t,stopAt(d-10)); continue; } // let the player go first
      if(d<Math.max(20,v.v*v.v/5+8)){
        const queued=S.ai.some(o=>{ if(o===v||o.done) return false; const q=relTo(v,o); return q.f>0&&q.f<d&&Math.abs(q.l)<2&&Math.abs(angDiff(v.h,o.h))<0.6; });
        if(queued||!this.reserve(j.node,v)) t=Math.min(t,stopAt(d-10));
      }
    }
    for(const p of S.peds){ if(p.state!=='cross') continue; const r=relTo(v,p); if(r.f>1&&r.f<22&&Math.abs(r.l)<3.2) t=Math.min(t,stopAt(r.f-3.5)); }
    // Follow whatever is on our own path ahead (works through turns, unlike a heading cone), and never drive
    // into the player: stop short of any point of the path that the player covers now or within a second.
    const look=Math.max(20,v.v*v.v/6+12), Q=[];
    for(let dd=2;dd<=look;dd+=2) Q.push([dd,at(path,v.s+dd)]);
    for(const o of S.ai.concat([c])){
      if(o===v||o.done||Math.abs(o.x-v.x)>look+8||Math.abs(o.y-v.y)>look+8) continue;
      const pl=o===c, fx=pl?Math.sin(o.h)*o.v:0, fy=pl?-Math.cos(o.h)*o.v:0, rad=o.kind==='bus'?2.6:pl?2.3:2.0;
      for(const [dd,q] of Q){
        let hit=false; for(const k of pl?[0,0.5,1]:[0]) if(Math.hypot(q.x-o.x-fx*k,q.y-o.y-fy*k)<rad) hit=true;
        if(!hit) continue;
        const along=Math.max(0,o.v*Math.cos(angDiff(o.h,v.h))), gap=dd-(o.len+v.len)/2;
        t=Math.min(t,pl?Math.min(stopAt(dd-5.5),along+Math.max(0,gap-3)/1.3):Math.max(0,along+(gap-3)/1.3));
        break;
      }
    }
    return t;
  },
  /* a car already in the roundabout, timed to meet the player at the entry */
  spawnRing(e){
    const net=this.net, c=S.car, T=(e.s-this.ps)/Math.max(c.v,3);
    let need=7*T; const first=net.inc[e.node].find(d=>net.rb(d)); if(first==null) return;
    const chain=[first];
    while(need>net.len(chain[0])&&chain.length<6){ const p=net.inc[net.from(chain[0])].find(d=>net.rb(d)); if(p==null) break; need-=net.len(chain[0]); chain.unshift(p); }
    const s0=Math.max(0,net.len(chain[0])-need), des=chain.slice(0,-1).concat(net.randomWalk(chain[chain.length-1],400,Math.random));
    const v=this.mkAI(des,s0,{assert:true,v:7,vDes:7.5}); if(v&&Math.hypot(v.x-c.x,v.y-c.y)>10){ S.ai.push(v); this.specials++; }
  },
  /* a car from the right at an unmarked junction */
  spawnRight(e){
    const net=this.net, c=S.car, pde=this.de[e.k], T=(e.s-this.ps)/Math.max(c.v,4);
    const cand=net.inc[e.node].filter(d=>(d>>1)!==(pde>>1)&&!net.rb(d)&&OL.tier(net.way(d).hw)>=1).filter(d=>{ const a=angDiff(net.hIn(d),net.hIn(pde)); return a>-2.4&&a<-0.7; });
    if(!cand.length) return;
    const d0=cand[0], s0=Math.max(0,net.len(d0)-Math.max(6,8*T-4));
    const v=this.mkAI(net.randomWalk(d0,500,Math.random),s0,{assert:true,v:8,vDes:8.3}); if(v){ S.ai.push(v); this.specials++; }
  },
  /* ---- scenery ---- */
  prepScenery(){
    const key=this.route.id+'|'+this.route.de.length; if(this.scKey===key) return; this.scKey=key;
    const cell=60, cor=new Set(), P=this.path.pts;
    for(let i=0;i<P.length;i+=10){ const cx=Math.floor(P[i].x/cell), cy=Math.floor(P[i].y/cell); for(let a=-5;a<=5;a++) for(let b=-5;b<=5;b++) cor.add((cx+a)+','+(cy+b)); }
    const inC=(x,y)=>cor.has(Math.floor(x/cell)+','+Math.floor(y/cell));
    this.bldNear=this.bld.filter(b=>inC(b.cx,b.cy));
    this.signs=FD.signs.filter(sg=>inC(sg.x,sg.y));
    this.headsNear=this.heads.filter(h=>inC(h.x,h.y));
    let seed=97; const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
    const greens=['#2f4a2c','#3a5634','#2b4229','#41603a'], trees=[];
    for(const k of cor){
      const [cx,cy]=k.split(',').map(Number);
      for(let i=0;i<5&&trees.length<4000;i++){
        const x=(cx+rnd())*cell, y=(cy+rnd())*cell, nr=this.net.nearest(x,y,12);
        if(nr&&nr.d<nr.half+4) continue;
        const bl=this.bgrid.get(Math.floor(x/40)+','+Math.floor(y/40)); if(bl&&bl.some(b=>x>b.bb[0]-3&&x<b.bb[2]+3&&y>b.bb[1]-3&&y<b.bb[3]+3)) continue;
        trees.push({x,y,r:1.8+rnd()*2,c:greens[Math.floor(rnd()*greens.length)]});
      }
    }
    this.trees=trees;
  },
  draw(g){
    const c=S.car, R=330, es=this.net.edgesNear(c.x,c.y,R), far=(x,y,m)=>Math.abs(x-c.x)>R+m||Math.abs(y-c.y)>R+m;
    g.lineCap='round'; g.lineJoin='round';
    for(const t of this.trees||[]){ if(far(t.x,t.y,5)) continue; g.fillStyle=t.c; g.beginPath(); g.arc(t.x,t.y,t.r,0,TAU); g.fill(); }
    g.fillStyle='#b4ab9c'; g.strokeStyle='#8f877a'; g.lineWidth=0.3;
    for(const b of this.bld){ if(far(b.cx,b.cy,60)) continue; g.beginPath(); for(const p of b.pts) g.lineTo(p[0],p[1]); g.closePath(); g.fill(); g.stroke(); }
    const poly=(pts)=>{ g.beginPath(); g.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) g.lineTo(pts[i][0],pts[i][1]); };
    g.strokeStyle='#8d918b'; for(const e of es){ if(OL.tier(e.way.hw)<1) continue; g.lineWidth=e.way.w+2.6; poly(e.pts); g.stroke(); }
    g.strokeStyle=ASPH; for(const e of es){ g.lineWidth=e.way.w; poly(e.pts); g.stroke(); }
    g.strokeStyle=LINE;
    for(const e of es){
      const w=e.way; if(w.rb||OL.tier(w.hw)<1||e.len<26) continue;
      if(!w.ow&&w.w>=5) this.lineOff(g,e,0,0.15,[3,9]);
      if(w.ow&&w.ln>1) for(let i=1;i<w.ln;i++) this.lineOff(g,e,-w.w/2+i*w.w/w.ln,0.15,[3,9]);
      if(OL.tier(w.hw)>=3) { this.lineOff(g,e,w.w/2-0.3,0.12,[1,2]); this.lineOff(g,e,-w.w/2+0.3,0.12,[1,2]); }
    }
    g.setLineDash([]); g.lineCap='butt';
    g.fillStyle=LINE;
    for(const z of this.zebras){ if(far(z.x,z.y,10)) continue; g.save(); g.translate(z.x,z.y); g.rotate(Math.atan2(z.ty,z.tx)); for(let y=-z.w/2+0.25;y<z.w/2-0.2;y+=1.0) g.fillRect(-1.5,y,3,0.5); g.restore(); }
    for(const t of this.teeth){ if(far(t.x,t.y,10)) continue; g.save(); g.translate(t.x,t.y); g.rotate(Math.atan2(t.ty,t.tx)); const y0=t.ow?-t.half:0.1;
      if(t.stop) g.fillRect(-0.5,y0,0.5,t.half-y0);
      else { g.beginPath(); for(let y=y0;y<t.half-0.4;y+=0.75){ g.moveTo(0,y); g.lineTo(0,y+0.6); g.lineTo(-1.0,y+0.3); g.closePath(); } g.fill(); }
      g.restore(); }
    for(const h of this.heads){ if(far(h.x,h.y,10)) continue; g.save(); g.translate(h.sx,h.sy); g.rotate(Math.atan2(h.ty,h.tx)); g.fillRect(-0.35,h.ow?-h.half:0.1,0.35,h.ow?h.half*2:h.half-0.1); g.restore(); }
  },
  lineOff(g,e,off,width,dash){
    const pts=e.pts, n=pts.length, s0=12, s1=e.len-12; if(s1<=s0) return;
    g.lineWidth=width; g.setLineDash(dash||[]); g.beginPath(); let started=false;
    for(let i=0;i<n;i++){
      const s=e.cum[i]; if(s<s0||s>s1) continue;
      const a=pts[Math.max(0,i-1)], b=pts[Math.min(n-1,i+1)], L=Math.hypot(b[0]-a[0],b[1]-a[1])||1, x=pts[i][0]-(b[1]-a[1])/L*off, y=pts[i][1]+(b[0]-a[0])/L*off;
      if(!started){ g.moveTo(x,y); started=true; } else g.lineTo(x,y);
    }
    if(started) g.stroke();
  },
  drawDyn(g){
    const c=S.car;
    for(const h of this.heads){ if(Math.abs(h.x-c.x)>200||Math.abs(h.y-c.y)>200) continue; const st=this.net.lightState(h.cl,h.grp,S.time).st;
      g.fillStyle='#16191c'; g.fillRect(h.x-0.6,h.y-0.6,1.2,1.2); g.fillStyle=st==='G'?'#2aff6a':st==='Y'?'#ffb000':'#ff2a2a'; g.beginPath(); g.arc(h.x,h.y,0.5,0,TAU); g.fill(); }
  },
  build3D(w){
    const T=THREE;
    if(this.bldNear&&this.bldNear.length){
      const pos=[],nor=[],col=[],cl=new T.Color(),WALL=['#cfc6b6','#b9a48c','#d8d2c4','#a66a50','#e2dccf','#9c8f80'],ROOF='#5d5a57';
      const push=(x,y,z,nx,ny,nz)=>{ pos.push(x,y,z); nor.push(nx,ny,nz); col.push(cl.r,cl.g,cl.b); };
      this.bldNear.forEach((b,bi)=>{
        const h=b.lv*3+0.4, P=b.pts, n=P.length;
        cl.set(WALL[bi%WALL.length]);
        for(let i=0;i<n;i++){ const [x0,y0]=P[i],[x1,y1]=P[(i+1)%n], L=Math.hypot(x1-x0,y1-y0)||1, nx=(y1-y0)/L, nz=-(x1-x0)/L;
          push(x0,0,y0,nx,0,nz); push(x1,0,y1,nx,0,nz); push(x1,h,y1,nx,0,nz); push(x0,0,y0,nx,0,nz); push(x1,h,y1,nx,0,nz); push(x0,h,y0,nx,0,nz); }
        cl.set(ROOF);
        let tris=[]; try{ tris=T.ShapeUtils.triangulateShape(P.map(p=>new T.Vector2(p[0],p[1])),[]); }catch(e){}
        for(const t of tris) for(const k of t) push(P[k][0],h,P[k][1],0,1,0);
      });
      const geo=new T.BufferGeometry();
      geo.setAttribute('position',new T.Float32BufferAttribute(pos,3)); geo.setAttribute('normal',new T.Float32BufferAttribute(nor,3)); geo.setAttribute('color',new T.Float32BufferAttribute(col,3));
      w.add(new T.Mesh(geo,new T.MeshLambertMaterial({vertexColors:true,side:DS})));
    }
    this.lampMats=new Map();
    const pole=lam('#4a4d52'), box=lam('#1b1d20');
    for(const h of this.headsNear||[]){
      const key=h.cl+':'+h.grp; let m=this.lampMats.get(key);
      if(!m){ m={r:new T.MeshBasicMaterial({color:'#3a1010'}),y:new T.MeshBasicMaterial({color:'#3a2a08'}),g:new T.MeshBasicMaterial({color:'#0c3018'}),st:''}; this.lampMats.set(key,m); }
      const p=new T.Mesh(CYLG,pole); p.scale.set(0.06,3.3,0.06); p.position.set(h.x,1.65,h.y); w.add(p);
      const b=new T.Mesh(BOXG,box); b.scale.set(0.36,1.05,0.3); b.position.set(h.x,2.9,h.y); b.rotation.y=-Math.atan2(h.tx,-h.ty); w.add(b);
      [[m.r,3.22],[m.y,2.9],[m.g,2.58]].forEach(([mt,y])=>{ const s=new T.Mesh(SPHG,mt); s.scale.setScalar(0.12); s.position.set(h.x-h.tx*0.17,y,h.y-h.ty*0.17); w.add(s); });
    }
  },
  sync3D(){
    if(!this.lampMats) return;
    for(const [k,m] of this.lampMats){ const [cl,grp]=k.split(':').map(Number), st=this.net.lightState(cl,grp,S.time).st; if(m.st===st) continue; m.st=st;
      m.r.color.set(st==='R'?'#ff2a2a':'#3a1010'); m.y.color.set(st==='Y'?'#ffb000':'#3a2a08'); m.g.color.set(st==='G'?'#2aff6a':'#0c3018'); }
  }
};
const LEVELS={roundabout:RB,highway:HW,country:CR};
if(FD&&OL&&FD.routes) LEVELS.farsta=OSM;

function line(g,x0,y0,x1,y1){g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y1);g.stroke();}
function strokeOff(g,path,off,width,color,dash,from,to,filter){
  from=from||0; to=to==null?1e9:to;
  g.beginPath(); let started=false;
  for(const p of path.pts){
    if(p.s<from||p.s>to||(filter&&!filter(p))){started=false;continue;}
    const x=p.x-p.ty*off,y=p.y+p.tx*off;
    if(!started){g.moveTo(x,y);started=true;} else g.lineTo(x,y);
  }
  g.strokeStyle=color; g.lineWidth=width; g.lineJoin='round'; g.setLineDash(dash||[]); g.stroke(); g.setLineDash([]);
}

function laneChangeCheck(from,to){
  const c=S.car,dir=to>from?1:-1,side=dir>0?'right':'left',key=Math.round(S.time);
  if(c.ind!==dir||c.indOn<0.8) fault('rules',`Changed lane to the ${side} without signalling in good time`,'minor','sig'+key,'Signal before you start to move over, so others have time to react.');
  if(c.mirrorAgo>6) fault('attention','Changed lane without checking the mirrors first','minor','mir'+key,'Mirrors, signal, shoulder check, then move. Every time, in that order.');
  const look=dir>0?c.lookRAgo:c.lookLAgo;
  const blind=S.ai.some(v=>{if(v.done)return false;const r=rel(v);return Math.sign(r.l)===dir&&r.f>-14&&r.f<3&&Math.abs(r.l)<5.5;});
  if(look>4) fault(blind?'interact':'attention',blind?`Moved ${side} with a car in your blind spot`:`No shoulder check before moving ${side}`,blind?'serious':'minor','sh'+key,'Turn your head and look over your shoulder before every lane change. Make it visible.');
  else if(blind) fault('interact',`Moved ${side} although a car was alongside`,'serious','bl'+key,'If the shoulder check shows a car, wait for it to pass.');
}

/* ---------- rendering ---------- */
function visibility(o){
  const r=rel(o); if(r.f>-1.5) return 1; const c=S.car;
  if(c.mirrorAgo<1.5&&!(Math.abs(r.l)>1.4&&r.f>-10)) return 1;
  if(r.l<0&&c.lookLAgo<1.5&&r.f>-16) return 1;
  if(r.l>0&&c.lookRAgo<1.5&&r.f>-16) return 1;
  return S.mode==='coach'?0.28:0;
}
function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function drawVeh(g,o,alpha){
  g.save(); g.globalAlpha=alpha; g.translate(o.x,o.y); g.rotate(o.h);
  const L=o.len,W=o.wid;
  if(o.kind==='bike'){
    g.fillStyle='#222'; g.fillRect(-0.08,-L/2,0.16,L);
    g.fillStyle=o.color; g.beginPath(); g.arc(0,0.1,0.38,0,TAU); g.fill();
    g.fillStyle='#f1c9a5'; g.beginPath(); g.arc(0,-0.2,0.2,0,TAU); g.fill();
  } else {
    g.fillStyle='rgba(0,0,0,.25)'; rr(g,-W/2+0.15,-L/2+0.25,W,L,0.45); g.fill();
    g.fillStyle=o.color; rr(g,-W/2,-L/2,W,L,o.kind==='car'?0.5:0.25); g.fill();
    g.fillStyle='rgba(20,26,32,.75)';
    if(o.kind==='car'){ rr(g,-W/2+0.2,-L/2+0.9,W-0.4,0.9,0.2); g.fill(); rr(g,-W/2+0.25,L/2-1.2,W-0.5,0.55,0.15); g.fill(); }
    else { g.fillRect(-W/2+0.15,-L/2+0.2,W-0.3,0.6); }
    if(o.player){ g.strokeStyle='#111'; g.lineWidth=0.12; rr(g,-W/2,-L/2,W,L,0.5); g.stroke(); }
    const blink=Math.floor(S.time*3)%2===0;
    if(o.ind&&blink){ g.fillStyle='#ff9a1a'; const x=o.ind>0?W/2-0.35:-W/2; g.fillRect(x,-L/2,0.35,0.35); g.fillRect(x,L/2-0.35,0.35,0.35); }
    if(o.acc<-1.2||(o.player&&S.keys.down)){ g.fillStyle='#ff2a2a'; g.fillRect(-W/2+0.1,L/2-0.18,0.5,0.18); g.fillRect(W/2-0.6,L/2-0.18,0.5,0.18); }
  }
  g.restore();
}
function drawSign(g,sg){
  const d=S.dpr,R=17*d;
  g.save(); g.translate(sg.x,sg.y); g.rotate(S.car.h); g.scale(1/S.zoom,1/S.zoom);
  g.fillStyle='#6d6f72'; g.fillRect(-1.5*d,0,3*d,R*1.3);
  drawSignFace(g,sg,R,d);
  g.restore();
}
function drawSignFace(g,sg,R,d){
  g.textAlign='center'; g.textBaseline='middle';
  if(sg.type==='limit'){ g.fillStyle='#c8102e'; g.beginPath(); g.arc(0,0,R,0,TAU); g.fill(); g.fillStyle='#f4c514'; g.beginPath(); g.arc(0,0,R*0.74,0,TAU); g.fill(); g.fillStyle='#111'; g.font=`800 ${R*0.8}px Overpass, sans-serif`; g.fillText(sg.val,0,R*0.06); }
  else if(sg.type==='warn'||sg.type==='giveway'){
    const up=sg.type==='warn'?1:-1; g.fillStyle='#c8102e'; g.beginPath(); g.moveTo(0,-R*1.05*up); g.lineTo(R*1.05,R*0.75*up); g.lineTo(-R*1.05,R*0.75*up); g.closePath(); g.fill();
    g.fillStyle='#f4c514'; g.beginPath(); g.moveTo(0,-R*0.68*up); g.lineTo(R*0.72,R*0.55*up); g.lineTo(-R*0.72,R*0.55*up); g.closePath(); g.fill();
    if(sg.type==='warn'){ g.strokeStyle='#111'; g.lineWidth=2.4*d; g.lineCap='round'; g.beginPath();
      if(sg.val==='bend'){ g.moveTo(-R*0.12,R*0.42); g.quadraticCurveTo(-R*0.1,-R*0.05,R*0.18,-R*0.2); }
      else { g.moveTo(0,R*0.45); g.lineTo(0,-R*0.3); g.moveTo(0,R*0.1); g.lineTo(R*0.32,R*0.1); }
      g.stroke(); }
  }
  else if(sg.type==='mw'||sg.type==='town'){ g.font=`700 ${R*0.62}px Overpass, sans-serif`; const w=g.measureText(sg.val).width+R*0.8; g.fillStyle=sg.type==='mw'?'#1f5fa8':'#1f5fa8'; rr(g,-w/2,-R*0.6,w,R*1.2,R*0.18); g.fill(); g.strokeStyle='#fff'; g.lineWidth=1.5*d; rr(g,-w/2+3*d,-R*0.6+3*d,w-6*d,R*1.2-6*d,R*0.12); g.stroke(); g.fillStyle='#fff'; g.fillText(sg.val,0,R*0.04); }
  else if(sg.type==='rb'){ g.fillStyle='#1f5fa8'; g.beginPath(); g.arc(0,0,R,0,TAU); g.fill(); g.strokeStyle='#fff'; g.lineWidth=2.5*d; g.beginPath(); g.arc(0,0,R*0.5,0.3,TAU-0.6); g.stroke(); }
  else if(sg.type==='stop'){ g.fillStyle='#fff'; g.beginPath(); for(let i=0;i<8;i++){const a=Math.PI/8+i*Math.PI/4; g.lineTo(Math.cos(a)*R*1.02,Math.sin(a)*R*1.02);} g.closePath(); g.fill(); g.fillStyle='#c8102e'; g.beginPath(); for(let i=0;i<8;i++){const a=Math.PI/8+i*Math.PI/4; g.lineTo(Math.cos(a)*R*0.92,Math.sin(a)*R*0.92);} g.closePath(); g.fill(); g.fillStyle='#fff'; g.font=`800 ${R*0.55}px Overpass, sans-serif`; g.fillText('STOP',0,R*0.05); }
  else if(sg.type==='bus'||sg.type==='zebra'){ g.fillStyle='#1f5fa8'; rr(g,-R*0.85,-R*0.85,R*1.7,R*1.7,R*0.15); g.fill(); g.fillStyle='#fff'; g.font=`800 ${R*(sg.type==='bus'?0.5:0.9)}px Overpass, sans-serif`; g.fillText(sg.type==='bus'?'BUSS':'▲',0,R*0.04); }
}
function render(){
  const W=cv.width,H=cv.height; if(!W||!H||!S.car) return;
  const c=S.car,lv=S.level;
  g.setTransform(1,0,0,1,0,0);
  g.fillStyle=lv.ground; g.fillRect(0,0,W,H);
  const target=(H*0.70)/(55+c.v*2.2);
  S.zoom+=(target-S.zoom)*(S.zoomInit?0.04:1); S.zoomInit=true;
  g.translate(W/2,H*0.72); g.rotate(-c.h); g.scale(S.zoom,S.zoom); g.translate(-c.x,-c.y);
  lv.draw(g);
  for(const sg of lv.signs) if(Math.abs(sg.x-c.x)<260&&Math.abs(sg.y-c.y)<260) drawSign(g,sg);
  if(lv.drawDyn) lv.drawDyn(g);
  for(const p of S.peds){ if(p.state==='done') continue; const r=Math.max(0.42,5*S.dpr/S.zoom); g.fillStyle='#2b2f3a'; g.beginPath(); g.arc(p.x,p.y,r,0,TAU); g.fill(); g.fillStyle='#f4c514'; g.beginPath(); g.arc(p.x,p.y,r*0.55,0,TAU); g.fill(); }
  for(const v of S.ai){ if(v.done) continue; if(Math.abs(v.x-c.x)>220||Math.abs(v.y-c.y)>220) continue; const a=visibility(v); if(a>0) drawVeh(g,v,a); }
  drawVeh(g,c,1);
}

/* ---------- 3D (driver and chase views) ---------- */
const V3={ok:false,dyn:new Map(),peds:new Map()};
const TEX=2048, GW=280, GA=50, SKY='#bfd2e0';
let BOXG,CONEG,CYLG,SPHG,ROOFG,DS;
function init3D(){
  if(!window.THREE) return false;
  try{
    const T=THREE; DS=T.DoubleSide;
    const r=new T.WebGLRenderer({antialias:true});
    r.setPixelRatio(Math.min(1.5,window.devicePixelRatio||1));
    r.setClearColor(SKY); r.domElement.id='gl';
    const stage=document.querySelector('.stage'); stage.insertBefore(r.domElement,stage.querySelector('.hud'));
    V3.r=r; const sc=V3.scene=new T.Scene();
    sc.background=new T.Color(SKY); sc.fog=new T.Fog(SKY,55,185);
    sc.add(new T.HemisphereLight(0xe4edf5,0x4a5a40,0.9));
    const sun=new T.DirectionalLight(0xffffff,0.7); sun.position.set(60,100,40); sc.add(sun);
    V3.cam=new T.PerspectiveCamera(62,1.6,0.1,700); V3.cam.rotation.order='YXZ';
    V3.mcam=new T.PerspectiveCamera(20,2,0.1,400); V3.mcam.rotation.order='YXZ';
    BOXG=new T.BoxGeometry(1,1,1); CONEG=new T.ConeGeometry(1,1,8); CYLG=new T.CylinderGeometry(1,1,1,8); SPHG=new T.SphereGeometry(1,10,8);
    ROOFG=new T.ConeGeometry(1,1,4); ROOFG.rotateY(Math.PI/4);
    V3.ground=new T.Mesh(new T.PlaneGeometry(6000,6000),new T.MeshBasicMaterial({color:'#5b7150',side:DS}));
    // drawn first and without depth, so the textured road plane above it never loses a depth fight
    V3.ground.rotation.x=-Math.PI/2; V3.ground.position.y=-0.05; V3.ground.renderOrder=-1; V3.ground.material.depthWrite=false; sc.add(V3.ground);
    V3.tc=document.createElement('canvas'); V3.tc.width=V3.tc.height=TEX; V3.tg=V3.tc.getContext('2d');
    V3.tex=new T.CanvasTexture(V3.tc); V3.tex.anisotropy=r.capabilities.getMaxAnisotropy();
    V3.gplane=new T.Mesh(new T.PlaneGeometry(GW,GW),new T.MeshBasicMaterial({map:V3.tex,side:DS}));
    V3.gplane.rotation.x=-Math.PI/2; sc.add(V3.gplane);
    V3.world=new T.Group(); sc.add(V3.world);
    V3.rig=new T.Group(); sc.add(V3.rig);
    V3.vcam=new T.PerspectiveCamera(70,1,0.05,700); V3.rig.add(V3.vcam);
    V3.rt={rear:new T.WebGLRenderTarget(512,160),left:new T.WebGLRenderTarget(256,170),right:new T.WebGLRenderTarget(256,170)};
    V3.hudCv=document.createElement('canvas'); V3.hudCv.width=512; V3.hudCv.height=256; V3.hudCtx=V3.hudCv.getContext('2d');
    V3.hudTex=new T.CanvasTexture(V3.hudCv);
    V3.signMat=new Map();
    V3.posOff=new T.Vector3(); V3.yawOff=0; V3.prev={}; V3.frames=0; V3.hudT=0; V3.mirrorPlanes=[];
    r.xr.enabled=true;
    V3.ok=true; return true;
  }catch(e){ return false; }
}
function lam(c,side){return new THREE.MeshLambertMaterial({color:c,side:side||DS});}
function build3D(){
  if(!V3.ok) return;
  const T=THREE,lv=S.level,w=V3.world;
  while(w.children.length) w.remove(w.children[0]);
  V3.ground.material.color.set(lv.ground); V3.tcx=null;
  let seed=11; const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
  const greens=['#2f4a2c','#3a5634','#2b4229'];
  let trees=[];
  if(lv.trees) trees=lv.trees.map(t=>({x:t.x,y:t.y,r:t.r*0.75,c:t.c}));
  else if(lv===RB){
    for(let i=0;i<260;i++){ const x=(rnd()*2-1)*125,y=(rnd()*2-1)*135; if(Math.abs(x)<11||Math.abs(y)<11||Math.hypot(x,y)<30) continue; trees.push({x,y,r:1.5+rnd()*1.8,c:pick(greens)}); }
    for(let i=0;i<4;i++){ const a=i*TAU/4+0.6; trees.push({x:Math.cos(a)*5.5,y:Math.sin(a)*5.5,r:0.9,c:'#3a5634'}); }
    const isl=new T.Mesh(CYLG,lam('#4d6b43')); isl.scale.set(RB.rIn,0.3,RB.rIn); isl.position.y=0.15; w.add(isl);
    const kerb=new T.Mesh(CYLG,lam('#8a8780')); kerb.scale.set(RB.rIn+1.4,0.14,RB.rIn+1.4); kerb.position.y=0.07; w.add(kerb);
  } else if(lv===HW){
    for(let y=330;y>-2600;y-=12){ trees.push({x:-13-rnd()*28,y:y+rnd()*8,r:1.6+rnd()*2,c:pick(greens)}); if(y>-1320) trees.push({x:13+rnd()*28,y:y+rnd()*8,r:1.6+rnd()*2,c:pick(greens)}); }
    const rail=new T.Mesh(BOXG,lam('#a7acb1')); rail.scale.set(0.12,0.32,3000); rail.position.set(-5.5,0.65,-1100); w.add(rail);
  }
  if(trees.length){
    const n=trees.length, cones=new T.InstancedMesh(CONEG,lam('#ffffff'),n), trunks=new T.InstancedMesh(CYLG,lam('#5b4632'),n), d=new T.Object3D(), col=new T.Color();
    trees.forEach((t,i)=>{ const h=t.r*3.2; d.position.set(t.x,1.4+h/2,t.y); d.scale.set(t.r,h,t.r); d.updateMatrix(); cones.setMatrixAt(i,d.matrix); cones.setColorAt(i,col.set(t.c)); d.position.set(t.x,0.8,t.y); d.scale.set(0.2,1.6,0.2); d.updateMatrix(); trunks.setMatrixAt(i,d.matrix); });
    w.add(cones,trunks);
  }
  if(lv===CR){
    const hc=['#8e2b23','#8e2b23','#e9e4da','#c9a64a'];
    lv.houses.forEach((h,i)=>{ const g2=new T.Group(); const b=new T.Mesh(BOXG,lam(hc[i%hc.length])); b.scale.set(h.w,3,h.d); b.position.y=1.5; const rf=new T.Mesh(ROOFG,lam('#3a3d42')); rf.scale.set(h.w/1.414*1.1,2.2,h.d/1.414*1.1); rf.position.y=4.1; g2.add(b,rf); g2.position.set(h.x,0,h.y); g2.rotation.y=-h.h; w.add(g2); });
  }
  if(lv.build3D) lv.build3D(w);
  const postMat=lam('#6d6f72');
  for(const sg of lv.signs){
    const big=sg.type==='mw'||sg.type==='town', top=big?2.7:2.0, key=sg.type+'|'+sg.val;
    const post=new T.Mesh(CYLG,postMat); post.scale.set(0.045,top,0.045); post.position.set(sg.x,top/2,sg.y); w.add(post);
    let sm=V3.signMat.get(key);
    if(!sm){ const cvs=document.createElement('canvas'); cvs.width=cvs.height=256; const sgc=cvs.getContext('2d'); sgc.translate(128,128); drawSignFace(sgc,sg,46,2.7); sm=new T.SpriteMaterial({map:new T.CanvasTexture(cvs),side:DS}); V3.signMat.set(key,sm); }
    const sp=new T.Sprite(sm); const sz=big?4:2.5; sp.scale.set(sz,sz,1); sp.position.set(sg.x,top+(big?0.35:0.3),sg.y); w.add(sp);
  }
  for(const [,m] of V3.dyn) V3.scene.remove(m); V3.dyn.clear();
  for(const [,m] of V3.peds) V3.scene.remove(m); V3.peds.clear();
}
function vehMesh(v,player){
  const T=THREE,grp=new T.Group(),side=player?T.FrontSide:DS,mats=[],ud={brake:[],indL:[],indR:[],mats,a:1,br:null};
  const M=(c,basic)=>{const m=basic?new T.MeshBasicMaterial({color:c,side}):new T.MeshLambertMaterial({color:c,side}); mats.push(m); return m;};
  const box=(w,h,l,x,y,z,m)=>{const b=new T.Mesh(BOXG,m); b.scale.set(w,h,l); b.position.set(x,y,z); grp.add(b); return b;};
  const W=v.wid,L=v.len,glass=M('#20282f'),dark=M('#1a1d21'),brake=M('#5a0d0d',true),ind=M('#ff9a1a',true),head=M('#f2f2e6',true);
  const col=player?'#c9a227':v.color;
  let lightY=0.8;
  if(v.kind==='bike'){
    box(0.08,0.6,1.7,0,0.5,0,dark); box(0.42,0.75,0.35,0,1.3,0.1,M(col));
    const hd=new T.Mesh(SPHG,M('#e2b48c')); hd.scale.setScalar(0.17); hd.position.set(0,1.85,-0.05); grp.add(hd);
  } else if(v.kind==='truck'){
    box(W*0.96,0.6,L*0.98,0,0.45,0,dark); box(W,2.5,2.3,0,1.85,-L/2+1.15,M('#3d5a80')); box(W*1.01,0.8,2.0,0,2.45,-L/2+1.05,glass);
    box(W,3.3,L-2.5,0,2.35,1.25,M(col)); lightY=1.0;
  } else if(v.kind==='bus'){
    box(W*0.97,0.5,L*0.97,0,0.35,0,dark); box(W,2.7,L,0,1.85,0,M(col)); box(W*1.01,0.95,L*0.93,0,2.3,0,glass); lightY=1.0;
  } else if(player){
    box(W*0.97,0.32,L*0.95,0,0.3,0,dark); box(W,0.5,L,0,0.55,0,M(col));
    box(W*0.84,0.7,L*0.48,0,1.15,L*0.04,M(col)); box(W*0.86,0.5,L*0.5,0,1.13,L*0.04,glass);
  } else {
    box(W*0.97,0.32,L*0.95,0,0.3,0,dark); box(W,0.7,L,0,0.78,0,M(col));
    box(W*0.84,0.58,L*0.48,0,1.4,L*0.04,M(col)); box(W*0.86,0.42,L*0.5,0,1.37,L*0.04,glass);
  }
  if(v.kind!=='bike'){
    for(const s of [-1,1]){
      ud.brake.push(box(W*0.22,0.13,0.06,s*W*0.3,lightY,L/2+0.01,brake));
      if(!player) box(W*0.2,0.12,0.06,s*W*0.3,lightY,-L/2-0.01,head);
      for(const e of [-1,1]){ const b=box(0.2,0.11,0.07,s*(W/2-0.1),lightY+0.13,e*(L/2+0.02),ind); b.visible=false; (s<0?ud.indL:ud.indR).push(b); }
    }
    ud.brakeMat=brake;
  }
  grp.userData=ud;
  if(player) buildCockpit(grp);
  return grp;
}
function pedMesh(){
  const T=THREE,g2=new T.Group();
  const b=new T.Mesh(CYLG,lam('#2b2f3a')); b.scale.set(0.2,1.0,0.2); b.position.y=0.5;
  const vest=new T.Mesh(BOXG,lam('#f4c514')); vest.scale.set(0.46,0.5,0.3); vest.position.y=1.15;
  const hd=new T.Mesh(SPHG,lam('#e2b48c')); hd.scale.setScalar(0.13); hd.position.y=1.55;
  g2.add(b,vest,hd); return g2;
}
function updateGroundTex(){
  const c=S.car,icx=c.x+Math.sin(c.h)*GA,icy=c.y-Math.cos(c.h)*GA;
  if(V3.tcx!=null&&Math.hypot(icx-V3.tcx,icy-V3.tcy)<=35) return;
  V3.tcx=Math.round(icx); V3.tcy=Math.round(icy);
  const tg=V3.tg,sc=TEX/GW;
  tg.setTransform(1,0,0,1,0,0); tg.fillStyle=S.level.ground; tg.fillRect(0,0,TEX,TEX);
  tg.setTransform(sc,0,0,sc,TEX/2-V3.tcx*sc,TEX/2-V3.tcy*sc);
  S.level.draw(tg);
  V3.tex.needsUpdate=true; V3.gplane.position.set(V3.tcx,0,V3.tcy);
}
function syncDyn(){
  const seen=new Set(),blink=Math.floor(S.time*3)%2===0;
  for(const v of [S.car].concat(S.ai)){
    if(v.done) continue;
    let m=V3.dyn.get(v); if(!m){ m=vehMesh(v,v===S.car); V3.dyn.set(v,m); V3.scene.add(m); }
    seen.add(v); const ud=m.userData;
    m.position.set(v.x,0,v.y); m.rotation.y=-v.h;
    if(ud.brakeMat){ const br=v.acc<-1.2||(v===S.car&&!!S.keys.down); if(br!==ud.br){ ud.br=br; ud.brakeMat.color.set(br?'#ff2a2a':'#5a0d0d'); } }
    ud.indL.forEach(b=>{b.visible=v.ind===-1&&blink;}); ud.indR.forEach(b=>{b.visible=v.ind===1&&blink;});
    const a=(S.view==='chase'&&v!==S.car)?visibility(v):1;
    if(a!==ud.a){ ud.a=a; m.visible=a>0; ud.mats.forEach(mt=>{mt.transparent=a<1; mt.opacity=a; mt.needsUpdate=true;}); }
  }
  for(const [v,m] of V3.dyn) if(!seen.has(v)){ V3.scene.remove(m); V3.dyn.delete(v); m.userData.mats.forEach(x=>x.dispose()); }
  if(S.level.sync3D) S.level.sync3D();
  for(const p of S.peds){
    let m=V3.peds.get(p);
    if(p.state==='done'){ if(m){V3.scene.remove(m);V3.peds.delete(p);} continue; }
    if(!m){ m=pedMesh(); V3.peds.set(p,m); V3.scene.add(m); }
    m.position.set(p.x,0,p.y);
  }
  for(const [p,m] of V3.peds) if(!S.peds.includes(p)){ V3.scene.remove(m); V3.peds.delete(p); }
}
const MIR=[{id:'mRear',x:.35,y:.03,w:.30,h:.12,fov:14,side:0},{id:'mL',x:.015,y:.42,w:.15,h:.11,fov:20,side:-1},{id:'mR',x:.835,y:.42,w:.15,h:.11,fov:20,side:1}];
function render3D(dt){
  const c=S.car; if(!c||!V3.ok) return;
  const r=V3.r,el=r.domElement,W=el.clientWidth,H=el.clientHeight; if(!W||!H) return;
  updateGroundTex(); syncDyn();
  const fx=Math.sin(c.h),fz=-Math.cos(c.h),rx=Math.cos(c.h),rz=Math.sin(c.h),cam=V3.cam;
  if(S.view==='driver'){
    const tgt=c.lookLAgo<0.9?-1.7:c.lookRAgo<0.9?1.7:0;
    S.headYaw+=(tgt-S.headYaw)*Math.min(1,dt*9);
    S.pitch+=((-0.02+clamp(c.acc,-8,4)*0.005)-S.pitch)*Math.min(1,dt*5);
    cam.position.set(c.x+fx*0.05-rx*0.38,1.25,c.y+fz*0.05-rz*0.38);
    cam.rotation.set(S.pitch,-(c.h+S.headYaw),0); cam.fov=58;
  } else {
    S.camH+=angDiff(c.h,S.camH)*Math.min(1,dt*4);
    const cf=Math.sin(S.camH),cz=-Math.cos(S.camH);
    cam.position.set(c.x-cf*8.5,3.6,c.y-cz*8.5); cam.lookAt(c.x+cf*12,0.8,c.y+cz*12); cam.fov=58;
  }
  cam.aspect=W/H; cam.updateProjectionMatrix();
  r.setScissorTest(false); r.setViewport(0,0,W,H); r.render(V3.scene,cam);
  if(S.view==='driver'&&c.mirrorAgo<1.5){
    const pm=V3.dyn.get(c); if(pm) pm.visible=false;
    const mc=V3.mcam; r.setScissorTest(true);
    for(const m of MIR){
      const px=Math.round(m.x*W),pw=Math.round(m.w*W),ph=Math.round(m.h*H),py=Math.round(H-m.y*H-ph);
      setMirrorCam(c,m,pw/ph);
      r.setViewport(px,py,pw,ph); r.setScissor(px,py,pw,ph); r.render(V3.scene,mc);
    }
    r.setScissorTest(false); r.setViewport(0,0,W,H);
    if(pm) pm.visible=true;
  }
}
function setView(v){
  if(!V3.ok) v='map';
  S.view=v; const st=document.querySelector('.stage');
  st.classList.toggle('v3',v!=='map'); st.classList.toggle('cockpit',v==='driver');
  document.querySelectorAll('#viewSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===v?'true':'false'));
  $('#viewNote').textContent=v==='driver'?"Driver view puts you in the driver's seat. The mirrors stay dark until you glance at them (W), and A or D turns your head for a shoulder check.":v==='chase'?'Chase view follows just behind the car. Cars behind you stay hidden until you check.':'Map view shows the whole situation from above, useful for understanding positioning.';
  store.set('fdl:view',v); resize();
}

function setMirrorCam(c,m,aspect){
  const mc=V3.mcam,fx=Math.sin(c.h),fz=-Math.cos(c.h),rx=Math.cos(c.h),rz=Math.sin(c.h); let a;
  if(m.side){ mc.position.set(c.x+fx*0.6+rx*m.side*1.0,1.05,c.y+fz*0.6+rz*m.side*1.0); a=c.h+Math.PI-m.side*0.3; }
  else { mc.position.set(c.x+fx*0.3-rx*0.1,1.3,c.y+fz*0.3-rz*0.1); a=c.h+Math.PI; }
  mc.rotation.set(-0.02,-a,0); mc.fov=m.fov; mc.aspect=aspect; mc.updateProjectionMatrix();
  mc.projectionMatrix.elements[0]*=-1; mc.projectionMatrixInverse.copy(mc.projectionMatrix).invert();
}

/* ---------- VR (Meta Quest, WebXR) ---------- */
const EYE=[-0.38,1.25,-0.05];
function buildCockpit(grp){
  const T=THREE,ck=new T.Group(); ck.visible=!!V3.inXR;
  const dark=lam('#1c1f23'),trim=lam('#2a2e33'),eye=new T.Vector3(...EYE);
  const bx=(w,h,l,x,y,z,m)=>{const b=new T.Mesh(BOXG,m); b.scale.set(w,h,l); b.position.set(x,y,z); ck.add(b); return b;};
  bx(1.62,0.2,0.55,0,0.98,-0.8,dark);
  bx(1.5,0.04,1.3,0,1.63,0.3,trim);
  bx(1.45,0.06,0.06,0,1.6,-0.36,trim);
  const pil=(a,b)=>{const p1=new T.Vector3(...a),p2=new T.Vector3(...b),m=new T.Mesh(BOXG,trim); m.position.copy(p1).add(p2).multiplyScalar(0.5); m.scale.set(0.055,0.055,p1.distanceTo(p2)); ck.add(m); m.lookAt(p2);};
  pil([-0.8,1.07,-1.05],[-0.72,1.6,-0.36]); pil([0.8,1.07,-1.05],[0.72,1.6,-0.36]);
  const wg=new T.Group(); wg.position.set(EYE[0],0.93,-0.47); wg.rotation.x=-0.35;
  const wm=new T.Mesh(new T.TorusGeometry(0.18,0.022,8,28),lam('#15171a'));
  const s1=new T.Mesh(BOXG,lam('#15171a')); s1.scale.set(0.34,0.03,0.02); wm.add(s1);
  const s2=new T.Mesh(BOXG,lam('#15171a')); s2.scale.set(0.03,0.17,0.02); s2.position.y=-0.085; wm.add(s2);
  const mk=new T.Mesh(BOXG,lam('#f4c514')); mk.scale.set(0.03,0.025,0.035); mk.position.y=0.18; wm.add(mk);
  wg.add(wm); ck.add(wg); V3.wheelMesh=wm;
  V3.mirrorPlanes=[];
  [['rear',0.26,0.08,[0,1.5,-0.55]],['left',0.18,0.12,[-1.0,1.1,-0.6]],['right',0.18,0.12,[1.0,1.1,-0.6]]].forEach(([id,w,h,pp])=>{
    const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:V3.rt[id].texture}));
    m.position.set(...pp); ck.add(m); m.lookAt(eye);
    const fr=new T.Mesh(new T.PlaneGeometry(w+0.025,h+0.025),new T.MeshBasicMaterial({color:'#111'}));
    fr.position.copy(m.position); fr.quaternion.copy(m.quaternion); fr.translateZ(-0.004); ck.add(fr);
    V3.mirrorPlanes.push({id,mesh:m});
  });
  const hp=new T.Mesh(new T.PlaneGeometry(0.34,0.17),new T.MeshBasicMaterial({map:V3.hudTex,transparent:true}));
  hp.position.set(0.12,1.17,-0.72); ck.add(hp); hp.lookAt(eye);
  grp.add(ck); V3.cockpit=ck;
}
function wrapText(g2,text,x,y,maxW,lh,maxLines){
  const words=String(text).split(' '); let line='',n=0;
  for(const w of words){ const t=line?line+' '+w:w; if(g2.measureText(t).width>maxW&&line){ g2.fillText(line,x,y+n*lh); n++; line=w; if(n>=maxLines) return; } else line=t; }
  if(line&&n<maxLines) g2.fillText(line,x,y+n*lh);
}
function drawVRHud(){
  const g2=V3.hudCtx,c=S.car; if(!c) return;
  g2.setTransform(1,0,0,1,0,0); g2.clearRect(0,0,512,256);
  g2.fillStyle='rgba(14,17,20,.92)'; rr(g2,0,0,512,256,22); g2.fill();
  g2.textAlign='left'; g2.textBaseline='alphabetic';
  g2.fillStyle='#fff'; g2.font='700 80px "Overpass Mono", ui-monospace, monospace'; g2.fillText(String(Math.round(c.v*3.6)),24,94);
  g2.fillStyle='#98a1a9'; g2.font='600 22px Overpass, system-ui, sans-serif'; g2.fillText(c.cruise>0?'km/h  HOLD':'km/h',26,122);
  const blink=Math.floor(S.time*2.5)%2===0;
  g2.font='700 40px system-ui, sans-serif'; g2.fillStyle=c.ind===-1&&blink?'#ff9a1a':'#3a4047'; g2.fillText('◀',232,82); g2.fillStyle=c.ind===1&&blink?'#ff9a1a':'#3a4047'; g2.fillText('▶',300,82);
  g2.save(); g2.translate(452,64); drawSignFace(g2,{type:'limit',val:S.level.hudLimit().v},42,2.2); g2.restore();
  g2.textAlign='left'; g2.textBaseline='alphabetic';
  let head='',body='',col='#fff';
  if(S.ended&&S.lastResult){ head=S.lastResult.pass?'Godkänd':'Underkänd'; col=S.lastResult.pass?'#3cbc72':'#ff5d70'; body=(S.lastResult.main?CATS[S.lastResult.main].en+'. ':'')+'Press X to drive again. Full report on the page after VR.'; }
  else if(!S.running){ head=S.level.title; body='Press X to start. Left stick steers, right trigger is gas, left trigger brakes.'; }
  else if(S.paused){ head='Paused'; body='Press X to continue. Y recenters your seat.'; }
  else { const t=S.toast; if(t&&S.time-t.t<3.5&&(S.mode==='coach'||t.sev==='intervention')){ head='Fault'; col='#ffb347'; body=t.text; } else if(S.mode==='coach'&&S.hint&&S.time-S.hintT<9){ head=S.instr; body=S.hint; } else { head=S.instr; body=''; } }
  g2.fillStyle=col; g2.font='800 26px Overpass, system-ui, sans-serif'; wrapText(g2,head,24,166,464,28,1);
  g2.fillStyle='#d6dce1'; g2.font='600 21px Overpass, system-ui, sans-serif'; wrapText(g2,body,24,198,464,25,2);
  V3.hudTex.needsUpdate=true;
}
function xPress(){ if(S.ended){ $('#report').hidden=true; prepare(); startDrive(); } else if(!S.running) startDrive(); else { S.paused=!S.paused; showOverlay(S.paused?'paused':'hide'); } }
function pollXR(){
  const sess=V3.r.xr.getSession(); if(!sess) return;
  let st=0,thr=0,brk=0;
  for(const src of sess.inputSources){
    const gp=src.gamepad; if(!gp) continue;
    const b=i=>gp.buttons[i]?(gp.buttons[i].value||(gp.buttons[i].pressed?1:0)):0;
    const ed=(k,v,fn)=>{const now=v>0.5; if(now&&!V3.prev[k]) fn(); V3.prev[k]=now;};
    if(src.handedness==='left'){
      st=gp.axes.length>=4?gp.axes[2]:(gp.axes[0]||0); brk=b(0);
      ed('lg',b(1),()=>toggleInd(-1)); ed('x',b(4),xPress); ed('y',b(5),()=>{V3.needRecenter=true;});
    } else {
      thr=b(0);
      ed('rg',b(1),()=>toggleInd(1)); ed('a',b(4),()=>act('cruise')); ed('b',b(5),()=>act('mirror'));
    }
  }
  st=Math.sign(st)*Math.pow(Math.max(0,Math.abs(st)-0.1)/0.9,1.4);
  S.gp={st,thr,brk};
}
function recenterXR(xc){
  const T=THREE,pm=new T.Matrix4().copy(V3.rig.matrixWorld).invert().multiply(xc.matrixWorld);
  const p=new T.Vector3(),q=new T.Quaternion(),sc=new T.Vector3(); pm.decompose(p,q,sc);
  V3.yawOff=-new T.Euler().setFromQuaternion(q,'YXZ').y; V3.posOff.copy(p);
}
const _v1=window.THREE?new THREE.Vector3():null,_v2=window.THREE?new THREE.Vector3():null,_q=window.THREE?new THREE.Quaternion():null,_Y=window.THREE?new THREE.Vector3(0,1,0):null;
function renderXR(dt){
  const c=S.car; if(!c) return; const r=V3.r;
  updateGroundTex(); syncDyn();
  const fx=Math.sin(c.h),fz=-Math.cos(c.h),rx=Math.cos(c.h),rz=Math.sin(c.h);
  V3.rig.rotation.y=-c.h+V3.yawOff;
  const off=_v1.copy(V3.posOff).applyAxisAngle(_Y,V3.rig.rotation.y);
  V3.rig.position.set(c.x+fx*0.05-rx*0.38-off.x,1.25-off.y,c.y+fz*0.05-rz*0.38-off.z);
  if(V3.wheelMesh) V3.wheelMesh.rotation.z=-c.steer*6;
  V3.frames++;
  V3.hudT-=dt; if(V3.hudT<=0){ V3.hudT=0.1; drawVRHud(); }
  if(V3.frames%2===0){
    const pm=V3.dyn.get(c); if(pm) pm.visible=false;
    const xe=r.xr.enabled; r.xr.enabled=false;
    for(const m of MIR){ const rt=V3.rt[m.side<0?'left':m.side>0?'right':'rear']; setMirrorCam(c,m,rt.width/rt.height); r.setRenderTarget(rt); r.render(V3.scene,V3.mcam); }
    r.setRenderTarget(null); r.xr.enabled=xe; if(pm) pm.visible=true;
  }
  r.render(V3.scene,V3.vcam);
  const xc=r.xr.getCamera(V3.vcam);
  if(V3.needRecenter&&V3.frames>20){ recenterXR(xc); V3.needRecenter=false; return; }
  const hp=_v2.setFromMatrixPosition(xc.matrixWorld); _q.setFromRotationMatrix(xc.matrixWorld);
  const dir=new THREE.Vector3(0,0,-1).applyQuaternion(_q);
  const rel=angDiff(Math.atan2(dir.x,-dir.z),c.h); S.headYaw=rel;
  if(rel<-1.05) c.lookLAgo=0; else if(rel>1.05) c.lookRAgo=0;
  for(const m of V3.mirrorPlanes){ const v=new THREE.Vector3().setFromMatrixPosition(m.mesh.matrixWorld).sub(hp).normalize(); if(v.dot(dir)>0.966) c.mirrorAgo=0; }
}
async function enterVR(){
  try{
    const sess=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor']});
    V3.r.xr.setReferenceSpaceType('local');
    await V3.r.xr.setSession(sess);
    V3.inXR=true; V3.frames=0; V3.needRecenter=true; V3.posOff.set(0,0,0); V3.yawOff=0;
    if(V3.cockpit) V3.cockpit.visible=true;
    setView('driver'); $('#report').hidden=true;
    if(S.ended){ prepare(); startDrive(); } else if(!S.running) startDrive(); else if(S.paused){ S.paused=false; showOverlay('hide'); }
    sess.addEventListener('end',()=>{ V3.inXR=false; S.gp=null; S.keys={}; if(V3.cockpit) V3.cockpit.visible=false; if(S.running&&!S.paused){ S.paused=true; showOverlay('paused'); } resize(); });
  }catch(e){ $('#vrNote').textContent='VR could not start here. Open the app from its own web address in the Meta Quest browser, then press Drive in VR.'; }
}

/* ---------- HUD ---------- */
const hud={dir:$('#hudDir'),hint:$('#hudHint'),lim:$('#hudLim'),spd:$('#hudSpd'),cr:$('#hudCr'),cL:$('#cL'),cR:$('#cR'),cM:$('#cM'),cSL:$('#cSL'),cSR:$('#cSR'),toast:$('#toast'),mRear:$('#mRear'),mL:$('#mL'),mR:$('#mR'),wheel:$('#wheel'),stage:document.querySelector('.stage')};
function updateHUD(){
  const c=S.car; if(!c) return;
  hud.spd.textContent=Math.round(c.v*3.6);
  hud.cr.hidden=!(c.cruise>0);
  const lim=S.level.hudLimit(); if(hud.lim.textContent!==String(lim.v)) hud.lim.textContent=lim.v;
  if(hud.dir.textContent!==S.instr) hud.dir.textContent=S.instr;
  const showHint=S.mode==='coach'&&S.hint&&S.time-S.hintT<9;
  hud.hint.hidden=!showHint; if(showHint&&hud.hint.textContent!==S.hint) hud.hint.textContent=S.hint;
  const blink=Math.floor(S.time*2.5)%2===0||!S.running;
  hud.cL.classList.toggle('blink',c.ind===-1&&blink); hud.cR.classList.toggle('blink',c.ind===1&&blink);
  hud.cM.classList.toggle('on',c.mirrorAgo<1.2); hud.cSL.classList.toggle('on',c.lookLAgo<1.2); hud.cSR.classList.toggle('on',c.lookRAgo<1.2);
  hud.stage.classList.toggle('turned',S.view==='driver'&&Math.abs(S.headYaw||0)>0.5);
  if(S.view==='driver'){ const on=c.mirrorAgo<1.5; for(const m of MIR) hud[m.id].classList.toggle('on',on); hud.wheel.style.transform=`rotate(${(c.steer*400).toFixed(1)}deg)`; }
  const t=S.toast;
  if(t&&S.time-t.t<3.5){ hud.toast.hidden=false; hud.toast.textContent=t.text; hud.toast.className='toast'+(t.sev!=='minor'?' serious':''); } else hud.toast.hidden=true;
}

/* ---------- flow ---------- */
function prepare(){
  const lv=LEVELS[S.lvlId]; S.level=lv;
  Object.assign(S,{faults:[],faultKeys:new Set(),time:0,running:false,paused:false,ended:false,intervened:false,hint:'',hintT:-99,toast:null,hintsDone:new Set(),zoomInit:false,keys:{}});
  overT=0;overST=0;hbT=0;
  lv.init({exit:+$('#exitSel').value||0,route:$('#routeSel').value});
  $('#exitField').hidden=S.lvlId!=='roundabout'; $('#routeField').hidden=S.lvlId!=='farsta'; $('#attrib').hidden=S.lvlId!=='farsta';
  S.headYaw=0; S.pitch=-0.02; S.camH=S.car.h;
  build3D();
  $('#banner').hidden=true;
  if(S.mode==='test') S.instr=S.instr;
  showOverlay('ready');
}
const BRIEF={
  roundabout:'A one-lane roundabout with zebra crossings on every arm. Approach at 40, pick the right spot in your lane for your exit, give way to the left, and signal right on the way out.',
  highway:'You start at 100 km/h in the right lane. A truck is ahead with a tight queue in front of it, and your exit comes up in about 1.4 km. Decide well, check before every lane change, and brake in the exit lane.',
  country:'An 80 road through forest into a village. Bends, a cyclist, a car waiting at a side road and a bus at its stop. Read each situation before you reach it.',
  farsta:()=>`The real streets around ${escapeHtml(FD.centre.name)}, from OpenStreetMap. <b>${escapeHtml(OSM.route.name)}</b>${OSM.route.desc?` (${escapeHtml(OSM.route.desc)})`:''}. You start at the test centre, standing still. Follow the directions at the top as you would the examiner's, and expect traffic lights, give-way rules and pedestrians.`
};
function showOverlay(kind){
  const ov=$('#overlay'),box=$('#overlayBox');
  if(kind==='hide'){ov.hidden=true;return;}
  ov.hidden=false;
  if(kind==='ready'){
    box.innerHTML=`<h2>${S.level.title}</h2><p>${typeof BRIEF[S.lvlId]==='function'?BRIEF[S.lvlId]():BRIEF[S.lvlId]}</p><p><b>${S.mode==='coach'?'Coach mode':'Test mode'}.</b> ${S.mode==='coach'?'Hints and faults show as you drive.':'No hints. The report comes at the end.'}</p><div class="row" style="justify-content:center"><button class="btn" id="goBtn">Start drive</button></div><p style="font-size:12px;opacity:.7">Keyboard: arrows to drive, Q/E signal, W mirrors, A/D shoulder checks. Or use the buttons below.</p>`;
    $('#goBtn').onclick=startDrive;
  } else if(kind==='paused'){
    box.innerHTML=`<h2>Paused</h2><div class="row" style="justify-content:center"><button class="btn" id="resBtn">Resume</button><button class="btn ghost" id="rstBtn">Restart</button></div>`;
    $('#resBtn').onclick=()=>{S.paused=false;showOverlay('hide');cv.focus();};
    $('#rstBtn').onclick=()=>{prepare();};
  }
}
function startDrive(){ if(S.ended) prepare(); S.running=true; S.paused=false; showOverlay('hide'); try{cv.focus({preventScroll:true});}catch(e){} }
function finish(){
  if(S.ended) return; S.ended=true; S.running=false;
  const f=S.faults, ser=f.filter(x=>x.sev!=='minor'), minors=f.filter(x=>x.sev==='minor'), iv=f.some(x=>x.sev==='intervention');
  const pass=ser.length===0&&minors.length<=2;
  const w={}; f.forEach(x=>{w[x.cat]=(w[x.cat]||0)+(x.sev==='minor'?1:3);});
  let main=null; Object.keys(w).forEach(k=>{ if(!main||w[k]>w[main]||(w[k]===w[main]&&k==='predict')) main=k; });
  P.drives.push({lvl:S.lvlId,route:S.level.subtitle?S.level.subtitle():undefined,mode:S.mode,pass,date:Date.now(),faults:f.map(x=>({cat:x.cat,sev:x.sev,text:x.text}))});
  if(P.drives.length>80) P.drives.splice(0,P.drives.length-80);
  saveP();
  S.lastResult={pass,main};
  const byCat={}; f.forEach(x=>{(byCat[x.cat]=byCat[x.cat]||[]).push(x);});
  const order=['predict','speed','place','attention','interact','maneuver','rules'];
  const tips=[...new Set(f.map(x=>x.tip).filter(Boolean))];
  const d=new Date();
  let html=`<h2>Resultat från ditt körprov <span style="font-weight:400;color:var(--muted)">(övning)</span></h2>
  <dl class="rtab"><dt>Provtyp</dt><dd>Körprov B, simulator</dd><dt>Scenario</dt><dd>${S.level.title}${S.lvlId==='roundabout'?`, ${ORD[RB.exit]} exit`:''}${S.level.subtitle?`, ${escapeHtml(S.level.subtitle())}`:''}</dd><dt>Läge</dt><dd>${S.mode==='coach'?'Coach':'Test'}</dd><dt>Datum</dt><dd>${d.toLocaleDateString('sv-SE')} ${d.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</dd><dt>Resultat</dt><dd><span class="verdict ${pass?'pass':'fail'}">${pass?'Godkänd':'Underkänd'}</span></dd></dl>`;
  if(!pass&&main) html+=`<div><p class="eyebrow">Huvudsaklig orsak / main reason</p><b style="font-size:16px">${CATS[main].en}</b> <span class="sv">(${CATS[main].sv})</span></div>`;
  if(iv) html+=`<p style="margin:0;font-weight:700;color:var(--bad)">Ingripande har skett. The examiner had to intervene.</p>`;
  if(!f.length) html+=`<p style="margin:0">Clean drive. No faults recorded. Try it in Test mode, or with a different exit.</p>`;
  for(const k of order){ if(!byCat[k]) continue; html+=`<div class="cat"><h3>${CATS[k].en} <span class="sv">${CATS[k].sv}</span></h3><ul>${byCat[k].map(x=>`<li><span class="sev ${x.sev}">${x.sev==='intervention'?'ingripande':x.sev}</span><span>${x.text}</span></li>`).join('')}</ul></div>`; }
  if(tips.length) html+=`<div class="tips"><b>Train next</b><ul>${tips.slice(0,5).map(t=>`<li>${t}</li>`).join('')}</ul></div>`;
  if(S.lvlId==='farsta') html+=`<p class="note" style="margin:0">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.</p>`;
  html+=`<div class="row"><button class="btn" id="again">Drive again</button><button class="btn ghost" id="closeRep">Close</button></div>`;
  $('#reportBody').innerHTML=html; $('#report').hidden=false;
  $('#again').onclick=()=>{$('#report').hidden=true; prepare(); startDrive();};
  $('#closeRep').onclick=()=>{$('#report').hidden=true; prepare();};
}

/* ---------- loop ---------- */
function pollGamepad(){
  S.gp=null;
  try{ const pads=navigator.getGamepads?navigator.getGamepads():[]; for(const p of pads){ if(!p) continue;
    const b=i=>p.buttons[i]?(p.buttons[i].value||(p.buttons[i].pressed?1:0)):0;
    S.gp={st:p.axes[0]||0,thr:b(7),brk:b(6)};
    const edge=(i,fn)=>{const now=b(i)>0.5; if(now&&!S.gpPrev[i]) fn(); S.gpPrev[i]=now;};
    edge(4,()=>toggleInd(-1)); edge(5,()=>toggleInd(1)); edge(2,()=>act('lookL')); edge(1,()=>act('lookR')); edge(3,()=>act('mirror')); edge(0,()=>act('cruise'));
    break; } }catch(e){}
}
function tick(dt){
  S.time+=dt; if(S.auto) autoDrive(); stepCar(dt); updateAI(dt); updatePeds(dt);
  if(!S.intervened&&!S.ended){ S.level.step(dt); if(!S.ended){ genericChecks(dt); collisions(); } }
  if(S.ai.length>60) S.ai=S.ai.filter(v=>!v.done);
}
/* Test autopilot (only with ?test in the address): follows the route path of the Farsta level */
function autoDrive(){
  const lv=S.level, c=S.car; if(!lv.path) return;
  const pr=project(lv.path,c.x,c.y,lv.hint), Ld=Math.max(4.5,c.v*0.8), q=at(lv.path,pr.s+Ld);
  const err=angDiff(Math.atan2(q.x-c.x,-(q.y-c.y)),c.h), want=Math.atan(2*2.7*Math.sin(err)/Ld);
  let vt=lv.checkLimit()/3.6*0.8;
  for(let d=5;d<40;d+=5){ const k=Math.abs(at(lv.path,pr.s+d).k); if(k>0.01) vt=Math.min(vt,Math.sqrt(2.5/k)+d*0.15); }
  const stopAt=d=>Math.sqrt(Math.max(0,5*(d-1)));
  const look=Math.max(12,c.v*c.v/5+8);
  for(const v of S.ai){
    if(v.done||Math.hypot(v.x-c.x,v.y-c.y)>look+15) continue;
    const fx=Math.sin(v.h)*v.v, fy=-Math.cos(v.h)*v.v;
    scan: for(let dd=2;dd<=look;dd+=2){ const q=at(lv.path,pr.s+dd); for(const k of [0,0.5,1]) if(Math.hypot(q.x-v.x-fx*k,q.y-v.y-fy*k)<(v.kind==='bus'?3.0:2.4)){ vt=Math.min(vt,stopAt(dd-5)); break scan; } }
  }
  for(const e of lv.ev){
    const d=e.s-pr.s; if(d<-15||d>45) continue;
    if(d<0){ if(e.t==='node') vt=Math.min(vt,Math.abs(e.angle||0)>1.1&&d>-8?3:6.5); continue; }
    if(e.t==='light'){ const st=lv.net.lightState(e.cl,e.grp,S.time); if(st.st==='R'||(st.st==='Y'&&d>c.v*c.v/8)) vt=Math.min(vt,stopAt(d)); }
    if(e.t==='node'&&e.m==='rb'){ vt=Math.min(vt,6+d*0.25); if(d>2&&lv.ringConflict(e.node,c)) vt=Math.min(vt,stopAt(d-3)); }
    if(e.t==='node'&&e.m==='turn'){
      vt=Math.min(vt,(Math.abs(e.angle||0)>1.1?2.6:4)+d*0.2);
      if(d<1) continue;
      if(e.ctrl!=='signals'){ const N=lv.net.nodes[e.node];
        const busy=S.ai.some(v=>{ if(v.done||!v.jn||Math.abs(angDiff(v.h,c.h))<0.6) return false; const j=v.jn.find(j=>j.node===e.node&&j.s>v.s-8); if(!j) return false; const dj=j.s-v.s; if(dj<4) return true; return e.ctrl!=='major'&&v.v>2&&dj/v.v<4; });
        if(busy) vt=Math.min(vt,stopAt(d-7)); }
    }
    if(e.t==='zebra'&&S.peds.some(p=>p.ev===e&&p.state==='cross')) vt=Math.min(vt,stopAt(d-3));
    if(e.t==='zebra'&&S.peds.some(p=>p.ev===e&&p.state!=='done')) vt=Math.min(vt,5.5+d*0.1);
  }
  // signals and checks like a careful driver
  let sig=0; const nx=lv.nodes.find(e=>e.s>pr.s-4), inRb=lv.nodes.find(e=>e.m==='rb'&&e.s<pr.s&&e.out&&pr.s<e.out.s+2);
  if(inRb) sig=lv.ev.some(x=>x.t==='rbx'&&x.s>pr.s-3&&x.s<inRb.out.s)?0:1;
  else if(nx&&nx.s-pr.s<75){ sig=nx.m==='rb'?(nx.n===1&&nx.dir==='right'?1:0):nx.dir==='left'?-1:nx.dir==='right'?1:0; if(nx.s-pr.s<55){ c.mirrorAgo=0; if(sig===1) c.lookRAgo=0; } }
  if(sig&&c.ind!==sig) toggleInd(sig); else if(!sig&&c.ind) toggleInd(c.ind);
  if(inRb&&sig) c.mirrorAgo=0;
  S.gp={st:clamp(want/(0.62/(1+c.v*0.22)),-1,1),thr:c.v<vt-0.4?0.7:0,brk:c.v>vt+0.3?clamp((c.v-vt)*0.25,0.1,0.6):0};
}
let last=null;
function frame(ts){
  const now=(ts||performance.now())/1000; const dt=Math.min(0.05,last==null?0.016:Math.max(0,now-last)); last=now;
  if(V3.inXR) pollXR();
  if(S.tab!=='drive'&&!V3.inXR) return;
  if(S.running&&!S.paused&&!S.ended){ if(!V3.inXR) pollGamepad(); for(let i=0;i<(S.timeScale||1)&&!S.ended;i++){ tick(dt/2); tick(dt/2); } }
  if(V3.inXR) renderXR(dt); else if(S.view==='map'||!V3.ok) render(); else render3D(dt);
  updateHUD();
}
function resize(){
  const r=cv.getBoundingClientRect(); const dpr=Math.min(2,window.devicePixelRatio||1); S.dpr=dpr;
  cv.width=Math.max(1,Math.round(r.width*dpr)); cv.height=Math.max(1,Math.round(r.height*dpr));
  if(V3.ok&&r.width&&r.height) V3.r.setSize(r.width,r.height,false);
}
try{ new ResizeObserver(resize).observe(cv); }catch(e){ addEventListener('resize',resize); }

/* ---------- input ---------- */
const KEYMAP={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
addEventListener('keydown',e=>{
  if(S.tab==='video'){videoKey(e);return;}
  if(S.tab!=='drive'||!$('#report').hidden) return;
  if(e.target.matches&&e.target.matches('input,select,textarea')) return;
  const k=KEYMAP[e.key]; if(k){S.keys[k]=true;e.preventDefault();return;}
  const kk=e.key.toLowerCase(); const HK={a:'lookL',d:'lookR',w:'mirror'};
  if(HK[kk]) S.keys['h_'+HK[kk]]=true;
  if(e.repeat) return;
  if(kk==='q')act('sigL'); else if(kk==='e')act('sigR'); else if(kk==='w')act('mirror'); else if(kk==='a')act('lookL'); else if(kk==='d')act('lookR'); else if(kk==='c')act('cruise');
  else if(kk==='v'&&V3.ok){ const vs=['driver','chase','map']; setView(vs[(vs.indexOf(S.view)+1)%3]); }
  else if(kk===' '||kk==='p'){ e.preventDefault(); if(S.running){ S.paused=!S.paused; showOverlay(S.paused?'paused':'hide'); } else if(!S.ended) startDrive(); }
});
addEventListener('keyup',e=>{const k=KEYMAP[e.key]; if(k) S.keys[k]=false; const HK={a:'lookL',d:'lookR',w:'mirror'}[e.key.toLowerCase()]; if(HK) S.keys['h_'+HK]=false;});
addEventListener('blur',()=>{ if(V3.inXR) return; S.keys={}; if(S.running&&!S.paused){S.paused=true;showOverlay('paused');}});
document.querySelectorAll('#pad [data-hold]').forEach(b=>{
  const k=b.dataset.hold;
  const on=e=>{e.preventDefault(); S.keys[k]=true; b.classList.add('held'); try{b.setPointerCapture(e.pointerId);}catch(x){} if(!S.running&&!S.ended&&!S.paused) startDrive();};
  const off=()=>{S.keys[k]=false; b.classList.remove('held');};
  b.addEventListener('pointerdown',on); b.addEventListener('pointerup',off); b.addEventListener('pointercancel',off); b.addEventListener('lostpointercapture',off);
  b.addEventListener('contextmenu',e=>e.preventDefault());
});
document.querySelectorAll('#pad [data-tap]').forEach(b=>b.addEventListener('pointerdown',e=>{e.preventDefault();act(b.dataset.tap);}));

document.querySelectorAll('.scard').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.scard').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));
  S.lvlId=b.dataset.lvl; $('#report').hidden=true; prepare();
}));
document.querySelectorAll('#modeSeg button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('#modeSeg button').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));
  S.mode=b.dataset.mode; prepare();
}));
$('#exitSel').addEventListener('change',()=>prepare());
$('#routeSel').addEventListener('change',()=>prepare());

/* ---------- tabs ---------- */
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.tab; S.tab=t;
  document.querySelectorAll('nav button').forEach(x=>x.setAttribute('aria-selected',x===b?'true':'false'));
  ['drive','quiz','video','progress'].forEach(id=>{$('#tab-'+id).hidden=id!==t;});
  if(t!=='drive'&&S.running&&!S.paused){S.paused=true;showOverlay('paused');}
  if(t!=='video'){ const v=$('#vid'); if(v&&!v.paused) v.pause(); }
  if(t==='progress') renderProgress();
  if(t==='drive') resize();
}));

/* ---------- quiz ---------- */
const QR='#3b3e43',QG='#5b7150';
const qcar=(x,y,col,label,rot)=>`<g transform="translate(${x} ${y}) rotate(${rot||0})"><rect x="-6" y="-11" width="12" height="22" rx="3" fill="${col}" stroke="#111" stroke-width=".8"/><rect x="-4.4" y="-8" width="8.8" height="4.5" rx="1.4" fill="#1d232b" opacity=".75"/>${label?`<text x="0" y="6" text-anchor="middle" font-family="Overpass,sans-serif" font-size="9" font-weight="800" fill="#111">${label}</text>`:''}</g>`;
const ghosts=(y)=>[['A',108],['B',120],['C',132]].map(([l,x])=>qcar(x,y,'rgba(255,255,255,.88)',l)).join('');
const vroad=(y0,y1)=>`<rect x="60" y="${y0}" width="80" height="${y1-y0}" fill="${QR}"/><line x1="100" y1="${y0}" x2="100" y2="${y1}" stroke="#eee" stroke-width="1.2" stroke-dasharray="7 9"/>`;
const arrow=(d)=>`<path d="${d}" fill="none" stroke="#f4c514" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 6"/><path d="${d}" fill="none" stroke="#f4c514" stroke-width="3" stroke-linecap="round" opacity=".35"/>`;
const svg=inner=>`<svg viewBox="0 0 200 240" role="img" aria-hidden="true"><rect width="200" height="240" fill="${QG}"/>${inner}</svg>`;
const rbBase=`<rect x="60" y="100" width="80" height="140" fill="${QR}"/><rect x="0" y="40" width="200" height="60" fill="${QR}"/><rect x="60" y="0" width="80" height="60" fill="${QR}"/><circle cx="100" cy="70" r="56" fill="${QR}"/><circle cx="100" cy="70" r="24" fill="#4d6b43" stroke="#c9ccc5" stroke-width="1.5"/><line x1="100" y1="140" x2="100" y2="240" stroke="#eee" stroke-width="1.2" stroke-dasharray="7 9"/>`;
const sign=(x,y,txt,blue)=>blue?`<g><rect x="${x-26}" y="${y-9}" width="52" height="18" rx="3" fill="#1f5fa8" stroke="#fff" stroke-width="1"/><text x="${x}" y="${y+4}" text-anchor="middle" font-family="Overpass,sans-serif" font-size="8.5" font-weight="700" fill="#fff">${txt}</text></g>`:`<g><circle cx="${x}" cy="${y}" r="11" fill="#c8102e"/><circle cx="${x}" cy="${y}" r="8" fill="#f4c514"/><text x="${x}" y="${y+3.5}" text-anchor="middle" font-family="Overpass,sans-serif" font-size="9" font-weight="800" fill="#111">${txt}</text></g>`;
const QUIZ=[
  {tag:'Roundabout',svg:svg(rbBase+arrow('M110 150 C150 120,150 30,100 22 C60 20,40 50,10 70')+ghosts(195)),q:'One-lane roundabout. You are taking the 3rd exit (left). Where in your lane should you be on the approach?',opts:['A: left part, close to the centre line','B: middle of the lane','C: right part, close to the edge'],ans:0,why:'Going left in a one-lane roundabout: keep to the left part of your lane on the way in and use the inner part of the circle. Signal right only after you pass the exit before yours.'},
  {tag:'Roundabout',svg:svg(rbBase+arrow('M128 150 C135 115,150 80,195 70')+ghosts(195)),q:'Same roundabout, 1st exit (right). Where should you be, and when do you signal?',opts:['A: near the centre line, signal when leaving','B: middle, no signal needed','C: right part of the lane, signal right already on the approach'],ans:2,why:'Taking the first exit: keep right and signal right on the approach, since you leave straight away. The examiner looks for the signal before you enter.'},
  {tag:'Roundabout',svg:svg(rbBase+qcar(55,88,'#6b7c93','',200)+qcar(112,150,'#f4c514','')+`<path d="M58 60 C46 75,48 92,62 108" fill="none" stroke="#fff" stroke-width="1.5" marker-end="none"/>`),q:'You reach the give-way line. A car in the roundabout is coming round from your left. What do you do?',opts:['A: drive in, it is on your left so you have priority','B: give way, wait for it to pass, then enter','C: enter quickly before it arrives'],ans:1,why:'Roundabouts have give-way signs and markings (the "shark teeth"). Traffic already in the circle has priority. Priority to the right does not apply here.'},
  {tag:'Crossroads',svg:svg(`<rect x="0" y="70" width="200" height="60" fill="${QR}"/>`+vroad(130,240)+`<rect x="60" y="0" width="80" height="70" fill="${QR}"/><line x1="0" y1="100" x2="60" y2="100" stroke="#eee" stroke-width="1.2" stroke-dasharray="7 9"/><line x1="140" y1="100" x2="200" y2="100" stroke="#eee" stroke-width="1.2" stroke-dasharray="7 9"/>`+arrow('M108 180 L108 112 Q108 88 84 88 L10 88')+ghosts(200)),q:'Turning left at a crossroads on a two-way road. Where do you position before the turn?',opts:['A: close to the centre line','B: middle of the lane','C: close to the right edge'],ans:0,why:'Turning left: move close to the centre line in good time and signal left. It shows your intention and lets traffic behind pass on your right.'},
  {tag:'Crossroads',svg:svg(`<rect x="0" y="70" width="200" height="60" fill="${QR}"/>`+vroad(130,240)+`<rect x="60" y="0" width="80" height="70" fill="${QR}"/><rect x="142" y="130" width="10" height="110" fill="#8a5a4a"/>`+arrow('M132 180 L132 135 Q132 114 152 114 L195 114')+ghosts(200)),q:'Turning right at a crossroads, with a cycle lane on your right. Where do you position, and what do you check?',opts:['A: near the centre line, check left','B: middle of the lane, no extra check','C: close to the right edge, and check the cycle lane over your right shoulder'],ans:2,why:'Turning right: keep to the right, signal, and do a shoulder check for cyclists coming up the cycle lane before you turn across it.'},
  {tag:'Country road',svg:svg(`<path d="M100 240 L100 150 C100 90,70 50,0 40" fill="none" stroke="${QR}" stroke-width="80"/><path d="M100 240 L100 150 C100 90,70 50,0 40" fill="none" stroke="#eee" stroke-width="1.2"/>`+qcar(55,52,'#6b7c93','',-70)+ghosts(190)+sign(165,120,'80')),q:'Left-hand bend on an 80 road, oncoming car in the bend. Where do you place the car?',opts:['A: close to the centre line','B: middle of the lane','C: the right part of your lane'],ans:2,why:'In a left bend keep to the right part of your lane. You get a margin to oncoming traffic and see further round the bend. Ease off before the bend, not in it.'},
  {tag:'Country road',svg:svg(vroad(0,240)+`<rect x="140" y="62" width="60" height="40" fill="${QR}"/>`+qcar(170,82,'#8e2b23','',-90)+qcar(120,195,'#f4c514','')),q:'80 road. A car is waiting at a side road on your right, 100 m ahead. What do you do?',opts:['A: keep 80, you have priority on the main road','B: ease off, cover the brake, and be ready in case it pulls out','C: brake hard and stop before the junction'],ans:1,why:'This is exactly "predict and assess". You probably have priority, but the other driver may not have seen you. Easing off early gives you time and space. Braking hard for no reason is also a fault.'},
  {tag:'Country road',svg:svg(vroad(0,240)+`<g transform="translate(133 120)"><rect x="-1" y="-8" width="2" height="16" fill="#222"/><circle cx="0" cy="0" r="3.4" fill="#2a6fb0"/></g>`+qcar(80,40,'#6b7c93','',180)+qcar(120,200,'#f4c514','')),q:'A cyclist ahead on your side, and an oncoming car approaching. What is the right move?',opts:['A: pass now, quickly, before the oncoming car arrives','B: slow down behind the cyclist, let the oncoming car pass, then overtake with at least 1.5 m','C: pass close to the cyclist so you stay in your lane'],ans:1,why:'Give cyclists at least 1.5 m. If that is not possible because of oncoming traffic, wait behind. Squeezing past is a serious fault.'},
  {tag:'Motorway',svg:svg(`<rect x="50" y="0" width="100" height="240" fill="${QR}"/><line x1="100" y1="0" x2="100" y2="240" stroke="#eee" stroke-width="1.2" stroke-dasharray="7 9"/>`+`<rect x="117" y="92" width="16" height="44" rx="2" fill="#d8d3c6" stroke="#111" stroke-width=".8"/>`+qcar(125,68,'#6b7c93','')+qcar(125,40,'#b8bec6','')+qcar(125,12,'#2f3a48','')+qcar(125,195,'#f4c514','')+sign(172,30,'Avfart 800 m',true)),q:'Motorway. A slow truck ahead with a tight queue in front of it, and your exit is in 800 m. What do you do?',opts:['A: overtake the truck now and squeeze in somewhere','B: stay behind the truck in the right lane and take the exit','C: move to the left lane and wait there for a gap'],ans:1,why:'There is no gap to return into and the exit is close. Overtaking is never required. Sitting in the left lane next to the queue blocks faster traffic, which is exactly what fails tests.'},
  {tag:'Motorway',svg:svg(`<rect x="40" y="0" width="90" height="240" fill="${QR}"/><path d="M130 240 L130 160 L160 120 L160 60 C160 30,175 15,200 8" fill="none" stroke="${QR}" stroke-width="0"/><path d="M130 175 L160 140 L160 0 L130 0 Z" fill="${QR}"/><line x1="85" y1="0" x2="85" y2="240" stroke="#eee" stroke-width="1.2" stroke-dasharray="7 9"/><line x1="130" y1="0" x2="130" y2="150" stroke="#eee" stroke-width="2" stroke-dasharray="3 3"/>`+qcar(108,205,'#f4c514','')+`<g font-family="Overpass,sans-serif" font-size="10" font-weight="800"><circle cx="108" cy="160" r="8" fill="#fff"/><text x="108" y="164" text-anchor="middle">A</text><circle cx="145" cy="90" r="8" fill="#fff"/><text x="145" y="94" text-anchor="middle">B</text><circle cx="150" cy="20" r="8" fill="#fff"/><text x="150" y="24" text-anchor="middle">C</text></g>`),q:'Taking a motorway exit. Where do you do most of your braking?',opts:['A: on the motorway, before the exit lane starts','B: in the exit lane, after you have moved over','C: on the ramp curve itself'],ans:1,why:'Keep motorway speed, move into the exit lane with mirror, signal and shoulder check, and then brake there. Braking on the motorway surprises the cars behind you, and braking in the curve is too late.'},
  {tag:'Motorway',svg:svg(`<rect x="40" y="0" width="90" height="240" fill="${QR}"/><line x1="85" y1="0" x2="85" y2="240" stroke="#eee" stroke-width="1.2" stroke-dasharray="7 9"/><path d="M130 240 L160 240 L160 120 L130 70 Z" fill="${QR}"/>`+qcar(108,130,'#6b7c93','')+qcar(108,70,'#b8bec6','')+qcar(145,195,'#f4c514','')),q:'You are on the on-ramp joining a motorway with traffic at 110. How do you merge?',opts:['A: stop at the end of the ramp and wait for a big gap','B: accelerate to the speed of the traffic, pick a gap, signal, check over your shoulder and merge','C: merge at 60 and let the others adjust'],ans:1,why:'Use the whole ramp to match speed. Merging slowly or stopping at the end is dangerous. Traffic already on the motorway is expected to make room using the zip principle, but you must match their speed.'},
  {tag:'Town',svg:svg(vroad(0,240)+`<rect x="122" y="60" width="20" height="62" rx="3" fill="#c8102e" stroke="#111" stroke-width=".8"/><rect x="121" y="62" width="5" height="5" fill="#ff9a1a"/>`+qcar(120,200,'#f4c514','')+sign(165,180,'50')),q:'50 zone. A bus at the stop ahead is signalling left to pull out. What do you do?',opts:['A: speed up and pass before it leaves','B: slow down and let the bus pull out','C: keep going, it has to wait for you'],ans:1,why:'Where the limit is 50 km/h or lower, you must let a bus leave a bus stop when it signals. It is a traffic rule, so getting it wrong is a serious fault.'}
];
let qi=0,qAnswered=false;
const qOrder=QUIZ.map((_,i)=>i).sort(()=>Math.random()-0.5);
function showQ(){
  const q=QUIZ[qOrder[qi%QUIZ.length]]; qAnswered=false;
  $('#qFig').innerHTML=q.svg; $('#qText').textContent=q.q;
  $('#qNum').textContent=`${q.tag} · ${(qi%QUIZ.length)+1} of ${QUIZ.length}`;
  $('#qScore').textContent=P.quiz.n?`${P.quiz.c} of ${P.quiz.n} right overall`:'';
  $('#qWhy').hidden=true; $('#qNext').hidden=true;
  $('#qOpts').innerHTML=q.opts.map((o,i)=>`<button class="opt" data-i="${i}"><span>${o}</span></button>`).join('');
  document.querySelectorAll('#qOpts .opt').forEach(b=>b.onclick=()=>answerQ(q,+b.dataset.i));
}
function answerQ(q,i){
  if(qAnswered) return; qAnswered=true;
  const ok=i===q.ans;
  document.querySelectorAll('#qOpts .opt').forEach(b=>{const j=+b.dataset.i; if(j===q.ans)b.classList.add('right'); else if(j===i)b.classList.add('wrong');});
  $('#qWhy').hidden=false; $('#qWhy').innerHTML=`<b>${ok?'Right.':'Not quite.'}</b> ${q.why}`;
  $('#qNext').hidden=false;
  P.quiz.n++; if(ok)P.quiz.c++; const b=P.quiz.by[q.tag]||(P.quiz.by[q.tag]={n:0,c:0}); b.n++; if(ok)b.c++; saveP();
  $('#qScore').textContent=`${P.quiz.c} of ${P.quiz.n} right overall`;
}
$('#qNext').onclick=()=>{qi++;showQ();};

/* ---------- video drills ---------- */
const V={key:null,tags:[],mode:'tag',drill:null};
const vid=$('#vid');
const VCATS=['Roundabout','Motorway exit','Motorway entry','Country road','Side road or junction','Cyclist or pedestrian','Lane change','Other'];
const SPEEDS=['Keep speed','Ease off','Brake'], POS=['Left part of lane','Middle of lane','Right part of lane','Change lane','Stop'];
const fmt=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
$('#vFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  try{ vid.src=URL.createObjectURL(f); }catch(x){ $('#vEmpty').textContent='This video could not be opened here.'; return; }
  vid.hidden=false; $('#vEmpty').hidden=true;
  V.key='fdl:tags:'+f.name+':'+f.size; V.tags=store.get(V.key,[]); V.drill=null; $('#vCard').hidden=true;
  setVMode(V.mode); renderTags();
});
vid.addEventListener('error',()=>{ $('#vEmpty').hidden=false; $('#vEmpty').textContent='This video format did not play here. Try an MP4 (H.264) file.'; vid.hidden=true; });
document.querySelectorAll('#vMode button').forEach(b=>b.addEventListener('click',()=>setVMode(b.dataset.vm)));
function setVMode(m){
  V.mode=m; document.querySelectorAll('#vMode button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.vm===m?'true':'false'));
  const has=!!V.key; const act=$('#vAction');
  $('#vCard').hidden=true;
  if(m==='tag'){ act.textContent='Mark a hazard here (H)'; act.disabled=!has; vid.controls=true; $('#vListTitle').textContent='Tagged moments'; }
  else { act.textContent=V.tags.length?'Start drill':'Tag some moments first'; act.disabled=!has||!V.tags.length; vid.controls=true; V.drill=null; }
  renderTags();
}
function renderTags(){
  const ul=$('#vTags');
  if(!V.tags.length){ul.innerHTML='<li class="empty">Nothing tagged yet. Play the clip and press Mark when a situation starts to develop.</li>';return;}
  ul.innerHTML=V.tags.map(t=>`<li><span class="t">${fmt(t.t)}</span><span>${t.cat}: ${t.speed.toLowerCase()}, ${t.pos.toLowerCase()}${t.note?`. ${escapeHtml(t.note)}`:''}</span>${V.mode==='tag'?`<button class="x" data-id="${t.id}" aria-label="Delete tag">✕</button>`:''}</li>`).join('');
  ul.querySelectorAll('.x').forEach(b=>b.onclick=()=>{V.tags=V.tags.filter(t=>t.id!==b.dataset.id); store.set(V.key,V.tags); renderTags();});
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
const radios=(name,list)=>`<div class="radios">${list.map((x,i)=>`<label><input type="radio" name="${name}" value="${x}" ${i===0?'checked':''}>${x}</label>`).join('')}</div>`;
$('#vAction').addEventListener('click',()=>{ if(V.mode==='tag') openTagForm(); else if(!V.drill) startDrill(); else spot(); });
function openTagForm(){
  if(!V.key) return; vid.pause(); const t=vid.currentTime; const card=$('#vCard');
  card.innerHTML=`<h3>New hazard at ${fmt(t)}</h3><p class="note" style="margin:0">Mark the moment the situation starts to develop, the earliest a good driver would react.</p>
  <label class="field">Situation<select id="tCat">${VCATS.map(c=>`<option>${c}</option>`).join('')}</select></label>
  <div class="field">Correct speed action${radios('tSpd',SPEEDS)}</div>
  <div class="field">Correct position${radios('tPos',POS)}</div>
  <label class="field">Note (what a good driver sees)<input type="text" id="tNote" placeholder="e.g. car waiting at the side road on the right"></label>
  <div class="row"><button class="btn" id="tSave">Save tag</button><button class="btn ghost" id="tCancel">Cancel</button></div>`;
  card.hidden=false;
  $('#tSave').onclick=()=>{ const tag={id:String(Date.now()),t,cat:$('#tCat').value,speed:card.querySelector('input[name=tSpd]:checked').value,pos:card.querySelector('input[name=tPos]:checked').value,note:$('#tNote').value.trim()}; V.tags.push(tag); V.tags.sort((a,b)=>a.t-b.t); store.set(V.key,V.tags); card.hidden=true; renderTags(); };
  $('#tCancel').onclick=()=>{card.hidden=true;};
}
function startDrill(){
  V.drill={done:new Set(),res:[],falseTaps:0,busy:false}; vid.controls=false; vid.currentTime=0;
  $('#vAction').textContent='I see it! (Space)'; $('#vListTitle').textContent='Drill: tags hidden';
  $('#vTags').innerHTML='<li class="empty">Tap the moment you spot a situation developing. Earlier scores higher, up to 5 points.</li>';
  $('#vStats').hidden=true; vid.play().catch(()=>{});
}
function spot(){
  const d=V.drill; if(!d||d.busy) return; const t=vid.currentTime;
  const tag=V.tags.find(g=>!d.done.has(g.id)&&t>=g.t-2&&t<=g.t+4);
  if(!tag){ d.falseTaps++; flashAction('Nothing developing yet'); return; }
  const score=t<=tag.t?5:Math.max(1,5-Math.ceil((t-tag.t)/0.8));
  askTag(tag,score,t);
}
function flashAction(msg){const b=$('#vAction'),o=b.textContent; b.textContent=msg; setTimeout(()=>{if(V.drill)b.textContent='I see it! (Space)';},900);}
function askTag(tag,score,t){
  const d=V.drill; d.busy=true; d.done.add(tag.id); vid.pause();
  const card=$('#vCard');
  card.innerHTML=`<h3>${score?`Spotted: ${score} of 5 points`:'Missed this one: 0 points'}</h3><p class="note" style="margin:0">${score?(score===5?'Early, like a good driver.':'You saw it, but a bit late. Look further ahead.'):`It started to develop at ${fmt(tag.t)}.`} What is your plan?</p>
  <div class="field">Speed${radios('dSpd',SPEEDS)}</div><div class="field">Position${radios('dPos',POS)}</div>
  <div class="row"><button class="btn" id="dOk">Check</button></div><div id="dFb"></div>`;
  card.hidden=false;
  $('#dOk').onclick=()=>{
    const sp=card.querySelector('input[name=dSpd]:checked').value, po=card.querySelector('input[name=dPos]:checked').value;
    const sOk=sp===tag.speed,pOk=po===tag.pos;
    d.res.push({cat:tag.cat,score,sOk,pOk});
    $('#dFb').innerHTML=`<div class="why" style="margin-top:6px"><b>${tag.cat}.</b> Speed: ${tag.speed} ${sOk?'✓':'(you said '+sp.toLowerCase()+')'}. Position: ${tag.pos} ${pOk?'✓':'(you said '+po.toLowerCase()+')'}.${tag.note?` ${escapeHtml(tag.note)}.`:''}</div><div class="row" style="margin-top:8px"><button class="btn" id="dGo">Continue</button></div>`;
    $('#dOk').disabled=true;
    $('#dGo').onclick=()=>{card.hidden=true; d.busy=false; vid.play().catch(()=>{});};
  };
}
vid.addEventListener('timeupdate',()=>{ const d=V.drill; if(V.mode!=='drill'||!d||d.busy) return; const t=vid.currentTime; const missed=V.tags.find(g=>!d.done.has(g.id)&&t>g.t+4); if(missed) askTag(missed,0,t); });
vid.addEventListener('ended',()=>{ const d=V.drill; if(V.mode!=='drill'||!d) return; endDrill(); });
function endDrill(){
  const d=V.drill; vid.controls=true;
  V.tags.forEach(g=>{ if(!d.done.has(g.id)) d.res.push({cat:g.cat,score:0,sOk:false,pOk:false}); });
  const total=d.res.reduce((a,r)=>a+r.score,0), max=d.res.length*5;
  const by={}; d.res.forEach(r=>{const b=by[r.cat]||(by[r.cat]={s:0,n:0,plan:0}); b.s+=r.score; b.n++; if(r.sOk&&r.pOk)b.plan++;});
  P.video.push({date:Date.now(),total,max,falseTaps:d.falseTaps,by}); if(P.video.length>60)P.video.shift(); saveP();
  const st=$('#vStats'); st.hidden=false;
  st.innerHTML=`<p class="eyebrow">Drill result</p><p style="margin:0 0 8px"><b style="font-size:20px;font-family:var(--mono)">${total}/${max}</b> spotting points, ${d.falseTaps} early taps</p><div class="bars">${Object.entries(by).map(([k,b])=>`<div class="bar"><span>${k}</span><div class="tr"><div class="fl" style="width:${b.s/(b.n*5)*100}%;background:var(--ok)"></div></div><span class="v">${(b.s/b.n).toFixed(1)}</span></div>`).join('')}</div>`;
  V.drill=null; $('#vAction').textContent='Start drill again'; renderTags();
}
function videoKey(e){
  if(e.target.matches&&e.target.matches('input,select,textarea')) return;
  if(V.mode==='tag'&&e.key.toLowerCase()==='h'&&V.key){e.preventDefault();openTagForm();}
  if(V.mode==='drill'&&e.key===' '&&V.drill){e.preventDefault();spot();}
}

/* ---------- progress ---------- */
let resetArmed=false;
function renderProgress(){
  const body=$('#progBody'); const D=P.drives;
  const lv={roundabout:'Roundabout',highway:'Motorway exit',country:'Country road'}; if(LEVELS.farsta) lv.farsta='Farsta (real roads)';
  const rows=Object.keys(lv).map(k=>{const ds=D.filter(d=>d.lvl===k); const last=ds[ds.length-1]; return `<tr><td>${lv[k]}</td><td class="n">${ds.length}</td><td class="n">${ds.filter(d=>d.pass).length}</td><td>${last?(last.pass?'<span class="verdict pass" style="font-size:11px">Godkänd</span>':'<span class="verdict fail" style="font-size:11px">Underkänd</span>'):'<span class="empty">Not driven</span>'}</td></tr>`;}).join('');
  const recent=D.slice(-10); const w={}; recent.forEach(d=>d.faults.forEach(f=>{w[f.cat]=(w[f.cat]||0)+(f.sev==='minor'?1:3);}));
  const maxW=Math.max(1,...Object.values(w));
  const bars=Object.keys(CATS).map(k=>`<div class="bar"><span>${CATS[k].sv}</span><div class="tr"><div class="fl" style="width:${(w[k]||0)/maxW*100}%"></div></div><span class="v">${w[k]||0}</span></div>`).join('');
  let focus=null; Object.keys(w).forEach(k=>{if(!focus||w[k]>w[focus])focus=k;});
  const sugg={predict:'Drive the country road in Coach mode and say out loud what could happen next before each sign.',speed:'Watch the limit signs and ease off before bends and roundabouts, not in them.',place:'Take the positioning quiz, then drive the roundabout with all three exits.',attention:'Every lane change: W, then the signal, then the shoulder check, then move.',interact:'Practise giving way: roundabout entries and the bus in the village.',maneuver:'Smooth inputs: let the car settle before you steer again.',rules:'Signals in and out of roundabouts, zebra crossings and buses leaving stops.'};
  const qb=Object.entries(P.quiz.by).map(([k,b])=>`<div class="bar"><span>${k}</span><div class="tr"><div class="fl" style="width:${b.c/b.n*100}%;background:var(--ok)"></div></div><span class="v">${Math.round(b.c/b.n*100)}%</span></div>`).join('');
  const vs=P.video; const vAvg=vs.length?(vs.reduce((a,v)=>a+(v.max?v.total/v.max:0),0)/vs.length*5).toFixed(1):null;
  body.innerHTML=`${focus?`<div class="focus" style="margin-bottom:16px"><p class="eyebrow" style="color:var(--sign-ink);opacity:.7">Focus next</p><b>${CATS[focus].en} (${CATS[focus].sv})</b><p style="margin:4px 0 0">${sugg[focus]}</p></div>`:''}
  <div class="prog">
    <div class="panel"><h2>Drives</h2><table><thead><tr><th>Scenario</th><th>Runs</th><th>Passed</th><th>Last</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="panel"><h2>Faults, last 10 drives</h2>${recent.length?`<div class="bars">${bars}</div><p class="note">Serious faults count 3, minor faults count 1.</p>`:'<p class="empty">No drives yet. Your fault profile appears here after the first drive.</p>'}</div>
    <div class="panel"><h2>Positioning quiz</h2>${P.quiz.n?`<p style="margin:0 0 10px"><b style="font-family:var(--mono)">${P.quiz.c}/${P.quiz.n}</b> right</p><div class="bars">${qb}</div>`:'<p class="empty">No answers yet.</p>'}</div>
    <div class="panel"><h2>Video drills</h2>${vs.length?`<p style="margin:0">${vs.length} drill${vs.length>1?'s':''}, average spotting score <b style="font-family:var(--mono)">${vAvg}</b> of 5</p>`:'<p class="empty">No drills yet. Load a clip in Video drills.</p>'}</div>
  </div>
  <div class="row" style="margin-top:16px"><button class="btn ghost" id="resetP">${resetArmed?'Tap again to erase all progress':'Reset progress'}</button></div>`;
  $('#resetP').onclick=()=>{ if(!resetArmed){resetArmed=true;renderProgress();setTimeout(()=>{resetArmed=false;},4000);return;} P.drives=[];P.quiz={n:0,c:0,by:{}};P.video=[];saveP();resetArmed=false;renderProgress(); };
}

/* ---------- boot ---------- */
const fCard=document.querySelector('.scard[data-lvl=farsta]');
if(LEVELS.farsta){
  $('#routeSel').innerHTML=FD.routes.map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}${r.desc?` (${escapeHtml(r.desc)})`:''}</option>`).join('')+'<option value="random">Random route from the test centre</option>';
} else if(fCard){ fCard.disabled=true; fCard.querySelector('span:last-child').textContent='Map data not built yet. Run npm run osm to download it from OpenStreetMap (see README).'; }
if(/[?&]test\b/.test(location.search)) window.FDL_TEST={
  auto(on,scale,traffic){ S.auto=!!on; S.timeScale=scale||1; if(traffic===false&&S.level===OSM){ OSM.maxAI=0; OSM.noScripted=true; S.ai.forEach(v=>{v.done=true;}); } },
  state(){ const lv=S.level; return {lvl:S.lvlId,running:S.running,ended:S.ended,time:S.time,faults:S.faults.map(f=>f.sev+': '+f.text),s:lv.ps,len:lv.path?lv.path.len:null,ai:S.ai.filter(v=>!v.done).length,peds:S.peds.length,instr:S.instr,route:lv.subtitle?lv.subtitle():null,reroutes:lv.reroutes||0}; },
  near(){ const c=S.car; return {car:{x:c.x,y:c.y,h:c.h,v:c.v},ai:S.ai.filter(v=>!v.done&&Math.hypot(v.x-c.x,v.y-c.y)<40).map(v=>({x:v.x,y:v.y,h:v.h,v:v.v,s:v.s,kind:v.kind,assert:!!v.assert,parked:!!v.parked,rel:rel(v),jn:v.jn&&v.jn.map(j=>({n:j.node,d:j.s-v.s}))}))}; }
};
S.view='map';
if(init3D()){ const sv=store.get('fdl:view','driver'); S.view=['driver','chase','map'].includes(sv)?sv:'driver'; }
else { document.querySelectorAll('#viewSeg button').forEach(b=>{ if(b.dataset.view!=='map') b.disabled=true; }); }
document.querySelectorAll('#viewSeg button').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
setView(S.view);
resize(); prepare(); showQ();
if(V3.ok) V3.r.setAnimationLoop(frame); else { const raf=t=>{ frame(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
if(V3.ok&&navigator.xr&&navigator.xr.isSessionSupported){
  navigator.xr.isSessionSupported('immersive-vr').then(ok=>{ if(ok){ $('#vrBtn').disabled=false; $('#vrNote').textContent='Put on the headset, sit down and press Drive in VR. Look into the mirrors and over your shoulder for real: the app sees where you look.'; } }).catch(()=>{});
}
$('#vrBtn').addEventListener('click',enterVR);
if(!V3.ok) $('#viewNote').textContent='The 3D views could not start on this device, so the Map view is shown.';
})();
