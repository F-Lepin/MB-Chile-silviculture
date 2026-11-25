// Corre los tests con simulaciones (mocks) de la API de Earth Engine y de los widgets de la interfaz.
// NO usan Earth Engine real: comprueban la lógica de cada script, no los assets ni los resultados.
// Uso: node scripts/run_tests.js
const fs = require('fs'), path = require('path'), {spawnSync} = require('child_process');
const raiz = path.join(__dirname, '..');
const tests = [
  'tests/filtros/test_pipeline.js',        // pasos S1–S6 del pipeline (núcleo + casos límite)
  'tests/filtros/smoke_ui_pipeline.js',    // interfaz del pipeline de filtros
  'tests/clasificacion/test_buffer.js',   // buffer de la ecorregión en el clasificador
  'tests/clasificacion/test_particion.js', // exportación de la partición train/test
  'tests/revision/test_fuente.js',         // selector de fuente (pre-integración / reglas / HMM)
  'tests/revision/test_nombres.js',        // lectura de nombres de assets de integración
  'tests/revision/test_b1.js',             // bandas b1…bN = 1996…
  'tests/revision/exploratorios/test_int2.js',   // ejecuta sin error (solo imprime)
  'tests/revision/exploratorios/mock_reg12.js'   // ejecuta sin error (solo imprime)
];
let malos = 0;
tests.forEach(t => {
  const r = spawnSync(process.execPath, [path.join(raiz, t)], {encoding: 'utf8', timeout: 120000});
  const salida = (r.stdout || '') + (r.stderr || '');
  const falla = r.status !== 0 || /\b(FALLA|FAIL)\b/.test(salida);
  if (falla) { malos++; console.log('✗ ' + t + '\n' + salida.split('\n').filter(l => /FALLA|FAIL|Error/.test(l)).slice(0, 8).join('\n')); }
  else console.log('✓ ' + t);
});
console.log(malos ? '\n' + malos + ' de ' + tests.length + ' con fallas' : '\nTodos los tests pasan (' + tests.length + ')');
process.exit(malos ? 1 : 0);
