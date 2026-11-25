(function () {
  var T = function (c, m) { console.log((c ? 'ok    ' : 'FALLA ') + m); };
  // --- registro de llamadas: ee simulado que anota los métodos usados sobre geometrías e imágenes ---
  var reg = [];
  function R(name) {
    return new Proxy(function () {}, {
      get: function (t, k) { if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return function () { return 0; }; return R(name + '.' + String(k)); },
      apply: function (t, th, args) { reg.push(name + '(' + args.map(function (a) { return typeof a === 'number' ? a : (typeof a === 'string' ? JSON.stringify(a) : typeof a); }).join(',') + ')'); return R(name + '()'); }
    });
  }
  var eeOrig = ee;
  ee = R('ee');
  try {
    reg = []; mascaraEco(8, 0);
    T(!reg.some(function (x) { return /buffer|paint/.test(x); }), 'bufferKm = 0: máscara solo con el raster (sin buffer ni paint)');
    reg = []; mascaraEco(8, 5);
    T(reg.some(function (x) { return /\.buffer\(5000,100\)/.test(x); }), 'bufferKm = 5: buffer geodésico de 5000 m (maxError 100 m)');
    T(reg.some(function (x) { return /paint/.test(x); }), 'bufferKm = 5: franja pintada como imagen');
    reg = []; regionEco(8, 0);
    T(!reg.some(function (x) { return /buffer/.test(x); }), 'regionEco sin buffer: solo bounds');
    reg = []; regionEco(8, 5);
    T(reg.some(function (x) { return /\.buffer\(5000\)/.test(x); }), 'regionEco con buffer: rectángulo ampliado 5000 m');
    reg = []; regionEco(8);
    T(!reg.some(function (x) { return /buffer/.test(x); }), 'regionEco sin argumento = sin buffer');
    reg = []; mascaraEco(8);
    T(!reg.some(function (x) { return /buffer/.test(x); }), 'mascaraEco sin argumento = sin buffer');
  } catch (e) { console.log('FALLA excepción en mascaraEco/regionEco: ' + e.message); }
  ee = eeOrig;
  // --- parseo y configuración ---
  T(parseKm('5', 'B') === 5 && parseKm('0', 'B') === 0 && parseKm('2,5', 'B') === 2.5, 'parseKm acepta 5, 0 y 2,5');
  var malos = 0; ['-1', '51', 'abc', ''].forEach(function (v) { try { parseKm(v, 'B'); } catch (e) { malos++; } });
  T(malos === 4, 'parseKm rechaza -1, 51, texto y vacío');
  T(DEF.bufferKm === 5 && cBuffer.box.getValue() === '5', 'valor por defecto 5 km en DEF y en el campo');
  // difParametros: assets sin la propiedad se tratan como sin buffer
  var cfg0 = {arboles: 40, radio: 3, areaMin: 22, umbralDentro: 0.4, umbralFuera: 0.85, consenso: false, dividir: true, ecosEnt: ['8'], bufferKm: 5};
  var d1 = difParametros({}, cfg0);
  T(d1.some(function (x) { return /buffer/.test(x); }), 'difParametros: asset antiguo (sin buffer_km) vs 5 km se marca como distinto');
  var d2 = difParametros({buffer_km: 5}, cfg0);
  T(!d2.some(function (x) { return /buffer/.test(x); }), 'difParametros: buffer_km igual no se marca');
  // --- el buffer llega a la clasificación y a las probabilidades ---
  function Any(n) { return new Proxy(function () {}, {get: function (t, k) { return k === 'then' ? undefined : Any(n + '.' + String(k)); }, apply: function () { return Any(n + '()'); }}); }
  var usos = [], mascaraOrig = mascaraEco;
  mascaraEco = function (eco, km) { usos.push(km); return mascaraOrig(eco, km); };
  try {
    var cfgM = {bufferKm: 5, guiaCol2: false, areaMin: 0, radio: 0, consenso: false, años: [2020], modo: 'ESPECIE', dividir: false};
    var modelo = {cfg: cfgM, rf: Any('rf'), rfEspecie: Any('rfe'), rfProb: Any('rfp'), rfEspecieProb: Any('rfep')};
    usos = []; clasificarAñoModelo(modelo, 8, 2020);
    T(usos.length > 0 && usos.every(function (k) { return k === 5; }), 'clasificarAñoModelo usa la máscara con buffer de 5 km');
    usos = []; bandasProbAño(modelo, 8, 2020, Any('clase'));
    T(usos.length > 0 && usos.every(function (k) { return k === 5; }), 'bandasProbAño usa la máscara con buffer de 5 km');
    cfgM.bufferKm = 0; usos = []; clasificarAñoModelo(modelo, 8, 2020);
    T(usos.length > 0 && usos.every(function (k) { return k === 0; }), 'con 0 km la clasificación usa la máscara sin buffer');
  } catch (e) { console.log('FALLA excepción en clasificación con buffer: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  mascaraEco = mascaraOrig;
})();
