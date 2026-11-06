---
titulo: La interfaz
tema: Primeros pasos
sinonimos: [pantalla, zonas, secciones, niveles, Alt+flechas, Ctrl+Enter, teclado numérico, F6, rail, explorador, pestañas, paneles, dividir, panel de enlaces, barra de estado, barra superior, licencias, licencias de terceros, versión, pistas, F10, sin mouse]
---

La ventana de Mycelium tiene cinco zonas: la **barra superior**, el **rail** de íconos a la
izquierda, el **panel lateral** que abre cada ícono, el **área de trabajo** con tus
pestañas y la **barra de estado** al pie.

## Para qué sirve

Saber qué hay en cada zona te ahorra buscar: casi todo está a un clic o a una tecla.

## Cómo se usa

1. **Barra superior**: el nombre del vault (abre otro vault), el campo **Ir a una nota o
   comando…** (**Ctrl+O**) y, a la derecha, **Salir del vault**.
2. **Rail**: cada ícono abre su panel lateral —**Explorador**, **Búsqueda global**,
   **Esporas**, **Calendario**, **Salud del vault**, **Consolas**, **Actividad de la IA** y, abajo,
   **Papelera**—; un segundo clic en el mismo ícono lo cierra. **Grafo de conexiones**
   abre el grafo como pestaña y el engranaje abre **Configuración** (**Ctrl+,**). Al pie de
   Configuración están la versión que tienes y **Licencias de terceros**, los avisos de
   licencia del software y las fuentes de otros autores que trae Mycelium.
3. **Área de trabajo**: cada archivo se abre en una pestaña. Arrastra una pestaña al borde
   de otro panel para dividir la vista, o usa el menú **⋯** de la barra de pestañas:
   **Dividir a la derecha** o **Dividir hacia abajo**.

## Dividir la vista

Arrastrar una pestaña al borde de un panel la **mueve** a un panel nuevo. **Dividir a la
derecha** y **Dividir hacia abajo**, en cambio, muestran el **mismo archivo a los dos
lados**: cada lado tiene su propia posición y su propia vista (en vivo, lectura…), y lo que
se escribe en uno aparece al instante en el otro. Sirve para leer una parte de una nota
larga mientras se edita otra.

Las notas y las bases se muestran a los dos lados. Los lienzos, los dibujos de Excalidraw,
los diagramas de draw.io, los archivos del visor, las consolas, el grafo, las referencias
y el calendario se **mueven** al panel nuevo (salvo que sean la única pestaña del panel):
dos copias abiertas a la vez no se enterarían de lo que guarda la otra, y una consola tiene
una sola sesión.

## El menú del explorador

El clic derecho sobre una nota (o un lienzo, una base, un dibujo, un diagrama) ofrece:

| Opción | Qué hace |
|---|---|
| **Abrir al lado** | Abre el archivo en un panel nuevo a la derecha del activo. |
| **Renombrar** · **Duplicar** | Cambia el nombre, o crea una copia en la misma carpeta. |
| **Mover a…** | Abre un buscador de carpetas: se escribe parte del nombre, se elige con **↑**/**↓** y **Enter**. Los enlaces que llegaban a la nota se actualizan solos. |
| **Copiar enlace** | Copia el `[[enlace]]` a la nota, listo para pegar en otra. Si hay otra nota con el mismo nombre, lleva la carpeta (`[[Proyectos/Plan]]`); un lienzo, una base, un dibujo o un diagrama llevan su extensión (`[[Mapa.canvas]]`). |
| **Exportar como .md** · **Exportar como PDF…** | Guarda una copia fuera del vault. |
| **Mostrar en el explorador** | Abre la carpeta del archivo en el explorador del sistema. |
| **Eliminar** | Manda el archivo a la papelera de Mycelium, con **Deshacer** en el aviso. |

Sobre una carpeta, el menú también tiene **Mover a…**, que la lleva con todo lo que
contiene y actualiza los enlaces. Arrastrar en el árbol hace lo mismo.

Arriba de **Archivos**, la sección **Bandeja** lleva a la Bandeja del vault y a tu Bandeja
personal (la misma desde todos los vaults), donde anota la
[captura rápida](ayuda:herramientas/bandeja-y-captura-rapida) (**Ctrl+Shift+Espacio**).

## El panel lateral

Además de su sección (el explorador, la búsqueda…), el panel lateral admite pestañas
ancladas: arrastra ahí una pestaña del área de trabajo para tenerla siempre a mano, al
lado de lo que estés editando. **Ctrl+\\** lo oculta y lo vuelve a mostrar.

## Pestañas

Un archivo nuevo se abre en una pestaña de **vista previa**, con el nombre en cursiva: si
abres otro sin tocarla, lo reemplaza. Al editarla o con **doble clic** sobre la pestaña,
queda fija. Si prefieres que cada archivo abra su propia pestaña, apaga **Pestañas de
previsualización** en **Configuración → Editor**. Las flechas **Atrás** y **Adelante** de
la barra de pestañas recorren lo que se abrió en esa pestaña.

Una pestaña abierta desde un enlace (**Ctrl+clic** o clic con la rueda sobre el enlace)
conserva el historial de la pestaña de origen: **Atrás** en la pestaña nueva vuelve a la
nota desde la que se siguió el enlace. Lo mismo vale para el clic con la rueda sobre las
flechas **Atrás** y **Adelante**: el documento de ese paso se abre en una pestaña nueva que
puede seguir yendo atrás y adelante.

Al abrir una nota —desde un enlace, la búsqueda, **Ctrl+O** o el explorador—, el
explorador despliega las carpetas que llevan a ella y la muestra. Volver a una pestaña que
ya estaba abierta no despliega nada: si plegaste una carpeta, queda plegada.

## El panel de enlaces

A la derecha de cada nota hay un panel que se abre con **Ctrl+Shift+\\**, con el botón
**Panel de enlaces** de la barra del editor o desde la barra de estado. Tiene cuatro
pestañas:

| Pestaña | Qué muestra |
|---|---|
| **PROPIEDADES** | Las [propiedades](ayuda:escribir-notas/propiedades) de la nota, editables. |
| **GRAFO** | Un grafo pequeño con la nota en el centro, lo que enlaza y lo que la enlaza. |
| **SALIENTES** | Las notas a las que esta enlaza. |
| **RETRO** | Las notas que enlazan a esta, con el fragmento donde la citan. |

Debajo, la fecha de creación y de modificación, la ruta y el tamaño del archivo.

## La barra de estado

Con una nota abierta, el pie dice cuántos enlaces tiene y cuántas notas la citan (un clic
abre el panel de enlaces), cuántas palabras lleva y cuándo se guardó por última vez.

## Con el teclado

La ventana se recorre con **tres teclas** y por **niveles**: arriba, las **secciones** —la
barra superior, el rail, el panel lateral, cada panel del área de trabajo, el panel de
enlaces y la barra de estado—; dentro de cada una, sus botones, pestañas y filas; y dentro
de un documento, lo que escribes.

- **{{atajo:nivel.derecha|Alt+→}}** (y las otras flechas con **Alt**) se mueve hacia lo que
  está en esa dirección, sin salir del nivel en el que estás.
- **{{atajo:nivel.entrar|Ctrl+Enter}}** entra a lo elegido: a la sección, al documento, a la
  pestaña; sobre un botón o una fila, lo ejecuta.
- **Esc** sale un nivel (si hay algo abierto, primero lo cierra).

La sección elegida lleva un borde y un velo del color de acento. Con el **teclado
numérico**, **{{atajo:zona.rail|Ctrl+Num 1}}** a **{{atajo:zona.estado|Ctrl+Num 5}}** saltan
al rail, al panel lateral, a las pestañas, al panel de enlaces y a la barra de estado.
**F6** y **Shift+F6** también recorren las secciones. Detalle en [Atajos de
teclado](ayuda:atajos-de-teclado/atajos-de-teclado).

Para pulsar algo sin el mouse, **{{atajo:pistas.mostrar|F10}}** muestra una **pista** —una
letra o dos— sobre cada botón, enlace, pestaña y campo a la vista: escribir esas letras es
el clic. Las letras salen del nombre (el Explorador lleva la **E**) y los botones de solo
ícono muestran además su nombre. Con **Shift** y las letras solo se pone el foco ahí, sin hacer clic; **Esc** o
**F10** las cierran sin hacer nada.

Los atajos de cada zona están en [Atajos de teclado](ayuda:atajos-de-teclado/atajos-de-teclado).
