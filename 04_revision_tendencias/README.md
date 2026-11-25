# 04 · Revisión de tendencias

Visores para revisar las clasificaciones exportadas sin entrenar nada.

| Script | Qué hace |
| --- | --- |
| `codigo_revisar_clasificaciones_silvicultura.js` | Visor simple por ecorregión, versión y año. Capas de clasificación, COL2 (clase 9) y mosaico; clic para ver la serie de un píxel; áreas por año; vista previa de relleno de huecos y del filtro silvo → otras. |
| `codigo_revisar_silvicultura_regiones.js` | Serie temporal de pino, eucalipto, cosechado y total por región político-administrativa. Compara con la plantación de COL2, estima el área sin dato y puede corregir cosechado por incendios en la nube. Exporta CSV. |

## Fuentes en `revisar_silvicultura_regiones`

El selector de fuente permite elegir:

- **Pre-integración:** `silvo_e{eco}_{año}_{versión}`.
- **Integración V1 · reglas** y **Integración V1 · HMM:** colecciones `INTEGRATION/V1/reglas` y `INTEGRATION/V1/hmm`, una imagen por ecorregión con bandas `b1…bN` (b1 = 1996). Valores 79/80/83 se leen como 1/2/4.

Se elige primero años, luego región, versión y escala. Cada combinación calculada queda guardada, así que volver a una ya hecha es instantáneo. Usa 90 m para explorar y 30 m para cifras finales.

## Clasificaciones con buffer

Si las clasificaciones exportadas incluyen la franja de 5 km, las ecorregiones vecinas se solapan. `revisar_silvicultura_regiones` recorta cada imagen a **su** ecorregión (raster de ecorregiones) antes de unirlas, así que las cifras por región no cuentan la franja dos veces ni toman la clasificación de la ecorregión equivocada. `revisar_clasificaciones` ya mostraba solo la ecorregión elegida.

## Pruebas

`tests/revision/` cubre el selector de fuente, la lectura de nombres de assets y la regla de bandas `b1…bN`.
