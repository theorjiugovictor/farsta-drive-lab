/* Farsta Drive Lab: OpenStreetMap road network helpers.
   Shared by the app (src/app.js), the preprocessor (tools/osm-to-level.mjs) and the unit tests.
   Plain script with no imports or exports, so it loads both as a classic <script> and as an
   ES module import. It exposes globalThis.FDL_OSM.
   Coordinates are metres: x east, y south (canvas convention), heading 0 = north, clockwise. */
(function(){
'use strict';
const D2R=Math.PI/180, M_LON=111320, M_LAT=110540;
const angDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const hdg=(dx,dy)=>Math.atan2(dx,-dy);

/* lat/lon <-> local metres around an origin (equirectangular, fine for a few km) */
function projector(lat0,lon0){
  const kx=Math.cos(lat0*D2R)*M_LON;
  return {fwd:(lat,lon)=>[(lon-lon0)*kx,-(lat-lat0)*M_LAT], inv:(x,y)=>[lat0-y/M_LAT,lon0+x/kx]};
}

/* Douglas-Peucker on [[x,y],...], endpoints kept */
function simplify(pts,tol){
  if(pts.length<3) return pts.slice();
  const keep=new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;
  const st=[[0,pts.length-1]], t2=tol*tol;
  while(st.length){
    const [a,b]=st.pop(), ax=pts[a][0], ay=pts[a][1], dx=pts[b][0]-ax, dy=pts[b][1]-ay, L2=dx*dx+dy*dy;
    let md=-1, mi=-1;
    for(let i=a+1;i<b;i++){
      let t=L2?((pts[i][0]-ax)*dx+(pts[i][1]-ay)*dy)/L2:0; t=Math.max(0,Math.min(1,t));
      const ex=ax+dx*t-pts[i][0], ey=ay+dy*t-pts[i][1], d=ex*ex+ey*ey;
      if(d>md){md=d;mi=i;}
    }
    if(mi>0&&md>t2){ keep[mi]=1; st.push([a,mi],[mi,b]); }
  }
  return pts.filter((_,i)=>keep[i]);
}

/* road classes */
const TIER={motorway:4,trunk:4,primary:3,secondary:3,tertiary:2,unclassified:1,residential:1,living_street:0,service:0};
const base=hw=>String(hw||'').replace('_link','');
/* slip roads rank like a tertiary road, so the end of an off-ramp gives way to a bigger road */
const tier=hw=>{const t=TIER[base(hw)], v=t==null?1:t; return String(hw||'').endsWith('_link')?Math.min(v,2):v;};
const isLink=w=>String(w.hw||'').endsWith('_link');
const isFast=w=>w.hw==='motorway'||(w.hw==='trunk'&&w.ow);
/* Limits used where OSM has no maxspeed: 50 is the Swedish default in built-up areas,
   gårdsgata (living_street) is walking pace. Service roads have no legal limit, 30 is practical. */
function defaultLimit(hw){ const b=base(hw); return b==='motorway'?110:b==='trunk'?70:b==='living_street'?7:b==='service'?30:50; }
const wayLimit=w=>w.ms||defaultLimit(w.hw);
/* lateral offset of the rightmost lane centre from the way centreline (positive = right) */
function laneOffset(w){
  const W=w.w, ln=Math.max(1,w.ln||1);
  if(w.rb) return ln>1?W/2-2.2:0;
  if(w.ow) return ln>1?W/2-W/ln/2:0;
  const per=Math.max(1,Math.floor(ln/2)), lw=W/2/per; return W/2-lw/2;
}
function rng(seed){ let s=(Math.floor(seed)>>>0)||0x9e3779b9; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }

/* tiny binary heap of [cost, value] */
function Heap(){ this.k=[]; this.v=[]; }
Heap.prototype.push=function(k,v){ const K=this.k,V=this.v; let i=K.length; K.push(k); V.push(v); while(i>0){ const p=(i-1)>>1; if(K[p]<=k) break; K[i]=K[p]; V[i]=V[p]; i=p; } K[i]=k; V[i]=v; };
Heap.prototype.pop=function(){ const K=this.k,V=this.v, rk=K[0], rv=V[0], lk=K.pop(), lv=V.pop(); const n=K.length; if(n){ let i=0; for(;;){ let c=2*i+1; if(c>=n) break; if(c+1<n&&K[c+1]<K[c]) c++; if(K[c]>=lk) break; K[i]=K[c]; V[i]=V[c]; i=c; } K[i]=lk; V[i]=lv; } return [rk,rv]; };
Object.defineProperty(Heap.prototype,'size',{get(){return this.k.length;}});

/* ---------- network ----------
   Level data (see tools/osm-to-level.mjs):
   ways  [{n name, ref, hw, ln lanes, w width, ms maxspeed|null, ow oneway, rb roundabout}]
   nodes [[x,y]]   graph nodes (junctions and way ends)
   edges [[a,b,way,[x0,y0,x1,y1,...]]]  split at graph nodes, in the drivable direction for oneways
   feats [{t:'sig'|'zebra'|'give_way'|'stop'|'bus', x,y, e edge, s along edge, d +1/-1 (applies a->b / b->a), side}]
   lights [{x,y}]  clusters of signal nodes
   A directed edge id `de` is 2*edge for a->b and 2*edge+1 for b->a. */
function Net(L){
  this.L=L; this.ways=L.ways;
  const N=L.nodes.length; this.N=N;
  this.nodes=L.nodes.map(n=>({x:n[0],y:n[1]}));
  this.E=L.edges.map((e,i)=>{
    const f=e[3], pts=[]; for(let k=0;k<f.length;k+=2) pts.push([f[k],f[k+1]]);
    const cum=[0]; for(let k=1;k<pts.length;k++) cum.push(cum[k-1]+Math.hypot(pts[k][0]-pts[k-1][0],pts[k][1]-pts[k-1][1]));
    const way=L.ways[e[2]];
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(const p of pts){ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); }
    const m=way.w/2+2;
    return {i,a:e[0],b:e[1],wi:e[2],way,pts,cum,len:Math.max(0.01,cum[cum.length-1]),half:way.w/2,bb:[x0-m,y0-m,x1+m,y1+m]};
  });
  this.out=Array.from({length:N},()=>[]); this.inc=Array.from({length:N},()=>[]); this.deg=new Uint16Array(N);
  for(const e of this.E){
    this.out[e.a].push(2*e.i); this.inc[e.b].push(2*e.i);
    if(!e.way.ow){ this.out[e.b].push(2*e.i+1); this.inc[e.a].push(2*e.i+1); }
    this.deg[e.a]++; this.deg[e.b]++;
  }
  this._rev=new Map(); this._h=new Map();
  // spatial grid of segments
  const G=this.G=40; this.grid=new Map();
  for(const e of this.E){
    for(let k=0;k<e.pts.length-1;k++){
      const [ax,ay]=e.pts[k],[bx,by]=e.pts[k+1], m=e.half+2;
      const cx0=Math.floor((Math.min(ax,bx)-m)/G), cx1=Math.floor((Math.max(ax,bx)+m)/G), cy0=Math.floor((Math.min(ay,by)-m)/G), cy1=Math.floor((Math.max(ay,by)+m)/G);
      for(let cx=cx0;cx<=cx1;cx++) for(let cy=cy0;cy<=cy1;cy++){ const key=cx+','+cy; let l=this.grid.get(key); if(!l) this.grid.set(key,l=[]); l.push(e.i*4096+k); }
    }
  }
  this.feats=L.feats||[]; this.fByEdge=new Map();
  for(const f of this.feats){ if(f.e==null||f.e<0) continue; let l=this.fByEdge.get(f.e); if(!l) this.fByEdge.set(f.e,l=[]); l.push(f); }
  this.buildLights();
}
const NP=Net.prototype;
NP.eOf=function(de){return this.E[de>>1];};
NP.fwd=de=>(de&1)===0;
NP.from=function(de){const e=this.E[de>>1]; return de&1?e.b:e.a;};
NP.to=function(de){const e=this.E[de>>1]; return de&1?e.a:e.b;};
NP.len=function(de){return this.E[de>>1].len;};
NP.way=function(de){return this.E[de>>1].way;};
NP.rb=function(de){return !!this.E[de>>1].way.rb;};
NP.dePts=function(de){ const e=this.E[de>>1]; if(!(de&1)) return e.pts; let r=this._rev.get(e.i); if(!r){ r=e.pts.slice().reverse(); this._rev.set(e.i,r); } return r; };
/* point at distance s along a directed edge */
NP.pointAt=function(de,s){
  const e=this.E[de>>1]; let t=de&1?e.len-s:s; t=Math.max(0,Math.min(e.len,t));
  let k=0; while(k<e.cum.length-2&&e.cum[k+1]<t) k++;
  const a=e.pts[k],b=e.pts[k+1], L=(e.cum[k+1]-e.cum[k])||1, u=(t-e.cum[k])/L;
  let tx=(b[0]-a[0])/L, ty=(b[1]-a[1])/L; if(de&1){tx=-tx;ty=-ty;}
  return {x:a[0]+(b[0]-a[0])*u, y:a[1]+(b[1]-a[1])*u, tx, ty};
};
/* heading leaving the start node, and arriving at the end node (measured over ~8 m) */
NP.hOut=function(de){ const k='o'+de; let h=this._h.get(k); if(h==null){ const p=this.pointAt(de,0), q=this.pointAt(de,Math.min(8,this.len(de))); h=hdg(q.x-p.x,q.y-p.y); this._h.set(k,h);} return h; };
NP.hIn=function(de){ const k='i'+de; let h=this._h.get(k); if(h==null){ const L=this.len(de), p=this.pointAt(de,Math.max(0,L-8)), q=this.pointAt(de,L); h=hdg(q.x-p.x,q.y-p.y); this._h.set(k,h);} return h; };

/* nearest point on the network: {e, k, d, s along edge a->b, x, y, h heading a->b, half} */
NP.nearest=function(x,y,maxD,filter){
  const G=this.G, r=Math.ceil((maxD||30)/G); let best=null, bd=(maxD||30)**2;
  const cx=Math.floor(x/G), cy=Math.floor(y/G), seen=new Set();
  for(let i=cx-r;i<=cx+r;i++) for(let j=cy-r;j<=cy+r;j++){
    const l=this.grid.get(i+','+j); if(!l) continue;
    for(const id of l){
      if(seen.has(id)) continue; seen.add(id);
      const e=this.E[Math.floor(id/4096)], k=id%4096; if(filter&&!filter(e)) continue;
      const [ax,ay]=e.pts[k],[bx,by]=e.pts[k+1], dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
      let t=L2?((x-ax)*dx+(y-ay)*dy)/L2:0; t=Math.max(0,Math.min(1,t));
      const px=ax+dx*t, py=ay+dy*t, d=(x-px)**2+(y-py)**2;
      if(d<bd){ const L=Math.sqrt(L2)||1; bd=d; best={e,k,t,d:0,x:px,y:py,s:e.cum[k]+t*L,h:hdg(dx,dy),half:e.half,way:e.way,lat:(x-px)*(-dy/L)+(y-py)*(dx/L)}; }
    }
  }
  if(best) best.d=Math.sqrt(bd);
  return best;
};
/* is (x, y) on any road surface (within half the width plus margin)? Several roads overlap at merges and junctions. */
NP.onRoad=function(x,y,margin){
  const l=this.grid.get(Math.floor(x/this.G)+','+Math.floor(y/this.G)); if(!l) return false;
  for(const id of l){
    const e=this.E[Math.floor(id/4096)], k=id%4096, [ax,ay]=e.pts[k],[bx,by]=e.pts[k+1], dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
    let t=L2?((x-ax)*dx+(y-ay)*dy)/L2:0; t=Math.max(0,Math.min(1,t));
    if(Math.hypot(x-ax-dx*t,y-ay-dy*t)<e.half+margin) return true;
  }
  return false;
};
/* edges near a point (by bounding box) */
NP.edgesNear=function(x,y,R){ const out=[]; for(const e of this.E){ const b=e.bb; if(b[2]<x-R||b[0]>x+R||b[3]<y-R||b[1]>y+R) continue; out.push(e); } return out; };
/* nearest directed edge that a car at (x,y) heading h could be driving on: {de, s along de, d} */
NP.nearestDe=function(x,y,h,maxD){
  const G=this.G, r=Math.ceil((maxD||20)/G), cx=Math.floor(x/G), cy=Math.floor(y/G), cand=new Map();
  for(let i=cx-r;i<=cx+r;i++) for(let j=cy-r;j<=cy+r;j++){
    const l=this.grid.get(i+','+j); if(!l) continue;
    for(const id of l){
      const e=this.E[Math.floor(id/4096)], k=id%4096;
      const [ax,ay]=e.pts[k],[bx,by]=e.pts[k+1], dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
      let t=L2?((x-ax)*dx+(y-ay)*dy)/L2:0; t=Math.max(0,Math.min(1,t));
      const d=Math.hypot(x-ax-dx*t,y-ay-dy*t); if(d>(maxD||20)) continue;
      const c=cand.get(e.i); if(!c||d<c.d) cand.set(e.i,{e,d,s:e.cum[k]+t*Math.sqrt(L2),h:hdg(dx,dy)});
    }
  }
  let best=null;
  for(const c of cand.values()){
    const opts=[[2*c.e.i,c.s,c.h]]; if(!c.e.way.ow) opts.push([2*c.e.i+1,c.e.len-c.s,c.h+Math.PI]);
    for(const [de,s,hh] of opts){
      const al=h==null?1:Math.cos(angDiff(h,hh)); if(al<0.3) continue;
      const score=c.d+(1-al)*6; if(!best||score<best.score) best={de,s,d:c.d,score};
    }
  }
  return best;
};
/* nearest graph node with any edge */
NP.snapNode=function(x,y,maxD){ let best=-1,bd=(maxD||1e9)**2; this.nodes.forEach((n,i)=>{ if(!this.deg[i]) return; const d=(n.x-x)**2+(n.y-y)**2; if(d<bd){bd=d;best=i;} }); return best; };

/* ---------- routing ---------- */
const CLASS_COST={service:3,living_street:3,residential:1.3,unclassified:1.15};
NP.cost=function(de){ const w=this.way(de); return this.len(de)*(CLASS_COST[base(w.hw)]||1); };
NP.turnCost=function(de,nd){
  if((nd>>1)===(de>>1)) return 2000;
  const d=angDiff(this.hOut(nd),this.hIn(de));
  return Math.abs(d)>2.5?600:d<-0.5?20:d>0.5?6:0;
};
/* edge-based Dijkstra from a directed edge to a node; returns [startDe, ..., de ending at goal] */
NP.route=function(startDe,goal,avoid){
  if(this.to(startDe)===goal) return [startDe];
  const M=this.E.length*2, dist=new Float64Array(M).fill(Infinity), prev=new Int32Array(M).fill(-1), h=new Heap();
  dist[startDe]=0; h.push(0,startDe);
  while(h.size){
    const [d,de]=h.pop(); if(d>dist[de]) continue;
    const n=this.to(de);
    if(n===goal&&de!==startDe){ const out=[]; for(let c=de;c!==-1;c=prev[c]) out.push(c); return out.reverse(); }
    const outs=this.out[n];
    for(const nd of outs){
      if((nd>>1)===(de>>1)&&outs.length>1) continue;   // no U-turns except at a dead end
      const c=d+this.cost(nd)*(avoid&&avoid.has(nd>>1)?2.5:1)+this.turnCost(de,nd);
      if(c<dist[nd]){ dist[nd]=c; prev[nd]=de; h.push(c,nd); }
    }
  }
  return null;
};
/* route through a list of nodes, starting on startDe */
NP.routeVia=function(startDe,nodes){
  const list=[startDe], used=new Set([startDe>>1]); let cur=startDe;
  for(const n of nodes){
    const seg=this.route(cur,n,used); if(!seg) return null;
    for(const d of seg.slice(1)){ list.push(d); used.add(d>>1); }
    cur=list[list.length-1];
  }
  return list;
};
/* snap waypoints [[x,y],...] to the network and route through them. The first waypoint picks the start edge. */
NP.routeWaypoints=function(wps,maxSnap){
  if(wps.length<2) return null;
  const st=this.nearestDe(wps[0][0],wps[0][1],hdg(wps[1][0]-wps[0][0],wps[1][1]-wps[0][1]),maxSnap||40)||this.nearestDe(wps[0][0],wps[0][1],null,maxSnap||40);
  if(!st) return null;
  const nodes=[]; for(const w of wps.slice(1)){ const n=this.snapNode(w[0],w[1],maxSnap||60); if(n<0) return null; nodes.push(n); }
  const de=this.routeVia(st.de,nodes); return de?{de,s0:st.s}:null;
};
/* random drive along the network, used for AI traffic */
NP.randomWalk=function(startDe,length,rnd){
  const list=[startDe]; let L=this.len(startDe);
  while(L<length&&list.length<400){
    const last=list[list.length-1], opts=this.out[this.to(last)].filter(d=>(d>>1)!==(last>>1));
    if(!opts.length) break;
    const ws=opts.map(d=>{ const w=this.way(d), turn=Math.abs(angDiff(this.hOut(d),this.hIn(last))); return (turn<0.5?3:1)*(1+tier(w.hw))*(base(w.hw)==='service'?0.08:1); });
    let r=rnd()*ws.reduce((a,b)=>a+b,0), i=0; while(i<ws.length-1&&r>ws[i]){ r-=ws[i]; i++; }
    list.push(opts[i]); L+=this.len(opts[i]);
  }
  return list;
};

/* ---------- lane-centre path along a list of directed edges ----------
   Returns {pts:[{x,y,w way index,rb}], ends:[point index of the end node of each edge]} with corners
   rounded so cars can follow it. s0 skips the first metres of the first edge. */
NP.pathPoints=function(des,s0){
  s0=s0||0; const raw=[], ends=[];
  // each edge adds its points except the last one, which is the first point of the next edge
  des.forEach((de,k)=>{
    const e=this.eOf(de), P=this.dePts(de), off=laneOffset(e.way), rb=e.way.rb?1:0;
    for(let j=0;j<P.length-1;j++){
      const [x0,y0]=P[j],[x1,y1]=P[j+1], L=Math.hypot(x1-x0,y1-y0); if(L<1e-6) continue;
      const n=Math.max(1,Math.ceil(L/2));
      for(let q=0;q<n;q++) raw.push({x:x0+(x1-x0)*q/n,y:y0+(y1-y0)*q/n,off,w:e.wi,rb,k});
    }
    ends.push(raw.length);
    if(k===des.length-1){ const l=P[P.length-1]; raw.push({x:l[0],y:l[1],off,w:e.wi,rb,k}); ends[k]=raw.length-1; }
  });
  // Slip roads join a motorway at its centreline in OSM. Keep the path on the slip road, then move into the
  // right lane over 80 m after joining, and back over the last 80 m before an exit, so it stays on the road.
  const RAMP=80, cum=[0]; for(let i=1;i<raw.length;i++) cum.push(cum[i-1]+Math.hypot(raw[i].x-raw[i-1].x,raw[i].y-raw[i-1].y));
  for(let k=0;k<des.length-1;k++){
    const a=this.way(des[k]), b=this.way(des[k+1]), node=ends[k]; if(node==null||node>=raw.length) continue;
    if(isLink(a)&&isFast(b)) for(let i=node;i<raw.length&&cum[i]-cum[node]<RAMP;i++) raw[i].off*=(cum[i]-cum[node])/RAMP;
    if(isFast(a)&&isLink(b)) for(let i=node;i>=0&&cum[node]-cum[i]<RAMP;i--) if(raw[i].k===k) raw[i].off*=(cum[node]-cum[i])/RAMP;
  }
  // trim the first s0 metres
  let start=0;
  if(s0>0){ let acc=0; for(let i=1;i<raw.length;i++){ acc+=Math.hypot(raw[i].x-raw[i-1].x,raw[i].y-raw[i-1].y); if(acc>=s0){ start=i; break; } start=i; } }
  const pts=raw.slice(start); const E2=ends.map(i=>Math.max(0,Math.min(pts.length-1,i-start)));
  const n=pts.length; if(n<2) return {pts,ends:E2};
  // smooth the lane offset, then offset to the right of the local tangent
  const off=pts.map((p,i)=>{ let a=0,c=0; for(let j=Math.max(0,i-3);j<=Math.min(n-1,i+3);j++){a+=pts[j].off;c++;} return a/c; });
  const P2=pts.map((p,i)=>{ const a=pts[Math.max(0,i-1)], b=pts[Math.min(n-1,i+1)], L=Math.hypot(b.x-a.x,b.y-a.y)||1, tx=(b.x-a.x)/L, ty=(b.y-a.y)/L; return {x:p.x-ty*off[i],y:p.y+tx*off[i],w:p.w,rb:p.rb}; });
  // Round each turn with a quadratic Bezier through the lane corner: from R metres before it to R after,
  // which cuts the corner by about a third of R and keeps the car in its own lane on both roads.
  const cur=P2;
  for(let k=0;k<des.length-1;k++){
    const ci=E2[k]; if(ci<=0||ci>=n-1) continue;
    const ang=angDiff(this.hOut(des[k+1]),this.hIn(des[k])); if(Math.abs(ang)<0.35) continue;
    const R=Math.abs(ang)<1.0?9:ang>0?5.5:7.5;
    let i0=ci,i1=ci,acc=0; while(i0>0&&acc<R){ acc+=Math.hypot(cur[i0].x-cur[i0-1].x,cur[i0].y-cur[i0-1].y); i0--; }
    acc=0; while(i1<n-1&&acc<R){ acc+=Math.hypot(cur[i1+1].x-cur[i1].x,cur[i1+1].y-cur[i1].y); i1++; }
    const A=cur[i0],C={x:cur[ci].x,y:cur[ci].y},B=cur[i1],m=i1-i0;
    for(let i=i0+1;i<i1;i++){ const t=(i-i0)/m,u=1-t; cur[i]={x:u*u*A.x+2*u*t*C.x+t*t*B.x,y:u*u*A.y+2*u*t*C.y+t*t*B.y,w:cur[i].w,rb:cur[i].rb}; }
  }
  // round any bend left tighter than about 6 m radius (sharp corners inside a way, for example on service roads)
  for(let pass=0;pass<6;pass++){
    const tight=new Uint8Array(n);
    for(let i=2;i<n-2;i++){ if(cur[i].rb) continue; const a=cur[i-2],b=cur[i],c=cur[i+2];
      const t=Math.abs(angDiff(hdg(c.x-b.x,c.y-b.y),hdg(b.x-a.x,b.y-a.y))), L=Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y);
      if(L>0&&t/(L/2)>1/6) for(let j=Math.max(1,i-3);j<=Math.min(n-2,i+3);j++) tight[j]=1; }
    if(!tight.some(Boolean)) break;
    const prev=cur.map(p=>({x:p.x,y:p.y}));
    for(let i=1;i<n-1;i++) if(tight[i]){ let x=0,y=0,c=0; for(let j=Math.max(0,i-2);j<=Math.min(n-1,i+2);j++){x+=prev[j].x;y+=prev[j].y;c++;} cur[i]={...cur[i],x:x/c,y:y/c}; }
  }
  // then one light pass to take out small kinks (roundabout entries and exits, offset changes)
  const sm=cur.map((p,i)=>{ if(i===0||i===n-1) return p; const a=cur[i-1],b=cur[i+1]; return {x:(a.x+2*p.x+b.x)/4,y:(a.y+2*p.y+b.y)/4,w:p.w,rb:p.rb}; });
  return {pts:sm,ends:E2};
};

/* ---------- junction control and route events ---------- */
/* give-way or stop sign on de that applies when arriving at node n */
NP.signOn=function(de,n){
  const l=this.fByEdge.get(de>>1); if(!l) return null;
  const fw=!(de&1), e=this.eOf(de);
  for(const f of l){
    if(f.t!=='give_way'&&f.t!=='stop') continue;
    if(fw?f.d!==1:f.d!==-1) continue;
    const toEnd=fw?e.len-f.s:f.s; if(toEnd<=40) return f.t;
  }
  return null;
};
/* who has priority when arriving on de at node n:
   signals | stop | give_way (signed) | yield (lower class road, sign assumed) | right (högerregeln) | major | unknown */
NP.control=function(de,n){
  if(this.lightNode.has(n)||this.lightAp.has(de)) return 'signals';
  const own=this.signOn(de,n); if(own) return own;
  const w=this.way(de), my=tier(w.hw), others=[];
  for(const d of this.inc[n]){
    if((d>>1)===(de>>1)) continue;
    const w2=this.way(d); if(w2.rb) continue;
    if(tier(w2.hw)<1) continue;           // leaving a car park or gårdsgata: they give way (utfartsregeln)
    if(this.signOn(d,n)) continue;        // they have a give-way or stop sign
    others.push(tier(w2.hw));
  }
  if(my<1) return others.length?'yield':'major';
  if(!others.length) return 'major';
  const mx=Math.max(...others);
  if(my<mx) return 'yield'; if(my>mx) return 'major';
  return my<=1?'right':'unknown';
};
NP.isExit=function(n,fromDe){ return this.out[n].some(d=>!this.rb(d)&&(d>>1)!==(fromDe>>1)); };
/* Events along a route. Positions are world points; `s` is the approximate distance from the
   start (edge lengths), `pi` the matching index in pathPoints().pts. */
NP.events=function(des,s0,ends){
  s0=s0||0; const ev=[]; let acc=-s0; let id=0;
  const push=(o,k)=>{ o.id=id++; o.pi=ends?ends[Math.max(0,k)]:null; ev.push(o); };
  for(let k=0;k<des.length;k++){
    const de=des[k], e=this.eOf(de), L=e.len, fw=!(de&1), sEnd=acc+L, n=this.to(de);
    for(const f of this.fByEdge.get(e.i)||[]){
      const fs=fw?f.s:L-f.s; if(acc+fs<0) continue;
      if(f.t==='zebra') { const p=this.pointAt(de,fs); push({t:'zebra',x:f.x,y:f.y,s:acc+fs,k,a:Math.atan2(p.ty,p.tx),half:e.half,lim:wayLimit(e.way)},k); }
      else if(f.t==='bus'&&(fw?f.side>=0:f.side<=0)) push({t:'bus',x:f.x,y:f.y,s:acc+fs,k,lim:wayLimit(e.way)},k);
    }
    const ap=this.lightAp.get(de);
    if(ap&&sEnd-ap.stop>0){ const p=this.pointAt(de,L-ap.stop); push({t:'light',cl:ap.cl,grp:ap.grp,x:p.x,y:p.y,s:sEnd-ap.stop,k},k); }
    if(k<des.length-1){
      const nx=des[k+1], N=this.nodes[n];
      if(!this.rb(de)&&this.rb(nx)){
        let j=k+1, s=sEnd, cnt=0; const passed=[];
        while(j<des.length&&this.rb(des[j])){
          s+=this.len(des[j]); const m=this.to(des[j]);
          if(j+1<des.length&&this.rb(des[j+1])&&this.isExit(m,des[j])){ cnt++; passed.push({node:m,s,idx:cnt,j}); }
          j++;
        }
        if(j<des.length){
          const exitDe=des[j], m=this.from(exitDe), d=angDiff(this.hOut(exitDe),this.hIn(de));
          const dir=Math.abs(d)>2.6?'back':d>0.6?'right':d<-0.6?'left':'straight';
          const nm=this.way(exitDe).n||this.way(exitDe).ref||'';
          push({t:'node',m:'rb',node:n,x:N.x,y:N.y,s:sEnd,k,n:cnt+1,dir,name:nm,ctrl:'rb',ring:!this.rbMulti(nx),oneLane:!e.way.ow&&e.way.ln<=2},k);
          for(const p of passed) push({t:'rbx',node:p.node,x:this.nodes[p.node].x,y:this.nodes[p.node].y,s:p.s,idx:p.idx,n:cnt+1},p.j);
          push({t:'rbout',node:m,x:this.nodes[m].x,y:this.nodes[m].y,s,n:cnt+1,k:j},j-1);
        }
      } else if(!this.rb(de)&&!this.rb(nx)&&isFast(e.way)&&isLink(this.way(nx))){
        // leaving a motorway: name the exit by its destination sign, else by the road it leads to
        let j=k+1; while(j<des.length-1&&isLink(this.way(des[j]))) j++;
        const lw=this.way(nx), nm=lw.ds||this.way(des[j]).n||this.way(des[j]).ref||'';
        push({t:'node',m:'exit',node:n,x:N.x,y:N.y,s:sEnd,k,dir:'exit',angle:angDiff(this.hOut(nx),this.hIn(de)),ctrl:'major',name:nm},k);
      } else if(!this.rb(de)&&!this.rb(nx)&&isLink(e.way)&&isFast(this.way(nx))&&!isFast(e.way)){
        const fw=this.way(nx);
        push({t:'node',m:'merge',node:n,x:N.x,y:N.y,s:sEnd,k,dir:'merge',angle:angDiff(this.hOut(nx),this.hIn(de)),ctrl:'merge',name:fw.n||(fw.ref?'road '+fw.ref:'')},k);
      } else if(!this.rb(de)&&!this.rb(nx)&&this.deg[n]>=3){
        const d=angDiff(this.hOut(nx),this.hIn(de)), dir=Math.abs(d)>2.6?'back':d>0.55?'right':d<-0.55?'left':'straight';
        let ctrl=this.control(de,n);
        // högerregeln only matters if a road actually joins from the right
        if(ctrl==='right'&&!this.inc[n].some(d=>{ if((d>>1)===(de>>1)||this.rb(d)||tier(this.way(d).hw)<1) return false; const a=angDiff(this.hIn(d),this.hIn(de)); return a>-2.4&&a<-0.7; })) ctrl='major';
        if(dir!=='straight'||['signals','right','yield','give_way','stop'].includes(ctrl)){
          const w2=this.way(nx), nm=(w2.n&&w2.n!==e.way.n)?w2.n:'';
          push({t:'node',m:'turn',node:n,x:N.x,y:N.y,s:sEnd,k,dir,angle:d,ctrl,name:nm,oneLane:!e.way.ow&&e.way.ln<=2,assumed:ctrl==='yield'&&!this.signOn(de,n)},k);
        }
      }
    }
    acc=sEnd;
  }
  return ev.sort((a,b)=>a.s-b.s);
};
NP.rbMulti=function(de){ return (this.way(de).ln||1)>1; };
NP.stats=function(des,s0){
  const ev=this.events(des,s0), st={len:0,rb:0,sig:0,right:0,yield:0,zebra:0,bus:0,left:0,rightTurn:0,repeat:0,back:0,mw:0};
  st.len=des.reduce((a,d)=>a+this.len(d),0)-(s0||0);
  const seenSig=new Set();
  for(const e of ev){
    if(e.t==='node'&&e.m==='rb') st.rb++;
    if(e.t==='light'&&!seenSig.has(e.cl)){ seenSig.add(e.cl); st.sig++; }
    if(e.t==='zebra') st.zebra++;
    if(e.t==='bus'&&e.lim<=50) st.bus++;
    if(e.t==='node'&&e.m==='turn'){ if(e.ctrl==='right') st.right++; if(e.ctrl==='yield'||e.ctrl==='give_way'||e.ctrl==='stop') st.yield++; if(e.dir==='left') st.left++; if(e.dir==='right') st.rightTurn++; if(e.dir==='back') st.back++; }
    if(e.t==='node'&&e.m==='rb'&&(e.dir==='back'||e.n>4)) st.back++;
    if(e.t==='node'&&e.m==='exit') st.mw++;
  }
  const seen=new Set(); des.forEach((d,i)=>{ if(seen.has(d>>1)) st.repeat++; seen.add(d>>1); if(i&&(d>>1)===(des[i-1]>>1)) st.back++; });
  return st;
};
/* both driving directions on the road nearest to (x,y): [{de, s}] */
NP.startOptions=function(x,y,maxD){
  const st=this.nearestDe(x,y,null,maxD||400); if(!st) return [];
  const e=this.eOf(st.de), o=[{de:2*e.i,s:this.fwd(st.de)?st.s:e.len-st.s}];
  if(!e.way.ow) o.push({de:2*e.i+1,s:e.len-o[0].s});
  return o;
};
/* best loop from the test centre over both starting directions */
NP.generateFrom=function(x,y,w,rnd,opts){
  let best=null;
  for(const o of this.startOptions(x,y)){ const r=this.generateRoute(o.de,o.s,w,rnd,opts); if(r&&(!best||r.score>best.score)) best=r; }
  return best;
};
/* Pick a loop from startDe back to its start node that scores well on the given weights.
   w: {rb, sig, right, yield, zebra, bus, turn}; opts: {minLen, maxLen, tries, avoid:Set of edges to share less} */
NP.generateRoute=function(startDe,s0,w,rnd,opts){
  opts=opts||{}; const minL=opts.minLen||2000, maxL=opts.maxLen||6000, tries=opts.tries||60;
  const S=this.nodes[this.from(startDe)], home=this.from(startDe);
  const cand=[]; this.nodes.forEach((n,i)=>{ if(this.deg[i]<3||this.out[i].some(d=>this.rb(d))) return; const d=Math.hypot(n.x-S.x,n.y-S.y); if(d>minL*0.12&&d<maxL*0.4) cand.push(i); });
  if(cand.length<2) return null;
  let best=null;
  for(let t=0;t<tries;t++){
    const a=cand[Math.floor(rnd()*cand.length)], b=cand[Math.floor(rnd()*cand.length)]; if(a===b) continue;
    const de=this.routeVia(startDe,[a,b,home]); if(!de) continue;
    const st=this.stats(de,s0); if(st.len<minL||st.len>maxL) continue;
    const m=v=>Math.min(v,4);   // a few of each counts; twenty of one kind does not make a better route
    let sc=(w.rb||0)*m(st.rb)+(w.sig||0)*m(st.sig)+(w.right||0)*m(st.right)+(w.yield||0)*m(st.yield)+(w.zebra||0)*m(st.zebra)+(w.bus||0)*m(st.bus)+(w.turn||0)*m(st.left+st.rightTurn);
    sc+=5*[st.rb,st.sig,st.right,st.zebra,st.bus].filter(x=>x>0).length;
    sc-=3*st.repeat+40*st.back;
    if(opts.avoid&&opts.avoid.size){ const sh=de.filter(d=>opts.avoid.has(d>>1)).length/de.length; sc-=20*sh+(sh>0.85?60:0); }
    if(!best||sc>best.score) best={de,s0,score:sc,stats:st};
  }
  return best;
};

/* ---------- traffic lights ----------
   Signal nodes are clustered in the preprocessor. Here each cluster gets its approaches (directed edges
   arriving at a node inside the cluster from outside it), a stop-line distance from the edge end, and a
   phase group by approach direction, so crossing directions alternate. */
const LR=30;
NP.buildLights=function(){
  this.lights=(this.L.lights||[]).map((c,i)=>({x:c.x,y:c.y,i,ngrp:1,off:(i*7.3)%36}));
  this.lightAp=new Map(); this.lightNode=new Set();
  for(const C of this.lights){
    const inside=new Set(); this.nodes.forEach((n,i)=>{ if(this.deg[i]&&Math.hypot(n.x-C.x,n.y-C.y)<LR) inside.add(i); });
    for(const n of inside) this.lightNode.add(n);
    let axis=null;
    for(const n of inside) for(const de of this.inc[n]){
      const e=this.eOf(de), fw=!(de&1), L=e.len;
      const sigs=(this.fByEdge.get(e.i)||[]).filter(f=>f.t==='sig').map(f=>fw?f.s:L-f.s).filter(s=>L-s<40&&L-s>2);
      if(inside.has(this.from(de))&&!sigs.length) continue;
      const stop=sigs.length?Math.max(1,L-Math.max(...sigs)+1):Math.min(Math.max(1,L-1),8);
      const h=this.hIn(de); if(axis==null) axis=h;
      const grp=Math.abs(Math.cos(angDiff(h,axis)))>0.7?0:1; if(grp) C.ngrp=2;
      this.lightAp.set(de,{cl:C.i,grp,stop});
    }
  }
};
/* {st:'G'|'Y'|'R', t: seconds since this state began} */
NP.lightState=function(cl,grp,t){
  const C=this.lights[cl]; if(!C) return {st:'G',t:99};
  if(C.ngrp>1){ const u=(((t+C.off-grp*18)%36)+36)%36; return u<14?{st:'G',t:u}:u<17?{st:'Y',t:u-14}:{st:'R',t:u-17}; }
  const u=(((t+C.off)%34)+34)%34; return u<20?{st:'G',t:u}:u<23?{st:'Y',t:u-20}:{st:'R',t:u-23};
};

globalThis.FDL_OSM={projector,simplify,tier,isLink,isFast,defaultLimit,wayLimit,laneOffset,rng,angDiff,hdg,Net,Heap};
})();
