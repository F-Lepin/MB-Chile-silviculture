// ==========================================================================================
// SCRIPT PILOTO: piloto_guia_col2_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// OBJETIVO: explorar el clasificador "guiado por COL2" SIN pasar por el visor completo.
// Se entrena UNA vez (máscara de plantación + modelo de especie) para un año y una ecorregión, y luego se
// mueven dos umbrales y se ve al instante cómo cambia el mapa:
//   · P mínima DENTRO de las plantaciones COL2 (clase 9)   → COL2 respalda: umbral bajo
//   · P mínima FUERA de COL2                                → el modelo debe estar muy seguro: umbral alto
// Capas (panel Layers): COL2, modelo solo (P ≥ 0.5), guiado, agregado fuera de COL2, descartado dentro de COL2,
// probabilidad de plantación, y mapa final con especie. El botón de áreas cuantifica cada caso en la vista.
//
// Qué se entrena (resumen): RF máscara = plantación (pino+euca juntos) vs otras [+ agro si fondo v2];
// RF especie = pino vs eucalipto. Lee las tablas maestras ya exportadas (no exporta nada). El modelo se elige por
// el año: 1996–2012 (Landsat 5/7) o 2013–2026 (Landsat 8/9). No incluye el filtro de área.
// COSECHADO (siempre incluido): la máscara tiene 3 clases (plantación, otras, cosechado) y usa las tablas
// train_cosecha_e{eco}_{ver}. Cosechado se asigna SOLO DENTRO de COL2 (clase 9) y donde su probabilidad es la mayor de las 3;
// fuera de COL2 no se agrega cosechado por probabilidad. Los umbrales no intervienen en esa clase. La guía COL2 decide qué
// píxeles son plantación (pino/euca) entre los que no son cosechado; el resto es otras.
// Mapa final: 1 pino, 2 euca, 3 otras, 4 cosechado.
// ==========================================================================================

var CARPETA_MAESTRA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_COL3/SILVICULTURE/MODEL_SAMPLES';
var ASSET_TRIMESTRAL = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/mosaics-3-trimestral';
var ASSET_ECO_RASTER = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m';
var CARPETA_ECO_VECTOR = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES';
var COL2_ASSET = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-02/CLASSIFICATIONS/classification-final/clasificacion-final-3';
var COL2_PLANTACION = 9;

// Nombre físico de las tablas maestras (igual que en el clasificador): E8 está rehecha como v3/v4
var VERSION_ECO = {8: {v1: 'v3', v2: 'v4'}};
function idMaestra(eco, ver) {
  var o = VERSION_ECO[eco];
  return CARPETA_MAESTRA + '/train_master_e' + eco + '_' + ((o && o[ver]) || ver);
}

// Tablas de cosechado (clase 4): E8 rehecha como v2; el resto v1 (igual que en el clasificador)
var VERSION_COSECHA_ECO = {8: 'v2'};
function idCosecha(eco) {
  return CARPETA_MAESTRA + '/train_cosecha_e' + eco + '_' + (VERSION_COSECHA_ECO[eco] || 'v1');
}

var SEMILLA = 42;
var FRAC_TEST = 0.3;
var RADIO_ESPECIE = 3;          // suavizado de P(pino), px
var ESCALA_REFLECTANCIA = 10000;
var PREFIJO = 'q_';

Map.setOptions('HYBRID');

// ------------------------------------------------------------------------------------------
// Predictores (idénticos al clasificador)
// ------------------------------------------------------------------------------------------
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

// ------------------------------------------------------------------------------------------
// Auxiliares
// ------------------------------------------------------------------------------------------
function existe(id) { try { ee.data.getAsset(id); return true; } catch (e) { return false; } }

function parseEntero(txt, nombre, min) {
  var n = parseInt(String(txt).trim(), 10);
  if (isNaN(n) || n < min) throw new Error(nombre + ': valor inválido.');
  return n;
}
function parseListaEcos(txt) {
  var l = String(txt).split(/[,\s;]+/).filter(function (s) { return s; })
    .map(function (s) { return parseInt(s.replace(/\D/g, ''), 10); }).filter(function (n) { return !isNaN(n); });
  if (!l.length) throw new Error('Ecorregiones de entrenamiento: ingresa al menos una (ej. 8 o 7,8).');
  return l;
}

var COL2_BANDAS = null;
function col2Plantacion(y) {
  if (COL2_BANDAS === null) {
    try { COL2_BANDAS = ee.Image(COL2_ASSET).bandNames().getInfo() || []; } catch (e) { COL2_BANDAS = []; }
  }
  var años = COL2_BANDAS.map(function (b) { return parseInt(String(b).replace('classification_', ''), 10); })
    .filter(function (a) { return !isNaN(a); });
  if (!años.length) throw new Error('No se pudieron leer las bandas de COL2.');
  var cerca = años.reduce(function (a, b) { return Math.abs(b - y) < Math.abs(a - y) ? b : a; });
  return {img: ee.Image(COL2_ASSET).select('classification_' + cerca).eq(COL2_PLANTACION).unmask(0), año: cerca};
}

// ------------------------------------------------------------------------------------------
// Entrenamiento (liviano: filtra la tabla maestra)
// ------------------------------------------------------------------------------------------
function periodoDe(y) { return y <= 2012 ? [1996, 2012] : [2013, 2026]; }

function entrenar(cfg) {
  var p = periodoDe(cfg.año);
  var faltan = cfg.ecosEnt.filter(function (e) { return !existe(idMaestra(e, cfg.ver)); });
  if (faltan.length) throw new Error('Falta la tabla maestra de E' + faltan.join(', E') + ' (' + cfg.ver + ').');
  var datos = ee.FeatureCollection(cfg.ecosEnt.map(function (e) { return ee.FeatureCollection(idMaestra(e, cfg.ver)); }))
    .flatten().filter(ee.Filter.and(ee.Filter.gte('yr', p[0]), ee.Filter.lte('yr', p[1])));
  var conAgro = cfg.ver === 'v2';
  var faltanC = cfg.ecosEnt.filter(function (e) { return !existe(idCosecha(e)); });
  if (faltanC.length) {
    throw new Error('Falta la tabla de cosechado de E' + faltanC.join(', E') +
      '. Expórtala con codigo_exportar_cosechado_silvicultura.js (o en la pestaña Muestreo del clasificador).');
  }
  var datosCos = ee.FeatureCollection(cfg.ecosEnt.map(function (e) { return ee.FeatureCollection(idCosecha(e)); }))
    .flatten().filter(ee.Filter.and(ee.Filter.gte('yr', p[0]), ee.Filter.lte('yr', p[1])));
  var kTest = FRAC_TEST / (1 - FRAC_TEST);

  var tomar = function (clase, esTest, n, fondo) {
    var f = esTest ? ee.Filter.lt('azar_poly', FRAC_TEST) : ee.Filter.gte('azar_poly', FRAC_TEST);
    var fc = datos.filter(ee.Filter.eq('clase', clase)).filter(f);
    if (fondo !== undefined) fc = fc.filter(ee.Filter.eq('fondo', fondo));
    return fc.sort('azar_pt').limit(Math.max(1, Math.round(n * (esTest ? kTest : 1))));
  };
  var comoClase = function (fc, c) { return fc.map(function (f) { return f.set('clase', c); }); };
  var otras = function (esTest) {
    if (!conAgro) return tomar(3, esTest, cfg.otras);
    var o = tomar(3, esTest, cfg.otras, 1);
    return cfg.agro > 0 ? o.merge(tomar(3, esTest, cfg.agro, 2)) : o;
  };
  var cosechado = function (esTest) {
    var f = esTest ? ee.Filter.lt('azar_poly', FRAC_TEST) : ee.Filter.gte('azar_poly', FRAC_TEST);
    return datosCos.filter(f).sort('azar_pt').limit(Math.max(1, Math.round(cfg.cosecha * (esTest ? kTest : 1))))
      .map(function (x) { return x.set('clase', 4); });
  };
  var conjuntos = function (esTest) {
    var pino = tomar(1, esTest, cfg.plant), euca = tomar(2, esTest, cfg.plant);
    var mascara = comoClase(pino, 1).merge(comoClase(euca, 1)).merge(otras(esTest));   // 1 plantación, 3 otras
    mascara = mascara.merge(cosechado(esTest));                                        // 4 cosechado
    return {mascara: mascara, especie: pino.merge(euca)};                              // especie: 1 pino, 2 euca
  };
  var tr = conjuntos(false), te = conjuntos(true);
  var rf = function (fc) {
    return ee.Classifier.smileRandomForest({numberOfTrees: cfg.arboles, minLeafPopulation: 2, bagFraction: 0.5, seed: SEMILLA})
      .train({features: fc, classProperty: 'clase', inputProperties: BANDAS});
  };
  var rfMascara = rf(tr.mascara), rfEspecie = rf(tr.especie);
  return {
    periodo: p,
    rfMascaraProb: rfMascara.setOutputMode('MULTIPROBABILITY'),   // [P(plantación), P(otras)(, P(cosechado))]
    rfEspecieProb: rfEspecie.setOutputMode('MULTIPROBABILITY'),   // [P(pino), P(eucalipto)]
    testMascara: te.mascara.classify(rfMascara),
    testEspecie: te.especie.classify(rfEspecie)
  };
}

// ------------------------------------------------------------------------------------------
// Interfaz
// ------------------------------------------------------------------------------------------
function nota(t) { return ui.Label(t, {fontSize: '10px', color: '#666666', margin: '3px 0 0 0', whiteSpace: 'pre-wrap'}); }
function etiqueta(t) { return ui.Label(t, {fontSize: '10px', fontWeight: 'bold', margin: '6px 0 2px 0'}); }
function campo(titulo, valor) {
  var box = ui.Textbox({value: String(valor), style: {width: '70px', margin: '0'}});
  var fila = ui.Panel([ui.Label(titulo, {fontSize: '10px', width: '190px', margin: '6px 4px 0 0'}), box],
    ui.Panel.Layout.flow('horizontal'), {margin: '0', padding: '0'});
  return {fila: fila, box: box};
}

var ECOS_MAPA = [5, 7, 8, 9, 10, 11, 12];
var ecoSelect = ui.Select({items: ECOS_MAPA.map(function (e) { return {label: 'E' + e, value: String(e)}; }),
  value: '8', style: {stretch: 'horizontal'}});
var años = [];
for (var yy = 1996; yy <= 2026; yy++) años.push(String(yy));
var yearSelect = ui.Select({items: años, value: '2020', style: {stretch: 'horizontal'}});
var ecosEntBox = ui.Textbox({value: '8', style: {stretch: 'horizontal'}});
var verSelect = ui.Select({
  items: [{label: 'v1 · plantación vs otras', value: 'v1'}, {label: 'v2 · plantación vs otras + agro', value: 'v2'}],
  value: 'v2', style: {stretch: 'horizontal'}});
var cPlant = campo('Puntos por especie (pino, euca)', 1400);
var cOtras = campo('Puntos "otras"', 4000);
var cAgro = campo('Puntos agro (solo v2)', 2000);
var cArb = campo('Árboles', 40);
var cCosecha = campo('Cosechado · puntos train', 1500);
var btnEntrenar = ui.Button({label: 'Entrenar y mostrar', style: {stretch: 'horizontal'}});
var estado = nota('Elige ecorregión y año, y presiona Entrenar y mostrar.');
var metricas = nota('');

var sDentro = ui.Slider({min: 0.05, max: 1, value: 0.4, step: 0.05, style: {stretch: 'horizontal'}});
var sFuera = ui.Slider({min: 0.05, max: 1, value: 0.85, step: 0.05, style: {stretch: 'horizontal'}});
var lblDentro = nota('P mínima dentro de COL2: 0.40');
var lblFuera = nota('P mínima fuera de COL2: 0.85');
var btnAreas = ui.Button({label: 'Áreas en la vista actual (ha)', style: {stretch: 'horizontal'}});
var areasLabel = ui.Label('', {fontSize: '10px', whiteSpace: 'pre', fontFamily: 'monospace', margin: '4px 0 0 0'});

var panel = ui.Panel({style: {width: '330px', padding: '8px'}});
panel.add(ui.Label('Piloto · guía COL2', {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}));
panel.add(etiqueta('Ecorregión a mapear')); panel.add(ecoSelect);
panel.add(etiqueta('Año')); panel.add(yearSelect);
panel.add(etiqueta('Ecorregiones de entrenamiento (ej. 8 o 7,8)')); panel.add(ecosEntBox);
panel.add(etiqueta('Fondo')); panel.add(verSelect);
panel.add(cPlant.fila); panel.add(cOtras.fila); panel.add(cAgro.fila);
panel.add(cCosecha.fila); panel.add(cArb.fila);
panel.add(btnEntrenar); panel.add(estado); panel.add(metricas);
panel.add(etiqueta('Umbrales (se aplican al instante, sin reentrenar)'));
panel.add(lblDentro); panel.add(sDentro); panel.add(lblFuera); panel.add(sFuera);
panel.add(btnAreas); panel.add(areasLabel);
ui.root.insert(0, panel);

// ------------------------------------------------------------------------------------------
// Capas
// ------------------------------------------------------------------------------------------
var vacia = ee.Image(0).selfMask();
var C = {
  col2: ui.Map.Layer(vacia, {palette: ['E040FB']}, 'COL2 plantación (9)', false, 0.5),
  prob: ui.Map.Layer(vacia, {min: 0, max: 1, palette: ['B71C1C', 'FDD835', '2E7D32']}, 'P(plantación)', false),
  solo: ui.Map.Layer(vacia, {palette: ['00B0FF']}, 'Modelo solo (P ≥ 0.5)', false),
  guiado: ui.Map.Layer(vacia, {palette: ['2E7D32']}, 'Guiado por COL2', false),
  agregado: ui.Map.Layer(vacia, {palette: ['00E5FF']}, 'Agregado fuera de COL2', true),
  descartado: ui.Map.Layer(vacia, {palette: ['FF1744']}, 'Descartado dentro de COL2', true),
  final: ui.Map.Layer(vacia, {min: 1, max: 4, palette: ['1B5E20', 'AEEA00', 'BDBDBD', '8D6E63']}, 'Final con especie', true),
  cosechado: ui.Map.Layer(vacia, {palette: ['FF9100']}, 'Cosechado (dentro de COL2)', false),
  contorno: ui.Map.Layer(vacia, {palette: ['FF00FF']}, 'COL2 contorno', true)
};
['col2', 'prob', 'solo', 'guiado', 'final', 'cosechado', 'agregado', 'descartado', 'contorno'].forEach(function (k) { Map.layers().add(C[k]); });

var ESTADO = null;   // {mascara, pPlant, pEsp, col2, eco, año}

function pintar() {
  if (!ESTADO) return;
  var uIn = sDentro.getValue(), uOut = sFuera.getValue();
  lblDentro.setValue('P mínima dentro de COL2: ' + uIn.toFixed(2));
  lblFuera.setValue('P mínima fuera de COL2: ' + uOut.toFixed(2));
  var S = ESTADO;
  // Guía COL2 sobre plantación; lo que queda como cosechado (solo dentro de COL2) no entra
  S.ok = S.col2.and(S.pPlant.gte(uIn)).or(S.pPlant.gte(uOut)).and(S.cos.not()).updateMask(S.valido);
  var solo = S.pPlant.gte(0.5).updateMask(S.valido);
  var p = S.pEsp.updateMask(S.ok);
  if (RADIO_ESPECIE > 0) p = p.focalMean(RADIO_ESPECIE, 'square', 'pixels').updateMask(S.ok);
  var especie = ee.Image(2).where(p.gte(0.5), 1);
  var final = S.resto.where(S.ok, especie).updateMask(S.valido).toByte();   // fuera de la guía: otras (3) o cosechado (4)

  C.solo.setEeObject(solo.selfMask());
  C.guiado.setEeObject(S.ok.selfMask());
  C.agregado.setEeObject(S.ok.and(S.col2.not()).selfMask());
  C.descartado.setEeObject(S.col2.and(S.ok.not()).selfMask().updateMask(S.mask));
  C.final.setEeObject(final);
  C.cosechado.setEeObject(final.eq(4).selfMask());
  C.final.setName('Final con especie ' + S.año);
}
sDentro.onChange(pintar);
sFuera.onChange(pintar);

btnEntrenar.onClick(function () {
  try {
    var eco = parseInt(ecoSelect.getValue(), 10), año = parseInt(yearSelect.getValue(), 10);
    var cfg = {
      año: año, ecosEnt: parseListaEcos(ecosEntBox.getValue()), ver: verSelect.getValue(),
      plant: parseEntero(cPlant.box.getValue(), 'Puntos por especie', 1), otras: parseEntero(cOtras.box.getValue(), 'Puntos otras', 1),
      agro: parseEntero(cAgro.box.getValue(), 'Puntos agro', 0), arboles: parseEntero(cArb.box.getValue(), 'Árboles', 1),
      cosecha: parseEntero(cCosecha.box.getValue(), 'Puntos cosechado', 1)
    };
    estado.setValue('Entrenando (E' + cfg.ecosEnt.join(', E') + ' · ' + cfg.ver + ' · periodo ' + periodoDe(año).join('–') + ')…');
    estado.style().set('color', '#444444');
    metricas.setValue('');
    var m = entrenar(cfg);

    var mask = ee.Image(ASSET_ECO_RASTER).select(0).eq(eco).selfMask();
    var st = stackAño(año).updateMask(mask);
    var pr = st.classify(m.rfMascaraProb);
    var pPlant = pr.arrayGet([0]).rename('p_plant');
    var pEsp = st.classify(m.rfEspecieProb).arrayGet([0]).rename('p_pino');
    var c2 = col2Plantacion(año);
    // Cosechado: solo dentro de COL2 y donde es la clase de mayor probabilidad entre plantación, otras y cosechado
    var cos = pr.arrayArgmax().arrayGet([0]).eq(2).and(c2.img);
    var resto = ee.Image(3).where(cos, 4);
    ESTADO = {cos: cos, resto: resto, pPlant: pPlant, pEsp: pEsp, col2: c2.img, valido: pPlant.mask(), mask: mask, eco: eco, año: año};

    C.col2.setEeObject(c2.img.selfMask().updateMask(mask));
    C.col2.setName('COL2 plantación (9) ' + c2.año);
    var p0 = c2.img;
    C.contorno.setEeObject(p0.subtract(p0.focalMin(1, 'square', 'pixels')).selfMask().updateMask(mask));
    C.prob.setEeObject(pPlant);
    Map.centerObject(ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + eco).geometry().bounds(), 9);
    pintar();

    estado.setValue('Listo · E' + eco + ' ' + año + ' · COL2 usada: ' + c2.año + (c2.año !== año ? ' (el más cercano)' : '') +
      '\nMueve los umbrales y mira las capas "Agregado fuera de COL2" (celeste) y "Descartado dentro de COL2" (rojo).');
    estado.style().set('color', '#2E7D32');

    // Métricas de test (por punto, sin umbrales): máscara y especie
    m.testMascara.errorMatrix('clase', 'classification').array().evaluate(function (a) {
      if (!a) return;
      var n = 0, fil = 0, col = 0, tp = a[1][1], tn = a[3][3];
      for (var i = 0; i < a.length; i++) for (var j = 0; j < a[i].length; j++) {
        n += a[i][j]; if (i === 1) fil += a[i][j]; if (j === 1) col += a[i][j];
      }
      var pct = function (x) { return isFinite(x) ? (100 * x).toFixed(1) + ' %' : '—'; };
      var oa = 0;
      for (var k = 0; k < a.length; k++) oa += a[k][k];
      m.testEspecie.errorMatrix('clase', 'classification').array().evaluate(function (b) {
        var t = 'Test por punto (argmax, sin guía)\nMáscara: OA ' + pct(oa / n) + ' · PA plant. ' + pct(tp / fil) +
          ' · UA plant. ' + pct(tp / col);
        if (a[4]) {
          var fc = a[4].reduce(function (x, y) { return x + y; }, 0), cc = 0;
          for (var r = 0; r < a.length; r++) cc += (a[r][4] || 0);
          t += '\nCosechado: PA ' + pct(a[4][4] / fc) + ' · UA ' + pct(a[4][4] / cc);
        }
        if (b) {
          var pp = b[1][1], pe = b[1][2], ep = b[2][1], ee_ = b[2][2];
          t += '\nEspecie: PA pino ' + pct(pp / (pp + pe)) + ' · PA euca ' + pct(ee_ / (ep + ee_));
        }
        metricas.setValue(t);
      });
    });
  } catch (err) {
    estado.setValue('Error: ' + err.message);
    estado.style().set('color', '#B71C1C');
  }
});

// ------------------------------------------------------------------------------------------
// Áreas en la vista: cuánto aporta cada caso
// ------------------------------------------------------------------------------------------
btnAreas.onClick(function () {
  if (!ESTADO) { areasLabel.setValue('Primero entrena.'); return; }
  var S = ESTADO;
  var b = Map.getBounds();
  var vista = ee.Geometry.Rectangle([b[0], b[1], b[2], b[3]]);
  areasLabel.setValue('Calculando…');
  var ha = ee.Image.pixelArea().divide(10000);
  var col2 = S.col2.updateMask(S.mask), ok = S.ok, solo = S.pPlant.gte(0.5);
  var apilada = ee.Image([
    ha.updateMask(col2).rename('col2'),
    ha.updateMask(solo).rename('solo'),
    ha.updateMask(ok).rename('guiado'),
    ha.updateMask(ok.and(col2.not())).rename('agregado'),
    ha.updateMask(col2.and(ok.not())).rename('descartado'),
    ha.updateMask(S.cos.updateMask(S.valido)).rename('cosechado')
  ]).unmask(0);
  apilada.reduceRegion({reducer: ee.Reducer.sum(), geometry: vista, scale: 60, maxPixels: 1e9, bestEffort: true, tileScale: 4})
    .evaluate(function (d, err) {
      if (err || !d) { areasLabel.setValue('Error: ' + err); return; }
      var f = function (x) { return String(Math.round(x || 0)); };
      var pad = function (t, n) { t = String(t); while (t.length < n) t = ' ' + t; return t; };
      areasLabel.setValue(
        'Área en la vista (ha)\n' +
        'COL2 plantación        ' + pad(f(d.col2), 9) + '\n' +
        'Modelo solo (P≥0.5)    ' + pad(f(d.solo), 9) + '\n' +
        'Guiado                 ' + pad(f(d.guiado), 9) + '\n' +
        '  + agregado fuera     ' + pad(f(d.agregado), 9) + '\n' +
        '  − descartado dentro  ' + pad(f(d.descartado), 9) +
        '\nCosechado (solo en COL2) ' + pad(f(d.cosechado), 9));
    });
});
