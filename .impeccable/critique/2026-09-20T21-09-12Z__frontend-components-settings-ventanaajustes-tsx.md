---
target: ventana de Configuración
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Trabajo\\GSmart\\Mycelium\\frontend\\components\\settings\\VentanaAjustes.tsx"
target_fingerprint: "sha256:b21d2d44e1a6cfb1d54b7951d4b5343a864c8cc1d450ffb67b647353c27dd335"
target_path: "C:\\Trabajo\\GSmart\\Mycelium\\frontend\\components\\settings\\VentanaAjustes.tsx"
timestamp: 2026-09-20T21-09-12Z
slug: frontend-components-settings-ventanaajustes-tsx
---
Method: dual-agent (A: revisión de diseño · B: detector + navegador)

# Crítica de la ventana de Configuración — 19/40

Superficie: `frontend/components/settings/VentanaAjustes.tsx` y las ocho secciones que
monta. Modo Operate. Superficie nueva (2026-09-20): primera corrida, sin tendencia.

## Puntaje

| # | Heurístico | Pts | Hallazgo clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | El resultado de exportar o importar se escribe al pie de un panel de 1.600px |
| 2 | Sistema ↔ mundo real | 2 | «Tus snippets quedan asociados a la cuenta» en la versión sin cuenta |
| 3 | Control y libertad | 1 | Escape o cambiar de categoría descartan el `.mycignore` a medio escribir |
| 4 | Consistencia | 2 | Dos interruptores distintos: 9 botones-con-palabra y 3 píldoras |
| 5 | Prevención de errores | 1 | «Carpeta de Esporas» es texto libre; su error se fija al desmontarse la sección |
| 6 | Reconocer antes que recordar | 2 | El índice del buscador es una lista a mano, ya desincronizada |
| 7 | Flexibilidad | 2 | No hay `Ctrl+,` ni forma de abrir una categoría concreta |
| 8 | Estético y minimalista | 2 | 980×700 fijos: Grafo es 1 control; Vault scrollea 380px |
| 9 | Recuperación de errores | 2 | Los errores son un párrafo final que se pierde al cambiar de categoría |
| 10 | Ayuda | 3 | Es la documentación del producto, y no se llega desde la función que explica |
| **Total** | | **19/40** | Primera corrida |

## Veredicto de especificidad

La prosa está autorada para Mycelium; el contenedor no. Propio: las muestras de atmósfera
(miniaturas de la ventana real repintadas con su combinación) y las explicaciones, que
describen la consecuencia y no el control. Genérico: el marco, que además **se sale del
sistema en cuatro puntos**, siempre hacia lo neutro — velo de paleta en vez de modal, radio
de 8px donde Shapes reserva 16 para modales, fondo Lienzo donde el token dice Niebla, y dos
`input[type=range]` crudos, los únicos controles del SO que quedan en la app.

Detector: **0 hallazgos**, verificado contra falso negativo (sin config, sin ignorados, sin
sistema de diseño; control sobre `components/` → 5 hallazgos, todos fuera de `settings/`).

Navegador: 0 fallos de contraste en las ocho categorías (piso 5.23:1), ningún control sin
marca de foco, sin scroll horizontal. Scroll vertical en Editor (+257px) y Vault (+380px).

## Lo que funciona

- La prosa: anticipa la pregunta siguiente en vez de describir el control.
- Las muestras de atmósfera: diseño de producto, no decoración.
- El esqueleto de teclado: foco al buscador, Tab atrapado, Escape que limpia antes de
  cerrar, flechas sobre las categorías, tope de ancho de 420/560px.

## Problemas prioritarios

**[P0] Lo que se escribe acá se destruye en silencio.** El borrador del `.mycignore` se
pierde con Escape, con un clic en el velo y al cambiar de categoría (`key={actual.id}`
remonta el panel). La carpeta de Esporas inválida no se guarda y su error se fija en el
`blur` que desmonta la sección. Borrar un snippet llama a `remove(s.id)` sin confirmar ni
deshacer — el defecto que `FUN-M-33` acaba de corregir para las notas, con la herramienta
ya escrita. → `/impeccable harden`

**[P1] El resultado de las acciones de riesgo aparece fuera de pantalla.** `mensaje` y
`error` de `VaultSection` se pintan al final del componente, a ~900px del botón que los
produce. Los avisos flotantes (`FUN-M-33`) existen y esta ventana no los usa; además
quedarían tapados (z-55 contra z-70). → `/impeccable harden`

**[P1] Dos interruptores para la misma decisión.** Nueve ajustes binarios usan `.toggle`
(botón con la palabra «Activado») y tres usan `.switch` (la píldora del sistema). Efecto
real: la columna de Editor no se puede escanear. Acompañan tres tratamientos de foco y dos
clases de explicación, una parcheada con `style` inline en quince sitios.
→ `/impeccable polish`

**[P1] El buscador promete más de lo que indexa.** El índice es una lista a mano en
`VentanaAjustes.tsx`: «Shell por defecto» no está, las descripciones no se indexan, y no hay
un solo sinónimo aunque el tipo diga que los admite. Los ajustes que solo existen en modo
avanzado hacen que el salto falle en silencio. → `/impeccable clarify`

**[P2] La ventana no sabe en qué aplicación vive.** El texto de los snippets promete
respaldo en la cuenta y en cualquier dispositivo, en desktop, donde el principio es «sin
cuenta; nada sale de la máquina». El pie dice v1.7.0 y el proyecto documenta 1.3.0.
→ `/impeccable clarify`

## Señales por persona

- **Cambiar el tema**: bien atendido, pero el tamaño de letra está en otra categoría, con
  deslizadores del SO y sin vista previa.
- **Resolver un problema concreto**: «ignorar», «indexar», «carpeta» no devuelven nada en el
  buscador; el ajuste se llama «Archivos ignorados (.mycignore)» y hay que adivinarlo.
- **Vault como memoria de una IA**: su ajuste está en el sexto bloque de la séptima
  categoría, bajo el nombre de una herramienta de terceros, y el aviso de que sus
  `CLAUDE.md` no se pisaron cae en el párrafo del fondo.

## Observaciones menores

Sin vault abierto no hay puerta a Configuración, y el ajuste que gobierna esa pantalla vive
dentro. La marca del salto del buscador usa el color del foco sin que el foco esté ahí. El
pie de los siete clics no tiene teclado: el modo avanzado es inalcanzable sin ratón. En
ventana angosta desaparecen los cuatro grupos. Las filas de snippets y de versiones no
respetan el tope de ancho.

## Preguntas que deja

Si la prosa de esta ventana es lo mejor escrito del producto, ¿por qué hay que venir a
buscarla acá? ¿Por qué las ocho categorías son exactamente los ocho archivos `*Section.tsx`?
¿Y por qué la lección del borrado con deshacer no cruzó de una superficie a la otra?
