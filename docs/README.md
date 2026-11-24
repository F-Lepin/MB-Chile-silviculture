# Documentos

| Carpeta | Contenido |
| --- | --- |
| `clasificador/` | Pipeline del clasificador (md, docx y pdf) y `build.js`, que genera el docx. |
| `filtros/` | Pipeline de filtrado S1–S6 (md, docx y pdf) y `build.js`. Falta incorporar las decisiones recientes (11 px, 22 px, fuego 2013–2025, código 83). |
| `decisiones/` | Respuestas a los pendientes del equipo: pregunta, explicación y respuesta. |
| `prompts/` | Especificaciones de apoyo: exportación de muestras y análisis de separabilidad pino/eucalipto. |

Para regenerar un docx: `npm install docx` y, dentro de la carpeta, `node build.js`.
