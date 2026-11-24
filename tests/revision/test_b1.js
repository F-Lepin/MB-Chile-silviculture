const fs=require('fs');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','04_revision_tendencias','codigo_revisar_silvicultura_regiones.js'),'utf8');
const log=[];
function widget(o){ const w={_o:o||{}, _v:o&&o.value, _items:[], _kids:[], _h:{}};
  w.setValue=(v,t)=>{w._v=v; if(t!==false&&w._h.change) w._h.change(v);};
  w.getValue=()=>w._v; w.setLabel=()=>{}; w.setDisabled=()=>{}; w.add=(c)=>{w._kids.push(c);}; w.clear=()=>{w._kids=[];};
  w.onChange=(f)=>{w._h.change=f;}; w.onClick=(f)=>{w._h.click=f;}; w.setName=()=>{}; w.setEeObject=()=>{};
  w.items=()=>({length:()=>w._items.length, reset:(a)=>{w._items=a.slice();}, getJsArray:()=>w._items.slice()});
  w.style=()=>({set:()=>{}});
  return w; }
global.ui={Label:(t)=>widget({text:t}), Select:(o)=>{const w=widget(o); w._items=(o.items||[]).slice(); return w;}, Button:(o)=>widget(o), Textbox:(o)=>widget(o), Checkbox:(o)=>widget(o), Panel:(c)=>widget(),
  Map:{Layer:(...a)=>widget()}, root:{insert:()=>{}}, Chart:function(t,type,o){log.push('chart '+type+' cols='+t.cols.map(c=>c.label+':'+c.type).join(',')+' filas='+t.rows.length); return {};}};
ui.Panel.Layout={flow:()=>null};
const SIL='projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';
const REG='projects/mapbiomas-chile/assets/LULC/COLLECTION-03/INTEGRATION/V1/reglas';
const HMM='projects/mapbiomas-chile/assets/LULC/COLLECTION-03/INTEGRATION/V1/hmm';
const calls=[];
const silv=[]; for(const e of [8,9]) for(let y=1996;y<=1999;y++) silv.push({type:'IMAGE', id:`${SIL}/silvo_e${e}_${y}_v1`});
const E=n=>String(n).padStart(2,'0'); const reglas=[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(n=>({type:'IMAGE',id:`${REG}/reglas_e${E(n)}_v1_final`}));
const sub=[]; const hmmIds=[1,2,4,5,6,7,9,10,11,12].map(n=>({type:'IMAGE',id:`${HMM}/hmm_e${E(n)}_v1_final`}));
let valores={'0':100,'79':10,'80':5,'83':2};
function img(id){ return new Proxy(function(){},{get:(t,k)=>{
  if(k==='then') return undefined; if(k==='__id') return id;
  if(k==='bandNames') return ()=>({getInfo:()=>Array.from({length:30},(_, i)=>'b'+(i+1))});
  if(k==='geometry') return ()=>img('geom');
  if(k==='select') return (b)=>{ calls.push('select '+id.split('/').pop()+' '+JSON.stringify(b)); return img(id); };
  if(k==='remap') return (a,b,c)=>{ calls.push('remap '+JSON.stringify(a)+'->'+JSON.stringify(b)+' def '+c); return img(id); };
  if(k==='reduceRegion') return ()=>({getInfo:()=>({classification:valores})});
  return ()=>img(id); }, apply:()=>img(id)}); }
function mk(extra){ const f=function(){}; return new Proxy(f,{get:(t,k)=>{ if(extra&&k in extra) return extra[k]; if(k==='then') return undefined; if(k==='evaluate') return (cb)=>cb([]); if(k==='getInfo') return ()=>[]; return mk(); }, apply:()=>mk(), construct:()=>mk()}); }
global.ee=new Proxy({}, {get:(t,k)=>{
  if(k==='data') return {listAssets:(p)=>{ if(p===SIL) return {assets:silv}; if(p===REG) return {assets:reglas}; if(p===HMM) return {assets:hmmIds}; throw new Error('not a folder: '+p); }};
  if(k==='ImageCollection') return function(a){ if(a===HMM) return {aggregate_array:()=>({getInfo:()=>['hmm_e8','hmm_e9_1997']})}; return mk(); };
  if(k==='Image'){ const I=function(id){return img(String(id));}; I.pixelArea=()=>mk(); I.cat=()=>mk(); I.constant=()=>mk(); return I;}
  if(k==='Reducer') return {sum:()=>({repeat:()=>({group:()=>1})}), first:()=>1, frequencyHistogram:()=>1};
  return mk(); }});
global.Map={setOptions(){}, layers:()=>({add(){}}), setCenter(){}, onClick(f){}};
global.Export={table:{toDrive:()=>{}}};
const out=[]; global.print=(...a)=>out.push(a.join(' '));
const test=`
const T=(c,m)=>console.log((c?'ok   ':'FALLA')+' '+m);
T(JSON.stringify(ecosConVersion('int_hmm'))==='[1,2,4,5,6,7,9,10,11,12]','hmm: ecos '+JSON.stringify(ecosConVersion('int_hmm')));

T(añosDeVersion('int_hmm')[0]===1996 && añosDeVersion('int_hmm').slice(-1)[0]===2025 && añosDeVersion('int_hmm').length===30,'años hmm 1996–2025'); T(CAT[8].int_reglas[2025].banda==='b30' && CAT[8].int_reglas[1996].banda==='b1','b1→1996, b30→2025'); T(ecosConVersion('int_reglas').length===14,'reglas: 14 ecos');
console.log(out.filter(l=>/reglas|HMM/.test(l)).join('\\n').slice(0,600));
`;
eval(fs.readFileSync(require('path').join(__dirname,'..','..','04_revision_tendencias','codigo_revisar_silvicultura_regiones.js'),'utf8')+test);
