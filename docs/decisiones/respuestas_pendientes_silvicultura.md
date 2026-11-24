# Silvicultura — respuestas a los pendientes del equipo

18 de noviembre de 2026

Cada punto tiene la pregunta del equipo, qué se está preguntando y la respuesta. Los puntos 1 y 2 son decisiones ya tomadas; los puntos 3 a 5 son propuestas de la UFRO.

---

## 1. Código del cosechado: ¿83 o 94?

**Pregunta.** El documento de silvicultura usa 83 y las configuraciones del equipo usan 94. Hay que fijarlo antes de tocar el dominio.

**Explicación.** Es una decisión de leyenda, no técnica. El código del cosechado aparece en el paso S6 (códigos finales) del pipeline y en el documento. Si los dos no coinciden, el cosechado queda con un código distinto según dónde se lea.

**Respuesta.** **83.** Es lo que usan el documento y el script del pipeline (`s6Final`: pino → 79, eucalipto → 80, cosechado → 83). Las configuraciones que usan 94 deben actualizarse a 83.

---

## 2. MapBiomas Fuego: ruta del asset y años con datos

**Pregunta.** Ruta del asset anual y desde qué año tiene datos (el documento estima 2013 o 2014). Es la entrada de la corrección por incendios (S2); sin ella no se corrige.

**Explicación.** S2 reclasifica el cosechado que en realidad es plantación quemada: si un tramo de cosechado empieza el año de un incendio, toma el último pino o eucalipto que tuvo el píxel antes. Para eso necesita saber qué píxeles se quemaron cada año.

**Respuesta.**

- **Asset:** `projects/mapbiomas-chile/assets/FIRE/COLLECTION1/CLASSIFICATION/burned_area_chile_year_11` (MapBiomas Fuego Chile, Colección 1; ImageCollection anual, por año calendario).
- **Años de uso:** **2013 a 2025.** En el script quedan fijados en `FUEGO_AÑO_INI` y `FUEGO_AÑO_FIN`; los años fuera de ese rango se ignoran.
- **Antes de 2013:** S2 no corrige. Los cosechados por incendio de 1996–2012 quedan como cosechado.
- **Ampliación 1996–2012 (en discusión):** usar GABAM (`projects/sat-io/open-datasets/GABAM`). Según su catálogo en GEE es una ImageCollection anual a 30 m, en teselas de 10°, y no tiene los años 1997 y 1999, que quedarían sin corrección. Puntos a discutir:
  - GABAM puede detectar menos incendios que MapBiomas Fuego. Eso crearía un salto artificial en la serie de cosechado en 2012–2013.
  - Si GABAM tiene años en común con MapBiomas Fuego, conviene comparar ambos en esos años antes de decidir.
  - Alternativa: dejar 1996–2012 sin corrección y dejarlo escrito en el documento.

---

## 3. Umbral de área mínima propia (S3)

**Pregunta.** ¿Bastan los 11 px del filtro general o se usa uno mayor? Es para no filtrar dos veces.

**Explicación.** S3 elimina los parches de plantación (pino y eucalipto juntos) demasiado chicos, que pasan a "otras". El filtro general del equipo ya elimina parches de menos de 11 píxeles (≈1 ha). La duda es si S3 debe ser más estricto que eso. Un parche de 15 px (≈1,3 ha) se mantiene con 11 y se elimina con 22. S3 borra plantación, así que no conviene que sea más estricto que el resto de las clases.

**Respuesta.** **11 px (≈1 ha), el mismo del filtro general.** Verificar que el filtro general use la misma conectividad (8 vecinos). Si más adelante se quiere probar un umbral mayor, se compara en la interfaz del pipeline con la capa «Cambios · solo S3».

---

## 4. Umbral de consistencia espacial de especie (S5)

**Pregunta.** ¿En píxeles, hectáreas o porcentaje? Sin umbral, el paso no se activa.

**Explicación.** Pino y eucalipto se confunden en la clasificación. S5 corrige el caso de una mancha chica de una especie pegada a una mancha mayor de la otra: la pasa a la especie del vecino. El umbral define qué tan chica debe ser esa mancha.

**Respuesta.** **En píxeles; umbral 22 px (≈2 ha), a calibrar.**

- A 30 m, píxeles y hectáreas son equivalentes (1 px ≈ 0,09 ha); GEE calcula en píxeles.
- No se usa porcentaje: la regla ya es relativa, porque solo cambia si el vecino de la otra especie es mayor.
- S5 solo reasigna especie y no borra plantación, así que puede ser más generoso que S3.
- Se calibra viendo qué cambia con la capa «Cambios · solo S5».

---

## 5. Retorno de uso

**Pregunta.** ¿El 79 y el 80 cuentan como silvicultura en el retorno de uso del filtro general? Decide si ese paso corre sobre el canal o si lo cubren los tramos de especie.

**Explicación.** El retorno de uso corrige usos que cambian un par de años y vuelven (por ejemplo, pastura → cultivo → pastura se corrige a pastura). Hay que decidir si ese filtro trata el 79 y el 80 como un solo uso, "silvicultura", y si el paso corre aparte sobre el canal de silvicultura o lo cubren los tramos de especie de S4. Esta explicación parte de una interpretación de "canal" como la capa transversal de silvicultura, y de cómo funciona el filtro general sin conocer su definición exacta; debe confirmarla quien lo definió.

**Respuesta.** **Sí: 79, 80 y 83 cuentan como un solo uso, silvicultura.** No se corre el paso aparte sobre el canal: la consistencia pino/eucalipto la cubren los tramos de especie (S4).

- El 83 (cosechado) debe contar como silvicultura. Si no, una cosecha entre dos años de pino se leería como un uso que se interrumpe y vuelve, y el filtro la rellenaría con pino, borrando la cosecha.
- **Pendiente de confirmar con el equipo:** si el filtro general rellena años sueltos de "otras" entre dos años de silvicultura. S4 hoy no los rellena (un año de "otras" entre pino y pino, sin cosecha de por medio, se queda como "otras"). Si el filtro general no lo hace, se agrega a S4.
