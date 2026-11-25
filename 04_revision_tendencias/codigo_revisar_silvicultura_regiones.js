// ==========================================================================================
// SCRIPT: revisar_silvicultura_regiones  (serie temporal de pino y eucalipto por región político-administrativa)
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// Toma las clasificaciones YA EXPORTADAS (silvo_e{eco}_{año}_{versión}) y, como opciones extra del selector de versión, las
// colecciones de INTEGRACIÓN (RAIZ_REGLAS y RAIZ_HMM, ver abajo), junta todas las ecorregiones de cada año
// y calcula las hectáreas por región (raster nivel-politico-2) SOLO para lo que elijas en este orden:
//   AÑOS (desde–hasta)  >  REGIÓN (una o todas)  >  VERSIÓN  >  ESCALA   →   "Calcular serie temporal"
// Para cada año calcula:
//   · Pino (1), Eucalipto (2), Cosechado (4) y el total de silvicultura (suma de las tres)
//   · Cosechado (4) y área SIN DATO (huecos de la clasificación dentro de las ecorregiones clasificadas)
//   · Referencia: plantación (9) de la COL2 de MapBiomas, recortada a las MISMAS ecorregiones, para contrastar
//   · (opcional) una referencia propia, ej. estadísticas de INFOR/CONAF: ver REFERENCIA_HA abajo
//
// Uso:
//   1) Elige el rango de años, la región (o "Todas las regiones"), la versión exportada y la escala
//      (90 m para explorar; 30 m para cifras finales: con una sola región es mucho más rápido).
//   2) "Calcular serie temporal": un año a la vez (el gráfico se va llenando). Cada combinación
//      versión · región · escala se guarda: no se recalcula lo que ya está hecho, y volver a elegirla es instantáneo.
//   3) El clic en el mapa elige la región de ese punto (luego presiona Calcular).
//   4) Para guardar los números: botón "Exportar tabla (CSV a Drive)" o menú del gráfico (ícono ↗ → Download CSV).
//   El ranking por región solo aparece cuando se calculó "Todas las regiones".
//
// CORRECCIÓN POR INCENDIOS (opcional, cálculo en la nube, SIN exportar nada): el clasificador confunde el bosque quemado con
// COSECHADO. Se cruza con el producto anual de MapBiomas Fuego (ASSET_FUEGO): cuando un tramo de cosechado empieza el mismo año
// de un incendio (o hasta N años después, "desfase") se reclasifica TODO ese tramo a la última clase de plantación (pino o eucalipto)
// que el píxel tenía antes del cosechado. Un cosechado que NO coincide con un incendio no se toca. Los años sin dato de fuego no se corrigen
// (el panel los avisa). Con la corrección activa la serie se calcula en UNA sola llamada con la historia completa de la versión: usa 240–1000 m para explorar.
//
// RELLENO DE HUECOS (cálculo en la nube, SIN exportar nada): con la casilla activada, los píxeles sin clasificar de cada
// año (mosaico incompleto) se rellenan con la clase del año más cercano que sí la tiene, hasta N años de distancia
// (a igual distancia manda el año anterior o el siguiente). Afecta al mapa y a las hectáreas. El gráfico de control
// muestra cuántas ha se rellenaron y cuántas siguen sin dato. Es el mismo criterio que
// codigo_rellenar_huecos_temporal_silvicultura.js, por si más adelante se decide exportar.
//
// Notas:
//   · Las áreas se calculan solo dentro de las ecorregiones que tienen clasificación exportada ESE año. Si en algún
//     año faltan ecorregiones, el panel lo avisa (la serie bajaría por eso y no por la plantación).
//   · A escala > 30 m las cifras son aproximadas (re-muestreo); sirven para ver la tendencia.
//   · Una región se calcula con su POLÍGONO del vector nivel-politico-2 (como en el script de la COL1); "Todas las regiones"
//     agrupa por el raster nivel-politico-2-raster. Los NOMBRES usan los códigos FEATURE_ID del vector (tabla de la COL1:
//     16 = La Araucanía, 10 = Biobío…). El clic en el mapa muestra el código del raster y el del vector para validar que coinciden.
// ==========================================================================================

var CARPETA_SALIDA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';
var ASSET_REGIONES = 'projects/mapbiomas-chile/assets/ANCILLARY_DATA/STATISTICS/COLLECTION1/VERSION-1/nivel-politico-2-raster';
var BANDA_REGIONES = 0;   // banda (índice o nombre) del raster de regiones que trae el código de región
// Vector de regiones (DPA nivel 2): se usa como GEOMETRÍA del cálculo de una región (como en el script de la COL1).
var ASSET_REGIONES_VEC = 'projects/mapbiomas-chile/assets/ANCILLARY_DATA/STATISTICS/COLLECTION1/VERSION-1/nivel-politico-2';
var CAMPO_ID_REGION = 'FEATURE_ID';
var ASSET_ECO_RASTER = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m';
var CARPETA_ECO_VECTOR = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES';
var COL2_ASSET = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-02/CLASSIFICATIONS/classification-final/clasificacion-final-3';
var COL2_PLANTACION = 9;

// Producto anual de MapBiomas Fuego (ImageCollection o Image). La estructura se detecta sola al activar la corrección:
// el año sale de las bandas (ej. burned_area_2005), de una propiedad de la imagen (FUEGO_CAMPOS_AÑO) o del id; si hay varias
// imágenes del mismo año (por región) se combinan. Se considera quemado un valor > FUEGO_UMBRAL en la banda elegida.
var ASSET_FUEGO = 'projects/mapbiomas-chile/assets/FIRE/COLLECTION1/CLASSIFICATION/burned_area_chile_year_11';
var FUEGO_BANDA = null;                        // null = automática (la banda 'burned_area' si existe; si no, la primera)
var FUEGO_CAMPOS_AÑO = ['year', 'año', 'ano', 'Year', 'YEAR'];
var FUEGO_UMBRAL = 0;                          // quemado = valor > umbral
var FUEGO_ATRAS_MAX = 5;                       // años hacia atrás para buscar el último pino/euca previo al cosechado
var FUEGO_DESFASE_INICIAL = 1;                 // años de tolerancia entre el incendio y el inicio del cosechado

// Colecciones de INTEGRACIÓN (resultado de aplicar reglas / filtro HMM): aparecen como versiones extra en el selector "3)".
// Se leen solas: cada imagen de la carpeta (o ImageCollection) se asocia a una ecorregión por su nombre (e8, E08, ecorregion_8…)
// y a un año por su nombre (2017) o por sus bandas (…_2017). Si no trae ecorregión en el nombre, se usa en todas las ecorregiones.
// Los códigos del asset se convierten a las clases del revisor (1 pino, 2 euca, 4 cosechado; el resto = otras): se detectan
// al elegir la colección (79/80/83 → 1/2/4; si ya vienen como 1–4 se usan tal cual) y se imprimen en la consola.
var RAIZ_REGLAS = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/INTEGRATION/V1/reglas';
var RAIZ_HMM = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/INTEGRATION/V1/hmm';
var FUENTES_EXTRA = [
  {id: 'int_reglas', etiqueta: 'Integración V1 · reglas', raiz: RAIZ_REGLAS},
  {id: 'int_hmm', etiqueta: 'Integración V1 · HMM', raiz: RAIZ_HMM}
];
var EXTRA_MAPEO_DEFECTO = {79: 1, 80: 2, 83: 4};   // código del asset → clase del revisor (si no se reconocen los valores)
var EXTRA_AÑO_B1 = 1996;                           // si las bandas se llaman b1, b2, b3… (sin año): b1 = este año, b2 = el siguiente, etc.
var EXTRA_BANDA = null;                            // null = primera banda (o la de cada año si la imagen trae una banda por año); o nombre/índice

var ESCALAS = [30, 60, 90, 120, 240, 500, 1000];
var ESCALA_INICIAL = 500;     // rápida: sirve para ver la tendencia; sube a 30–90 m para cifras finales
var CONCURRENCIA = 4;         // años que se calculan en paralelo

// Nombres de región según el código FEATURE_ID del vector nivel-politico-2 (tabla de tu script de la COL1).
// OJO: NO es la numeración CUT. Si el raster usara otros códigos, el clic en el mapa muestra ambos para comparar.
var NOMBRES_REGION = {
  0: 'Sin región', 2: 'Antofagasta', 3: 'Los Ríos', 4: 'Metropolitana', 5: 'Coquimbo', 6: 'Atacama', 7: 'Tarapacá',
  8: 'Maule', 9: 'Magallanes', 10: 'Biobío', 11: 'Aysén', 12: 'Valparaíso', 13: 'Arica y Parinacota',
  14: 'Ñuble', 15: "O'Higgins", 16: 'La Araucanía', 17: 'Los Lagos'
};

// Referencia propia opcional (ha de plantación pino + eucalipto). Formato: {'código de región' o 'TOTAL': {año: ha}}
// Ejemplo: var REFERENCIA_HA = {'8': {2010: 410000, 2015: 450000}, 'TOTAL': {2010: 1900000}};
var REFERENCIA_HA = null;

var VIS_CLASIF = {min: 1, max: 4, palette: ['1B5E20', 'AEEA00', 'BDBDBD', '8D6E63']};   // pino, euca, otras, cosechado

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

// Colecciones de integración: CAT[eco][id de la fuente][año] = {id, banda} (banda null = primera)
var FUENTES_INFO = {};
function idLimpio(x) { return String(x.id || x.name).replace(/^projects\/earthengine-legacy\/assets\//, ''); }
function listarImagenes(coleccion) {      // ids de las imágenes de una ImageCollection
  return ee.ImageCollection(coleccion).aggregate_array('system:index').getInfo().map(function (i) { return coleccion + '/' + i; });
}
function listarRec(raiz, prof) {          // imágenes de una carpeta (hasta `prof` subcarpetas) o de una ImageCollection
  var out = [], lista = [];
  try { lista = listarCarpeta(raiz); } catch (e) { lista = []; }
  lista.forEach(function (a) {
    var id = idLimpio(a);
    if (a.type === 'IMAGE') out.push(id);
    else if (a.type === 'FOLDER' && prof > 0) listarRec(id, prof - 1).forEach(function (x) { out.push(x); });
    else if (a.type === 'IMAGE_COLLECTION') { try { listarImagenes(id).forEach(function (x) { out.push(x); }); } catch (e2) {} }
  });
  if (!lista.length) { try { listarImagenes(raiz).forEach(function (x) { out.push(x); }); } catch (e3) {} }
  return out;
}
var ECOS_SILVO = Object.keys(CAT).map(Number);
function catalogarFuente(f) {
  var info = {imagenes: 0, ecos: {}, años: {}, avisos: [], mapa: undefined, valores: null};
  FUENTES_INFO[f.id] = info;
  var imgs = [];
  try { imgs = listarRec(f.raiz, 2); } catch (e) { info.avisos.push('no se pudo leer ' + f.raiz + ': ' + (e.message || e)); return; }
  info.imagenes = imgs.length;
  if (!imgs.length) {
    var tipos = {};
    try { listarCarpeta(f.raiz).forEach(function (a) { tipos[a.type] = (tipos[a.type] || 0) + 1; }); } catch (e5) { info.avisos.push('listAssets: ' + (e5.message || e5)); }
    info.avisos.push('no se encontraron imágenes en ' + f.raiz + (Object.keys(tipos).length ? ' (contiene: ' + Object.keys(tipos).map(function (t) { return tipos[t] + ' ' + t; }).join(', ') + ')' : ''));
    print(f.etiqueta + ' · ' + info.avisos.join(' · '));
    return;
  }
  var reEco = /(?:^|[_\-\s])e(?:co(?:rregion)?)?[_\-]?0*(\d{1,2})(?=$|[_\-\s.])/i, reAño = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/;
  function agregar(ecos, y, ref) {
    ecos.forEach(function (e) {
      CAT[e] = CAT[e] || {}; CAT[e][f.id] = CAT[e][f.id] || {}; CAT[e][f.id][y] = ref;
      info.ecos[e] = true;
    });
    info.años[y] = true;
  }
  var sinPatron = [];
  imgs.forEach(function (id) {
    var nom = id.indexOf(f.raiz + '/') === 0 ? id.slice(f.raiz.length + 1).replace(/\//g, '_') : id.split('/').pop();   // ruta relativa: sirve el nombre de subcarpetas o colecciones
    var me = nom.match(reEco), my = nom.match(reAño);
    var ecos = me ? [+me[1]] : ECOS_SILVO;
    if (my) { agregar(ecos, +my[1], {id: id, banda: EXTRA_BANDA}); return; }
    var bandas = [], errB = '';
    try { bandas = ee.Image(id).bandNames().getInfo() || []; } catch (e4) { errB = String(e4.message || e4); }
    var n = 0;
    bandas.forEach(function (b) { var m = b.match(reAño); if (m) { agregar(ecos, +m[1], {id: id, banda: EXTRA_BANDA !== null ? EXTRA_BANDA : b}); n++; } });
    if (!n && bandas.length && bandas.every(function (b) { return /^b\d+$/.test(b); })) {    // bandas b1…bN: una por año desde EXTRA_AÑO_B1
      bandas.forEach(function (b) { agregar(ecos, EXTRA_AÑO_B1 + parseInt(b.slice(1), 10) - 1, {id: id, banda: EXTRA_BANDA !== null ? EXTRA_BANDA : b}); n++; });
      info.bandasPorOrden = true;
    }
    if (!n) sinPatron.push(nom + (errB ? ' [error al leer bandas: ' + errB.slice(0, 80) + ']' : ' [bandas: ' + (bandas.slice(0, 5).join(', ') || 'ninguna') + (bandas.length > 5 ? '… (' + bandas.length + ')' : '') + ']'));
    else if (!me) info.sinEco = true;
  });
  if (sinPatron.length) info.avisos.push('sin año en el nombre ni en las bandas (ignoradas ' + sinPatron.length + '): ' + sinPatron.slice(0, 5).join(', ') + (sinPatron.length > 5 ? '…' : ''));
  if (info.bandasPorOrden) info.avisos.push('bandas b1…bN sin año: se asume b1 = ' + EXTRA_AÑO_B1 + ' (EXTRA_AÑO_B1)');
  if (info.sinEco) info.avisos.push('hay imágenes sin ecorregión en el nombre: se usan en TODAS las ecorregiones');
  if (!Object.keys(info.años).length) info.avisos.push('ejemplos de lo que hay: ' + imgs.slice(0, 5).map(function (x) { return x.split('/').slice(-2).join('/'); }).join(', '));
  var ays = Object.keys(info.años).map(Number).sort(function (a, b) { return a - b; });
  print(f.etiqueta + ' · ' + imgs.length + ' imágenes · ecorregiones: ' + (Object.keys(info.ecos).join(', ') || '—') +
    ' · años: ' + (ays.length ? ays[0] + '–' + ays[ays.length - 1] + ' (' + ays.length + ')' : '—') +
    (info.avisos.length ? '\n  ' + info.avisos.join('\n  ') : ''));
}
FUENTES_EXTRA.forEach(function (f) { try { catalogarFuente(f); } catch (e) { print(f.etiqueta + ': ' + (e.message || e)); } });

function etiquetaVersion(v) {
  var f = FUENTES_EXTRA.filter(function (x) { return x.id === v; })[0];
  return f ? f.etiqueta : v;
}
function esExtra(v) { return FUENTES_EXTRA.some(function (x) { return x.id === v; }); }

function numVersion(v) { var m = String(v).match(/(\d+)/); return m ? +m[1] : 0; }
function todasVersiones() {
  var set = {};
  Object.keys(CAT).forEach(function (e) { Object.keys(CAT[e]).forEach(function (v) { set[v] = true; }); });
  var base = Object.keys(set).filter(function (v) { return !esExtra(v); })
    .sort(function (a, b) { return numVersion(a) - numVersion(b) || (a < b ? -1 : 1); });
  return base.concat(FUENTES_EXTRA.map(function (x) { return x.id; }).filter(function (v) { return set[v]; }));   // las de integración, al final
}
function ecosConVersion(ver) {
  return Object.keys(CAT).map(Number).filter(function (e) { return CAT[e][ver]; }).sort(function (a, b) { return a - b; });
}
function ecosDelAño(ver, y) { return ecosConVersion(ver).filter(function (e) { return CAT[e][ver][y]; }); }
function añosDeVersion(ver) {
  var set = {};
  ecosConVersion(ver).forEach(function (e) { Object.keys(CAT[e][ver]).forEach(function (y) { set[y] = true; }); });
  return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
}

// ------------------------------------------------------------------------------------------
// Imágenes base
// ------------------------------------------------------------------------------------------
var REGIONES = ee.Image(ASSET_REGIONES).select([BANDA_REGIONES]).toInt().rename('region');
var ECO_RASTER = ee.Image(ASSET_ECO_RASTER).select(0);

// Información del raster de regiones (para verificar la banda y los códigos)
print('Raster de regiones · bandas:', ee.Image(ASSET_REGIONES).bandNames());
var REGIONES_VEC = ee.FeatureCollection(ASSET_REGIONES_VEC);
function geometriaRegion(codigo) { return REGIONES_VEC.filter(ee.Filter.eq(CAMPO_ID_REGION, parseInt(codigo, 10))).geometry(); }

var COL2_BANDAS = null;
function bandasCol2() {
  if (COL2_BANDAS === null) {
    try { COL2_BANDAS = ee.Image(COL2_ASSET).bandNames().getInfo() || []; } catch (e) { COL2_BANDAS = []; }
  }
  return COL2_BANDAS;
}
function col2PlantacionExacto(y) {   // plantación COL2 de ese año exacto; null si el año no existe en COL2
  if (bandasCol2().indexOf('classification_' + y) < 0) return null;
  return ee.Image(COL2_ASSET).select('classification_' + y).eq(COL2_PLANTACION).unmask(0);
}

// Clasificación de UN año (sin relleno): mosaico de todas las ecorregiones exportadas de esa versión
// Mapeo de valores de una colección de integración → clases del revisor. Se detecta una vez (al usarla por primera vez) con un
// histograma grueso de hasta 3 imágenes de muestra: 79/80/83 → 1/2/4; si solo hay valores 0–4 se usa tal cual (null).
function mapaDe(ver) {
  var info = FUENTES_INFO[ver];
  if (!info) return null;                                  // clasificación preliminar: ya viene como 1/2/3/4
  if (info.mapa !== undefined) return info.mapa;
  var refs = [];
  Object.keys(CAT).forEach(function (e) { if (CAT[e][ver]) Object.keys(CAT[e][ver]).forEach(function (y) { refs.push(CAT[e][ver][y]); }); });
  var muestra = refs.length <= 3 ? refs : [refs[0], refs[Math.floor(refs.length / 2)], refs[refs.length - 1]];
  var valores = {}, fallo = null;
  muestra.forEach(function (ref) {
    try {
      var im = ee.Image(ref.id);
      var d = im.select([ref.banda === null ? 0 : ref.banda]).reduceRegion({reducer: ee.Reducer.frequencyHistogram(), geometry: im.geometry(),
        scale: 3000, maxPixels: 1e9, bestEffort: true, tileScale: 4}).getInfo() || {};
      var h = d[Object.keys(d)[0]] || {};
      Object.keys(h).forEach(function (k) { valores[k] = true; });
    } catch (e) { fallo = String(e.message || e); }
  });
  var ks = Object.keys(valores).map(Number);
  var tiene = function (v) { return ks.indexOf(v) >= 0; };
  var mapa, nota;
  if (tiene(79) || tiene(80) || tiene(83)) { mapa = EXTRA_MAPEO_DEFECTO; nota = '79/80/83 → 1/2/4, el resto = otras'; }
  else if (ks.length && ks.every(function (v) { return v >= 0 && v <= 4; })) { mapa = null; nota = 'valores 0–4: se usan tal cual'; }
  else { mapa = EXTRA_MAPEO_DEFECTO; nota = 'NO se reconocieron 79/80/83 ni 1–4; se usa ' + JSON.stringify(EXTRA_MAPEO_DEFECTO) + ' (ajusta EXTRA_MAPEO_DEFECTO)'; }
  info.mapa = mapa; info.valores = ks;
  print(etiquetaVersion(ver) + ' · valores en la muestra: ' + (ks.length ? ks.sort(function (a, b) { return a - b; }).join(', ') : '(no se pudo leer' + (fallo ? ': ' + fallo : '') + ')') + ' · ' + nota);
  return mapa;
}
function imagenDeRef(ref, ver) {                           // clase de un asset del catálogo (banda 'clase')
  if (typeof ref === 'string') return ee.Image(ref).select(0).rename('clase');
  var im = ee.Image(ref.id).select([ref.banda === null ? 0 : ref.banda]);
  var m = mapaDe(ver);
  if (m) { var k = Object.keys(m).map(Number); im = im.remap(k, k.map(function (x) { return m[x]; }), 3); }
  return im.rename('clase');
}
// Cada imagen de una ecorregión se recorta a SUS píxeles (raster de ecorregiones) antes de unirlas: si el clasificador exportó
// una franja (buffer) alrededor de la ecorregión, las ecorregiones vecinas se solapan y sin este recorte el mosaico tomaría
// la clasificación de la ecorregión equivocada en la franja. Una imagen sin ecorregión en el nombre (se repite en todas) no se recorta.
function mosaicoSimple(ver, y) {
  var vistos = {}, usos = {}, imgs = [];
  var clave = function (ref) { return typeof ref === 'string' ? ref : ref.id + '|' + ref.banda; };
  ecosDelAño(ver, y).forEach(function (e) { var k = clave(CAT[e][ver][y]); usos[k] = (usos[k] || 0) + 1; });
  ecosDelAño(ver, y).forEach(function (e) {
    var ref = CAT[e][ver][y], k = clave(ref);
    if (vistos[k]) return;                                 // una imagen sin ecorregión en el nombre se repite en todas
    vistos[k] = true;
    var im = imagenDeRef(ref, ver);
    imgs.push(usos[k] === 1 ? im.updateMask(ECO_RASTER.eq(e)) : im);
  });
  return imgs.length ? ee.ImageCollection(imgs).mosaic() : null;
}

// Desplazamientos en orden de prioridad: [-1, +1, -2, +2, ...] (ANTERIOR) o [+1, -1, +2, -2, ...] (SIGUIENTE)
function desplazamientos(maxD, prior) {
  var out = [];
  for (var d = 1; d <= maxD; d++) {
    if (prior === 'SIGUIENTE') { out.push(d); out.push(-d); } else { out.push(-d); out.push(d); }
  }
  return out;
}

// Ecorregiones que cuentan en el año: las exportadas ese año y, con relleno, las de los años vecinos que se usarían
function ecosParaAño(ver, y, r) {
  var set = {};
  ecosDelAño(ver, y).forEach(function (e) { set[e] = true; });
  if (r && r.on) {
    desplazamientos(r.maxD, r.prior).forEach(function (d) { ecosDelAño(ver, y + d).forEach(function (e) { set[e] = true; }); });
  }
  return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
}

// Clasificación del año, con relleno opcional (r = {on, maxD, prior}). Bandas: 'clase' y, con relleno, 'dist'
// (distancia en años del dato usado; 0 = el propio año).
function clasificacionAño(ver, y, r) {
  var base = mosaicoSimple(ver, y);
  if (!r || !r.on) return base;
  var out = base ? base.addBands(ee.Image(0).updateMask(base.mask()).rename('dist')) : null;
  desplazamientos(r.maxD, r.prior).forEach(function (d) {
    var v = mosaicoSimple(ver, y + d);
    if (!v) return;
    var vd = v.addBands(ee.Image(Math.abs(d)).updateMask(v.mask()).rename('dist'));
    out = out ? out.unmask(vd) : vd;
  });
  return out;
}

// ------------------------------------------------------------------------------------------
// Cálculo de áreas por región (un año por llamada)
// ------------------------------------------------------------------------------------------
var RES = {};            // RES[versión|escala|región][año] = {g: {región: [pino, euca, cosech, col2, sinDato, rellenado]}, col2: bool, ecos: n}
var CALCULANDO = false;
var DETENER = false;

function claveRes(ver, esc, region, r) {
  return ver + '|' + esc + '|' + region + '|' + (r && r.on ? 'rell' + r.maxD + (r.prior === 'SIGUIENTE' ? 'S' : 'A') : 'sin') +
    '|' + (col2Check.getValue() === true ? 'c1' : 'c0') +
    '|' + (fuegoCheck.getValue() === true ? 'u' + leerFuego().desfase : 'u0');
}
function leerFuego() {
  var d = parseInt(String(desfaseBox.getValue()).trim(), 10);
  if (isNaN(d) || d < 0) d = 0;
  if (d > 3) d = 3;
  return {on: fuegoCheck.getValue() === true, desfase: d};
}
function usaSerie() { return fuegoCheck.getValue() === true; }
function textoSerie() {
  var t = [];
  if (fuegoCheck.getValue() === true) t.push('corrección por incendios');
  return t.join(' + ');
}
function leerRelleno() {
  var d = parseInt(String(maxDistBox.getValue()).trim(), 10);
  if (isNaN(d) || d < 1) d = 1;
  if (d > 10) d = 10;
  return {on: rellenoCheck.getValue() === true, maxD: d, prior: prioSelect.getValue() || 'ANTERIOR'};
}
function textoRelleno(r) { return r.on ? 'relleno ≤' + r.maxD + ' años (' + (r.prior === 'SIGUIENTE' ? 'sig.' : 'ant.') + ')' : 'sin relleno'; }

function calcularAño(ver, y, esc, region, rell, cb) {
  var ecos = ecosParaAño(ver, y, rell);
  var full = clasificacionAño(ver, y, rell);
  if (!full) { cb(null, 'sin clasificación'); return; }
  var clas = full.select('clase');
  var orig = mosaicoSimple(ver, y);
  var foot = ecos.map(function (e) { return ECO_RASTER.eq(e); }).reduce(function (a, b) { return a.or(b); });
  var area = ee.Image.pixelArea().divide(10000);   // ha
  var col2 = col2Check.getValue() === true ? col2PlantacionExacto(y) : null;   // la lectura de COL2 es costosa: opcional
  var vals = ee.Image.cat([
    area.multiply(clas.eq(1)),
    area.multiply(clas.eq(2)),
    area.multiply(clas.eq(4)),
    area.multiply(col2 || ee.Image(0)),
    area.multiply(clas.mask().not()),                                   // sin dato (lo que queda tras el relleno)
    area.multiply(clas.mask().and(orig ? orig.mask().not() : ee.Image(0)))   // rellenado con años vecinos
  ]).unmask(0);
  // Una región: la geometría es su polígono (vector) y el grupo es ese código. Todas: se agrupa por el raster de regiones.
  var banda = region === 'TOTAL' ? REGIONES.unmask(0) : ee.Image.constant(parseInt(region, 10)).rename('region');
  var img = vals.addBands(banda).updateMask(foot);
  var geom = ee.FeatureCollection(ecos.map(function (e) { return ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + e); }))
    .flatten().geometry().bounds();
  if (region !== 'TOTAL') geom = geometriaRegion(region);   // polígono de la región (acota y acelera el cálculo)
  var r = img.reduceRegion({
    reducer: ee.Reducer.sum().repeat(6).group({groupField: 6, groupName: 'region'}),
    geometry: geom, scale: esc, maxPixels: 1e13, tileScale: esc <= 30 ? 16 : esc <= 120 ? 8 : 4
  });
  r.get('groups').evaluate(function (g, err) {
    if (err || !g) { cb(null, err || 'sin resultado'); return; }
    var out = {};
    g.forEach(function (it) { out[it.region] = it.sum; });
    cb({g: out, col2: !!col2, ecos: ecos.length});
  });
}

// ------------------------------------------------------------------------------------------
// Producto de MapBiomas Fuego: se lee su estructura una vez (al activar la corrección) y se arma FUEGO.porAño[año] = [{id, banda}]
// ------------------------------------------------------------------------------------------
var FUEGO = {ok: false, porAño: {}, error: ''};
var FUEGO_IMG = {};
function sondearFuego() {
  if (FUEGO.ok) return true;
  FUEGO.error = ''; FUEGO.porAño = {}; FUEGO_IMG = {};
  var tipo = 'IMAGE_COLLECTION', items = null, errores = [];
  try { items = ee.ImageCollection(ASSET_FUEGO).getInfo().features || []; } catch (e1) { errores.push('colección: ' + String(e1.message || e1)); }
  if (!items || !items.length) {
    try { items = [ee.Image(ASSET_FUEGO).getInfo()]; tipo = 'IMAGE'; } catch (e2) { errores.push('imagen: ' + String(e2.message || e2)); items = null; }
  }
  if (!items) { FUEGO.error = errores.join(' | '); print('MapBiomas Fuego: ' + FUEGO.error); return false; }
  try {
    var reAño = /(?:19|20)\d{2}/g;
    items.forEach(function (it) {
      var id = it.id || ASSET_FUEGO;
      var bandas = (it.bands || []).map(function (b) { return b.id; });
      var props = it.properties || {};
      var porBanda = [];
      bandas.forEach(function (b) { var m = b.match(reAño); if (m) porBanda.push({y: +m[m.length - 1], b: b}); });
      if (porBanda.length) {                                    // una banda por año dentro de la imagen
        porBanda.forEach(function (x) { (FUEGO.porAño[x.y] = FUEGO.porAño[x.y] || []).push({id: id, banda: x.b}); });
        return;
      }
      var y = null;                                             // un año por imagen: propiedad o id
      FUEGO_CAMPOS_AÑO.forEach(function (c) { if (y === null && props[c] !== undefined && !isNaN(+props[c])) y = +props[c]; });
      if (y === null) { var m2 = String(id).split('/').pop().match(reAño); if (m2) y = +m2[m2.length - 1]; }
      if (y === null) return;
      var banda = FUEGO_BANDA || (bandas.indexOf('burned_area') >= 0 ? 'burned_area' : bandas[0]);
      if (banda) (FUEGO.porAño[y] = FUEGO.porAño[y] || []).push({id: id, banda: banda});
    });
    FUEGO.ok = Object.keys(FUEGO.porAño).length > 0;
    if (!FUEGO.ok) FUEGO.error = 'no se pudo deducir el año de ninguna imagen de ' + ASSET_FUEGO;
    var ej = items[0] || {};
    print('MapBiomas Fuego · ' + tipo + ' · ' + items.length + ' imagen(es) · años con dato: ' +
      Object.keys(FUEGO.porAño).sort().join(', '));
    print('Fuego · ejemplo: ' + (ej.id || ASSET_FUEGO) + ' · bandas: ' + ((ej.bands || []).map(function (b) { return b.id; }).join(', ')) +
      ' · propiedades: ' + Object.keys(ej.properties || {}).join(', '));
  } catch (e) {
    FUEGO.ok = false; FUEGO.error = String(e.message || e);
  }
  return FUEGO.ok;
}
// Imagen binaria (1 = quemado ese año) o null si el producto no tiene ese año
function fuegoAño(y) {
  if (FUEGO_IMG[y] !== undefined) return FUEGO_IMG[y];
  var l = FUEGO.porAño[y];
  FUEGO_IMG[y] = (!l || !l.length) ? null : ee.ImageCollection(l.map(function (it) {
    return ee.Image(it.id).select([it.banda]).rename('q').gt(FUEGO_UMBRAL).unmask(0);
  })).max().rename('q');
  return FUEGO_IMG[y];
}
function fuegoVentana(y, desfase) {   // quemado en el año y o en los `desfase` años anteriores
  var out = null;
  for (var d = 0; d <= desfase; d++) {
    var f = fuegoAño(y - d);
    if (f) out = out ? out.or(f) : f;
  }
  return out;
}

// Corrección por incendios sobre la serie cs (una imagen 'clase' por año de `años`).
// Se sigue cada TRAMO de cosechado (años seguidos con clase 4). Si el tramo empieza en un año con incendio (o hasta `desfase` años
// después), todo el tramo vuelve a la ÚLTIMA clase de plantación (pino o eucalipto) que tuvo el píxel antes del tramo, mirando hasta
// FUEGO_ATRAS_MAX años atrás (si en medio hubo "otras" por ruido, se salta). Un cosechado sin pino/euca previo se deja como está:
// cosechado → otras NO ocurre. Devuelve {cs, corr}.
function corregirPorFuego(cs, años, desfase) {
  var out = [], corr = [];
  var prevCos = ee.Image(0), ultPE = ee.Image(0), edad = ee.Image(0), pre = ee.Image(0), flag = ee.Image(0);
  for (var k = 0; k < cs.length; k++) {
    var c = cs[k];
    var salto = k > 0 ? años[k] - años[k - 1] : 1;                // 1 = año consecutivo; >1 = hay años sin exportar
    var pc = salto === 1 ? prevCos : ee.Image(0);                 // un hueco de años corta el tramo de cosechado
    var edadK = edad.add(salto - 1);                              // años transcurridos desde el último pino/euca (1 = el año anterior)
    var cos = c.eq(4).unmask(0);
    var nuevo = cos.and(pc.not());
    var candidato = ultPE.where(edadK.gt(FUEGO_ATRAS_MAX), 0);    // última clase pino/euca, si no es demasiado antigua
    var fw = fuegoVentana(años[k], desfase) || ee.Image(0);
    var preN = ee.Image(0).where(cos.and(pc), pre).where(nuevo, candidato);
    var flagN = ee.Image(0).where(cos.and(pc), flag).where(nuevo, fw);
    var cond = cos.and(flagN).and(preN.gt(0));
    out.push(c.where(cond, preN).rename('clase').toByte());
    corr.push(cond.selfMask());
    var esPE = c.eq(1).or(c.eq(2)).unmask(0);                     // actualiza la memoria con la clase RAW de este año
    ultPE = ultPE.where(esPE, c.unmask(0));
    edad = ee.Image(0).where(esPE, 1).where(esPE.not().and(ultPE.gt(0)), edadK.add(1));
    prevCos = cos; pre = preN; flag = flagN;
  }
  return {cs: out, corr: corr};
}

var SERIE_CACHE = {};
function construirSerie(ver, rell) {
  var fu = leerFuego();
  var clave = ver + '|' + (rell.on ? rell.maxD + rell.prior : 'sin') + '|' + (fu.on ? 'u' + fu.desfase : 'u0');
  if (SERIE_CACHE[clave]) return SERIE_CACHE[clave];
  var años = añosDeVersion(ver);
  var cs = años.map(function (y) { return clasificacionAño(ver, y, rell).select('clase'); });
  var raw = cs;                                    // clasificación SIN corregir (misma cadena y misma escala)
  var corrFuego = cs.map(function () { return ee.Image(0).selfMask(); });
  if (fu.on) { var cf = corregirPorFuego(cs, años, fu.desfase); cs = cf.cs; corrFuego = cf.corr; }
  SERIE_CACHE[clave] = {años: años, out: cs, raw: raw, corrFuego: corrFuego};
  return SERIE_CACHE[clave];
}

// Una sola llamada para todos los años del rango: 9 bandas por año (pino, euca, cosechado, sin dato, rellenado, reclasificado fuego, pino/euca/cosechado SIN corregir)
function calcularSerieFuego(ver, esc, region, rell, rg, clave) {
  var f = construirSerie(ver, rell);
  var area = ee.Image.pixelArea().divide(10000);
  var bandas = [], años = [], ecosTodas = {};
  f.años.forEach(function (y, i) {
    if (y < rg.d || y > rg.h) return;
    var ecos = ecosParaAño(ver, y, rell);
    ecos.forEach(function (e) { ecosTodas[e] = true; });
    var foot = ecos.map(function (e) { return ECO_RASTER.eq(e); }).reduce(function (a, b) { return a.or(b); });
    var A = area.multiply(foot);
    var o = f.out[i], orig = mosaicoSimple(ver, y);
    bandas.push(
      A.multiply(o.eq(1)).unmask(0), A.multiply(o.eq(2)).unmask(0), A.multiply(o.eq(4)).unmask(0),
      A.multiply(o.mask().not()), A.multiply(o.mask().and(orig ? orig.mask().not() : ee.Image(0))),
      A.multiply(f.corrFuego[i].unmask(0)),
      // misma clasificación SIN corregir, en la misma llamada: comparación exacta (pino, euca, cosechado)
      A.multiply(f.raw[i].eq(1)).unmask(0), A.multiply(f.raw[i].eq(2)).unmask(0), A.multiply(f.raw[i].eq(4)).unmask(0));
    años.push({y: y, ecos: ecos.length});
  });
  if (!años.length) { estado.setValue('La versión ' + ver + ' no tiene años exportados en ese rango.'); CALCULANDO = false; btnCalcular.setDisabled(false); return; }
  var nb = bandas.length;
  var banda = region === 'TOTAL' ? REGIONES.unmask(0) : ee.Image.constant(parseInt(region, 10)).rename('region');
  var img = ee.Image.cat(bandas).addBands(banda);
  var geom = region === 'TOTAL'
    ? ee.FeatureCollection(Object.keys(ecosTodas).map(function (e) { return ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + e); })).flatten().geometry().bounds()
    : geometriaRegion(region);
  var r = img.reduceRegion({
    reducer: ee.Reducer.sum().repeat(nb).group({groupField: nb, groupName: 'region'}),
    geometry: geom, scale: esc, maxPixels: 1e13, tileScale: esc <= 30 ? 16 : esc <= 120 ? 8 : 4
  });
  r.get('groups').evaluate(function (g, err) {
    CALCULANDO = false; btnCalcular.setDisabled(false);
    if (err || !g) { estado.setValue('Falló el cálculo (' + textoSerie() + '): ' + String(err || 'sin resultado').slice(0, 120) + '\nSube la escala o reduce el rango de años.'); return; }
    RES[clave] = {};
    var totalFuego = 0;
    años.forEach(function (a, k) {
      var grupos = {};
      g.forEach(function (it) {
        var b = it.sum.slice(9 * k, 9 * k + 9);       // [pino, euca, cosechado, sinDato, rellenado, reclasificado fuego, pino0, euca0, cosechado0]
        grupos[it.region] = [b[0], b[1], b[2], 0, b[3], b[4], b[5], b[6], b[7], b[8]];
        totalFuego += b[5];
      });
      RES[clave][a.y] = {g: grupos, col2: false, ecos: a.ecos};
    });
    var partes = [];
    if (fuegoCheck.getValue() === true) {
      var sinFuego = años.filter(function (a) { return !FUEGO.porAño[a.y]; }).map(function (a) { return a.y; });
      partes.push('cosechado quemado reclasificado: ' + Math.round(totalFuego).toLocaleString('es-CL') + ' ha (suma de años)' +
        (sinFuego.length ? '\nSin dato de MapBiomas Fuego (no se corrigen): ' + sinFuego.join(', ') : ''));
    }
    estado.setValue('Listo (' + textoSerie() + '). Años: ' + años.length + '\n' + partes.join('\n'));
    dibujar();
  });
}

// Verifica el producto de fuego al activar la corrección; si no se puede leer, apaga la casilla y avisa
function validarFuego() {
  if (sondearFuego()) { avisoFuego.setValue(''); return true; }
  fuegoCheck.setValue(false, false);
  var msg = 'No se pudo usar MapBiomas Fuego: ' + (FUEGO.error || 'error desconocido').slice(0, 300) +
    '\nRevisa ASSET_FUEGO / FUEGO_BANDA / FUEGO_CAMPOS_AÑO al inicio del script.';
  avisoFuego.setValue(msg); estado.setValue(msg); print(msg);
  return false;
}

function rangoAños() {
  var d = parseInt(desdeSelect.getValue(), 10), h = parseInt(hastaSelect.getValue(), 10);
  return {d: Math.min(d, h), h: Math.max(d, h)};
}

function calcularSerie() {
  if (CALCULANDO) return;
  var ver = verSelect.getValue();
  if (!ver) { estado.setValue('No hay versiones exportadas en la carpeta.'); return; }
  var esc = parseInt(escSelect.getValue(), 10);
  var region = regSelect.getValue() || 'TOTAL';
  var rg = rangoAños();
  var rell = leerRelleno();
  var clave = claveRes(ver, esc, region, rell);
  RES[clave] = RES[clave] || {};
  var añosVer = añosDeVersion(ver).filter(function (y) { return y >= rg.d && y <= rg.h; });
  if (!añosVer.length) { estado.setValue('La versión ' + ver + ' no tiene años exportados entre ' + rg.d + ' y ' + rg.h + '.'); return; }
  var pendientes = añosVer.filter(function (y) { return !RES[clave][y]; });
  if (!pendientes.length) { estado.setValue('Ya estaba calculado (' + ver + ' · ' + nombreRegion(region) + ' · ' + esc + ' m · ' + textoRelleno(rell) + ').'); dibujar(); return; }
  if (fuegoCheck.getValue() === true && !validarFuego()) return;
  CALCULANDO = true; DETENER = false;
  btnCalcular.setDisabled(true);
  if (usaSerie()) {
    estado.setValue('Calculando la serie con ' + textoSerie() + ' (una sola llamada, puede tardar) · ' + esc + ' m…');
    RES[clave] = {};
    calcularSerieFuego(ver, esc, region, rell, rg, clave);
    return;
  }
  var fallos = [], siguiente = 0, enCurso = 0, hechos = 0;
  var terminado = false;
  function terminar() {
    if (terminado) return;
    terminado = true;
    CALCULANDO = false; btnCalcular.setDisabled(false);
    estado.setValue((DETENER ? 'Detenido. ' : 'Listo. ') + 'Años calculados: ' + Object.keys(RES[clave]).length +
      (fallos.length ? '\nFallaron (' + fallos.length + '): ' + fallos.join(', ') + ' — reintenta o sube la escala.' : ''));
    dibujar();
  }
  function lanzar() {
    // Hasta CONCURRENCIA años en paralelo: el servidor trabaja varios a la vez
    while (!DETENER && enCurso < CONCURRENCIA && siguiente < pendientes.length) {
      (function (y) {
        enCurso++;
        calcularAño(ver, y, esc, region, rell, function (res, err) {
          enCurso--; hechos++;
          if (res) RES[clave][y] = res; else fallos.push(y + (err ? ' (' + String(err).slice(0, 60) + ')' : ''));
          estado.setValue('Calculados ' + hechos + '/' + pendientes.length + ' · ' + nombreRegion(region) + ' · ' + esc + ' m · ' +
            textoRelleno(rell) + '…');
          if (hechos % 4 === 0) dibujar();     // no redibujar en cada año
          if (enCurso === 0 && (DETENER || siguiente >= pendientes.length)) terminar(); else lanzar();
        });
      })(pendientes[siguiente++]);
    }
    if (enCurso === 0 && (DETENER || siguiente >= pendientes.length)) terminar();
  }
  estado.setValue('Calculando ' + pendientes.length + ' años (' + CONCURRENCIA + ' en paralelo) · ' + esc + ' m…');
  lanzar();
}

// ------------------------------------------------------------------------------------------
// Interfaz
// ------------------------------------------------------------------------------------------
function nota(t) { return ui.Label(t, {fontSize: '10px', color: '#666666', margin: '3px 0 0 0', whiteSpace: 'pre-wrap'}); }
function etiqueta(t) { return ui.Label(t, {fontSize: '10px', fontWeight: 'bold', margin: '6px 0 2px 0'}); }
function nombreRegion(c) {
  if (c === 'TOTAL') return 'Todas las regiones (país)';
  return 'R' + c + (NOMBRES_REGION[c] ? ' · ' + NOMBRES_REGION[c] : '');
}

var verSelect = ui.Select({items: [], placeholder: 'Sin versiones', style: {stretch: 'horizontal'}});
// Qué ver: la clasificación preliminar (silvo_e…) o una de las colecciones de integración. Se muestran siempre las tres opciones.
var FUENTES_VER = [{value: 'pre', label: 'Pre-integración (clasificación preliminar)'}].concat(FUENTES_EXTRA.map(function (f) {
  return {value: f.id, label: f.etiqueta.replace(/^Integración V1 · /, 'Integración · ')};
}));
var fuenteSelect = ui.Select({items: FUENTES_VER, value: 'pre', style: {stretch: 'horizontal'}});
var notaFuente = ui.Label('', {fontSize: '10px', margin: '3px 0 0 0', whiteSpace: 'pre-wrap'});   // estado de la colección elegida (no lo pisa nada más)
var escSelect = ui.Select({
  items: ESCALAS.map(function (e) { return {label: e + ' m' + (e === 30 ? ' (muy lento, cifras finales)' : e >= 500 ? ' (rápido, solo tendencia)' : e === 240 ? ' (rápido)' : ''), value: String(e)}; }),
  value: String(ESCALA_INICIAL), style: {stretch: 'horizontal'}
});
// Lista de regiones: Total + las del diccionario (siempre disponibles) + cualquier código extra que aparezca en el raster
function itemsRegion(extra) {
  var cods = {};
  Object.keys(NOMBRES_REGION).forEach(function (k) { if (+k !== 0) cods[k] = true; });
  (extra || []).forEach(function (k) { cods[k] = true; });
  var orden = Object.keys(cods).map(Number).sort(function (a, b) { return a - b; });
  return [{label: nombreRegion('TOTAL'), value: 'TOTAL'}].concat(orden.map(function (c) { return {label: nombreRegion(c), value: String(c)}; }));
}
var regSelect = ui.Select({items: itemsRegion(), value: 'TOTAL', style: {stretch: 'horizontal'}});
var AÑOS_TODOS = [];
for (var yy = 1996; yy <= 2026; yy++) AÑOS_TODOS.push(String(yy));
var desdeSelect = ui.Select({items: AÑOS_TODOS, value: '1996', style: {width: '110px', margin: '0 8px 0 0'}});
var hastaSelect = ui.Select({items: AÑOS_TODOS, value: '2026', style: {width: '110px', margin: '0'}});
var yearSelect = ui.Select({items: [], placeholder: 'Sin años', style: {width: '110px', margin: '0 4px 0 0'}});
var btnPrev = ui.Button({label: '◀', style: {width: '46px', margin: '0 4px 0 0'}});
var btnNext = ui.Button({label: '▶', style: {width: '46px', margin: '0'}});
var rellenoCheck = ui.Checkbox({label: 'Rellenar huecos con años vecinos (cálculo en la nube, sin exportar)', value: false,
  style: {fontSize: '11px', margin: '2px 0 2px 0'}});
var maxDistBox = ui.Textbox({value: '3', style: {width: '50px', margin: '0 8px 0 0'}});
var prioSelect = ui.Select({
  items: [{label: 'Año anterior primero', value: 'ANTERIOR'}, {label: 'Año siguiente primero', value: 'SIGUIENTE'}],
  value: 'ANTERIOR', style: {width: '170px', margin: '0'}
});
var col2Check = ui.Checkbox({label: 'Incluir línea COL2 (referencia; más lento)', value: false, style: {fontSize: '11px', margin: '2px 0 2px 0'}});
var fuegoCheck = ui.Checkbox({label: 'Cosechado quemado → clase previa al incendio (MapBiomas Fuego)', value: false,
  style: {fontSize: '11px', margin: '2px 0 2px 0'}});
var avisoFuego = ui.Label('', {fontSize: '10px', color: '#C62828', margin: '3px 0 0 0', whiteSpace: 'pre-wrap'});
var desfaseBox = ui.Textbox({value: String(FUEGO_DESFASE_INICIAL), style: {width: '50px', margin: '0 8px 0 0'}});
var btnCalcular = ui.Button({label: 'Calcular serie temporal', style: {stretch: 'horizontal'}});
var btnDetener = ui.Button({label: 'Detener', style: {stretch: 'horizontal', margin: '4px 0 0 0'}});
var btnCsv = ui.Button({label: 'Exportar tabla (CSV a Drive)', style: {stretch: 'horizontal', margin: '4px 0 0 0'}});
var estado = nota('Elige años, región, versión y escala, y presiona "Calcular serie temporal".');
var avisoEcos = nota('');
var panelGraf = ui.Panel({style: {margin: '6px 0 0 0', padding: '0'}});

var panel = ui.Panel({style: {width: '440px', padding: '8px'}});
panel.add(ui.Label('Silvicultura por región · serie temporal', {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}));
panel.add(etiqueta('1) Años a calcular (desde – hasta)'));
panel.add(ui.Panel([desdeSelect, hastaSelect], ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
panel.add(etiqueta('2) Región (o clic en el mapa)')); panel.add(regSelect);
panel.add(etiqueta('3) Qué quieres ver (fuente · versión)')); panel.add(fuenteSelect); panel.add(verSelect); panel.add(notaFuente);
panel.add(etiqueta('4) Escala de cálculo')); panel.add(escSelect);
panel.add(nota('500–1000 m: muy rápido, ideal para ver la tendencia (usa la pirámide del asset; minimiza lo pequeño). 30–90 m: cifras más exactas pero lento.'));
panel.add(col2Check);
panel.add(etiqueta('5) Relleno de huecos (opcional)'));
panel.add(rellenoCheck);
panel.add(ui.Panel([ui.Label('Distancia máx. (años)', {fontSize: '10px', margin: '6px 4px 0 0'}), maxDistBox, prioSelect],
  ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
panel.add(etiqueta('6) Corrección por incendios (opcional)'));
panel.add(fuegoCheck); panel.add(avisoFuego);
panel.add(ui.Panel([ui.Label('Desfase máx. incendio → cosechado (años)', {fontSize: '10px', margin: '6px 4px 0 0'}), desfaseBox],
  ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
panel.add(nota('Si un tramo de cosechado empieza el año de un incendio (o hasta N años después), todo el tramo vuelve a su último pino/eucalipto previo (cosechado nunca pasa a otras).'));
panel.add(btnCalcular); panel.add(btnDetener);
panel.add(estado); panel.add(avisoEcos);
panel.add(etiqueta('Año en el mapa'));
panel.add(ui.Panel([yearSelect, btnPrev, btnNext], ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
panel.add(btnCsv);
panel.add(panelGraf);
ui.root.insert(0, panel);

// ------------------------------------------------------------------------------------------
// Gráficos
// ------------------------------------------------------------------------------------------
function sumaRegiones(g, region) {
  if (region !== 'TOTAL') return g[region] || null;
  var s = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  Object.keys(g).forEach(function (k) { for (var j = 0; j < 10; j++) s[j] += (g[k][j] || 0); });
  return s;
}

// Tabla para ui.Chart (todo en el cliente: sin ee.FeatureCollection ni llamadas al servidor por cada gráfico).
// Columnas con tipo explícito (texto + números): evita "All series on a given axis must be of the same data type".
function tablaChart(rows, xkey, props) {
  return {
    cols: [{id: 'x', label: xkey, type: 'string'}].concat(props.map(function (p, i) { return {id: 's' + i, label: p, type: 'number'}; })),
    rows: rows.map(function (r) {
      return {c: [{v: String(r[xkey])}].concat(props.map(function (p) {
        return {v: (r[p] === undefined || r[p] === null || isNaN(r[p])) ? null : Number(r[p])};
      }))};
    })
  };
}

function lineas(rows, props, colores, titulo, dash) {
  // Solo las series que tienen al menos un dato (una columna vacía rompe el gráfico)
  var idx = [];
  props.forEach(function (p, i) {
    if (rows.some(function (r) { return r[p] !== undefined && r[p] !== null; })) idx.push(i);
  });
  props = idx.map(function (i) { return props[i]; });
  colores = idx.map(function (i) { return colores[i]; });
  dash = dash ? idx.map(function (i) { return dash[i]; }) : dash;
  var series = {};
  props.forEach(function (p, i) { series[i] = {color: colores[i], lineWidth: 2, pointSize: 2}; if (dash && dash[i]) series[i].lineDashStyle = [4, 3]; });
  return ui.Chart(tablaChart(rows, 'año', props), 'LineChart', {
    title: titulo, series: series, legend: {position: 'bottom', textStyle: {fontSize: 10}},
    vAxis: {title: 'ha', viewWindow: {min: 0}, format: 'short'}, hAxis: {slantedText: true, slantedTextAngle: 60, textStyle: {fontSize: 9}},
    chartArea: {left: 60, right: 10, top: 30, bottom: 70}, height: 260
  });
}

function dibujar() {
  panelGraf.clear();
  var ver = verSelect.getValue(), esc = parseInt(escSelect.getValue(), 10);
  var region = regSelect.getValue() || 'TOTAL';
  var rg = rangoAños();
  var rell = leerRelleno();
  var datos = (RES[claveRes(ver, esc, region, rell)]) || {};
  var años = Object.keys(datos).map(Number).filter(function (y) { return y >= rg.d && y <= rg.h; })
    .sort(function (a, b) { return a - b; });
  if (!años.length) {
    panelGraf.add(nota('Sin resultados para ' + ver + ' · ' + nombreRegion(region) + ' · ' + esc + ' m · ' + textoRelleno(rell) + ' · ' + rg.d + '–' + rg.h +
      '.\nPresiona "Calcular serie temporal".'));
    return;
  }
  var orden = [];
  años.forEach(function (y) { Object.keys(datos[y].g).forEach(function (k) { if (orden.indexOf(+k) < 0) orden.push(+k); }); });
  orden.sort(function (a, b) { return a - b; });

  var rows = [], efecto = [];
  años.forEach(function (y) {
    var s = sumaRegiones(datos[y].g, region);
    if (!s) return;
    var r = {'año': String(y), 'Pino': s[0], 'Eucalipto': s[1], 'Cosechado': s[2],
      'Total silvicultura (pino + euca + cosechado)': s[0] + s[1] + s[2]};
    if (datos[y].col2) r['COL2 plantación (9)'] = s[3];
    if (fuegoCheck.getValue() === true && s[6] !== undefined) r['Cosechado quemado reclasificado'] = s[6];
    if (fuegoCheck.getValue() === true && s[7] !== undefined) {   // efecto de la corrección = corregido − sin corregir (misma llamada)
      var dP = s[0] - s[7], dE = s[1] - s[8], dC = s[2] - s[9];
      efecto.push({'año': String(y), 'Δ Pino': dP, 'Δ Eucalipto': dE, 'Δ Cosechado': dC, 'Δ pasa a otras': -(dP + dE + dC)});
    }
    if (REFERENCIA_HA && REFERENCIA_HA[region] && REFERENCIA_HA[region][y] !== undefined) r['Referencia propia'] = REFERENCIA_HA[region][y];
    rows.push(r);
  });
  if (!rows.length) { panelGraf.add(nota('Esa región no tiene plantaciones ni datos en los años calculados.')); return; }

  var props = ['Pino', 'Eucalipto', 'Cosechado', 'Total silvicultura (pino + euca + cosechado)', 'COL2 plantación (9)', 'Cosechado quemado reclasificado'];
  var colores = ['#1B5E20', '#C0CA33', '#8D6E63', '#000000', '#E040FB', '#FF6D00'];
  var dash = [false, false, false, true, true, true];
  if (REFERENCIA_HA) { props.push('Referencia propia'); colores.push('#FF6D00'); dash.push(true); }
  panelGraf.add(lineas(rows, props, colores, nombreRegion(region) + ' · ha por año (' + etiquetaVersion(ver) + ' · ' + textoRelleno(rell) +
    (usaSerie() ? ' · ' + textoSerie() : '') + ')', dash));

  if (efecto.length) {
    panelGraf.add(ui.Chart(tablaChart(efecto, 'año', ['Δ Pino', 'Δ Eucalipto', 'Δ Cosechado', 'Δ pasa a otras']), 'ColumnChart', {
      title: 'Efecto de la corrección por incendios (ha): corregido − sin corregir', isStacked: true,
      colors: ['#1B5E20', '#C0CA33', '#8D6E63', '#9E9E9E'], legend: {position: 'bottom', textStyle: {fontSize: 10}},
      vAxis: {format: 'short', title: 'ha'}, hAxis: {slantedText: true, slantedTextAngle: 60, textStyle: {fontSize: 9}},
      chartArea: {left: 60, right: 10, top: 30, bottom: 70}, height: 240
    }));
    panelGraf.add(nota('Pino/euca/cosechado "sin corregir" salen de la MISMA llamada (misma escala y relleno), así que la diferencia es solo la corrección. Δ > 0 = gana; "pasa a otras" = hectáreas cuyo estado previo al incendio era otras.'));
  }

  // Ranking por región del año elegido en el mapa (solo si se calculó "Todas las regiones")
  var yr = parseInt(yearSelect.getValue(), 10);
  if (region === 'TOTAL' && datos[yr]) {
    var rk = orden.filter(function (c) { return c !== 0 && datos[yr].g[c]; }).map(function (c) {
      var s = datos[yr].g[c];
      return {'región': nombreRegion(c), 'Pino': s[0], 'Eucalipto': s[1], 'Cosechado': s[2]};
    }).filter(function (r) { return r['Pino'] + r['Eucalipto'] + r['Cosechado'] > 0; })
      .sort(function (a, b) { return (b['Pino'] + b['Eucalipto'] + b['Cosechado']) - (a['Pino'] + a['Eucalipto'] + a['Cosechado']); });
    if (rk.length) {
      panelGraf.add(ui.Chart(tablaChart(rk, 'región', ['Pino', 'Eucalipto', 'Cosechado']), 'BarChart', {
        title: 'Pino, eucalipto y cosechado por región · ' + yr + ' (ha)', isStacked: true, colors: ['#1B5E20', '#C0CA33', '#8D6E63'],
        legend: {position: 'bottom', textStyle: {fontSize: 10}}, hAxis: {format: 'short'},
        chartArea: {left: 130, right: 10, top: 30, bottom: 40}, height: Math.max(180, 26 * rk.length + 70)
      }));
    }
    // Un ranking por clase: solo pino y solo eucalipto, cada uno ordenado de mayor a menor
    [{idx: 0, nombre: 'Pino', color: '#1B5E20'}, {idx: 1, nombre: 'Eucalipto', color: '#C0CA33'}].forEach(function (cl) {
      var rc = orden.filter(function (c) { return c !== 0 && datos[yr].g[c]; }).map(function (c) {
        var o = {'región': nombreRegion(c)}; o[cl.nombre] = datos[yr].g[c][cl.idx]; return o;
      }).filter(function (r) { return r[cl.nombre] > 0; })
        .sort(function (a, b) { return b[cl.nombre] - a[cl.nombre]; });
      if (!rc.length) return;
      panelGraf.add(ui.Chart(tablaChart(rc, 'región', [cl.nombre]), 'BarChart', {
        title: cl.nombre + ' por región · ' + yr + ' (ha)', colors: [cl.color], legend: {position: 'none'}, hAxis: {format: 'short'},
        chartArea: {left: 130, right: 10, top: 30, bottom: 40}, height: Math.max(180, 26 * rc.length + 70)
      }));
    });
  }

  // Aviso si faltan ecorregiones en algunos años
  var maxE = Math.max.apply(null, años.map(function (y) { return datos[y].ecos; }));
  var menos = años.filter(function (y) { return datos[y].ecos < maxE; });
  avisoEcos.setValue(menos.length
    ? 'OJO: en ' + menos.join(', ') + ' hay menos ecorregiones exportadas (' + maxE + ' en el resto); esas caídas pueden ser por eso.'
    : '');
  var sinCol2 = col2Check.getValue() === true ? años.filter(function (y) { return !datos[y].col2; }) : [];
  if (sinCol2.length) panelGraf.add(nota('Sin COL2 en: ' + sinCol2.join(', ') + ' (fuera del rango de la Colección 2).'));
  if (parseInt(escSelect.getValue(), 10) > 30) panelGraf.add(nota('Cifras a ' + esc + ' m: aproximadas. Para valores finales calcula a 30 m.'));
}

// ------------------------------------------------------------------------------------------
// Mapa
// ------------------------------------------------------------------------------------------
var vacia = ee.Image(0).selfMask();
var capaClasif = ui.Map.Layer(vacia, VIS_CLASIF, 'Clasificación (todas las ecorregiones)', true);
var capaFuegoCorr = ui.Map.Layer(vacia, {palette: ['FF6D00']}, 'Cosechado quemado reclasificado (MapBiomas Fuego)', true);
var capaFuego = ui.Map.Layer(vacia, {palette: ['000000']}, 'Área quemada del año (MapBiomas Fuego)', false, 0.6);
var capaRell = ui.Map.Layer(vacia, {min: 1, max: 4, palette: ['00E5FF', '2979FF', 'AA00FF', 'FF1744']},
  'Píxeles rellenados (distancia en años)', true);
var capaCol2 = ui.Map.Layer(vacia, {palette: ['E040FB']}, 'COL2 plantación (9)', false, 0.5);
var capaRegiones = ui.Map.Layer(REGIONES.randomVisualizer(), {}, 'Regiones (nivel político 2)', false, 0.35);
var capaSel = ui.Map.Layer(vacia, {}, 'Región seleccionada', true);
[capaRegiones, capaClasif, capaRell, capaFuego, capaFuegoCorr, capaCol2, capaSel].forEach(function (c) { Map.layers().add(c); });
Map.setCenter(-72.5, -37.5, 6);

function actualizarMapa() {
  var ver = verSelect.getValue(), y = parseInt(yearSelect.getValue(), 10);
  if (!ver || isNaN(y)) { capaClasif.setEeObject(vacia); capaRell.setEeObject(vacia); capaFuegoCorr.setEeObject(vacia); capaFuego.setEeObject(vacia); capaCol2.setEeObject(vacia); return; }
  var rell = leerRelleno();
  var c = clasificacionAño(ver, y, rell);
  if (c) capaClasif.setEeObject(c.select('clase'));
  capaRell.setEeObject(c && rell.on ? c.select('dist').selfMask() : vacia);
  capaFuegoCorr.setEeObject(vacia);
  capaFuego.setEeObject(vacia);
  if (fuegoCheck.getValue() === true && !validarFuego()) return;
  if (fuegoCheck.getValue() === true) { var fq = fuegoAño(y); capaFuego.setEeObject(fq ? fq.selfMask() : vacia); }
  if (usaSerie() && c) {                                  // clasificación corregida de ese año (usa toda la serie)
    var f = construirSerie(ver, rell), ix = f.años.indexOf(y);
    if (ix >= 0) { capaClasif.setEeObject(f.out[ix]); capaFuegoCorr.setEeObject(f.corrFuego[ix]); }
  }
  var k = col2PlantacionExacto(y);
  capaCol2.setEeObject(k ? k.selfMask() : vacia);
  capaClasif.setName('Clasificación ' + y + ' (' + etiquetaVersion(ver) + ' · ' + textoRelleno(rell) + (usaSerie() ? ' · ' + textoSerie() : '') + ')');
}

function actualizarSeleccion() {
  var r = regSelect.getValue();
  capaSel.setEeObject(!r || r === 'TOTAL' ? vacia :
    REGIONES_VEC.filter(ee.Filter.eq(CAMPO_ID_REGION, parseInt(r, 10))).style({color: 'FFFF00', fillColor: 'FFFF0033', width: 2}));
}

function llenarVersiones() {
  var fuente = fuenteSelect.getValue() || 'pre';
  var vs = todasVersiones();
  var items, inicial = null;
  notaFuente.setValue('');
  if (fuente === 'pre') {
    var pre = vs.filter(function (v) { return !esExtra(v); });             // por defecto, la última versión preliminar
    items = pre.map(function (v) { return {label: v, value: v}; });
    if (pre.length) inicial = pre[pre.length - 1];
  } else {                                                                 // integración: una sola "versión" (la de la ruta, ej. V1)
    var f = FUENTES_EXTRA.filter(function (x) { return x.id === fuente; })[0];
    var vr = f && f.raiz.match(/INTEGRATION\/([^\/]+)\//);
    items = vs.indexOf(fuente) >= 0 ? [{label: vr ? vr[1] : 'única', value: fuente}] : [];
    var inf = FUENTES_INFO[fuente] || {avisos: [], ecos: {}, años: {}, imagenes: 0};
    var ays = Object.keys(inf.años).map(Number).sort(function (a, b) { return a - b; });
    if (items.length) {
      inicial = fuente;
      notaFuente.style().set('color', '#2E7D32');
      notaFuente.setValue(inf.imagenes + ' imágenes · ecorregiones ' + Object.keys(inf.ecos).map(Number).sort(function (a, b) { return a - b; }).join(', ') +
        ' · años ' + ays[0] + '–' + ays[ays.length - 1] + (inf.avisos.length ? '\n' + inf.avisos.join('\n') : ''));
    } else {
      notaFuente.style().set('color', '#C62828');
      notaFuente.setValue('No se pudo leer esta colección (' + (f ? f.raiz : fuente) + ').\n' + (inf.avisos.join('\n') || 'No hay detalle: revisa la consola.'));
    }
  }
  verSelect.items().reset(items);
  verSelect.setValue(inicial, false);                                      // null si no hay nada que mostrar
}
function llenarAños() {
  var ver = verSelect.getValue();
  var ys = ver ? añosDeVersion(ver) : [];
  yearSelect.items().reset(ys.map(String));
  yearSelect.setValue(ys.length ? String(ys[ys.length - 1]) : null, false);
}

verSelect.onChange(function () { llenarAños(); actualizarMapa(); dibujar(); });
fuenteSelect.onChange(function () { llenarVersiones(); llenarAños(); actualizarMapa(); dibujar(); });
escSelect.onChange(function () { dibujar(); });
function alCambiarRelleno() { actualizarMapa(); dibujar(); }
rellenoCheck.onChange(alCambiarRelleno);
fuegoCheck.onChange(alCambiarRelleno);
desfaseBox.onChange(alCambiarRelleno);
prioSelect.onChange(alCambiarRelleno);
maxDistBox.onChange(alCambiarRelleno);
desdeSelect.onChange(function () { dibujar(); });
hastaSelect.onChange(function () { dibujar(); });
yearSelect.onChange(function () { actualizarMapa(); dibujar(); });
regSelect.onChange(function () { actualizarSeleccion(); dibujar(); });
function moverAño(d) {
  var ver = verSelect.getValue(); if (!ver) return;
  var ys = añosDeVersion(ver), i = ys.indexOf(parseInt(yearSelect.getValue(), 10));
  var j = Math.max(0, Math.min(ys.length - 1, i + d));
  yearSelect.setValue(String(ys[j]));
}
btnPrev.onClick(function () { moverAño(-1); });
btnNext.onClick(function () { moverAño(1); });
btnCalcular.onClick(calcularSerie);
btnDetener.onClick(function () { DETENER = true; });

Map.onClick(function (c) {
  // Compara el código del raster con el FEATURE_ID del vector en ese punto (para validar los nombres)
  var pt = ee.Geometry.Point([c.lon, c.lat]);
  var v1 = REGIONES.reduceRegion({reducer: ee.Reducer.first(), geometry: pt, scale: 30}).get('region');
  var f = REGIONES_VEC.filterBounds(pt).first();
  ee.Dictionary({raster: v1, props: ee.Algorithms.If(f, ee.Feature(f).toDictionary(), null)}).evaluate(function (d) {
    if (!d) { estado.setValue('Sin resultado en ese punto.'); return; }
    var vec = d.props ? d.props[CAMPO_ID_REGION] : null;
    var nombres = [];
    if (d.props) Object.keys(d.props).forEach(function (k) { if (typeof d.props[k] === 'string' && nombres.length < 3) nombres.push(k + ': ' + d.props[k]); });
    var v = (vec !== null && vec !== undefined) ? vec : d.raster;
    if (v === null || v === undefined) { estado.setValue('Ese punto no tiene región.'); return; }
    var cur = regSelect.items().getJsArray();
    var existe = cur.some(function (it) { return (it.value !== undefined ? it.value : it) === String(v); });
    if (!existe) { cur.push({label: nombreRegion(v), value: String(v)}); regSelect.items().reset(cur); }
    regSelect.setValue(String(v));
    estado.setValue('Punto → raster: ' + d.raster + ' · vector ' + CAMPO_ID_REGION + ': ' + vec +
      (nombres.length ? ' (' + nombres.join(', ') + ')' : '') +
      (vec !== null && vec !== undefined && d.raster !== vec ? '\nOJO: raster y vector NO coinciden; para "Todas las regiones" el ranking usa el código del raster.' : '') +
      '\nPresiona "Calcular serie temporal" para esa región.');
  });
});

// ------------------------------------------------------------------------------------------
// Exportar tabla con lo calculado
// ------------------------------------------------------------------------------------------
btnCsv.onClick(function () {
  var ver = verSelect.getValue(), esc = parseInt(escSelect.getValue(), 10);
  var region = regSelect.getValue() || 'TOTAL';
  var rell = leerRelleno();
  var datos = RES[claveRes(ver, esc, region, rell)] || {};
  var rg = rangoAños();
  var años = Object.keys(datos).map(Number).filter(function (y) { return y >= rg.d && y <= rg.h; }).sort(function (a, b) { return a - b; });
  if (!años.length) { estado.setValue('Primero calcula la serie para esta combinación.'); return; }
  var feats = [];
  años.forEach(function (y) {
    Object.keys(datos[y].g).forEach(function (c) {
      var s = datos[y].g[c];
      var p = {region: +c, region_nombre: NOMBRES_REGION[c] || '', año: y, pino_ha: s[0], euca_ha: s[1],
        pino_euca_ha: s[0] + s[1], cosechado_ha: s[2], total_silvicultura_ha: s[0] + s[1] + s[2], sin_dato_ha: s[4], rellenado_ha: s[5], reclasificado_fuego_ha: s[6] || 0, pino_sin_corregir_ha: s[7] || 0, euca_sin_corregir_ha: s[8] || 0, cosechado_sin_corregir_ha: s[9] || 0,
        relleno: textoRelleno(rell),
        correccion_fuego: fuegoCheck.getValue() === true ? 1 : 0, fuego_desfase: fuegoCheck.getValue() === true ? leerFuego().desfase : -1,
        version: ver, escala_m: esc};
      if (datos[y].col2) p.col2_plantacion_ha = s[3];
      feats.push(ee.Feature(null, p));
    });
  });
  var nombre = 'silvo_regiones_' + ver + '_' + (region === 'TOTAL' ? 'pais' : 'R' + region) + '_' + esc + 'm' + (rell.on ? '_rell' + rell.maxD : '') +
    (fuegoCheck.getValue() === true ? '_fuego' + leerFuego().desfase : '');
  Export.table.toDrive({collection: ee.FeatureCollection(feats), description: nombre, fileNamePrefix: nombre, fileFormat: 'CSV'});
  estado.setValue('Tarea creada: ' + nombre + ' (' + feats.length + ' filas). Lánzala en la pestaña Tasks.');
});

// ------------------------------------------------------------------------------------------
// Inicio
// ------------------------------------------------------------------------------------------
llenarVersiones();
llenarAños();
actualizarMapa();
FUENTES_EXTRA.forEach(function (f) {
  var i = FUENTES_INFO[f.id];
  if (i && !Object.keys(i.años).length) estado.setValue('No se pudo leer «' + f.etiqueta + '» (no aparece en el selector). Revisa la consola: ahí está el detalle.');
});
if (!todasVersiones().length) estado.setValue('No hay clasificaciones exportadas (silvo_e{eco}_{año}_{versión}) en la carpeta.');
