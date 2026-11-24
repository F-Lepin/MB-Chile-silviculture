const fs=require('fs'); const log=[]; let fails=0;
function ok(c,m){ if(!c){fails++; console.log('FALLA',m);} else console.log('ok   ',m); }
function mk(extra){ const f=function(){}; return new Proxy(f,{get:(t,k)=>{ if(extra&&k in extra) return extra[k]; if(k==='then') return undefined; if(k===Symbol.toPrimitive) return ()=>1;
  if(k==='evaluate') return (cb)=>{ cb(new Proxy({}, {get:(t,k)=>typeof k==='string'?(/^p_/.test(k)?9:(/^c\d_/.test(k)?((+k.slice(3,7))%5):3)):undefined}), null); };
  if(k==='getInfo') return ()=>({features:[]}); return mk(); }, apply:()=>mk(), construct:()=>mk() }); }
const assets=[]; for(let y=1996;y<=2026;y++) if(y!==2003) assets.push({id:`p/silvo_e8_${y}_v4`,type:'IMAGE'});
for(let y=2000;y<=2005;y++) assets.push({id:`p/silvo_e8_${y}_v5`,type:'IMAGE'});
for(let y=1996;y<=2026;y++) assets.push({id:`p/silvo_e9_${y}_v4`,type:'IMAGE'});
assets.push({id:'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA/silvo_filtrado_e8_v4_f1',type:'IMAGE'});
let fuegoOK=!process.env.NOFUEGO;
const IC=function(a){ return mk({getInfo:()=>{ if(!fuegoOK) throw new Error('no existe'); return {features:[{id:'f/b_1998',bands:[{id:'burned_area'}],properties:{year:1998}},{id:'f/b_2017',bands:[{id:'burned_area'}],properties:{year:2017}}]}; }}); };
global.ee=new Proxy({}, {get:(t,k)=>{ if(k==='data') return {listAssets:()=>({assets})}; if(k==='ImageCollection') return IC;
  if(k==='Image'){ const I=function(){return mk();}; I.pixelArea=()=>mk(); I.cat=()=>mk(); I.constant=()=>mk(); return I;}
  if(k==='Reducer') return {sum:()=>mk(), first:()=>mk()}; if(k==='Geometry') return {Rectangle:()=>mk(), Point:()=>mk()}; return mk(); }});
// ---- widgets simulados
const W=[]; 
class Wd{ constructor(kind,o){ this.kind=kind; this.o=o||{}; this.v=this.o.value; this.st=Object.assign({},this.o.style); this.h=this.o.onChange?[this.o.onChange]:[]; this.kids=[]; W.push(this); }
 onChange(f){ this.h.push(f); } onClick(f){ this.clk=f; } getValue(){ return this.v===undefined?'':this.v; }
 setValue(v,tr){ this.v=v; if(this.kind==='Label') this.txt=v; if(tr!==false) this.h.forEach(f=>f(v)); }
 style(){ return {set:(k,v)=>{this.st[k]=v;}}; } setDisabled(){}
 add(x){ this.kids.push(x); } clear(){ this.kids=[]; }
 items(){ return {reset:(l)=>{ this.o.items=l; }}; } }
global.ui={Panel:Object.assign(function(items,l){ const w=new Wd('Panel',{}); if(Array.isArray(items)) w.kids=items.slice(); return w; },{Layout:{flow:()=>1}}),
 Label:function(t,s){ const w=new Wd('Label',{style:s}); w.txt=t; return w; },
 Select:function(o){ return new Wd('Select',o); }, Textbox:function(o){ return new Wd('Textbox',o); },
 Checkbox:function(o){ return new Wd('Checkbox',o); }, Button:function(o){ return new Wd('Button',o); },
 Chart:function(t,ty,o){ const w=new Wd('Chart',{type:ty,opts:o}); w.table=t; return w; }, root:{insert:()=>{}}};
let clickH=null; const layers=[];
global.Map={setOptions(){}, centerObject(){}, addLayer(img,v,name,shown){layers.push(name+(shown===false?' (oculta)':''));},
 layers(){ return {reset(){ layers.length=0; }}; }, getBounds(){ return [-72.6,-37.4,-72.2,-37.1]; }, onClick(f){ clickH=f; }};
const exp=[]; global.Export={image:{toAsset:(o)=>exp.push(o.description+' @'+o.scale)}};
const out=[]; global.print=(...a)=>out.push(a.join(' '));
global.eval0=eval;
let src=fs.readFileSync(require('path').join(__dirname,'..','..','03_filtros','codigo_pipeline_filtros_silvicultura.js'),'utf8');
try { (0,eval)(src); } catch(e){ console.log('EXC al ejecutar',e.stack); process.exit(1); }
const by=(kind,f)=>W.filter(w=>w.kind===kind&&f(w));
const btn=l=>by('Button',w=>w.o.label===l)[0];
const sel=f=>by('Select',f)[0];
const status=()=>W.filter(w=>w.kind==='Label'&&w.st.whiteSpace==='pre-wrap'&&w.st.margin==='4px 0')[0].txt;
ok(/Listo · E8 · v4 · pasos activos: S1 S2 S3 S4 S5/.test(status()), 'arranque aplica E8 v4: '+status().split('\n')[0]);
ok(layers.length>=2, 'capas al inicio: '+layers.join(' | '));
const selEco=sel(w=>(w.o.items||[]).some(i=>i.value==='9')), selVer=sel(w=>(w.o.items||[]).some(i=>/^v4/.test(i.value))), selAño=sel(w=>(w.o.items||[]).includes&&(w.o.items||[]).includes('2017')), selEt=sel(w=>(w.o.items||[]).some(i=>i.value==='dU'));
ok(selEco.o.items.length===2, 'ecorregiones desde catálogo: '+selEco.o.items.map(i=>i.label));
ok(selVer.o.items.map(i=>i.label).join()==='v4 · 30 años,v5 · 6 años', 'versiones con nº de años: '+selVer.o.items.map(i=>i.label));
// navegación
btn('▶').clk(); ok(selAño.v==='2018' && layers.some(l=>l.includes('2018')), 'año ▶ → 2018');
btn('◀').clk(); btn('◀').clk(); ok(selAño.v==='2016','año ◀◀ → 2016');
selAño.setValue('1996'); btn('◀').clk(); ok(selAño.v==='1996','◀ en el primer año no pasa');
// etapas
selAño.setValue('2017');
selEt.o.items.forEach(e=>{ selEt.setValue(e.value); ok(layers.length>=2||e.value==='c0', 'etapa '+e.value+' → '+layers[layers.length-1]); });
selEt.setValue('fuego'); ok(layers.some(l=>/Fuego/.test(l)),'capa fuego');
selEt.setValue('c0'); ok(layers.filter(l=>/entrada/.test(l)).length===1 && !/oculta/.test(layers.find(l=>/entrada/.test(l))),'entrada visible cuando es la etapa elegida');
selEt.setValue('c3');
// parámetros inválidos y sucio
const cajas=by('Textbox',w=>true);
cajas[0].setValue('x'); ok(/modificados/.test(status()),'cambio de parámetro marca pendiente');
btn('Aplicar').clk(); ok(/entero entre 1 y 10/.test(status()),'valida entero: '+status());
cajas[0].setValue('2');
btn('Aplicar').clk(); ok(/Listo/.test(status()),'aplica con 2 años de relleno');
cajas[3].setValue('300'); btn('Aplicar').clk(); ok(/entre 1 y 256/.test(status()),'umbral >256 rechazado: '+status());
cajas[3].setValue('22');
// desactivar pasos
const chk=by('Checkbox',w=>/^S\d/.test(w.o.label||''));
chk[1].setValue(false); btn('Aplicar').clk(); ok(/pasos activos: S1 S3 S4 S5/.test(status()),'S2 desactivado: '+status().split('\n')[0]);
chk[1].setValue(true); btn('Aplicar').clk();
// fuego caído
fuegoOK=false; global.FUEGO_RESET=1; 
// ROI
btn('Usar vista actual del mapa').clk(); ok(layers.some(l=>/Región de trabajo/.test(l)),'ROI dibuja recuadro');
// estadísticas
btn('Calcular').clk(); const ch1=W.filter(w=>w.kind==='Chart'); ok(ch1.length===1&&ch1[0].o.type==='ColumnChart'&&ch1[0].table.rows.length===31&&ch1[0].table.cols.length===6,'gráfico pasos 31×5');
sel(w=>(w.o.items||[]).some(i=>i.value==='clases')).setValue('clases'); btn('Calcular').clk();
const ch2=W.filter(w=>w.kind==='Chart'); const l2=ch2[ch2.length-1]; ok(l2.o.type==='LineChart'&&l2.table.cols.length===7,'gráfico clases 6 series');
ok(out.some(l=>/ha por clase/.test(l)),'tabla impresa en consola');
// exportar
btn('Exportar ecorregión (o región de trabajo)').clk(); ok(exp.length===1&&/_prueba @30/.test(exp[0]),'export con ROI → '+exp[0]);
by('Textbox',w=>w.o.value==='v4_f1')[0].setValue('v4_f1'); 
btn('Usar vista actual del mapa'); const bE=btn('Ecorregión completa'); bE.clk();
btn('Exportar ecorregión (o región de trabajo)').clk(); ok(/YA EXISTE|Ya existe/i.test(status()),'export bloqueado si existe: '+status().split('\n')[0]);
by('Textbox',w=>w.o.value==='v4_f1')[0].setValue('v4 f1'); btn('Exportar ecorregión (o región de trabajo)').clk(); ok(/solo admite/.test(status()),'versión salida inválida');
by('Textbox',w=>w.v==='v4 f1')[0].setValue('v4_f2'); btn('Exportar ecorregión (o región de trabajo)').clk(); ok(exp.length===2&&/silvo_filtrado_e8_v4_f2 @30/.test(exp[1]),'export normal → '+exp[1]);
// píxel
clickH({lon:-72.4,lat:-37.2}); const pix=W.filter(w=>w.kind==='Panel'); 
const filas=W.filter(w=>w.kind==='Label'&&w.txt&&/^(19|20)\d\d$/.test(String(w.txt)));
ok(filas.length>=31,'tabla de píxel con 31 filas: '+filas.length);
ok(layers.some(l=>/Píxel/.test(l)),'marca del píxel en el mapa');
// cambio de eco
selEco.setValue('9'); ok(/E9/.test(status()),'cambio a E9 aplica: '+status().split('\n')[0]); ok(selVer.o.items.length===1,'E9 solo v4');
// sin asset
selEco.o.items.push({label:'E99',value:'99'}); selEco.setValue('99'); ok(/no hay assets|No hay versiones/.test(status()),'eco sin assets avisa: '+status());
console.log(fails?('\n'+fails+' FALLAS'):'\nTODO OK');
