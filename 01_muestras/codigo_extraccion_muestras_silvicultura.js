// =====================================================================
// SCRIPT: codigo_extraccion_muestras_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
//
// QUÉ HACE
//   Exporta la información espectral de las muestras REVISADAS de
//   plantación (pino 79 / eucalipto 80) como tablas (asset).
//
//   1. Bases: en REVISIONES toma la ÚLTIMA versión de cada
//      clase × fuente × ecorregión con nombre c{clase}_{fuente}_e{eco}_v{n}
//      (col3MB, CONAF). Los archivos nacionales sin _e/_v se ignoran.
//      Cada base se exporta POR SEPARADO con su mismo nombre:
//        REVISIONES/c79_CONAF_e9_v1 -> MODEL_SAMPLES/c79_CONAF_e9_v1
//
//   2. Expansión temporal: cada polígono se repite en cada año válido:
//        estado 1 = ADULTA       años de a_adulta y a_adulta2; el año
//                                 *_hasta se omite si *_hasta_trim no es Q4
//                                 (año parcial: empieza la cosecha)
//        estado 2 = POST-COSECHA  año siguiente a anio_cosecha / anio_cosecha2
//                                 (si no es adulto en otro ciclo)
//      Quedan FUERA: años entre fin de fase adulta y cosecha, años jóvenes
//      e intermedios. Se omiten polígonos con descartar = 1.
//
//   3. Para cada polígono-año se extraen TODOS los píxeles (centro dentro
//      del polígono) del mosaico trimestral + índices + fenología CIM de
//      ESE año, enmascarados a la ecorregión con el raster.
//
// CADA PUNTO TRAE
//   bandas (Q*_…, índices, fen_*, Q*_nobs, valid_q) + mb_id, estado, ciclo,
//   yr, id_poly, eco, fuente_asset, version_ext + PROPS_COPIAR + geometría.
//
// MODO
//   'PRUEBA'   = bases seleccionadas, registros por estado/año, píxeles aprox.
//   'EXPORTAR' = una tarea por base
// =====================================================================

// ========================= PARAMETROS ================================
var MODO = 'PRUEBA';                 // 'PRUEBA' | 'EXPORTAR'
var ECOS = [7, 8, 9, 10, 11];        // ecorregiones a exportar (1–17)
var ECO_PRUEBA = 9;
var AÑO_PRUEBA = 2020;
var VERSION = 'v1';                  // versión de la EXTRACCIÓN (propiedad version_ext)

var INCLUIR_POST_COSECHA = true;     // estado 2
var AÑO_MIN = null;                  // filtros opcionales de año
var AÑO_MAX = null;

var CLASES_PLANT = [79, 80];
var FUENTES_PLANT = ['col3MB', 'CONAF'];
var PROP_DESCARTAR = 'descartar';

// Atributos del polígono que se copian a cada punto (comunes a col3MB y CONAF)
var PROPS_COPIAR = [
  'tipo_muestra', 'origen',
  'a_adulta_desde', 'a_adulta_hasta', 'a_adulta_hasta_trim',
  'anio_cosecha', 'trimestre_cosecha',
  'a_adulta2_desde', 'a_adulta2_hasta', 'a_adulta2_hasta_trim',
  'anio_cosecha2', 'trimestre_cosecha2'
];

var ESCALA = 30;
var TILE_SCALE = 8;
var ESCALA_REFLECTANCIA = 10000;
var PREFIJO_FENOLOGIA = 'fen_';

// --- Rutas ---
var BASE = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/';
var ASSET_ECO_RASTER = BASE + 'ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m';
var CARPETA_ECO_VECTOR = BASE + 'ANCILLARY_DATA/ECORREGIONES';           // E1 … E17
var CARPETA_REV = BASE + 'SAMPLES/SAMPLES_COL3/SILVICULTURE/REVISIONES';
var CARPETA_SALIDA = BASE + 'SAMPLES/SAMPLES_COL3/SILVICULTURE/MODEL_SAMPLES';  // ⚠ debe existir
var ASSET_TRIMESTRAL = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/mosaics-3-trimestral';
var ASSET_FENOLOGIA = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/fenologia_cim';

// ====================== AUXILIARES ===================================
var PREF = ['Q1_', 'Q2_', 'Q3_', 'Q4_'];

function nombreEco(n) { return 'E' + n; }

function tipo(v) { return ee.String(ee.Algorithms.ObjectType(v)); }

// Número desde número, texto o null (null / '' -> -9999)
function aNumero(v) {
  return ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(v, null), -9999,
    ee.Algorithms.If(tipo(v).equals('String'),
      ee.Algorithms.If(ee.String(v).trim().length().gt(0), ee.Number.parse(v), -9999),
      v)));
}

// Texto desde texto, número o null
function aTexto(v) {
  return ee.String(ee.Algorithms.If(
    ee.Algorithms.IsEqual(v, null), '',
    ee.Algorithms.If(tipo(v).equals('String'), v, ee.Number(v).format('%d'))));
}

// "1999,2000,2001" -> [1999, 2000, 2001]   ('' -> [])
function aListaAños(v) {
  var s = aTexto(v).trim();
  return ee.List(ee.Algorithms.If(s.length().gt(0),
    s.split(',').map(function(x) { return ee.Number.parse(ee.String(x).trim()).toInt(); }),
    []));
}

function assetInfo(id) {
  try { return ee.data.getAsset(id); } catch (e) { return null; }
}

function listarCarpeta(parent) {
  var out = [];
  var token = null;
  do {
    var p = {pageSize: 1000};
    if (token) p.pageToken = token;
    var r = ee.data.listAssets(parent, p);
    ((r && r.assets) || []).forEach(function(a) { out.push(a); });
    token = (r && r.nextPageToken) || null;
  } while (token);
  return out;
}

// ====================== BASES (última versión) =======================
// Solo nombres c{clase}_{fuente}_e{eco}_v{n}; los nacionales se ignoran.
function seleccionarBases() {
  var re = /^c(\d+)_([A-Za-z0-9]+)_e(\d+)_v(\d+)$/i;
  var mejores = {};
  var ignorados = [];
  listarCarpeta(CARPETA_REV).forEach(function(a) {
    if (a.type !== 'TABLE') return;
    var id = a.id || a.name;
    var nombre = id.split('/').pop();
    var m = nombre.match(re);
    var fuente = m && FUENTES_PLANT.filter(function(f) {
      return f.toLowerCase() === m[2].toLowerCase();
    })[0];
    if (!m || !fuente || CLASES_PLANT.indexOf(parseInt(m[1], 10)) < 0) {
      ignorados.push(nombre);
      return;
    }
    var b = {id: id, nombre: nombre, clase: parseInt(m[1], 10), fuente: fuente,
             eco: parseInt(m[3], 10), version: parseInt(m[4], 10)};
    var clave = b.clase + '|' + b.fuente + '|' + b.eco;
    if (!mejores[clave] || b.version > mejores[clave].version) mejores[clave] = b;
  });
  print('REVISIONES — ignorados (nacionales / otro formato):', ignorados);
  return Object.keys(mejores).sort().map(function(k) { return mejores[k]; });
}

var BASES = seleccionarBases();
print('REVISIONES — última versión por clase × fuente × eco:',
  BASES.map(function(b) { return b.nombre; }));

function basesDeEco(n) {
  return BASES.filter(function(b) { return b.eco === n; });
}

// ====================== MOSAICO + FENOLOGÍA ==========================
var colTrim = ee.ImageCollection(ASSET_TRIMESTRAL);
var añosMosaico = colTrim.aggregate_array('year')
  .map(function(v) { return aNumero(v).toInt(); }).distinct();

var infoFen = assetInfo(ASSET_FENOLOGIA);
if (!infoFen) throw new Error('No existe ' + ASSET_FENOLOGIA);
var FEN_ES_COLECCION = String(infoFen.type).toUpperCase().indexOf('COLLECTION') >= 0;
print('Fenología CIM — tipo de asset:', infoFen.type);

function fenologiaAño(y) {
  var img;
  if (FEN_ES_COLECCION) {
    var col = ee.ImageCollection(ASSET_FENOLOGIA);
    var delAño = col.filter(ee.Filter.or(
      ee.Filter.eq('year', y), ee.Filter.eq('year', ee.Number(y).format('%d'))));
    img = ee.Image(ee.Algorithms.If(delAño.size().gt(0), delAño.mosaic(), col.mosaic()));
  } else {
    img = ee.Image(ASSET_FENOLOGIA);
  }
  return img.regexpRename('^(.*)$', PREFIJO_FENOLOGIA + '$1').toFloat();
}

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

// MISMA función debe usarse en el script de clasificación
function featuresAño(y) {
  var m = colTrim.filter(ee.Filter.eq('year', y)).mosaic();
  return m.addBands(indicesTrimestrales(m)).addBands(fenologiaAño(y)).toFloat();
}

// ====================== EXPANSIÓN TEMPORAL ===========================
// Años adultos completos de un ciclo: lista sin el año 'hasta' si es parcial
function añosAdultos(f, campoLista, campoHasta, campoTrim) {
  var lista = aListaAños(f.get(campoLista));
  var hasta = aNumero(f.get(campoHasta)).toInt();
  var trim = aTexto(f.get(campoTrim)).trim();
  var parcial = trim.length().gt(0).and(trim.compareTo('Q4').neq(0));
  return ee.List(ee.Algorithms.If(parcial, lista.removeAll([hasta]), lista));
}

function añoPostCosecha(f, campoCosecha) {
  var c = aNumero(f.get(campoCosecha)).toInt();
  return ee.List(ee.Algorithms.If(c.gt(0), [c.add(1)], []));
}

function copias(f, años, estado, ciclo) {
  return años.map(function(y) {
    return f.set({yr: ee.Number(y).toInt(), estado: estado, ciclo: ciclo});
  });
}

function expandir(f) {
  var ad1 = añosAdultos(f, 'a_adulta', 'a_adulta_hasta', 'a_adulta_hasta_trim');
  var ad2 = añosAdultos(f, 'a_adulta2', 'a_adulta2_hasta', 'a_adulta2_hasta_trim');
  var adultos = ad1.cat(ad2);
  var lista = copias(f, ad1, 1, 1).cat(copias(f, ad2, 1, 2));
  if (INCLUIR_POST_COSECHA) {
    var post1 = añoPostCosecha(f, 'anio_cosecha').removeAll(adultos);
    var post2 = añoPostCosecha(f, 'anio_cosecha2').removeAll(adultos);
    lista = lista.cat(copias(f, post1, 2, 1)).cat(copias(f, post2, 2, 2));
  }
  return ee.FeatureCollection(lista);
}

// ====================== CARGA DE MUESTRAS ============================
var ecoRaster = ee.Image(ASSET_ECO_RASTER).select(0).rename('eco');

function regionEco(n) {
  return ee.FeatureCollection(CARPETA_ECO_VECTOR + '/' + nombreEco(n)).geometry().bounds();
}

function cargarBase(b, n) {
  var fc = ee.FeatureCollection(b.id)
    .filterBounds(regionEco(n))
    .filter(ee.Filter.or(
      ee.Filter.notNull([PROP_DESCARTAR]).not(),
      ee.Filter.neq(PROP_DESCARTAR, 1)))
    .map(function(f) { return f.set({mb_id: b.clase, id_poly: f.id()}); })
    .map(expandir).flatten()
    .filter(ee.Filter.inList('yr', añosMosaico));
  if (AÑO_MIN !== null) fc = fc.filter(ee.Filter.gte('yr', AÑO_MIN));
  if (AÑO_MAX !== null) fc = fc.filter(ee.Filter.lte('yr', AÑO_MAX));
  return fc;
}

// ====================== EXTRACCIÓN: TODOS LOS PÍXELES ================
var PROPS_SALIDA = ['mb_id', 'estado', 'ciclo', 'yr', 'id_poly'].concat(PROPS_COPIAR);

function extraer(fc, n, fuenteTxt) {
  var mask = ecoRaster.eq(n).selfMask();
  var años = fc.aggregate_array('yr').distinct();
  var porAño = años.map(function(y) {
    y = ee.Number(y).toInt();
    return featuresAño(y).updateMask(mask).sampleRegions({
      collection: fc.filter(ee.Filter.eq('yr', y)),
      properties: PROPS_SALIDA,
      scale: ESCALA,
      tileScale: TILE_SCALE,
      geometries: true
    }).map(function(f) {
      return f.set({eco: n, fuente_asset: fuenteTxt, version_ext: VERSION});
    });
  });
  return ee.FeatureCollection(porAño).flatten();
}

// Píxeles aproximados (área / 900 m²) de todos los polígono-año
function pixelesAprox(fc) {
  return ee.Number(fc.map(function(f) {
    return f.set('a', f.geometry().area(10));
  }).aggregate_sum('a')).divide(ESCALA * ESCALA).round();
}

// ====================== EJECUCIÓN ====================================
if (MODO === 'PRUEBA') {
  var n = ECO_PRUEBA;
  var mask = ecoRaster.eq(n).selfMask();
  var basesP = basesDeEco(n);
  print(nombreEco(n) + ' — bases a exportar:', basesP.map(function(b) { return b.nombre; }));
  print('Bandas a exportar (' + AÑO_PRUEBA + '):', featuresAño(AÑO_PRUEBA).bandNames());

  Map.centerObject(regionEco(n), 9);
  Map.addLayer(featuresAño(AÑO_PRUEBA).updateMask(mask),
    {bands: ['Q2_swir1_median', 'Q2_nir_median', 'Q2_red_median'], min: 70, max: 4000, gamma: 0.85},
    'RGB Q2 ' + AÑO_PRUEBA, false);
  Map.addLayer(mask, {palette: ['FFFF00'], opacity: 0.2}, 'Ecorregión ' + n, false);

  basesP.forEach(function(b) {
    var fc = cargarBase(b, n);
    print('----- ' + b.nombre + ' -----');
    print('Registros polígono-año por estado (1 adulta, 2 post-cosecha):', fc.aggregate_histogram('estado'));
    print('Registros por año — adulta:', fc.filter(ee.Filter.eq('estado', 1)).aggregate_histogram('yr'));
    print('Registros por año — post-cosecha:', fc.filter(ee.Filter.eq('estado', 2)).aggregate_histogram('yr'));
    print('Píxeles aprox. a exportar:', pixelesAprox(fc));
    print('Ejemplo de expansión (1 polígono):',
      fc.filter(ee.Filter.eq('id_poly', ee.Feature(fc.first()).get('id_poly')))
        .map(function(f) { return ee.Feature(null, f.toDictionary(['yr', 'estado', 'ciclo'])); }));

    var fcY = fc.filter(ee.Filter.eq('yr', AÑO_PRUEBA));
    Map.addLayer(fcY.filter(ee.Filter.eq('estado', 1)),
      {color: b.clase === 79 ? '00E676' : 'FFEA00'}, b.nombre + ' adulta ' + AÑO_PRUEBA, false);
    Map.addLayer(fcY.filter(ee.Filter.eq('estado', 2)),
      {color: 'FF1744'}, b.nombre + ' post-cosecha ' + AÑO_PRUEBA, false);
  });
}

if (MODO === 'EXPORTAR') {
  var nTareas = 0;
  ECOS.forEach(function(n) {
    basesDeEco(n).forEach(function(b) {
      Export.table.toAsset({
        collection: extraer(cargarBase(b, n), n, b.nombre),
        description: b.nombre,
        assetId: CARPETA_SALIDA + '/' + b.nombre
      });
      nTareas++;
    });
  });
  print('Tareas creadas: ' + nTareas + ' (pestaña Tasks → Run)');
}
