# Tarea: ¿qué predictores separan pino de eucalipto? (análisis en Python)

## Contexto

Trabajo en MapBiomas Chile, Colección 3. Tengo un clasificador (Random Forest, Landsat trimestral) que separa bien **plantación vs otras coberturas**, pero **no logra separar pino (clase 79) de eucalipto (clase 80)**: la precisión del productor del eucalipto ronda 50–60 %. Quiero saber, con datos y no con intuición:

1. Qué bandas, índices y trimestres separan mejor pino de eucalipto.
2. Si ese orden se repite entre ecorregiones y entre periodos (Landsat 5/7 vs Landsat 8/9).
3. Cuánto aporta la información espectral y cuánto el "sitio" (distancia a la costa, relieve, etc.).
4. Cuál es el techo realista de separabilidad con lo que ya tengo.

El mismo análisis ya lo intenté en el Code Editor de GEE (JavaScript) y la página se cuelga, por eso lo hago en Python con `earthengine-api`, `pandas`, `numpy`, `scikit-learn` y `matplotlib`.

## Datos de entrada

### Fuente principal (usar esta): tablas de muestras exportadas por año

```
projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_TRIMESTRAL
```

- Nombre: `sample_silvo_e{eco}_{año}_v{n}`. Ecorregiones **7 a 11**, años **1996 a 2026**. Si hay varias versiones de una misma ecorregión y año, usa **solo la más alta**.
- **Ignora** `sample_base_*` y `sample_agro_*` (no se usan en esta tarea).
- Cada fila es **un píxel** (un punto de 30 m). `eco` y `año` NO son columnas: salen del nombre del archivo.
- Columnas relevantes:
  - Etiqueta: `class` (79 pino, 80 eucalipto). Excluye filas con `descartar` = 1.
  - Polígono: `dis_id`, `fid_gpkg`, `id`, `fid` (usa el primero que exista y sea mayor que -9999; combínalo con `eco` y `origen` para que sea único).
  - Fuente: `origen` (`conaf` o `col3MB`/otro) y `tipo_muestra`.
  - Serie de años adultos (ciclo 1): `a_adulta_desde`, `a_adulta_hasta`, `a_adulta_hasta_trim` (Q1–Q4 o vacío).
  - Ciclo 2: `a_adulta2_desde`, `a_adulta2_hasta`, `a_adulta2_hasta_trim`.
  - Valores vacíos: `-9999` (numéricos) y `""` (texto).
  - Predictores (todos con prefijo `q_`): `q_Q1_blue_median`, `q_Q1_green_median`, `q_Q1_red_median`, `q_Q1_nir_median`, `q_Q1_swir1_median`, `q_Q1_swir2_median` (y lo mismo para Q2, Q3, Q4), `q_Q*_nobs`, `q_ndmi_amp`, `q_ndmi_max`, `q_ndmi_min`, `q_ndvi_amp`, `q_ndvi_max`, `q_q_ndmi_max`, `q_q_ndvi_max`, `q_mndwi_max`, `q_wet_freq`, `q_valid_q`, `q_hand`, `q_twi`, `q_dist_water`, `q_dist_coast`.
- **Importante:** `Año_Adult` es un atributo antiguo y está mal. **No lo uses.**

### Fuente alternativa (solo para una prueba rápida)

```
projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_COL3/SILVICULTURE/MODEL_SAMPLES
```

Contiene `train_master_e{eco}_v1` (ya muestreada, ~4.000 puntos por periodo y clase), pero **sin id de polígono** y con menos predictores. Sirve para un primer vistazo, no para el análisis final.

### Descarga desde Earth Engine

No uses `getInfo()` sobre tablas grandes. Para cada tabla: selecciona solo las columnas necesarias, descarga con `getDownloadURL` (CSV) o exporta a Drive/GCS y lee localmente. Guarda una copia local en parquet o CSV para no volver a descargar.

## Paso 1. Quedarse con los años ADULTOS de cada polígono

Una fila (píxel-año) es válida si:
- `class` ∈ {79, 80} y `descartar` ≠ 1, y
- el año de la tabla `yr` cumple **en alguno de los dos ciclos**:
  `desde <= yr < hasta`, **o** `yr == hasta` con `hasta_trim` ∈ {`Q4`, `""`}.
  Si `hasta_trim` es Q1, Q2 o Q3, el año `hasta` **no** se incluye (esa plantación deja de ser adulta antes de terminar el año).

Descarta las filas con algún predictor trimestral nulo. Revisa la distribución de `q_valid_q` y `q_Q*_nobs`; si `q_valid_q` indica cuántos trimestres tienen datos válidos, deja solo las filas con los 4 trimestres. **Documenta qué decidiste y por qué.**

## Paso 2. Variables derivadas

La reflectancia está escalada ×10000 (confírmalo). Para cada trimestre `p` ∈ {Q1_, Q2_, Q3_, Q4_} calcula, con exactamente estas fórmulas (son las mismas del clasificador):

- `q_{p}ndvi = (nir − red) / (nir + red)`
- `q_{p}ndmi = (nir − swir1) / (nir + swir1)`
- `q_{p}nbr  = (nir − swir2) / (nir + swir2)`
- `q_{p}evi2 = 2.5·(NIR − RED) / (NIR + 2.4·RED + 1)`, con NIR y RED divididos por 10000

## Paso 3. Periodos y submuestreo

- Periodo A: **1996–2012** (Landsat 5/7). Periodo B: **2013–2026** (Landsat 8/9).
- Los píxeles de un mismo polígono son casi idénticos entre sí y entre años. Para que los polígonos grandes no dominen: toma como máximo **50 píxeles por polígono y año** (aleatorio, semilla fija).
- Analiza por **ecorregión (E7 a E11) y por periodo** por separado, y además por **fuente** (`conaf` vs `col3MB`).

## Paso 4. Separabilidad por predictor (univariada)

Para cada predictor, cada ecorregión y cada periodo:

- **AUC pino vs eucalipto** y `s = 2·(AUC − 0.5)`, firmado: positivo si el valor es mayor en pino, negativo si es mayor en eucalipto.
- **d de Cohen** (diferencia de medias / desviación estándar combinada).
- Hazlo en **dos niveles**:
  1. **A nivel de píxel** (con el tope de 50 por polígono-año).
  2. **A nivel de polígono:** promedia cada predictor por polígono (primero por polígono-año y luego entre años) y calcula el AUC entre polígonos. Entrega un **intervalo de confianza del 95 % por bootstrap sobre polígonos** (1.000 remuestreos).
- Marca si el signo de `s` es **consistente** entre ecorregiones.

El nivel de polígono es el importante: el de píxel es optimista porque los píxeles del mismo polígono no son independientes.

## Paso 5. Separabilidad multivariada (modelo)

Entrena un Random Forest (`sklearn`, 300 árboles, `class_weight='balanced'`) pino vs eucalipto con **validación cruzada agrupada por polígono** (`GroupKFold`, 5 particiones; el grupo es el id de polígono, así que ningún polígono queda a la vez en entrenamiento y prueba). Para cada ecorregión y periodo, y también con todas las ecorregiones juntas, reporta **AUC, exactitud balanceada, y PA/UA de cada clase**, con los siguientes escenarios:

| Escenario | Predictores |
|---|---|
| E1. Completo | todos |
| E2. Solo espectral | bandas + índices trimestrales (sin hand, twi, dist_*) |
| E3. Solo sitio | `q_dist_coast`, `q_hand`, `q_twi`, `q_dist_water` |
| E4. Espectral + sitio | E2 + E3 |
| E5. Un solo trimestre | espectral de solo Q1, solo Q2, solo Q3 o solo Q4 (cuatro corridas) |
| E6. Mejores 5 | los 5 mejores predictores del Paso 4 (nivel de polígono) |
| E7. Sin NIR | todo menos las bandas NIR y sus índices (para ver qué tan dependiente es de una banda) |

Calcula además la **importancia por permutación** (en los datos de prueba de cada partición) para E1 y E4.

## Paso 6. Tabla de lo que NO debe ocurrir (controles)

- Informa cuántos polígonos y píxeles de cada clase entran en cada ecorregión y periodo, **antes y después** de los filtros. Como referencia, en las tablas de REVISIONES (polígonos) E8 tiene unos 673 de pino y 196 de eucalipto, E9 unos 716 y 787, y E7 unos 45 y 63. Si tus conteos difieren mucho, explícalo.
- Si una celda (ecorregión × periodo × clase) tiene menos de 30 polígonos, **márcala como "no concluyente"** y no la interpretes.

## Resultados que debes entregar

Carpeta `resultados_separabilidad/` con:

**Tablas (CSV):**
- `conteos.csv`: polígonos y píxeles por clase, ecorregión, periodo y fuente.
- `sep_univariada.csv`: predictor, ecorregión, periodo, nivel (píxel/polígono), n_pino, n_euca, AUC, s, d, IC95 inferior y superior, consistente (sí/no).
- `ranking_predictores.csv`: ranking global por periodo (media de |s| a nivel polígono entre ecorregiones, y si el signo es consistente).
- `modelos_escenarios.csv`: escenario, ecorregión, periodo, AUC, exactitud balanceada, PA y UA de pino y eucalipto.
- `importancia_permutacion.csv`.

**Figuras (PNG):**
- Mapa de calor de `s` (predictor × ecorregión), una figura por periodo.
- Barras agrupadas de `s` por banda e índice, un color por trimestre.
- Perfil espectral medio por clase (con rango intercuartil) a lo largo de los 4 trimestres, para las bandas rojo, NIR, SWIR1, SWIR2 y NDVI, una figura por periodo.
- Comparación de exactitud balanceada entre escenarios.

**`resumen.md`:** una página que responda, en este orden: (1) los 10 mejores predictores y su trimestre, (2) si se repiten entre ecorregiones y periodos, (3) cuánto aporta el sitio frente a lo espectral, (4) el techo de separabilidad a nivel de polígono, (5) diferencias entre fuentes, (6) limitaciones.

## Cómo voy a interpretar los resultados (para que los reportes sin sesgo)

- `|s|` a nivel de polígono: **< 0.3 débil**, 0.3–0.6 moderada, **> 0.6 fuerte**.
- Si E3 (solo sitio) logra una exactitud balanceada cercana a E1: la especie se explica sobre todo por **dónde** está la plantación y no por cómo se ve.
- Si E4 supera claramente a E2: el sitio aporta información real y conviene incluirlo en el clasificador.
- Si el mejor escenario no pasa de ~0.70 de exactitud balanceada a nivel de polígono: las bandas Landsat no alcanzan y hay que sumar otra fuente de información (Sentinel-2, radar, texturas).
- Si el periodo B es claramente mejor que el A: apoya clasificar la especie con los años recientes y propagarla hacia atrás.
- Si CONAF y col3MB dan resultados muy distintos: el problema puede estar en las etiquetas de una de las dos fuentes.

## Advertencias

- No mezcles ecorregiones al calcular el AUC univariado (la geografía se confunde con la especie); el análisis "todas juntas" solo va en el Paso 5.
- No uses `Año_Adult`.
- Fija las semillas aleatorias y anótalas en `resumen.md`.
- Haz primero una **prueba con una sola ecorregión (E9) y un periodo (B)**, revisa los conteos y luego lanza todo.
