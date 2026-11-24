const fs=require('fs');
const src=fs.readFileSync(require('path').join(__dirname,'..','..','..','04_revision_tendencias','codigo_revisar_silvicultura_regiones.js'),'utf8');
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
const reglas=[{type:'IMAGE_COLLECTION',id:`${REG}/E8`},{type:'IMAGE_COLLECTION',id:`${REG}/E9`}];
const sub=[{type:'IMAGE',id:`${REG}/sub/integ_e9_1998_reglas`}];
let valores={'0':100,'79':10,'80':5,'83':2};
function img(id){ return new Proxy(function(){},{get:(t,k)=>{
  if(k==='then') return undefined; if(k==='__id') return id;
  if(k==='bandNames') return ()=>({getInfo:()=>/hmm_e8$/.test(id)?['classification_1996','classification_1997','classification_1998']:['classification']});
  if(k==='geometry') return ()=>img('geom');
  if(k==='select') return (b)=>{ calls.push('select '+id.split('/').pop()+' '+JSON.stringify(b)); return img(id); };
  if(k==='remap') return (a,b,c)=>{ calls.push('remap '+JSON.stringify(a)+'->'+JSON.stringify(b)+' def '+c); return img(id); };
  if(k==='reduceRegion') return ()=>({getInfo:()=>({classification:valores})});
  return ()=>img(id); }, apply:()=>img(id)}); }
function mk(extra){ const f=function(){}; return new Proxy(f,{get:(t,k)=>{ if(extra&&k in extra) return extra[k]; if(k==='then') return undefined; if(k==='evaluate') return (cb)=>cb([]); if(k==='getInfo') return ()=>[]; return mk(); }, apply:()=>mk(), construct:()=>mk()}); }
global.ee=new Proxy({}, {get:(t,k)=>{
  if(k==='data') return {listAssets:(p)=>{ if(p===SIL) return {assets:silv}; if(p===REG) return {assets:reglas}; if(p===`${REG}/sub`) return {assets:sub}; throw new Error('not a folder: '+p); }};
  if(k==='ImageCollection') return function(a){ if(typeof a==='string' && /\/E[89]$/.test(a)) return {aggregate_array:()=>({getInfo:()=>['1997','1998']})}; if(a===HMM) return {aggregate_array:()=>({getInfo:()=>['hmm_e8','hmm_e9_1997']})}; return mk(); };
  if(k==='Image'){ const I=function(id){return img(String(id));}; I.pixelArea=()=>mk(); I.cat=()=>mk(); I.constant=()=>mk(); return I;}
  if(k==='Reducer') return {sum:()=>({repeat:()=>({group:()=>1})}), first:()=>1, frequencyHistogram:()=>1};
  return mk(); }});
global.Map={setOptions(){}, layers:()=>({add(){}}), setCenter(){}, onClick(f){}};
global.Export={table:{toDrive:()=>{}}};
const out=[]; global.print=(...a)=>out.push(a.join(' '));
const test=`
console.log(JSON.stringify(añosDeVersion('int_reglas')), JSON.stringify(ecosConVersion('int_reglas')), CAT[9].int_reglas[1998].id);
FUENTES_EXTRA.push({id:'int_x',etiqueta:'X',raiz:'projects/x/vacia'}); catalogarFuente(FUENTES_EXTRA[2]);
console.log(out.slice(-2).join('\\n'));
`;
eval(fs.readFileSync(require('path').join(__dirname,'..','..','..','04_revision_tendencias','codigo_revisar_silvicultura_regiones.js'),'utf8')+test);
