// Revisa la sintaxis (node --check) de todos los .js de scripts de GEE y de tests.
// Uso: node scripts/check_syntax.js
const fs = require('fs'), path = require('path'), {spawnSync} = require('child_process');
const raiz = path.join(__dirname, '..');
const omitir = new Set(['node_modules', '.git']);
let n = 0, malos = 0;
(function recorrer(dir) {
  fs.readdirSync(dir, {withFileTypes: true}).forEach(e => {
    if (omitir.has(e.name)) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return recorrer(p);
    if (!e.name.endsWith('.js')) return;
    n++;
    const r = spawnSync(process.execPath, ['--check', p], {encoding: 'utf8'});
    if (r.status !== 0) { malos++; console.log('FALLA ' + path.relative(raiz, p) + '\n' + r.stderr); }
  });
})(raiz);
console.log(malos ? malos + ' de ' + n + ' archivos con error de sintaxis' : 'OK: ' + n + ' archivos .js con sintaxis válida');
process.exit(malos ? 1 : 0);
