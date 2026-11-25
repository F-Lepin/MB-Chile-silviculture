# 03 · Filtros

Toma las clasificaciones preliminares ya exportadas y aplica, por ecorregión y sobre toda la serie 1996–2026, los pasos del documento [`pipeline_filtros_silvicultura`](../docs/filtros/pipeline_filtros_silvicultura.md).

| Paso | Qué hace | Parámetro |
| --- | --- | --- |
| S1 | Relleno de huecos de mosaico con el año vecino más cercano | hasta 3 años |
| S2 | Corrección por incendios: cosechado que empieza el año de un incendio vuelve al último pino o eucalipto previo | MapBiomas Fuego Col 1, años 2013–2025 |
| S3 | Área mínima de plantación (pino + eucalipto) | 11 px |
| S4 | Consistencia temporal por tramos: una especie por tramo, solo pino → eucalipto con corte, cosecha de 1 año, regla de 5 años | |
| S5 | Consistencia espacial de especie: un fragmento pequeño pegado a uno mayor de la otra especie pasa a la otra | 22 px (a calibrar) |
| S6 | Códigos finales: pino 79, eucalipto 80, cosechado 83 | |

## Scripts

| Script | Qué hace |
| --- | --- |
| `codigo_pipeline_filtros_silvicultura.js` | Pipeline S1–S6 con interfaz: activar o desactivar pasos, editar parámetros, ver cada etapa y los píxeles cambiados por paso. Exporta una imagen por ecorregión. |
| `codigo_rellenar_huecos_temporal_silvicultura.js` | Relleno de huecos como exportación independiente sobre assets ya exportados (`v3` → `v3_rell`). Es la misma idea que S1. El clasificador ya puede rellenar al exportar; este script queda para versiones exportadas sin relleno. |

## Salida

`silvo_filtrado_e{eco}_{versión}`, una imagen por ecorregión con 3 bandas por año:

- `silvicultura_{año}`: clase filtrada 1/2/3/4.
- `final_{año}`: códigos 79/80/83 (otras queda sin dato, para integrar sobre la clasificación general).
- `paso_{año}`: pasos que cambiaron el píxel, en bits (1 = S1, 2 = S2, 4 = S3, 8 = S4, 16 = S5; 0 = no cambió).

La región de trabajo y de exportación se amplía en `BUFFER_KM` (5 km) respecto del rectángulo de la ecorregión, para conservar la franja de las clasificaciones con buffer; los filtros S3, S4 y S5 la procesan completa. Si las entradas no traen franja, lo que sobra queda sin dato. El asset guarda `buffer_km`.

Este nombre no coincide con el patrón `silvo_e{eco}_{año}_{ver}`, así que los visores de la etapa 4 aún no lo leen.
