// ==========================================================================================
// SCRIPT: verificar_probabilidades_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// Revisa, para una versión exportada (por defecto v4), que los assets de clasificación de
// cada ecorregión tengan las bandas de probabilidad:
//   silvicultura (banda 0), p_pino, p_euca, p_cosechado, p_otras, probabilidad
//
// Por cada ecorregión informa:
//   · años exportados y años que faltan (1996–2026)
//   · años cuyo asset NO tiene las bandas de probabilidad (solo clase u otras bandas)
//   · años con bandas distintas a las esperadas, o con la clase fuera de la banda 0
//   · propiedad con_probabilidad de cada asset (1 = exportado con probabilidades)
//
// No lee píxeles: solo los metadatos de cada asset, así que es rápido y no gasta cómputo.
// Para revisar que los VALORES sean razonables, haz clic en un píxel conocido con el visor.
//
// USO: pega el script en el Code Editor y presiona Run. Mira la consola (Console).
// ==========================================================================================

var CARPETA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';
var VERSION = 'v4';                                   // versión a revisar (coincidencia EXACTA, no toca v4_rell)
var ECOS = [5, 7, 8, 9, 10, 11, 12];                  // ecorregiones esperadas
var AÑO_INI = 1996, AÑO_FIN = 2026;
var BANDAS_ESPERADAS = ['silvicultura', 'p_pino', 'p_euca', 'p_cosechado', 'p_otras', 'probabilidad'];
var EXPORTAR_CSV = false;                             // true = además exporta el detalle por asset a Drive
var CONCURRENCIA = 6;                                 // consultas simultáneas a la API

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

var re = new RegExp('^silvo_e(\\d+)_(\\d{4})_' + VERSION + '$');
var todos = listarCarpeta(CARPETA);
var objetivo = [];
todos.forEach(function (a) {
  var id = a.id || a.name;
  var m = re.exec(id.split('/').pop());
  if (m) objetivo.push({id: id, nombre: id.split('/').pop(), eco: parseInt(m[1], 10), año: parseInt(m[2], 10)});
});

print('Carpeta: ' + CARPETA);
print('Assets en la carpeta: ' + todos.length + ' · de la versión ' + VERSION + ': ' + objetivo.length);

var res = {};               // nombre -> {bandas, conProb, error}
var pendientes = objetivo.slice();
var enCurso = 0, hechos = 0;

function igualesBandas(b) {
  if (b.length !== BANDAS_ESPERADAS.length) return false;
  for (var i = 0; i < b.length; i++) if (b[i] !== BANDAS_ESPERADAS[i]) return false;
  return true;
}

function siguiente() {
  while (enCurso < CONCURRENCIA && pendientes.length) {
    (function (o) {
      enCurso++;
      ee.data.getAsset(o.id, function (a, err) {
        enCurso--; hechos++;
        if (err || !a) {
          res[o.nombre] = {bandas: [], conProb: null, error: String(err || 'sin respuesta')};
        } else {
          var bandas = (a.bands || []).map(function (b) { return b.id; });
          var props = a.properties || {};
          res[o.nombre] = {bandas: bandas, conProb: props.con_probabilidad === undefined ? null : props.con_probabilidad, error: null};
        }
        if (hechos === objetivo.length) informe(); else siguiente();
      });
    })(pendientes.shift());
  }
}

function informe() {
  var filas = [];            // para el CSV
  var resumen = [];
  var problemas = [];
  var totalOk = 0;
  var sinProbLista = [];     // nombres de assets que NO tienen las 6 bandas (sin probabilidad, bandas distintas o ilegibles)
  ECOS.forEach(function (eco) {
    var delEco = objetivo.filter(function (o) { return o.eco === eco; }).sort(function (a, b) { return a.año - b.año; });
    var conOk = [], sinProb = [], raros = [], errores = [];
    var presentes = {};
    delEco.forEach(function (o) {
      presentes[o.año] = true;
      var r = res[o.nombre];
      var estado;
      if (r.error) { errores.push(o.año); estado = 'error'; }
      else if (igualesBandas(r.bandas)) { conOk.push(o.año); estado = 'ok'; }
      else if (r.bandas.length === 1 && r.bandas[0] === 'silvicultura') { sinProb.push(o.año); estado = 'sin_probabilidad'; }
      else { raros.push(o.año + ' [' + r.bandas.join(',') + ']'); estado = 'bandas_distintas'; }
      if (estado !== 'ok') sinProbLista.push(o.nombre + (estado === 'sin_probabilidad' ? '' : ' (' + estado + ')'));
      filas.push(ee.Feature(null, {eco: eco, año: o.año, asset: o.nombre, estado: estado,
        n_bandas: r.bandas.length, bandas: r.bandas.join(','), con_probabilidad: r.conProb === null ? -1 : r.conProb}));
    });
    var faltan = [];
    for (var y = AÑO_INI; y <= AÑO_FIN; y++) if (!presentes[y]) faltan.push(y);
    totalOk += conOk.length;
    resumen.push('E' + eco + ' · exportados ' + delEco.length + '/' + (AÑO_FIN - AÑO_INI + 1) +
      ' · con probabilidad ' + conOk.length +
      (sinProb.length ? ' · SIN probabilidad ' + sinProb.length : '') +
      (raros.length ? ' · bandas distintas ' + raros.length : '') +
      (errores.length ? ' · error de lectura ' + errores.length : '') +
      (delEco.length === 0 ? ' · NO HAY ASSETS ' + VERSION : ''));
    if (sinProb.length) problemas.push('E' + eco + ' sin bandas de probabilidad: ' + sinProb.join(', '));
    if (raros.length) problemas.push('E' + eco + ' con bandas distintas a las esperadas: ' + raros.join(' | '));
    if (errores.length) problemas.push('E' + eco + ' no se pudo leer: ' + errores.join(', '));
    if (faltan.length && faltan.length < (AÑO_FIN - AÑO_INI + 1)) problemas.push('E' + eco + ' años sin exportar: ' + faltan.join(', '));
  });
  // ecorregiones presentes en la carpeta que no estaban en ECOS
  var extra = {};
  objetivo.forEach(function (o) { if (ECOS.indexOf(o.eco) < 0) extra[o.eco] = true; });
  var extraLista = Object.keys(extra);

  print('------ RESUMEN ' + VERSION + ' ------');
  resumen.forEach(function (l) { print(l); });
  print('Total con las 6 bandas esperadas: ' + totalOk + ' de ' + objetivo.length + ' assets');
  print(sinProbLista.length ? 'ASSETS SIN PROBABILIDAD (' + sinProbLista.length + '):' : 'Ningún asset sin probabilidad.');
  if (sinProbLista.length) print(sinProbLista);
  if (extraLista.length) print('Ecorregiones en la carpeta que no están en ECOS: E' + extraLista.join(', E'));
  if (!problemas.length) {
    print('TODO BIEN: todos los assets ' + VERSION + ' traen ' + BANDAS_ESPERADAS.join(', ') + '.');
  } else {
    print('------ A REVISAR ------');
    problemas.forEach(function (l) { print(l); });
  }
  if (EXPORTAR_CSV) {
    Export.table.toDrive({collection: ee.FeatureCollection(filas), description: 'verificacion_probabilidades_' + VERSION,
      fileFormat: 'CSV', selectors: ['eco', 'año', 'asset', 'estado', 'n_bandas', 'bandas', 'con_probabilidad']});
    print('CSV creado en la pestaña Tasks: verificacion_probabilidades_' + VERSION);
  }
}

if (!objetivo.length) print('No hay assets con el sufijo _' + VERSION + ' en la carpeta.');
else siguiente();
