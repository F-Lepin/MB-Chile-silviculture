// Prueba con simulaciones (no usa Earth Engine real): la exportación de la partición train/test del clasificador.
const fs=require('fs');
const path=require('path'); const file=path.join(__dirname,'..','..','02_clasificacion','codigo_rf_silvicultura_ui_final.js');
global.__n=0; const evals=[]; const calls=[];
function Any(name){ return new Proxy(function(){}, {
  get:(t,k)=>{ if(k==='then') return undefined; if(k===Symbol.toPrimitive) return ()=>0; if(k===Symbol.iterator) return undefined;
    if(k==='getInfo') return ()=>({features:[],properties:{}}); if(k==='evaluate') return (cb)=>{ evals.push({name,cb}); };
    if(k==='length') return 0; return Any(name+'.'+String(k)); },
  apply:(t,th,args)=>{ if(++global.__n%1000000===0) console.error('n',global.__n,name); if(global.__n>20000000){ throw new Error('LOOP en '+name); } if(calls.length<50) 0; return Any(name+'()'); },
  construct:()=>Any(name+'new') }); }
const log=[]; 
class W{ constructor(kind,o){ this.kind=kind; this.o=o||{}; this.v=this.o.value; this.h=[]; this.kids=[]; this.clk=null; this.txt=''; if(this.o.onClick) this.clk=this.o.onClick; if(this.o.onChange) this.h.push(this.o.onChange); this.st=Object.assign({},this.o.style); }
 getValue(){ if(this.kind==='Select' && this.v===undefined) { const it=this.o.items||[]; return it.length? (typeof it[0]==='object'?it[0].value:it[0]) : null; } return this.v===undefined?'':this.v; }
 setValue(v){ this.v=v; if(this.kind==='Label') this.txt=v; } onClick(f){ this.clk=f; } onChange(f){ this.h.push(f); }
 style(){ return {set:(k,v)=>{this.st[k]=v;}, get:(k)=>this.st[k]}; } add(x){ this.kids.push(x); return this; } insert(i,x){ this.kids.splice(i,0,x); } clear(){ this.kids=[]; return this; }
 widgets(){ return {get:(i)=>this.kids[i]||Any('w'), length:()=>this.kids.length, reset:()=>{}, add:()=>{}, remove:()=>{}}; }
 items(){ return {reset:(l)=>{this.o.items=l;}, add:()=>{}, length:()=>(this.o.items||[]).length, get:()=>Any('it')}; }
 setDisabled(){} setUrl(){} setLayout(){} setOptions(){} setChartType(){} setSeriesNames(){} }
const mkW=(k)=>function(a,b,c){ const w=new W(k, (a&&typeof a==='object'&&!Array.isArray(a))?a:{}); if(Array.isArray(a)) w.kids=a.slice(); if(k==='Label'){ w.txt=a; w.o=b||{}; w.st=Object.assign({}, b);} return new Proxy(w,{get:(t,p)=>{ if(p in t) return t[p]; if(p==='then') return undefined; return typeof p==='string'? function(){ return t; } : undefined; }, set:(t,p,v)=>{t[p]=v; return true;}}); };
global.ui={Panel:Object.assign(mkW('Panel'),{Layout:{flow:()=>1,absolute:()=>1}}),Label:mkW('Label'),Select:mkW('Select'),Textbox:mkW('Textbox'),Checkbox:mkW('Checkbox'),Button:mkW('Button'),Slider:mkW('Slider'),
  Chart:Object.assign(mkW('Chart'),{feature:Any('chart'),array:Any('chart')}), Map:Object.assign(function(){ return Any('map'); },{Layer:function(){return Any('layer');}, Linker:()=>Any('l')}), SplitPanel:()=>Any('sp'), root:{widgets:()=>({get:(i)=>Any('map0'),reset:()=>{},add:()=>{},insert:()=>{},remove:()=>{},length:()=>1}), clear:()=>{}, add:()=>{}, insert:()=>{}, setLayout:()=>{}}, url:{}, util:Any('util')};
const eeOver={data:{listAssets:()=>({assets:[]}), getAsset:()=>({type:'TABLE'}), getList:()=>[]}, List:Object.assign(function(a){return Any('List');},{sequence:()=>Any('seq')})};
const eeBase=Any('ee');
global.ee=new Proxy(function(){}, {get:(t,k)=> (k in eeOver)? eeOver[k] : eeBase[k], apply:(t,th,a)=>eeBase(...a)});
global.Map=Any('Map'); global.Export=Any('Export'); global.print=()=>{}; global.Chart=Any('Chart');
global.console=console;
const src=fs.readFileSync(file,'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'cuerpo_particion.js'),'utf8');
const test=`
const T=(c,m)=>console.log((c?'ok   ':'FALLA')+' '+m);
try {
  T(dosEtapasCheck.getValue()===true,'casilla activada por defecto');
  const cfg=leerConfig(); T(cfg.dosEtapas===true,'leerConfig.dosEtapas');
} catch(e){ console.log('EXC leerConfig:', e.stack.split('\\n').slice(0,3).join(' | ')); }
`;
try { (0,eval)(src.replace(/^/,'')); } catch(e){ console.log('EXC al cargar:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); }
console.log('carga OK');
