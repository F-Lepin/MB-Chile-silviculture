const fs = require('fs');
const {Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  AlignmentType, HeadingLevel, LevelFormat, Footer, PageNumber, TabStopType} = require('docx');

const W = 9936;                          // ancho útil (DXA)
const COL = {esp: 'C8E6C9', gen: 'BBDEFB', dec: 'FFE0B2', nap: 'EEEEEE', head: '37474F', fin: 'E1BEE7'};
const line = {style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0'};
const none = {style: BorderStyle.NONE, size: 0, color: 'FFFFFF'};
const borders = {top: none, bottom: line, left: none, right: none};
const headBorders = {top: none, bottom: {style: BorderStyle.SINGLE, size: 8, color: '222222'}, left: none, right: none};

function runs(t, o = {}) {              // **negrita** inline
  return t.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(s =>
    s.startsWith('**') ? new TextRun({text: s.slice(2, -2), bold: true, ...o}) : new TextRun({text: s, ...o}));
}
const P = (t, o = {}) => new Paragraph({children: runs(t, o.run), spacing: {after: 100, line: 276}, ...(o.p || {})});
const B = (t, lvl = 0) => new Paragraph({children: runs(t), numbering: {reference: 'bul', level: lvl}, spacing: {after: 60, line: 276}});
const N = (t) => new Paragraph({children: runs(t), numbering: {reference: 'num', level: 0}, spacing: {after: 80, line: 276}});
const H1 = (t) => new Paragraph({heading: HeadingLevel.HEADING_1, children: [new TextRun(t)]});
const H2 = (t) => new Paragraph({heading: HeadingLevel.HEADING_2, children: [new TextRun(t)]});

function cell(t, w, o = {}) {
  const lines = Array.isArray(t) ? t : [t];
  const resalta = o.fill === COL.dec;     // solo se destaca lo que hay que decidir o verificar
  return new TableCell({
    width: {size: w, type: WidthType.DXA}, borders: o.head ? headBorders : borders,
    margins: {top: 70, bottom: 70, left: 80, right: 80},
    children: lines.map(l => new Paragraph({
      children: runs(l, {size: 18, bold: !!o.bold || resalta, color: o.color}), spacing: {after: 20, line: 252}}))
  });
}
function table(widths, header, rows) {   // rows: [{c:[...], fill:{idx:color}}]
  const hr = new TableRow({tableHeader: true, children: header.map((h, i) => cell(h, widths[i], {head: true, bold: true}))});
  const body = rows.map(r => new TableRow({cantSplit: true, children: r.c.map((t, i) => cell(t, widths[i], {fill: r.fill && r.fill[i]}))}));
  return new Table({width: {size: W, type: WidthType.DXA}, columnWidths: widths, rows: [hr, ...body]});
}
const gap = () => new Paragraph({children: [], spacing: {after: 120}});


const kids = [];
kids.push(new Paragraph({heading: HeadingLevel.TITLE, children: [new TextRun('Pipeline del clasificador de silvicultura')]}));
kids.push(new Paragraph({children: [new TextRun({text: 'MapBiomas Chile · Colección 3 · Borrador para discutir con el equipo de clasificación · 11 de noviembre de 2026', color: '666666', size: 22})], spacing: {after: 200}}));

kids.push(H1('1. Idea general'));
kids.push(P('El clasificador genera, para cada ecorregión y cada año entre 1996 y 2026, una clasificación preliminar de silvicultura a 30 m con cuatro clases: **pino, eucalipto, otras y cosechado**. Además entrega la probabilidad de cada clase por píxel.'));
kids.push(P('Se basa en **dos Random Forest**: uno de máscara, que separa plantación, otras y cosechado, y uno de especie, que separa pino de eucalipto. Usa mosaicos Landsat trimestrales y un modelo distinto para cada periodo de sensor. La salida alimenta la etapa 1 del pipeline de filtrado, que se describe en otro documento.'));
kids.push(P('**Estado:** todo lo descrito está implementado en la herramienta de clasificación en Google Earth Engine. Los valores de las etapas son los que la herramienta trae por defecto; los que se usaron en la ecorregión 8 están en la última sección.'));

kids.push(H1('2. Mapa del pipeline'));
kids.push(table([760, 4300, 4876], ['Etapa', 'Qué ocurre', 'Resultado'], [
  {c: ['1', 'Insumos', 'Mosaicos, tablas de muestras, COL2 y ecorregiones'], fill: {}},
  {c: ['2', 'Variables predictoras', '49 variables por píxel y año'], fill: {}},
  {c: ['3', 'Muestras de entrenamiento', 'Tabla maestra por ecorregión, con partición de entrenamiento y prueba'], fill: {}},
  {c: ['4', 'Entrenamiento de los modelos', 'Dos Random Forest por periodo de sensor y métricas de validación'], fill: {}},
  {c: ['5', 'Clasificación por año', 'Probabilidades por clase y decisión de la clase de cada píxel'], fill: {}},
  {c: ['6', 'Postclasificación', 'Clase final, con el área mínima aplicada'], fill: {}},
  {c: ['7', 'Exportación', 'Un asset por ecorregión y año, con la clase y las probabilidades'], fill: {}},
]));

kids.push(H1('3. Etapa 1 · Insumos'));
kids.push(table([2800, 7136], ['Insumo', 'Contenido'], [
  {c: ['Mosaicos Landsat trimestrales', 'Colección de mosaicos de MapBiomas, un mosaico por año con las cuatro estaciones (Q1 a Q4), 1996–2026.'], fill: {}},
  {c: ['Muestras de silvicultura', 'Polígonos de pino y eucalipto, con los años en que el rodal es adulto y, cuando existe, el año de cosecha.'], fill: {}},
  {c: ['Muestras de otras clases', 'Segmentos de la clasificación base. Se excluyen las clases 79, 80, 9 y 27.'], fill: {}},
  {c: ['COL2, plantación (clase 9)', 'Máscara de plantación de la Colección 2. Se usa como apoyo en la decisión de la clase.'], fill: {}},
  {c: ['Ecorregiones', 'Raster a 30 m y vectores. El clasificador trabaja una ecorregión a la vez.'], fill: {}},
]));

kids.push(H1('4. Etapa 2 · Variables predictoras'));
kids.push(P('Cada píxel y año tiene **49 variables**. Se calculan con las mismas fórmulas en la imagen y en las tablas de muestras.'));
kids.push(table([2800, 5736, 1400], ['Grupo', 'Variables', 'Cantidad'], [
  {c: ['Bandas por trimestre', 'Mediana de azul, verde, rojo, infrarrojo cercano (NIR), SWIR1 y SWIR2, en cada trimestre', '24'], fill: {}},
  {c: ['Índices por trimestre', 'NDVI, NDMI, NBR y EVI2, en cada trimestre', '16'], fill: {}},
  {c: ['Variables anuales', 'Amplitud, máximo y mínimo de NDMI; amplitud y máximo de NDVI; trimestre del máximo de NDMI y de NDVI; HAND y TWI (topografía y humedad)', '9'], fill: {}},
]));
kids.push(P('Quedan fuera a propósito el número de observaciones por trimestre, los trimestres válidos y las variables de agua y costa (mndwi_max, wet_freq, dist_water y dist_coast).', {run: {size: 18, color: '666666'}, p: {spacing: {before: 80, after: 120}}}));

kids.push(H1('5. Etapa 3 · Muestras de entrenamiento'));
kids.push(P('Las muestras se arman una sola vez por ecorregión, en una **tabla maestra** con dos periodos (1996–2012 y 2013–2026). Cambiar las ecorregiones de entrenamiento, el número de puntos o la fracción de prueba no obliga a exportarla de nuevo.'));
kids.push(table([760, 4300, 4876], ['Paso', 'Qué hace', 'Parámetros por defecto'], [
  {c: ['M1', 'Silvicultura: pino (clase 79) pasa a clase 1 y eucalipto (80) a clase 2. Solo años en que el rodal es adulto y sin polígonos marcados como descartados.', 'Lectura de polígonos: 10 %. Máximo 4.000 puntos por periodo y clase'], fill: {}},
  {c: ['M2', 'Otras: segmentos de la clasificación base, sin las clases 79, 80, 9 y 27, que pasan a clase 3. La versión con agricultura agrega muestras de agricultura a la clase 3.', 'Lectura: 50 %. Agricultura: 30 %'], fill: {}},
  {c: ['M3', 'Cosechado (clase 4): polígonos de silvicultura en el año siguiente al año de cosecha registrado.', 'Lectura: 50 %'], fill: {}},
  {c: ['M4', 'Partición entrenamiento y prueba por polígono o segmento, no por punto, para evitar que puntos vecinos queden en los dos grupos.', 'Prueba: 30 %'], fill: {}},
  {c: ['M5', 'Selección de puntos por clase, al azar y con semilla fija.', 'Pino 1.400 · eucalipto 1.400 · otras 4.000 · agricultura 2.000 · cosechado 1.500'], fill: {}},
]));

kids.push(H1('6. Etapa 4 · Entrenamiento'));
kids.push(table([760, 4300, 4876], ['Paso', 'Qué hace', 'Parámetros por defecto'], [
  {c: ['E1', '**Modelo de máscara.** Random Forest de tres clases: plantación (pino y eucalipto juntos), otras y cosechado.', '40 árboles, hoja mínima de 2 muestras, 50 % de muestras por árbol, semilla 42'], fill: {}},
  {c: ['E2', '**Modelo de especie.** Random Forest entrenado solo con pino y eucalipto.', 'Mismos parámetros y las mismas 49 variables'], fill: {}},
  {c: ['E3', '**Un modelo por periodo de sensor.** Cada año usa el modelo de su periodo.', 'Landsat 5/7: 1996–2012 · Landsat 8/9: 2013–2026'], fill: {}},
  {c: ['E4', '**Ecorregiones.** Las ecorregiones 7 a 11 tienen muestras propias. La 5 y la 12 no, y se clasifican con un modelo entrenado en otras ecorregiones, para evaluar si hacen falta muestras propias.', 'Ecorregiones de entrenamiento configurables'], fill: {}},
  {c: ['E5', '**Validación** con el 30 % de prueba: matriz de confusión, exactitud global, exactitud del productor y del usuario por clase, e importancia de variables.', '—'], fill: {}},
]));

kids.push(H1('7. Etapa 5 · Clasificación por año'));
kids.push(P('Se aplica a cada píxel, con el modelo del periodo que corresponde al año.'));
kids.push(table([760, 5300, 3876], ['Paso', 'Qué hace', 'Parámetros por defecto'], [
  {c: ['C1', '**Probabilidades.** El modelo de máscara entrega P(plantación), P(otras) y P(cosechado). El modelo de especie entrega P(pino).', '—'], fill: {}},
  {c: ['C2', '**Cosechado.** Solo dentro de COL2. Gana si su probabilidad es la mayor de las tres. Fuera de COL2 no se asigna cosechado.', '—'], fill: {}},
  {c: ['C3', '**Plantación, con guía de COL2.** Dentro de COL2 se exige una probabilidad de plantación baja, porque COL2 la respalda. Fuera de COL2 se exige una alta. Un píxel de cosechado no cuenta como plantación.', 'Dentro de COL2: P ≥ 0,4 · Fuera de COL2: P ≥ 0,85'], fill: {}},
  {c: ['C4', '**Especie.** En los píxeles de plantación, P(pino) se suaviza con el promedio de una ventana cuadrada. Es pino si el valor es de 0,5 o más, y eucalipto si no. Opcionalmente se promedia entre años (consenso temporal).', 'Radio 3 px (ventana de 7 × 7). Consenso temporal: apagado'], fill: {}},
  {c: ['C5', '**Resto.** Todo píxel que no es plantación ni cosechado queda como otras.', '—'], fill: {}},
]));

kids.push(H1('8. Etapa 6 · Postclasificación'));
kids.push(table([760, 5300, 3876], ['Paso', 'Qué hace', 'Parámetros por defecto'], [
  {c: ['P1', '**Área mínima.** Un parche conexo (8 vecinos) de pino o de eucalipto menor al umbral pasa a otras. Se evalúa por clase: un parche mixto de 11 px de pino y 11 px de eucalipto no pasa el filtro de 22.', 'Umbral: 22 px (≈ 2 ha; 1 px = 900 m²)'], fill: {}},
]));

kids.push(H1('9. Etapa 7 · Exportación'));
kids.push(P('Un asset por ecorregión y año, con nombre **silvo_e{ecorregión}_{año}_{versión}**, en la carpeta de clasificaciones preliminares de silvicultura. Se exporta a 30 m, sobre la ecorregión, y los años que ya existen se omiten. Se puede exportar cualquier año sin tenerlo cargado en el mapa.'));
kids.push(table([2600, 7336], ['Banda', 'Contenido'], [
  {c: ['silvicultura (banda 0)', 'Clase: 1 pino, 2 eucalipto, 3 otras, 4 cosechado'], fill: {}},
  {c: ['p_pino', 'P(plantación) × P(pino), de 0 a 100'], fill: {}},
  {c: ['p_euca', 'P(plantación) × (1 − P(pino)), de 0 a 100'], fill: {}},
  {c: ['p_cosechado', 'P(cosechado) del modelo de máscara, de 0 a 100'], fill: {}},
  {c: ['p_otras', 'P(otras) del modelo de máscara, de 0 a 100'], fill: {}},
  {c: ['probabilidad', 'Probabilidad de la clase que quedó asignada, de 0 a 100'], fill: {}},
]));
kids.push(P('Las cuatro probabilidades por clase suman cerca de 100. La clase final no siempre es la de mayor probabilidad, porque la guía de COL2, el cosechado solo dentro de COL2 y el área mínima actúan sobre el resultado. Cada asset guarda como propiedades los parámetros con que se generó: árboles, radio, área mínima, umbrales, consenso, modelo por periodo y ecorregiones de entrenamiento.', {p: {spacing: {before: 120, after: 100, line: 276}}}));

kids.push(H1('10. Pendientes'));
[
  '**Área mínima:** el umbral de 22 px es el actual. El filtro general del equipo usa 11 px, y la decisión se discute en el documento del pipeline de filtrado.',
  '**Ecorregiones 5 y 12:** falta evaluar el resultado del modelo transferido y decidir si hacen falta muestras propias.',
  '**Consistencia temporal:** el consenso de especie entre años viene apagado por defecto, y en la ecorregión 8 se usó activado. Además, se propone resolver la consistencia temporal en el pipeline de filtrado, antes de integrar.',
].forEach(t => kids.push(N(t)));

kids.push(new Paragraph({heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('11. Para replicar E8')]}));
kids.push(P('Parámetros con que se clasificó la ecorregión 8, tal como están en el panel de la herramienta. Se usa el modelo estándar por grupo de sensores: un modelo para Landsat 5/7 y otro para Landsat 8/9.'));
kids.push(table([2200, 3900, 3836], ['Grupo', 'Parámetro', 'Valor en E8'], [
  {c: ['Modelo', 'Tipo de modelo', 'Máscara de plantación + modelo de especie'], fill: {}},
  {c: ['', 'Periodo', 'Automático: un modelo por grupo de sensores (Landsat 5/7: 1996–2012 · Landsat 8/9: 2013–2026)'], fill: {}},
  {c: ['', 'Ecorregión de entrenamiento', 'E8, con muestras propias'], fill: {}},
  {c: ['', 'Árboles del Random Forest', '40'], fill: {}},
  {c: ['Muestras', 'Muestras de fondo', 'v2: silvicultura contra otras y agricultura (tabla maestra train_master_e8_v4)'], fill: {}},
  {c: ['', 'Tabla de cosechado', 'train_cosecha_e8_v2'], fill: {}},
  {c: ['', 'Pino, puntos de entrenamiento', '2.000'], fill: {}},
  {c: ['', 'Eucalipto, puntos de entrenamiento', '3.000'], fill: {}},
  {c: ['', 'Otras, puntos de entrenamiento', '4.000'], fill: {}},
  {c: ['', 'Agricultura, puntos de entrenamiento', '2.000'], fill: {}},
  {c: ['', 'Cosechado, puntos de entrenamiento', '2.000'], fill: {}},
  {c: ['', 'Fracción de prueba', '0,3'], fill: {}},
  {c: ['Tabla maestra', 'Máximo de puntos por periodo y clase', '4.000'], fill: {}},
  {c: ['', 'Lectura de silvicultura', '0,1'], fill: {}},
  {c: ['', 'Lectura de otras (base)', '0,5'], fill: {}},
  {c: ['', 'Lectura de agricultura', '0,3'], fill: {}},
  {c: ['', 'Lectura de cosechado', '0,5'], fill: {}},
  {c: ['Clasificación', 'Suavizado de especie', 'Radio de 3 px'], fill: {}},
  {c: ['', 'Consenso temporal de especie', 'Activado. Promedia P(pino) entre los años seleccionados al exportar, así que para replicar hay que usar la misma selección de años'], fill: {}},
  {c: ['', 'Área mínima de parche pino y eucalipto', '22 px'], fill: {}},
  {c: ['', 'Guía COL2 para plantación', 'Activada. P mínima dentro de COL2: 0,5. P mínima fuera de COL2: 0,85'], fill: {}},
]));
kids.push(P('Estos parámetros quedan fijos en el código y no se cambian desde el panel: semilla 42, hoja mínima de 2 muestras, 50 % de muestras por árbol y, para el cosechado, el año siguiente al año de cosecha registrado.', {run: {size: 18, color: '666666'}, p: {spacing: {before: 100, after: 100, line: 264}}}));

const doc = new Document({
  creator: 'OBiBO · MapBiomas Chile', title: 'Pipeline del clasificador de silvicultura',
  styles: {
    default: {document: {run: {font: 'Arial', size: 21}}},
    paragraphStyles: [
      {id: 'Title', name: 'Title', basedOn: 'Normal', run: {font: 'Arial', size: 36, bold: true, color: '222222'}, paragraph: {spacing: {before: 0, after: 80}}},
      {id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {font: 'Arial', size: 26, bold: true, color: '222222'},
       paragraph: {spacing: {before: 300, after: 120}, keepNext: true, outlineLevel: 0}},
      {id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {font: 'Arial', size: 24, bold: true, color: '222222'},
       paragraph: {spacing: {before: 200, after: 80}, keepNext: true, outlineLevel: 1}},
    ]},
  numbering: {config: [
    {reference: 'bul', levels: [{level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: {paragraph: {indent: {left: 540, hanging: 270}}}}]},
    {reference: 'num', levels: [{level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: {paragraph: {indent: {left: 540, hanging: 360}}}}]},
  ]},
  sections: [{
    properties: {page: {size: {width: 12240, height: 15840}, margin: {top: 1200, bottom: 1200, left: 1152, right: 1152}}},
    footers: {default: new Footer({children: [new Paragraph({alignment: AlignmentType.RIGHT,
      children: [new TextRun({text: 'Pipeline del clasificador de silvicultura · página ', size: 16, color: '78909C'}), new TextRun({children: [PageNumber.CURRENT], size: 16, color: '78909C'})]})]})},
    children: kids
  }]
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync('pipeline_clasificador_silvicultura.docx', b); console.log('ok'); });
