// ==========================================================================================
// SCRIPT: rellenar_huecos_temporal_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// Rellena los huecos de datos (píxeles sin clasificar porque el mosaico no tenía dato) de cada año con la
// clasificación del año más cercano que sí tiene dato en ese píxel. Trabaja sobre clasificaciones YA EXPORTADAS:
//   entrada : silvo_e{eco}_{año}_{VERSION_ENTRADA}
//   salida  : silvo_e{eco}_{año}_{VERSION_SALIDA}   con dos bandas:
//               silvicultura  clase (1 pino, 2 eucalipto, 3 otras, 4 cosechado)
//               anio_origen    año de donde sale cada píxel (= el propio año si no se rellenó)
//
// Orden de relleno: años a distancia 1, luego 2, etc. hasta MAX_DISTANCIA. A igual distancia manda PRIORIDAD
// ('ANTERIOR' usa primero el año previo; 'SIGUIENTE' el posterior). Los píxeles que siguen sin dato después de
// agotar la distancia quedan sin dato.
//
// Uso: ajusta los parámetros, presiona Run y lanza las tareas en la pestaña Tasks. Las salidas que ya existen se omiten.
// ==========================================================================================

var ECOS = [5, 7, 8, 9, 10, 11, 12];  // ecorregiones a procesar (las que no tengan la versión de entrada se omiten)
var VERSION_ENTRADA = 'v3';           // versión exportada por el clasificador (la que tiene huecos)
var VERSION_SALIDA = 'v3_rell';       // versión de salida (con huecos rellenados)
var MAX_DISTANCIA = 3;                // años máximos de distancia para rellenar
var PRIORIDAD = 'ANTERIOR';           // 'ANTERIOR' o 'SIGUIENTE' (a igual distancia)
var CARPETA_SALIDA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';
var BUFFER_KM = 5;   // franja que trae la clasificación de entrada alrededor de la ecorregión (0 = ninguna)
var CARPETA_ECO_VECTOR = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES';

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

// Catálogo: ID[eco][versión][año]
var ID = {};
(function () {
  var re = /^silvo_e(\d+)_(\d{4})_(.+)$/;
  listarCarpeta(CARPETA_SALIDA).forEach(function (a) {
    if (a.type !== 'IMAGE') return;
    var id = a.id || a.name;
    var m = id.split('/').pop().match(re);
    if (!m) return;
    ID[+m[1]] = ID[+m[1]] || {};
    ID[+m[1]][m[3]] = ID[+m[1]][m[3]] || {};
    ID[+m[1]][m[3]][+m[2]] = id;
  });
})();

function existe(id) { try { ee.data.getAsset(id); return true; } catch (e) { return false; } }

// Desplazamientos en el orden de prioridad: [-1, +1, -2, +2, ...] o [+1, -1, +2, -2, ...]
function desplazamientos() {
  var out = [];
  for (var d = 1; d <= MAX_DISTANCIA; d++) {
    if (PRIORIDAD === 'SIGUIENTE') { out.push(d); out.push(-d); } else { out.push(-d); out.push(d); }
  }
  return out;
}

// Imagen de dos bandas (clase, anio_origen) de un año, con huecos rellenados
function rellenado(ids, y) {
  var propio = ee.Image(ids[y]).select(0).rename('silvicultura');
  var out = propio.addBands(ee.Image.constant(y).rename('anio_origen').updateMask(propio.mask()));
  desplazamientos().forEach(function (d) {
    var yy = y + d;
    if (!ids[yy]) return;                                   // ese año no está exportado
    var vecino = ee.Image(ids[yy]).select(0).rename('silvicultura');
    var vecinoAño = ee.Image.constant(yy).rename('anio_origen').updateMask(vecino.mask());
    out = out.unmask(vecino.addBands(vecinoAño));
  });
  return out.select('silvicultura').toByte().addBands(out.select('anio_origen').toInt16());
}

print('Entrada: versión ' + VERSION_ENTRADA + ' → salida ' + VERSION_SALIDA + ' · distancia máx. ' + MAX_DISTANCIA +
      ' · prioridad ' + PRIORIDAD);

ECOS.forEach(function (eco) {
  var ids = ID[eco] && ID[eco][VERSION_ENTRADA];
  if (!ids) { print('E' + eco + ': no hay clasificaciones exportadas de la versión ' + VERSION_ENTRADA + ' (omitida)'); return; }
  var años = Object.keys(ids).map(Number).sort(function (a, b) { return a - b; });
  var region = ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + eco).geometry().bounds().buffer(BUFFER_KM * 1000).bounds();   // incluye la franja de la clasificación con buffer
  var creadas = [], omitidas = [];
  años.forEach(function (y) {
    var nombre = 'silvo_e' + eco + '_' + y + '_' + VERSION_SALIDA;
    var assetId = CARPETA_SALIDA + '/' + nombre;
    if (existe(assetId)) { omitidas.push(y); return; }
    var img = rellenado(ids, y).set({
      year: y, eco: eco, version: VERSION_SALIDA, version_entrada: VERSION_ENTRADA,
      rellenado_max_distancia: MAX_DISTANCIA, rellenado_prioridad: PRIORIDAD
    });
    Export.image.toAsset({
      image: img, description: nombre, assetId: assetId,
      region: region, scale: 30, maxPixels: 1e13,
      pyramidingPolicy: {'.default': 'mode'}
    });
    creadas.push(y);
  });
  print('E' + eco + ' (' + años[0] + '–' + años[años.length - 1] + '): tareas creadas ' + creadas.length +
        (creadas.length ? ' (' + creadas.join(', ') + ')' : '') +
        (omitidas.length ? ' · ya existían ' + omitidas.length : ''));
});
print('Listo. Lanza las tareas en la pestaña Tasks.');
