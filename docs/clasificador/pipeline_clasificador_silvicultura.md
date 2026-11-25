# Pipeline del clasificador de silvicultura

MapBiomas Chile · Colección 3 · Borrador para discutir con el equipo de clasificación · 11 de noviembre de 2026

## 1. Idea general

El clasificador genera, para cada ecorregión y cada año entre 1996 y 2026, una clasificación preliminar de silvicultura a 30 m con cuatro clases: **pino, eucalipto, otras y cosechado**. Además entrega la probabilidad de cada clase por píxel.

Se basa en **dos Random Forest**: uno de máscara, que separa plantación, otras y cosechado, y uno de especie, que separa pino de eucalipto. Usa mosaicos Landsat trimestrales y un modelo distinto para cada periodo de sensor. La salida alimenta la etapa 1 del pipeline de filtrado, que se describe en otro documento.

**Estado:** todo lo descrito está implementado en la herramienta de clasificación en Google Earth Engine. Los valores de las etapas son los que la herramienta trae por defecto; los que se usaron en la ecorregión 8 están en la última sección.

## 2. Mapa del pipeline

| Etapa | Qué ocurre               | Resultado                                                         |
|-----------|------------------------------|-----------------------------------------------------------------------|
| 1         | Insumos                      | Mosaicos, tablas de muestras, COL2 y ecorregiones                     |
| 2         | Variables predictoras        | 49 variables por píxel y año                                          |
| 3         | Muestras de entrenamiento    | Tabla maestra por ecorregión, con partición de entrenamiento y prueba |
| 4         | Entrenamiento de los modelos | Dos Random Forest por periodo de sensor y métricas de validación      |
| 5         | Clasificación por año        | Probabilidades por clase y decisión de la clase de cada píxel         |
| 6         | Postclasificación            | Clase final, con el área mínima aplicada                              |
| 7         | Exportación                  | Un asset por ecorregión y año, con la clase y las probabilidades      |

## 3. Etapa 1 · Insumos

| Insumo                    | Contenido                                                                                              |
|-------------------------------|------------------------------------------------------------------------------------------------------------|
| Mosaicos Landsat trimestrales | Colección de mosaicos de MapBiomas, un mosaico por año con las cuatro estaciones (Q1 a Q4), 1996–2026.     |
| Muestras de silvicultura      | Polígonos de pino y eucalipto, con los años en que el rodal es adulto y, cuando existe, el año de cosecha. |
| Muestras de otras clases      | Segmentos de la clasificación base. Se excluyen las clases 79, 80, 9 y 27.                                 |
| COL2, plantación (clase 9)    | Máscara de plantación de la Colección 2. Se usa como apoyo en la decisión de la clase.                     |
| Ecorregiones                  | Raster a 30 m y vectores. El clasificador trabaja una ecorregión a la vez.                                 |

## 4. Etapa 2 · Variables predictoras

Cada píxel y año tiene **49 variables**. Se calculan con las mismas fórmulas en la imagen y en las tablas de muestras.

| Grupo             | Variables                                                                                                                           | Cantidad |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------|--------------|
| Bandas por trimestre  | Mediana de azul, verde, rojo, infrarrojo cercano (NIR), SWIR1 y SWIR2, en cada trimestre                                                | 24           |
| Índices por trimestre | NDVI, NDMI, NBR y EVI2, en cada trimestre                                                                                               | 16           |
| Variables anuales     | Amplitud, máximo y mínimo de NDMI; amplitud y máximo de NDVI; trimestre del máximo de NDMI y de NDVI; HAND y TWI (topografía y humedad) | 9            |

Quedan fuera a propósito el número de observaciones por trimestre, los trimestres válidos y las variables de agua y costa (mndwi_max, wet_freq, dist_water y dist_coast).

## 5. Etapa 3 · Muestras de entrenamiento

Las muestras se arman una sola vez por ecorregión, en una **tabla maestra** con dos periodos (1996–2012 y 2013–2026). Cambiar las ecorregiones de entrenamiento, el número de puntos o la fracción de prueba no obliga a exportarla de nuevo.

| Paso | Qué hace                                                                                                                                                           | Parámetros por defecto                                                       |
|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| M1       | Silvicultura: pino (clase 79) pasa a clase 1 y eucalipto (80) a clase 2. Solo años en que el rodal es adulto y sin polígonos marcados como descartados.                | Lectura de polígonos: 10 %. Máximo 4.000 puntos por periodo y clase              |
| M2       | Otras: segmentos de la clasificación base, sin las clases 79, 80, 9 y 27, que pasan a clase 3. La versión con agricultura agrega muestras de agricultura a la clase 3. | Lectura: 50 %. Agricultura: 30 %                                                 |
| M3       | Cosechado (clase 4): polígonos de silvicultura en el año siguiente al año de cosecha registrado.                                                                       | Lectura: 50 %                                                                    |
| M4       | Partición entrenamiento y prueba por polígono o segmento, no por punto, para evitar que puntos vecinos queden en los dos grupos.                                       | Prueba: 30 %                                                                     |
| M5       | Selección de puntos por clase, al azar y con semilla fija.                                                                                                             | Pino 1.400 · eucalipto 1.400 · otras 4.000 · agricultura 2.000 · cosechado 1.500 |

## 6. Etapa 4 · Entrenamiento

| Paso | Qué hace                                                                                                                                                                                 | Parámetros por defecto                                                    |
|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| E1       | Modelo de máscara. Random Forest de tres clases: plantación (pino y eucalipto juntos), otras y cosechado.                                                                                    | 40 árboles, hoja mínima de 2 muestras, 50 % de muestras por árbol, semilla 42 |
| E2       | Modelo de especie. Random Forest entrenado solo con pino y eucalipto.                                                                                                                        | Mismos parámetros y las mismas 49 variables                                   |
| E3       | Un modelo por periodo de sensor. Cada año usa el modelo de su periodo.                                                                                                                       | Landsat 5/7: 1996–2012 · Landsat 8/9: 2013–2026                               |
| E4       | Ecorregiones. Las ecorregiones 7 a 11 tienen muestras propias. La 5 y la 12 no, y se clasifican con un modelo entrenado en otras ecorregiones, para evaluar si hacen falta muestras propias. | Ecorregiones de entrenamiento configurables                                   |
| E5       | Validación con el 30 % de prueba: matriz de confusión, exactitud global, exactitud del productor y del usuario por clase, e importancia de variables.                                        | —                                                                             |

## 7. Etapa 5 · Clasificación por año

Se aplica a cada píxel, con el modelo del periodo que corresponde al año.

| Paso | Qué hace                                                                                                                                                                                                         | Parámetros por defecto                                |
|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|
| C1       | Probabilidades. El modelo de máscara entrega P(plantación), P(otras) y P(cosechado). El modelo de especie entrega P(pino).                                                                                           | —                                                         |
| C2       | Cosechado. Solo dentro de COL2. Gana si su probabilidad es la mayor de las tres. Fuera de COL2 no se asigna cosechado.                                                                                               | —                                                         |
| C3       | Plantación, con guía de COL2. Dentro de COL2 se exige una probabilidad de plantación baja, porque COL2 la respalda. Fuera de COL2 se exige una alta. Un píxel de cosechado no cuenta como plantación.                | Dentro de COL2: P ≥ 0,4 · Fuera de COL2: P ≥ 0,85         |
| C4       | Especie. En los píxeles de plantación, P(pino) se suaviza con el promedio de una ventana cuadrada. Es pino si el valor es de 0,5 o más, y eucalipto si no. Opcionalmente se promedia entre años (consenso temporal). | Radio 3 px (ventana de 7 × 7). Consenso temporal: apagado |
| C5       | Resto. Todo píxel que no es plantación ni cosechado queda como otras.                                                                                                                                                | —                                                         |

## 8. Etapa 6 · Postclasificación

| Paso | Qué hace                                                                                                                                                                                       | Parámetros por defecto            |
|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------|
| P1       | Área mínima. Un parche conexo (8 vecinos) de pino o de eucalipto menor al umbral pasa a otras. Se evalúa por clase: un parche mixto de 11 px de pino y 11 px de eucalipto no pasa el filtro de 22. | Umbral: 22 px (≈ 2 ha; 1 px = 900 m²) |

## 9. Etapa 7 · Exportación

Un asset por ecorregión y año, con nombre **silvo_e{ecorregión}\_{año}\_{versión}**, en la carpeta de clasificaciones preliminares de silvicultura. Se exporta a 30 m, sobre la ecorregión, y los años que ya existen se omiten. Se puede exportar cualquier año sin tenerlo cargado en el mapa.

**Relleno de vacíos.** Al exportar, un píxel sin clasificar en un año (al mosaico le faltaba algún predictor) toma la clasificación del año más cercano que sí tiene dato, hasta 3 años (editable) y con prioridad al año anterior a igual distancia. Los años vecinos se clasifican con el mismo modelo. Se rellenan la clase y las probabilidades, y el asset agrega la banda `año_origen` y las propiedades `relleno`, `relleno_max_dist` y `relleno_prioridad`. Es la misma regla del paso S1 del pipeline de filtros, que con este relleno ya no tiene nada que hacer.

**Partición train/test.** La partición se decide al entrenar, por polígono (test si `azar_poly` < fracción de test) y no se guarda en las maestras. El panel Exportar permite guardar los puntos usados en una tabla `split_e{ecos}_{ini}-{fin}_{versión}`, con la columna `conjunto` (train / test) y, como propiedades, la fracción de test, los puntos por clase y la semilla.

**Buffer.** Desde la versión con buffer, el clasificador clasifica y exporta además de la ecorregión una franja de **5 km** a su alrededor (parámetro editable en el panel Muestreo; 0 = sin franja). Se usa el modelo de la propia ecorregión. Así los filtros espaciales no cortan los parches que cruzan el límite y se evita la costura entre ecorregiones. La franja se arma con un buffer del vector de la ecorregión sumado a los píxeles del raster de ecorregiones. Las ecorregiones vecinas **se solapan** en la franja, por lo que al contar áreas o integrar hay que recortar cada asset a su propia ecorregión. El asset guarda la propiedad `buffer_km`.

| Banda              | Contenido                                           |
|------------------------|---------------------------------------------------------|
| silvicultura (banda 0) | Clase: 1 pino, 2 eucalipto, 3 otras, 4 cosechado        |
| p_pino                 | P(plantación) × P(pino), de 0 a 100                     |
| p_euca                 | P(plantación) × (1 − P(pino)), de 0 a 100               |
| p_cosechado            | P(cosechado) del modelo de máscara, de 0 a 100          |
| p_otras                | P(otras) del modelo de máscara, de 0 a 100              |
| probabilidad           | Probabilidad de la clase que quedó asignada, de 0 a 100 |

Las cuatro probabilidades por clase suman cerca de 100. La clase final no siempre es la de mayor probabilidad, porque la guía de COL2, el cosechado solo dentro de COL2 y el área mínima actúan sobre el resultado. Cada asset guarda como propiedades los parámetros con que se generó: árboles, radio, área mínima, umbrales, consenso, modelo por periodo y ecorregiones de entrenamiento.

## 10. Pendientes

1.  **Área mínima:** el umbral de 22 px es el actual. El filtro general del equipo usa 11 px, y la decisión se discute en el documento del pipeline de filtrado.

2.  **Ecorregiones 5 y 12:** falta evaluar el resultado del modelo transferido y decidir si hacen falta muestras propias.

3.  **Consistencia temporal:** el consenso de especie entre años viene apagado por defecto, y en la ecorregión 8 se usó activado. Además, se propone resolver la consistencia temporal en el pipeline de filtrado, antes de integrar.

## 11. Para replicar E8

Parámetros con que se clasificó la ecorregión 8, tal como están en el panel de la herramienta. Se usa el modelo estándar por grupo de sensores: un modelo para Landsat 5/7 y otro para Landsat 8/9.

| Grupo     | Parámetro                          | Valor en E8                                                                                                                    |
|---------------|----------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Modelo        | Tipo de modelo                         | Máscara de plantación + modelo de especie                                                                                          |
|               | Periodo                                | Automático: un modelo por grupo de sensores (Landsat 5/7: 1996–2012 · Landsat 8/9: 2013–2026)                                      |
|               | Ecorregión de entrenamiento            | E8, con muestras propias                                                                                                           |
|               | Árboles del Random Forest              | 40                                                                                                                                 |
| Muestras      | Muestras de fondo                      | v2: silvicultura contra otras y agricultura (tabla maestra train_master_e8_v4)                                                     |
|               | Tabla de cosechado                     | train_cosecha_e8_v2                                                                                                                |
|               | Pino, puntos de entrenamiento          | 2.000                                                                                                                              |
|               | Eucalipto, puntos de entrenamiento     | 3.000                                                                                                                              |
|               | Otras, puntos de entrenamiento         | 4.000                                                                                                                              |
|               | Agricultura, puntos de entrenamiento   | 2.000                                                                                                                              |
|               | Cosechado, puntos de entrenamiento     | 2.000                                                                                                                              |
|               | Fracción de prueba                     | 0,3                                                                                                                                |
| Tabla maestra | Máximo de puntos por periodo y clase   | 4.000                                                                                                                              |
|               | Lectura de silvicultura                | 0,1                                                                                                                                |
|               | Lectura de otras (base)                | 0,5                                                                                                                                |
|               | Lectura de agricultura                 | 0,3                                                                                                                                |
|               | Lectura de cosechado                   | 0,5                                                                                                                                |
| Clasificación | Suavizado de especie                   | Radio de 3 px                                                                                                                      |
|               | Consenso temporal de especie           | Activado. Promedia P(pino) entre los años seleccionados al exportar, así que para replicar hay que usar la misma selección de años |
|               | Área mínima de parche pino y eucalipto | 22 px                                                                                                                              |
|               | Guía COL2 para plantación              | Activada. P mínima dentro de COL2: 0,5. P mínima fuera de COL2: 0,85                                                               |
|               | Buffer alrededor de la ecorregión      | 0 km para replicar versiones exportadas antes del buffer; 5 km por defecto en las nuevas                                           |

Estos parámetros quedan fijos en el código y no se cambian desde el panel: semilla 42, hoja mínima de 2 muestras, 50 % de muestras por árbol y, para el cosechado, el año siguiente al año de cosecha registrado.
