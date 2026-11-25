// ==========================================================================================
// SCRIPT: revisar_clasificaciones_silvicultura  (visor simple)
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// Revisa las clasificaciones YA EXPORTADAS (silvo_e{eco}_{año}_{versión}) sin entrenar nada:
//   · elegir ecorregión, versión y año (con botones ◀ ▶ para recorrer la serie)
//   · capas: clasificación (4 clases), solo pino/eucalipto, contorno y relleno de plantaciones COL2 (clase 9),
//            mosaico trimestral de ese año y límite de la ecorregión (se prenden y apagan en el panel Layers)
//   · clic en el mapa: serie de clases de ese píxel a lo largo de los años exportados (consistencia temporal)
//   · botón de áreas: hectáreas de pino y eucalipto por año en la vista actual (usa zoom para que sea rápido)
//   · RELLENO DE HUECOS (vista previa, sin exportar): los píxeles sin clasificar de un año se rellenan con la clase del
//     año más cercano que sí la tiene (hasta N años de distancia; a igual distancia manda el año anterior o el
//     siguiente). Afecta a las capas, al clic (serie) y a las áreas. La capa "Píxeles rellenados" muestra la
//     distancia en años; el botón "Huecos del año" cuantifica cuánto se rellena. Para exportarlo:
//     codigo_rellenar_huecos_temporal_silvicultura.js
//   · FILTRO DE TRANSICIÓN SILVO → OTRAS (vista previa en la nube, sin exportar): un píxel que fue silvicultura (pino,
//     eucalipto) no puede pasar a "otras" después. Regla híbrida: si el píxel vuelve a ser pino/euca más adelante,
//     el "otras" intermedio es ruido y copia la última clase; si no vuelve, queda como COSECHADO.
//     El filtro aplica SOLO a pino y eucalipto: el cosechado no se modifica y cosechado → otras no se corrige. La cadena usa
//     todos los años exportados de la versión de esa ecorregión (con relleno si está activo). Afecta a las capas, al
//     clic (serie del píxel) y a las áreas; la capa amarilla muestra los píxeles que el filtro reasignó.
//     Es más pesado que ver los datos tal cual: si se pone lento, apaga la casilla.
// ==========================================================================================

var CARPETA_SALIDA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';
var ASSET_TRIMESTRAL = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/mosaics-3-trimestral';
var ASSET_ECO_RASTER = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m';
var CARPETA_ECO_VECTOR = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES';
var COL2_ASSET = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-02/CLASSIFICATIONS/classification-final/clasificacion-final-3';
var COL2_PLANTACION = 9;
var ECOS = [5, 7, 8, 9, 10, 11, 12];
var ECO_INICIAL = 8;
var ESCALA_AREA = 90;   // m, para el gráfico de áreas (más grande = más rápido)

var VIS_CLASIF = {min: 1, max: 4, palette: ['1B5E20', 'AEEA00', 'BDBDBD', '8D6E63']};   // pino, euca, otras, cosechado
var VIS_PLANT = {min: 1, max: 2, palette: ['1B5E20', 'AEEA00']};
var NOMBRES = ['Pino', 'Eucalipto', 'Otras', 'Cosechado'];

Map.setOptions('HYBRID');

// ------------------------------------------------------------------------------------------
// Catálogo de lo exportado: CAT[eco][versión][año] = id del asset
// ------------------------------------------------------------------------------------------
function listarCarpeta(parent) {
  var out = [], token = null;
  do {
    var p = {pageSize: 1000};
    if (token) p.pageToken = token;
    var r = ee.data.listAssets(parent, p);
    ((r && r.assets) || []).forEach(function (a) { out.push(a); });
    token = (r && r.nextPageToken) || null;
  } while (token);
  return out;
}

var CAT = {};
(function () {
  var re = /^silvo_e(\d+)_(\d{4})_(.+)$/;
  var lista = [];
  try { lista = listarCarpeta(CARPETA_SALIDA); } catch (e) { print('No se pudo leer la carpeta de salida: ' + e.message); }
  lista.forEach(function (a) {
    if (a.type !== 'IMAGE') return;
    var id = a.id || a.name;
    var m = id.split('/').pop().match(re);
    if (!m) return;
    var eco = +m[1], yr = +m[2], ver = m[3];
    CAT[eco] = CAT[eco] || {};
    CAT[eco][ver] = CAT[eco][ver] || {};
    CAT[eco][ver][yr] = id;
  });
})();

function numVersion(v) { var m = String(v).match(/(\d+)/); return m ? +m[1] : 0; }
function versionesDe(eco) {
  return Object.keys(CAT[eco] || {}).sort(function (a, b) { return numVersion(a) - numVersion(b); });
}
function añosDe(eco, ver) {
  return Object.keys((CAT[eco] && CAT[eco][ver]) || {}).map(Number).sort(function (a, b) { return a - b; });
}

// ------------------------------------------------------------------------------------------
// Capas (se crean una vez y se actualizan: así se conserva qué está encendido)
// ------------------------------------------------------------------------------------------
var vacia = ee.Image(0).selfMask();
var capaMosaico = ui.Map.Layer(vacia, {}, 'Mosaico', false);
var capaClasif = ui.Map.Layer(vacia, VIS_CLASIF, 'Clasificación', true);
var capaPlant = ui.Map.Layer(vacia, VIS_PLANT, 'Pino / Eucalipto', false);
var capaCol2Rel = ui.Map.Layer(vacia, {palette: ['E040FB']}, 'COL2 plantación (9) · relleno', false, 0.5);
var capaCol2Con = ui.Map.Layer(vacia, {palette: ['FF00FF']}, 'COL2 plantación (9) · contorno', true);
var capaLimite = ui.Map.Layer(vacia, {palette: ['FFFF00']}, 'Límite ecorregión', false);
var capaRell = ui.Map.Layer(vacia, {min: 1, max: 4, palette: ['00E5FF', '2979FF', 'AA00FF', 'FF1744']},
  'Píxeles rellenados (distancia en años)', true);
var capaCorr = ui.Map.Layer(vacia, {palette: ['FFEA00']}, 'Corregidos por el filtro silvo→otras', true);
var capaPunto = null;
[capaMosaico, capaClasif, capaPlant, capaCol2Rel, capaCol2Con, capaRell, capaCorr, capaLimite].forEach(function (c) { Map.layers().add(c); });

var COL2_BANDAS = null;
function bandasCol2() {
  if (COL2_BANDAS === null) {
    try { COL2_BANDAS = ee.Image(COL2_ASSET).bandNames().getInfo() || []; } catch (e) { COL2_BANDAS = []; }
  }
  return COL2_BANDAS;
}

// ------------------------------------------------------------------------------------------
// Interfaz
// ------------------------------------------------------------------------------------------
function nota(t) { return ui.Label(t, {fontSize: '10px', color: '#666666', margin: '3px 0 0 0', whiteSpace: 'pre-wrap'}); }
function etiqueta(t) { return ui.Label(t, {fontSize: '10px', fontWeight: 'bold', margin: '6px 0 2px 0'}); }

var ecoSelect = ui.Select({
  items: ECOS.map(function (e) { return {label: 'E' + e, value: String(e)}; }),
  value: String(ECO_INICIAL), style: {stretch: 'horizontal'}
});
var verSelect = ui.Select({items: [], placeholder: 'Sin versiones', style: {stretch: 'horizontal'}});
var yearSelect = ui.Select({items: [], placeholder: 'Sin años', style: {width: '110px', margin: '0 4px 0 0'}});
var btnPrev = ui.Button({label: '◀', style: {width: '46px', margin: '0 4px 0 0'}});
var btnNext = ui.Button({label: '▶', style: {width: '46px', margin: '0'}});
var estado = nota('');
var meta = nota('');

var trimSelect = ui.Select({items: ['Q1_', 'Q2_', 'Q3_', 'Q4_'], value: 'Q1_', style: {width: '80px', margin: '0 4px 0 0'}});
var combSelect = ui.Select({
  items: [
    {label: 'SWIR1 / NIR / RED', value: 'swir1_median,nir_median,red_median'},
    {label: 'NIR / SWIR1 / RED', value: 'nir_median,swir1_median,red_median'},
    {label: 'RED / GREEN / BLUE', value: 'red_median,green_median,blue_median'}
  ],
  value: 'swir1_median,nir_median,red_median', style: {stretch: 'horizontal'}
});

var btnAreas = ui.Button({label: 'Áreas por año (vista actual)', style: {stretch: 'horizontal'}});
var btnHuecos = ui.Button({label: 'Huecos del año y relleno (vista actual)', style: {stretch: 'horizontal', margin: '4px 0 0 0'}});
var rellenoCheck = ui.Checkbox({label: 'Rellenar huecos con años vecinos (vista previa)', value: false,
  style: {fontSize: '11px', margin: '2px 0 2px 0'}});
var maxDistBox = ui.Textbox({value: '3', style: {width: '50px', margin: '0 8px 0 0'}});
var prioSelect = ui.Select({
  items: [{label: 'Año anterior primero', value: 'ANTERIOR'}, {label: 'Año siguiente primero', value: 'SIGUIENTE'}],
  value: 'ANTERIOR', style: {width: '170px', margin: '0'}
});
var filtroCheck = ui.Checkbox({label: 'Filtro: silvo no puede pasar a "otras" (híbrido)', value: false,
  style: {fontSize: '11px', margin: '2px 0 2px 0'}});
var panelGrafico = ui.Panel({style: {margin: '4px 0 0 0', padding: '0'}});

var panel = ui.Panel({style: {width: '320px', padding: '8px'}});
panel.add(ui.Label('Revisar clasificaciones · Silvicultura', {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}));
panel.add(etiqueta('Ecorregión')); panel.add(ecoSelect);
panel.add(etiqueta('Versión exportada')); panel.add(verSelect);
panel.add(etiqueta('Año'));
panel.add(ui.Panel([yearSelect, btnPrev, btnNext], ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
panel.add(estado);
panel.add(meta);
panel.add(etiqueta('Mosaico de fondo (capa "Mosaico", apagada)'));
panel.add(ui.Panel([trimSelect, combSelect], ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
panel.add(etiqueta('Relleno de huecos (sin exportar)'));
panel.add(rellenoCheck);
panel.add(ui.Panel([ui.Label('Distancia máx. (años)', {fontSize: '10px', margin: '6px 4px 0 0'}), maxDistBox, prioSelect],
  ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
panel.add(etiqueta('Filtro de transición (sin exportar)'));
panel.add(filtroCheck);
panel.add(nota('Solo pino/euca: si pasa a "otras" y vuelve a ser pino/euca → copia la última clase; no vuelve → cosechado. Cosechado no se toca.'));
panel.add(etiqueta('Revisión'));
panel.add(nota('Clic en el mapa: serie de clases de ese píxel por año.\nCapas, transparencia y orden: panel Layers del mapa.'));
panel.add(btnAreas);
panel.add(btnHuecos);
panel.add(panelGrafico);
ui.root.insert(0, panel);

// ------------------------------------------------------------------------------------------
// Lógica
// ------------------------------------------------------------------------------------------
function ecoActual() { return parseInt(ecoSelect.getValue(), 10); }
function yrActual() { return parseInt(yearSelect.getValue(), 10); }
function idActual() {
  var eco = ecoActual(), ver = verSelect.getValue(), yr = yrActual();
  return (CAT[eco] && CAT[eco][ver] && CAT[eco][ver][yr]) || null;
}

// ------------------------------------------------------------------------------------------
// Relleno de huecos con años vecinos (mismo criterio que codigo_rellenar_huecos_temporal_silvicultura.js)
// ------------------------------------------------------------------------------------------
function leerRelleno() {
  var d = parseInt(String(maxDistBox.getValue()).trim(), 10);
  if (isNaN(d) || d < 1) d = 1;
  if (d > 10) d = 10;
  return {on: rellenoCheck.getValue() === true, maxD: d, prior: prioSelect.getValue() || 'ANTERIOR'};
}

function desplazamientos(maxD, prior) {
  var out = [];
  for (var d = 1; d <= maxD; d++) {
    if (prior === 'SIGUIENTE') { out.push(d); out.push(-d); } else { out.push(-d); out.push(d); }
  }
  return out;
}

// Imagen de dos bandas (silvicultura, anio_origen) del año y con huecos rellenados
function rellenadoAño(eco, ver, y, r) {
  var ids = CAT[eco][ver];
  var propio = ee.Image(ids[y]).select(0).rename('silvicultura');
  var out = propio.addBands(ee.Image.constant(y).rename('anio_origen').updateMask(propio.mask()));
  desplazamientos(r.maxD, r.prior).forEach(function (d) {
    var yy = y + d;
    if (!ids[yy]) return;
    var vecino = ee.Image(ids[yy]).select(0).rename('silvicultura');
    out = out.unmask(vecino.addBands(ee.Image.constant(yy).rename('anio_origen').updateMask(vecino.mask())));
  });
  return out;
}

// Clase del año SIN filtro (rellenada si el casillero está marcado)
function claseBase(eco, ver, y) {
  var r = leerRelleno();
  return r.on ? rellenadoAño(eco, ver, y, r).select('silvicultura') : ee.Image(CAT[eco][ver][y]).select(0);
}

// Filtro de transición silvo → otras (regla híbrida) sobre todos los años exportados de la ecorregión/versión
var FILTRO_CACHE = {};
function construirFiltro(eco, ver) {
  var r = leerRelleno();
  var clave = eco + '|' + ver + '|' + (r.on ? r.maxD + r.prior : 'sin');
  if (FILTRO_CACHE[clave]) return FILTRO_CACHE[clave];
  var años = añosDe(eco, ver);
  var cs = años.map(function (y) { return claseBase(eco, ver, y).rename('clase'); });
  var n = cs.length;
  // El filtro mira solo pino y eucalipto; cosechado no se toca ni dispara el filtro
  var sil = cs.map(function (c) { return c.eq(1).or(c.eq(2)).unmask(0); });                    // 1 si es pino/euca ese año
  var activo = cs.map(function (c) { return c.eq(1).or(c.eq(2)).or(c.eq(4)).unmask(0); });     // pino/euca/cosechado
  var visto = [], ultima = [], vienePE = [], vuelve = new Array(n);
  var sv = ee.Image(0), ls = ee.Image(0), pe = ee.Image(0);   // ¿fue pino/euca antes? / última clase pino/euca / ¿la última clase no-otras fue pino/euca?
  for (var i = 0; i < n; i++) {
    visto.push(sv); ultima.push(ls); vienePE.push(pe);
    sv = sv.or(sil[i]);
    ls = ls.where(sil[i], cs[i].unmask(0));
    pe = pe.where(activo[i], sil[i]);
  }
  var rr = ee.Image(0);                             // ¿vuelve a ser pino/euca después?
  for (var j = n - 1; j >= 0; j--) { vuelve[j] = rr; rr = rr.or(sil[j]); }
  var out = {}, corr = {};
  años.forEach(function (y, k) {
    var cand = cs[k].eq(3).and(visto[k]).and(vienePE[k]);   // "otras" justo después de pino/euca (si antes hubo cosechado, no se toca)
    var o = cs[k].where(cand.and(vuelve[k]), ultima[k]).where(cand.and(vuelve[k].not()), 4).rename('clase').toByte();
    out[y] = o;
    corr[y] = o.neq(cs[k]).selfMask();
  });
  FILTRO_CACHE[clave] = {out: out, corr: corr};
  return FILTRO_CACHE[clave];
}
function filtroOn() { return filtroCheck.getValue() === true; }

// Clase del año (rellenada y/o filtrada según los casilleros)
function claseAño(eco, ver, y) {
  return filtroOn() ? construirFiltro(eco, ver).out[y] : claseBase(eco, ver, y);
}

function mosaicoVis() {
  var bandas = combSelect.getValue().split(',').map(function (b) { return trimSelect.getValue() + b; });
  return {bands: bandas, min: 70, max: 4000, gamma: 0.85};
}

function dibujar() {
  var eco = ecoActual(), ver = verSelect.getValue(), yr = yrActual();
  var id = idActual();
  if (!id) {
    estado.setValue('E' + eco + ': no hay clasificaciones exportadas para mostrar.');
    estado.style().set('color', '#B71C1C');
    meta.setValue('');
    [capaMosaico, capaClasif, capaPlant, capaCol2Rel, capaCol2Con, capaRell, capaCorr].forEach(function (c) { c.setEeObject(vacia); });
    return;
  }
  var mask = ee.Image(ASSET_ECO_RASTER).select(0).eq(eco).selfMask();
  var rel = leerRelleno();
  var img = ee.Image(id).select(0);
  if (rel.on) {
    var lleno = rellenadoAño(eco, ver, yr, rel);
    img = lleno.select('silvicultura');
    // distancia en años entre el año mostrado y el año de origen; solo donde se rellenó
    var dist = lleno.select('anio_origen').subtract(yr).abs();
    capaRell.setEeObject(dist.updateMask(dist.gt(0)));
  } else {
    capaRell.setEeObject(vacia);
  }

  if (filtroOn()) {
    var fl = construirFiltro(eco, ver);
    img = fl.out[yr];
    capaCorr.setEeObject(fl.corr[yr]);
  } else {
    capaCorr.setEeObject(vacia);
  }
  capaClasif.setEeObject(img); capaClasif.setName('Clasificación ' + ver + ' ' + yr + (filtroOn() ? ' · filtro silvo→otras' : ''));
  capaPlant.setEeObject(img.updateMask(img.lte(2))); capaPlant.setName('Pino / Eucalipto ' + ver + ' ' + yr);

  var mosaico = ee.ImageCollection(ASSET_TRIMESTRAL).filter(ee.Filter.eq('year', yr)).mosaic().updateMask(mask);
  capaMosaico.setEeObject(mosaico); capaMosaico.setVisParams(mosaicoVis());
  capaMosaico.setName('Mosaico ' + trimSelect.getValue().replace('_', '') + ' ' + yr);

  var banda = 'classification_' + yr;
  if (bandasCol2().indexOf(banda) >= 0) {
    var p = ee.Image(COL2_ASSET).select(banda).eq(COL2_PLANTACION).selfMask().updateMask(mask);
    var p0 = p.unmask(0);
    var borde = p0.subtract(p0.focalMin(1, 'square', 'pixels')).selfMask().updateMask(mask);
    capaCol2Rel.setEeObject(p); capaCol2Con.setEeObject(borde);
    capaCol2Rel.setName('COL2 plantación (9) ' + yr + ' · relleno');
    capaCol2Con.setName('COL2 plantación (9) ' + yr + ' · contorno');
  } else {
    capaCol2Rel.setEeObject(vacia); capaCol2Con.setEeObject(vacia);
    capaCol2Rel.setName('COL2 (sin ' + yr + ')'); capaCol2Con.setName('COL2 (sin ' + yr + ')');
  }

  var años = añosDe(eco, ver);
  estado.setValue('E' + eco + ' · ' + ver + ' · ' + yr + '  (' + años.length + ' años exportados: ' +
    años[0] + '–' + años[años.length - 1] + ')' +
    (rel.on ? '\nRelleno activo: hasta ' + rel.maxD + ' año(s), ' + (rel.prior === 'ANTERIOR' ? 'anterior' : 'siguiente') + ' primero' : '') +
    (filtroOn() ? '\nFiltro silvo→otras activo (híbrido). Capa amarilla = píxeles reasignados.' : ''));
  estado.style().set('color', '#2E7D32');

  ee.Image(id).toDictionary(['modo', 'ecos_ent', 'periodo', 'arboles', 'radio', 'consenso', 'area_min_px', 'fondo_ver', 'transferido', 'guia_col2', 'umbral_dentro', 'umbral_fuera'])
    .evaluate(function (d) {
      if (!d || yrActual() !== yr || verSelect.getValue() !== ver) return;
      var t = [];
      if (d.modo) t.push('modo ' + d.modo);
      if (d.ecos_ent) t.push('entrenado con E' + String(d.ecos_ent).split(',').join(', E'));
      if (d.transferido === 1) t.push('transferido (sin muestras propias)');
      if (d.periodo) t.push('periodo ' + d.periodo);
      if (d.fondo_ver) t.push('fondo ' + d.fondo_ver);
      if (d.radio !== undefined) t.push('suavizado ' + d.radio + ' px');
      if (d.consenso === 1) t.push('consenso temporal');
      if (d.area_min_px) t.push('área mín. ' + d.area_min_px + ' px');
      if (d.guia_col2 === 1) t.push('guía COL2 (P ≥ ' + d.umbral_dentro + ' dentro, ≥ ' + d.umbral_fuera + ' fuera)');
      if (d.arboles) t.push(d.arboles + ' árboles');
      meta.setValue(t.length ? 'Cómo se hizo: ' + t.join(' · ') : '');
    });
}

function actualizarVersiones(centrar) {
  var eco = ecoActual();
  var vs = versionesDe(eco);
  verSelect.items().reset(vs);
  capaLimite.setEeObject(ee.Image().byte().paint(ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + eco), 1, 2));
  if (centrar) Map.centerObject(ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + eco).geometry().bounds(), 9);
  if (!vs.length) {
    verSelect.setPlaceholder('Sin versiones');
    yearSelect.items().reset([]);
    dibujar();
    return;
  }
  verSelect.setValue(vs[vs.length - 1], false);   // última versión
  actualizarAños();
}

function actualizarAños() {
  var eco = ecoActual(), ver = verSelect.getValue();
  var años = añosDe(eco, ver).map(String);
  var previo = yearSelect.getValue();
  yearSelect.items().reset(años);
  yearSelect.setValue(años.indexOf(previo) >= 0 ? previo : años[años.length - 1], false);
  dibujar();
}

function moverAño(delta) {
  var años = añosDe(ecoActual(), verSelect.getValue());
  var i = años.indexOf(yrActual()) + delta;
  if (i < 0 || i >= años.length) return;
  yearSelect.setValue(String(años[i]), false);
  dibujar();
}

ecoSelect.onChange(function () { actualizarVersiones(true); });
verSelect.onChange(actualizarAños);
yearSelect.onChange(dibujar);
btnPrev.onClick(function () { moverAño(-1); });
btnNext.onClick(function () { moverAño(1); });
rellenoCheck.onChange(function () { if (yearSelect.getValue()) dibujar(); });
filtroCheck.onChange(function () { if (yearSelect.getValue()) dibujar(); });
maxDistBox.onChange(function () { if (yearSelect.getValue()) dibujar(); });
prioSelect.onChange(function () { if (yearSelect.getValue()) dibujar(); });
trimSelect.onChange(function () { capaMosaico.setVisParams(mosaicoVis()); if (yearSelect.getValue()) dibujar(); });
combSelect.onChange(function () { capaMosaico.setVisParams(mosaicoVis()); });

// ------------------------------------------------------------------------------------------
// Clic: serie de clases del píxel en todos los años exportados de la versión
// ------------------------------------------------------------------------------------------
Map.onClick(function (coords) {
  var eco = ecoActual(), ver = verSelect.getValue();
  var años = añosDe(eco, ver);
  if (!años.length) return;
  var pt = ee.Geometry.Point([coords.lon, coords.lat]);
  if (capaPunto) Map.layers().remove(capaPunto);
  capaPunto = ui.Map.Layer(ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(pt.buffer(45))]), 1, 2),
    {palette: ['FF0000']}, 'Píxel seleccionado');
  Map.layers().add(capaPunto);

  panelGrafico.clear();
  panelGrafico.add(ui.Label('Calculando serie del píxel…', {fontSize: '10px', color: '#666666'}));
  var feats = años.map(function (y) {
    var v = claseAño(eco, ver, y).rename('c').reduceRegion(ee.Reducer.first(), pt, 30).get('c');
    return ee.Feature(null, {year: y, clase: v});
  });
  var chart = ui.Chart.feature.byFeature(ee.FeatureCollection(feats), 'year', ['clase'])
    .setChartType('ScatterChart')
    .setOptions({
      title: 'Clase del píxel por año · E' + eco + ' ' + ver + (leerRelleno().on ? ' (con relleno)' : '') + (filtroOn() ? ' (con filtro)' : '') + ' (' + coords.lon.toFixed(4) + ', ' + coords.lat.toFixed(4) + ')',
      legend: {position: 'none'}, pointSize: 6, lineWidth: 1,
      hAxis: {title: 'Año', format: '####'},
      vAxis: {viewWindow: {min: 0.5, max: 4.5},
              ticks: [{v: 1, f: 'Pino'}, {v: 2, f: 'Eucalipto'}, {v: 3, f: 'Otras'}, {v: 4, f: 'Cosechado'}]},
      colors: ['#1B5E20'], height: '170px'
    });
  panelGrafico.clear();
  panelGrafico.add(chart);
});

// ------------------------------------------------------------------------------------------
// Áreas de pino y eucalipto por año en la vista actual
// ------------------------------------------------------------------------------------------
btnAreas.onClick(function () {
  var eco = ecoActual(), ver = verSelect.getValue();
  var años = añosDe(eco, ver);
  if (!años.length) return;
  var b = Map.getBounds();
  var vista = ee.Geometry.Rectangle([b[0], b[1], b[2], b[3]]);
  panelGrafico.clear();
  panelGrafico.add(ui.Label('Calculando áreas de ' + años.length + ' años en la vista actual…', {fontSize: '10px', color: '#666666'}));
  var ha = ee.Image.pixelArea().divide(10000);
  var feats = años.map(function (y) {
    var im = claseAño(eco, ver, y);
    var apilada = ha.updateMask(im.eq(1)).rename('Pino').unmask(0)
      .addBands(ha.updateMask(im.eq(2)).rename('Eucalipto').unmask(0))
      .addBands(ha.updateMask(im.eq(4)).rename('Cosechado').unmask(0));
    var d = apilada.reduceRegion({reducer: ee.Reducer.sum(), geometry: vista, scale: ESCALA_AREA,
      maxPixels: 1e9, bestEffort: true, tileScale: 4});
    return ee.Feature(null, d).set('year', y);
  });
  var chart = ui.Chart.feature.byFeature(ee.FeatureCollection(feats), 'year', ['Pino', 'Eucalipto', 'Cosechado'])
    .setChartType('LineChart')
    .setOptions({
      title: 'Área por año en la vista actual (ha) · E' + eco + ' ' + ver + (leerRelleno().on ? ' (con relleno)' : '') + (filtroOn() ? ' (con filtro)' : ''),
      hAxis: {title: 'Año', format: '####'}, vAxis: {title: 'ha', viewWindow: {min: 0}},
      colors: ['#1B5E20', '#AEEA00', '#8D6E63'], lineWidth: 2, pointSize: 3, height: '210px', legend: {position: 'top'}
    });
  panelGrafico.clear();
  panelGrafico.add(chart);
});

// ------------------------------------------------------------------------------------------
// Huecos del año actual en la vista: cuánto falta y cuánto rellena el criterio elegido
// ------------------------------------------------------------------------------------------
btnHuecos.onClick(function () {
  var eco = ecoActual(), ver = verSelect.getValue(), yr = yrActual();
  var id = idActual();
  if (!id) return;
  var r = leerRelleno();
  var b = Map.getBounds();
  var vista = ee.Geometry.Rectangle([b[0], b[1], b[2], b[3]]);
  panelGrafico.clear();
  panelGrafico.add(ui.Label('Calculando huecos de ' + yr + ' en la vista actual…', {fontSize: '10px', color: '#666666'}));
  var ha = ee.Image.pixelArea().divide(10000);
  var dentro = ee.Image(ASSET_ECO_RASTER).select(0).eq(eco).unmask(0);
  var original = ee.Image(id).select(0);
  var hueco = dentro.and(original.mask().not());
  var lleno = rellenadoAño(eco, ver, yr, r).select('silvicultura');
  var apilada = ee.Image([
    ha.updateMask(dentro).rename('eco'),
    ha.updateMask(hueco).rename('hueco'),
    ha.updateMask(hueco.and(lleno.mask())).rename('rellenado')
  ]).unmask(0);
  apilada.reduceRegion({reducer: ee.Reducer.sum(), geometry: vista, scale: ESCALA_AREA, maxPixels: 1e9,
    bestEffort: true, tileScale: 4}).evaluate(function (d, err) {
    panelGrafico.clear();
    if (err || !d) { panelGrafico.add(ui.Label('Error: ' + err, {fontSize: '10px', color: '#B71C1C'})); return; }
    var f = function (x) { return Math.round(x || 0); };
    var pct = function (a, t) { return t > 0 ? (100 * a / t).toFixed(1) + ' %' : '—'; };
    panelGrafico.add(ui.Label(
      'Año ' + yr + ' · vista actual (ha)\n' +
      'Ecorregión en vista     ' + f(d.eco) + '\n' +
      'Sin clasificar          ' + f(d.hueco) + '  (' + pct(d.hueco, d.eco) + ')\n' +
      'Rellenados (≤ ' + r.maxD + ' años)  ' + f(d.rellenado) + '  (' + pct(d.rellenado, d.hueco) + ' de los huecos)\n' +
      'Quedan sin dato         ' + f(d.hueco - d.rellenado),
      {fontSize: '10px', whiteSpace: 'pre', fontFamily: 'monospace'}));
  });
});

// ------------------------------------------------------------------------------------------
// Inicio
// ------------------------------------------------------------------------------------------
if (!Object.keys(CAT).length) {
  estado.setValue('No se encontraron clasificaciones en la carpeta de salida:\n' + CARPETA_SALIDA);
  estado.style().set('color', '#B71C1C');
} else {
  actualizarVersiones(true);
}
