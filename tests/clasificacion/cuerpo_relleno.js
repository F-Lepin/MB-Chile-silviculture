(function () {
  var T = function (c, m) { console.log((c ? 'ok    ' : 'FALLA ') + m); };
  var reg = [];
  function R(name) {
    return new Proxy(function () {}, {
      get: function (t, k) { if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return function () { return 0; }; return R(name + '.' + String(k)); },
      apply: function (t, th, args) { reg.push({n: name, args: args}); return R(name + '()'); }
    });
  }
  var eeOrig = ee, imgOrig = imagenExport;
  // --- orden y rango de los años vecinos ---
  var pedidos = [];
  imagenExport = function (m, eco, y, conProb) { pedidos.push(y); return R('img' + y); };
  ee = R('ee');
  try {
    var orden = function (y, d, p) { pedidos = []; reg = []; imagenExportRellena({}, 8, y, true, d, p); return pedidos.join(','); };
    T(orden(2000, 3, 'ANTERIOR') === '2000,1999,2001,1998,2002,1997,2003', 'ANTERIOR, 3 años: 2000, luego 1999, 2001, 1998, 2002, 1997, 2003');
    T(orden(2000, 3, 'SIGUIENTE') === '2000,2001,1999,2002,1998,2003,1997', 'SIGUIENTE: a igual distancia primero el posterior');
    T(orden(1996, 3, 'ANTERIOR') === '1996,1997,1998,1999', '1996 solo se rellena con años posteriores');
    T(orden(2026, 3, 'ANTERIOR') === '2026,2025,2024,2023', '2026 solo se rellena con años anteriores');
    T(orden(2000, 1, 'ANTERIOR') === '2000,1999,2001', 'distancia 1: solo los dos vecinos inmediatos');
    pedidos = []; reg = []; imagenExportRellena({}, 8, 2000, true, 2, 'ANTERIOR');
    var un = reg.filter(function (x) { return /\.unmask$/.test(x.n); });
    T(un.length === 4 && un.every(function (x) { return x.args[1] === false; }), 'una llamada unmask por año vecino, con sameFootprint = false');
    T(reg.some(function (x) { return /\.toInt16$/.test(x.n); }) && reg.some(function (x) { return /\.toByte$/.test(x.n); }), 'clase y probabilidades en byte, anio_origen en Int16');
  } catch (e) { console.log('FALLA excepción en imagenExportRellena: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  ee = eeOrig; imagenExport = imgOrig;
  // --- leerRelleno ---
  T(rellenoCheck.getValue() === true && leerRelleno().maxD === 3 && leerRelleno().prior === 'ANTERIOR', 'por defecto: relleno activo, 3 años, ANTERIOR');
  cRellenoDist.box.setValue('50'); T(leerRelleno().maxD === 10, 'la distancia se limita a 10 años');
  var malos = 0; ['0', '-2', 'abc', ''].forEach(function (v) { cRellenoDist.box.setValue(v); try { leerRelleno(); } catch (e) { malos++; } });
  T(malos === 4, 'distancia 0, negativa, texto o vacía se rechaza');
  cRellenoDist.box.setValue('3'); rellenoCheck.setValue(false);
  T(leerRelleno().on === false && leerRelleno().maxD === 0, 'desmarcado: relleno apagado (distancia 0)');
  rellenoCheck.setValue(true);
  // --- difParametros ---
  var cfg0 = {arboles: 40, radio: 3, areaMin: 22, umbralDentro: 0.4, umbralFuera: 0.85, consenso: false, dividir: true, ecosEnt: ['8'], bufferKm: 0};
  T(difParametros({buffer_km: 0}, cfg0).some(function (x) { return /relleno/.test(x); }), 'difParametros: asset sin relleno vs relleno de 3 años se marca');
  T(!difParametros({buffer_km: 0, relleno_max_dist: 3}, cfg0).some(function (x) { return /relleno/.test(x); }), 'difParametros: relleno igual no se marca');
  // --- botón de exportar ---
  var tareas = [], llamadas = [];
  var ExportOrig = Export, existeOrig = existe, rellOrig = imagenExportRellena;
  var props = function (a) { return {set: function (o) { a.props = o; return a; }}; };
  Export = {image: {toAsset: function (o) { tareas.push(o); }}};
  existe = function () { return false; };
  imagenExportRellena = function (m, eco, y, p, d, pr) { llamadas.push([y, d, pr]); return props({}); };
  imagenExport = function (m, eco, y) { llamadas.push([y, 0, 'sin']); return props({}); };
  try {
    MODELO = {cfg: {eco: 8, ecosEnt: [8], años: [2017, 2018], bufferKm: 5, ini: 1996, fin: 2026, arboles: 40, modo: 'ESPECIE', verEnt: 'v1', dividir: true,
                    radio: 3, consenso: false, areaMin: 22, guiaCol2: true, umbralDentro: 0.4, umbralFuera: 0.85}};
    btnExportar.clk();
    T(tareas.length === 2 && llamadas.length === 2 && llamadas.every(function (x) { return x[1] === 3 && x[2] === 'ANTERIOR'; }), 'exportar con relleno: usa imagenExportRellena (3 años, ANTERIOR)');
    T(tareas.every(function (t) { return t.image.props.relleno === 1 && t.image.props.relleno_max_dist === 3; }), 'propiedades relleno = 1 y relleno_max_dist = 3');
    T(tareas.every(function (t) { return t.pyramidingPolicy.anio_origen === 'mode'; }), 'pirámide de anio_origen = mode');
    tareas = []; llamadas = []; rellenoCheck.setValue(false);
    btnExportar.clk();
    T(tareas.length === 2 && llamadas.every(function (x) { return x[2] === 'sin'; }) && tareas.every(function (t) { return t.image.props.relleno === 0; }), 'exportar sin relleno: usa imagenExport y relleno = 0');
  } catch (e) { console.log('FALLA excepción en el botón: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  rellenoCheck.setValue(true);
  Export = ExportOrig; existe = existeOrig; imagenExportRellena = rellOrig; imagenExport = imgOrig;
})();
