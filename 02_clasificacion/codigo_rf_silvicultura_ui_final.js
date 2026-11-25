// ==========================================================================================
// SCRIPT: codigo_rf_silvicultura_ui
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// Interfaz basada en el visor de clasificación SegLabel (panel izq. + mapa + panel der.)
// ------------------------------------------------------------------------------------------
// RF MULTIANUAL desde las tablas de SAMPLES_TRIMESTRAL:
//   1 = Pino (79)   2 = Eucalipto (80)   3 = Otras (muestras base [+ agro])   4 = Cosechado
//
// MÉTODO (modo "máscara + especie", con guía COL2 activada por defecto):
//   · Máscara RF de 3 clases: plantación (pino+euca) / otras [+ agro] / cosechado.
//   · COSECHADO solo DENTRO de la máscara COL2 (clase 9): ahí gana si su probabilidad es la mayor de las 3; fuera de COL2
//     no se agrega cosechado por probabilidad (los umbrales tampoco intervienen en esta clase).
//   · PLANTACIÓN se decide con la probabilidad P de la máscara y la plantación de COL2 (clase 9) como apoyo:
//       dentro de COL2 → plantación si P ≥ umbral dentro (bajo, COL2 respalda)
//       fuera de COL2  → plantación solo si P ≥ umbral fuera (alto: el modelo debe estar muy seguro)
//   · ESPECIE (pino/euca) la decide un RF aparte pino vs eucalipto, con P(pino) suavizada (radio px) y corte en 0.5.
//   · Filtro de área mínima (px) sobre pino y eucalipto; un modelo por periodo de sensor (AUTO).
//   · BUFFER (km, por defecto 5): clasifica y exporta la ecorregión MÁS una franja alrededor de ella, aplicando el mismo
//     modelo de la ecorregión. Así los filtros espaciales (área mínima, suavizado de especie) no cortan los parches que cruzan
//     el límite y se evita la costura entre ecorregiones. La franja se arma con el vector E{n} (buffer geodésico) y se suma a los
//     píxeles del raster de ecorregiones. 0 = sin buffer (comportamiento anterior). Las ecorregiones vecinas se SOLAPAN en la franja:
//     al contar áreas o integrar hay que recortar cada ecorregión a su propio límite (raster de ecorregiones, eq(eco)).
//
// Al leer las tablas se reconstruye:
//   - yr y eco desde el nombre sample_{silvo|base}_e{eco}_{año}_v{n} (última versión)
//   - solo años ADULTOS (silvi): desde <= yr < hasta, o yr == hasta con hasta_trim Q4/vacío
//   - split train/test por polígono (silvi) y por segmento (base)
//   - índices NDVI/NDMI/NBR/EVI2 por trimestre (misma fórmula en tabla e imagen)
//
// Flujo (la exportación se hace UNA sola vez por ecorregión):
//   1) Muestreo → "Exportar tablas maestras faltantes": una tabla train_master_e{eco}_{ver} por
//      ecorregión (hasta N puntos por periodo × clase, con azar_poly para train/test y azar_pt
//      para elegir puntos). Se lanza en Tasks y no se repite.
//   2) Cambiar ecorregiones de entrenamiento, periodo, puntos por clase, fracción test o árboles
//      NO requiere exportar: solo "Aplicar parámetros" (filtra la maestra, es liviano).
//   Re-exportar (subir versión) solo si cambian los predictores o las muestras de origen.
//
// Paneles:
//   Panel derecho  → Clasificación: ecorregión a mapear, ecorregiones de entrenamiento,
//                    periodo de entrenamiento (L5/7, L8/9, personalizado) y años a clasificar.
//                  → Muestreo: puntos por clase, fracción test, árboles y tabla maestra.
//                  → Exportar: exporta los años seleccionados como silvo_e{eco}_{año}_{versión}.
//   Panel izquierdo → Leyenda, Métricas (matriz, OA, PA/UA, importancia) y Mosaico.
//   Clic en el mapa → serie NDVI trimestral 1996–2026 + clase por año del punto.
// ==========================================================================================

Map.setOptions('HYBRID');

// ------------------------------------------------------------------------------------------
// Parámetros iniciales (modificables desde la interfaz)
// ------------------------------------------------------------------------------------------
var DEF = {
  eco: 8,
  bufferKm: 5,                     // franja alrededor de la ecorregión que también se clasifica y exporta (0 = no)
  ecosEnt: '8',
  periodo: 'AUTO',
  años: [2017],
  pino: 1400, euca: 1400, otras: 4000, agro: 2000,   // agro se suma a la clase 3 (Otras)
  cosecha: 1500,                                     // clase 4 (rodal completamente cosechado)
  fracTest: 0.3,
  lectSilvo: 0.1, lectBase: 0.5, lectAgro: 0.3,   // solo afectan la exportación de las tablas
  cap: 4000,                       // máx. puntos por (periodo × clase) en la maestra
  arboles: 40,
  version: 'v1',
  verEnt: 'v1'
};

var ECOS_SILVI = [7, 8, 9, 10, 11];   // ecorregiones con silvicultura
var SEMILLA = 42;
var ESCALA = 30;
var ESCALA_REFLECTANCIA = 10000;
var PREFIJO = 'q_';
var PROP_CLASE_BASE = 'class';
var PROP_SEG_BASE = 'seg_id';
var IDS_EXCLUIDOS_BASE = [79, 80, 9, 27];

// --- Rutas ---
var CARPETA_TABLAS = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_TRIMESTRAL';
var CARPETA_MAESTRA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_COL3/SILVICULTURE/MODEL_SAMPLES';
var ASSET_TRIMESTRAL = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/mosaics-3-trimestral';
var ASSET_ECO_RASTER = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m';
var CARPETA_ECO_VECTOR = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES';
var CARPETA_SALIDA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';

// --- Clases ---
var CLASES = [
  {id: 1, nombre: 'Pino (79)', color: '1B5E20'},
  {id: 2, nombre: 'Eucalipto (80)', color: 'AEEA00'},
  {id: 3, nombre: 'Otras', color: 'BDBDBD'},
  {id: 4, nombre: 'Cosechado', color: '8D6E63'}
];
var NOMBRE_CLASE = {1: 'Pino', 2: 'Eucalipto', 3: 'Otras', 4: 'Cosechado'};
var VIS_CLASIF = {min: 1, max: 4, palette: CLASES.map(function (c) { return c.color; })};
var VIS_PLANT = {min: 1, max: 2, palette: ['1B5E20', 'AEEA00']};

// ------------------------------------------------------------------------------------------
// Predictoras
// ------------------------------------------------------------------------------------------
var Q = ['Q1_', 'Q2_', 'Q3_', 'Q4_'];
var ESPECTRALES = ['blue_median', 'green_median', 'red_median', 'nir_median', 'swir1_median', 'swir2_median'];
var INDICES = ['ndvi', 'ndmi', 'nbr', 'evi2'];
var ANUALES = ['ndmi_amp', 'ndmi_max', 'ndmi_min', 'ndvi_amp', 'ndvi_max',
               'q_ndmi_max', 'q_ndvi_max', 'hand', 'twi'];
// Fuera a propósito: Q*_nobs, valid_q, mndwi_max, wet_freq, dist_water, dist_coast

var BANDAS = [], BANDAS_TABLA = [];
Q.forEach(function (q) {
  ESPECTRALES.forEach(function (b) { BANDAS.push(PREFIJO + q + b); BANDAS_TABLA.push(PREFIJO + q + b); });
  INDICES.forEach(function (b) { BANDAS.push(PREFIJO + q + b); });
});
ANUALES.forEach(function (b) { BANDAS.push(PREFIJO + b); BANDAS_TABLA.push(PREFIJO + b); });

// ------------------------------------------------------------------------------------------
// Auxiliares
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

function existe(id) {
  try { ee.data.getAsset(id); return true; } catch (e) { return false; }
}

function azarDesdeId(n) {
  return ee.Number(n).abs().multiply(7919).add(SEMILLA).mod(1000).divide(1000);
}

function parseEntero(txt, nombre, min) {
  var n = parseInt(String(txt).trim(), 10);
  if (isNaN(n) || n < (min || 0)) throw new Error(nombre + ': valor inválido.');
  return n;
}

// Distancia en km (0 permitido, máx. 50)
function parseKm(txt, nombre) {
  var t = String(txt).trim().replace(',', '.');
  var n = Number(t);
  if (t === '' || !isFinite(n) || n < 0 || n > 50) throw new Error(nombre + ': debe estar entre 0 y 50 km.');
  return n;
}

function parseFraccion(txt, nombre) {
  var n = Number(String(txt).trim().replace(',', '.'));
  if (!isFinite(n) || n <= 0 || n > 1) throw new Error(nombre + ': debe ser > 0 y <= 1.');
  return n;
}

function parseListaEcos(txt) {
  var lista = String(txt).split(/[,\s;]+/).filter(function (s) { return s; })
    .map(function (s) { return parseInt(s.replace(/\D/g, ''), 10); })
    .filter(function (n) { return !isNaN(n); });
  var fuera = lista.filter(function (n) { return ECOS_SILVI.indexOf(n) < 0; });
  if (fuera.length) throw new Error('Silvicultura solo existe en E' + ECOS_SILVI[0] + '–E' +
    ECOS_SILVI[ECOS_SILVI.length - 1] + '. Fuera de rango: ' + fuera.join(', ') + '.');
  if (!lista.length) throw new Error('Ecorregiones de entrenamiento: ingresa al menos una (ej. 8 o 7,8).');
  return lista;
}

// ------------------------------------------------------------------------------------------
// Catálogo de tablas (se lee una vez)
// ------------------------------------------------------------------------------------------
// Ecorregiones donde la versión más alta de un año NO trae las muestras CONAF (en E8 la v2 se exportó solo con
// col3MB y CONAF quedó en la v1). Ahí se usa la versión más alta completa y, además, SOLO las filas CONAF
// (origen = 'conaf') de las versiones anteriores del mismo año. Si en otra ecorregión pasa lo mismo, agrégala aquí.
var ECOS_FUSION_VERSIONES = [8];

var CATALOGO = (function () {
  var re = /^sample_(silvo|base|agro)_e(\d+)_(\d{4})_v(\d+)$/i;
  var porClave = {};
  listarCarpeta(CARPETA_TABLAS).forEach(function (a) {
    if (a.type !== 'TABLE') return;
    var id = a.id || a.name;
    var m = id.split('/').pop().match(re);
    if (!m) return;
    var t = {id: id, tipo: m[1].toLowerCase(), eco: +m[2], yr: +m[3], v: +m[4], soloConaf: false};
    var k = t.tipo + '|' + t.eco + '|' + t.yr;
    (porClave[k] = porClave[k] || []).push(t);
  });
  var out = [];
  Object.keys(porClave).forEach(function (k) {
    var vs = porClave[k].sort(function (x, y) { return y.v - x.v; });
    out.push(vs[0]);                                   // versión más alta, completa
    var t = vs[0];
    if (t.tipo === 'silvo' && ECOS_FUSION_VERSIONES.indexOf(t.eco) >= 0) {
      vs.slice(1).forEach(function (o) {               // versiones anteriores: solo filas CONAF
        out.push({id: o.id, tipo: o.tipo, eco: o.eco, yr: o.yr, v: o.v, soloConaf: true});
      });
    }
  });
  return out;
})();

function tablasDe(tipoTabla, ecos, ini, fin) {
  return CATALOGO.filter(function (t) {
    return t.tipo === tipoTabla && ecos.indexOf(t.eco) >= 0 && t.yr >= ini && t.yr <= fin;
  });
}

// ------------------------------------------------------------------------------------------
// Imagen: MISMOS nombres y fórmulas que la tabla
// ------------------------------------------------------------------------------------------
function stackAño(y) {
  var m = ee.ImageCollection(ASSET_TRIMESTRAL).filter(ee.Filter.eq('year', y)).mosaic();
  var idx = ee.Image([]);
  Q.forEach(function (q) {
    var nir = m.select(q + 'nir_median').divide(ESCALA_REFLECTANCIA);
    var red = m.select(q + 'red_median').divide(ESCALA_REFLECTANCIA);
    idx = idx
      .addBands(m.normalizedDifference([q + 'nir_median', q + 'red_median']).rename(q + 'ndvi'))
      .addBands(m.normalizedDifference([q + 'nir_median', q + 'swir1_median']).rename(q + 'ndmi'))
      .addBands(m.normalizedDifference([q + 'nir_median', q + 'swir2_median']).rename(q + 'nbr'))
      .addBands(nir.subtract(red).multiply(2.5).divide(nir.add(red.multiply(2.4)).add(1)).rename(q + 'evi2'));
  });
  return m.addBands(idx).regexpRename('^(.*)$', PREFIJO + '$1').select(BANDAS).toFloat();
}

function indicesTabla(f) {
  var props = {};
  Q.forEach(function (q) {
    var g = function (b) { return ee.Number(f.get(PREFIJO + q + b + '_median')); };
    var nd = function (a, b) { return a.subtract(b).divide(a.add(b)); };
    var nir = g('nir'), red = g('red');
    props[PREFIJO + q + 'ndvi'] = nd(nir, red);
    props[PREFIJO + q + 'ndmi'] = nd(nir, g('swir1'));
    props[PREFIJO + q + 'nbr'] = nd(nir, g('swir2'));
    var n = nir.divide(ESCALA_REFLECTANCIA), r = red.divide(ESCALA_REFLECTANCIA);
    props[PREFIJO + q + 'evi2'] = n.subtract(r).multiply(2.5).divide(n.add(r.multiply(2.4)).add(1));
  });
  return f.set(props);
}

// ------------------------------------------------------------------------------------------
// Construcción del modelo
// ------------------------------------------------------------------------------------------
function filtroAdulto(desde, hasta, trim) {
  return ee.Filter.and(
    ee.Filter.lessThanOrEquals({leftField: desde, rightField: 'yr'}),
    ee.Filter.or(
      ee.Filter.lessThan({leftField: 'yr', rightField: hasta}),
      ee.Filter.and(
        ee.Filter.equals({leftField: 'yr', rightField: hasta}),
        ee.Filter.inList(trim, ['Q4', '']))));
}

function idPoligono(f) {
  var out = ee.Number(-9999);
  ['dis_id', 'fid_gpkg', 'id', 'fid'].forEach(function (c) {
    out = ee.Number(ee.Algorithms.If(out.gt(-9999), out, aNumero(f.get(c))));
  });
  var origen = ee.Number(ee.Algorithms.If(aTexto(f.get('origen')).compareTo('conaf').eq(0), 1, 0));
  return out.add(ee.Number(f.get('eco')).multiply(1e7)).add(origen.multiply(1e9));
}

function cargar(lista) {
  return ee.FeatureCollection(lista.map(function (t) {
    var fc = ee.FeatureCollection(t.id);
    if (t.soloConaf) fc = fc.filter(ee.Filter.or(ee.Filter.eq('origen', 'conaf'), ee.Filter.eq('origen', 'CONAF')));
    return fc.map(function (f) { return f.set({yr: t.yr, eco: t.eco}); });
  })).flatten();
}

// ------------------------------------------------------------------------------------------
// TABLA MAESTRA (se exporta UNA vez por ecorregión; todo lo demás se decide al entrenar)
//   train_master_e{eco}_{ver}: hasta CAP puntos por (periodo × clase) con TODOS los predictores,
//   más: clase (1 pino, 2 euca, 3 otras), yr, eco,
//        azar_poly = azar determinístico del polígono/segmento (define train/test),
//        azar_pt   = azar del punto (define qué puntos entran cuando pides N por clase).
//   Al entrenar se filtra por ecorregión / año / fracción test / N por clase SIN re-exportar.
// ------------------------------------------------------------------------------------------
var PERIODOS_MAESTRA = [[1996, 2012], [2013, 2026]];

// Versiones por ecorregión: la v1/v2 'lógica' de E8 se guarda como v3/v4 (y su cosecha como v2)
// para no borrar las tablas antiguas. Cambia aquí si otra ecorregión necesita rehacerse.
var VERSION_ECO = {8: {v1: 'v3', v2: 'v4'}};
var VERSION_COSECHA_ECO = {8: 'v2'};
function nombreMaestra(eco, ver) { var o = VERSION_ECO[eco]; return 'train_master_e' + eco + '_' + ((o && o[ver]) || ver); }
function idMaestra(eco, ver) { return CARPETA_MAESTRA + '/' + nombreMaestra(eco, ver); }

// Pesado: solo para la tarea batch de exportación
function maestraDeEco(eco, cfg) {
  var COLS = BANDAS.concat(['clase', 'azar_poly', 'yr', 'eco']);
  var partes = [];
  PERIODOS_MAESTRA.forEach(function (p, i) {
    var tS = tablasDe('silvo', [eco], p[0], p[1]);
    var tB = tablasDe('base', [eco], p[0], p[1]);
    var semilla = SEMILLA + i;
    var tomar = function (fc) {
      return fc.filter(ee.Filter.notNull(BANDAS_TABLA))
        .randomColumn('r_sel', semilla).limit(cfg.cap, 'r_sel')
        .map(indicesTabla);
    };
    if (tS.length) {
      var silvo = cargar(tS)
        .filter(ee.Filter.inList('class', [79, 80]))
        .filter(ee.Filter.or(ee.Filter.notNull(['descartar']).not(), ee.Filter.neq('descartar', 1)))
        .filter(ee.Filter.or(
          filtroAdulto('a_adulta_desde', 'a_adulta_hasta', 'a_adulta_hasta_trim'),
          filtroAdulto('a_adulta2_desde', 'a_adulta2_hasta', 'a_adulta2_hasta_trim')))
        .randomColumn('r_lect', SEMILLA)
        .filter(ee.Filter.lt('r_lect', cfg.lectSilvo))
        .map(function (f) {
          return f.set({
            clase: ee.Algorithms.If(ee.Number(f.get('class')).eq(79), 1, 2),
            azar_poly: azarDesdeId(idPoligono(f))
          });
        });
      partes.push(tomar(silvo.filter(ee.Filter.eq('clase', 1))));
      partes.push(tomar(silvo.filter(ee.Filter.eq('clase', 2))));
    }
    if (tB.length) {
      var base = cargar(tB)
        .filter(ee.Filter.inList(PROP_CLASE_BASE, IDS_EXCLUIDOS_BASE).not())
        .randomColumn('r_lect', SEMILLA)
        .filter(ee.Filter.lt('r_lect', cfg.lectBase))
        .map(function (f) {
          var seg = aNumero(f.get(PROP_SEG_BASE)).add(ee.Number(f.get('eco')).multiply(1e8));
          return f.set({clase: 3, azar_poly: azarDesdeId(seg)});
        });
      partes.push(tomar(base));
    }
  });
  if (!partes.length) throw new Error('No hay tablas de origen para E' + eco + '.');
  return partes.reduce(function (a, b) { return a.merge(b); })
    .select(COLS)
    .randomColumn('azar_pt', SEMILLA + 99);
}

// Versiones de la maestra:
//   v1 = pino + eucalipto + otras (sin agro)
//   v2 = v1 + muestras de agro (se arma desde la v1 ya exportada; el agro va en la clase 3 con fondo = 2)
var VER_SIN_AGRO = 'v1';
var VER_CON_AGRO = 'v2';

// Id de segmento/polígono: primera columna disponible (para separar train/test sin fuga espacial)
function idSegmento(f) {
  var out = ee.Number(-9999);
  [PROP_SEG_BASE, 'dis_id', 'fid_gpkg', 'id', 'fid'].forEach(function (c) {
    out = ee.Number(ee.Algorithms.If(out.gt(-9999), out, aNumero(f.get(c))));
  });
  return out;
}

// Pesado: puntos de agro de una ecorregión (para armar la v2)
function agroDeEco(eco, cfg) {
  var COLS = BANDAS.concat(['clase', 'fondo', 'azar_poly', 'yr', 'eco']);
  var partes = [];
  PERIODOS_MAESTRA.forEach(function (p, i) {
    var tA = tablasDe('agro', [eco], p[0], p[1]);
    if (!tA.length) return;
    var agro = cargar(tA)
      .randomColumn('r_azar', SEMILLA + 5)
      .randomColumn('r_lect', SEMILLA)
      .filter(ee.Filter.lt('r_lect', cfg.lectAgro))
      .map(function (f) {
        var id = idSegmento(f);
        var az = ee.Number(ee.Algorithms.If(id.gt(-9999),
          azarDesdeId(id.add(ee.Number(f.get('eco')).multiply(1e8))), f.get('r_azar')));
        return f.set({clase: 3, fondo: 2, azar_poly: az});
      });
    partes.push(agro.filter(ee.Filter.notNull(BANDAS_TABLA))
      .randomColumn('r_sel', SEMILLA + i).limit(cfg.cap, 'r_sel').map(indicesTabla));
  });
  if (!partes.length) throw new Error('No hay tablas agro para E' + eco + '.');
  return partes.reduce(function (a, b) { return a.merge(b); })
    .select(COLS)
    .randomColumn('azar_pt', SEMILLA + 199);
}

// v2 = v1 (ya exportada) + agro. Mantiene idénticos los puntos de silvo y base.
function maestraConAgro(eco, cfg) {
  var COLS = BANDAS.concat(['clase', 'fondo', 'azar_poly', 'azar_pt', 'yr', 'eco']);
  var v1 = ee.FeatureCollection(idMaestra(eco, VER_SIN_AGRO)).map(function (f) {
    return f.set('fondo', ee.Algorithms.If(ee.Number(f.get('clase')).eq(3), 1, 0));
  });
  return v1.merge(agroDeEco(eco, cfg)).select(COLS);
}

// Cosechado (clase 4): tabla aparte train_cosecha_e{eco}_v1, independiente de v1/v2.
// Un punto es 'cosechado' cuando su año (yr) cae dentro de [cosecha + DIF_MIN, cosecha + DIF_MAX]
// (años después del año en que la cosecha del rodal se completa, anio_cosecha) y NO es adulto en ningún ciclo.
// Con las tablas actuales solo existen filas con dif = 1 (año siguiente a la cosecha completa: los 4 trimestres
// ya sin plantación). Se guardan dif, qc (trimestre de cosecha 1–4) y especie para poder filtrar después.
var VER_COSECHA = 'v1';
function nombreCosecha(eco) { return 'train_cosecha_e' + eco + '_' + (VERSION_COSECHA_ECO[eco] || VER_COSECHA); }
function idCosecha(eco) { return CARPETA_MAESTRA + '/' + nombreCosecha(eco); }

// Pesado: solo para la tarea batch de exportación
function cosechaDeEco(eco, cfg) {
  var COLS = BANDAS.concat(['clase', 'azar_poly', 'yr', 'eco', 'dif', 'qc', 'especie']);
  var partes = [];
  PERIODOS_MAESTRA.forEach(function (p, i) {
    var tS = tablasDe('silvo', [eco], p[0], p[1]);
    if (!tS.length) return;
    var cos = cargar(tS)
      .filter(ee.Filter.inList('class', [79, 80]))
      .filter(ee.Filter.or(ee.Filter.notNull(['descartar']).not(), ee.Filter.neq('descartar', 1)))
      .filter(ee.Filter.or(
        filtroAdulto('a_adulta_desde', 'a_adulta_hasta', 'a_adulta_hasta_trim'),
        filtroAdulto('a_adulta2_desde', 'a_adulta2_hasta', 'a_adulta2_hasta_trim')).not())
      .randomColumn('r_lect', SEMILLA)
      .filter(ee.Filter.lt('r_lect', cfg.lectCosecha))
      .map(function (f) {
        var y = ee.Number(f.get('yr'));
        var h1 = aNumero(f.get('anio_cosecha')), h2 = aNumero(f.get('anio_cosecha2'));
        var d1 = y.subtract(h1), d2 = y.subtract(h2);
        var ok1 = h1.gt(0).and(d1.gte(cfg.difMin)).and(d1.lte(cfg.difMax));
        var ok2 = h2.gt(0).and(d2.gte(cfg.difMin)).and(d2.lte(cfg.difMax));
        var dif = ee.Number(ee.Algorithms.If(ok1, d1, ee.Algorithms.If(ok2, d2, -9999)));
        var qTxt = aTexto(ee.Algorithms.If(ok1, f.get('trimestre_cosecha'), f.get('trimestre_cosecha2')));
        var qc = ee.Number(ee.Algorithms.If(qTxt.length().eq(2), ee.Number.parse(qTxt.slice(1)), 0));
        return f.set({
          clase: 4, dif: dif, qc: qc,
          especie: ee.Algorithms.If(ee.Number(f.get('class')).eq(79), 1, 2),
          azar_poly: azarDesdeId(idPoligono(f))
        });
      })
      .filter(ee.Filter.neq('dif', -9999));
    partes.push(cos.filter(ee.Filter.notNull(BANDAS_TABLA))
      .randomColumn('r_sel', SEMILLA + i).limit(cfg.cap, 'r_sel').map(indicesTabla));
  });
  if (!partes.length) throw new Error('No hay tablas silvo para E' + eco + '.');
  return partes.reduce(function (a, b) { return a.merge(b); })
    .select(COLS)
    .randomColumn('azar_pt', SEMILLA + 299);
}

// Liviano: lee las maestras ya exportadas y filtra (ecorregiones, periodo, N por clase, test)
function muestrasDesdeMaestra(cfg) {
  var faltan = cfg.ecosEnt.filter(function (e) { return !existe(idMaestra(e, cfg.verEnt)); });
  if (faltan.length) {
    throw new Error('Falta la tabla maestra de E' + faltan.join(', E') + ' (' + cfg.verEnt +
      '). Expórtala en la pestaña Muestreo.');
  }
  var datos = ee.FeatureCollection(cfg.ecosEnt.map(function (e) {
    return ee.FeatureCollection(idMaestra(e, cfg.verEnt));
  })).flatten().filter(ee.Filter.and(
    ee.Filter.gte('yr', cfg.ini), ee.Filter.lte('yr', cfg.fin)));

  var conAgro = cfg.verEnt === VER_CON_AGRO;
  var kTest = cfg.fracTest / (1 - cfg.fracTest);
  var tomar = function (clase, esTest, n, fondo) {
    var fTest = esTest ? ee.Filter.lt('azar_poly', cfg.fracTest) : ee.Filter.gte('azar_poly', cfg.fracTest);
    var fc = datos.filter(ee.Filter.eq('clase', clase)).filter(fTest);
    if (fondo !== undefined) fc = fc.filter(ee.Filter.eq('fondo', fondo));
    return fc.sort('azar_pt').limit(Math.max(1, Math.round(n)));
  };
  var datosCos = null;
  if (cfg.usaCosecha) {
    var faltanC = cfg.ecosEnt.filter(function (e) { return !existe(idCosecha(e)); });
    if (faltanC.length) {
      throw new Error('Falta la tabla de cosechado de E' + faltanC.join(', E') +
        '. Expórtala en la pestaña Muestreo (Cosechado siempre se clasifica).');
    }
    datosCos = ee.FeatureCollection(cfg.ecosEnt.map(function (e) {
      return ee.FeatureCollection(idCosecha(e));
    })).flatten().filter(ee.Filter.and(
      ee.Filter.gte('yr', cfg.ini), ee.Filter.lte('yr', cfg.fin)));
  }
  var conjunto = function (esTest, k) {
    var c = tomar(1, esTest, cfg.pino * k).merge(tomar(2, esTest, cfg.euca * k));
    if (!conAgro) c = c.merge(tomar(3, esTest, cfg.otras * k));
    else {
      c = c.merge(tomar(3, esTest, cfg.otras * k, 1));
      if (cfg.agro > 0) c = c.merge(tomar(3, esTest, cfg.agro * k, 2));
    }
    if (datosCos) {
      var fT = esTest ? ee.Filter.lt('azar_poly', cfg.fracTest) : ee.Filter.gte('azar_poly', cfg.fracTest);
      c = c.merge(datosCos.filter(fT).sort('azar_pt').limit(Math.max(1, Math.round(cfg.cosecha * k))));
    }
    return c;
  };
  return {train: conjunto(false, 1), test: conjunto(true, kTest),
          testAgro: (conAgro && cfg.agro > 0) ? tomar(3, true, cfg.agro * kTest, 2) : null};
}

function entrenarRF(cfg, fc) {
  return ee.Classifier.smileRandomForest({
    numberOfTrees: cfg.arboles,
    minLeafPopulation: 2,
    bagFraction: 0.5,
    seed: SEMILLA
  }).train({features: fc, classProperty: 'clase', inputProperties: BANDAS});
}

function copiarCfg(cfg, cambios) {
  var o = {};
  Object.keys(cfg).forEach(function (k) { o[k] = cfg[k]; });
  Object.keys(cambios).forEach(function (k) { o[k] = cambios[k]; });
  return o;
}

// Modos:
//   MULTI   → un solo RF con todas las clases (1 pino, 2 euca, 3 otras[, 4 cosechado])
//   ESPECIE → dos modelos: (a) máscara de plantación (pino+euca fusionados en la clase 1, más otras y cosechado)
//             y (b) modelo de especie entrenado SOLO con pino vs eucalipto. El mapa final usa la
//             especie dentro de la máscara y deja las demás clases como las da la máscara.
function construirModeloUno(cfg) {
  var m = muestrasDesdeMaestra(cfg);
  m.cfg = cfg;
  if (cfg.modo === 'ESPECIE') {
    var fusionar = function (fc) {
      return fc.map(function (f) {
        return f.set('clase', ee.Algorithms.If(ee.Number(f.get('clase')).eq(2), 1, f.get('clase')));
      });
    };
    m.trainMask = fusionar(m.train);
    m.testMask = fusionar(m.test);
    m.trainEsp = m.train.filter(ee.Filter.lte('clase', 2));
    m.testEsp = m.test.filter(ee.Filter.lte('clase', 2));
    m.rf = entrenarRF(cfg, m.trainMask);                               // máscara de plantación
    m.rfEspecie = entrenarRF(cfg, m.trainEsp);                         // pino vs eucalipto (clase)
    m.rfEspecieProb = m.rfEspecie.setOutputMode('MULTIPROBABILITY');   // [P(pino), P(eucalipto)]
    m.rfProb = m.rf.setOutputMode('MULTIPROBABILITY');                 // máscara: [P(plantación), P(otras)(, P(cosechado))]
  } else {
    m.rf = entrenarRF(cfg, m.train);
    m.rfEspecie = null;
  }
  return m;
}

// Un modelo, o dos (uno por periodo de sensor) si cfg.dividir
function construirModelo(cfg) {
  if (cfg.guiaCol2 && cfg.umbralDentro > cfg.umbralFuera) {
    throw new Error('Guía COL2: la P mínima dentro de COL2 no puede ser mayor que la de fuera.');
  }
  var detalle = ' · E' + cfg.ecosEnt.join(',E') + ' · modo ' + cfg.modo +
    (cfg.modo === 'ESPECIE' ? ' · suavizado ' + cfg.radio + ' px' + (cfg.consenso ? ' · consenso temporal' : '') : '') +
    (cfg.areaMin > 1 ? ' · área mín. ' + cfg.areaMin + ' px' : '') +
    (cfg.bufferKm > 0 ? ' · buffer ' + cfg.bufferKm + ' km' : '') +
    (cfg.guiaCol2 && cfg.modo === 'ESPECIE' ? ' · guía COL2 (' + cfg.umbralDentro + ' / ' + cfg.umbralFuera + ')' : '');
  var fondo = 'maestra ' + cfg.verEnt + (cfg.verEnt === VER_CON_AGRO ? ' (con agro)' : ' (sin agro)');
  if (!cfg.dividir) {
    var m = construirModeloUno(cfg);
    m.fuente = fondo + detalle;
    return m;
  }
  var partes = PERIODOS_MAESTRA.map(function (p) {
    return construirModeloUno(copiarCfg(cfg, {ini: p[0], fin: p[1]}));
  });
  return {cfg: cfg, partes: partes, fuente: fondo + detalle + ' · un modelo por periodo'};
}

function parteDe(m, y) {
  if (!m.partes) return m;
  var ok = m.partes.filter(function (q) { return y >= q.cfg.ini && y <= q.cfg.fin; });
  return ok.length ? ok[0] : m.partes[m.partes.length - 1];
}

// Guía COL2. La máscara da probabilidades [P(plantación), P(otras), P(cosechado)] (clases 1, 3, 4 en ese orden).
//   · COSECHADO (4): solo DENTRO de COL2 9 y donde esa clase tiene la mayor probabilidad de la máscara. Fuera de COL2 no se
//     agrega cosechado por probabilidad (queda en otras). Los umbrales no intervienen en esta clase.
//   · PLANTACIÓN entre los que no son cosechado, con la plantación de COL2 (clase 9) como apoyo, sin limitarse a ella:
//       dentro de COL2 9 → plantación si P >= umbralDentro   (umbral bajo: COL2 respalda)
//       fuera de COL2 9  → plantación solo si P >= umbralFuera (umbral alto: el modelo debe estar muy seguro)
//   · Todo lo demás: otras (3).
// Solo en modo ESPECIE. Si el año no está en COL2 se usa el año más cercano disponible.
function guiaCol2(st, sub, cfg, y) {
  var col2 = col2Plantacion(y);
  if (!col2) return null;
  var pr = st.classify(sub.rfProb);                       // arreglo [P(1), P(3), P(4)]
  var pPlant = pr.arrayGet([0]);
  var valido = pPlant.mask();
  var cos = pr.arrayArgmax().arrayGet([0]).eq(2).and(col2);   // índice 2 = cosechado; solo dentro de COL2
  var ok = col2.and(pPlant.gte(cfg.umbralDentro)).or(pPlant.gte(cfg.umbralFuera)).and(cos.not());
  var base = ee.Image(3).where(cos, 4).where(ok, 1).updateMask(valido).toByte();
  return {base: base, plant: ok.updateMask(valido), cos: cos.updateMask(valido), col2: col2, valido: valido};
}

// Capas de diagnóstico de la guía (antes del filtro de área): qué agrega el modelo fuera de COL2 y qué descarta dentro
function guiaAño(m, eco, y) {
  var sub = parteDe(m, y);
  var mask = mascaraEco(eco, m.cfg.bufferKm);
  return guiaCol2(stackAño(y).updateMask(mask), sub, m.cfg, y);
}

// Máscara de plantación (clase base) y, en modo ESPECIE, P(pino) suavizada dentro de la plantación.
// Suavizado: promedio en una ventana cuadrada de lado 2·radio+1 píxeles, solo con píxeles de plantación.
function capasAño(m, eco, y) {
  var sub = parteDe(m, y);
  var mask = mascaraEco(eco, m.cfg.bufferKm);
  var st = stackAño(y).updateMask(mask);
  var base = st.classify(sub.rf).toByte();
  if (!sub.rfEspecie) return {base: base, p: null, plant: null};
  var plant = base.eq(1);
  if (m.cfg.guiaCol2 && sub.rfProb) {
    var g = guiaCol2(st, sub, m.cfg, y);
    if (g) { base = g.base; plant = g.plant; }
  }
  var p = st.classify(sub.rfEspecieProb).arrayGet([0]).rename('p_pino').updateMask(plant);
  if (m.cfg.radio > 0) p = p.focalMean(m.cfg.radio, 'square', 'pixels').updateMask(plant);
  return {base: base, p: p, plant: plant};
}

// Filtro de área mínima: un parche conexo (8 vecinos) de pino o de eucalipto con menos de minPx píxeles pasa a
// "otras" (3). Se evalúa por clase: un parche mixto de 11 px de pino + 11 px de eucalipto no pasa el filtro de 22.
// 1 píxel = 900 m², así que 22 px ≈ 2 ha.
function filtrarAreaMinima(img, minPx) {
  if (!(minPx > 1)) return img;
  var quitar = ee.Image(0);
  [1, 2].forEach(function (c) {
    var esC = img.eq(c);
    quitar = quitar.or(esC.and(esC.connectedPixelCount(minPx, true).lt(minPx)).unmask(0));
  });
  return img.where(quitar, 3).toByte();
}

function clasificarAñoModelo(m, eco, y) {
  return filtrarAreaMinima(clasificarAñoSinFiltro(m, eco, y), m.cfg.areaMin).rename('silvicultura');
}

// P(pino) del año, solo dentro de la plantación (suavizada; con consenso temporal si está activo)
function pinoAño(m, eco, y, c) {
  var p = c.p;
  // Consenso temporal: P(pino) promedio entre los años seleccionados donde el píxel fue plantación
  if (m.cfg.consenso && m.cfg.años.length > 1) {
    p = ee.ImageCollection(m.cfg.años.map(function (yy) { return capasAño(m, eco, yy).p; }))
      .mean().updateMask(c.plant);
  }
  return p;
}

function clasificarAñoSinFiltro(m, eco, y) {
  var c = capasAño(m, eco, y);
  if (!c.p) return c.base.rename('silvicultura');
  var p = pinoAño(m, eco, y, c);
  var especie = ee.Image(2).where(p.gte(0.5), 1);        // pino (1) si P(pino) >= 0.5; si no, eucalipto (2)
  return c.base.where(c.plant, especie).toByte().rename('silvicultura');
}

// Probabilidades por píxel del año (0–100, byte), para exportar junto a la clasificación. Solo en modo ESPECIE.
// Una banda por clase; suman ~100 (P(plantación) + P(otras) + P(cosechado) = 1 en el modelo de máscara):
//   p_pino       = P(plantación) × P(pino)
//   p_euca       = P(plantación) × (1 − P(pino))
//   p_cosechado  = P(cosechado)   (modelo de máscara)
//   p_otras      = P(otras)       (modelo de máscara)
// P(pino) es la del modelo de especie; dentro de la plantación usa la versión suavizada (y con consenso si está activo),
// que es la que decide pino/euca en la clasificación; fuera de la plantación usa la probabilidad directa del modelo.
//   probabilidad = la probabilidad de la clase que quedó asignada en 'silvicultura' (ya con guía COL2 y filtro de área).
// OJO: la clase final no siempre es la de mayor probabilidad: la guía COL2 (umbrales dentro/fuera) y el cosechado solo dentro
// de COL2 pueden asignar una clase distinta de la banda más alta. En píxeles que el filtro de área pasó a "otras" la
// probabilidad asignada es baja (el modelo veía plantación).
function bandasProbAño(m, eco, y, clase) {
  var sub = parteDe(m, y);
  if (!sub.rfEspecie || !sub.rfProb) return null;
  var mask = mascaraEco(eco, m.cfg.bufferKm);
  var st = stackAño(y).updateMask(mask);
  var pr = st.classify(sub.rfProb);                       // arreglo [P(plantación), P(otras), P(cosechado)]
  var pPlant = pr.arrayGet([0]), pOtras = pr.arrayGet([1]), pCos = pr.arrayGet([2]);
  var c = capasAño(m, eco, y);
  var pEspDirecta = st.classify(sub.rfEspecieProb).arrayGet([0]);              // P(pino) sin suavizar, en todo el píxel
  var pPino = pinoAño(m, eco, y, c).unmask(pEspDirecta);                       // suavizada/consenso dentro de plantación
  var pPinoFinal = pPlant.multiply(pPino);
  var pEucaFinal = pPlant.multiply(ee.Image(1).subtract(pPino));
  var prob = ee.Image(0)
    .where(clase.eq(1), pPinoFinal)
    .where(clase.eq(2), pEucaFinal)
    .where(clase.eq(3), pOtras)
    .where(clase.eq(4), pCos);
  var aByte = function (im, nombre) { return im.multiply(100).round().clamp(0, 100).toByte().rename(nombre).updateMask(clase.mask()); };
  return aByte(pPinoFinal, 'p_pino')
    .addBands(aByte(pEucaFinal, 'p_euca'))
    .addBands(aByte(pCos, 'p_cosechado'))
    .addBands(aByte(pOtras, 'p_otras'))
    .addBands(aByte(prob, 'probabilidad'));
}

// Imagen a exportar: clase (banda 0, 'silvicultura') + bandas de probabilidad si se piden y el modo lo permite
function imagenExport(m, eco, y, conProb) {
  var clase = clasificarAñoModelo(m, eco, y);
  if (!conProb) return clase;
  var pb = bandasProbAño(m, eco, y, clase);
  return pb ? clase.addBands(pb) : clase;
}

// Geometría de la ecorregión (vector E{n}); con bufferKm > 0 se le suma una franja geodésica de esa distancia.
function geomEco(eco, bufferKm) {
  var g = ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + eco).geometry();
  return bufferKm > 0 ? g.buffer(bufferKm * 1000, 100) : g;
}

// Máscara de trabajo: píxeles de la ecorregión (raster) + la franja de bufferKm alrededor (vector con buffer).
// Sin buffer es exactamente la máscara anterior: raster de ecorregiones eq(eco).
function mascaraEco(eco, bufferKm) {
  var propia = ee.Image(ASSET_ECO_RASTER).select(0).eq(eco);
  if (!(bufferKm > 0)) return propia.selfMask();
  var franja = ee.Image(0).byte().paint(ee.FeatureCollection([ee.Feature(geomEco(eco, bufferKm))]), 1);
  return propia.unmask(0).or(franja).selfMask();
}

// Región de exportación: rectángulo que envuelve la ecorregión, ampliado en bufferKm.
function regionEco(eco, bufferKm) {
  var b = ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + eco).geometry().bounds();
  return bufferKm > 0 ? b.buffer(bufferKm * 1000).bounds() : b;
}

// ==========================================================================================
// INTERFAZ
// ==========================================================================================
var COLOR_BORDE_TAB_ACTIVO = '#FFB300';

function estiloTab(ancho, activo) {
  return {
    width: ancho, height: '32px', fontSize: '9px',
    fontWeight: activo ? 'bold' : 'normal',
    color: activo ? '#8A4A00' : '#444444',
    backgroundColor: activo ? '#FFF3E0' : '#E0E0E0',
    border: activo ? ('3px solid ' + COLOR_BORDE_TAB_ACTIVO) : '1px solid #BDBDBD',
    margin: '0 2px 2px 0', padding: '0'
  };
}

function crearSeccion(titulo, widgets) {
  var panel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      stretch: 'horizontal', margin: '0 0 7px 0', padding: '7px',
      border: '1px solid #d7d7d7', backgroundColor: 'rgba(255,255,255,0.92)'
    }
  });
  panel.add(ui.Label(titulo, {fontWeight: 'bold', fontSize: '13px', margin: '0 0 5px 0'}));
  (widgets || []).forEach(function (w) { panel.add(w); });
  return panel;
}

function nota(txt) {
  return ui.Label(txt, {fontSize: '10px', color: '#666666', margin: '3px 0 0 0', whiteSpace: 'pre-wrap'});
}

function crearSistemaTabs(defs, anchoTab, porFila) {
  // defs: [{clave, etiqueta, panel}]
  var botones = {};
  var activo = defs[0].clave;
  function mostrar(clave) {
    activo = clave;
    defs.forEach(function (d) {
      d.panel.style().set('shown', d.clave === clave);
      botones[d.clave].style().set(estiloTab(anchoTab, d.clave === clave));
    });
  }
  defs.forEach(function (d) {
    botones[d.clave] = ui.Button({
      label: d.etiqueta,
      style: estiloTab(anchoTab, d.clave === activo),
      onClick: function () { mostrar(d.clave); }
    });
  });
  var filas = ui.Panel({layout: ui.Panel.Layout.flow('vertical'), style: {margin: '0', padding: '0'}});
  for (var i = 0; i < defs.length; i += porFila) {
    filas.add(ui.Panel({
      widgets: defs.slice(i, i + porFila).map(function (d) { return botones[d.clave]; }),
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {margin: '0', padding: '0'}
    }));
  }
  var contenido = ui.Panel({style: {stretch: 'horizontal', margin: '4px 0 0 0', padding: '0'}});
  defs.forEach(function (d) { contenido.add(d.panel); });
  mostrar(activo);
  return ui.Panel({widgets: [filas, contenido], style: {stretch: 'horizontal', margin: '0', padding: '0'}});
}

// ------------------------------------------------------------------------------------------
// Tab Clasificación
// ------------------------------------------------------------------------------------------
// Ecorregiones que se pueden clasificar: las que tienen muestras (7–11) y E5 y E12, que no tienen muestras de silvicultura
// propias y se clasifican con un modelo entrenado en otras ecorregiones (transferencia, para evaluar si hacen falta muestras).
var ECOS_SIN_MUESTRAS = [5, 12];
var ITEMS_ECO = ECOS_SIN_MUESTRAS.slice(0, 1).concat(ECOS_SILVI, ECOS_SIN_MUESTRAS.slice(1)).map(function (n) {
  return {label: 'E' + n + (ECOS_SIN_MUESTRAS.indexOf(n) >= 0 ? ' (sin muestras propias)' : ''), value: String(n)};
});

var ecoSelect = ui.Select({items: ITEMS_ECO, value: String(DEF.eco), style: {stretch: 'horizontal'}});
var ecosEntBox = ui.Textbox({value: DEF.ecosEnt, placeholder: 'ej. 8 o 7,8', style: {stretch: 'horizontal'}});

var periodoSelect = ui.Select({
  items: [
    {label: 'Automático · un modelo por periodo (según el año)', value: 'AUTO'},
    {label: 'Landsat 5/7 · 1996–2012', value: 'L57'},
    {label: 'Landsat 8/9 · 2013–2026', value: 'L89'},
    {label: 'Todo · 1996–2026', value: 'ALL'},
    {label: 'Personalizado', value: 'CUSTOM'}
  ],
  value: DEF.periodo,
  style: {stretch: 'horizontal'}
});

var AÑOS_DISP = [];
for (var yy = 1996; yy <= 2026; yy++) AÑOS_DISP.push(yy);
var itemsAños = AÑOS_DISP.map(function (y) { return String(y); });
var iniSelect = ui.Select({items: itemsAños, value: '1996', style: {width: '115px', margin: '0 6px 0 0'}});
var finSelect = ui.Select({items: itemsAños, value: '2026', style: {width: '115px', margin: '0'}});
var panelPeriodoCustom = ui.Panel({
  widgets: [
    ui.Panel([ui.Label('Desde', {fontSize: '10px', margin: '0 0 2px 0'}), iniSelect], null, {margin: '0 6px 0 0'}),
    ui.Panel([ui.Label('Hasta', {fontSize: '10px', margin: '0 0 2px 0'}), finSelect], null, {margin: '0'})
  ],
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {margin: '4px 0 0 0', padding: '0', shown: false}
});
var resumenTablasLabel = nota('');

function rangoPeriodo() {
  var p = periodoSelect.getValue();
  if (p === 'AUTO') return {ini: 1996, fin: 2026};
  if (p === 'L57') return {ini: 1996, fin: 2012};
  if (p === 'L89') return {ini: 2013, fin: 2026};
  if (p === 'ALL') return {ini: 1996, fin: 2026};
  var ini = parseInt(iniSelect.getValue(), 10), fin = parseInt(finSelect.getValue(), 10);
  if (ini > fin) throw new Error('Periodo personalizado: Desde debe ser <= Hasta.');
  return {ini: ini, fin: fin};
}

function actualizarResumenTablas() {
  panelPeriodoCustom.style().set('shown', periodoSelect.getValue() === 'CUSTOM');
  try {
    var ecos = parseListaEcos(ecosEntBox.getValue());
    var r = rangoPeriodo();
    var s = tablasDe('silvo', ecos, r.ini, r.fin);
    var b = tablasDe('base', ecos, r.ini, r.fin);
    var añosB = b.map(function (t) { return 'e' + t.eco + '_' + t.yr; }).sort();
    resumenTablasLabel.setValue(
      'Periodo ' + r.ini + '–' + r.fin + ' · ecorregiones ' + ecos.join(', ') + '\n' +
      'Tablas silvo: ' + s.length + '\n' +
      'Tablas base (' + b.length + '): ' + (añosB.length ? añosB.join(', ') : 'ninguna'));
    resumenTablasLabel.style().set('color', (s.length && b.length) ? '#2E7D32' : '#B71C1C');
  } catch (err) {
    resumenTablasLabel.setValue(err.message);
    resumenTablasLabel.style().set('color', '#B71C1C');
  }
}
periodoSelect.onChange(actualizarResumenTablas);
iniSelect.onChange(actualizarResumenTablas);
finSelect.onChange(actualizarResumenTablas);
ecosEntBox.onChange(actualizarResumenTablas);

// --- Año(s) a clasificar: botones conmutables + All ---
var YEAR_OFF = {width: '56px', height: '26px', fontSize: '10px', margin: '1px', padding: '0',
  color: '#666666', backgroundColor: '#f5f5f5', border: '1px solid #cccccc', fontWeight: 'normal'};
var YEAR_ON = {width: '56px', height: '26px', fontSize: '10px', margin: '1px', padding: '0',
  color: '#20640d', backgroundColor: '#F4FFF0', border: '3px solid #49e71e', fontWeight: 'bold'};

var yearSel = {}, yearBtn = {};
function estiloAño(y) {
  yearBtn[y].style().set(yearSel[y] ? YEAR_ON : YEAR_OFF);
  yearBtn[y].setLabel(yearSel[y] ? ('✓' + y) : String(y));
}
function añosSeleccionados() {
  return AÑOS_DISP.filter(function (y) { return yearSel[y]; });
}
function todosSel() { return AÑOS_DISP.every(function (y) { return yearSel[y]; }); }

var btnAll = ui.Button({label: 'All', onClick: function () {
  var nuevo = !todosSel();
  AÑOS_DISP.forEach(function (y) { yearSel[y] = nuevo; estiloAño(y); });
  estiloAll();
}});
function estiloAll() {
  var on = todosSel();
  btnAll.style().set({
    stretch: 'horizontal', height: '27px', fontSize: '10px', margin: '0 0 2px 0', padding: '0',
    fontWeight: 'bold', color: on ? '#20640d' : '#555555',
    backgroundColor: on ? '#F4FFF0' : '#f3f3f3', border: on ? '3px solid #49e71e' : '1px solid #cccccc'
  });
  btnAll.setLabel(on ? '✓ All' : 'All');
}

var columnasAños = [0, 1, 2, 3].map(function () {
  return ui.Panel([], ui.Panel.Layout.flow('vertical'), {width: '60px', margin: '0', padding: '0'});
});
AÑOS_DISP.forEach(function (y, i) {
  yearSel[y] = DEF.años.indexOf(y) >= 0;
  yearBtn[y] = ui.Button({label: String(y), onClick: function () {
    yearSel[y] = !yearSel[y]; estiloAño(y); estiloAll();
  }});
  estiloAño(y);
  columnasAños[i % 4].add(yearBtn[y]);
});
estiloAll();
var gridAños = ui.Panel(columnasAños, ui.Panel.Layout.flow('horizontal'), {stretch: 'horizontal', margin: '0', padding: '0'});

var panelTabClasif = ui.Panel({style: {stretch: 'horizontal', margin: '0', padding: '0'}});
panelTabClasif.add(crearSeccion('Ecorregión a clasificar', [ecoSelect]));
panelTabClasif.add(crearSeccion('Ecorregiones de entrenamiento', [
  ecosEntBox, nota('Números entre 7 y 11, separados por coma. Ej.: 7,8 entrena con las muestras de E7 y E8.\n' +
    'Para clasificar E5 o E12 (sin muestras propias) entrena con las ecorregiones más cercanas, ej. 7 para E5 y 11 para E12. ' +
    'Las métricas del panel son de las ecorregiones de entrenamiento, no de E5/E12: ahí se evalúa mirando el mapa y la capa COL2.')
]));
panelTabClasif.add(crearSeccion('Periodo de entrenamiento', [periodoSelect, panelPeriodoCustom, resumenTablasLabel,
  nota('Automático: se entrenan dos modelos (1996–2012 y 2013–2026) y cada año usa el de su periodo; el panel muestra una matriz por periodo. ' +
       'Con cualquier otra opción se entrena un solo modelo con ese rango y se aplica a todos los años (sirve para probar si un año se clasifica mejor con otro modelo).')
]));
panelTabClasif.add(crearSeccion('Año(s) a clasificar', [btnAll, gridAños,
  nota('Solo el primer año seleccionado se muestra encendido. Conviene clasificar años dentro del periodo de entrenamiento.')]));

// ------------------------------------------------------------------------------------------
// Tab Muestreo
// ------------------------------------------------------------------------------------------
function filaCampo(etiqueta, valor, ancho) {
  var box = ui.Textbox({value: String(valor), style: {width: ancho || '80px', margin: '0', fontSize: '10px'}});
  var fila = ui.Panel({
    widgets: [ui.Label(etiqueta, {width: '150px', fontSize: '10px', margin: '6px 4px 0 0'}), box],
    layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0 0 2px 0', padding: '0'}
  });
  return {fila: fila, box: box};
}
var cPino = filaCampo('Pino · puntos train', DEF.pino);
var cEuca = filaCampo('Eucalipto · puntos train', DEF.euca);
var cOtras = filaCampo('Otras · puntos train', DEF.otras);
var modeloSelect = ui.Select({
  items: [{label: 'Máscara plantación + modelo de especie', value: 'ESPECIE'},
          {label: 'Multiclase (un RF con todas las clases)', value: 'MULTI'}],
  value: 'ESPECIE', style: {stretch: 'horizontal', margin: '0 0 4px 0'}
});
var cRadio = filaCampo('Suavizado de especie (radio px, 0 = no)', 3);
var cAreaMin = filaCampo('Área mínima de parche pino/euca (px, 0 = no)', 22);
var cBuffer = filaCampo('Buffer alrededor de la ecorregión (km, 0 = no)', DEF.bufferKm);
var guiaCol2Check = ui.Checkbox({label: 'Guía COL2 para plantación (solo modo máscara + especie)', value: true,
  style: {fontSize: '10px', margin: '2px 0 2px 0'}});
var cUmbralDentro = filaCampo('Guía COL2 · P mínima dentro de COL2 (0–1)', 0.4);
var cUmbralFuera = filaCampo('Guía COL2 · P mínima fuera de COL2 (0–1)', 0.85);
var consensoCheck = ui.Checkbox({label: 'Consenso temporal de especie entre los años seleccionados', value: false,
  style: {fontSize: '10px', margin: '2px 0 2px 0'}});
var cAgro = filaCampo('Agro (solo v2) · puntos train', DEF.agro);
var cCosecha = filaCampo('Cosechado (4) · puntos train', DEF.cosecha);
var cLectC = filaCampo('Lectura cosechado (0–1)', 0.5);
var cTest = filaCampo('Fracción test (0–1)', DEF.fracTest);
var cArb = filaCampo('Árboles RF', DEF.arboles);

var verSelect = ui.Select({
  items: [{label: 'v1 · silvi vs otros (sin agro)', value: VER_SIN_AGRO},
          {label: 'v2 · silvi vs otros + agro', value: VER_CON_AGRO}],
  value: DEF.verEnt, style: {stretch: 'horizontal', margin: '0 0 4px 0'}
});
var cCap = filaCampo('Máx. puntos / periodo / clase', DEF.cap);
var cLectS = filaCampo('Lectura silvo (0–1)', DEF.lectSilvo);
var cLectB = filaCampo('Lectura base (0–1)', DEF.lectBase);
var cLectA = filaCampo('Lectura agro (0–1)', DEF.lectAgro);
var estadoTablaEnt = nota('');
var btnExportarTablaEnt = ui.Button({label: 'Exportar tablas faltantes (v1 y v2)', style: {stretch: 'horizontal'}});

var panelTabMuestreo = ui.Panel({style: {stretch: 'horizontal', margin: '0', padding: '0'}});
panelTabMuestreo.add(crearSeccion('Puntos y test (se aplican al entrenar)', [
  ui.Label('Tipo de modelo', {fontSize: '10px', fontWeight: 'bold', margin: '0 0 2px 0'}), modeloSelect,
  cRadio.fila, consensoCheck, cAreaMin.fila, cBuffer.fila, guiaCol2Check, cUmbralDentro.fila, cUmbralFuera.fila,
  ui.Label('Muestras de fondo', {fontSize: '10px', fontWeight: 'bold', margin: '0 0 2px 0'}), verSelect,
  cPino.fila, cEuca.fila, cOtras.fila, cAgro.fila, cCosecha.fila, cTest.fila, cArb.fila,
  nota('Puedes cambiarlos cuando quieras: solo presiona Aplicar parámetros. No requieren exportar nada.\n' +
       'Buffer: clasifica y exporta también una franja de ese ancho alrededor de la ecorregión (con el modelo de esta ecorregión). Las ecorregiones vecinas se solapan en la franja; 0 = solo la ecorregión. Con buffer los cálculos son más pesados: usa 0 para explorar rápido.\n' +
       'Modo máscara + especie: entrena un modelo aparte solo con pino vs eucalipto y lo aplica donde la máscara dice plantación.\n' +
       'Test ≈ fracción test / (1 − fracción test) de los puntos de train. Si una clase tiene menos puntos disponibles, se usan todos.')
]));
panelTabMuestreo.add(crearSeccion('Tablas maestras v1 y v2 (una vez por ecorregión)', [
  cCap.fila, cLectS.fila, cLectB.fila, cLectA.fila, cLectC.fila, btnExportarTablaEnt, estadoTablaEnt,
  nota('Se exporta una vez por ecorregión (las indicadas en "Ecorregiones de entrenamiento"; pon 7,8,9,10,11 para todas) ' +
       'y sirve para cualquier periodo, ecorregión de entrenamiento, N por clase y fracción test.\n' +
       'Máx. y lecturas solo se usan al exportar. v1 = sin agro; v2 = v1 + agro (se arma desde la v1, que debe existir antes). El selector de arriba elige cuál usar para entrenar. Solo hay que re-exportar si cambian los predictores o las muestras de origen (sube la versión).')
]));

// ------------------------------------------------------------------------------------------
// Tab Exportar
// ------------------------------------------------------------------------------------------
var carpetaBox = ui.Textbox({value: CARPETA_SALIDA, style: {stretch: 'horizontal', fontSize: '9px'}});
var versionBox = ui.Textbox({value: DEF.version, style: {width: '80px'}});
var estadoExport = nota('Presiona Aplicar parámetros antes de exportar.');
var btnExportar = ui.Button({label: 'Exportar años seleccionados', style: {stretch: 'horizontal'}});
var todosAñosCheck = ui.Checkbox({label: 'Exportar todos los años (1996–2026), estén o no cargados', value: false,
  style: {fontSize: '10px', margin: '6px 0 2px 0'}});
todosAñosCheck.onChange(function (v) {
  btnExportar.setLabel(v ? 'Exportar todos los años (1996–2026)' : 'Exportar años seleccionados');
});

var probCheck = ui.Checkbox({label: 'Incluir bandas de probabilidad (0–100)', value: true,
  style: {fontSize: '10px', margin: '4px 0 2px 0'}});

// --- Agregar probabilidades a una versión ya exportada (assets nuevos: silvo_e{eco}_{año}_{versión}{sufijo}) ---
var verOrigenBox = ui.Textbox({value: DEF.version, style: {width: '80px'}});
var sufijoProbBox = ui.Textbox({value: '_prob', style: {width: '80px'}});
var btnVerificar = ui.Button({label: 'Verificar que el modelo reproduce la versión', style: {stretch: 'horizontal'}});
var btnAgregarProb = ui.Button({label: 'Exportar versión + probabilidades', style: {stretch: 'horizontal'}});
var estadoProb = nota('Aplica primero los MISMOS parámetros con que se exportó la versión de origen.');

var panelTabExportar = ui.Panel({style: {stretch: 'horizontal', margin: '0', padding: '0'}});
panelTabExportar.add(crearSeccion('Exportar clasificación', [
  ui.Label('Carpeta', {fontSize: '10px', margin: '0 0 2px 0'}), carpetaBox,
  ui.Label('Versión', {fontSize: '10px', margin: '4px 0 2px 0'}), versionBox,
  todosAñosCheck, probCheck, btnExportar, estadoExport,
  ui.Label('Agregar probabilidades a una versión ya exportada', {fontSize: '11px', fontWeight: 'bold', margin: '10px 0 2px 0'}),
  ui.Label('Versión de origen (la clase se copia tal cual) · sufijo del asset nuevo', {fontSize: '10px', margin: '2px 0 2px 0'}),
  ui.Panel([verOrigenBox, sufijoProbBox], ui.Panel.Layout.flow('horizontal')),
  btnVerificar, btnAgregarProb, estadoProb,
  nota('Los assets no se pueden modificar: se crea uno nuevo por año con la clase del asset de origen (banda 0) y las bandas de ' +
       'probabilidad calculadas con el modelo de la última ejecución. Usa la casilla "todos los años" de arriba para elegir años. ' +
       'Verifica antes la coincidencia: si el modelo no es el mismo, las probabilidades no corresponden a esa clase.'),
  nota('Un asset por año: silvo_e{eco}_{año}_{versión}. Usa el modelo de la última ejecución (presiona Aplicar parámetros antes). ' +
       'Con la casilla marcada se exportan los 31 años aunque no estén cargados en el mapa. Los assets existentes se omiten.\n' +
       'Bandas del asset: silvicultura (clase 1 pino, 2 euca, 3 otras, 4 cosechado), p_pino, p_euca, p_cosechado y p_otras ' +
       '(suman ~100) y probabilidad (la de la clase asignada). Todas 0–100. La clase es siempre la banda 0.')
]));

// --- Clasificaciones ya exportadas ---
var capasExportadas = [];   // [{layer, layerPlant, año, ver, id}]
var versionExpSelect = ui.Select({items: [], placeholder: 'Sin versiones', style: {stretch: 'horizontal'}});
var soloAñosSelCheck = ui.Checkbox({label: 'Solo los años seleccionados', value: false,
  style: {fontSize: '10px', margin: '4px 0 2px 0'}});
var estadoExportadas = nota('');
var EXPORTADAS = [];        // catálogo de la ecorregión activa

function listarExportadas(eco) {
  var carpeta = carpetaBox.getValue().replace(/\/+$/, '');
  var re = /^silvo_e(\d+)_(\d{4})_(.+)$/;
  var out = [];
  try {
    listarCarpeta(carpeta).forEach(function (a) {
      if (a.type !== 'IMAGE') return;
      var id = a.id || a.name;
      var m = id.split('/').pop().match(re);
      if (m && +m[1] === eco) out.push({id: id, eco: +m[1], yr: +m[2], ver: m[3]});
    });
  } catch (err) {
    estadoExportadas.setValue('No se pudo leer la carpeta: ' + err.message);
    estadoExportadas.style().set('color', '#B71C1C');
  }
  return out.sort(function (a, b) { return a.yr - b.yr; });
}

function numVersion(v) { var m = String(v).match(/(\d+)/); return m ? +m[1] : 0; }

function actualizarAñosExportados() {
  var ver = versionExpSelect.getValue();
  var lista = EXPORTADAS.filter(function (t) { return t.ver === ver; });
  if (!lista.length) {
    estadoExportadas.setValue('No hay clasificaciones exportadas para E' + ecoSelect.getValue() + '.');
    estadoExportadas.style().set('color', '#B71C1C');
    return;
  }
  estadoExportadas.setValue('E' + ecoSelect.getValue() + ' · ' + ver + ' · ' + lista.length + ' año(s): ' +
    lista.map(function (t) { return t.yr; }).join(', '));
  estadoExportadas.style().set('color', '#2E7D32');
  // Metadatos del primer asset (cómo se entrenó)
  ee.Image(lista[0].id).toDictionary(['ecos_ent', 'periodo', 'arboles']).evaluate(function (d) {
    if (!d) return;
    var partes = [];
    if (d.ecos_ent) partes.push('entrenado con e' + d.ecos_ent);
    if (d.periodo) partes.push('periodo ' + d.periodo);
    if (d.arboles) partes.push(d.arboles + ' árboles');
    if (partes.length) estadoExportadas.setValue(estadoExportadas.getValue() + '\nModelo: ' + partes.join(' · '));
  });
}

function leerExportadas() {
  var eco = parseInt(ecoSelect.getValue(), 10);
  EXPORTADAS = listarExportadas(eco);
  var versiones = EXPORTADAS.map(function (t) { return t.ver; })
    .filter(function (v, i, arr) { return arr.indexOf(v) === i; })
    .sort(function (a, b) { return numVersion(a) - numVersion(b); });
  versionExpSelect.items().reset(versiones);
  if (versiones.length) {
    versionExpSelect.setValue(versiones[versiones.length - 1], false);   // última versión
    actualizarAñosExportados();
  } else {
    versionExpSelect.setPlaceholder('Sin versiones');
    estadoExportadas.setValue('No hay clasificaciones exportadas para E' + eco + '.');
    estadoExportadas.style().set('color', '#B71C1C');
  }
}
versionExpSelect.onChange(actualizarAñosExportados);
ecoSelect.onChange(leerExportadas);

function quitarExportadas() {
  capasExportadas.forEach(function (c) {
    Map.layers().remove(c.layer);
    Map.layers().remove(c.layerPlant);
  });
  capasExportadas = [];
}

function mostrarExportadas() {
  var ver = versionExpSelect.getValue();
  if (!ver) { leerExportadas(); ver = versionExpSelect.getValue(); }
  var lista = EXPORTADAS.filter(function (t) { return t.ver === ver; });
  if (soloAñosSelCheck.getValue()) {
    var sel = añosSeleccionados();
    lista = lista.filter(function (t) { return sel.indexOf(t.yr) >= 0; });
  }
  if (!lista.length) {
    estadoExportadas.setValue('No hay años exportados para mostrar con ese filtro.');
    estadoExportadas.style().set('color', '#B71C1C');
    return;
  }
  quitarExportadas();
  lista.forEach(function (t, i) {
    var img = ee.Image(t.id).select(0);
    var capa = ui.Map.Layer(img, VIS_CLASIF, 'Exportada ' + t.ver + ' ' + t.yr, i === 0);
    var capaP = ui.Map.Layer(img.updateMask(img.lte(2)), VIS_PLANT, 'Exportada ' + t.ver + ' ' + t.yr + ' · Pino/Euca', false);
    Map.layers().add(capa);
    Map.layers().add(capaP);
    capasExportadas.push({layer: capa, layerPlant: capaP, año: t.yr, ver: t.ver, id: t.id});
  });
  Map.centerObject(regionEco(parseInt(ecoSelect.getValue(), 10)), 9);
  estadoExportadas.setValue('Mostrando ' + lista.length + ' año(s) de ' + ver + ' (encendido: ' + lista[0].yr + ').');
  estadoExportadas.style().set('color', '#2E7D32');
}

panelTabExportar.add(crearSeccion('Clasificaciones exportadas', [
  ui.Label('Versión', {fontSize: '10px', margin: '0 0 2px 0'}), versionExpSelect,
  soloAñosSelCheck,
  ui.Panel([
    ui.Button({label: 'Mostrar', style: {width: '90px', margin: '0 4px 0 0'}, onClick: mostrarExportadas}),
    ui.Button({label: 'Quitar', style: {width: '80px', margin: '0 4px 0 0'}, onClick: quitarExportadas}),
    ui.Button({label: '↻ Leer', style: {width: '75px', margin: '0'}, onClick: leerExportadas})
  ], ui.Panel.Layout.flow('horizontal'), {margin: '4px 0 0 0', padding: '0'}),
  estadoExportadas,
  nota('Carga los assets silvo_e{eco}_{año}_{versión} de la carpeta indicada arriba, sin reentrenar. Por defecto se elige la última versión.')
]));

// ------------------------------------------------------------------------------------------
// Panel derecho
// ------------------------------------------------------------------------------------------
var panelDerecho = ui.Panel({style: {width: '330px', padding: '0 0 0 6px', stretch: 'vertical'}});
panelDerecho.add(ui.Label('Silvicultura · RF multianual', {fontWeight: 'bold', fontSize: '15px', margin: '4px 0 6px 0'}));
panelDerecho.add(crearSistemaTabs([
  {clave: 'clasif', etiqueta: 'Clasificación', panel: panelTabClasif},
  {clave: 'muestreo', etiqueta: 'Muestreo', panel: panelTabMuestreo},
  {clave: 'exportar', etiqueta: 'Exportar', panel: panelTabExportar}
], '104px', 3));

// ------------------------------------------------------------------------------------------
// Panel izquierdo: Leyenda + tabs Métricas / Mosaico
// ------------------------------------------------------------------------------------------
var panelLeyenda = crearSeccion('Leyenda', CLASES.map(function (c) {
  return ui.Panel({
    widgets: [
      ui.Label('', {backgroundColor: '#' + c.color, padding: '7px', margin: '2px 6px 2px 0', border: '1px solid #999'}),
      ui.Label(c.id + ' · ' + c.nombre, {fontSize: '11px', margin: '3px 0 0 0'})
    ],
    layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0', padding: '0'}
  });
}));

var panelMetricas = ui.Panel({style: {stretch: 'horizontal', margin: '0', padding: '0'}});
var estadoMetricas = nota('Presiona Aplicar parámetros para calcular las métricas.');
panelMetricas.add(estadoMetricas);
var contMetricas = ui.Panel({style: {stretch: 'horizontal', margin: '0', padding: '0'}});
panelMetricas.add(contMetricas);

// --- Mosaico ---
var trimSelect = ui.Select({items: ['Q1_', 'Q2_', 'Q3_', 'Q4_'], value: 'Q2_', style: {width: '80px'}});
var combSelect = ui.Select({
  items: [
    {label: 'SWIR1 / NIR / RED', value: 'swir1_median,nir_median,red_median'},
    {label: 'NIR / SWIR1 / RED', value: 'nir_median,swir1_median,red_median'},
    {label: 'RED / GREEN / BLUE', value: 'red_median,green_median,blue_median'}
  ],
  value: 'swir1_median,nir_median,red_median', style: {stretch: 'horizontal'}
});
var minBox = ui.Textbox({value: '70', style: {width: '60px'}});
var maxBox = ui.Textbox({value: '4000', style: {width: '60px'}});
var gammaBox = ui.Textbox({value: '0.85', style: {width: '60px'}});
var capasMosaico = [];

function visMosaico() {
  var bandas = combSelect.getValue().split(',').map(function (b) { return PREFIJO + trimSelect.getValue() + b; });
  return {bands: bandas, min: Number(minBox.getValue()), max: Number(maxBox.getValue()), gamma: Number(gammaBox.getValue())};
}
function actualizarMosaicos() {
  var v = visMosaico();
  capasMosaico.forEach(function (c) {
    c.layer.setVisParams(v);
    c.layer.setName('Mosaico ' + trimSelect.getValue().replace('_', '') + ' ' + c.año);
  });
}
var panelMosaico = ui.Panel({style: {stretch: 'horizontal', margin: '0', padding: '0'}});
panelMosaico.add(crearSeccion('Mosaico trimestral', [
  ui.Panel([ui.Label('Trimestre', {fontSize: '10px', width: '70px', margin: '8px 0 0 0'}), trimSelect], ui.Panel.Layout.flow('horizontal')),
  combSelect,
  ui.Panel([ui.Label('Min', {fontSize: '10px', margin: '8px 2px 0 0'}), minBox,
            ui.Label('Max', {fontSize: '10px', margin: '8px 2px 0 6px'}), maxBox], ui.Panel.Layout.flow('horizontal')),
  ui.Panel([ui.Label('Gamma', {fontSize: '10px', margin: '8px 2px 0 0'}), gammaBox], ui.Panel.Layout.flow('horizontal')),
  ui.Button({label: 'Actualizar mosaico', style: {stretch: 'horizontal'}, onClick: actualizarMosaicos})
]));

var panelIzquierdo = ui.Panel({style: {width: '300px', padding: '0 6px 0 0', stretch: 'vertical'}});
panelIzquierdo.add(panelLeyenda);
panelIzquierdo.add(crearSistemaTabs([
  {clave: 'metricas', etiqueta: 'Métricas', panel: panelMetricas},
  {clave: 'mosaico', etiqueta: 'Mosaico', panel: panelMosaico}
], '142px', 2));

// ------------------------------------------------------------------------------------------
// Gráficos (clic en el mapa)
// ------------------------------------------------------------------------------------------
var panelGraficos = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {stretch: 'horizontal', height: '200px', padding: '5px', margin: '4px 0 0 0',
          backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid #cccccc', shown: false}
});
panelGraficos.add(nota('Haz clic en el mapa para ver la serie NDVI trimestral del punto.'));
var graficosVisibles = false;
function mostrarGraficos(visible) {
  graficosVisibles = visible;
  panelGraficos.style().set('shown', visible);
  btnGraficos.setLabel(visible ? '▾  Ocultar gráficos del punto' : '▸  Mostrar gráficos del punto');
}
var btnGraficos = ui.Button({
  label: '▸  Mostrar gráficos del punto',
  style: {stretch: 'horizontal', fontSize: '11px', fontWeight: 'bold', color: '#1565C0',
          backgroundColor: '#f0f4f8', margin: '2px 0 0 0', padding: '2px 6px'},
  onClick: function () { mostrarGraficos(!graficosVisibles); }
});

// ------------------------------------------------------------------------------------------
// Bloque de ejecución flotante
// ------------------------------------------------------------------------------------------
var statusLabel = ui.Label('Listo.', {fontSize: '10px', color: '#666666', margin: '5px 0 0 0', whiteSpace: 'pre-wrap'});
var btnAplicar = ui.Button({label: 'Aplicar parámetros', style: {stretch: 'horizontal', margin: '0'}});
var panelEjecucion = ui.Panel({
  widgets: [ui.Label('Ejecución', {fontWeight: 'bold', fontSize: '12px', color: '#1565C0', margin: '0 0 5px 0'}),
            btnAplicar, statusLabel],
  style: {position: 'bottom-right', width: '245px', margin: '0 8px 8px 0', padding: '8px',
          border: '2px solid #1565C0', backgroundColor: 'rgba(244,248,252,0.96)'}
});

// ------------------------------------------------------------------------------------------
// Layout fijo
// ------------------------------------------------------------------------------------------
var mapaPrincipal = ui.root.widgets().get(0);
mapaPrincipal.style().set('stretch', 'both');

var btnMostrarIzq = ui.Button({label: '▶ Mostrar panel', style: {position: 'top-left', margin: '6px',
  fontSize: '10px', shown: false}});
var btnOcultarIzq = ui.Button({label: '◀ Ocultar panel', style: {position: 'top-left', margin: '92px 6px 6px 6px',
  fontSize: '10px', shown: true}});
btnMostrarIzq.onClick(function () {
  panelIzquierdo.style().set('shown', true); btnMostrarIzq.style().set('shown', false); btnOcultarIzq.style().set('shown', true);
});
btnOcultarIzq.onClick(function () {
  panelIzquierdo.style().set('shown', false); btnOcultarIzq.style().set('shown', false); btnMostrarIzq.style().set('shown', true);
});

var panelCentral = ui.Panel({style: {stretch: 'both', padding: '0'}});
ui.root.setLayout(ui.Panel.Layout.flow('horizontal'));
ui.root.widgets().reset([panelIzquierdo, panelCentral, panelDerecho]);
panelCentral.add(mapaPrincipal);
panelCentral.add(btnGraficos);
panelCentral.add(panelGraficos);
mapaPrincipal.add(panelEjecucion);
mapaPrincipal.add(btnOcultarIzq);
mapaPrincipal.add(btnMostrarIzq);

// ==========================================================================================
// EJECUCIÓN
// ==========================================================================================
var MODELO = null;     // {rf, cfg, ...} de la última ejecución
var capaPunto = null;

function leerConfig() {
  var r = rangoPeriodo();
  var años = añosSeleccionados();
  if (!años.length) throw new Error('Selecciona al menos un año a clasificar.');
  return {
    eco: parseInt(ecoSelect.getValue(), 10),
    ecosEnt: parseListaEcos(ecosEntBox.getValue()),
    ini: r.ini, fin: r.fin, años: años,
    pino: parseEntero(cPino.box.getValue(), 'Pino', 1),
    euca: parseEntero(cEuca.box.getValue(), 'Eucalipto', 1),
    otras: parseEntero(cOtras.box.getValue(), 'Otras', 1),
    agro: parseEntero(cAgro.box.getValue(), 'Agro', 0),
    lectAgro: parseFraccion(cLectA.box.getValue(), 'Lectura agro'),
    usaCosecha: true,                                   // Cosechado siempre se clasifica (lo decide la máscara, solo dentro de COL2)
    cosecha: parseEntero(cCosecha.box.getValue(), 'Cosechado', 1),
    lectCosecha: parseFraccion(cLectC.box.getValue(), 'Lectura cosechado'),
    difMin: 1, difMax: 1,
    fracTest: parseFraccion(cTest.box.getValue(), 'Fracción test'),
    lectSilvo: parseFraccion(cLectS.box.getValue(), 'Lectura silvo'),
    lectBase: parseFraccion(cLectB.box.getValue(), 'Lectura base'),
    arboles: parseEntero(cArb.box.getValue(), 'Árboles', 1),
    verEnt: verSelect.getValue() || VER_SIN_AGRO,
    modo: modeloSelect.getValue() || 'ESPECIE',
    dividir: periodoSelect.getValue() === 'AUTO',   // AUTO: un modelo por periodo de sensor; cada año usa el de su periodo
    radio: parseEntero(cRadio.box.getValue(), 'Suavizado', 0),
    areaMin: Math.min(256, parseEntero(cAreaMin.box.getValue(), 'Área mínima', 0)),
    bufferKm: parseKm(cBuffer.box.getValue(), 'Buffer'),
    guiaCol2: guiaCol2Check.getValue() === true,
    umbralDentro: parseFraccion(cUmbralDentro.box.getValue(), 'P mínima dentro de COL2'),
    umbralFuera: parseFraccion(cUmbralFuera.box.getValue(), 'P mínima fuera de COL2'),
    consenso: consensoCheck.getValue() === true,
    cap: parseEntero(cCap.box.getValue(), 'Máx. puntos por periodo y clase', 1)
  };
}

// Estado de las tablas maestras (v1 y v2) de las ecorregiones de entrenamiento
function actualizarEstadoTablaEnt() {
  try {
    var ecos = parseListaEcos(ecosEntBox.getValue());
    var lineas = [];
    ecos.forEach(function (e) {
      lineas.push((existe(idMaestra(e, VER_SIN_AGRO)) ? '✓ ' : '✗ ') + nombreMaestra(e, VER_SIN_AGRO));
      if (!tablasDe('agro', [e], 1996, 2026).length) lineas.push('— ' + nombreMaestra(e, VER_CON_AGRO) + ': sin tablas agro de origen');
      else lineas.push((existe(idMaestra(e, VER_CON_AGRO)) ? '✓ ' : '✗ ') + nombreMaestra(e, VER_CON_AGRO));
      lineas.push((existe(idCosecha(e)) ? '✓ ' : '✗ ') + nombreCosecha(e));
    });
    var faltan = lineas.filter(function (l) { return l.charAt(0) === '✗'; }).length;
    estadoTablaEnt.setValue(lineas.join('\n'));
    estadoTablaEnt.style().set('color', faltan ? '#B71C1C' : '#2E7D32');
  } catch (err) {
    estadoTablaEnt.setValue(err.message);
    estadoTablaEnt.style().set('color', '#B71C1C');
  }
}
ecosEntBox.onChange(actualizarEstadoTablaEnt);

btnExportarTablaEnt.onClick(function () {
  try {
    var cfg = leerConfig();
    var creadas = [], existentes = [], avisos = [];
    cfg.ecosEnt.forEach(function (e) {
      var v1Existe = existe(idMaestra(e, VER_SIN_AGRO));
      if (v1Existe) existentes.push(nombreMaestra(e, VER_SIN_AGRO));
      else {
        var t1 = maestraDeEco(e, cfg).set({
          eco: e, version: VER_SIN_AGRO, cap: cfg.cap, lect_silvo: cfg.lectSilvo, lect_base: cfg.lectBase
        });
        Export.table.toAsset({collection: t1, description: nombreMaestra(e, VER_SIN_AGRO),
          assetId: idMaestra(e, VER_SIN_AGRO)});
        creadas.push(nombreMaestra(e, VER_SIN_AGRO));
      }
      if (existe(idCosecha(e))) existentes.push(nombreCosecha(e));
      else {
        var tc = cosechaDeEco(e, cfg).set({
          eco: e, cap: cfg.cap, lect_cosecha: cfg.lectCosecha, dif_min: cfg.difMin, dif_max: cfg.difMax
        });
        Export.table.toAsset({collection: tc, description: nombreCosecha(e), assetId: idCosecha(e)});
        creadas.push(nombreCosecha(e));
      }
      if (!tablasDe('agro', [e], 1996, 2026).length) return;
      if (existe(idMaestra(e, VER_CON_AGRO))) { existentes.push(nombreMaestra(e, VER_CON_AGRO)); return; }
      if (!v1Existe) { avisos.push(nombreMaestra(e, VER_CON_AGRO) + ' (espera a que termine la v1 y vuelve a presionar)'); return; }
      var t2 = maestraConAgro(e, cfg).set({
        eco: e, version: VER_CON_AGRO, cap: cfg.cap, lect_agro: cfg.lectAgro
      });
      Export.table.toAsset({collection: t2, description: nombreMaestra(e, VER_CON_AGRO),
        assetId: idMaestra(e, VER_CON_AGRO)});
      creadas.push(nombreMaestra(e, VER_CON_AGRO));
    });
    estadoTablaEnt.setValue(
      (creadas.length ? 'Tareas creadas: ' + creadas.join(', ') + '. Lánzalas en Tasks.\n' : '') +
      (existentes.length ? 'Ya existían: ' + existentes.join(', ') + '.\n' : '') +
      (avisos.length ? 'Pendiente: ' + avisos.join('; ') + '.\n' : '') +
      'Al terminar, presiona Aplicar parámetros.');
    estadoTablaEnt.style().set('color', '#1565C0');
  } catch (err) {
    estadoTablaEnt.setValue('Error: ' + err.message);
    estadoTablaEnt.style().set('color', '#B71C1C');
  }
});
actualizarEstadoTablaEnt();

function fmt(x) { return (x === null || x === undefined || isNaN(x)) ? '—' : (Math.round(x * 1000) / 10) + ' %'; }

// Un bloque de métricas (matriz, OA, PA/UA, conteos y, si se pide, importancia).
// El contenedor se agrega de inmediato para conservar el orden aunque las consultas terminen distinto.
function bloqueMetricas(op) {
  var cont = ui.Panel({style: {margin: '0', padding: '0'}});
  contMetricas.add(cont);
  cont.add(nota(op.titulo + ': calculando…'));
  var cm = op.test.classify(op.rf).errorMatrix('clase', 'classification', op.clases);
  var dic = {
    matriz: cm.array(),
    oa: cm.accuracy(),
    pa: cm.producersAccuracy().project([0]),
    ua: cm.consumersAccuracy().project([1]),
    nTrain: op.train.aggregate_histogram('clase'),
    nTest: op.test.aggregate_histogram('clase')
  };
  if (op.testAgro) dic.agroPred = op.testAgro.classify(op.rf).aggregate_histogram('classification');
  ee.Dictionary(dic).evaluate(function (r, err) {
    cont.clear();
    if (err) { cont.add(nota(op.titulo + ' — error en métricas: ' + err)); return; }

    var celda = function (txt, ancho, bold, fondo) {
      return ui.Label(String(txt), {width: ancho, fontSize: '10px', margin: '0', padding: '3px',
        fontWeight: bold ? 'bold' : 'normal', backgroundColor: fondo || '#FFFFFF', border: '1px solid #e0e0e0',
        textAlign: 'center'});
    };
    var nombres = op.nombres;
    var tabla = ui.Panel({style: {margin: '4px 0', padding: '0'}});
    tabla.add(ui.Panel([celda('Verdad \\ Pred', '78px', true, '#F5F5F5')]
      .concat(nombres.map(function (n) { return celda(n, '52px', true, '#F5F5F5'); }))
      .concat([celda('PA', '50px', true, '#F5F5F5')]), ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
    r.matriz.forEach(function (fila, i) {
      var celdas = [celda(nombres[i], '78px', true, '#F5F5F5')];
      fila.forEach(function (v, j) { celdas.push(celda(v, '52px', i === j, i === j ? '#E8F5E9' : (v > 0 ? '#FFF8E1' : '#FFFFFF'))); });
      celdas.push(celda(fmt(r.pa[i]), '50px', false, '#F5F5F5'));
      tabla.add(ui.Panel(celdas, ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));
    });
    tabla.add(ui.Panel([celda('UA', '78px', true, '#F5F5F5')]
      .concat(r.ua.map(function (v) { return celda(fmt(v), '52px', false, '#F5F5F5'); })),
      ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'}));

    cont.add(crearSeccion(op.titulo + ' — matriz de confusión (test)', [
      tabla,
      ui.Label('Overall accuracy: ' + fmt(r.oa), {fontSize: '11px', fontWeight: 'bold', margin: '4px 0 0 0'}),
      nota('Puntos train: ' + JSON.stringify(r.nTrain) + '\nPuntos test: ' + JSON.stringify(r.nTest) +
           '\nClases: ' + op.clases.map(function (c, i) { return c + ' ' + nombres[i]; }).join(', '))
    ]));
    if (r.agroPred) {
      var tot = 0, por = {};
      Object.keys(r.agroPred).forEach(function (k) { tot += r.agroPred[k]; por[Math.round(parseFloat(k))] = r.agroPred[k]; });
      var lineas = op.clases.map(function (c, i) {
        return nombres[i] + (c === 3 ? ' (correcto)' : '') + ': ' + fmt(tot ? (por[c] || 0) / tot : null);
      });
      cont.add(crearSeccion('Agro (test) — cómo se clasifica', [nota(lineas.join('\n') + '\nn = ' + tot)]));
    }
    if (op.conImportancia) {
      var imp = ee.Dictionary(ee.Dictionary(op.rf.explain()).get('importance'));
      var impFc = ee.FeatureCollection(imp.keys().map(function (k) {
        return ee.Feature(null, {banda: k, imp: imp.get(k)});
      })).sort('imp', false).limit(20);
      var chartImp = ui.Chart.feature.byFeature(impFc, 'banda', 'imp').setChartType('BarChart')
        .setOptions({title: 'Importancia — top 20 (' + op.titulo + ')', legend: {position: 'none'}, fontSize: 9});
      chartImp.style().set({height: '380px'});
      cont.add(crearSeccion('Importancia de variables', [chartImp]));
    }
  });
}

function metricasUno(modelo, cfg, pref) {
  if (modelo.rfEspecie) {
    bloqueMetricas({
      titulo: pref + 'Especie (pino vs eucalipto)', rf: modelo.rfEspecie, train: modelo.trainEsp, test: modelo.testEsp,
      clases: [1, 2], nombres: ['Pino', 'Euca'], conImportancia: true
    });
    bloqueMetricas({
      titulo: pref + 'Máscara de plantación', rf: modelo.rf, train: modelo.trainMask, test: modelo.testMask,
      clases: cfg.usaCosecha ? [1, 3, 4] : [1, 3],
      nombres: cfg.usaCosecha ? ['Plantación', 'Otras', 'Cosech.'] : ['Plantación', 'Otras'],
      testAgro: modelo.testAgro
    });
  } else {
    bloqueMetricas({
      titulo: pref + 'Multiclase', rf: modelo.rf, train: modelo.train, test: modelo.test,
      clases: cfg.usaCosecha ? [1, 2, 3, 4] : [1, 2, 3],
      nombres: cfg.usaCosecha ? ['Pino', 'Euca', 'Otras', 'Cosech.'] : ['Pino', 'Euca', 'Otras'],
      testAgro: modelo.testAgro, conImportancia: true
    });
  }
}

function mostrarMetricas(modelo) {
  contMetricas.clear();
  var cfg = modelo.cfg;
  estadoMetricas.setValue('Modelo: e' + cfg.ecosEnt.join(',') + ' · ' +
    (cfg.dividir ? 'un modelo por periodo' : cfg.ini + '–' + cfg.fin) + ' · ' + cfg.modo);
  estadoMetricas.style().set('color', '#2E7D32');
  if (modelo.partes) {
    modelo.partes.forEach(function (g) {
      contMetricas.add(nota('— Periodo ' + g.cfg.ini + '–' + g.cfg.fin + ' —'));
      metricasUno(g, g.cfg, '[' + g.cfg.ini + '–' + g.cfg.fin + '] ');
    });
  } else {
    metricasUno(modelo, cfg, '');
  }
  contMetricas.add(nota('Las métricas son por punto, sin suavizado ni consenso. El efecto del promedio de probabilidades ' +
    'se ve en el mapa; para medirlo hace falta validar por polígono.'));
}

// Referencia visual (no entra en ningún modelo ni exportación): plantaciones de la Colección 2 (clase 9, pino y
// eucalipto sin separar), dibujadas por encima de la clasificación. Se agregan dos capas por año: contorno y relleno.
var COL2_ASSET = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-02/CLASSIFICATIONS/classification-final/clasificacion-final-3';
var COL2_PLANTACION = 9;
var COL2_BANDAS = null;   // lista de bandas del asset, se consulta una sola vez

function bandasCol2() {
  if (COL2_BANDAS === null) {
    try { COL2_BANDAS = ee.Image(COL2_ASSET).bandNames().getInfo() || []; } catch (e) { COL2_BANDAS = []; }
  }
  return COL2_BANDAS;
}

// Plantación COL2 (clase 9) del año y; si ese año no existe, el más cercano disponible. null si no se pudo leer COL2.
function col2Plantacion(y) {
  var años = bandasCol2().map(function (b) { return parseInt(String(b).replace('classification_', ''), 10); })
    .filter(function (a) { return !isNaN(a); });
  if (!años.length) return null;
  var cerca = años.reduce(function (a, b) { return Math.abs(b - y) < Math.abs(a - y) ? b : a; });
  return ee.Image(COL2_ASSET).select('classification_' + cerca).eq(COL2_PLANTACION).unmask(0);
}

function agregarCapasCol2(y, mask, mostrarContorno) {
  bandasCol2();
  var banda = 'classification_' + y;
  if (COL2_BANDAS.indexOf(banda) < 0) return false;       // año fuera del rango de la Colección 2
  var p = ee.Image(COL2_ASSET).select(banda).eq(COL2_PLANTACION).selfMask().updateMask(mask);
  var p0 = p.unmask(0);
  var borde = p0.subtract(p0.focalMin(1, 'square', 'pixels')).selfMask().updateMask(mask);
  Map.addLayer(p, {palette: ['E040FB']}, 'COL2 plantación (9) ' + y + ' · relleno', false, 0.5);
  Map.addLayer(borde, {palette: ['FF00FF']}, 'COL2 plantación (9) ' + y + ' · contorno', !!mostrarContorno);
  return true;
}

function ejecutar() {
  try {
    var cfg = leerConfig();
    statusLabel.setValue('Construyendo modelo e' + cfg.ecosEnt.join(',') + ' · ' + (cfg.dividir ? 'por periodo' : cfg.ini + '–' + cfg.fin) +
      ' · mapa E' + cfg.eco + ' · ' + cfg.años.join(', '));
    statusLabel.style().set('color', '#444444');

    var modelo = construirModelo(cfg);
    modelo.cfg = cfg;
    MODELO = modelo;

    Map.layers().reset([]);
    capasMosaico = [];
    capasExportadas = [];
    capaPunto = null;

    var mask = mascaraEco(cfg.eco, cfg.bufferKm);
    var region = regionEco(cfg.eco, cfg.bufferKm);
    Map.centerObject(region, 9);

    cfg.años.forEach(function (y, i) {
      var capaM = ui.Map.Layer(stackAño(y).updateMask(mask), visMosaico(),
        'Mosaico ' + trimSelect.getValue().replace('_', '') + ' ' + y, false);
      Map.layers().add(capaM);
      capasMosaico.push({layer: capaM, año: y});
    });
    cfg.años.forEach(function (y, i) {
      var c = clasificarAñoModelo(modelo, cfg.eco, y);
      Map.addLayer(c, VIS_CLASIF, 'Clasificación ' + y, i === 0);
      Map.addLayer(c.updateMask(c.lte(2)), VIS_PLANT, 'Pino / Eucalipto ' + y, false);
    });
    if (cfg.guiaCol2 && cfg.modo === 'ESPECIE') {
      cfg.años.forEach(function (y) {
        var g = guiaAño(modelo, cfg.eco, y);
        if (!g) return;
        Map.addLayer(g.plant.and(g.col2.not()).selfMask(), {palette: ['00E5FF']}, 'Guía ' + y + ' · agregado fuera de COL2', false);
        Map.addLayer(g.col2.and(g.plant.not()).and(g.cos.not()).selfMask().updateMask(g.valido).updateMask(mask),
          {palette: ['FF1744']}, 'Guía ' + y + ' · descartado dentro de COL2', false);
        Map.addLayer(g.cos.selfMask(), {palette: ['FF9100']}, 'Guía ' + y + ' · cosechado (dentro de COL2)', false);
      });
    }
    var sinCol2 = [];
    cfg.años.forEach(function (y, i) {
      if (!agregarCapasCol2(y, mask, i === 0)) sinCol2.push(y);
    });
    Map.addLayer(ee.Image().byte().paint(ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + cfg.eco), 1, 2),
      {palette: ['FFFF00']}, 'Límite E' + cfg.eco, false);
    if (cfg.bufferKm > 0) {
      Map.addLayer(ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(geomEco(cfg.eco, cfg.bufferKm))]), 1, 2),
        {palette: ['00E5FF']}, 'Límite buffer ' + cfg.bufferKm + ' km', false);
    }

    mostrarMetricas(modelo);
    statusLabel.setValue('Modelo e' + cfg.ecosEnt.join(',') + ' · ' + (cfg.dividir ? 'por periodo' : cfg.ini + '–' + cfg.fin) +
      '\nFuente: ' + modelo.fuente + '\nCapas: E' + cfg.eco + ' · ' + cfg.años.join(', ') +
      (sinCol2.length ? '\nSin capa COL2 (fuera de su rango): ' + sinCol2.join(', ') : ''));
    statusLabel.style().set('color', '#2E7D32');
    estadoExport.setValue('Listo para exportar ' + cfg.años.length + ' año(s) de E' + cfg.eco + '.');
    estadoExport.style().set('color', '#666666');
  } catch (err) {
    statusLabel.setValue('Error: ' + err.message);
    statusLabel.style().set('color', '#B71C1C');
  }
}
btnAplicar.onClick(ejecutar);

// --- Exportar ---
btnExportar.onClick(function () {
  if (!MODELO) {
    estadoExport.setValue('Primero presiona Aplicar parámetros.');
    estadoExport.style().set('color', '#B71C1C');
    return;
  }
  var cfg = MODELO.cfg;
  var carpeta = carpetaBox.getValue().replace(/\/+$/, '');
  var ver = String(versionBox.getValue()).trim() || 'v1';
  var region = regionEco(cfg.eco, cfg.bufferKm);
  var creadas = [], omitidas = [];
  var todos = todosAñosCheck.getValue() === true;
  var añosExp = todos ? AÑOS_DISP.slice() : cfg.años;
  // Con consenso temporal, el promedio de P(pino) se hace sobre los años que se exportan
  var añosCfgOrig = cfg.años;
  if (todos) cfg.años = añosExp;
  añosExp.forEach(function (y) {
    var nombre = 'silvo_e' + cfg.eco + '_' + y + '_' + ver;
    if (existe(carpeta + '/' + nombre)) { omitidas.push(nombre); return; }
    Export.image.toAsset({
      image: imagenExport(MODELO, cfg.eco, y, probCheck.getValue() === true).set({
        year: y, eco: cfg.eco, ecos_ent: cfg.ecosEnt.join(','), periodo: cfg.dividir ? '1996-2012 | 2013-2026 (modelo por año)' : cfg.ini + '-' + cfg.fin,
        arboles: cfg.arboles, version: ver, modo: cfg.modo, fondo_ver: cfg.verEnt,
        transferido: cfg.ecosEnt.indexOf(cfg.eco) < 0 ? 1 : 0,
        dividir: cfg.dividir ? 1 : 0, radio: cfg.radio, consenso: cfg.consenso ? 1 : 0, area_min_px: cfg.areaMin, buffer_km: cfg.bufferKm,
        cosechado: 1, guia_col2: (cfg.guiaCol2 && cfg.modo === 'ESPECIE') ? 1 : 0, umbral_dentro: cfg.umbralDentro, umbral_fuera: cfg.umbralFuera,
        con_probabilidad: (probCheck.getValue() === true && cfg.modo === 'ESPECIE') ? 1 : 0
      }),
      description: nombre, assetId: carpeta + '/' + nombre,
      region: region, scale: ESCALA, maxPixels: 1e13,
      pyramidingPolicy: {'.default': 'mean', 'silvicultura': 'mode'}
    });
    creadas.push(nombre);
  });
  cfg.años = añosCfgOrig;
  estadoExport.setValue('Tareas creadas (' + creadas.length + '): ' + (creadas.join(', ') || '—') +
    (omitidas.length ? '\nYa existen (omitidas): ' + omitidas.join(', ') : '') +
    (todos && cfg.consenso ? '\nAviso: con consenso temporal y todos los años, cada tarea promedia 31 años (más pesada).' : '') +
    '\nLánzalas en la pestaña Tasks.');
  estadoExport.style().set('color', creadas.length ? '#2E7D32' : '#B71C1C');
});

// --- Agregar probabilidades a una versión ya exportada ---
// Parámetros del asset de origen que deben coincidir con los de la última ejecución para que el modelo sea el mismo
function difParametros(props, cfg) {
  var dif = [];
  var cmp = function (nombre, a, b) { if (a !== undefined && a !== null && String(a) !== String(b)) dif.push(nombre + ': asset ' + a + ' vs actual ' + b); };
  cmp('árboles', props.arboles, cfg.arboles);
  cmp('radio', props.radio, cfg.radio);
  cmp('área mín.', props.area_min_px, cfg.areaMin);
  cmp('buffer (km)', (props.buffer_km === undefined || props.buffer_km === null) ? 0 : props.buffer_km, cfg.bufferKm);   // assets sin la propiedad = sin buffer
  cmp('umbral dentro', props.umbral_dentro, cfg.umbralDentro);
  cmp('umbral fuera', props.umbral_fuera, cfg.umbralFuera);
  cmp('consenso', props.consenso, cfg.consenso ? 1 : 0);
  cmp('modelo por periodo', props.dividir, cfg.dividir ? 1 : 0);
  cmp('entrenado con', props.ecos_ent, cfg.ecosEnt.join(','));
  cmp('guía COL2', props.guia_col2, (cfg.guiaCol2 && cfg.modo === 'ESPECIE') ? 1 : 0);
  cmp('tablas de entrenamiento (versión)', props.fondo_ver, cfg.verEnt);
  return dif;
}
function propsAsset(id) {
  try { return ee.data.getAsset(id).properties || {}; } catch (e) { return null; }
}
function añosProb(cfg) {
  return todosAñosCheck.getValue() === true ? AÑOS_DISP.slice() : cfg.años.slice();
}

btnVerificar.onClick(function () {
  if (!MODELO) { estadoProb.setValue('Primero presiona Aplicar parámetros.'); estadoProb.style().set('color', '#B71C1C'); return; }
  var cfg = MODELO.cfg;
  var carpeta = carpetaBox.getValue().replace(/\/+$/, '');
  var ver = String(verOrigenBox.getValue()).trim();
  var y = añosProb(cfg)[0];
  var id = carpeta + '/silvo_e' + cfg.eco + '_' + y + '_' + ver;
  var props = propsAsset(id);
  if (props === null) { estadoProb.setValue('No existe ' + id); estadoProb.style().set('color', '#B71C1C'); return; }
  var dif = difParametros(props, cfg);
  estadoProb.setValue('Comparando ' + y + ' (escala 240 m)…' + (dif.length ? '\nParámetros distintos:\n· ' + dif.join('\n· ') : '\nParámetros iguales.'));
  estadoProb.style().set('color', '#666666');
  var añosOrig = cfg.años;
  if (todosAñosCheck.getValue() === true) cfg.años = AÑOS_DISP.slice();
  var viva = clasificarAñoModelo(MODELO, cfg.eco, y);
  cfg.años = añosOrig;
  var orig = ee.Image(id).select(0).rename('silvicultura');
  var pin = orig.eq(1).or(orig.eq(2));
  var orig3 = orig.eq(3);
  // Qué pasa con cada clase de la versión exportada al recalcularla con el modelo actual
  var bandas = ee.Image.cat([
    viva.eq(orig).rename('todo'),
    viva.eq(orig).updateMask(pin).rename('silvo_igual'),
    viva.eq(3).updateMask(pin).rename('silvo_a_otras'),
    viva.eq(4).updateMask(pin).rename('silvo_a_cosechado'),
    viva.neq(orig).and(viva.lte(2)).updateMask(pin).rename('silvo_cambia_especie'),
    viva.lte(2).updateMask(orig3).rename('otras_a_silvo'),
    viva.eq(4).updateMask(orig3).rename('otras_a_cosechado')
  ]);
  bandas.reduceRegion({reducer: ee.Reducer.mean(), geometry: regionEco(cfg.eco, cfg.bufferKm), scale: 240, maxPixels: 1e10, tileScale: 4})
    .evaluate(function (r, err) {
      if (err || !r) { estadoProb.setValue('Falló la verificación: ' + String(err || 'sin resultado').slice(0, 150)); estadoProb.style().set('color', '#B71C1C'); return; }
      var f = function (v) { return (v === null || v === undefined) ? 'n/d' : (v * 100).toFixed(1) + '%'; };
      var ok = r.silvo_igual !== null && r.silvo_igual !== undefined && r.silvo_igual >= 0.98 && r.todo >= 0.995;
      estadoProb.setValue('Año ' + y + ' · ' + (ok ? 'COINCIDE: el modelo reproduce la versión.' : 'NO COINCIDE: no exportes las probabilidades con este modelo.') +
        '\nCoincidencia en todos los píxeles: ' + f(r.todo) + ' (la dominan los píxeles "otras").' +
        '\nPíxeles pino/euca de la versión: ' + f(r.silvo_igual) + ' iguales' +
        ' · ' + f(r.silvo_cambia_especie) + ' cambian de especie · ' + f(r.silvo_a_otras) + ' pasan a otras · ' + f(r.silvo_a_cosechado) + ' a cosechado.' +
        '\nPíxeles otras de la versión que ahora serían silvo: ' + f(r.otras_a_silvo) + ' (cosechado: ' + f(r.otras_a_cosechado) + ').' +
        '\nParámetros guardados en el asset: ' + (dif.length ? 'DISTINTOS\n· ' + dif.join('\n· ') : 'iguales (no incluye nº de muestras ni ajustes de entrenamiento que el asset no guarda).'));
      estadoProb.style().set('color', ok && !dif.length ? '#2E7D32' : '#E65100');
    });
});

btnAgregarProb.onClick(function () {
  if (!MODELO) { estadoProb.setValue('Primero presiona Aplicar parámetros.'); estadoProb.style().set('color', '#B71C1C'); return; }
  var cfg = MODELO.cfg;
  if (cfg.modo !== 'ESPECIE') { estadoProb.setValue('Las probabilidades solo están disponibles en modo ESPECIE.'); estadoProb.style().set('color', '#B71C1C'); return; }
  var carpeta = carpetaBox.getValue().replace(/\/+$/, '');
  var ver = String(verOrigenBox.getValue()).trim();
  var suf = String(sufijoProbBox.getValue()).trim();
  if (!ver || !suf) { estadoProb.setValue('Indica la versión de origen y un sufijo para el asset nuevo.'); estadoProb.style().set('color', '#B71C1C'); return; }
  var region = regionEco(cfg.eco, cfg.bufferKm);
  var todos = todosAñosCheck.getValue() === true;
  var añosExp = añosProb(cfg);
  var añosCfgOrig = cfg.años;
  if (todos) cfg.años = añosExp;                    // mismo consenso temporal que al exportar todos los años
  var creadas = [], sinOrigen = [], yaExisten = [], dif = [];
  añosExp.forEach(function (y) {
    var idOrig = carpeta + '/silvo_e' + cfg.eco + '_' + y + '_' + ver;
    var nombre = 'silvo_e' + cfg.eco + '_' + y + '_' + ver + suf;
    var props = propsAsset(idOrig);
    if (props === null) { sinOrigen.push(y); return; }
    if (existe(carpeta + '/' + nombre)) { yaExisten.push(nombre); return; }
    if (!dif.length) dif = difParametros(props, cfg);
    var clase = ee.Image(idOrig).select(0).rename('silvicultura').toByte();
    var pb = bandasProbAño(MODELO, cfg.eco, y, clase);
    Export.image.toAsset({
      image: clase.addBands(pb).set({
        year: y, eco: cfg.eco, ecos_ent: cfg.ecosEnt.join(','), version: ver + suf, version_origen: ver,
        con_probabilidad: 1, prob_modelo_reentrenado: 1, arboles: cfg.arboles, radio: cfg.radio, consenso: cfg.consenso ? 1 : 0,
        area_min_px: cfg.areaMin, buffer_km: cfg.bufferKm, dividir: cfg.dividir ? 1 : 0, cosechado: 1, guia_col2: cfg.guiaCol2 ? 1 : 0,
        umbral_dentro: cfg.umbralDentro, umbral_fuera: cfg.umbralFuera
      }),
      description: nombre, assetId: carpeta + '/' + nombre,
      region: region, scale: ESCALA, maxPixels: 1e13,
      pyramidingPolicy: {'.default': 'mean', 'silvicultura': 'mode'}
    });
    creadas.push(nombre);
  });
  cfg.años = añosCfgOrig;
  estadoProb.setValue('Tareas creadas (' + creadas.length + '): ' + (creadas.join(', ') || '—') +
    (sinOrigen.length ? '\nSin asset de origen ' + ver + ' en: ' + sinOrigen.join(', ') : '') +
    (yaExisten.length ? '\nYa existen (omitidas): ' + yaExisten.join(', ') : '') +
    (dif.length ? '\nOjo, parámetros distintos al asset de origen:\n· ' + dif.join('\n· ') : '') +
    '\nLánzalas en la pestaña Tasks.');
  estadoProb.style().set('color', creadas.length ? (dif.length ? '#E65100' : '#2E7D32') : '#B71C1C');
});

// --- Clic en el mapa: serie NDVI trimestral + clase por año ---
Map.style().set('cursor', 'crosshair');
Map.onClick(function (coords) {
  var punto = ee.Geometry.Point([coords.lon, coords.lat]);
  if (capaPunto) Map.layers().remove(capaPunto);
  capaPunto = ui.Map.Layer(punto, {color: 'FF19FD'}, 'Punto consultado');
  Map.layers().add(capaPunto);

  mostrarGraficos(true);
  panelGraficos.clear();
  panelGraficos.add(nota('Cargando serie…'));

  var años = ee.List.sequence(1996, 2026);
  var serie = ee.ImageCollection(años.map(function (y) {
    y = ee.Number(y);
    return stackAño(y).select(Q.map(function (q) { return PREFIJO + q + 'ndvi'; }), ['Q1', 'Q2', 'Q3', 'Q4'])
      .set('system:time_start', ee.Date.fromYMD(y, 1, 1).millis());
  }));
  var chart = ui.Chart.image.series({imageCollection: serie, region: punto, reducer: ee.Reducer.first(), scale: ESCALA})
    .setOptions({
      title: 'NDVI trimestral · ' + coords.lat.toFixed(5) + ', ' + coords.lon.toFixed(5),
      hAxis: {title: 'Año'}, vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 1}},
      lineWidth: 1.5, pointSize: 2,
      series: {0: {color: '#E65100'}, 1: {color: '#8D6E63'}, 2: {color: '#1565C0'}, 3: {color: '#2E7D32'}}
    });
  chart.style().set({width: '560px', height: '185px', margin: '0 8px 0 0'});

  var claseLabel = nota('');
  panelGraficos.clear();
  panelGraficos.add(chart);
  panelGraficos.add(ui.Panel([ui.Label('Clase del punto', {fontWeight: 'bold', fontSize: '11px'}), claseLabel],
    null, {width: '200px', margin: '0', padding: '0'}));

  // Clase en las clasificaciones exportadas cargadas y/o en el modelo en vivo
  var bandas = [], etiquetas = [];
  capasExportadas.forEach(function (c) {
    bandas.push(ee.Image(c.id).select(0).rename('x' + bandas.length));
    etiquetas.push('Exportada ' + c.ver + ' ' + c.año);
  });
  if (MODELO) {
    MODELO.cfg.años.forEach(function (y) {
      bandas.push(clasificarAñoModelo(MODELO, MODELO.cfg.eco, y).rename('x' + bandas.length));
      etiquetas.push('En vivo ' + y);
    });
  }
  if (!bandas.length) { claseLabel.setValue('Aplica parámetros o muestra clasificaciones exportadas para ver la clase.'); return; }
  claseLabel.setValue('Calculando…');
  ee.Image.cat(bandas).reduceRegion({reducer: ee.Reducer.first(), geometry: punto, scale: ESCALA})
    .evaluate(function (r, err) {
      if (err) { claseLabel.setValue('Error: ' + err); return; }
      claseLabel.setValue(etiquetas.map(function (et, i) {
        var v = r['x' + i];
        return et + ': ' + (v === null || v === undefined ? 'sin dato' : NOMBRE_CLASE[v]);
      }).join('\n'));
    });
});

// Estado inicial
actualizarResumenTablas();
actualizarEstadoTablaEnt();
leerExportadas();
statusLabel.setValue('Configura los parámetros y presiona Aplicar parámetros.');