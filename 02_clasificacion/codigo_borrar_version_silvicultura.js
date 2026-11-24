// ==========================================================================================
// SCRIPT: borrar_version_silvicultura
// Proyecto: MapBiomas Chile COL3 — clase transversal SILVICULTURA
// ------------------------------------------------------------------------------------------
// Borra de CARPETA los assets de clasificación cuyo nombre termina EXACTAMENTE en _{SUFIJO}
// (ej. silvo_e8_2017_v1). No toca 'v1_rell', 'v10', 'v2', etc.
//
// USO (dos pasos, para no borrar por error):
//   1) Con DRY_RUN = true (por defecto): solo imprime la lista de lo que se borraría. Revísala.
//   2) Cambia DRY_RUN a false y vuelve a correr: borra esos assets. NO se puede deshacer.
// ==========================================================================================

var CARPETA = 'projects/mapbiomas-chile/assets/LULC/COLLECTION-03/CLASSIFICATIONS/PRELIMINAR/SILVICULTURA';
var SUFIJO = 'v1';          // versión a borrar
var DRY_RUN = true;         // true = solo listar · false = borrar de verdad

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

var re = new RegExp('^silvo_e\\d+_\\d{4}_' + SUFIJO + '$');
var todos = listarCarpeta(CARPETA);
var objetivo = todos.filter(function (a) {
  var id = a.id || a.name;
  return re.test(id.split('/').pop());
}).map(function (a) { return a.id || a.name; });

print('Carpeta: ' + CARPETA);
print('Assets en la carpeta: ' + todos.length + ' · con sufijo _' + SUFIJO + ': ' + objetivo.length);
print(objetivo.map(function (id) { return id.split('/').pop(); }));

if (DRY_RUN) {
  print('DRY_RUN = true: no se borró nada. Si la lista es correcta, cambia DRY_RUN a false y corre de nuevo.');
} else {
  var borrados = 0, fallos = [];
  objetivo.forEach(function (id) {
    try { ee.data.deleteAsset(id); borrados++; } catch (e) { fallos.push(id.split('/').pop() + ': ' + e.message); }
  });
  print('Borrados: ' + borrados + ' de ' + objetivo.length);
  if (fallos.length) print('Fallaron (' + fallos.length + '):', fallos);
}
