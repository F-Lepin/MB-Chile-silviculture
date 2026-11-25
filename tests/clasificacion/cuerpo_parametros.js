(function () {
  var T = function (c, m) { console.log((c ? 'ok    ' : 'FALLA ') + m); };
  if (process.env.CHILD) {
    // --- Escenario 2: abrir con #cfg en la URL ---
    T(ecoSelect.getValue() === '9' && cPino.box.getValue() === '1234', 'URL al abrir: ecorregión y puntos de pino aplicados');
    T(guiaCol2Check.getValue() === false && versionBox.getValue() === 'v9', 'URL al abrir: casilla y versión aplicadas');
    T(añosSeleccionados().join(',') === '2005,2006', 'URL al abrir: años 2005 y 2006');
    T(cEuca.box.getValue() === String(DEF.euca), 'lo que la URL no trae queda con el valor inicial');
    return;
  }
  // --- Escenario 1: sin parámetros en la URL ---
  T(Object.keys(parametrosCambiados()).length === 0, 'al abrir sin parámetros no hay cambios respecto a los iniciales');
  T(!__url.cfg, 'la URL no se ensucia al abrir');
  ecoSelect.setValue('10'); cPino.box.setValue('777'); consensoCheck.setValue(true);
  yearSel[2010] = true; guardarEnUrl();
  var d = parametrosCambiados();
  T(d.eco === '10' && d.pino === '777' && d.consenso === true && /2010/.test(d.anios), 'parametrosCambiados trae solo lo modificado');
  T(!('arboles' in d) && !('carpeta' in d), 'no incluye los valores que no cambiaron');
  T(typeof __url.cfg === 'string' && JSON.parse(__url.cfg).pino === '777', 'guardarEnUrl escribe #cfg como texto JSON');
  // --- ida y vuelta por texto ---
  var guardado = parametrosATexto();
  ecoSelect.setValue('8'); cPino.box.setValue('1'); consensoCheck.setValue(false); yearSel[2010] = false;
  var r = aplicarParametros(textoAParametros(guardado));
  T(ecoSelect.getValue() === '10' && cPino.box.getValue() === '777' && consensoCheck.getValue() === true && yearSel[2010] === true, 'ida y vuelta por JSON restaura los controles');
  T(r.n > 0 && r.ignorados.length === 0, 'aplicarParametros cuenta los cargados y no ignora nada');
  // --- línea para pegar en el script ---
  var linea = "var CONFIG_INICIAL = '" + guardado.replace(/'/g, "\\'") + "';";
  ecoSelect.setValue('8');
  aplicarParametros(textoAParametros(linea));
  T(ecoSelect.getValue() === '10', 'se acepta la línea completa var CONFIG_INICIAL = \'...\';');
  var conComilla = textoAParametros("var CONFIG_INICIAL = '{\"carpeta\":\"users/o\\'brien/x\"}';");
  T(conComilla.carpeta === "users/o'brien/x", 'comillas simples escapadas se recuperan');
  // --- entradas inválidas ---
  var malos = 0;
  ['{no json', '[1,2]', '42', 'null'].forEach(function (t) { try { textoAParametros(t); } catch (e) { malos++; } });
  T(malos === 4, 'texto no válido se rechaza (JSON roto, lista, número, null)');
  T(Object.keys(textoAParametros('')).length === 0, 'texto vacío = sin parámetros');
  var r2 = aplicarParametros({pino: 5, guiaCol2: 'si', desconocido: 'x'});
  T(r2.ignorados.indexOf('pino') >= 0 && r2.ignorados.indexOf('guiaCol2') >= 0, 'tipos incorrectos se ignoran sin romper');
  T(cPino.box.getValue() === '777', 'un valor de tipo incorrecto no se aplica');
  // --- años y leerConfig ---
  aplicarParametros({anios: '1996,2000'});
  T(añosSeleccionados().join(',') === '1996,2000', 'los años se restauran');
  ecoSelect.setValue('8'); aplicarParametros({eco: '9', pino: '555', bufferKm: '2'});
  var cfg = leerConfig();
  T(cfg.eco === 9 && cfg.pino === 555 && cfg.bufferKm === 2, 'leerConfig usa los parámetros cargados');
})();
