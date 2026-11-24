// ==========================================================================================
// SCRIPT: diagnostico_ciclos_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// PREGUNTA: ¿se pueden separar pino (79) y eucalipto (80) por su manejo en el tiempo?
// Usa SOLO las tablas revisadas (REVISIONES), a nivel de polígono. No toca mosaicos ni
// clasificaciones, así que corre rápido.
//
// Para cada polígono calcula, con las columnas de la serie temporal:
//   - duración del periodo adulto de cada ciclo COMPLETO (empieza después de 1996 y termina
//     en cosecha). Si hasta_trim no es Q4/vacío, el año 'hasta' no cuenta (misma regla del clasificador).
//   - número de cosechas observadas (ciclo 1 y ciclo 2)
//   - rodales sin cosecha en toda la serie y cuánto llevan adultos (cota mínima: censura a la derecha)
// Y reporta, por grupo (todas, ecorregión, fuente, ecorregión × fuente):
//   - mediana y rango p10–p90 de la duración, por especie
//   - AUC de la duración (probabilidad de que un ciclo de pino dure más que uno de eucalipto)
//     y el mejor umbral simple con su exactitud balanceada
//   - % de polígonos con 2 o más cosechas, % sin cosecha, % sin cosecha con >= MIN_RUN_LARGO años adultos
//
// LECTURA RÁPIDA: AUC ~0.5 = no separa; ~0.7 = separa algo; >= 0.85 = separa bien.
// ==========================================================================================

var ECOS = [7, 8, 9, 10, 11];
var INICIO_SERIE = 1996;     // un ciclo que ya es adulto en este año está censurado a la izquierda
var MIN_RUN_LARGO = 15;
var DETALLE_ECO_FUENTE = false;   // true agrega los bloques ecorregión × fuente (más texto)      // años adultos sin cosecha para considerar "rodal largo"
var CARPETA_REVISIONES = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_COL3/SILVICULTURE/REVISIONES';

// ------------------------------------------------------------------------------------------
// Auxiliares (valores numéricos pueden venir como número, texto o -9999)
// ------------------------------------------------------------------------------------------
function tipo(v) { return ee.String(ee.Algorithms.ObjectType(v)); }

function aNumero(v) {
  return ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(v, null), -9999,
    ee.Algorithms.If(tipo(v).equals('String'),
      ee.Algorithms.If(ee.String(v).trim().length().gt(0), ee.Number.parse(v), -9999),
      v)));
}

function aTexto(v) {
  return ee.String(ee.Algorithms.If(
    ee.Algorithms.IsEqual(v, null), '',
    ee.Algorithms.If(tipo(v).equals('String'), v, ee.Number(v).format('%d'))));
}

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
// Tablas de REVISIONES: c{79|80}_{col3MB|CONAF}_e{eco}_v{n}, última versión de cada combinación
// ------------------------------------------------------------------------------------------
var TABLAS = (function () {
  var re = /^c(79|80)_(col3MB|CONAF)_e(\d+)_v(\d+)$/i;
  var mejores = {}, ignoradas = [];
  listarCarpeta(CARPETA_REVISIONES).forEach(function (a) {
    var id = a.id || a.name;
    var m = id.split('/').pop().match(re);
    if (!m) { ignoradas.push(id.split('/').pop()); return; }
    var t = {id: id, clase: +m[1], fuente: m[2].toLowerCase() === 'conaf' ? 'CONAF' : 'col3MB', eco: +m[3], v: +m[4]};
    if (ECOS.indexOf(t.eco) < 0) return;
    var k = t.clase + '|' + t.fuente + '|' + t.eco;
    if (!mejores[k] || t.v > mejores[k].v) mejores[k] = t;
  });
  print('Tablas usadas:', Object.keys(mejores).sort().map(function (k) {
    return mejores[k].id.split('/').pop();
  }));
  if (ignoradas.length) print('Ignoradas (no calzan con el patrón):', ignoradas);
  return Object.keys(mejores).map(function (k) { return mejores[k]; });
})();

// ------------------------------------------------------------------------------------------
// Métricas por polígono (server-side)
// ------------------------------------------------------------------------------------------
function ciclo(f, suf) {   // suf: '' (ciclo 1) o '2' (ciclo 2)
  var d = aNumero(f.get('a_adulta' + suf + '_desde'));
  var h = aNumero(f.get('a_adulta' + suf + '_hasta'));
  var c = aNumero(f.get('anio_cosecha' + suf));
  var t = aTexto(f.get('a_adulta' + suf + '_hasta_trim'));
  var recorta = ee.Number(ee.Algorithms.If(t.length().gt(0).and(t.compareTo('Q4').neq(0)), 1, 0));
  var dur = h.subtract(recorta).subtract(d).add(1);
  var valido = d.gt(0).and(h.gt(0)).and(dur.gt(0));
  var cosechado = valido.and(c.gt(0));
  var completo = cosechado.and(d.gt(INICIO_SERIE));
  var abierto = valido.and(c.lte(0));   // sin cosecha registrada: la duración es una cota mínima
  return {
    valido: valido, cosechado: cosechado, abierto: abierto,
    dur: ee.Number(ee.Algorithms.If(completo, dur, -1)),
    durAbierta: ee.Number(ee.Algorithms.If(abierto, dur, -1))
  };
}

function analizar(f, t) {
  var c1 = ciclo(f, ''), c2 = ciclo(f, '2');
  // Un solo texto por polígono (se calcula una vez y viaja en una sola consulta):
  // valido,clase,fuente,eco,dur1,dur2,nCos,abierta
  return ee.Feature(null, {
    fila: ee.List([c1.valido, t.clase === 79 ? 1 : 2, t.fuente === 'CONAF' ? 1 : 0, t.eco,
                   c1.dur, c2.dur, c1.cosechado.add(c2.cosechado),
                   c1.durAbierta.max(c2.durAbierta)]).join(',')
  });
}

var todos = ee.FeatureCollection(TABLAS.map(function (t) {
  return ee.FeatureCollection(t.id)
    .filter(ee.Filter.or(ee.Filter.notNull(['descartar']).not(), ee.Filter.neq('descartar', 1)))
    .map(function (f) { return analizar(f, t); });
})).flatten();

// ------------------------------------------------------------------------------------------
// Estadística en el cliente
// ------------------------------------------------------------------------------------------
function ordenar(a) { return a.slice().sort(function (x, y) { return x - y; }); }

function percentil(sorted, p) {
  if (!sorted.length) return NaN;
  var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Conteo por valor entero (las duraciones son años: pocos valores distintos)
function contar(v) {
  var c = {};
  v.forEach(function (x) { c[x] = (c[x] || 0) + 1; });
  return c;
}
function valoresUnicos(ca, cb) {
  var u = {};
  Object.keys(ca).forEach(function (k) { u[k] = 1; });
  Object.keys(cb).forEach(function (k) { u[k] = 1; });
  return Object.keys(u).map(Number).sort(function (x, y) { return x - y; });
}

// P(a > b) + 0.5 P(a = b), en O(N + U): recorre los valores distintos de menor a mayor
function auc(a, b) {
  if (!a.length || !b.length) return NaN;
  var ca = contar(a), cb = contar(b), acumB = 0, suma = 0;
  valoresUnicos(ca, cb).forEach(function (v) {
    var na = ca[v] || 0, nb = cb[v] || 0;
    suma += na * (acumB + 0.5 * nb);
    acumB += nb;
  });
  return suma / (a.length * b.length);
}

// Mejor umbral t para "pino si dur >= t"; devuelve exactitud balanceada. O(N + U)
function mejorUmbral(a, b) {
  if (!a.length || !b.length) return null;
  var ca = contar(a), cb = contar(b), menorA = 0, menorB = 0;
  var mejor = {t: null, ba: -1};
  valoresUnicos(ca, cb).forEach(function (t) {
    var tpr = (a.length - menorA) / a.length;   // pinos con dur >= t
    var tnr = menorB / b.length;                // eucaliptos con dur < t
    var ba = (tpr + tnr) / 2;
    if (ba > mejor.ba) mejor = {t: t, ba: ba};
    menorA += ca[t] || 0;
    menorB += cb[t] || 0;
  });
  return mejor;
}

function pct(n, d) { return d ? Math.round(1000 * n / d) / 10 : NaN; }
function f1(x) { return isNaN(x) ? '—' : (Math.round(x * 10) / 10).toString(); }
function f2(x) { return isNaN(x) ? '—' : (Math.round(x * 100) / 100).toString(); }

// d: {clase, fuente, eco, dur1, dur2, nCos, abierta} (arrays paralelos)
function resumirGrupo(filas) {
  var por = {1: {pol: 0, dur: [], dos: 0, sin: 0, largo: 0}, 2: {pol: 0, dur: [], dos: 0, sin: 0, largo: 0}};
  filas.forEach(function (r) {
    var g = por[r.clase];
    g.pol++;
    if (r.dur1 > 0) g.dur.push(r.dur1);
    if (r.dur2 > 0) g.dur.push(r.dur2);
    if (r.nCos >= 2) g.dos++;
    if (r.nCos === 0) {
      g.sin++;
      if (r.abierta >= MIN_RUN_LARGO) g.largo++;
    }
  });
  var sp = ordenar(por[1].dur), se = ordenar(por[2].dur);
  var u = mejorUmbral(por[1].dur, por[2].dur);
  return {
    polP: por[1].pol, polE: por[2].pol, cicP: sp.length, cicE: se.length,
    medP: percentil(sp, 0.5), p10P: percentil(sp, 0.1), p90P: percentil(sp, 0.9),
    medE: percentil(se, 0.5), p10E: percentil(se, 0.1), p90E: percentil(se, 0.9),
    auc: auc(por[1].dur, por[2].dur), umbral: u,
    dosP: pct(por[1].dos, por[1].pol), dosE: pct(por[2].dos, por[2].pol),
    sinP: pct(por[1].sin, por[1].pol), sinE: pct(por[2].sin, por[2].pol),
    largoP: pct(por[1].largo, por[1].sin), largoE: pct(por[2].largo, por[2].sin)
  };
}

function bloque(nombre, r) {
  return [
    nombre,
    '  polígonos           pino ' + r.polP + ' · euca ' + r.polE + '   (ciclos completos: pino ' + r.cicP + ' · euca ' + r.cicE + ')',
    '  duración adulta     pino ' + f1(r.medP) + ' [' + f1(r.p10P) + '–' + f1(r.p90P) + '] · euca ' + f1(r.medE) + ' [' + f1(r.p10E) + '–' + f1(r.p90E) + ']  (mediana [p10–p90], años)',
    '  separabilidad       AUC ' + f2(r.auc) + (r.umbral ? ' · umbral >= ' + r.umbral.t + ' años → exactitud balanceada ' + f2(r.umbral.ba) : ''),
    '  >= 2 cosechas       pino ' + f1(r.dosP) + ' % · euca ' + f1(r.dosE) + ' %',
    '  sin cosecha         pino ' + f1(r.sinP) + ' % · euca ' + f1(r.sinE) + ' %   (con >= ' + MIN_RUN_LARGO + ' años adultos: pino ' + f1(r.largoP) + ' % · euca ' + f1(r.largoE) + ' % de los sin cosecha)'
  ].join('\n');
}

function histograma(valores, anchoBin, maxVal) {
  var n = Math.ceil(maxVal / anchoBin), cuentas = [];
  for (var i = 0; i < n; i++) cuentas.push(0);
  valores.forEach(function (v) { cuentas[Math.min(n - 1, Math.floor(v / anchoBin))]++; });
  return cuentas;
}

function graficoHist(titulo, valP, valE, anchoBin, maxVal, tituloX) {
  var hp = histograma(valP, anchoBin, maxVal), he = histograma(valE, anchoBin, maxVal);
  var filas = [[tituloX, 'Pino', 'Eucalipto']];
  for (var i = 0; i < hp.length; i++) {
    filas.push([(i * anchoBin) + '–' + ((i + 1) * anchoBin - 1),
      valP.length ? hp[i] / valP.length * 100 : 0, valE.length ? he[i] / valE.length * 100 : 0]);
  }
  return ui.Chart(filas, 'ColumnChart', {
    title: titulo, hAxis: {title: tituloX}, vAxis: {title: '% de la especie'},
    colors: ['#1B5E20', '#AEEA00'], bar: {groupWidth: '85%'}, legend: {position: 'top'}
  });
}

// ------------------------------------------------------------------------------------------
// Ejecución: una sola evaluación con todos los polígonos
// ------------------------------------------------------------------------------------------
print('Calculando… (una sola consulta; si tarda mucho, deja ECOS = [8] y ve sumando ecorregiones)');

todos.aggregate_array('fila').evaluate(function (lineas, err) {
  if (err) { print('Error: ' + err); return; }
  var filas = lineas.map(function (l) {
    var p = l.split(',').map(parseFloat);
    var ok = function (x) { return (x >= 1 && x <= 40) ? x : -1; };   // duraciones fuera de rango = dato dudoso
    return {valido: p[0], clase: p[1], fuente: p[2], eco: p[3], dur1: ok(p[4]), dur2: ok(p[5]), nCos: p[6], abierta: ok(p[7])};
  }).filter(function (r) { return r.valido === 1; });
  print('Polígonos válidos (con serie adulta y no descartados): ' + filas.length);

  var texto = [];
  var grupo = function (nombre, pred) {
    var sub = filas.filter(pred);
    if (!sub.length) return;
    texto.push(bloque(nombre, resumirGrupo(sub)));
  };
  grupo('== TODAS LAS ECORREGIONES ==', function () { return true; });
  grupo('-- Fuente CONAF --', function (r) { return r.fuente === 1; });
  grupo('-- Fuente col3MB --', function (r) { return r.fuente === 0; });
  ECOS.forEach(function (e) { grupo('-- E' + e + ' --', function (r) { return r.eco === e; }); });
  if (DETALLE_ECO_FUENTE) ECOS.forEach(function (e) {
    grupo('-- E' + e + ' · CONAF --', function (r) { return r.eco === e && r.fuente === 1; });
    grupo('-- E' + e + ' · col3MB --', function (r) { return r.eco === e && r.fuente === 0; });
  });
  print(ui.Label(texto.join('\n\n'), {whiteSpace: 'pre', fontFamily: 'monospace', fontSize: '11px'}));

  // Histogramas con todas las ecorregiones
  var durP = [], durE = [], abP = [], abE = [];
  filas.forEach(function (r) {
    var dest = r.clase === 1 ? durP : durE, ab = r.clase === 1 ? abP : abE;
    if (r.dur1 > 0) dest.push(r.dur1);
    if (r.dur2 > 0) dest.push(r.dur2);
    if (r.nCos === 0 && r.abierta > 0) ab.push(r.abierta);
  });
  print(graficoHist('Duración del periodo adulto — ciclos completos', durP, durE, 2, 40, 'Años adultos'));
  print(graficoHist('Rodales SIN cosecha: años adultos acumulados (cota mínima)', abP, abE, 2, 40, 'Años adultos'));
});
