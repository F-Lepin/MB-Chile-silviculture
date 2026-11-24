// ==========================================================================================
// SCRIPT: revisar_versiones_conaf
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// PREGUNTA: ¿en qué ecorregiones la versión más alta de cada año NO trae las filas CONAF
// que sí están en una versión anterior (el problema que había en E8)?
//
// Solo mira las tablas sample_silvo_e{eco}_{año}_v{n} de SAMPLES_TRIMESTRAL.
// Para cada ecorregión y año con más de una versión cuenta las filas por 'origen' de cada versión.
// Una consulta pequeña por ecorregión, una tras otra. E8 se incluye como CONTROL (debe salir marcada).
//
// LECTURA DEL RESULTADO
//   "FALTAN CONAF"  → la versión más alta tiene menos filas CONAF que una anterior: hay que fusionar
//                     (agregar la ecorregión a ECOS_FUSION_VERSIONES del visor y re-exportar su maestra).
//   "ok"            → la versión más alta ya incluye las filas CONAF de las anteriores.
//   Si una ecorregión no tiene años con más de una versión, no hay nada que revisar.
// ==========================================================================================

var ECOS = [7, 8, 9, 10, 11];
var CARPETA_TABLAS = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_TRIMESTRAL';
var UMBRAL = 1;   // filas CONAF de diferencia a partir de las cuales se marca (la anterior debe tener al menos esto más)

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

// ------------------------------------------------------------------------------------------
// 1) Catálogo (solo lista de nombres, sin leer datos)
// ------------------------------------------------------------------------------------------
var re = /^sample_silvo_e(\d+)_(\d{4})_v(\d+)$/i;
var porEcoYr = {};   // porEcoYr[eco][yr] = [{id, v}]
listarCarpeta(CARPETA_TABLAS).forEach(function (a) {
  if (a.type !== 'TABLE') return;
  var id = a.id || a.name;
  var m = id.split('/').pop().match(re);
  if (!m) return;
  var eco = +m[1], yr = +m[2];
  if (ECOS.indexOf(eco) < 0) return;
  porEcoYr[eco] = porEcoYr[eco] || {};
  (porEcoYr[eco][yr] = porEcoYr[eco][yr] || []).push({id: id, v: +m[3]});
});

var multi = {};   // multi[eco] = [yr, ...] con más de una versión
ECOS.forEach(function (e) {
  multi[e] = Object.keys(porEcoYr[e] || {}).map(Number).filter(function (y) { return porEcoYr[e][y].length > 1; }).sort();
});

var resumenLineas = ECOS.map(function (e) {
  var total = Object.keys(porEcoYr[e] || {}).length;
  return 'E' + e + ': ' + total + ' años con tabla silvo · ' + multi[e].length + ' con más de una versión';
});
print(ui.Label('Catálogo\n' + resumenLineas.join('\n'), {whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '11px'}));

// ------------------------------------------------------------------------------------------
// 2) Conteo por origen, una ecorregión por consulta
// ------------------------------------------------------------------------------------------
function esConaf(k) { return String(k).toLowerCase() === 'conaf'; }
function nConaf(h) { var s = 0; Object.keys(h || {}).forEach(function (k) { if (esConaf(k)) s += h[k]; }); return s; }
function nTotal(h) { var s = 0; Object.keys(h || {}).forEach(function (k) { s += h[k]; }); return s; }

var cola = ECOS.filter(function (e) { return multi[e].length > 0; });
var hallazgos = [];   // ecorregiones marcadas

function construirConsulta(eco) {
  var d = {};
  multi[eco].forEach(function (y) {
    porEcoYr[eco][y].forEach(function (t) {
      d[y + '|' + t.v] = ee.FeatureCollection(t.id).aggregate_histogram('origen');
    });
  });
  return ee.Dictionary(d);
}

function procesar(eco, res) {
  var lineas = [], marcados = [];
  multi[eco].forEach(function (y) {
    var vs = porEcoYr[eco][y].map(function (t) { return t.v; }).sort(function (a, b) { return b - a; });
    var alta = vs[0];
    var hAlta = res[y + '|' + alta] || {};
    var cAlta = nConaf(hAlta);
    var peor = 0, vPeor = null;
    var detalle = ['v' + alta + ': ' + nTotal(hAlta) + ' (CONAF ' + cAlta + ')'];
    vs.slice(1).forEach(function (v) {
      var h = res[y + '|' + v] || {};
      var c = nConaf(h);
      detalle.push('v' + v + ': ' + nTotal(h) + ' (CONAF ' + c + ')');
      if (c - cAlta > peor) { peor = c - cAlta; vPeor = v; }
    });
    var falta = peor >= UMBRAL;
    if (falta) marcados.push(y);
    lineas.push(y + '  ' + (falta ? 'FALTAN CONAF (+' + peor + ' en v' + vPeor + ')  ' : 'ok  ') + detalle.join('  ·  '));
  });
  var cab = '=== E' + eco + ': ' + marcados.length + ' de ' + multi[eco].length + ' años con más de una versión están marcados' +
    (marcados.length ? '  → REVISAR / FUSIONAR' : '  → sin problema') + ' ===';
  if (marcados.length) hallazgos.push(eco);
  print(ui.Label(cab + '\n' + lineas.join('\n'), {whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '10px'}));
}

function siguiente() {
  if (!cola.length) {
    print(ui.Label('RESUMEN: ' + (hallazgos.length
      ? 'ecorregiones a fusionar → E' + hallazgos.join(', E') + '  (E8 ya está corregida en el visor)'
      : 'ninguna ecorregión marcada'),
      {fontWeight: 'bold', fontSize: '12px'}));
    return;
  }
  var eco = cola.shift();
  construirConsulta(eco).evaluate(function (res, err) {
    if (err) print('E' + eco + ': error → ' + err);
    else procesar(eco, res);
    siguiente();
  });
}
print('Consultando ' + cola.length + ' ecorregión(es), una tras otra…');
siguiente();
