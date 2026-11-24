// =====================================================================
// SCRIPT: codigo_rf_silvicultura_trimestral
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
//
// QUÉ HACE
//   Random Forest sobre el mosaico TRIMESTRAL para separar:
//     1 = Pino (79)   2 = Eucalipto (80)   3 = Otras (SEGLAB v7)
//   - Muestras multi-año: cada una se cruza con el mosaico de SU año
//     (pino/eucalipto: 'Año_Adult'; SEGLAB: 'year').
//   - La ecorregión de cada muestra se asigna con el RASTER (centroide).
//   - Se entrena con ECOS_ENTRENAMIENTO y se mapea ECO_MAPA.
//   - Muestreo en 2 pasos por año (etiquetas -> mosaico) para ahorrar memoria.
//
// MODO
//   'PREVIO' = modelo liviano, clasificación en vivo en el visor.
//   'FINAL'  = modelo completo, exporta a asset y lo carga si ya existe.
// =====================================================================

// ========================= PARAMETROS ================================
var ECO_MAPA = 7;                    // ecorregión a clasificar
var ECOS_ENTRENAMIENTO = [7, 8];     // ecorregiones de donde salen las muestras
var AÑO_MAPA = 2024;
var AÑO_MIN = null;                  // filtros opcionales de año de muestras
var AÑO_MAX = null;
// Muestras con Año_Adult mayor al último mosaico disponible:
//   'DESCARTAR'      = se eliminan
//   'ULTIMO_MOSAICO' = se cruzan con el último año del mosaico
var AÑOS_FUTUROS = 'DESCARTAR';

var MODO = 'PREVIO';                 // 'PREVIO' | 'FINAL'
var VERSION = 'v1';

var PUNTOS_PLANTACION = 2500;        // TOTAL por clase (todos los años)
var PUNTOS_OTRAS = 5000;
var N_ARBOLES = 100;
var PREVIO_FRACCION = 0.3;           // fracción de puntos en PREVIO
var PREVIO_ARBOLES = 30;
var SEMILLA = 42;
var ESCALA = 30;
var TILE_SCALE = 4;

var IDS_EXCLUIDOS = [79, 80, 9, 27]; // clases SEGLAB que no entran a Otras
var EXCLUIR_SUFIJOS = ['_nobs'];
var EXCLUIR_BANDAS = ['valid_q', 'dist_water', 'dist_coast', 'wet_freq', 'mndwi_max'];
var ESCALA_REFLECTANCIA = 10000;

// --- Rutas ---
var BASE = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/';
var ASSET_ECO_RASTER = BASE + 'ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m';
var CARPETA_ECO_VECTOR = BASE + 'ANCILLARY_DATA/ECORREGIONES';          // E1 … E17
var CARPETA_SEGLAB = BASE + 'LABELS/SEGLAB/v7';                         // E01 … E17
var ASSET_PINO = BASE + 'SAMPLES/SAMPLES_COL3/SILVICULTURE/REVISIONES/C79_col3MB';
var ASSET_EUCA = BASE + 'SAMPLES/SAMPLES_COL3/SILVICULTURE/REVISIONES/c80_col3MB';
var CARPETA_SALIDA = BASE + 'SAMPLES/SAMPLES_COL3/SILVICULTURE/CLASSIFICATION';  // ⚠ debe existir
var ASSET_TRIMESTRAL = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/mosaics-3-trimestral';

var CLASES = [
  {id: 1, nombre: 'Pino',      color: '1B5E20', puntos: PUNTOS_PLANTACION},
  {id: 2, nombre: 'Eucalipto', color: 'AEEA00', puntos: PUNTOS_PLANTACION},
  {id: 3, nombre: 'Otras',     color: 'BDBDBD', puntos: PUNTOS_OTRAS}
];

// ====================== BASE =========================================
var ES_PREVIO = MODO === 'PREVIO';
var FRACCION = ES_PREVIO ? PREVIO_FRACCION : 1;
var ARBOLES = ES_PREVIO ? PREVIO_ARBOLES : N_ARBOLES;
var IDS = CLASES.map(function(c) { return c.id; });
var PALETA = CLASES.map(function(c) { return c.color; });
var PREF = ['Q1_', 'Q2_', 'Q3_', 'Q4_'];

function nombreEco(n, conCero) { return 'E' + (conCero && n < 10 ? '0' : '') + n; }

function aNumero(v) {
  return ee.Number(ee.Algorithms.If(
    ee.String(ee.Algorithms.ObjectType(v)).equals('String'), ee.Number.parse(v), v));
}

function assetExiste(id) {
  try { ee.data.getAsset(id); return true; } catch (e) { return false; }
}

// ====================== ECORREGIONES =================================
var ecoRaster = ee.Image(ASSET_ECO_RASTER).select(0).rename('eco');
var maskEnt = ecoRaster.remap(ECOS_ENTRENAMIENTO, ECOS_ENTRENAMIENTO).gt(0).selfMask();
var maskMapa = ecoRaster.eq(ECO_MAPA).selfMask();

function vectorEcos(lista) {
  return ee.FeatureCollection(lista.map(function(n) {
    return ee.FeatureCollection(CARPETA_ECO_VECTOR + '/' + nombreEco(n, false));
  })).flatten();
}
var regionEnt = vectorEcos(ECOS_ENTRENAMIENTO).geometry().bounds();
var regionMapa = vectorEcos([ECO_MAPA]).geometry().bounds();

// ====================== MOSAICO Y PREDICTORAS ========================
var colTrim = ee.ImageCollection(ASSET_TRIMESTRAL);
var añosMosaico = colTrim.aggregate_array('year')
  .map(function(v) { return aNumero(v).toInt(); }).distinct();
var ultimoAñoMosaico = ee.Number(añosMosaico.reduce(ee.Reducer.max()));

function indicesTrimestrales(m) {
  var out = ee.Image([]);
  PREF.forEach(function(p) {
    var nir = m.select(p + 'nir_median').divide(ESCALA_REFLECTANCIA);
    var red = m.select(p + 'red_median').divide(ESCALA_REFLECTANCIA);
    out = out
      .addBands(m.normalizedDifference([p + 'nir_median', p + 'red_median']).rename(p + 'ndvi'))
      .addBands(m.normalizedDifference([p + 'nir_median', p + 'swir1_median']).rename(p + 'ndmi'))
      .addBands(m.normalizedDifference([p + 'nir_median', p + 'swir2_median']).rename(p + 'nbr'))
      .addBands(nir.subtract(red).multiply(2.5)
        .divide(nir.add(red.multiply(2.4)).add(1)).rename(p + 'evi2'));
  });
  return out.toFloat();
}

function filtrarPredictoras(img) {
  var f = ee.Filter.inList('item', EXCLUIR_BANDAS).not();
  EXCLUIR_SUFIJOS.forEach(function(s) {
    f = ee.Filter.and(f, ee.Filter.stringEndsWith('item', s).not());
  });
  return img.select(img.bandNames().filter(f));
}

function featuresAño(y, mask) {
  var m = colTrim.filter(ee.Filter.or(
    ee.Filter.eq('year', y), ee.Filter.eq('year', String(y)))).mosaic();
  return filtrarPredictoras(m.addBands(indicesTrimestrales(m))).updateMask(mask);
}

// ====================== MUESTRAS =====================================
function conAño(fc, prop) {
  return fc.filter(ee.Filter.notNull([prop])).map(function(f) {
    return f.set('yr', aNumero(f.get(prop)).toInt());
  });
}

// Ecorregión según el raster en el centroide de cada polígono
function asignarEco(fc) {
  return fc.map(function(f) {
    var e = ecoRaster.reduceRegion({
      reducer: ee.Reducer.first(),
      geometry: f.geometry().centroid(10),
      scale: ESCALA
    }).get('eco');
    return f.set('eco', e);
  });
}

// Plantaciones: todo Chile -> rectángulo de entrenamiento -> eco por raster
var plantaciones = conAño(ee.FeatureCollection(ASSET_PINO).filterBounds(regionEnt), 'Año_Adult')
    .map(function(f) { return f.set('class', 1); })
  .merge(conAño(ee.FeatureCollection(ASSET_EUCA).filterBounds(regionEnt), 'Año_Adult')
    .map(function(f) { return f.set('class', 2); }));
plantaciones = asignarEco(plantaciones)
  .filter(ee.Filter.inList('eco', ECOS_ENTRENAMIENTO));

// Fondo: un archivo SEGLAB por ecorregión
var partesFondo = [];
ECOS_ENTRENAMIENTO.forEach(function(n) {
  var id = CARPETA_SEGLAB + '/' + nombreEco(n, true);
  if (!assetExiste(id)) { print('⚠ SEGLAB no encontrado:', id); return; }
  partesFondo.push(conAño(ee.FeatureCollection(id), 'year').map(function(f) {
    return f.set({eco: n, mb_id: aNumero(f.get('class')).toInt(), class: 3});
  }));
});
var fondo = ee.FeatureCollection(partesFondo).flatten()
  .filter(ee.Filter.inList('mb_id', IDS_EXCLUIDOS).not());

// Años
var muestras = plantaciones.merge(fondo);
if (AÑOS_FUTUROS === 'ULTIMO_MOSAICO') {
  muestras = muestras.map(function(f) {
    return f.set('yr', ee.Number(f.get('yr')).min(ultimoAñoMosaico));
  });
}
muestras = muestras.filter(ee.Filter.inList('yr', añosMosaico));
if (AÑO_MIN !== null) muestras = muestras.filter(ee.Filter.gte('yr', AÑO_MIN));
if (AÑO_MAX !== null) muestras = muestras.filter(ee.Filter.lte('yr', AÑO_MAX));

// ====================== RESUMEN Y VALIDACIÓN =========================
print('MODO:', MODO, '| árboles:', ARBOLES, '| fracción puntos:', FRACCION);
print('Entrenamiento con ecorregiones:', ECOS_ENTRENAMIENTO, '| mapa:', nombreEco(ECO_MAPA, false));
print('Pino — polígonos por ecorregión:', muestras.filter(ee.Filter.eq('class', 1)).aggregate_histogram('eco'));
print('Eucalipto — polígonos por ecorregión:', muestras.filter(ee.Filter.eq('class', 2)).aggregate_histogram('eco'));
print('Otras — polígonos por ecorregión:', muestras.filter(ee.Filter.eq('class', 3)).aggregate_histogram('eco'));
print('Pino — años:', muestras.filter(ee.Filter.eq('class', 1)).aggregate_histogram('yr'));
print('Eucalipto — años:', muestras.filter(ee.Filter.eq('class', 2)).aggregate_histogram('yr'));
print('Otras — años:', muestras.filter(ee.Filter.eq('class', 3)).aggregate_histogram('yr'));

// Dos getInfo chicos: conteo por clase y lista de años
var conteo = muestras.aggregate_histogram('class').getInfo();
var faltan = CLASES.filter(function(c) { return !conteo[String(c.id)]; })
  .map(function(c) { return c.nombre; });
if (faltan.length) {
  throw new Error('Sin muestras de: ' + faltan.join(', ') + ' en ecorregiones ' +
    ECOS_ENTRENAMIENTO.join(', ') + '. Agrega ecorregiones a ECOS_ENTRENAMIENTO ' +
    'o revisa AÑOS_FUTUROS / AÑO_MIN / AÑO_MAX.');
}
var AÑOS = muestras.aggregate_array('yr').distinct().sort().getInfo();
print('Años con muestras:', AÑOS);

var CUOTAS = CLASES.map(function(c) {
  return Math.ceil(c.puntos * FRACCION / AÑOS.length);
});

// ====================== MUESTREO EN 2 PASOS ==========================
function puntosAño(y) {
  var polys = muestras.filter(ee.Filter.eq('yr', y));

  // a) Ubicar puntos en la imagen de etiquetas (1 banda, liviana)
  var pts = ee.Image().byte()
    .paint({featureCollection: polys, color: 'class'})
    .rename('class')
    .updateMask(maskEnt)
    .stratifiedSample({
      numPoints: 0,
      classBand: 'class',
      classValues: IDS,
      classPoints: CUOTAS,
      region: regionEnt,
      scale: ESCALA,
      seed: SEMILLA + y,
      dropNulls: true,
      geometries: true,
      tileScale: TILE_SCALE
    });

  // b) Extraer el mosaico de ESE año solo en esos puntos
  return featuresAño(y, maskEnt).sampleRegions({
    collection: pts,
    properties: ['class'],
    scale: ESCALA,
    tileScale: TILE_SCALE,
    geometries: false
  });
}

var entrenamiento = ee.FeatureCollection(AÑOS.map(puntosAño)).flatten();
if (ES_PREVIO) print('Puntos de entrenamiento por clase:', entrenamiento.aggregate_histogram('class'));

// ====================== RANDOM FOREST ================================
var featuresMapa = featuresAño(AÑO_MAPA, maskMapa);
var bandas = featuresMapa.bandNames();

var rf = ee.Classifier.smileRandomForest({
  numberOfTrees: ARBOLES,
  minLeafPopulation: 2,
  bagFraction: 0.5,
  seed: SEMILLA
}).train({
  features: entrenamiento,
  classProperty: 'class',
  inputProperties: bandas
});

var clasif = featuresMapa.classify(rf).toByte().rename('silvicultura');

// ====================== SALIDAS ======================================
var ECO_TXT = nombreEco(ECO_MAPA, false);
var NOMBRE = 'rf_silv_' + ECO_TXT + '_' + AÑO_MAPA + '_' + VERSION;
var ASSET_MAPA = CARPETA_SALIDA + '/' + NOMBRE;
var vis = {min: 1, max: 3, palette: PALETA};
var visPlant = {min: 1, max: 2, palette: ['1B5E20', 'AEEA00']};

Map.centerObject(regionMapa, 9);
Map.addLayer(featuresMapa, {
  bands: ['Q2_swir1_median', 'Q2_nir_median', 'Q2_red_median'],
  min: 70, max: 4000, gamma: 0.85
}, 'RGB Q2 ' + AÑO_MAPA, false);

if (ES_PREVIO) {
  Map.addLayer(clasif, vis, 'PREVIO ' + ECO_TXT + ' ' + AÑO_MAPA + ' (1 Pino, 2 Euca, 3 Otras)');
  Map.addLayer(clasif.updateMask(clasif.lte(2)), visPlant, 'PREVIO Pino / Eucalipto', false);
} else {
  Export.image.toAsset({
    image: clasif,
    description: NOMBRE,
    assetId: ASSET_MAPA,
    region: regionMapa,
    scale: ESCALA,
    maxPixels: 1e13,
    pyramidingPolicy: {'.default': 'mode'}
  });
  if (assetExiste(ASSET_MAPA)) {
    var mapa = ee.Image(ASSET_MAPA);
    Map.addLayer(mapa, vis, 'Clasificación ' + ECO_TXT + ' ' + AÑO_MAPA);
    Map.addLayer(mapa.updateMask(mapa.lte(2)), visPlant, 'Pino / Eucalipto ' + AÑO_MAPA, false);
  } else {
    print('Lanza la tarea ' + NOMBRE + ' en Tasks y vuelve a correr para cargarla.');
  }
}

Map.addLayer(muestras.filter(ee.Filter.eq('class', 1)), {color: '00E676'}, 'Muestras Pino', false);
Map.addLayer(muestras.filter(ee.Filter.eq('class', 2)), {color: 'FFEA00'}, 'Muestras Eucalipto', false);
Map.addLayer(maskMapa, {palette: ['FFFF00'], opacity: 0.25}, 'Ecorregión ' + ECO_TXT, false);
