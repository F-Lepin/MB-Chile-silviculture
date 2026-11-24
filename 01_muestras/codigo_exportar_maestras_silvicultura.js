// ==========================================================================================
// SCRIPT: exportar_maestras_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// Crea las tareas de exportación de las tablas de entrenamiento, por ecorregión (E7–E11):
//   MODEL_SAMPLES/train_master_e{eco}_v5   pino, eucalipto y otras (sin agro)   [= 'v1' en el visor]
//   MODEL_SAMPLES/train_master_e{eco}_v6   lo mismo + muestras de agro           [= 'v2' en el visor]
//   MODEL_SAMPLES/train_cosecha_e{eco}_v3  clase 4 'cosechado'
// (nombres con TRIM_REQUERIDOS = Q1 y Q4: los puntos pueden faltar en Q2 o Q3, que se rellenan con -9999)
// Cada tabla trae, por periodo (1996–2012 y 2013–2026), hasta CAP puntos con todos los
// predictores + clase, yr, eco, azar_poly (train/test) y azar_pt (selección de puntos).
// En la v2 la columna fondo marca el origen de la clase 3: 1 = base, 2 = agro.
//
// Uso: presiona Run y lanza las tareas en la pestaña Tasks. Las tablas que ya existen se omiten.
// La v2 necesita la v1 ya terminada: si la v1 se acaba de lanzar, vuelve a correr este script
// cuando termine para crear la v2. En el visor (codigo_rf_silvicultura_ui) eliges v1 o v2.
// ==========================================================================================

var ECOS = [7, 8, 9, 10, 11];   // ecorregiones a exportar (silvicultura existe solo en E7–E11)
var CAP = 4000;                 // máx. puntos por (periodo × clase)
var LECT_SILVO = 0.1;           // recorte aleatorio inicial de las tablas de silvicultura (0–1)
var LECT_BASE = 0.5;            // ídem para las tablas base (0–1)
var LECT_AGRO = 0.3;            // ídem para las tablas agro (0–1)
var EXPORTAR_V1 = true;         // sin agro
var EXPORTAR_V2 = true;         // con agro
var EXPORTAR_COSECHA = true;    // clase 4: rodales completamente cosechados
var LECT_COSECHA = 0.5;         // recorte aleatorio inicial de las tablas silvo para cosechado (0–1)
var DIF_MIN = 1;                // años después de anio_cosecha que se consideran 'cosechado' (mín.)
var DIF_MAX = 1;                // ídem (máx.). Con las tablas actuales solo existen filas con dif = 1

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

// Trimestres que un punto (tabla) o un píxel (mapa) DEBE tener. Los demás pueden faltar (nubes, nieve): sus bandas e
// índices se rellenan con SIN_DATO, tanto en las tablas como en la imagen, y el RF aprende a trabajar con ese valor.
// Si falta un trimestre requerido, el punto no entra al entrenamiento y el píxel queda sin clasificar.
// Con los cuatro trimestres ['Q1_','Q2_','Q3_','Q4_'] se vuelve al comportamiento anterior (tablas v1–v4).
var TRIM_REQUERIDOS = ['Q1_', 'Q4_'];   // Q1 ene–mar y Q4 oct–dic (verano austral); Q2 y Q3 pueden faltar
var SIN_DATO = -9999;
var UMBRAL_NODATA = -5000;   // reflectancia <= este valor = nodata del mosaico (se trata igual que enmascarado)
var TRIM_OPCIONALES = Q.filter(function (q) { return TRIM_REQUERIDOS.indexOf(q) < 0; });
var BANDAS_REQUERIDAS = [];
TRIM_REQUERIDOS.forEach(function (q) {
  ESPECTRALES.forEach(function (b) { BANDAS_REQUERIDAS.push(PREFIJO + q + b); });
});
ANUALES.forEach(function (b) { BANDAS_REQUERIDAS.push(PREFIJO + b); });


// Auxiliares
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

// Filas válidas: tienen los trimestres requeridos (con dato real) y los predictores anuales
function filtroFilasValidas() {
  var fs = [ee.Filter.notNull(BANDAS_REQUERIDAS)];
  TRIM_REQUERIDOS.forEach(function (q) {
    ESPECTRALES.forEach(function (b) { fs.push(ee.Filter.gt(PREFIJO + q + b, UMBRAL_NODATA)); });
  });
  return ee.Filter.and.apply(null, fs);
}

// Trimestre opcional sin dato (alguna banda nula o nodata) → sus 6 bandas pasan a SIN_DATO
function rellenarOpcionales(f) {
  var props = {};
  TRIM_OPCIONALES.forEach(function (q) {
    var malo = ee.Number(0);
    ESPECTRALES.forEach(function (b) {
      var v = f.get(PREFIJO + q + b);
      malo = malo.max(ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), 1,
        ee.Algorithms.If(ee.Number(v).lte(UMBRAL_NODATA), 1, 0))));
    });
    ESPECTRALES.forEach(function (b) {
      var k = PREFIJO + q + b;
      props[k] = ee.Algorithms.If(malo.eq(1), SIN_DATO, f.get(k));
    });
  });
  return f.set(props);
}

function indicesTabla(f) {
  var props = {};
  Q.forEach(function (q) {
    var g = function (b) { return ee.Number(f.get(PREFIJO + q + b + '_median')); };
    var nd = function (a, b) { return a.subtract(b).divide(a.add(b)); };
    var nir = g('nir'), red = g('red');
    var sinDato = nir.eq(SIN_DATO);   // solo puede ocurrir en trimestres opcionales ya rellenados
    var cond = function (v) { return ee.Algorithms.If(sinDato, SIN_DATO, v); };
    props[PREFIJO + q + 'ndvi'] = cond(nd(nir, red));
    props[PREFIJO + q + 'ndmi'] = cond(nd(nir, g('swir1')));
    props[PREFIJO + q + 'nbr'] = cond(nd(nir, g('swir2')));
    var n = nir.divide(ESCALA_REFLECTANCIA), r = red.divide(ESCALA_REFLECTANCIA);
    props[PREFIJO + q + 'evi2'] = cond(n.subtract(r).multiply(2.5).divide(n.add(r.multiply(2.4)).add(1)));
  });
  return f.set(props);
}

// Relleno de opcionales + índices (se aplica a cada fila ya filtrada)
function completarFila(f) { return indicesTabla(rellenarOpcionales(f)); }

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
// Tablas de entrenamiento
// ------------------------------------------------------------------------------------------
var PERIODOS_MAESTRA = [[1996, 2012], [2013, 2026]];

// Versiones por ecorregión: la v1/v2 'lógica' del visor se guarda con otro número para no borrar las tablas antiguas
// (v5/v6 y cosecha v3 cuando se permiten trimestres faltantes; en modo antiguo, E8 = v3/v4 y cosecha v2).
var VERSION_ECO = {}, VERSION_COSECHA_ECO = {};
if (TRIM_REQUERIDOS.length < Q.length) {
  // Tablas rehechas permitiendo trimestres faltantes (solo se exigen TRIM_REQUERIDOS): v5 sin agro, v6 con agro, cosecha v3
  [7, 8, 9, 10, 11].forEach(function (e) { VERSION_ECO[e] = {v1: 'v5', v2: 'v6'}; VERSION_COSECHA_ECO[e] = 'v3'; });
} else {
  VERSION_ECO = {8: {v1: 'v3', v2: 'v4'}};
  VERSION_COSECHA_ECO = {8: 'v2'};
}
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
      return fc.filter(filtroFilasValidas())
        .randomColumn('r_sel', semilla).limit(cfg.cap, 'r_sel')
        .map(completarFila);
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
    partes.push(agro.filter(filtroFilasValidas())
      .randomColumn('r_sel', SEMILLA + i).limit(cfg.cap, 'r_sel').map(completarFila));
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
    partes.push(cos.filter(filtroFilasValidas())
      .randomColumn('r_sel', SEMILLA + i).limit(cfg.cap, 'r_sel').map(completarFila));
  });
  if (!partes.length) throw new Error('No hay tablas silvo para E' + eco + '.');
  return partes.reduce(function (a, b) { return a.merge(b); })
    .select(COLS)
    .randomColumn('azar_pt', SEMILLA + 299);
}


// ------------------------------------------------------------------------------------------
// Ejecución: una tarea por ecorregión y versión
// ------------------------------------------------------------------------------------------
try { ee.data.createAsset({type: 'FOLDER'}, CARPETA_MAESTRA); } catch (e) { /* ya existe */ }

// Avisa si a una tabla de origen le faltan columnas de predictores
function chequearColumnas(t, etiqueta) {
  ee.FeatureCollection(t.id).first().propertyNames().evaluate(function (nombres) {
    var faltan = BANDAS_TABLA.filter(function (b) { return (nombres || []).indexOf(b) < 0; });
    print(etiqueta + ' (' + t.id.split('/').pop() + '): ' +
      (faltan.length ? 'FALTAN columnas: ' + faltan.join(', ') : 'columnas OK'));
  });
}

var cfg = {cap: CAP, lectSilvo: LECT_SILVO, lectBase: LECT_BASE, lectAgro: LECT_AGRO,
           lectCosecha: LECT_COSECHA, difMin: DIF_MIN, difMax: DIF_MAX};

ECOS.forEach(function (eco) {
  var nS = tablasDe('silvo', [eco], 1996, 2026);
  var nB = tablasDe('base', [eco], 1996, 2026);
  var nA = tablasDe('agro', [eco], 1996, 2026);
  var v1Existe = existe(idMaestra(eco, VER_SIN_AGRO));

  if (EXPORTAR_V1) {
    if (v1Existe) print('E' + eco + ': ya existe ' + nombreMaestra(eco, VER_SIN_AGRO) + ' (omitida)');
    else if (!nS.length || !nB.length) print('E' + eco + ': sin tablas de origen silvo/base, omitida');
    else {
      var t1 = maestraDeEco(eco, cfg)
        .set({eco: eco, version: VER_SIN_AGRO, cap: CAP, lect_silvo: LECT_SILVO, lect_base: LECT_BASE});
      Export.table.toAsset({collection: t1, description: nombreMaestra(eco, VER_SIN_AGRO),
        assetId: idMaestra(eco, VER_SIN_AGRO)});
      print('E' + eco + ': tarea creada ' + nombreMaestra(eco, VER_SIN_AGRO) +
        ' (' + nS.length + ' silvo / ' + nB.length + ' base)');
    }
  }

  if (EXPORTAR_V2) {
    if (existe(idMaestra(eco, VER_CON_AGRO))) print('E' + eco + ': ya existe ' + nombreMaestra(eco, VER_CON_AGRO) + ' (omitida)');
    else if (!nA.length) print('E' + eco + ': sin tablas agro de origen, v2 omitida');
    else if (!v1Existe) print('E' + eco + ': la v2 necesita la v1 terminada; vuelve a correr el script cuando termine');
    else {
      chequearColumnas(nA[0], 'E' + eco + ' agro');
      var t2 = maestraConAgro(eco, cfg)
        .set({eco: eco, version: VER_CON_AGRO, cap: CAP, lect_agro: LECT_AGRO});
      Export.table.toAsset({collection: t2, description: nombreMaestra(eco, VER_CON_AGRO),
        assetId: idMaestra(eco, VER_CON_AGRO)});
      print('E' + eco + ': tarea creada ' + nombreMaestra(eco, VER_CON_AGRO) + ' (' + nA.length + ' tablas agro)');
    }
  }

  if (EXPORTAR_COSECHA) {
    if (existe(idCosecha(eco))) print('E' + eco + ': ya existe ' + nombreCosecha(eco) + ' (omitida)');
    else if (!nS.length) print('E' + eco + ': sin tablas silvo de origen, cosechado omitida');
    else {
      var t4 = cosechaDeEco(eco, cfg)
        .set({eco: eco, cap: CAP, lect_cosecha: LECT_COSECHA, dif_min: DIF_MIN, dif_max: DIF_MAX});
      Export.table.toAsset({collection: t4, description: nombreCosecha(eco), assetId: idCosecha(eco)});
      print('E' + eco + ': tarea creada ' + nombreCosecha(eco) + ' (' + nS.length + ' tablas silvo)');
    }
  }
});
print('Listo. Lanza las tareas en la pestaña Tasks.');
