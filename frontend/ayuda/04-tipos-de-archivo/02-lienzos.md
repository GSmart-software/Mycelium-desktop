---
titulo: Lienzos
tema: Tipos de archivo
cubre: [canvas]
sinonimos: [canvas, tablero, mapa de ideas, tarjetas, pizarra]
---

Un **lienzo** es un archivo `.canvas`: un espacio infinito donde ponés **tarjetas** y las
unís con **flechas**. Una tarjeta puede ser texto en Markdown o una nota de tu vault. Usa el
formato JSON Canvas, el mismo de Obsidian, así que el archivo se abre en los dos programas.

## Para qué sirve

Para pensar con las notas puestas en el espacio: un mapa de un proyecto, una línea de
tiempo, un tablero de ideas. A diferencia de un
[dibujo de Excalidraw](ayuda:tipos-de-archivo/excalidraw), acá cada caja es **contenido**:
el texto se escribe en Markdown y sus `[[enlaces]]` navegan al hacer clic.

## Cómo se usa

1. En el explorador, **Nuevo canvas**: con el botón de la barra o con clic derecho en una
   carpeta.
2. **Tarjeta de texto** agrega una tarjeta y la deja lista para escribir; **doble clic**
   en una tarjeta de texto la vuelve a editar. **Tarjeta de nota** busca una nota por el
   principio de su nombre y la pone en el lienzo.
3. Para conectar dos tarjetas, arrastrá desde el punto de uno de sus lados hasta la otra.

Las tarjetas se mueven arrastrando su barra de arriba y cambian de tamaño desde la esquina
de abajo a la derecha. Arrastrando el fondo te movés por el lienzo, y la rueda del mouse
acerca y aleja; el botón con el porcentaje vuelve al 100 %. Con una tarjeta seleccionada
aparecen los colores y **Borrar** (o la tecla **Supr**). Los cambios se guardan solos.

**Ctrl+Z** deshace el último cambio del lienzo y **Ctrl+Y** (o **Ctrl+Shift+Z**) lo rehace;
también están los botones de flecha de la barra. Se deshace todo lo que cambia el archivo:
crear o borrar una tarjeta, moverla, cambiarle el tamaño o el color, crear una flecha y
editar el texto. Un arrastre entero es un solo paso, y lo que escribiste en una tarjeta
también, al salir de ella. Mientras escribís en una tarjeta, Ctrl+Z deshace el texto, como
en cualquier campo. Se recuerdan los últimos 100 pasos.

> [!warning] Si el lienzo cambia desde afuera, el historial empieza de nuevo
> Cuando otro programa —o la IA— modifica el archivo y el lienzo se recarga, lo que había
> para deshacer se descarta: volver a un estado anterior mezclaría tu versión con la nueva.

> [!info] La tarjeta de nota es la nota
> No es una copia: muestra el contenido real del archivo, y su botón **Abrir** la abre en
> una pestaña. Si la nota se borra, la tarjeta lo dice en vez de romper el lienzo.

Las flechas son disposición visual: no crean conexiones en el
[grafo](ayuda:enlazar-y-organizar/grafo). Una conexión se hace siempre con un `[[enlace]]`.
