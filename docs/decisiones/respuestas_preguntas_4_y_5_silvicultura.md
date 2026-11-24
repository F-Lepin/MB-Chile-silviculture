# Silvicultura — preguntas 4 y 5

## 4. Umbral de consistencia espacial de especie (S5)

**Pregunta.** ¿En píxeles, hectáreas o porcentaje? Sin umbral, el paso no se activa.

**Explicación.** Pino y eucalipto se confunden en la clasificación. S5 corrige este caso: una mancha chica de una especie pegada a una mancha mayor de la otra se pasa a la especie del vecino. El umbral define qué tan chica debe ser esa mancha para cambiarla.

**Respuesta.** En píxeles, con umbral de 22 px (≈2 ha), a calibrar.

- A 30 m, píxeles y hectáreas son equivalentes (1 px ≈ 0,09 ha), y GEE calcula en píxeles.
- No se usa porcentaje: la regla ya es relativa, porque solo cambia si el vecino de la otra especie es mayor.
- S5 solo reasigna especie y no borra plantación, así que puede ser más generoso que el área mínima (S3).

---

## 5. Retorno de uso

**Pregunta.** ¿El 79 y el 80 cuentan como silvicultura en el retorno de uso del filtro general? Decide si ese paso corre sobre el canal o si lo cubren los tramos de especie.

**Explicación.** El retorno de uso corrige usos que cambian un par de años y vuelven. Por ejemplo, pastura → cultivo → pastura se corrige a pastura. Hay que decidir dos cosas:

1. Si ese filtro trata el 79 (pino) y el 80 (eucalipto) como un solo uso, "silvicultura".
2. Si el paso corre aparte sobre el canal de silvicultura o ya lo cubren los tramos de especie del pipeline (S4).

Esto parte de interpretar "canal" como la capa transversal de silvicultura y de cómo funciona el filtro general; debe confirmarlo quien lo definió.

**Respuesta.** Sí: 79, 80 y 83 cuentan como un solo uso, silvicultura. No se corre el paso aparte sobre el canal, porque los tramos de especie (S4) cubren la consistencia pino/eucalipto.

- El 83 (cosechado) tiene que contar como silvicultura. Si no, una cosecha entre dos años de pino se leería como un uso que se interrumpe y vuelve, y el filtro la rellenaría con pino, borrando la cosecha.
- Pendiente con el equipo: si el filtro general rellena años sueltos de "otras" entre dos años de silvicultura. S4 hoy no los rellena. Si el filtro general tampoco, se agrega a S4.
