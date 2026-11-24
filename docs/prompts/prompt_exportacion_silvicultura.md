# Tarea: exportar muestras de silvicultura cruzadas con el mosaico trimestral (Google Earth Engine, Python)

## Contexto

Trabajo en MapBiomas Chile, Colección 3 (uso y cobertura de suelo). Necesito entrenar un clasificador **multianual** que separe **pino (clase 79)** y **eucalipto (clase 80)** del resto de coberturas.

Multianual significa esto:
- Se entrena **un solo modelo** con puntos de muchos años distintos.
- Cada punto lleva los valores espectrales del mosaico **de su propio año**.
- Después, el modelo se aplica al mosaico del año que se quiera mapear.

Cada año del mosaico contiene **los 4 trimestres apilados como bandas** (Q1_…, Q2_…, Q3_…, Q4_…). Por eso, un punto solo es válido si su etiqueta es correcta durante **los cuatro trimestres** de ese año.

Tu tarea es extraer la información espectral de las **muestras revisadas de plantación** y exportarla como tablas (FeatureCollection) a un asset de GEE. Usa la API de Python de Earth Engine (`earthengine-api`). Las muestras de fondo (otras clases) NO son parte de esta tarea.

## Rutas

```
REVISIONES (entrada):  projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_COL3/SILVICULTURE/REVISIONES
MODEL_SAMPLES (salida): projects/mapbiomas-chile/assets/LULC/COLLECTION-03/SAMPLES/SAMPLES_COL3/SILVICULTURE/MODEL_SAMPLES
Mosaico trimestral:    projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/mosaics-3-trimestral   (ImageCollection, propiedad 'year', 1996–2026)
Fenología CIM:         projects/mapbiomas-mosaics/assets/LANDSAT/LULC/CHILE/fenologia_cim          (verificar si es Image o ImageCollection)
Ecorregiones raster:   projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES_RASTER/ecorregiones_col3_30m   (1 banda, valores 1–17)
Ecorregiones vector:   projects/mapbiomas-chile/assets/LULC/COLLECTION-03/ANCILLARY_DATA/ECORREGIONES/E1 … E17   (un asset por ecorregión, nombres sin cero)
```

## 1. Qué archivos usar de REVISIONES

La carpeta tiene unas 40 tablas. Solo se usan las que siguen este patrón (sin distinguir mayúsculas):

```
c{clase}_{fuente}_e{eco}_v{version}
```

- `clase`: 79 (pino) o 80 (eucalipto).
- `fuente`: `col3MB` o `CONAF`. Son dos bases distintas y **no se mezclan**.
- `eco`: número de ecorregión (por ejemplo `e9`, `e10`).
- `version`: entero. Para cada combinación **clase × fuente × ecorregión**, usa **solo la versión más alta**. Por ejemplo, entre `c79_col3MB_e11_v1` … `_v5`, usa solo `_v5`.

Se **excluyen**:
- `C79_col3MB` y `c80_col3MB`: archivos nacionales antiguos, sin serie temporal.
- `c80_COL2_e5_candidatas` y cualquier otro nombre que no calce con el patrón.

Imprime la lista de tablas seleccionadas y la de ignoradas antes de exportar.

## 2. Columnas importantes

Las bases `col3MB` y `CONAF` tienen columnas distintas, pero comparten todas las columnas temporales. **Verifica nombres y tipos** con `first().propertyNames()` y algunas filas de ejemplo antes de programar.

| Columna | Significado |
|---|---|
| `class` / `idclass` | Clase MapBiomas (79 o 80). Coincide con la del nombre del archivo. |
| `descartar` | 1 = el revisor descartó el polígono → **excluir**. Si no existe o es 0, se mantiene. |
| `a_adulta` | **Lista de años** en que el polígono es plantación adulta en el ciclo 1. Viene como texto separado por comas, por ejemplo `"1999,2000,2001"`. Puede venir vacía (`""`). |
| `a_adulta_desde` / `a_adulta_hasta` | Primer y último año adulto del ciclo 1. `-9999` = sin dato. |
| `a_adulta_hasta_trim` | **Último trimestre adulto** del año `a_adulta_hasta` (`Q1`–`Q4`, o `""`). |
| `anio_cosecha` / `trimestre_cosecha` | Año y trimestre en que la cosecha del ciclo 1 se completa. `-9999` / `""` = no cosechado. La cosecha puede ocurrir **uno o más años después** de `a_adulta_hasta`, porque cosechar todo el rodal toma tiempo. |
| `a_adulta2`, `a_adulta2_desde`, `a_adulta2_hasta`, `a_adulta2_hasta_trim`, `anio_cosecha2`, `trimestre_cosecha2` | Lo mismo para un **segundo ciclo** (replantación). Mismo formato; vacío si no hay segundo ciclo. |
| `n_a_adult`, `n_a_adult2` | Número de años adultos en cada ciclo (sirve para verificar). |
| `tipo_muestra`, `origen` | Metadatos de procedencia (por ejemplo `conaf`, `revisada`, `col2`). |
| `Año_Adult` | **NO USAR.** Es un atributo heredado del catastro y no coincide con la serie revisada. |
| `a_joven`, `a_plant` | Años de plantación joven o establecida (solo en `col3MB`). **No se usan** en esta tarea. |

Valores vacíos: los campos numéricos usan `-9999` y los campos de texto o lista usan `""`. Los años pueden venir como número o como texto; conviértelos con cuidado.

## 3. Cómo convertir cada polígono en registros por año

Cada polígono se replica en **un registro por año válido**, con estas reglas. Haz lo mismo para el ciclo 1 y el ciclo 2.

**Estado 1, ADULTA:**
- Incluye todos los años de `a_adulta` (y de `a_adulta2`).
- **Excepción:** si `a_adulta_hasta_trim` no está vacío y es distinto de `Q4`, **quita el año `a_adulta_hasta`**. En ese año la plantación deja de estar adulta antes de terminar el año, así que el stack trimestral mezcla trimestres con plantación y trimestres en cosecha.
- Si `hasta_trim` es `Q4`, o está vacío, el año `hasta` se mantiene.

**Estado 2, POST-COSECHA:**
- Si `anio_cosecha > 0`, incluye **solo el año `anio_cosecha + 1`**. Lo mismo con `anio_cosecha2`.
- No lo incluyas si ese año ya es adulto en el otro ciclo.

**Quedan fuera:**
- Los años entre el fin de la fase adulta y la cosecha completa.
- El año de cosecha.
- Los años jóvenes o intermedios.
- Los años posteriores a `anio_cosecha + 1`.
- Los años que no existen en el mosaico (el mosaico va de 1996 a 2026).

**Ejemplo real** (`c79_CONAF_e9_v1`):
```
a_adulta = 1998…2009, a_adulta_hasta = 2009, a_adulta_hasta_trim = Q2, anio_cosecha = 2009 (Q3)
a_adulta2 = 2013…2023, a_adulta2_hasta = 2023, a_adulta2_hasta_trim = Q2, anio_cosecha2 = 2023 (Q3)
→ adulta ciclo 1: 1998–2008   (2009 se quita: termina en Q2)
→ post-cosecha ciclo 1: 2010
→ adulta ciclo 2: 2013–2022   (2023 se quita)
→ post-cosecha ciclo 2: 2024
```

## 4. Qué extraer para cada polígono-año

Para cada año `y` con registros:

1. **Mosaico:** `ImageCollection(mosaico).filter(year == y).mosaic()`. Conserva **todas las bandas**, incluidas `Q*_nobs` y `valid_q`; sirven para filtrar calidad después.

2. **Índices por trimestre:** para cada `p` en `Q1_`, `Q2_`, `Q3_`, `Q4_`. La reflectancia está escalada ×10000; confírmalo.
   - `p+'ndvi'` = normalizedDifference(`p+'nir_median'`, `p+'red_median'`)
   - `p+'ndmi'` = normalizedDifference(`p+'nir_median'`, `p+'swir1_median'`)
   - `p+'nbr'` = normalizedDifference(`p+'nir_median'`, `p+'swir2_median'`)
   - `p+'evi2'` = 2.5·(NIR−RED)/(NIR+2.4·RED+1), con NIR y RED divididos por 10000

3. **Fenología CIM:** agrégala con el prefijo `fen_` en todas sus bandas, para evitar choques de nombre.
   - Si es una ImageCollection con imágenes por año, usa la de ese año.
   - Si es una sola imagen, úsala igual para todos los años.

4. **Máscara de ecorregión:** enmascara con `ecorregiones_raster == eco`, donde `eco` es la ecorregión del nombre del archivo. Así, cada tabla solo contiene píxeles de su ecorregión, aunque un polígono cruce el límite.

5. **Muestreo:** `sampleRegions` sobre los polígonos de ese año, con `scale = 30`, `geometries = True` y `tileScale` entre 8 y 16. Se exportan **TODOS los píxeles** de cada polígono (los píxeles cuyo centro cae dentro), **sin submuestreo**.

Antes de muestrear, filtra los polígonos con `filterBounds` usando el rectángulo del vector de la ecorregión. Eso reduce mucho el cálculo.

**Importante:** el script de clasificación tiene que usar exactamente la misma función para construir el stack (mosaico, índices y fenología). Déjala como una función reutilizable.

## 5. Formato de salida

- **Una tabla por base**, con **el mismo nombre que el archivo de origen**. Por ejemplo: `REVISIONES/c79_CONAF_e9_v1` → `MODEL_SAMPLES/c79_CONAF_e9_v1`.
- Exporta con `ee.batch.Export.table.toAsset`. Si una base es muy grande y la tarea falla, divídela por año o por rango de años: `{nombre}_{año}`.

**Propiedades de cada punto:**
- Todas las bandas: mosaico, índices y `fen_*`.
- `mb_id`: 79 u 80.
- `estado`: 1 = adulta, 2 = post-cosecha.
- `ciclo`: 1 o 2.
- `yr`: año del mosaico usado.
- `id_poly`: ID del polígono de origen. Es clave para hacer el split train/test **por polígono**.
- `eco`: número de ecorregión.
- `fuente_asset`: nombre del archivo de origen.
- `version_ext`: versión de esta extracción, por ejemplo `v1`.
- Atributos temporales copiados del polígono: `tipo_muestra`, `origen`, `a_adulta_desde`, `a_adulta_hasta`, `a_adulta_hasta_trim`, `anio_cosecha`, `trimestre_cosecha` y los equivalentes del ciclo 2.
- La geometría del punto.

**No copies** campos largos o irrelevantes como `observaciones`, `NOM_PREDIO`, `a_joven` o `a_plant`.

No hagas split train/test, balanceo ni submuestreo. Eso se decide después, en el entrenamiento.

## 6. Validaciones antes de exportar

Para cada base seleccionada, imprime:
1. El número de polígonos, y cuántos se excluyeron por `descartar`.
2. Los registros polígono-año por `estado`, y por `yr` dentro de cada estado.
3. La expansión de 2 o 3 polígonos de ejemplo, comparada con sus columnas originales, para verificar la regla del trimestre.
4. Una estimación del número de píxeles a exportar: suma de área / 900 m² sobre todos los polígono-año.
5. La lista final de bandas del stack de un año de prueba.

Haz primero una **prueba con una sola base y un solo año** antes de lanzar todo.

## 7. Advertencias

- No uses `Año_Adult` para cruzar con el mosaico.
- No mezcles las bases `col3MB` y `CONAF` en una misma tabla.
- No uses `getInfo()` sobre colecciones grandes. Arma todo server-side y deja el trabajo pesado a las tareas batch.
- El volumen puede ser alto: un polígono adulto durante 25 años se exporta 25 veces. Reporta la estimación de píxeles por base antes de exportar.
- La carpeta `MODEL_SAMPLES` debe existir. Si no existe, créala con `ee.data.createAsset({'type': 'FOLDER'}, ruta)`.
