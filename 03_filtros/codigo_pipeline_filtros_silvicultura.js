// ==========================================================================================
// SCRIPT: pipeline_filtros_silvicultura  (etapa 1 del pipeline de filtrado: pasos S1 a S6) · con interfaz
// Proyecto: MapBiomas Chile — COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// Toma las clasificaciones preliminares YA EXPORTADAS (silvo_e{eco}_{año}_{versión}: pino 1, euca 2, otras 3, cosechado 4, con
// bandas de probabilidad) y, por ecorregión, aplica sobre TODA la serie 1996–2026 los pasos del documento
// "Pipeline de filtrado de la clasificación de silvicultura" (pipeline_filtros_silvicultura.docx):
//
//   S1  Relleno de huecos de mosaico        año vecino más cercano, hasta 3 años (1996 con posteriores, 2026 con anteriores)
//   S2  Corrección por incendios            cosechado que empieza el año de un incendio de MapBiomas Fuego → último pino/euca previo
//   S3  Área mínima                         parche de plantación (pino+euca) menor al umbral → otras            [11 px ≈ 1 ha, como el filtro general]
//   S4  Consistencia temporal por tramos    una especie por tramo; solo pino→euca y solo con corte; cosecha de 1 año; regla de 5 años
//   S5  Consistencia espacial de especie    fragmento pequeño de una especie pegado a un fragmento mayor de la otra → la otra  [22 px ≈ 2 ha, a calibrar]
//   S6  Códigos finales                     pino → 79, eucalipto → 80, cosechado → 83 (otras queda sin transversal)
//
// SALIDA al exportar (una imagen por ecorregión, bandas por año; 3 bandas × 31 años):
//   silvicultura_{año}   clase filtrada 1/2/3/4 (compatible con la clasificación preliminar)
//   final_{año}          códigos finales 79/80/83 (otras = sin dato, para integrar sobre la clasificación general)
//   paso_{año}           qué pasos cambiaron el píxel ese año (suma de bits: 1=S1, 2=S2, 4=S3, 8=S4, 16=S5); 0 = no cambió
// El asset se llama silvo_filtrado_e{eco}_{versión de salida}: no coincide con el patrón silvo_e{eco}_{año}_{versión}, así que los
// visores actuales no lo leen (hay que adaptarlos a este formato).
//
// INTERFAZ (panel a la izquierda; al ejecutar el script se arma sola):
//   1) Datos: ecorregión y versión de entrada (se leen de la carpeta). Cambiarlas aplica el pipeline de inmediato.
//   2) Pasos: activa/desactiva S1–S5 y edita sus parámetros; «Aplicar» arma el pipeline con esos valores (los cambios de
//      parámetros no se aplican solos para no recalcular el mapa a cada tecla).
//   3) Ver: año (◀ ▶), etapa a mostrar (entrada, tras cada paso, códigos finales, píxeles cambiados por paso, incendios).
//      La entrada queda siempre debajo (oculta) en el administrador de capas para compararla.
//   4) Región: «Usar vista actual» limita estadísticas y exportación a lo que ves en el mapa. Empieza con una región pequeña:
//      la cadena usa los 31 años y es pesada; con la ecorregión completa las estadísticas pueden dar «too expensive».
//   5) Estadísticas: ha cambiadas por paso y año, o ha por clase entrada vs salida (gráficos en el panel).
//   6) Exportar: crea la tarea (pestaña Tasks) con los pasos y parámetros vigentes a 30 m.
//   7) Clic en el mapa: serie del píxel (clase por año tras cada etapa y qué pasos lo cambiaron).
//
// UMBRALES: areaMinPx (S3) = 11 px, igual al filtro general (S3 elimina plantación, así que no debe ser más estricto);
// especieMinPx (S5) = 22 px, a calibrar con la capa «Cambios · solo S5» (S5 solo reasigna especie, puede ser más generoso).
// FUEGO (S2): solo se usan los años FUEGO_AÑO_INI–FUEGO_AÑO_FIN (2013–2025, MapBiomas Fuego Col. 1). Sin dato de fuego antes de 2013
// no se corrige: los cosechados por incendio de esos años quedan como cosechado. Ampliar a 1996–2012 con GABAM está en discusión.
// Entradas sin bandas de probabilidad (p_pino, p_euca): se usan "votos" sintéticos (100 para la clase asignada); el script avisa.
// ==========================================================================================

// ------------------------------------------------------------------------------------------
// CONFIGURACIÓN (valores iniciales; todo se puede cambiar luego en el panel)
// ------------------------------------------------------------------------------------------
var CARPETA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';
var CARPETA_ECO_VECTOR = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES';
var ECO_INICIAL = 8;
var VERSION_ENTRADA_INICIAL = 'v4';         // versión de las clasificaciones de entrada
var VERSION_SALIDA = 'v4_f1';               // sufijo del asset de salida: silvo_filtrado_e{eco}_{VERSION_SALIDA}
var AÑO_INI = 1996, AÑO_FIN = 2026;
var AÑO_VISTA_INICIAL = 2017;
var ESCALA_EXPORT = 30;
var SOBRESCRIBIR = false;                   // false = no crea la tarea si el asset de salida ya existe

var PARAM = {
  rellenoMaxAños: 3,                        // S1
  fuegoDesfase: 1,                          // S2  años de tolerancia entre el incendio y el inicio del cosechado
  fuegoAtrasMax: 5,                         // S2  años hacia atrás para buscar el último pino/euca previo
  areaMinPx: 11,                            // S3  ≈ 1 ha a 30 m (igual al filtro general)
  corteOtras: 5,                            // S4  años consecutivos de "otras" que cortan un tramo
  ventanaPost: 5,                           // S4  años posteriores a una cosecha para decidir si vuelve la silvicultura
  ultimoAñoConfiable: 2025,                 // S4  2026 no cuenta como dato
  duracionMinima: 3,                        // S4  una plantación nueva que dura menos años (con «otras» a ambos lados, sin cosecha) se borra (0 = apagado)
  cosechaImplicita: 2,                      // S4  años seguidos de «otras» tras silvicultura que implican una cosecha no detectada (0 = apagado)
  maxTramos: 6,                             // S4  tramos máximos por píxel (si hay más, se unen al último)
  especieMinPx: 22                          // S5  ≈ 2 ha a 30 m (a calibrar)
};

// Producto anual de MapBiomas Fuego (ImageCollection o Image). Se detecta la estructura al empezar (S2).
var ASSET_FUEGO = 'projects/mapbiomas-chile/assets/FIRE/COLLECTION1/CLASSIFICATION/burned_area_chile_year_11';
var FUEGO_BANDA = null;                     // null = 'burned_area' si existe; si no, la primera banda
var FUEGO_CAMPOS_AÑO = ['year', 'año', 'ano', 'Year', 'YEAR'];
var FUEGO_UMBRAL = 0;                       // quemado = valor > umbral
var FUEGO_AÑO_INI = 2013, FUEGO_AÑO_FIN = 2025;   // años de fuego que se usan en S2 (los demás se ignoran aunque el asset los tenga)

var AÑOS = [];
for (var yy = AÑO_INI; yy <= AÑO_FIN; yy++) AÑOS.push(yy);

// ------------------------------------------------------------------------------------------
// NÚCLEO TEMPORAL (S1, S2, S4): solo operaciones de imagen elementales (también se prueba por separado)
// ------------------------------------------------------------------------------------------
//<<NUCLEO

// S1 · Relleno: cada año enmascarado toma el dato del año vecino más cercano (a igual distancia, el anterior).
// arr: imágenes de varias bandas (clase y votos); el relleno trae todas las bandas del mismo año donante.
function s1Relleno(arr, maxD) {
  var n = arr.length;
  return arr.map(function (img, k) {
    var out = img;
    for (var d = 1; d <= maxD; d++) {
      [k - d, k + d].forEach(function (i) { if (i >= 0 && i < n) out = out.unmask(arr[i]); });
    }
    return out;
  });
}

// S2 · Fuego: para cada año, ¿hubo incendio en ese año o en los `desfase` años anteriores? (null si no hay dato de fuego)
function fuegoVentana(y, desfase) {
  var out = null;
  for (var d = 0; d <= desfase; d++) {
    var f = fuegoAño(y - d);
    if (f) out = out ? out.or(f) : f;
  }
  return out;
}

// S2 · Se sigue cada TRAMO de cosechado (años seguidos con clase 4). Si el tramo empieza en un año con incendio (o hasta
// `desfase` años después), todo el tramo toma el último pino/euca que tuvo el píxel antes (hasta `atrasMax` años atrás). Un
// cosechado sin pino/euca previo se deja como está: cosechado nunca pasa a otras. Devuelve {cs, corr}.
function s2Fuego(cs, años, desfase, atrasMax) {
  var out = [], corr = [];
  var prevCos = ee.Image(0), ultPE = ee.Image(0), edad = ee.Image(0), pre = ee.Image(0), flag = ee.Image(0);
  for (var k = 0; k < cs.length; k++) {
    var c = cs[k];
    var salto = k > 0 ? años[k] - años[k - 1] : 1;
    var pc = salto === 1 ? prevCos : ee.Image(0);
    var edadK = edad.add(salto - 1);
    var cos = c.eq(4).unmask(0);
    var nuevo = cos.and(pc.not());
    var candidato = ultPE.where(edadK.gt(atrasMax), 0);
    var fw = fuegoVentana(años[k], desfase) || ee.Image(0);
    var preN = ee.Image(0).where(cos.and(pc), pre).where(nuevo, candidato);
    var flagN = ee.Image(0).where(cos.and(pc), flag).where(nuevo, fw);
    var cond = cos.and(flagN).and(preN.gt(0));
    out.push(c.where(cond, preN));
    corr.push(cond);
    var esPE = c.eq(1).or(c.eq(2)).unmask(0);
    ultPE = ultPE.where(esPE, c.unmask(0));
    edad = ee.Image(0).where(esPE, 1).where(esPE.not().and(ultPE.gt(0)), edadK.add(1));
    prevCos = cos; pre = preN; flag = flagN;
  }
  return {cs: out, corr: corr};
}

// S4 · Paso previo «duración mínima» (S9): una plantación nueva que aparece pocos años y desaparece sin cosecha es un falso positivo.
//   Una racha de pino/euca de menos de M = P.duracionMinima años, con «otras» el año anterior y el siguiente (no cosecha), vuelve a «otras».
//   No se borra: (a) un replante, es decir, si antes hubo silvicultura o cosecha y entre ella y la racha hay menos de ventanaPost años de
//   «otras»; (b) una racha que empieza en el primer año de la serie (ya existía); (c) una racha que termina en 2024 o después
//   (ultimoAñoConfiable − 1: aún no se puede juzgar si sigue). Se recorre en orden: una racha borrada ya no cuenta como plantación previa.
//   Con 0 el paso queda apagado.
function s4DuracionMinima(c, años, P) {
  var M = P.duracionMinima || 0;
  if (M < 2) return c;
  var n = c.length, ULT = P.ultimoAñoConfiable, W = P.ventanaPost, k, j, L;
  var u = c.map(function (x) { return x.unmask(0); });
  var out = c.slice();
  var ultimo = ee.Image(0), gO = ee.Image(0);        // última clase 1/2/4 vista y años de «otras» desde entonces
  for (k = 0; k < n; k++) {
    if (k >= 1) {
      for (L = 1; L <= M - 1 && k + L < n; L++) {
        if (años[k + L - 1] > ULT - 2) continue;
        var cond = u[k - 1].eq(3).and(u[k + L].eq(3));
        for (j = 0; j < L; j++) cond = cond.and(u[k + j].eq(1).or(u[k + j].eq(2)));
        cond = cond.and(ultimo.gt(0).and(gO.lt(W)).not());
        for (j = 0; j < L; j++) {
          u[k + j] = u[k + j].where(cond, ee.Image(3));
          out[k + j] = out[k + j].where(cond, ee.Image(3));
        }
      }
    }
    var cl = u[k], hay = cl.eq(1).or(cl.eq(2)).or(cl.eq(4));
    ultimo = ultimo.where(hay, cl);
    gO = gO.where(cl.eq(3), gO.add(1)).where(hay, 0);
  }
  return out;
}

// S4 · Paso previo «cosecha implícita»: una plantación no pasa a «otras» sin una cosecha en medio.
//   Un año de «otras» justo después de un año de silvicultura se marca como cosechado (cosecha que el clasificador no vio).
//   Excepciones, con N = P.cosechaImplicita (0 = apagado):
//   · Si la racha de «otras» dura menos de N años y la silvicultura vuelve justo después, no se marca cosecha: los años se
//     rellenan con la clase del año anterior (S4 después unifica la especie del tramo). Evita puntos de cosechado de un año
//     cuando el clasificador solo parpadea.
//   · Los años posteriores al último año confiable no cuentan como dato: continúan con la clase del año anterior.
//   Se mira solo la clase original (antes de modificar nada) y se asume una serie de años consecutivos.
//   Devuelve {c: serie nueva, imp: años marcados como cosecha implícita}. Esa cosecha NO cuenta como corte para cambiar de especie
//   (S2): para eso hace falta una cosecha detectada, un incendio (S10) o «otras» durante corteOtras años o más.
function s4CosechaImplicita(c, años, P) {
  var N = P.cosechaImplicita || 0;
  var imp = c.map(function () { return ee.Image(0); });
  if (N < 1) return {c: c, imp: imp};
  var n = c.length, ULT = P.ultimoAñoConfiable, k, j, L;
  var u = c.map(function (x) { return x.unmask(0); });
  var S = u.map(function (x) { return x.eq(1).or(x.eq(2)); });
  var O = u.map(function (x) { return x.eq(3); });
  var out = c.slice(), llena = [];
  for (k = 0; k < n; k++) llena.push(ee.Image(0));
  for (k = 1; k < n; k++) {
    for (L = 1; L <= N - 1 && k + L < n; L++) {
      var cond = S[k - 1].and(S[k + L]);
      for (j = 0; j < L; j++) cond = cond.and(O[k + j]);
      for (j = 0; j < L; j++) {
        out[k + j] = out[k + j].where(cond, u[k - 1]);
        llena[k + j] = llena[k + j].or(cond);
      }
    }
  }
  for (k = 1; k < n; k++) {
    var cc = S[k - 1].and(O[k]).and(llena[k].not());
    out[k] = out[k].where(cc, años[k] <= ULT ? ee.Image(4) : u[k - 1]);
    if (años[k] <= ULT) imp[k] = cc;
  }
  return {c: out, imp: imp};
}

// S4 · Consistencia temporal por tramos.
//   c[k]: clase del año k (1,2,3,4; enmascarado = sin dato)   vp[k], ve[k]: votos de pino y euca del año (0 si no vota)
// 0) Pasos previos: (a) s4DuracionMinima borra las plantaciones nuevas más cortas que duracionMinima; (b) s4CosechaImplicita: silvicultura →
//    «otras» sin cosecha en medio se interpreta como una cosecha no detectada.
// 1) Tramos: años de silvicultura entre cortes. Cortan: un año de cosecha DETECTADA, el final de un incendio que S2 corrigió (corte[k], S10: los años quemados siguen siendo el tramo anterior y lo que viene después es un tramo nuevo),
//    o ≥ corteOtras años consecutivos de "otras" (la cosecha implícita cuenta como «otras» para esto, no como cosecha).
// 2) Una especie por tramo; solo se permite pino → euca, una vez, en un corte: se elige el punto de cambio que más concuerda
//    con la suma de votos de cada tramo.
// 3) Después de una cosecha (el primer año queda como cosechado): si en los siguientes ventanaPost años se detecta silvicultura,
//    los años intermedios toman esa especie; si no y hay datos suficientes, el cosechado de continuación pasa a "otras"; si no hay
//    datos suficientes (ultimoAñoConfiable − año de cosecha < ventanaPost) continúa la especie anterior a la cosecha.
function s4Temporal(c, vp, ve, años, P, corte) {
  var n = c.length, M = P.maxTramos, W = P.ventanaPost, ULT = P.ultimoAñoConfiable;
  var Z = ee.Image(0), j, k;
  var antes = c;
  c = s4DuracionMinima(c, años, P);
  vp = vp.slice(); ve = ve.slice();
  for (k = 0; k < n; k++) {                              // los años borrados no votan
    var borrado = antes[k].unmask(0).neq(c[k].unmask(0));
    vp[k] = vp[k].where(borrado, 0); ve[k] = ve[k].where(borrado, 0);
  }
  var ci = s4CosechaImplicita(c, años, P);
  c = ci.c;
  var imp = ci.imp, pCorte = Z;
  // --- pasada 1: tramos y votos por tramo
  var tr = Z, hasS = Z, hadC = Z, run = Z, largo = Z;
  var tid = [], isS = [], SP = [], SE = [];
  for (j = 0; j < M; j++) { SP.push(Z); SE.push(Z); }
  for (k = 0; k < n; k++) {
    var ck = c[k].unmask(0).where(imp[k], 3);            // cosecha implícita = «otras» para decidir cortes
    var s = ck.eq(1).or(ck.eq(2));
    var cf = corte ? corte[k].unmask(0) : Z, cutNow = pCorte.and(cf.not());   // fin de un tramo de incendio corregido por S2
    pCorte = cf;
    var nuevo = s.and(hasS).and(hadC.or(largo).or(cutNow));
    tr = tr.add(nuevo);
    tr = tr.where(tr.gt(M - 1), M - 1);
    tid.push(tr); isS.push(s);
    for (j = 0; j < M; j++) {
      var m = tr.eq(j);
      SP[j] = SP[j].add(vp[k].multiply(m)); SE[j] = SE[j].add(ve[k].multiply(m));
    }
    hadC = hadC.or(ck.eq(4)).or(cutNow).where(s, 0);
    run = Z.where(ck.eq(3), run.add(1)).where(ck.eq(0), run);
    largo = largo.or(run.gte(P.corteOtras)).where(s, 0);
    hasS = hasS.or(s);
  }
  // --- punto de cambio pino → euca: j = nº de tramos iniciales que son pino (empate: más pino)
  var score = Z;
  for (j = 0; j < M; j++) score = score.add(SE[j]);
  var best = Z.subtract(1), bestJ = Z;
  for (j = 0; j <= M; j++) {
    var mejor = score.gte(best);
    best = best.where(mejor, score); bestJ = bestJ.where(mejor, j);
    if (j < M) score = score.add(SP[j]).subtract(SE[j]);
  }
  var esp = [], out1 = [];
  for (k = 0; k < n; k++) {
    var e = ee.Image(2).where(tid[k].lt(bestJ), 1);
    esp.push(e);
    out1.push(c[k].where(isS[k], e));
  }
  // --- pasada 2 (hacia atrás): próximo año con silvicultura (≤ último año confiable) y su especie
  var nY = Z, nSp = Z, nxtY = new Array(n), nxtSp = new Array(n);
  for (k = n - 1; k >= 0; k--) {
    nxtY[k] = nY; nxtSp[k] = nSp;
    if (años[k] <= ULT) { nY = nY.where(isS[k], años[k]); nSp = nSp.where(isS[k], esp[k]); }
  }
  // --- pasada 3: años posteriores a una cosecha
  var t0 = Z, prevSp = Z, prevC = Z, out2 = [];
  for (k = 0; k < n; k++) {
    var c0 = c[k].unmask(0), año = años[k];
    var ini = c0.eq(4).and(prevC.not());                       // primer año de un tramo de cosechado: se queda como cosechado
    t0 = t0.where(isS[k], 0).where(ini, año);
    var aplica = t0.gt(0).and(t0.lt(año)).and(isS[k].not()).and(c0.eq(3).or(c0.eq(4)));
    var enVentana = nxtY[k].gt(0).and(nxtY[k].subtract(t0).lte(W));
    var suficiente = ee.Image(ULT).subtract(t0).gte(W);
    var o = out1[k];
    o = o.where(aplica.and(enVentana), nxtSp[k]);
    o = o.where(aplica.and(enVentana.not()).and(suficiente).and(c0.eq(4)), 3);
    o = o.where(aplica.and(enVentana.not()).and(suficiente.not()).and(prevSp.gt(0)), prevSp);
    out2.push(o);
    prevSp = prevSp.where(isS[k], esp[k]);
    prevC = c0.eq(4);
  }
  return out2;
}
//NUCLEO>>

// ------------------------------------------------------------------------------------------
// S2 · Producto de MapBiomas Fuego: se lee su estructura una vez y se arma FUEGO.porAño[año] = [{id, banda}]
// ------------------------------------------------------------------------------------------
var FUEGO = {ok: false, porAño: {}, error: ''};
var FUEGO_IMG = {};
function enRangoFuego(y) { return y >= FUEGO_AÑO_INI && y <= FUEGO_AÑO_FIN; }
function sondearFuego() {
  if (FUEGO.ok) return true;
  FUEGO.error = ''; FUEGO.porAño = {}; FUEGO_IMG = {};
  var tipo = 'IMAGE_COLLECTION', items = null, errores = [];
  try { items = ee.ImageCollection(ASSET_FUEGO).getInfo().features || []; } catch (e1) { errores.push('colección: ' + String(e1.message || e1)); }
  if (!items || !items.length) {
    try { items = [ee.Image(ASSET_FUEGO).getInfo()]; tipo = 'IMAGE'; } catch (e2) { errores.push('imagen: ' + String(e2.message || e2)); items = null; }
  }
  if (!items) { FUEGO.error = errores.join(' | '); return false; }
  try {
    var reAño = /(?:19|20)\d{2}/g;
    items.forEach(function (it) {
      var id = it.id || ASSET_FUEGO;
      var bandas = (it.bands || []).map(function (b) { return b.id; });
      var props = it.properties || {};
      var porBanda = [];
      bandas.forEach(function (b) { var m = b.match(reAño); if (m) porBanda.push({y: +m[m.length - 1], b: b}); });
      if (porBanda.length) {
        porBanda.forEach(function (x) { if (enRangoFuego(x.y)) (FUEGO.porAño[x.y] = FUEGO.porAño[x.y] || []).push({id: id, banda: x.b}); });
        return;
      }
      var y = null;
      FUEGO_CAMPOS_AÑO.forEach(function (c) { if (y === null && props[c] !== undefined && !isNaN(+props[c])) y = +props[c]; });
      if (y === null) { var m2 = String(id).split('/').pop().match(reAño); if (m2) y = +m2[m2.length - 1]; }
      if (y === null) return;
      var banda = FUEGO_BANDA || (bandas.indexOf('burned_area') >= 0 ? 'burned_area' : bandas[0]);
      if (banda && enRangoFuego(y)) (FUEGO.porAño[y] = FUEGO.porAño[y] || []).push({id: id, banda: banda});
    });
    FUEGO.ok = Object.keys(FUEGO.porAño).length > 0;
    if (!FUEGO.ok) FUEGO.error = 'no se pudo deducir el año de ninguna imagen de ' + ASSET_FUEGO + ' dentro de ' + FUEGO_AÑO_INI + '–' + FUEGO_AÑO_FIN;
    var ej = items[0] || {};
    print('MapBiomas Fuego · ' + tipo + ' · ' + items.length + ' imagen(es) · años con dato: ' + Object.keys(FUEGO.porAño).sort().join(', '));
    print('Fuego · ejemplo: ' + (ej.id || ASSET_FUEGO) + ' · bandas: ' + ((ej.bands || []).map(function (b) { return b.id; }).join(', ')) +
      ' · propiedades: ' + Object.keys(ej.properties || {}).join(', '));
  } catch (e) { FUEGO.ok = false; FUEGO.error = String(e.message || e); }
  return FUEGO.ok;
}
function fuegoAño(y) {                      // imagen binaria (1 = quemado ese año) o null si el producto no tiene ese año
  if (FUEGO_IMG[y] !== undefined) return FUEGO_IMG[y];
  var l = FUEGO.porAño[y];
  FUEGO_IMG[y] = (!l || !l.length) ? null : ee.ImageCollection(l.map(function (it) {
    return ee.Image(it.id).select([it.banda]).rename('q').gt(FUEGO_UMBRAL).unmask(0);
  })).max().rename('q');
  return FUEGO_IMG[y];
}

// ------------------------------------------------------------------------------------------
// Entradas: catálogo de assets y carga por año (clase + votos de pino y euca)
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
var CAT = {};            // CAT[eco][versión][año] = id
var EXISTENTES = {};     // ids de todo lo que ya hay en la carpeta (para no pisar exportaciones)
var ERROR_CARPETA = '';
(function () {
  var re = /^silvo_e(\d+)_(\d{4})_(.+)$/;
  var lista = [];
  try { lista = listarCarpeta(CARPETA); } catch (e) { ERROR_CARPETA = 'No se pudo leer la carpeta de entrada: ' + (e.message || e); print(ERROR_CARPETA); }
  lista.forEach(function (a) {
    EXISTENTES[a.id || a.name] = true;
    if (a.type !== 'IMAGE') return;
    var id = a.id || a.name, m = id.split('/').pop().match(re);
    if (!m) return;
    var eco = +m[1], año = +m[2], ver = m[3];
    CAT[eco] = CAT[eco] || {};
    CAT[eco][ver] = CAT[eco][ver] || {};
    CAT[eco][ver][año] = id;
  });
})();
function ecosDisponibles() {
  var k = Object.keys(CAT).map(Number).sort(function (a, b) { return a - b; });
  return k.length ? k : [ECO_INICIAL];
}
function versionesDe(eco) {
  var v = Object.keys(CAT[eco] || {}).sort();
  return v.length ? v : [VERSION_ENTRADA_INICIAL];
}
function añosDe(eco, ver) {
  return AÑOS.filter(function (y) { return ((CAT[eco] || {})[ver] || {})[y]; });
}

// 3 bandas: c (clase 1-4), pp (voto pino 0-100), pe (voto euca 0-100). Sin bandas de probabilidad: votos sintéticos.
function cargarAño(id) {
  var im = ee.Image(id);
  var clase = im.select(0).rename('c');
  var conProb = im.bandNames().contains('p_pino');
  var real = clase.addBands(im.select(['p_pino', 'p_euca'], ['pp', 'pe']));
  var sint = clase.addBands(clase.eq(1).multiply(100).rename('pp')).addBands(clase.eq(2).multiply(100).rename('pe'));
  return ee.Image(ee.Algorithms.If(conProb, real, sint));
}
var VACIO = ee.Image.cat([ee.Image(0), ee.Image(0), ee.Image(0)]).rename(['c', 'pp', 'pe']).selfMask();

// ------------------------------------------------------------------------------------------
// Pasos espaciales (S3 y S5), por año
// ------------------------------------------------------------------------------------------
function s3Area(c, U) {                     // parche de plantación (pino+euca, 8 vecinos) menor a U píxeles → otras
  var pl = c.eq(1).or(c.eq(2)).unmask(0);
  var chico = pl.and(pl.connectedPixelCount(U, true).lt(U));
  return c.where(chico, 3);
}
function s5Especie(c, U) {                  // fragmento pequeño de una especie pegado a un fragmento MAYOR de la otra → la otra
  var kernelOpts = {radius: 1, units: 'pixels', kernelType: 'square'};
  var p1 = c.eq(1).unmask(0), e1 = c.eq(2).unmask(0);
  var aP = p1.connectedPixelCount(U, true), aE = e1.connectedPixelCount(U, true);     // tope U: basta para comparar
  var vecE = aE.updateMask(e1).focalMax(kernelOpts).unmask(0);                         // área del mayor fragmento E vecino
  var vecP = aP.updateMask(p1).focalMax(kernelOpts).unmask(0);
  var pAE = p1.and(aP.lt(U)).and(vecE.gt(aP));
  var eAP = e1.and(aE.lt(U)).and(vecP.gt(aE));
  return c.where(pAE, 2).where(eAP, 1);
}
function s6Final(c) {                       // 1 → 79 · 2 → 80 · 4 → 83 · otras → sin dato
  return ee.Image(0).where(c.eq(1), 79).where(c.eq(2), 80).where(c.eq(4), 83).selfMask().toByte();
}

// ------------------------------------------------------------------------------------------
// Pipeline de una ecorregión (cada paso se puede desactivar: pasa la imagen sin cambios)
// ------------------------------------------------------------------------------------------
function distinto(a, b) { return a.unmask(0).neq(b.unmask(0)); }

function construirPipeline(eco, ver, P, on) {
  var ids = (CAT[eco] || {})[ver] || {};
  var faltan = AÑOS.filter(function (y) { return !ids[y]; });
  if (faltan.length === AÑOS.length) return {error: 'E' + eco + ': no hay assets ' + ver + ' en la carpeta.'};
  var avisos = [];
  if (faltan.length) avisos.push('años sin asset (quedan sin dato): ' + faltan.join(', '));
  var cero = function () { return ee.Image(0); };
  var orig = AÑOS.map(function (y) { return ids[y] ? cargarAño(ids[y]) : VACIO; });

  // S1
  var a1 = on.s1 ? s1Relleno(orig, P.rellenoMaxAños) : orig;
  var c0 = orig.map(function (a) { return a.select('c'); });
  var c1 = a1.map(function (a) { return a.select('c'); });
  var rell = a1.map(function (a, k) { return on.s1 ? a.select('c').mask().and(orig[k].select('c').mask().not()) : cero(); });

  // S2
  var c2 = c1, corr2 = c1.map(cero), fuegoOk = false;
  if (on.s2) {
    if (sondearFuego()) {
      var f = s2Fuego(c1, AÑOS, P.fuegoDesfase, P.fuegoAtrasMax);
      c2 = f.cs; corr2 = f.corr; fuegoOk = true;
    } else {
      avisos.push('S2 omitido: no se pudo leer MapBiomas Fuego (' + FUEGO.error + '). Revisa ASSET_FUEGO / FUEGO_BANDA / FUEGO_CAMPOS_AÑO.');
    }
  }

  // S3
  var c3 = on.s3 ? c2.map(function (c) { return s3Area(c, P.areaMinPx); }) : c2;

  // S4: votos solo de los años que la clasificación dejó como pino/euca (no los corregidos por S2 ni los quitados por S3)
  var c4 = c3;
  if (on.s4) {
    var vp = [], ve = [];
    AÑOS.forEach(function (y, k) {
      var vota = c3[k].eq(1).or(c3[k].eq(2)).unmask(0).and(corr2[k].unmask(0).not());
      vp.push(a1[k].select('pp').unmask(0).multiply(vota));
      ve.push(a1[k].select('pe').unmask(0).multiply(vota));
    });
    c4 = s4Temporal(c3, vp, ve, AÑOS, P, corr2);
  }

  // S5 y S6
  var c5 = on.s5 ? c4.map(function (c) { return s5Especie(c, P.especieMinPx); }) : c4;
  var bandas = [], pasos = [];
  AÑOS.forEach(function (y, k) {
    var paso = rell[k].unmask(0)
      .add(corr2[k].unmask(0).multiply(2))
      .add(distinto(c3[k], c2[k]).multiply(4))
      .add(distinto(c4[k], c3[k]).multiply(8))
      .add(distinto(c5[k], c4[k]).multiply(16)).toByte().rename('paso_' + y);
    pasos.push(paso);
    bandas.push(c5[k].toByte().rename('silvicultura_' + y), s6Final(c5[k]).rename('final_' + y), paso);
  });
  return {eco: eco, ver: ver, P: P, on: on, fuegoOk: fuegoOk, avisos: avisos, imagen: ee.Image.cat(bandas),
    orig: orig, c0: c0, c1: c1, c2: c2, c3: c3, c4: c4, c5: c5, corr2: corr2, pasos: pasos};
}

// ------------------------------------------------------------------------------------------
// Interfaz
// ------------------------------------------------------------------------------------------
var VIS = {min: 1, max: 4, palette: ['1B5E20', 'AEEA00', 'BDBDBD', '8D6E63']};
var VIS_FINAL = {min: 79, max: 83, palette: ['1B5E20', 'AEEA00', '000000', '000000', '8D6E63']};
var COL_CLASE = {1: '1B5E20', 2: 'AEEA00', 3: 'BDBDBD', 4: '8D6E63'};
var NOM_CLASE = {1: 'Pino', 2: 'Eucalipto', 3: 'Otras', 4: 'Cosechado'};
var LETRA = {0: '·', 1: 'P', 2: 'E', 3: 'O', 4: 'C'};
var COL_PASO = ['00E5FF', 'FF6D00', 'FFEA00', 'FF1744', 'AA00FF'];
var NOM_PASO = ['S1 relleno', 'S2 incendios', 'S3 área mín.', 'S4 temporal', 'S5 especie'];
var COL_FUEGO = 'FF6D00';

// Pasos, sus parámetros y límites de validación: [clave en PARAM, texto, mín, máx]
var DEF_PASOS = [
  {k: 's1', txt: 'S1 · Relleno de huecos de mosaico', p: [['rellenoMaxAños', 'años máx. de relleno', 1, 10]]},
  {k: 's2', txt: 'S2 · Corrección por incendios', p: [['fuegoDesfase', 'desfase incendio → cosecha (años)', 0, 3], ['fuegoAtrasMax', 'años atrás para buscar pino/euca', 1, 10]]},
  {k: 's3', txt: 'S3 · Área mínima', p: [['areaMinPx', 'umbral (px de 30 m; filtro general = 11)', 1, 256]]},
  {k: 's4', txt: 'S4 · Consistencia temporal', p: [['corteOtras', 'años de «otras» que cortan un tramo', 1, 10], ['ventanaPost', 'ventana post-cosecha (años)', 1, 10],
    ['ultimoAñoConfiable', 'último año confiable', AÑO_INI, AÑO_FIN], ['maxTramos', 'tramos máx. por píxel', 1, 8],
    ['duracionMinima', 'plantación nueva más corta que esto (años) se borra; 0 = no', 0, 6],
    ['cosechaImplicita', '«otras» tras silvicultura = cosecha (años seguidos; 0 = no)', 0, 5]]},
  {k: 's5', txt: 'S5 · Consistencia espacial de especie (umbral a calibrar)', p: [['especieMinPx', 'umbral (píxeles de 30 m)', 1, 256]]}
];

var ETAPAS = [
  {v: 'c5', t: 'Salida · tras S1–S5 (clase 1/2/3/4)'},
  {v: 'c0', t: 'Entrada (sin filtros)'},
  {v: 'c1', t: 'Tras S1 · relleno'},
  {v: 'c2', t: 'Tras S2 · incendios'},
  {v: 'c3', t: 'Tras S3 · área mínima'},
  {v: 'c4', t: 'Tras S4 · temporal'},
  {v: 'fin', t: 'Códigos finales 79 / 80 / 83'},
  {v: 'dU', t: 'Cambios · último paso que cambió el píxel'},
  {v: 'd0', t: 'Cambios · solo S1'}, {v: 'd1', t: 'Cambios · solo S2'}, {v: 'd2', t: 'Cambios · solo S3'},
  {v: 'd3', t: 'Cambios · solo S4'}, {v: 'd4', t: 'Cambios · solo S5'},
  {v: 'fuego', t: 'MapBiomas Fuego · quemado ese año'}
];

var ESTADO = {eco: null, ver: null, año: AÑO_VISTA_INICIAL, etapa: 'c5', roi: null, pipe: null, punto: null, ocupado: false, sucio: false};

// Las clasificaciones de entrada pueden traer una franja (buffer) alrededor de la ecorregión (clasificador con buffer). La región de
// trabajo y de exportación la incluye, para que los filtros espaciales y temporales no corten parches en el límite. Si las entradas no
// traen franja no pasa nada: lo que sobra queda sin dato. 0 = solo el rectángulo de la ecorregión.
var BUFFER_KM = 5;
function regionEco() {
  var b = ee.FeatureCollection(CARPETA_ECO_VECTOR + '/E' + ESTADO.eco).geometry().bounds();
  return BUFFER_KM > 0 ? b.buffer(BUFFER_KM * 1000).bounds() : b;
}
function regionTrabajo() { return ESTADO.roi || regionEco(); }

// ---- widgets
var panel = ui.Panel({style: {width: '390px', padding: '8px'}});
function titulo(t) { return ui.Label(t, {fontWeight: 'bold', fontSize: '13px', margin: '12px 0 4px 0'}); }
function nota(t, color) { return ui.Label(t, {fontSize: '11px', color: color || '#555', margin: '2px 0', whiteSpace: 'pre-wrap'}); }
function horizontal(items) { return ui.Panel(items, ui.Panel.Layout.flow('horizontal')); }

var estado = ui.Label('', {fontSize: '11px', margin: '4px 0', whiteSpace: 'pre-wrap'});
function dice(t, color) { estado.setValue(t); estado.style().set('color', color || '#333'); }

// 1) Datos
var selEco = ui.Select({items: ecosDisponibles().map(function (e) { return {label: 'E' + e, value: String(e)}; }),
  value: String(ecosDisponibles().indexOf(ECO_INICIAL) >= 0 ? ECO_INICIAL : ecosDisponibles()[0]), style: {width: '90px'}});
var selVer = ui.Select({items: [], style: {width: '170px'}});
var SUPRIMIR = false;                       // evita que reponer la lista de versiones dispare «aplicar» dos veces
function llenarVersiones(conservar) {
  var eco = +selEco.getValue(), vs = versionesDe(eco);
  SUPRIMIR = true;
  selVer.items().reset(vs.map(function (v) { return {label: v + ' · ' + añosDe(eco, v).length + ' años', value: v}; }));
  var v = (conservar && vs.indexOf(conservar) >= 0) ? conservar : (vs.indexOf(VERSION_ENTRADA_INICIAL) >= 0 ? VERSION_ENTRADA_INICIAL : vs[vs.length - 1]);
  selVer.setValue(v, false);
  SUPRIMIR = false;
}
llenarVersiones(null);

// 2) Pasos y parámetros
var chk = {}, caja = {};
var panelPasos = ui.Panel();
DEF_PASOS.forEach(function (s) {
  chk[s.k] = ui.Checkbox({label: s.txt, value: true, onChange: function () { marcarSucio(); }, style: {fontWeight: 'bold', fontSize: '12px', margin: '6px 0 0 0'}});
  panelPasos.add(chk[s.k]);
  s.p.forEach(function (q) {
    caja[q[0]] = ui.Textbox({value: String(PARAM[q[0]]), onChange: function () { marcarSucio(); }, style: {width: '56px', margin: '0 4px 0 0'}});
    panelPasos.add(horizontal([ui.Label('', {width: '14px'}), caja[q[0]], ui.Label(q[1], {fontSize: '11px', margin: '8px 0 0 0'})]));
  });
});
var btnAplicar = ui.Button({label: 'Aplicar', style: {stretch: 'horizontal'}});

// 3) Ver
var selAño = ui.Select({items: AÑOS.map(String), value: String(AÑOS.indexOf(AÑO_VISTA_INICIAL) >= 0 ? AÑO_VISTA_INICIAL : AÑOS[0]), style: {width: '80px'}});
var btnAtras = ui.Button({label: '◀', style: {margin: '0 2px'}});
var btnAdelante = ui.Button({label: '▶', style: {margin: '0 2px'}});
var selEtapa = ui.Select({items: ETAPAS.map(function (e) { return {label: e.t, value: e.v}; }), value: 'c5', style: {stretch: 'horizontal'}});
var panelLeyenda = ui.Panel({style: {margin: '4px 0'}});

// 4) Región
var lblRoi = nota('');
var btnVista = ui.Button({label: 'Usar vista actual del mapa', style: {margin: '0 4px 0 0'}});
var btnEco = ui.Button({label: 'Ecorregión completa'});

// 5) Estadísticas
var selStat = ui.Select({items: [{label: 'Ha cambiadas por paso y año', value: 'pasos'}, {label: 'Ha por clase: entrada vs salida', value: 'clases'}],
  value: 'pasos', style: {stretch: 'horizontal'}});
var selEsc = ui.Select({items: ['30', '120', '240', '480'], value: '240', style: {width: '70px'}});
var btnStat = ui.Button({label: 'Calcular', style: {margin: '0 4px 0 0'}});
var panelStats = ui.Panel();

// 6) Exportar
var tbSalida = ui.Textbox({value: VERSION_SALIDA, style: {width: '110px', margin: '0 4px 0 0'}});
var chkSobre = ui.Checkbox({label: 'crear la tarea aunque el asset ya exista', value: SOBRESCRIBIR, style: {fontSize: '11px'}});
var btnExportar = ui.Button({label: 'Exportar ecorregión (o región de trabajo)', style: {stretch: 'horizontal'}});

// 7) Píxel
var panelPixel = ui.Panel();

panel.add(ui.Label('Pipeline de filtros · silvicultura', {fontWeight: 'bold', fontSize: '16px'}));
panel.add(nota('Etapa 1 (S1–S6) sobre las clasificaciones preliminares ya exportadas. Clic en el mapa = serie del píxel.'));
panel.add(titulo('1) Datos'));
panel.add(horizontal([ui.Label('Ecorregión', {margin: '8px 4px 0 0'}), selEco, ui.Label('Entrada', {margin: '8px 4px 0 8px'}), selVer]));
panel.add(titulo('2) Pasos y parámetros'));
panel.add(panelPasos);
panel.add(btnAplicar);
panel.add(estado);
panel.add(titulo('3) Ver'));
panel.add(horizontal([ui.Label('Año', {margin: '8px 4px 0 0'}), selAño, btnAtras, btnAdelante]));
panel.add(selEtapa);
panel.add(panelLeyenda);
panel.add(titulo('4) Región de trabajo (estadísticas y exportación)'));
panel.add(lblRoi);
panel.add(horizontal([btnVista, btnEco]));
panel.add(titulo('5) Estadísticas'));
panel.add(selStat);
panel.add(horizontal([ui.Label('Escala (m)', {margin: '8px 4px 0 0'}), selEsc, btnStat]));
panel.add(panelStats);
panel.add(titulo('6) Exportar'));
panel.add(horizontal([ui.Label('Versión de salida', {margin: '8px 4px 0 0'}), tbSalida]));
panel.add(chkSobre);
panel.add(btnExportar);
panel.add(titulo('7) Píxel (clic en el mapa)'));
panel.add(panelPixel);
ui.root.insert(0, panel);
Map.setOptions('HYBRID');

// ---- lectura de controles
function leerControles() {
  var P = {}, on = {}, err = null;
  DEF_PASOS.forEach(function (s) {
    on[s.k] = chk[s.k].getValue();
    s.p.forEach(function (q) {
      var txt = String(caja[q[0]].getValue() === null ? '' : caja[q[0]].getValue()).trim();
      var v = txt === '' ? NaN : Number(txt);
      if (!isFinite(v) || Math.round(v) !== v || v < q[2] || v > q[3]) err = err || ('«' + q[1] + '» debe ser un entero entre ' + q[2] + ' y ' + q[3] + '.');
      P[q[0]] = v;
    });
  });
  return {P: P, on: on, error: err};
}
function marcarSucio() {
  ESTADO.sucio = true;
  dice('Parámetros modificados: pulsa «Aplicar» para armar el pipeline con ellos.', '#E65100');
}

// ---- capas
function capaEtapa(id, k) {
  var p = ESTADO.pipe, y = AÑOS[k];
  if (id === 'c0' || id === 'c1' || id === 'c2' || id === 'c3' || id === 'c4' || id === 'c5') return {img: p[id][k], vis: VIS, tipo: 'clase', nombre: id};
  if (id === 'fin') return {img: s6Final(p.c5[k]), vis: VIS_FINAL, tipo: 'final'};
  if (id === 'dU') {
    var u = ee.Image(0);
    for (var b = 0; b < 5; b++) u = u.where(p.pasos[k].bitwiseAnd(1 << b).gt(0), b + 1);
    return {img: u.selfMask(), vis: {min: 1, max: 5, palette: COL_PASO}, tipo: 'pasos'};
  }
  if (id.charAt(0) === 'd') {
    var s = +id.charAt(1);
    return {img: p.pasos[k].bitwiseAnd(1 << s).gt(0).selfMask(), vis: {palette: [COL_PASO[s]]}, tipo: 'paso' + s};
  }
  if (id === 'fuego') {
    if (!sondearFuego()) return {img: null, aviso: 'MapBiomas Fuego no disponible: ' + FUEGO.error};
    var f = fuegoAño(y);
    if (!f) return {img: null, aviso: 'MapBiomas Fuego no tiene dato para ' + y + '.'};
    return {img: f.selfMask(), vis: {palette: [COL_FUEGO]}, tipo: 'fuego'};
  }
  return {img: null};
}
function filaLeyenda(color, texto) {
  return horizontal([ui.Label('', {backgroundColor: '#' + color, padding: '7px', margin: '2px 6px 2px 0', border: '1px solid #777'}),
    ui.Label(texto, {fontSize: '11px', margin: '3px 0'})]);
}
function leyenda(tipo) {
  panelLeyenda.clear();
  var i;
  if (tipo === 'clase') for (i = 1; i <= 4; i++) panelLeyenda.add(filaLeyenda(COL_CLASE[i], i + ' · ' + NOM_CLASE[i]));
  else if (tipo === 'final') { panelLeyenda.add(filaLeyenda(COL_CLASE[1], '79 · Pino')); panelLeyenda.add(filaLeyenda(COL_CLASE[2], '80 · Eucalipto')); panelLeyenda.add(filaLeyenda(COL_CLASE[4], '83 · Cosechado')); }
  else if (tipo === 'pasos') for (i = 0; i < 5; i++) panelLeyenda.add(filaLeyenda(COL_PASO[i], NOM_PASO[i]));
  else if (tipo && tipo.indexOf('paso') === 0) { i = +tipo.charAt(4); panelLeyenda.add(filaLeyenda(COL_PASO[i], 'píxeles que cambió ' + NOM_PASO[i])); }
  else if (tipo === 'fuego') panelLeyenda.add(filaLeyenda(COL_FUEGO, 'quemado ese año'));
}

function mostrar() {
  var p = ESTADO.pipe;
  if (!p) return;
  var k = AÑOS.indexOf(ESTADO.año);
  var capa = capaEtapa(ESTADO.etapa, k);
  var pref = 'E' + p.eco + ' · ' + ESTADO.año + ' · ';
  Map.layers().reset();
  if (ESTADO.roi) Map.addLayer(ee.FeatureCollection([ee.Feature(ESTADO.roi)]).style({color: 'FFFFFF', fillColor: '00000000', width: 2}), {}, 'Región de trabajo', true);
  Map.addLayer(p.c0[k], VIS, pref + 'entrada ' + p.ver, ESTADO.etapa === 'c0');
  if (capa.img) {
    if (ESTADO.etapa !== 'c0') {
      var et = ETAPAS.filter(function (e) { return e.v === ESTADO.etapa; })[0];
      Map.addLayer(capa.img, capa.vis, pref + (et ? et.t : ESTADO.etapa), true);
    }
    leyenda(capa.tipo);
  } else {
    panelLeyenda.clear();
    if (capa.aviso) dice(capa.aviso, '#C62828');
  }
  if (ESTADO.punto) Map.addLayer(ESTADO.punto, {color: 'FF00FF'}, 'Píxel inspeccionado', true);
}

// ---- aplicar
function aplicar() {
  var l = leerControles();
  if (l.error) { dice(l.error, '#C62828'); return; }
  var eco = +selEco.getValue(), ver = selVer.getValue();
  if (!ver) { dice('No hay versiones de entrada para E' + eco + '.' + (ERROR_CARPETA ? '\n' + ERROR_CARPETA : ''), '#C62828'); return; }
  dice('Armando el pipeline…', '#555');
  var p = construirPipeline(eco, ver, l.P, l.on);
  if (p.error) { ESTADO.pipe = null; Map.layers().reset(); dice(p.error, '#C62828'); return; }
  var cambioEco = ESTADO.eco !== eco;
  ESTADO.eco = eco; ESTADO.ver = ver; ESTADO.pipe = p; ESTADO.sucio = false;
  if (cambioEco) {
    ESTADO.roi = null; ESTADO.punto = null;
    panelStats.clear(); panelPixel.clear();
    Map.centerObject(regionEco(), 8);
  }
  lblRoi.setValue(ESTADO.roi ? 'Región de trabajo: vista del mapa guardada (recuadro blanco).' : 'Región de trabajo: ecorregión completa (E' + eco + ').');
  mostrar();
  var act = DEF_PASOS.filter(function (s) { return l.on[s.k] && !(s.k === 's2' && !p.fuegoOk); }).map(function (s) { return s.k.toUpperCase(); });
  dice('Listo · E' + eco + ' · ' + ver + ' · pasos activos: ' + (act.join(' ') || 'ninguno') + (p.avisos.length ? '\n' + p.avisos.join('\n') : '') +
    '\nLas capas se calculan al mirar el mapa (la cadena usa los 31 años: acércate para que cargue rápido).', p.avisos.length ? '#E65100' : '#2E7D32');
}

// ---- eventos de navegación
function irAño(y) {
  if (y < AÑO_INI || y > AÑO_FIN) return;
  ESTADO.año = y; selAño.setValue(String(y), false); mostrar();
}
selEco.onChange(function () { llenarVersiones(null); aplicar(); });
selVer.onChange(function () { if (!SUPRIMIR) aplicar(); });
selAño.onChange(function (v) { ESTADO.año = +v; mostrar(); });
selEtapa.onChange(function (v) { ESTADO.etapa = v; mostrar(); });
btnAtras.onClick(function () { irAño(ESTADO.año - 1); });
btnAdelante.onClick(function () { irAño(ESTADO.año + 1); });
btnAplicar.onClick(aplicar);

btnVista.onClick(function () {
  if (!ESTADO.pipe) { dice('Primero aplica el pipeline.', '#C62828'); return; }
  var b = Map.getBounds();
  ESTADO.roi = ee.Geometry.Rectangle([b[0], b[1], b[2], b[3]]);
  lblRoi.setValue('Región de trabajo: vista del mapa guardada (recuadro blanco).');
  mostrar();
});
btnEco.onClick(function () {
  if (!ESTADO.pipe) return;
  ESTADO.roi = null;
  lblRoi.setValue('Región de trabajo: ecorregión completa (E' + ESTADO.eco + ').');
  mostrar();
});

// ---- estadísticas
function tablaChart(rows, xkey, props) {
  return {
    cols: [{id: 'x', label: xkey, type: 'string'}].concat(props.map(function (p, i) { return {id: 's' + i, label: p, type: 'number'}; })),
    rows: rows.map(function (r) {
      return {c: [{v: String(r[xkey])}].concat(props.map(function (p) {
        return {v: (r[p] === undefined || r[p] === null || isNaN(r[p])) ? null : Number(r[p])};
      }))};
    })
  };
}
btnStat.onClick(function () {
  var p = ESTADO.pipe;
  if (!p) { dice('Primero aplica el pipeline.', '#C62828'); return; }
  if (ESTADO.ocupado) return;
  var tipo = selStat.getValue(), esc = +selEsc.getValue();
  var area = ee.Image.pixelArea().divide(10000), bandas = [];
  AÑOS.forEach(function (y, k) {
    if (tipo === 'pasos') {
      for (var b = 0; b < 5; b++) bandas.push(area.multiply(p.pasos[k].bitwiseAnd(1 << b).gt(0)).rename('s' + y + '_' + b));
    } else {
      [1, 2, 4].forEach(function (cl) {
        bandas.push(area.multiply(p.c0[k].eq(cl)).rename('e' + y + '_' + cl));
        bandas.push(area.multiply(p.c5[k].eq(cl)).rename('f' + y + '_' + cl));
      });
    }
  });
  ESTADO.ocupado = true; btnStat.setDisabled(true);
  dice('Calculando estadísticas (' + esc + ' m) sobre ' + (ESTADO.roi ? 'la región de trabajo' : 'la ecorregión completa') + '… con la ecorregión completa puede demorar o dar «too expensive»; en ese caso usa «Usar vista actual» o sube la escala.', '#555');
  ee.Image.cat(bandas).reduceRegion({reducer: ee.Reducer.sum(), geometry: regionTrabajo(), scale: esc, maxPixels: 1e13, tileScale: 8})
    .evaluate(function (d, err) {
      ESTADO.ocupado = false; btnStat.setDisabled(false);
      if (err || !d) { dice('Falló el cálculo: ' + String(err || 'sin resultado').slice(0, 200) + '\nReduce la región o sube la escala.', '#C62828'); return; }
      panelStats.clear();
      var rows = [], lineas = [];
      if (tipo === 'pasos') {
        AÑOS.forEach(function (y) {
          var r = {'año': y}, fila = [];
          for (var b = 0; b < 5; b++) { r[NOM_PASO[b]] = d['s' + y + '_' + b] || 0; fila.push(Math.round(r[NOM_PASO[b]])); }
          rows.push(r); lineas.push(y + ' · ' + fila.join(' · '));
        });
        panelStats.add(ui.Chart(tablaChart(rows, 'año', NOM_PASO), 'ColumnChart', {
          title: 'E' + p.eco + ' · ha cambiadas por cada paso (' + esc + ' m)', isStacked: true, colors: COL_PASO.map(function (c) { return '#' + c; }),
          legend: {position: 'bottom', textStyle: {fontSize: 10}}, vAxis: {title: 'ha', format: 'short'},
          hAxis: {slantedText: true, slantedTextAngle: 60, textStyle: {fontSize: 9}}, chartArea: {left: 60, right: 10, top: 30, bottom: 80}, height: 260, bar: {groupWidth: '85%'}
        }));
        print('E' + p.eco + ' · ha cambiadas por paso (' + esc + ' m) · año · S1 · S2 · S3 · S4 · S5');
      } else {
        var props = ['Pino entrada', 'Pino salida', 'Euca entrada', 'Euca salida', 'Cosechado entrada', 'Cosechado salida'];
        AÑOS.forEach(function (y) {
          var r = {'año': y};
          r[props[0]] = d['e' + y + '_1'] || 0; r[props[1]] = d['f' + y + '_1'] || 0;
          r[props[2]] = d['e' + y + '_2'] || 0; r[props[3]] = d['f' + y + '_2'] || 0;
          r[props[4]] = d['e' + y + '_4'] || 0; r[props[5]] = d['f' + y + '_4'] || 0;
          rows.push(r); lineas.push(y + ' · ' + props.map(function (q) { return Math.round(r[q]); }).join(' · '));
        });
        var colores = ['#1B5E20', '#1B5E20', '#C0CA33', '#C0CA33', '#8D6E63', '#8D6E63'], series = {};
        props.forEach(function (q, i) { series[i] = {color: colores[i], lineWidth: 2, pointSize: 2}; if (i % 2 === 0) series[i].lineDashStyle = [4, 3]; });
        panelStats.add(ui.Chart(tablaChart(rows, 'año', props), 'LineChart', {
          title: 'E' + p.eco + ' · ha por clase (punteado = entrada, continuo = salida · ' + esc + ' m)', series: series,
          legend: {position: 'bottom', textStyle: {fontSize: 10}}, vAxis: {title: 'ha', viewWindow: {min: 0}, format: 'short'},
          hAxis: {slantedText: true, slantedTextAngle: 60, textStyle: {fontSize: 9}}, chartArea: {left: 60, right: 10, top: 30, bottom: 80}, height: 280
        }));
        print('E' + p.eco + ' · ha por clase (' + esc + ' m) · año · ' + props.join(' · '));
      }
      lineas.forEach(function (l) { print(l); });
      dice('Estadísticas listas (' + (ESTADO.roi ? 'región de trabajo' : 'ecorregión completa') + ' · ' + esc + ' m). La tabla numérica está en la consola.', '#2E7D32');
    });
});

// ---- exportar
btnExportar.onClick(function () {
  var p = ESTADO.pipe;
  if (!p) { dice('Primero aplica el pipeline.', '#C62828'); return; }
  if (ESTADO.sucio) { dice('Hay parámetros sin aplicar: pulsa «Aplicar» antes de exportar.', '#C62828'); return; }
  var sal = String(tbSalida.getValue() || '').trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(sal)) { dice('La versión de salida solo admite letras, números, _ y -.', '#C62828'); return; }
  var nombre = 'silvo_filtrado_e' + p.eco + '_' + sal + (ESTADO.roi ? '_prueba' : '');
  var id = CARPETA + '/' + nombre;
  if (!chkSobre.getValue() && EXISTENTES[id] === true) { dice('Ya existe, no se exporta: ' + nombre + '\n(marca la casilla para crear la tarea igual; antes hay que borrar el asset).', '#E65100'); return; }
  try {
    Export.image.toAsset({
      image: p.imagen.set({
        eco: p.eco, version: sal, version_entrada: p.ver, buffer_km: BUFFER_KM, año_ini: AÑO_INI, año_fin: AÑO_FIN,
        s1: p.on.s1 ? 1 : 0, s2: p.on.s2 && p.fuegoOk ? 1 : 0, s3: p.on.s3 ? 1 : 0, s4: p.on.s4 ? 1 : 0, s5: p.on.s5 ? 1 : 0,
        relleno_max: p.P.rellenoMaxAños, fuego_desfase: p.P.fuegoDesfase, fuego_atras_max: p.P.fuegoAtrasMax,
        area_min_px: p.P.areaMinPx, corte_otras: p.P.corteOtras, ventana_post: p.P.ventanaPost, ultimo_año_confiable: p.P.ultimoAñoConfiable,
        max_tramos: p.P.maxTramos, duracion_minima: p.P.duracionMinima, cosecha_implicita: p.P.cosechaImplicita, especie_min_px: p.P.especieMinPx
      }),
      description: nombre, assetId: id, region: regionTrabajo(), scale: ESCALA_EXPORT, maxPixels: 1e13,
      pyramidingPolicy: {'.default': 'mode'}
    });
    EXISTENTES[id] = true;
    dice('Tarea creada: ' + nombre + '\nRevisa la pestaña Tasks y pulsa Run (si no aparece, avísame: algunas versiones del editor no crean tareas desde botones).', '#2E7D32');
    print('Tarea de exportación creada: ' + nombre);
  } catch (e) { dice('No se pudo crear la tarea: ' + (e.message || e), '#C62828'); }
});

// ---- píxel
function celda(txt, ancho, bg, fg, negrita) {
  return ui.Label(txt, {width: ancho + 'px', margin: '0', padding: '1px 0', fontSize: '10px', textAlign: 'center', backgroundColor: bg || '#FFFFFF',
    color: fg || '#222', fontWeight: negrita ? 'bold' : 'normal', fontFamily: 'monospace'});
}
Map.onClick(function (c) {
  var p = ESTADO.pipe;
  if (!p) return;
  ESTADO.punto = ee.Geometry.Point([c.lon, c.lat]);
  mostrar();
  panelPixel.clear();
  panelPixel.add(nota('Consultando el píxel (' + c.lon.toFixed(5) + ', ' + c.lat.toFixed(5) + ')…'));
  var etapas = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], bandas = [];
  AÑOS.forEach(function (y, k) {
    etapas.forEach(function (e) { bandas.push(p[e][k].unmask(0).toByte().rename(e + '_' + y)); });
    bandas.push(p.pasos[k].rename('p_' + y));
  });
  ee.Image.cat(bandas).reduceRegion({reducer: ee.Reducer.first(), geometry: ESTADO.punto, scale: 30, maxPixels: 1e9, tileScale: 4})
    .evaluate(function (d, err) {
      panelPixel.clear();
      if (err || !d) { panelPixel.add(nota('Sin resultado: ' + String(err || '').slice(0, 150), '#C62828')); return; }
      panelPixel.add(nota('Píxel ' + c.lon.toFixed(5) + ', ' + c.lat.toFixed(5) + ' · P pino · E euca · O otras · C cosechado · · sin dato'));
      var cab = [celda('Año', 36, '#EEE', '#222', true)];
      ['Ent', 'S1', 'S2', 'S3', 'S4', 'S5'].forEach(function (t) { cab.push(celda(t, 30, '#EEE', '#222', true)); });
      cab.push(celda('Pasos', 90, '#EEE', '#222', true));
      panelPixel.add(horizontal(cab));
      AÑOS.forEach(function (y) {
        var fila = [celda(String(y), 36, y === ESTADO.año ? '#FFF59D' : '#FFF')];
        etapas.forEach(function (e) {
          var v = d[e + '_' + y] || 0;
          fila.push(celda(LETRA[v], 30, v ? '#' + COL_CLASE[v] : '#FFF', (v === 1 || v === 4) ? '#FFF' : '#222'));
        });
        var pv = d['p_' + y] || 0, ps = [];
        for (var b = 0; b < 5; b++) if (pv & (1 << b)) ps.push('S' + (b + 1));
        fila.push(celda(ps.join(' '), 90, '#FFF', '#C62828', true));
        panelPixel.add(horizontal(fila));
      });
    });
});

// ---- inicio
if (PARAM.areaMinPx > 256 || PARAM.especieMinPx > 256) print('OJO: areaMinPx y especieMinPx no deben pasar de 256 (límite de connectedPixelCount).');
if (ERROR_CARPETA) dice(ERROR_CARPETA, '#C62828');
else aplicar();
