# Pipeline de filtrado de la clasificación de silvicultura

MapBiomas Chile · Colección 3 · Borrador para discutir con el equipo de clasificación · 12 de noviembre de 2026 · S4 actualizado el 26 de noviembre de 2026 (cosecha implícita)

## 1. Idea general

La clasificación preliminar de silvicultura (pino, eucalipto y cosechado) se integra a la clasificación preliminar general y **sobre la serie integrada** se aplican los filtros. Se filtra después de integrar porque los filtros temporales y el área mínima necesitan ver todas las clases juntas.

Principio de trabajo: **no duplicar filtros**. Los filtros comunes los aplica el equipo general a todas las clases, silvicultura incluida. Del lado de silvicultura se hace, antes de integrar, lo que el filtro general no puede hacer: relleno de huecos de mosaico, corrección del cosechado que en realidad es bosque quemado (con MapBiomas Fuego), consistencia temporal y espacial de la especie usando probabilidades, y las reglas propias del cosechado.

**Estado actual:** hoy solo se exporta la clasificación preliminar de silvicultura, con sus bandas de probabilidad por clase. Ninguna de las etapas siguientes está aplicada todavía: este documento describe la propuesta. Una excepción parcial: la corrección por incendios (S2) ya existe como cálculo en la nube en el revisor por regiones, solo para estadísticas y sin exportar nada.

## 2. Mapa del pipeline

| Etapa | Qué ocurre | Quién / tipo | Estado |
|---|---|---|---|
| 1 | Preparar silvicultura: relleno de huecos, corrección por incendios, área mínima, consistencia temporal y espacial de la especie, reclasificación a códigos finales | Específico de silvicultura | Reglas definidas; faltan 2 umbrales. S2 probada en el revisor |
| 2 | Integrar la clasificación de silvicultura sobre la clasificación general | Integración | Por definir prioridad entre transversales |
| 3 | Filtros generales sobre la serie integrada (silvicultura entra) | Equipo general | Verificar 2 pasos |
| 4 | Control de calidad: hectáreas corregidas por paso, series por región, comparación con COL2 | Ambos equipos | Revisores existentes; hay que actualizar sus filtros |
| 5 | Exportación final | — | — |

Pasos S1 a S6: específicos de silvicultura (etapa 1). Pasos G1 a G10: filtros generales del equipo (etapa 3). En negrita se marca lo que está por decidir o verificar.

## 3. Etapa 1 · Preparar silvicultura (antes de integrar)

Los pasos se aplican por píxel y en este orden. Usan datos de silvicultura, incluidas las probabilidades por clase que el filtro general no ve, y en S2 el producto anual de MapBiomas Fuego.

| Paso | Qué hace | Parámetros | ¿Lo cubre el filtro general? |
|---|---|---|---|
| S1 | **Relleno de huecos de mosaico.** Un año con mosaico incompleto se rellena con el año vecino más cercano. 1996 se rellena con años posteriores y 2026 con años anteriores. | Distancia máxima: 3 años | No. G1 solo rellena píxeles en 0 y no rellena el último año. |
| S2 | **Corrección por incendios.** El clasificador confunde el bosque quemado con cosechado. Si un tramo de cosechado empieza el año de un incendio de MapBiomas Fuego (o poco después), todo el tramo vuelve al último pino o eucalipto que tuvo el píxel. Cosechado nunca pasa a "otras". Detalle y ejemplos más abajo. | Desfase incendio → cosechado: 1 año<br>Búsqueda del pino/euca previo: hasta 5 años atrás<br>Años sin dato de fuego: no se corrige | No. La clasificación general no trae información de fuego ni distingue cosecha de quema. |
| S3 | **Área mínima.** Un parche de pino o de eucalipto menor al umbral pasa a otras. | Umbral: por decidir (hoy 22 px ≈ 2 ha) | Sí, G9 (11 px, espacio-temporal). Un paso propio solo se justifica con un umbral mayor. |
| S4 | **Consistencia temporal por tramos.** Corta la serie de cada píxel en tramos y asigna una sola especie por tramo. Solo se permite el cambio pino → euca, y solo con una cosecha detectada, un incendio o un hueco de 5 años o más de "otras" en medio. Regla de base: **una plantación no pasa a "otras" sin una cosecha en medio**; si el clasificador no la vio, se marca como cosecha implícita. También regula cuánto dura la cosecha y qué pasa después. Detalle y ejemplos más abajo. | Años de "otras" que cortan el tramo: 5<br>Ventana posterior a la cosecha: 5 años<br>Último año confiable: 2025 (2026 no cuenta como dato)<br>Duración mínima de una plantación nueva: 3 años (0 = apagado)<br>Cosecha implícita: 2 años (0 = apagado) | Parcial. G6 y G7 suavizan oscilaciones simétricas, si incluyen 79/80. G4 conserva la cosecha entre años de silvicultura, lo contrario de esta regla. No existe una regla direccional ni de cosecha de un año. |
| S5 | **Consistencia espacial de especie.** Dentro de un parche, un fragmento de la especie minoritaria menor al umbral, en contacto con la mayoritaria, pasa a la mayoritaria si S4 no lo resolvió.<br>Se trabaja por fragmentos y no por porcentaje del parche, porque los rodales vecinos de especies distintas son normales. | Umbral: por decidir (píxeles, hectáreas o porcentaje) | Casi no. G9 solo absorbe fragmentos de hasta 11 px. |
| S6 | **Reclasificar a códigos finales.** Pino → 79 · eucalipto → 80 · cosechado → 83 (otros usos forestales). Otras = sin transversal: queda la clase base. | — | No aplica. |

**Con la cosecha implícita y el retorno de 5 años de S4, el relleno de huecos de G4 queda prácticamente sin trabajo propio en la serie de silvicultura.** Aunque el equipo general confirme que G4 trata 79, 80 y 83 como silvicultura, la cosecha implícita sigue siendo necesaria, porque G4 rellena huecos pero no inserta cosechas.

**Coherencia con el retorno de uso (G4):** G4 rellena huecos de hasta 5 años entre dos años de silvicultura, con la clase de cada lado. Como S4 deja una sola especie por tramo, esos huecos se rellenan con la misma especie en ambos lados. Si el hueco es de exactamente 5 años, S4 lo trata como corte y G4 lo rellena con la especie de cada lado, de modo que el cambio pino → euca queda en la mitad del hueco. Si es de 6 años o más, S4 también lo corta, pero G4 no lo rellena y los años quedan como "otras".

### Detalle de S2

- **Cuándo corrige:** un tramo de años seguidos como cosechado (C) empieza el año de un incendio, o hasta 1 año después. Se cruza con el producto anual de MapBiomas Fuego, que se combina por año si hay varias imágenes.
- **A qué clase vuelve:** todo el tramo toma el último pino o eucalipto que tuvo el píxel antes de empezar, buscando hasta 5 años atrás y saltando los años de "otras" por ruido. Si no hubo pino ni eucalipto en ese rango, el cosechado se deja como está.
- **Qué no toca:** una cosecha sin incendio, y un incendio que ocurre cuando el tramo de cosechado ya había empezado (puede ser quema de residuos tras una cosecha real).
- **Orden:** va antes de S4. Así un bosque quemado no cuenta como cosecha. Sí cuenta como corte: S4 recibe qué años corrigió S2, y el final de ese incendio abre un tramo nuevo, lo que habilita el cambio pino → euca y la ventana de replante.
- **Años sin dato de fuego:** no se corrigen. En las pruebas el efecto aparece desde 2014 aproximadamente; hay que confirmar desde qué año hay dato.

Ejemplos. P = pino, E = eucalipto, C = cosechado, O = otras. Cada casillero es un año; la primera columna dice dónde ocurre el incendio.

| Caso | Antes | Después | Por qué |
|---|---|---|---|
| 1. Incendio el año en que empieza el cosechado | P P C C O O | P P P P O O | El tramo C C coincide con un incendio: vuelve a pino. |
| 2. Incendio un año antes del cosechado | E E E C C O | E E E E E O | Dentro del desfase de 1 año: vuelve a eucalipto. |
| 3. Incendio, con "otras" por ruido antes del cosechado | P O C C O O | P O P P O O | Salta el ruido y toma el último pino. Nunca queda como "otras". |
| 4. Cosecha real, sin incendio | E E C C E E | Sin cambios | Sin incendio no se corrige. |
| 5. Incendio, pero sin pino ni eucalipto previo | O O C C O O | Sin cambios | No hay clase de plantación a la que volver. |
| 6. Incendio en medio de un tramo ya cosechado | P P C C C O | Sin cambios | El tramo ya había empezado: puede ser quema tras la cosecha. |

### Detalle de S4

- **Duración mínima (paso previo, parámetro `duracionMinima`, por defecto 3):** una plantación nueva que dura menos de 3 años, con "otras" el año anterior y el siguiente y sin cosecha en medio, se considera un falso positivo y vuelve a "otras". No se borra: (1) un replante, es decir, si antes hubo silvicultura o cosecha y entre ella y la racha hay menos de 5 años de "otras"; (2) una racha que empieza en el primer año de la serie (ya existía); (3) una racha que termina en 2024 o después, que todavía no se puede juzgar; (4) una racha seguida de una cosecha detectada. Se recorre en orden, así que una racha borrada ya no cuenta como plantación previa, y sus años no votan por la especie. Corre antes de la cosecha implícita, para no agregarle una cosecha a algo que se borra. Con 0 el paso queda apagado.
- **Cosecha implícita (paso previo, parámetro `cosechaImplicita`, por defecto 2):** un año de "otras" justo después de un año de silvicultura se marca como cosechado, como una cosecha que el clasificador no detectó. Desde ahí siguen las reglas de abajo: si la silvicultura vuelve dentro de 5 años, los años intermedios toman esa especie; si no, queda "otras". Dos excepciones: (1) si la racha de "otras" dura menos años que el parámetro y la silvicultura vuelve justo después, no se marca cosecha y los años se rellenan con la clase anterior (evita puntos de cosechado de un año cuando el clasificador solo parpadea); (2) un año posterior al último año confiable (2026) no cuenta como dato y continúa con la clase del año anterior. Con 0 el paso queda apagado.
- **Cortes de la serie:** cada año de cosecha detectada, el final de un incendio que S2 corrigió (los años quemados siguen con la especie previa y lo que viene después es un tramo nuevo), y cada tramo de al menos 5 años consecutivos de "otras" entre dos años de silvicultura. La cosecha implícita no es un corte: para efectos del cambio de especie cuenta como "otras", así que entre pino y eucalipto con menos de 5 años de "otras" y sin cosecha detectada ni incendio, el tramo mantiene una sola especie.
- **Especie por tramo:** cada tramo toma una sola especie, por votación ponderada con p_pino y p_euca de sus años.
- **Cambio de especie:** solo pino → euca, y solo en un corte. Euca → pino no se permite, ni siquiera con cosecha en medio. Si un tramo euca viene antes de uno pino, se elige el punto de cambio que mejor concuerda con las probabilidades.
- **Cosecha de un solo año:** si dura más, los años siguientes toman la clase de silvicultura detectada después.
- **Después de una cosecha, con al menos 5 años de datos posteriores:** si en esos 5 años no se detecta silvicultura, los años siguientes quedan en "otras", la clase de la clasificación base.
- **Cosechas recientes, sin 5 años de datos posteriores (desde 2021):** no se puede concluir, así que los años siguientes continúan con la clase de silvicultura anterior a la cosecha.

Ejemplos. P = pino, E = eucalipto, C = cosechado, O = otras. Cada casillero es un año.

| Caso | Antes | Después | Por qué |
|---|---|---|---|
| 1. Sin cosecha, la especie oscila | P P E P P P | P P P P P P | Sin cosecha no hay cambio de especie: gana la especie con más probabilidad en el tramo. |
| 2. Cambio con cosecha en medio | P P P C E E | P P P C E E | Pino → euca con una cosecha en medio es válido: no se toca. |
| 3. Euca → pino | E E C P P P | E E C E E E, o P P C P P P | Euca → pino no se permite. Queda la opción que mejor concuerda con las probabilidades. |
| 4. Cosecha de más de un año, con silvicultura después | P P C C C P | P P C P P P | La cosecha dura un año. Los años siguientes toman la clase detectada después. |
| 5. Cosecha sin silvicultura en los 5 años siguientes | P P C C C C C C | P P C O O O O O | La cosecha dura un año. Sin silvicultura en 5 años, lo que sigue queda en "otras". |
| 6. Cosecha reciente (2022), sin 5 años de datos después. Serie 2020 a 2026 | P P C C O O O | P P C P P P P | Con 2026 sin contar como dato, no hay 5 años: los años siguientes continúan con pino. |
| 7. Cinco años de "otras" entre dos especies, sin cosecha detectada | P P O O O O O E E | P P C E E E E E E | La cosecha implícita permite el cambio pino → euca, y los años siguientes toman la euca. |
| 8. Hueco de "otras" sin cosecha, silvicultura vuelve en 3 años | P P P O O O P P P | P P P C P P P P P | Una plantación no pasa a "otras" sin cosecha: se marca en el primer año y la silvicultura vuelve dentro de la ventana. |
| 9. Parpadeo de un año | P P P P O P P P | P P P P P P P P | Racha de "otras" menor al parámetro con silvicultura a ambos lados: se rellena y no se crea una cosecha de un año. |
| 10. Hueco de 6 años | P P P O O O O O O P P | P P P C O O O O O P P | La silvicultura vuelve fuera de la ventana de 5 años: cosecha y luego "otras". |
| 11. La plantación no vuelve | P P P P P O O O O O O O | P P P P P C O O O O O O | Queda marcada la cosecha que el clasificador no vio y después "otras". |
| 12. Plantación nueva de 2 años | O O O P P O O O O O O O | O O O O O O O O O O O O | Dura menos de 3 años y desaparece sin cosecha: es un falso positivo y se borra. |
| 13. Plantación nueva de 3 años | O O O P P P O O O O O O | O O O P P P C O O O O O | Dura 3 años: se conserva y queda marcada su cosecha. |
| 14. Replante corto tras una cosecha | P P P C O P P O O O O O | P P P C P P P C O O O O | Viene de una cosecha con menos de 5 años de "otras": es un replante, no se borra. |
| 15. Pino, 1 año de "otras" y eucalipto, sin cosecha detectada | P P P P O E E E E | P P P P P P P P P | La cosecha implícita no habilita el cambio de especie con menos de 5 años de "otras": el tramo queda con una sola especie. |
| 16. Pino, cosecha detectada y eucalipto | P P P C O E E E | P P P C E E E E | Con cosecha detectada sí se permite el cambio. |

## 4. Etapa 2 · Integración

La clasificación general no trae información de silvicultura, así que no hay conflicto con otra clase de plantación: silvicultura se agrega encima. Donde es pino (79), eucalipto (80) o cosechado (83), esa clase reemplaza a la clase base. Donde es "otras", se conserva la clase base. Prioridades frente a otras clases:

- **Definido:** silvicultura no sobrescribe agua (33) ni glaciar/nieve (34) de la clasificación general.
- **Por definir:** prioridad frente a las demás clases transversales (infraestructura, salar, aflor rocoso, arena/playa, humedal y turberas). Se resuelve en el orden de integración de las transversales: hay que decidir cuál prevalece cuando se superponen con silvicultura.

## 5. Etapa 3 · Filtros generales (silvicultura entra)

G1 a G10 son los 10 pasos del escenario 1 (reglas) de la presentación del equipo general, "Filtros de la Colección 3", en su orden. La columna "Aplica a silvicultura" es una lectura de esa presentación; los pasos en naranja hay que confirmarlos en el código del equipo (carpeta filters/). E03 y E05 son las ecorregiones de prueba de esa presentación.

| Paso | Qué hace | Aplica a silvicultura | Comentario |
|---|---|---|---|
| G1 | Relleno de huecos: hasta 3 años se copia el año anterior; al inicio, el siguiente; el final no se rellena. | Sí, solo píxeles en 0 | Nuestros huecos ya se rellenan en S1; aquí actúa sobre lo que quede en 0. |
| G2 | Moda dirigida: en E05 reescribe humedal si agricultura ocupa ≥60 % de la ventana ±2 años. | No | Es una regla de humedal y agricultura. |
| G3 | Frecuencia de vegetación natural: si ≥70 % de los años pertenece a un grupo, pasan a la clase más frecuente. | No | Solo vegetación natural. |
| G4 | Retorno de uso: entre dos años de silvicultura separados ≤5 años, la primera mitad copia el inicio y la segunda el final. La cosecha no se rellena. | Sí | Cubre la parte "vuelve" de un filtro silvo → otras. Confirmar que 79 y 80 cuentan como silvicultura y que el 83 se trata como cosecha (en los ejemplos es el 94); si no, el 83 podría rellenarse. |
| G5 | Transiciones prohibidas: bosque primario tras otra clase pasa a secundario; infraestructura suelta se borra. | No | Reglas de bosque e infraestructura. |
| G6 | Oscilación: un cambio corto se conserva solo si las dos direcciones coinciden. Tope 3 años. | A verificar | Los ejemplos son de matorral y estepa. Confirmar si incluye 79/80. |
| G7 | Incidencia: si el píxel cambia más de 6 veces, los años reescribibles pasan a la clase más frecuente. | A verificar | No toca agua, glaciar, infraestructura, relaves ni sin dato. Confirmar si 79/80 son reescribibles. |
| G8 | Bordes: solo 1996 y 2026. Copia el año vecino si los dos siguientes son la misma clase. Parche ≤22 px. | Sí | Complementa S1: corrige parches chicos en los extremos. |
| G9 | Área mínima espacio-temporal: volumen = misma clase, 8 vecinos y mismo píxel entre años; si el año más grande tiene ≤11 px, se reemplaza. | Sí | Se superpone con nuestra área mínima (ver S3). |
| G10 | Correcciones manuales: solo corren si se entrega un archivo. | Sí, si hay archivo | En E03 y E05 no hay archivo preparado. |

**Escenario 2 (HMM / Viterbi):** reemplaza G1, G2, G3, G5, G6, G7 y G8. Después corren G4 (retorno de uso), G9 (área mínima) y G10 (correcciones manuales). Si el equipo elige este escenario, silvicultura queda cubierta por Viterbi en lo temporal. Nuestro relleno S1 sigue siendo necesario, porque corre antes de integrar.

## 6. Etapas 4 y 5 · Control de calidad y exportación

- **Hectáreas corregidas por paso**, por región, para ver qué filtro cambia cuánto.
- **Series de pino, eucalipto y cosechado por región**, antes y después de filtrar, con el revisor por regiones político-administrativas.
- **Efecto de la corrección por incendios:** gráfico de barras con la diferencia por clase (corregido menos sin corregir), calculado en la misma llamada para que la comparación sea exacta.
- **Capa de píxeles corregidos** en el revisor por ecorregión, para inspeccionar dónde actúa cada filtro.
- **Comparación con COL2** para detectar pérdidas o ganancias anómalas.
- **Exportación final:** la clasificación integrada y filtrada. Las probabilidades por clase de silvicultura quedan disponibles aparte, en el asset de silvicultura.

## 7. Decisiones y preguntas para el equipo

1. **Dónde corren los filtros y sobre qué entrada:** en GEE o fuera (por ejemplo en Python sobre rasters exportados), y si se aplican después de integrar las transversales.
2. **Prioridad al integrar:** silvicultura no sobrescribe agua ni glaciar. Falta el orden de prioridad frente a las demás transversales (infraestructura, salar, aflor rocoso, arena/playa, humedal y turberas).
3. **Códigos:** si 79 y 80 cuentan como silvicultura en G4 a G9 (los ejemplos de retorno de uso usan 9, 92, 93 y 94, y la leyenda trae 9, 79 y 80), y si su función puede configurarse para tratar el 83 como cosecha, porque en los ejemplos la cosecha es el 94.
4. **Producto de fuego (S2):** desde qué año tiene datos MapBiomas Fuego (hoy parece ser desde 2013 o 2014) y qué hacer en los años anteriores, donde los incendios siguen inflando el cosechado.
5. **Parámetros de S2:** desfase de 1 año entre incendio y cosechado, y búsqueda de hasta 5 años atrás. Ajustar tras una revisión visual en zonas de incendios grandes (2017 y 2023).
6. **Oscilación e incidencia (G6 y G7):** si actúan sobre silvicultura.
7. **Escenario:** reglas (1) o HMM (2).
8. **Área mínima (S3):** qué umbral usar y si hace falta un paso propio además de G9 (11 px).
9. **Consistencia espacial (S5):** umbral de la especie minoritaria dentro del parche.
