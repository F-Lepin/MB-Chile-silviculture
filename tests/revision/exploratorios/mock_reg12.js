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
const ids=[]; for(const e of [8,9]) for(let y=1996;y<=1999;y++) ids.push({type:'IMAGE', id:`p/silvo_e${e}_${y}_v1`});
ids.push({type:'IMAGE', id:'p/silvo_e8_2000_v1'});
function mk(extra){ const f=function(){}; return new Proxy(f,{get:(t,k)=>{ if(extra&&k in extra) return extra[k]; if(k==='then') return undefined; if(k==='evaluate') return (cb)=>cb([{region:8,sum:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]},{region:9,sum:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]},{region:0,sum:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]}]); if(k==='bandNames') return ()=>({getInfo:()=>['classification_1996','classification_1997','classification_1998']}); return mk(); }, apply:()=>mk(), construct:()=>mk()}); }
global.ee=new Proxy({}, {get:(t,k)=>{ if(k==='ImageCollection') return global.__IC; if(k==='data') return {listAssets:()=>({assets:ids}), getAsset:()=>({type:'IMAGE_COLLECTION'})}; if(k==='Reducer') return {sum:()=>({repeat:()=>({group:()=>1})}), first:()=>1}; if(k==='Image'){ const I=function(){return mk();}; I.pixelArea=()=>mk(); I.cat=()=>mk(); I.constant=()=>mk(); return I;} if(k==='Geometry') return {Point:()=>mk()}; if(k==='Feature') return ()=>mk(); return mk(); }});
global.__IC=function(a){ return mk({getInfo:()=>({features:[{id:'f/burned_a_1998',bands:[{id:'burned_area'}],properties:{year:1998,region:1}},{id:'f/burned_b_1998',bands:[{id:'burned_area'}],properties:{year:1998,region:2}},{id:'f/x_1999',bands:[{id:'burned_area'}],properties:{year:1999}}]})}); }; global.ee.FeatureCollection=function(){return mk();};
global.Map={setOptions(){}, layers:()=>({add(){}}), setCenter(){}, onClick(f){global.__click=f;}};
global.Export={table:{toDrive:(o)=>log.push('export '+o.description)}};
global.print=(...a)=>console.log('PRINT',...a);
const test=`
verSelect.setValue('v1',false); llenarAños();
fuegoCheck.setValue(true,false);
regSelect.setValue('TOTAL'); desdeSelect.setValue('1997'); hastaSelect.setValue('1999');
actualizarMapa();
calcularSerie();
yearSelect.setValue('1998',false); dibujar(); console.log('FUEGO', JSON.stringify(FUEGO.porAño), FUEGO.ok); console.log('estado:', estado.getValue(), Object.keys(RES));
`;
eval(src+test); console.log(log.slice(-6).join(' | '));
