(function () {
  var T = function (c, m) { console.log((c ? 'ok    ' : 'FALLA ') + m); };
  var reg = [];
  function R(name) {
    return new Proxy(function () {}, {
      get: function (t, k) { if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return function () { return 0; }; return R(name + '.' + String(k)); },
      apply: function (t, th, args) { reg.push({n: name, args: args}); return R(name + '()'); }
    });
  }
  // --- tablaParticion: columnas livianas con ignoreMissing y propiedades del split ---
  var eeOrig = ee; ee = R('ee');
  try {
    var sub = {cfg: {eco: 8, ecosEnt: [8], verEnt: 'v1', modo: 'ESPECIE', ini: 1996, fin: 2012, fracTest: 0.3, pino: 1400, euca: 1400, otras: 4000, agro: 2000, cosecha: 1500},
               train: R('train'), test: R('test')};
    reg = []; tablaParticion(sub, false, 'v1');
    // la simulación no ejecuta las funciones de .map: se llama a la que recorta columnas con un feature falso
    var fns = reg.filter(function (x) { return /\.map$/.test(x.n) && typeof x.args[0] === 'function'; });
    var recorta = fns.filter(function (x) { var antes = reg.length; x.args[0](R('feat')); return reg.slice(antes).some(function (y) { return /\.select$/.test(y.n); }); });
    T(recorta.length === 1, 'sin predictores: una de las funciones de .map recorta columnas');
    var sel = reg.filter(function (x) { return /\.select$/.test(x.n); });
    T(sel.length > 0 && sel.some(function (x) { return x.args[1] === true && Array.isArray(x.args[0]) && x.args[0].indexOf('conjunto') >= 0; }),
      'sin predictores: selecciona las columnas livianas con ignoreMissing = true');
    var setc = reg.filter(function (x) { return /\.set$/.test(x.n) && x.args[0] && typeof x.args[0] === 'object' && x.args[0].frac_test !== undefined; });
    T(setc.length === 1 && setc[0].args[0].frac_test === 0.3 && setc[0].args[0].pino_train === 1400 && setc[0].args[0].periodo === '1996-2012' && setc[0].args[0].con_predictores === 0,
      'propiedades del asset: frac_test, puntos por clase, periodo y con_predictores = 0');
    reg = []; tablaParticion(sub, true, 'v1');
    T(!reg.some(function (x) { return /\.select$/.test(x.n); }), 'con predictores: no recorta columnas');
    T(reg.some(function (x) { return /\.set$/.test(x.n) && x.args[0] && x.args[0].con_predictores === 1; }), 'con predictores: con_predictores = 1');
    T(reg.some(function (x) { return /\.merge$/.test(x.n); }), 'une train y test en una sola tabla');
  } catch (e) { console.log('FALLA excepción en tablaParticion: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  ee = eeOrig;
  // --- botón: una tarea por modelo, nombres y omisión de existentes ---
  var tareas = [], existentes = {};
  var ExportOrig = Export, existeOrig = existe, tablaOrig = tablaParticion;
  Export = {table: {toAsset: function (o) { tareas.push(o); }}};
  existe = function (id) { return !!existentes[id]; };
  tablaParticion = function () { return {}; };
  try {
    var mk = function (ini, fin) { return {cfg: {ini: ini, fin: fin}}; };
    MODELO = {cfg: {ecosEnt: [8], ini: 1996, fin: 2026}, partes: [mk(1996, 2012), mk(2013, 2026)]};
    btnParticion.clk();
    T(tareas.length === 2 && tareas[0].description === 'split_e8_1996-2012_v1' && tareas[1].description === 'split_e8_2013-2026_v1',
      'modelo por periodo: dos tareas split_e8_1996-2012_v1 y split_e8_2013-2026_v1');
    T(tareas.every(function (o) { return o.assetId === CARPETA_MAESTRA + '/' + o.description; }), 'se exportan en la carpeta de las maestras');
    tareas = []; existentes[CARPETA_MAESTRA + '/split_e8_1996-2012_v1'] = true;
    btnParticion.clk();
    T(tareas.length === 1 && tareas[0].description === 'split_e8_2013-2026_v1', 'omite el asset que ya existe');
    tareas = []; existentes = {};
    MODELO = {cfg: {ecosEnt: [8, 9], ini: 2013, fin: 2026}};
    btnParticion.clk();
    T(tareas.length === 1 && tareas[0].description === 'split_e8-9_2013-2026_v1', 'modelo único con dos ecorregiones de entrenamiento: split_e8-9_2013-2026_v1');
    tareas = []; MODELO = null; btnParticion.clk();
    T(tareas.length === 0, 'sin modelo aplicado no exporta nada');
  } catch (e) { console.log('FALLA excepción en el botón: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  Export = ExportOrig; existe = existeOrig; tablaParticion = tablaOrig;
})();
