---
titulo: Lienzos
tema: Tipos de archivo
cubre: [canvas]
sinonimos: [canvas, tablero, mapa de ideas, tarjetas, pizarra]
---

Un **lienzo** es un archivo `.canvas`: un espacio infinito donde pones **tarjetas** y las
unes con **flechas**. Una tarjeta puede ser texto en Markdown o una nota de tu vault. Usa el
formato JSON Canvas, el mismo de Obsidian, así que el archivo se abre en los dos programas.

## Para qué sirve

Para pensar con las notas puestas en el espacio: un mapa de un proyecto, una línea de
tiempo, un tablero de ideas. A diferencia de un
[dibujo de Excalidraw](ayuda:tipos-de-archivo/excalidraw), aquí cada caja es **contenido**:
el texto se escribe en Markdown y sus `[[enlaces]]` navegan al hacer clic.

## Cómo se usa

1. En el explorador, **Nuevo canvas**: con el botón de la barra o con clic derecho en una
   carpeta, o con el menú **Nuevo…** (**{{atajo:crear.nuevo|Ctrl+Shift+N}}**).
2. **Tarjeta de texto** agrega una tarjeta y la deja lista para escribir; **doble clic**
   en una tarjeta de texto la vuelve a editar. **Tarjeta de nota** busca una nota por el
   principio de su nombre y la pone en el lienzo. La tarjeta nueva aparece en el centro de
   lo que estás viendo o, si ahí ya hay otra, en el lugar libre más cercano.
3. Para conectar dos tarjetas, arrastra desde el punto de uno de sus lados hasta la otra.

Las tarjetas se mueven arrastrando su barra de arriba (en una de nota lleva su título; en
una de texto es una franja fina, sin rótulo) y cambian de tamaño desde la esquina de abajo
a la derecha. El texto de una tarjeta se lee con la fuente del preview y se escribe con la
del editor, las dos de **Configuración → Tipografía**. Arrastrando el fondo te mueves por el lienzo, y la rueda del mouse
acerca y aleja; el botón con el porcentaje vuelve al 100 %. Con una tarjeta seleccionada
aparecen los colores y **Borrar** (o la tecla **Supr**). Los cambios se guardan solos.

Con el teclado, las tarjetas se recorren con las **flechas** (o **Ctrl**+flechas),
**Ctrl+Shift**+flechas las mueve, **Enter** edita el texto o abre la nota y **Esc** vuelve a
la tarjeta.
Detalle en [Atajos de teclado](ayuda:atajos-de-teclado/atajos-de-teclado).

**Ctrl+Z** deshace el último cambio del lienzo y **Ctrl+Y** (o **Ctrl+Shift+Z**) lo rehace;
también están los botones de flecha de la barra. Se deshace todo lo que cambia el archivo:
crear o borrar una tarjeta, moverla, cambiarle el tamaño o el color, crear una flecha y
editar el texto. Un arrastre entero es un solo paso, y lo que escribiste en una tarjeta
también, al salir de ella. Mientras escribes en una tarjeta, Ctrl+Z deshace el texto, como
en cualquier campo. Se recuerdan los últimos 100 pasos.

> [!warning] Si el lienzo cambia desde afuera, el historial empieza de nuevo
> Cuando otro programa —o la IA— modifica el archivo y el lienzo se recarga, lo que había
> para deshacer se descarta: volver a un estado anterior mezclaría tu versión con la nueva.

## Bloquear la edición

Si quieres mirar un lienzo sin riesgo de moverle nada, pulsa el **candado** de su barra (o
busca **Bloquear la edición del lienzo** en la paleta de comandos,
**{{atajo:paleta.comandos|Ctrl+P}}**). El candado se cierra y aparece la marca
**Solo lectura**.

Bloqueado puedes desplazarte, acercar y alejar, seleccionar tarjetas, abrir la nota de una
tarjeta y copiar su texto. Lo que cambiaría el archivo no se puede: crear o borrar tarjetas,
moverlas, cambiarles el tamaño o el color, conectarlas, editar el texto ni deshacer o
rehacer. Vuelve a pulsar el candado para desbloquearlo.

El bloqueo se recuerda para cada lienzo, también al cerrar Mycelium, y lo sigue si lo
renombras o lo mueves a otra carpeta. Se guarda en las preferencias del vault y no en el
archivo, así que Obsidian no lo ve. Y es solo de esta ventana: si otro programa —o la IA—
cambia el archivo, el lienzo bloqueado se actualiza igual.

> [!info] La tarjeta de nota es la nota
> No es una copia: muestra el contenido real del archivo, y su botón **Abrir** la abre en
> una pestaña. Si la nota se borra, la tarjeta lo dice en vez de romper el lienzo.

## Mostrarlo dentro de una nota

Escribe `![[Tablero.canvas]]` (o solo `![[Tablero]]`) en una nota para ver el lienzo ahí,
como una vista previa de solo lectura. Un clic lo abre en su pestaña. Detalles en
[Imágenes y archivos embebidos](ayuda:escribir-notas/imagenes-y-embebidos).

Las flechas son disposición visual: no crean conexiones en el
[grafo](ayuda:enlazar-y-organizar/grafo). Una conexión se hace siempre con un `[[enlace]]`.
