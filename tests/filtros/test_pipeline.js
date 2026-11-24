const fs=require('fs');
class I{constructor(v){this.v=v}
 _b(o,f){const a=this.v,b=(o instanceof I)?o.v:o; return new I(a===null||b===null?null:f(a,b));}
 eq(o){return this._b(o,(a,b)=>+(a===b))} neq(o){return this._b(o,(a,b)=>+(a!==b))}
 gt(o){return this._b(o,(a,b)=>+(a>b))} gte(o){return this._b(o,(a,b)=>+(a>=b))}
 lt(o){return this._b(o,(a,b)=>+(a<b))} lte(o){return this._b(o,(a,b)=>+(a<=b))}
 and(o){return this._b(o,(a,b)=>+(!!a&&!!b))} or(o){return this._b(o,(a,b)=>+(!!a||!!b))}
 not(){return new I(this.v===null?null:+!this.v)}
 add(o){return this._b(o,(a,b)=>a+b)} subtract(o){return this._b(o,(a,b)=>a-b)} multiply(o){return this._b(o,(a,b)=>a*b)}
 unmask(d){ if(this.v!==null) return this; return d instanceof I? new I(d.v) : new I(d===undefined?0:d); }
 where(t,x){const tv=t.v, xv=(x instanceof I)?x.v:x; if(tv===null) return new I(this.v); return new I(tv?xv:this.v)}
}
global.ee={Image:(v)=>new I(v)};
const src=fs.readFileSync(require('path').join(__dirname,'..','..','03_filtros','codigo_pipeline_filtros_silvicultura.js'),'utf8');
const nuc=src.slice(src.indexOf('//<<NUCLEO'),src.indexOf('//NUCLEO>>'));
let FQ={}; global.fuegoAño=(y)=>FQ[y]===undefined?null:new I(FQ[y]);
eval(nuc+';global.s4Temporal=s4Temporal;global.s2Fuego=s2Fuego;global.s1Relleno=s1Relleno;');

const P0={maxTramos:6,ventanaPost:5,ultimoAñoConfiable:2025,corteOtras:5};
// ---------- implementación de referencia (imperativa, por píxel) ----------
function ref(c,vp,ve,años,P){
 const n=c.length,M=P.maxTramos,W=P.ventanaPost,ULT=P.ultimoAñoConfiable;
 const cc=c.map(x=>x===null?0:x), S=cc.map(x=>x===1||x===2);
 const sIdx=[]; cc.forEach((x,k)=>{if(S[k])sIdx.push(k)});
 const tid=Array(n).fill(0); let t=0;
 sIdx.forEach((k,i)=>{ if(i>0){ const gap=[]; for(let q=sIdx[i-1]+1;q<k;q++)gap.push(cc[q]);
   const hasC=gap.includes(4); let run=0,maxRun=0; gap.forEach(x=>{ if(x===3){run++;maxRun=Math.max(maxRun,run);} else if(x!==0) run=0; });
   if(hasC||maxRun>=P.corteOtras) t=Math.min(t+1,M-1); } tid[k]=t; });
 const SP=Array(M).fill(0),SE=Array(M).fill(0);
 for(let k=0;k<n;k++){ SP[tid[k]]+=vp[k]; SE[tid[k]]+=ve[k]; }   // vp/ve son 0 fuera de silvo
 let bestJ=0,best=-1; for(let j=0;j<=M;j++){ let sc=0; for(let q=0;q<M;q++) sc+= q<j?SP[q]:SE[q]; if(sc>=best){best=sc;bestJ=j;} }
 const esp=tid.map(x=>x<bestJ?1:2);
 const out=c.map((x,k)=>S[k]?esp[k]:x);
 for(let k=0;k<n;k++){
  if(S[k]||!(cc[k]===3||cc[k]===4)) continue;
  let ls=-1; for(let q=k-1;q>=0;q--) if(S[q]){ls=q;break;}
  let t0=0; for(let q=ls+1;q<=k;q++) if(cc[q]===4&&(q===0?true:cc[q-1]!==4)&&!(q===0&&false)) t0=años[q];
  // ini en q=0: prevC=false -> es inicio
  if(!(t0>0&&t0<años[k])) continue;
  let nY=0,nSp=0; for(let q=k+1;q<n;q++) if(S[q]&&años[q]<=ULT){nY=años[q];nSp=esp[q];break;}
  const enV=nY>0&&nY-t0<=W, suf=ULT-t0>=W, prevSp=ls>=0?esp[ls]:0;
  if(enV) out[k]=nSp; else if(suf){ if(cc[k]===4) out[k]=3; } else if(prevSp>0) out[k]=prevSp;
 }
 return out;
}
const mapC={P:1,E:2,O:3,C:4,'?':null};
function run(c,vp,ve,años){ const r=s4Temporal(c.map(x=>new I(x)),vp.map(x=>new I(x)),ve.map(x=>new I(x)),años,P0).map(i=>i.v); return r; }
const show=(a)=>a.map(x=>x===null?'?':'PEOC'[x===1?0:x===2?1:x===3?2:3]).join(' ');
function ejemplo(nombre,seq,desde,esperado,vopt){
  const c=seq.split(' ').map(x=>mapC[x]); const años=c.map((_,i)=>desde+i);
  const vp=c.map((x,i)=>x===null?0:(vopt&&vopt[i]!==undefined)?vopt[i][0]:(x===1?80:x===2?30:0)), ve=c.map((x,i)=>x===null?0:(vopt&&vopt[i]!==undefined)?vopt[i][1]:(x===2?80:x===1?30:0));
  const vp2=vp.map((v,i)=>(c[i]===1||c[i]===2)?v:0), ve2=ve.map((v,i)=>(c[i]===1||c[i]===2)?v:0);
  const o=show(run(c,vp2,ve2,años)), r=show(ref(c,vp2,ve2,años,P0));
  console.log((o===esperado&&r===esperado?'OK   ':'FALLA')+' '+nombre+': '+seq+' -> '+o+(o===esperado?'':'  (esperado '+esperado+', ref '+r+')'));
}
ejemplo('1 oscila sin cosecha','P P E P P P',2000,'P P P P P P',[[80,20],[80,20],[30,70],[80,20],[80,20],[80,20]]);
ejemplo('2 cambio con cosecha','P P P C E E',2000,'P P P C E E');
ejemplo('3a euca->pino: gana euca','E E C P P P',2000,'E E C E E E',[[10,90],[10,90],,[70,30],[70,30],[70,30]]);
ejemplo('3b euca->pino: gana pino','E E C P P P',2000,'P P C P P P',[[30,60],[30,60],,[90,10],[90,10],[90,10]]);
ejemplo('4 cosecha larga + silvo','P P C C C P',2000,'P P C P P P');
ejemplo('5 cosecha sin silvo en 5 años','P P C C C C C C',2000,'P P C O O O O O');
ejemplo('6 cosecha reciente (2022)','P P C C O O O',2020,'P P C P P P P');
ejemplo('7 cinco otras entre especies','P P O O O O O E E',2000,'P P O O O O O E E');
ejemplo('8 cuatro otras: mismo tramo','P P O O O O E E',2000,'P P O O O O P P',[[80,20],[80,20],,,,, [30,70],[30,70]].map((x,i)=>x));
ejemplo('9 cosecha + otras + silvo en ventana','P C O O P P',2000,'P C P P P P');
ejemplo('10 cosecha, silvo a los 6 años','P C O O O O O E',2000,'P C O O O O O E');
// ---------- fuzz ----------
function rnd(n){return Math.floor(Math.random()*n)}
let bad=0,N=30000;
for(let it=0;it<N;it++){
  const n=31, años=Array.from({length:n},(_,i)=>1996+i);
  const stay=0.6+Math.random()*0.35; let cur=rnd(4)+1; const c=[];
  for(let k=0;k<n;k++){ if(Math.random()>stay) cur=rnd(4)+1; c.push(Math.random()<0.04?null:cur); }
  const vp=c.map(x=>(x===1||x===2)?rnd(101):0), ve=c.map(x=>(x===1||x===2)?rnd(101):0);
  const o=run(c,vp,ve,años), r=ref(c,vp,ve,años,P0);
  if(JSON.stringify(o)!==JSON.stringify(r)){ if(bad<4) console.log('DIFERENCIA\n c  ',show(c),'\n img',show(o),'\n ref',show(r)); bad++; }
}
console.log('fuzz S4:',N-bad,'/',N,'iguales a la referencia');
// invariantes: nunca euca->pino entre años de silvo; cosechado nunca pasa a otras al inicio...
let inv=0; for(let it=0;it<N;it++){ const n=31, años=Array.from({length:n},(_,i)=>1996+i); let cur=rnd(4)+1; const c=[];
  for(let k=0;k<n;k++){ if(Math.random()>0.8) cur=rnd(4)+1; c.push(cur);} const vp=c.map(x=>(x===1||x===2)?rnd(101):0), ve=c.map(x=>(x===1||x===2)?rnd(101):0);
  const o=run(c,vp,ve,años); let seenE=false, ok=true; o.forEach(x=>{ if(x===2) seenE=true; if(x===1&&seenE) ok=false; });
  // en la salida puede haber P tras E solo por relleno post-cosecha... se cuenta
  if(!ok) inv++; }
console.log('series con pino después de euca en la salida:',inv,'de',N);
// ---------- S2 ----------
function s2(cls,burn,all,desfase,años){ FQ={}; all.forEach(y=>FQ[y]=0); burn.forEach(y=>FQ[y]=1);
  const r=s2Fuego(cls.map(x=>new I(x)),años,desfase,5); return {o:r.cs.map(i=>i.v), corr:r.corr.map(i=>i.v)}; }
const Y10=Array.from({length:10},(_,i)=>2000+i), pad=(a)=>a.concat(Array(10-a.length).fill(3));
function t2(nombre,cls,burn,des,esp){ const r=s2(cls,burn,Y10,des,Y10); const ok=JSON.stringify(r.o)===JSON.stringify(esp); console.log((ok?'OK   ':'FALLA')+' S2 '+nombre+' -> '+show(r.o)+(ok?'':' esperado '+show(esp))); }
t2('incendio mismo año',pad([1,1,4,4]),[2002],1,pad([1,1,1,1]));
t2('otras de ruido antes',pad([1,3,4,4]),[2002],1,pad([1,3,1,1]));
t2('cosecha real',pad([2,2,4,4,2,2]),[],1,pad([2,2,4,4,2,2]));
t2('sin pino/euca previo',pad([3,3,4,4]),[2002],1,pad([3,3,4,4]));
t2('incendio dentro del tramo',pad([1,1,4,4,4]),[2003],0,pad([1,1,4,4,4]));
// ---------- S1 ----------
function t1(nombre,seq,esp,maxD=3){ const arr=seq.map(x=>new I(x)); const o=s1Relleno(arr,maxD).map(i=>i.v); const ok=JSON.stringify(o)===JSON.stringify(esp); console.log((ok?'OK   ':'FALLA')+' S1 '+nombre+' -> '+JSON.stringify(o)+(ok?'':' esperado '+JSON.stringify(esp))); }
t1('1996 con posteriores',[null,null,1,1,1],[1,1,1,1,1]);
t1('2026 con anteriores',[1,1,1,null,null],[1,1,1,1,1]);
t1('hueco de 2 entre clases distintas',[1,null,null,2],[1,1,2,2]);
t1('más de 3 años no se rellena',[1,null,null,null,null,null,2],[1,1,1,1,2,2,2]);
