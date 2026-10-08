---
titulo: Vista en vivo y lectura
tema: Escribir notas
cubre: [markdown]
sinonimos: [modo lectura, dividido, editor, crudo, modo de visualización, previsualización]
---

Una nota se puede mirar de **cuatro modos**: en vivo, dividido, lectura y crudo. El
archivo es siempre el mismo texto Markdown; lo que cambia es cuánto de esa sintaxis ves y
si lo podés editar.

## Para qué sirve

Para escribir viendo el resultado, sin pelearte con los símbolos, y para pasar a leer
cuando ya no querés tocar nada. Si algo no se ve como esperabas, el modo crudo te muestra
el texto tal cual está en el archivo.

| Modo | Atajo | Qué ves |
|---|---|---|
| En vivo | **Ctrl+1** | El texto ya formateado, y editable. Los símbolos aparecen solo en la línea donde está el cursor. |
| Dividido | **Ctrl+2** | A la izquierda el texto para editar; a la derecha, la nota como en lectura. Las dos mitades se desplazan juntas. |
| Lectura | **Ctrl+3** | La nota terminada, sin editor ni barra de formato. |
| Crudo | **Ctrl+4** | El Markdown sin ocultar nada, para editar a mano. |

## Cómo se usa

1. Elegí el modo con los botones de la derecha de la barra del editor, o con su atajo.
2. Escribí en vivo: al salir de una línea, sus `**`, `#` o `[[ ]]` se esconden y queda el
   formato. Volvé a la línea con el cursor y reaparecen para que los edites. Lo mismo el
   `-` de una lista, que fuera de la línea se ve como viñeta (•); en una tarea queda solo
   la casilla. En un bloque de código, las cercas ` ``` ` se esconden mientras el cursor
   está fuera del bloque y queda el nombre del lenguaje, chico, a la derecha.
3. Pasá a lectura para revisar. Mycelium recuerda el modo de cada nota y, al cambiar de
   modo, te deja en la misma parte del texto que estabas mirando.

```ejemplo
## Un título

Texto con **negrita**, un [[enlace]] y una #etiqueta.
```

En vivo, ese ejemplo se ve igual que acá mientras el cursor está en otra línea. Con el
cursor en la segunda línea vuelven a aparecer los `**` y los corchetes.

## Qué cambia entre vivo y lectura

Casi todo se ve igual en los dos: [énfasis](ayuda:escribir-notas/enfasis),
[tareas](ayuda:escribir-notas/tareas), [callouts](ayuda:escribir-notas/callouts),
[fórmulas](ayuda:escribir-notas/formulas-y-diagramas),
[imágenes](ayuda:escribir-notas/imagenes-y-embebidos) y
[propiedades](ayuda:escribir-notas/propiedades). En vivo, además, las
[tablas](ayuda:escribir-notas/tablas) y las propiedades se editan directamente sobre el
render.

> [!warning] Los diagramas Mermaid solo se dibujan al leer
> En vivo y en crudo un bloque `mermaid` se ve como código. Para ver el diagrama, pasá a
> dividido o a lectura.

> [!tip] Tablas en crudo dentro de la vista en vivo
> Si preferís escribir las tablas a mano, en **Más opciones** (los tres puntos al extremo
> derecho de la barra del editor) desmarcá «Renderizar tablas (vista en vivo)».
