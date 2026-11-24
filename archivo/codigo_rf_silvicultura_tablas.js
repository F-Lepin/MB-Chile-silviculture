// =====================================================================
// SCRIPT: codigo_rf_silvicultura_tablas
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
//
// RF MULTIANUAL desde las tablas de SAMPLES_TRIMESTRAL:
//   1 = Pino (79)   2 = Eucalipto (80)   3 = Otras (muestras base)
//
// FLUJO EN 2 PASOS (el modo interactivo no tiene memoria para leer todas
// las tablas en cada corrida):
//   1) MODO 'ENTRENAMIENTO' -> tarea batch que arma y exporta UNA tabla
//      chica de entrenamiento (train + test, ya submuestreada):
//        SAMPLES_TRIMESTRAL/train_silvo_e{ecos}_{VERSION_ENT}
//      Lanzar la tarea en Tasks y esperar a que termine.
//   2) MODO 'PREVIO' -> lee esa tabla, entrena y clasifica en vivo + métricas
//      MODO 'FINAL'  -> igual, con más árboles; exporta el mapa a
//        CLASSIFICATIONS/PRELIMINAR/SILVICULTURA/silvo_e{eco}_{año}_{versión}
//
// Al armar la tabla se reconstruye:
//   - yr y eco desde el nombre: sample_{silvo|base}_e{eco}_{año}_v{n}
//   - solo años ADULTOS (silvi): desde <= yr < hasta, o yr == hasta con
//     hasta_trim Q4 / vacío (ciclos 1 y 2). Post-cosecha y resto quedan fuera.
//   - split train/test por polígono (silvi) y por segmento (base)
//   - índices NDVI/NDMI/NBR/EVI2 por trimestre (misma fórmula que la imagen)
// =====================================================================

// ========================= PARAMETROS ================================
var MODO = 'ENTRENAMIENTO';          // 'ENTRENAMIENTO' | 'PREVIO' | 'FINAL'

var ECOS_ENTRENAMIENTO = [7];        // ecorregiones cuyas tablas se usan
var VERSION_ENT = 'v1';              // versión de la tabla de entrenamiento

var ECO_MAPA = 7;                    // ecorregión a clasificar
var AÑO_MAPA = 2017;
var VERSION_MAPA = 'v1';

var AÑO_MIN = 1996;                  // rango de años de tablas a usar
var AÑO_MAX = 2026;

var PUNTOS_PINO = 2000;              // puntos de TRAIN por clase (test ≈ 43 % extra)
var PUNTOS_EUCA = 2000;
var PUNTOS_OTRAS = 4000;             // Otras es heterogénea: el doble
var FRACCION_TEST = 0.3;             // por polígono (silvi) / por segmento (base)
var FRACCION_LECTURA_SILVO = 0.2;    // recorte aleatorio al leer (baja si la tarea falla)
var FRACCION_LECTURA_BASE = 1.0;

var N_ARBOLES = 100;                 // FINAL
var PREVIO_ARBOLES = 40;             // PREVIO
var SEMILLA = 42;

var PROP_CLASE_BASE = 'class';
var PROP_SEG_BASE = 'seg_id';
var IDS_EXCLUIDOS_BASE = [79, 80, 9, 27];

// --- Rutas ---
var CARPETA_TABLAS = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_TRIMESTRAL';
var ASSET_TRIMESTRAL = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/mosaics-3-trimestral';
var ASSET_ECO_RASTER = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m';
var CARPETA_ECO_VECTOR = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES';
var CARPETA_SALIDA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';

var PREFIJO = 'q_';
var ESCALA = 30;
var ESCALA_REFLECTANCIA = 10000;

// ====================== PREDICTORAS ==================================
var Q = ['Q1_', 'Q2_', 'Q3_', 'Q4_'];
var ESPECTRALES = ['blue_median', 'green_median', 'red_median', 'nir_median', 'swir1_median', 'swir2_median'];
var INDICES = ['ndvi', 'ndmi', 'nbr', 'evi2'];
var ANUALES = ['ndmi_amp', 'ndmi_max', 'ndmi_min', 'ndvi_amp', 'ndvi_max',
               'q_ndmi_max', 'q_ndvi_max', 'hand', 'twi'];
// Fuera a propósito: Q*_nobs, valid_q, mndwi_max, wet_freq, dist_water, dist_coast

var BANDAS = [], BANDAS_TABLA = [];
Q.forEach(function(q) {
  ESPECTRALES.forEach(function(b) { BANDAS.push(PREFIJO + q + b); BANDAS_TABLA.push(PREFIJO + q + b); });
  INDICES.forEach(function(b) { BANDAS.push(PREFIJO + q + b); });
});
ANUALES.forEach(function(b) { BANDAS.push(PREFIJO + b); BANDAS_TABLA.push(PREFIJO + b); });

var TABLA_ENT = CARPETA_TABLAS + '/train_silvo_e' + ECOS_ENTRENAMIENTO.join('-') + '_' + VERSION_ENT;

// ====================== AUXILIARES ===================================
function tipo(v) { return ee.String(ee.Algorithms.ObjectType(v)); }

function aNumero(v) {
  return ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(v, null), -9999,
    ee.Algorithms.If(tipo(v).equals('String'),
      ee.Algorithms.If(ee.String(v).trim().length().gt(0), ee.Number.parse(v), -9999),
      v)));
}

function listarCarpeta(parent) {
  var out = [], token = null;
  do {
    var p = {pageSize: 1000};
    if (token) p.pageToken = token;
    var r = ee.data.listAssets(parent, p);
    ((r && r.assets) || []).forEach(function(a) { out.push(a); });
    token = (r && r.nextPageToken) || null;
  } while (token);
  return out;
}

function existe(id) {
  try { ee.data.getAsset(id); return true; } catch (e) { return false; }
}

// Pseudo-aleatorio determinístico en [0,1) desde un entero (split por id)
function azarDesdeId(n) {
  return ee.Number(n).abs().multiply(7919).add(SEMILLA).mod(1000).divide(1000);
}

// Índices por trimestre en una fila de tabla
function indicesTabla(f) {
  var props = {};
  Q.forEach(function(q) {
    var g = function(b) { return ee.Number(f.get(PREFIJO + q + b + '_median')); };
    var nd = function(a, b) { return a.subtract(b).divide(a.add(b)); };
    var nir = g('nir'), red = g('red');
    props[PREFIJO + q + 'ndvi'] = nd(nir, red);
    props[PREFIJO + q + 'ndmi'] = nd(nir, g('swir1'));
    props[PREFIJO + q + 'nbr'] = nd(nir, g('swir2'));
    var n = nir.divide(ESCALA_REFLECTANCIA), r = red.divide(ESCALA_REFLECTANCIA);
    props[PREFIJO + q + 'evi2'] = n.subtract(r).multiply(2.5).divide(n.add(r.multiply(2.4)).add(1));
  });
  return f.set(props);
}

// Stack de la imagen: MISMOS nombres y fórmulas que la tabla
function stackAño(y) {
  var m = ee.ImageCollection(ASSET_TRIMESTRAL).filter(ee.Filter.eq('year', y)).mosaic();
  var idx = ee.Image([]);
  Q.forEach(function(q) {
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

// =====================================================================
// PASO 1: ARMAR Y EXPORTAR LA TABLA DE ENTRENAMIENTO (batch)
// =====================================================================
if (MODO === 'ENTRENAMIENTO') {
  // --- tablas (última versión por tipo × eco × año) ---
  var re = /^sample_(silvo|base)_e(\d+)_(\d{4})_v(\d+)$/i;
  var mejores = {};
  listarCarpeta(CARPETA_TABLAS).forEach(function(a) {
    if (a.type !== 'TABLE') return;
    var id = a.id || a.name;
    var m = id.split('/').pop().match(re);
    if (!m) return;
    var t = {id: id, tipo: m[1].toLowerCase(), eco: +m[2], yr: +m[3], v: +m[4]};
    if (ECOS_ENTRENAMIENTO.indexOf(t.eco) < 0 || t.yr < AÑO_MIN || t.yr > AÑO_MAX) return;
    var k = t.tipo + '|' + t.eco + '|' + t.yr;
    if (!mejores[k] || t.v > mejores[k].v) mejores[k] = t;
  });
  var TABLAS = Object.keys(mejores).map(function(k) { return mejores[k]; });
  var T_SILVO = TABLAS.filter(function(t) { return t.tipo === 'silvo'; });
  var T_BASE = TABLAS.filter(function(t) { return t.tipo === 'base'; });
  print('Tablas silvo:', T_SILVO.length, '| tablas base:', T_BASE.length);
  print('Tablas base (eco_año):', T_BASE.map(function(t) { return 'e' + t.eco + '_' + t.yr; }).sort());
  if (!T_SILVO.length || !T_BASE.length) throw new Error('Faltan tablas silvo o base.');

  var cargar = function(lista) {
    return ee.FeatureCollection(lista.map(function(t) {
      return ee.FeatureCollection(t.id).map(function(f) { return f.set({yr: t.yr, eco: t.eco}); });
    })).flatten();
  };

  // --- silvicultura: solo años adultos ---
  var filtroAdulto = function(desde, hasta, trim) {
    return ee.Filter.and(
      ee.Filter.lessThanOrEquals({leftField: desde, rightField: 'yr'}),
      ee.Filter.or(
        ee.Filter.lessThan({leftField: 'yr', rightField: hasta}),
        ee.Filter.and(
          ee.Filter.equals({leftField: 'yr', rightField: hasta}),
          ee.Filter.inList(trim, ['Q4', '']))));
  };

  var idPoligono = function(f) {
    var out = ee.Number(-9999);
    ['dis_id', 'fid_gpkg', 'id', 'fid'].forEach(function(c) {
      out = ee.Number(ee.Algorithms.If(out.gt(-9999), out, aNumero(f.get(c))));
    });
    return out.add(ee.Number(f.get('eco')).multiply(1e7));
  };

  var silvo = cargar(T_SILVO)
    .filter(ee.Filter.inList('class', [79, 80]))
    .filter(ee.Filter.or(ee.Filter.notNull(['descartar']).not(), ee.Filter.neq('descartar', 1)))
    .filter(ee.Filter.or(
      filtroAdulto('a_adulta_desde', 'a_adulta_hasta', 'a_adulta_hasta_trim'),
      filtroAdulto('a_adulta2_desde', 'a_adulta2_hasta', 'a_adulta2_hasta_trim')))
    .randomColumn('r_lect', SEMILLA)
    .filter(ee.Filter.lt('r_lect', FRACCION_LECTURA_SILVO))
    .map(function(f) {
      return f.set({
        clase: ee.Algorithms.If(ee.Number(f.get('class')).eq(79), 1, 2),
        test: azarDesdeId(idPoligono(f)).lt(FRACCION_TEST)
      });
    });

  // --- base: Otras ---
  var base = cargar(T_BASE)
    .filter(ee.Filter.inList(PROP_CLASE_BASE, IDS_EXCLUIDOS_BASE).not())
    .randomColumn('r_lect', SEMILLA)
    .filter(ee.Filter.lt('r_lect', FRACCION_LECTURA_BASE))
    .map(function(f) {
      var seg = aNumero(f.get(PROP_SEG_BASE)).add(ee.Number(f.get('eco')).multiply(1e8));
      return f.set({clase: 3, test: azarDesdeId(seg).lt(FRACCION_TEST)});
    });

  // --- submuestreo por clase, índices y columnas mínimas ---
  var COLS = BANDAS.concat(['clase', 'test', 'yr', 'eco']);
  var tomar = function(fc, n, seed) {
    return fc.filter(ee.Filter.notNull(BANDAS_TABLA))
      .randomColumn('r_sel', seed).limit(n, 'r_sel')
      .map(indicesTabla)
      .select(COLS, null, false);
  };
  var kTest = FRACCION_TEST / (1 - FRACCION_TEST);
  var conjunto = function(esTest, k, seed) {
    var f = ee.Filter.eq('test', esTest ? 1 : 0);
    return tomar(silvo.filter(f).filter(ee.Filter.eq('clase', 1)), Math.round(PUNTOS_PINO * k), seed)
      .merge(tomar(silvo.filter(f).filter(ee.Filter.eq('clase', 2)), Math.round(PUNTOS_EUCA * k), seed))
      .merge(tomar(base.filter(f), Math.round(PUNTOS_OTRAS * k), seed));
  };
  var tabla = conjunto(false, 1, SEMILLA).merge(conjunto(true, kTest, SEMILLA + 1));

  var nombre = TABLA_ENT.split('/').pop();
  Export.table.toAsset({collection: tabla, description: nombre, assetId: TABLA_ENT});
  print('Tarea creada: ' + nombre + '. Lánzala en Tasks; al terminar, usa MODO PREVIO.');
}

// =====================================================================
// PASO 2: ENTRENAR DESDE LA TABLA Y CLASIFICAR
// =====================================================================
if (MODO === 'PREVIO' || MODO === 'FINAL') {
  if (!existe(TABLA_ENT)) {
    throw new Error('No existe ' + TABLA_ENT + '. Corre primero MODO = ENTRENAMIENTO y lanza la tarea.');
  }
  var ES_PREVIO = MODO === 'PREVIO';
  var datos = ee.FeatureCollection(TABLA_ENT);
  var train = datos.filter(ee.Filter.eq('test', 0));
  var test = datos.filter(ee.Filter.eq('test', 1));

  var rf = ee.Classifier.smileRandomForest({
    numberOfTrees: ES_PREVIO ? PREVIO_ARBOLES : N_ARBOLES,
    minLeafPopulation: 2,
    bagFraction: 0.5,
    seed: SEMILLA
  }).train({features: train, classProperty: 'clase', inputProperties: BANDAS});

  if (ES_PREVIO) {
    print('Puntos train por clase (1 Pino, 2 Euca, 3 Otras):', train.aggregate_histogram('clase'));
    print('Puntos train por año:', train.aggregate_histogram('yr'));
    var cm = test.classify(rf).errorMatrix('clase', 'classification', [1, 2, 3]);
    print('Puntos test por clase:', test.aggregate_histogram('clase'));
    print('Matriz de confusión (filas verdad, cols predicción):', cm);
    print('Overall accuracy:', cm.accuracy());
    print('User accuracy:', cm.consumersAccuracy());
    print('Producer accuracy:', cm.producersAccuracy());
    var imp = ee.Dictionary(ee.Dictionary(rf.explain()).get('importance'));
    var impFc = ee.FeatureCollection(imp.keys().map(function(k) {
      return ee.Feature(null, {banda: k, imp: imp.get(k)});
    })).sort('imp', false).limit(25);
    print(ui.Chart.feature.byFeature(impFc, 'banda', 'imp').setChartType('BarChart')
      .setOptions({title: 'Importancia — top 25', legend: {position: 'none'}}));
  }

  var maskMapa = ee.Image(ASSET_ECO_RASTER).select(0).eq(ECO_MAPA).selfMask();
  var regionMapa = ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + ECO_MAPA).geometry().bounds();
  var img = stackAño(AÑO_MAPA).updateMask(maskMapa);
  var clasif = img.classify(rf).toByte().rename('silvicultura');

  var vis = {min: 1, max: 3, palette: ['1B5E20', 'AEEA00', 'BDBDBD']};
  var visPlant = {min: 1, max: 2, palette: ['1B5E20', 'AEEA00']};
  var NOMBRE = 'silvo_e' + ECO_MAPA + '_' + AÑO_MAPA + '_' + VERSION_MAPA;

  Map.centerObject(regionMapa, 9);
  Map.addLayer(img, {bands: ['q_Q2_swir1_median', 'q_Q2_nir_median', 'q_Q2_red_median'],
    min: 70, max: 4000, gamma: 0.85}, 'RGB Q2 ' + AÑO_MAPA, false);

  if (ES_PREVIO) {
    Map.addLayer(clasif, vis, 'PREVIO e' + ECO_MAPA + ' ' + AÑO_MAPA + ' (1 Pino, 2 Euca, 3 Otras)');
    Map.addLayer(clasif.updateMask(clasif.lte(2)), visPlant, 'PREVIO Pino / Eucalipto', false);
  } else {
    Export.image.toAsset({
      image: clasif, description: NOMBRE, assetId: CARPETA_SALIDA + '/' + NOMBRE,
      region: regionMapa, scale: ESCALA, maxPixels: 1e13,
      pyramidingPolicy: {'.default': 'mode'}
    });
    if (existe(CARPETA_SALIDA + '/' + NOMBRE)) {
      var mapa = ee.Image(CARPETA_SALIDA + '/' + NOMBRE);
      Map.addLayer(mapa, vis, 'Clasificación e' + ECO_MAPA + ' ' + AÑO_MAPA);
      Map.addLayer(mapa.updateMask(mapa.lte(2)), visPlant, 'Pino / Eucalipto ' + AÑO_MAPA, false);
    } else {
      print('Lanza la tarea ' + NOMBRE + ' en Tasks y vuelve a correr para cargarla.');
    }
  }
}
