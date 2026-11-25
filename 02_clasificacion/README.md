# 02 · Clasificación

Random Forest multianual sobre el mosaico Landsat trimestral (49 variables por píxel y año). Detalle completo en [`../docs/clasificador`](../docs/clasificador/).

| Script | Qué hace |
| --- | --- |
| `codigo_rf_silvicultura_ui_final.js` | **Clasificador vigente**, con interfaz. Lee las tablas maestras, entrena y exporta una clasificación por ecorregión y año. |
| `codigo_piloto_guia_col2_silvicultura.js` | Explora la guía COL2 sin pasar por el visor completo: entrena una vez y permite mover los umbrales viendo el mapa al instante. |
| `codigo_verificar_probabilidades_silvicultura.js` | Revisa que los assets exportados de una versión tengan las bandas de probabilidad y que no falten años. Solo lee metadatos. |
| `codigo_borrar_version_silvicultura.js` | Borra los assets de una versión exacta (`DRY_RUN = true` solo lista). **No se puede deshacer.** |

## Método

- **Máscara:** RF de 3 clases (plantación = pino + eucalipto, otras, cosechado).
- **Cosechado:** solo dentro de la plantación COL2 (clase 9), donde su probabilidad es la mayor de las tres.
- **Plantación:** probabilidad de la máscara apoyada por COL2. Dentro de COL2 entra con un umbral bajo; fuera de COL2 solo con un umbral alto.
- **Especie:** RF aparte pino vs eucalipto, con P(pino) suavizada y corte en 0,5.
- **Área mínima** sobre pino y eucalipto; un modelo por periodo de sensor (1996–2012 y 2013–2026).

## Buffer alrededor de la ecorregión

Campo **Buffer alrededor de la ecorregión (km, 0 = no)** en el panel Muestreo; por defecto **5 km**.

- Clasifica y exporta la ecorregión **más** la franja de ese ancho, con el modelo de la propia ecorregión.
- La franja = buffer geodésico del vector `E{n}` (error máx. 100 m) sumado a los píxeles de la ecorregión en el raster. La región de exportación es el rectángulo de la ecorregión ampliado en esa distancia.
- Con 0 km el comportamiento es el de antes. Para replicar versiones ya exportadas sin buffer, usa 0.
- El asset guarda `buffer_km`. "Agregar probabilidades a una versión ya exportada" avisa si el buffer actual difiere del del asset (los assets antiguos cuentan como 0 km).
- Mapa: capa **Límite buffer** para ver la franja. Las ecorregiones vecinas se solapan en la franja.
- Con buffer el cálculo es más pesado; para explorar rápido usa 0 y deja el buffer para exportar.

## Guardar y compartir parámetros

Get Link comparte el código, no el estado de la interfaz. Para que quien abra el enlace vea tus parámetros:

- **URL automática.** Cada vez que cambias un control, la URL del navegador se actualiza con `#cfg=...` (solo los parámetros distintos de los iniciales). Copiar esa URL, o usar Get Link, conserva los parámetros si el Code Editor incluye el fragmento.
- **Línea en el código (siempre funciona).** En la pestaña Clasificación, «Guardar / compartir parámetros» → «Generar texto» entrega `var CONFIG_INICIAL = '...';`. Reemplaza la línea del mismo nombre al inicio del script y Get Link la lleva dentro del código.
- **Cargar.** «Cargar desde el texto» acepta esa línea o solo el JSON. Al abrir el script se aplica primero `CONFIG_INICIAL` y después la URL, que manda si trae algo.
- Qué se guarda: ecorregiones, periodo, años, tipo de modelo, buffer, guía COL2, puntos por clase, árboles, relleno, carpeta y versión de salida, etc. No entrena ni exporta nada: después de cargar, presiona Aplicar parámetros.

## Relleno de vacíos al exportar

La pestaña Exportar rellena los vacíos de cada año (píxeles sin clasificar porque al mosaico le faltaba algún predictor) con la clasificación del **año más cercano que sí tiene dato** en ese píxel. Casilla **Rellenar vacíos con años vecinos al exportar** (activa por defecto), con distancia máxima (3 años por defecto, tope 10) y prioridad a igual distancia (ANTERIOR por defecto).

- Los años vecinos se clasifican con el mismo modelo, aunque no se exporten; no hace falta tener exportados los otros años.
- Se rellenan todas las bandas (clase y probabilidades) desde el mismo año vecino, y el asset agrega la banda `anio_origen` (el propio año si no se rellenó). 1996 solo se rellena con años posteriores y 2026 con anteriores.
- Propiedades del asset: `relleno`, `relleno_max_dist` y `relleno_prioridad`.
- Cada tarea clasifica hasta 2 × distancia + 1 años, así que es más pesada. Si falla por memoria o tiempo, baja la distancia o desmarca el relleno y usa `03_filtros/codigo_rellenar_huecos_temporal_silvicultura.js` sobre los assets ya exportados.
- Si se rellena aquí, el paso S1 del pipeline de filtros ya no encuentra nada que rellenar.
- `codigo_verificar_probabilidades_silvicultura.js` acepta la banda extra `anio_origen`.

## Partición train/test

La partición no está guardada en las tablas maestras: se decide al entrenar, **por polígono**. Un punto es test si su `azar_poly` (valor fijo de 0 a 1 calculado desde el ID del polígono) es menor que la fracción de test, y train si no. En la pestaña **Exportar** el botón **Exportar partición train/test** guarda los puntos que se usaron en la última ejecución.

- **Asset:** `split_e{ecos}_{ini}-{fin}_{versión}` en la carpeta de las maestras (`MODEL_SAMPLES`, debe existir). Con modelo por periodo, uno por periodo. La versión es la del campo Versión de la clasificación.
- **Columnas:** `conjunto` (train / test), `clase` (1 pino, 2 eucalipto, 3 otras, 4 cosechado), `fondo` (1 base, 2 agro, solo con la maestra con agro), `azar_poly`, `azar_pt`, `yr`, `eco` y la geometría del punto. Con la casilla "Incluir también los predictores" conserva los 49 predictores (tabla más pesada).
- **Propiedades del asset:** fracción de test, puntos por clase (`pino_train`, `euca_train`, …), semilla, ecorregiones de entrenamiento, versión de la maestra y periodo.
- El modelo de especie usa solo los puntos de clase 1 y 2 de cada conjunto; el de máscara usa todos (pino y eucalipto fusionados).
- Presiona Aplicar parámetros antes de exportar: la tabla corresponde al modelo de la última ejecución.

## Salida

`CLASSIFICATIONS/PRELIMINAR/SILVICULTURA/silvo_e{eco}_{año}_{versión}`, con las bandas `silvicultura` (1 pino, 2 eucalipto, 3 otras, 4 cosechado), `p_pino`, `p_euca`, `p_cosechado`, `p_otras` y `probabilidad`.

## Versiones anteriores

`../archivo/` guarda `codigo_rf_silvicultura_ui.js`, `..._ui_guiaCOL2.js`, `..._tablas.js` y `..._trimestral.js`. Se conservan solo como referencia: el vigente es `_ui_final`.
