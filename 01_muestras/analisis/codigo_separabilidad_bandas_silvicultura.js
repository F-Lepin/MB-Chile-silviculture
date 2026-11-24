// ==========================================================================================
// SCRIPT: separabilidad_bandas_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// PREGUNTA: ¿qué bandas / índices / trimestres separan mejor PINO de EUCALIPTO?
// Lee las tablas maestras (train_master_e{eco}_v1, solo clases 1 y 2) y, para cada predictor,
// por ecorregión y por periodo, calcula:
//   s   = 2·(AUC − 0.5)     separabilidad firmada: + si el valor es mayor en pino, − si es mayor en eucalipto
//                           (0 = no separa · ±0.4 moderada · ±0.7 fuerte)
//   d   = d de Cohen         diferencia de medias / desviación estándar combinada
// Se hace POR ECORREGIÓN para que la geografía no se confunda con la especie (pino y eucalipto
// no están repartidos igual entre ecorregiones). Luego se resume entre ecorregiones.
//
// Salida: ranking de los 25 mejores predictores por periodo (con el valor en cada ecorregión y si
// el signo es consistente) y un gráfico de separabilidad por banda × trimestre.
//
// CUIDADO AL LEER: los puntos de un mismo polígono se parecen entre sí, así que el AUC por punto es
// más optimista que el AUC por polígono. Sirve para ORDENAR predictores, no como exactitud final.
// ==========================================================================================

// Versión liviana: por defecto UNA ecorregión y UN periodo, y las consultas van una tras otra.
// Cuando funcione, agrega ecorregiones ([8, 9, 10, 11]) y el periodo [1996, 2012].
var ECOS = [8];
var VERSION = 'v1';                       // maestra sin agro (los puntos de pino/euca son los mismos en v2)
var N_POR_CLASE = 400;                    // puntos por clase, por ecorregión y periodo
var PERIODOS = [[2013, 2026]];
var CARPETA_MAESTRA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_COL3/SILVICULTURE/MODEL_SAMPLES';

// ------------------------------------------------------------------------------------------
// Predictores (mismos nombres que la tabla maestra)
// ------------------------------------------------------------------------------------------
var PREFIJO = 'q_';
var Q = ['Q1_', 'Q2_', 'Q3_', 'Q4_'];
var ESPECTRALES = ['blue_median', 'green_median', 'red_median', 'nir_median', 'swir1_median', 'swir2_median'];
var INDICES = ['ndvi', 'ndmi', 'nbr', 'evi2'];
var ANUALES = ['ndmi_amp', 'ndmi_max', 'ndmi_min', 'ndvi_amp', 'ndvi_max', 'q_ndmi_max', 'q_ndvi_max', 'hand', 'twi'];

var BANDAS = [];
Q.forEach(function (q) {
  ESPECTRALES.forEach(function (b) { BANDAS.push(PREFIJO + q + b); });
  INDICES.forEach(function (b) { BANDAS.push(PREFIJO + q + b); });
});
ANUALES.forEach(function (b) { BANDAS.push(PREFIJO + b); });

function existe(id) {
  try { ee.data.getAsset(id); return true; } catch (e) { return false; }
}

// ------------------------------------------------------------------------------------------
// Muestra balanceada: N pinos + N eucaliptos de una ecorregión y un periodo
// ------------------------------------------------------------------------------------------
// Sin ordenar: 'azar_pt' es uniforme en [0,1), así que un corte por valor da una muestra aleatoria barata.
var FRACCION = 0.25;   // se toma ~25 % de cada estrato y luego se limita a N_POR_CLASE
function muestra(eco, p) {
  var d = ee.FeatureCollection(CARPETA_MAESTRA + '/train_master_e' + eco + '_' + VERSION)
    .filter(ee.Filter.and(ee.Filter.gte('yr', p[0]), ee.Filter.lte('yr', p[1]), ee.Filter.lt('azar_pt', FRACCION)));
  var tomar = function (c) { return d.filter(ee.Filter.eq('clase', c)).limit(N_POR_CLASE); };
  return tomar(1).merge(tomar(2)).select(BANDAS.concat(['clase']), null, false);
}

// ------------------------------------------------------------------------------------------
// Estadística en el cliente
// ------------------------------------------------------------------------------------------
function media(a) { var s = 0; a.forEach(function (v) { s += v; }); return s / a.length; }
function varianza(a, m) { var s = 0; a.forEach(function (v) { s += (v - m) * (v - m); }); return s / Math.max(1, a.length - 1); }

// AUC = P(a > b) + 0.5 P(a = b), con rangos promedio para empates
function auc(a, b) {
  var todo = a.map(function (v) { return [v, 1]; }).concat(b.map(function (v) { return [v, 0]; }));
  todo.sort(function (x, y) { return x[0] - y[0]; });
  var sumaA = 0, i = 0;
  while (i < todo.length) {
    var j = i;
    while (j + 1 < todo.length && todo[j + 1][0] === todo[i][0]) j++;
    var rango = (i + j) / 2 + 1;
    for (var k = i; k <= j; k++) if (todo[k][1] === 1) sumaA += rango;
    i = j + 1;
  }
  return (sumaA - a.length * (a.length + 1) / 2) / (a.length * b.length);
}

// Devuelve {s, d} para una banda dado un arreglo de filas {clase, valores...}
function separabilidad(filas, banda) {
  var a = [], b = [];
  filas.forEach(function (r) {
    var v = r[banda];
    if (v === null || v === undefined || !isFinite(v)) return;
    (r.clase === 1 ? a : b).push(v);
  });
  if (a.length < 30 || b.length < 30) return null;
  var ma = media(a), mb = media(b);
  var sp = Math.sqrt((varianza(a, ma) + varianza(b, mb)) / 2);
  return {s: 2 * (auc(a, b) - 0.5), d: sp > 0 ? (ma - mb) / sp : 0};
}

function f2(x) { return (x === null || x === undefined || isNaN(x)) ? '  —  ' : (x >= 0 ? ' ' : '') + (Math.round(x * 100) / 100).toFixed(2); }
function rellenar(t, n) { t = String(t); while (t.length < n) t += ' '; return t; }

// ------------------------------------------------------------------------------------------
// Ejecución: una consulta por (ecorregión, periodo)
// ------------------------------------------------------------------------------------------
var ecosOk = ECOS.filter(function (e) {
  var ok = existe(CARPETA_MAESTRA + '/train_master_e' + e + '_' + VERSION);
  if (!ok) print('E' + e + ': no existe train_master_e' + e + '_' + VERSION + ' (omitida)');
  return ok;
});

var resultados = PERIODOS.map(function () { return {}; });   // resultados[periodo][eco] = {banda: {s, d}}

var cola = [];
PERIODOS.forEach(function (p, ip) { ecosOk.forEach(function (eco) { cola.push({p: p, ip: ip, eco: eco}); }); });
var total = cola.length;

print('Calculando… ' + total + ' consulta(s) pequeña(s), una tras otra. Si no aparece "Listo consulta 1", el problema está ' +
      'en la lectura de la tabla maestra y no en el análisis.');

function siguiente() {
  if (!cola.length) { mostrar(); return; }
  var t = cola.shift();
  muestra(t.eco, t.p).evaluate(function (fc, err) {
    var n = 0;
    if (err) print('E' + t.eco + ' ' + t.p[0] + '–' + t.p[1] + ': error → ' + err);
    else if (fc && fc.features && fc.features.length) {
      var filas = fc.features.map(function (f) { return f.properties; });
      n = filas.length;
      var porBanda = {};
      BANDAS.forEach(function (bd) { porBanda[bd] = separabilidad(filas, bd); });
      resultados[t.ip][t.eco] = porBanda;
    }
    print('Listo consulta ' + (total - cola.length) + '/' + total + ' (E' + t.eco + ' ' + t.p[0] + '–' + t.p[1] + ', ' + n + ' puntos)');
    siguiente();
  });
}
siguiente();

// ------------------------------------------------------------------------------------------
// Presentación
// ------------------------------------------------------------------------------------------
function resumenBanda(ip, banda) {
  var valores = [], signos = 0, n = 0;
  ecosOk.forEach(function (e) {
    var r = resultados[ip][e] && resultados[ip][e][banda];
    valores.push(r ? r.s : null);
    if (r) { n++; signos += r.s > 0 ? 1 : (r.s < 0 ? -1 : 0); }
  });
  var utiles = valores.filter(function (v) { return v !== null; });
  var mediaSigned = utiles.length ? media(utiles) : NaN;
  var mediaAbs = utiles.length ? media(utiles.map(Math.abs)) : NaN;
  return {valores: valores, mediaSigned: mediaSigned, mediaAbs: mediaAbs, consistente: n > 0 && Math.abs(signos) === n, n: n};
}

function mostrar() {
  PERIODOS.forEach(function (p, ip) {
    var filas = BANDAS.map(function (b) { var r = resumenBanda(ip, b); r.banda = b; return r; })
      .filter(function (r) { return r.n > 0; })
      .sort(function (x, y) { return y.mediaAbs - x.mediaAbs; });

    var enc = rellenar('predictor', 26) + ecosOk.map(function (e) { return rellenar('E' + e, 6); }).join(' ') +
      '  media|s|  consist.  (+ = mayor en pino)';
    var lineas = filas.slice(0, 25).map(function (r) {
      return rellenar(r.banda.replace(PREFIJO, ''), 26) + r.valores.map(function (v) { return rellenar(f2(v), 6); }).join(' ') +
        '  ' + rellenar(f2(r.mediaAbs), 8) + '  ' + (r.consistente ? 'sí' : 'NO');
    });
    print(ui.Label('=== Periodo ' + p[0] + '–' + p[1] + ' · top 25 por media |s| entre ecorregiones ===\n' +
      enc + '\n' + lineas.join('\n'), {whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '10px'}));

    // Gráfico: separabilidad firmada por banda × trimestre (promedio entre ecorregiones)
    var tipos = ESPECTRALES.map(function (b) { return b.replace('_median', ''); }).concat(INDICES);
    var datos = [['Banda', 'Q1', 'Q2', 'Q3', 'Q4']];
    tipos.forEach(function (t) {
      var fila = [t];
      Q.forEach(function (q) {
        var nombre = PREFIJO + q + (ESPECTRALES.indexOf(t + '_median') >= 0 ? t + '_median' : t);
        var r = resumenBanda(ip, nombre);
        fila.push(isNaN(r.mediaSigned) ? 0 : r.mediaSigned);
      });
      datos.push(fila);
    });
    print(ui.Chart(datos, 'ColumnChart', {
      title: 'Separabilidad pino vs eucalipto por banda y trimestre · ' + p[0] + '–' + p[1] + '  (+ mayor en pino, − mayor en eucalipto)',
      vAxis: {title: 's = 2·(AUC − 0.5)', viewWindow: {min: -1, max: 1}}, hAxis: {title: 'Banda / índice'},
      colors: ['#42A5F5', '#66BB6A', '#FFA726', '#AB47BC'], legend: {position: 'top'}
    }));
  });
  print('Lectura: busca predictores con |s| alto Y consistentes entre ecorregiones; si el mejor ronda |s| < 0.3, ' +
        'las bandas Landsat solas no alcanzan y hay que sumar información (sitio, Sentinel, radar).');
}
