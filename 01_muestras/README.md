# 01 · Toma de muestras

Convierte los polígonos revisados de plantación en tablas de entrenamiento con los predictores del mosaico trimestral.

| Script | Qué hace | Salida |
| --- | --- | --- |
| `codigo_extraccion_muestras_silvicultura.js` | Toma la última versión de cada `c{clase}_{fuente}_e{eco}_v{n}` de `REVISIONES` (fuentes col3MB y CONAF, clases 79 y 80). Repite cada polígono en los años válidos (adulta y post-cosecha) y extrae sus píxeles con el mosaico de ese año. Modo `PRUEBA` o `EXPORTAR`. | `MODEL_SAMPLES/c{clase}_{fuente}_e{eco}_v{n}` |
| `codigo_exportar_maestras_silvicultura.js` | Una tabla maestra por ecorregión (E7–E11), con hasta `CAP` puntos por periodo × clase (1996–2012 y 2013–2026), `azar_poly` para train/test y `azar_pt` para elegir puntos. | `train_master_e{eco}_v5` (sin agro, `v1` en el visor), `_v6` (con agro, `v2`), `train_cosecha_e{eco}_v3` |
| `codigo_exportar_cosechado_silvicultura.js` | Solo la clase 4 (cosechado): puntos del año siguiente a la cosecha que no son adultos en ningún ciclo. | `train_cosecha_e{eco}_v3` |
| `codigo_revisar_versiones_conaf.js` | Control de calidad: detecta ecorregiones donde la versión más alta de un año no trae las filas CONAF de una versión anterior (el problema de E8). | consola |

## Análisis (`analisis/`)

| Script | Pregunta |
| --- | --- |
| `codigo_separabilidad_bandas_silvicultura.js` | ¿Qué bandas, índices y trimestres separan mejor pino de eucalipto? Ranking por ecorregión y periodo. |
| `codigo_diagnostico_ciclos_silvicultura.js` | ¿Se pueden separar pino y eucalipto por la duración de su ciclo de manejo? AUC y umbral simple por grupo. |

## Orden de uso

1. `extraccion_muestras` (si hay polígonos nuevos o revisados).
2. `revisar_versiones_conaf` para detectar versiones incompletas por ecorregión.
3. `exportar_maestras` y `exportar_cosechado`: se lanzan como tareas en la pestaña Tasks; las tablas que ya existen se omiten. La v6 necesita la v5 terminada.

Los prompts de apoyo con la especificación original están en [`../docs/prompts`](../docs/prompts/).
