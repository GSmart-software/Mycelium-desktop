---
titulo: Atajos de teclado
tema: Atajos de teclado
sinonimos: [teclas, niveles, secciones, Alt+flechas, Ctrl+Enter, entrar, salir un nivel, AltGr, historial, Tab, letras de las pistas, nombre de los íconos, macros, atajo de una macro, shortcuts, combinaciones, teclado, F6, zonas, sin mouse, salir del editor, salir de la consola, modo navegar, modo escribir, cambiar atajos, personalizar atajos, hoja de atajos, teclado numérico, crear, nueva nota, nuevo, menú contextual, dividir, pistas, F10, hacer clic con el teclado, letras sobre los botones, grafo con el teclado, calendario con el teclado, tabla con el teclado, tarjetas del lienzo, divisores, redimensionar paneles, cambiar el ancho del panel]
---

Los atajos que Mycelium entiende, agrupados por dónde funcionan. Algunos solo actúan con
el foco en un lugar —el texto de una nota, el explorador, una consola—: cada tabla lo dice.

**{{atajo:atajos.hoja|Ctrl+Shift+/}}** abre la **hoja de atajos**: todos los atajos de los
comandos, agrupados y con un buscador, tal como los tienes hoy.

## Cambiar los atajos

Los atajos de los comandos se cambian en **Configuración → Atajos de teclado** (o con
«Cambiar los atajos de teclado» en la paleta). Pulsa el atajo que quieres cambiar y luego la
combinación nueva; **Esc** cancela y **Retroceso** o **Supr** lo quita. Con **+** le agregas
otro atajo al mismo comando, y la flecha circular lo devuelve al de fábrica (**Restaurar
todos**, a todos). Los atajos son tuyos: valen en todos los vaults.

- Si la combinación ya es de otro comando, Mycelium te lo dice y te ofrece **reemplazar**:
  el otro comando se queda sin ella.
- Algunas combinaciones no se pueden usar: **Alt+Tab** (cambiar de ventana),
  **Ctrl+Shift+Espacio** (la captura rápida), **F12** y **Ctrl+Shift+I** (las herramientas
  de desarrollo), las que recargan o cierran la ventana (**F5**, **Ctrl+R**, **Alt+F4**) y
  las de editar texto (**Ctrl+C**, **Ctrl+V**, **Ctrl+X**, **Ctrl+A**, **Ctrl+Z**,
  **Ctrl+Y**).
- Una letra, un número o un signo **sin Ctrl ni Alt** no puede ser un atajo: escribiría en
  el documento. Las teclas **F** sí pueden ir solas. **Ctrl+Alt** con una letra tampoco:
  en muchos teclados es **AltGr** y escribe un carácter (`@`, `€`).
- Los atajos que no son de un comando —**F1**, la captura rápida y los del texto de una nota
  (negrita, cursiva…)— son fijos.

**La fila de números y el teclado numérico son teclas distintas**: **Ctrl+1** es el `1` de
arriba de las letras y **Ctrl+Num 1** el del teclado numérico; se asignan por separado.

Los atajos se reconocen por la **posición** de la tecla, no por la letra impresa: así un
atajo sigue en el mismo lugar aunque cambies el idioma del teclado. Configuración, la hoja y
esta ayuda te muestran la tecla de **tu** teclado: en uno español, el atajo del panel
lateral (la posición de la `\` en un teclado de EE. UU.) se ve como **Ctrl+Ç**.

## En toda la app

| Atajo | Qué hace |
|---|---|
| **F1** | Abre esta ayuda. Con la ayuda abierta, lleva al buscador. |
| {{atajo:paleta.notas|Ctrl+O}} | Ir a una nota por su nombre. |
| {{atajo:paleta.comandos|Ctrl+P}} | La paleta de comandos. |
| {{atajo:nota.nueva|Ctrl+N}} | Nueva nota en la carpeta seleccionada del explorador (o en la raíz), con el título listo para escribir. |
| {{atajo:crear.nuevo|Ctrl+Shift+N}} | El menú **Nuevo…**: nota, carpeta, canvas, base, dibujo, diagrama o una nota desde una Espora. |
| {{atajo:busqueda.vault|Ctrl+Shift+F}} | La búsqueda global, con el cursor en su campo. |
| **Ctrl+Shift+Espacio** | La [captura rápida](ayuda:herramientas/bandeja-y-captura-rapida): anota en la Bandeja del vault o en tu Bandeja personal sin cambiar de pestaña; en la cajita, **Tab** cambia el destino. Funciona también **desde cualquier programa**, con Mycelium minimizado. |
| {{atajo:configuracion.abrir|Ctrl+,}} | Configuración. |
| {{atajo:atajos.hoja|Ctrl+Shift+/}} | La hoja de atajos. |
| {{atajo:pistas.mostrar|F10}} | Las **pistas**: una letra sobre cada cosa que se puede pulsar; escribirla es el clic (más abajo). |
| **F12** o **Ctrl+Shift+I** | Las herramientas de desarrollo, si las encendiste para este vault en Configuración → Avanzado. |

## Macros

Una [macro](ayuda:herramientas/macros) es una lista de pasos —comandos, texto para insertar,
notas para abrir— que se ejecuta desde la paleta o con **su propio atajo**. Ninguna trae atajo de
fábrica: se lo das en **Configuración → Macros**, con el mismo grabador, los mismos
conflictos y las mismas teclas reservadas que aquí. Las que tienen atajo aparecen en la hoja,
en el grupo **Macros**, y también en Configuración → Atajos de teclado.

## Moverse sin el mouse

Todo Mycelium se recorre con **tres teclas**, siempre las mismas:

| Atajo | Qué hace |
|---|---|
| {{atajo:nivel.izquierda|Alt+←}} {{atajo:nivel.derecha|Alt+→}} {{atajo:nivel.arriba|Alt+↑}} {{atajo:nivel.abajo|Alt+↓}} | **Moverse**: va a lo que está en esa dirección, sin salir del nivel en el que estás. |
| {{atajo:nivel.entrar|Ctrl+Enter}} | **Entrar** a lo elegido, un nivel más adentro. Sobre un botón o una fila, lo ejecuta (como un clic). |
| **Esc** | **Salir** un nivel. Si hay algo abierto —las sugerencias de `[[`, la búsqueda en la nota, un menú, el texto de una tarjeta—, el primer **Esc** lo cierra y el segundo sale. |

### Los niveles

1. **Las secciones**: la barra superior, el rail, el panel lateral, **cada panel** del área de
   trabajo (con la vista dividida, cada uno es una sección), el panel de enlaces y la barra de
   estado. La sección elegida lleva un **borde y un velo** del color de acento. Aquí
   **Alt+flechas** pasa a la sección vecina y **Ctrl+Enter** entra a la última cosa que
   usaste en ella (o a la primera).
2. **Dentro de una sección**: sus botones, campos, pestañas, filas del árbol… y, en un panel,
   la barra de la nota y el **documento** como un elemento más. **Alt+flechas** se mueve entre
   ellos: en el explorador, **Alt+↑** desde el primer archivo sube a los botones de arriba.
   **Ctrl+Enter** ejecuta el botón o la fila; sobre una pestaña, la abre y entra a su
   documento. **Esc** vuelve a la sección.
3. **Dentro del documento**: escribir en una nota, o moverse por un lienzo, una tabla, el
   grafo o el calendario. **Esc** deja el documento seleccionado.

Un documento **seleccionado** lleva un **contorno punteado**; con el cursor adentro, estás
escribiendo y las teclas son suyas: solo actúan los atajos con **Ctrl**, **Alt** o una tecla
**F**, así que escribir nunca dispara nada. Mientras escribes en una nota, **Alt+↑** y
**Alt+↓** suben o bajan la línea: para moverte por la ventana, primero **Esc**.

| Pestaña | Ctrl+Enter (o Enter) sobre el documento seleccionado |
|---|---|
| Nota | Vuelve a escribir con el cursor donde lo dejaste; en la lectura, al primer enlace o casilla. |
| Lienzo | La última tarjeta seleccionada. |
| Tabla | La última fila elegida (o la primera). |
| Grafo, calendario | El grafo; el día elegido. |
| Diagrama de draw.io | Su editor. |
| Consola | La línea de comandos. |

En una **consola** y en un **dibujo de Excalidraw**, **Esc** es suyo (lo usan la shell, vim
o la herramienta de dibujo): de ahí se sale con **F6** o con un acceso del teclado numérico.
En un **diagrama de draw.io** el teclado lo tiene el editor y los atajos de Mycelium no
llegan mientras escribes ahí: también se sale con **F6** (o **Shift+F6**).

### Accesos directos con el teclado numérico

| Atajo | Qué hace |
|---|---|
| {{atajo:zona.rail|Ctrl+Num 1}} | El rail. |
| {{atajo:zona.izquierda|Ctrl+Num 2}} | El panel lateral (si está oculto, lo muestra). |
| {{atajo:zona.pestanas|Ctrl+Num 3}} | Las pestañas: el panel activo. |
| {{atajo:zona.enlaces|Ctrl+Num 4}} | El panel de enlaces de la nota (si está cerrado, lo abre). |
| {{atajo:zona.estado|Ctrl+Num 5}} | La barra de estado. |
| {{atajo:zona.siguiente|F6}} / {{atajo:zona.anterior|Shift+F6}} | La sección siguiente / anterior, en orden. Funciona desde cualquier lado, también desde una consola. |

Todos dejan la sección **elegida**: **Ctrl+Enter** entra. Los números del teclado numérico
son teclas distintas de los de la fila de arriba (**Ctrl+1** cambia la vista de la nota).

**Tab** ya no recorre los botones de la ventana: para eso están **Alt+flechas**. Sigue
sangrando el texto de una nota y recorriendo los campos de los diálogos (Configuración, la
paleta, los menús).

Después de **Ctrl+Tab**, **Ctrl+W** o **Ctrl+Shift+T**, el documento que queda a la vista
queda seleccionado; si venías escribiendo en una nota y la que queda también es una nota,
sigues escribiendo en ella. Una consola nunca toma el teclado sola: queda seleccionada y
**Ctrl+Enter** entra.

## Hacer clic con el teclado: las pistas

**{{atajo:pistas.mostrar|F10}}** muestra una **pista** —una letra, o dos— sobre cada botón,
enlace, pestaña, fila, campo y documento que se ve en la ventana. Escribir esas letras es como
hacer clic ahí, sin el mouse.

- **Las letras salen del nombre** de lo que señalan: el Explorador lleva la **E**; Buscar, la
  **B**. Si dos nombres empiezan igual, los dos llevan una segunda letra —la inicial de la
  segunda palabra o la letra siguiente—: Explorador **EX**, Esporas **ES**, Nueva nota **NN**.
  No cuentan los artículos ni las preposiciones («Abrir **el** panel» da **AP**) ni las
  tildes (Índice da **I**). Lo que no tiene nombre usa las letras que quedan libres. La misma
  pantalla da siempre las mismas letras, y ninguna pista es el comienzo de otra: al completar
  una, se activa enseguida.
- **Los botones de solo ícono muestran también su nombre** junto a la letra, por ejemplo
  «**E** Explorador» en el rail. Lo que ya muestra su texto (un archivo del árbol, una
  pestaña, una fila) y los nodos del grafo llevan solo la letra. Si el nombre taparía otra
  pista, se ve solo la letra; al escribir la primera, las que quedan en juego tienen más lugar
  y muestran su nombre.

| Atajo | Qué hace |
|---|---|
| Las letras de una pista | Hace clic en lo que señala. En un campo de texto, en el texto de una nota o en una consola, pone el cursor ahí para escribir; en un diagrama o un PDF, entra en él. Al escribir la primera letra de un par, las pistas que no empiezan así se atenúan. |
| **Shift** + las letras | Solo pone el foco ahí, sin hacer clic: para seguir con el teclado desde ese lugar. |
| **Retroceso** | Borra la última letra escrita. |
| **Esc** o {{atajo:pistas.mostrar|F10}} | Cierra las pistas sin hacer nada. |

- Las letras funcionan igual con cualquier idioma del teclado: cuenta la **posición** de la
  tecla. Las pistas te muestran la letra de tu teclado.
- Con un diálogo abierto —la paleta, Configuración, un aviso—, las pistas son las del
  diálogo.
- El texto de una nota es **una** pista (el cursor vuelve donde estaba), no una por renglón.
  En el grafo, el lienzo lleva una pista y además cada nodo a la vista (hasta 60, los de más
  conexiones): sus letras abren la nota y, con **Shift**, solo lo eligen. En un lienzo, cada
  tarjeta lleva la suya y la letra la selecciona.
- Las pistas se van solas si mueves el mouse para hacer clic o si se desplaza lo que hay
  debajo; si la ventana cambia de tamaño, se vuelven a calcular.
- Funcionan también desde una consola y desde un diagrama de draw.io (ahí siempre con
  **F10**, aunque le hayas dado otro atajo).

## Pestañas y paneles

| Atajo | Qué hace |
|---|---|
| {{atajo:pestana.siguiente|Ctrl+Tab}} / {{atajo:pestana.anterior|Ctrl+Shift+Tab}} | Pestaña siguiente / anterior. |
| {{atajo:pestana.cerrar|Ctrl+W}} | Cierra la pestaña activa. |
| {{atajo:pestana.reabrir|Ctrl+Shift+T}} | Reabre la última pestaña cerrada. |
| {{atajo:historial.atras|AltGr+←}} / {{atajo:historial.adelante|AltGr+→}} | Atrás y adelante en lo que se abrió en la pestaña. **AltGr** es la **Alt** de la derecha. |
| {{atajo:panel-izquierdo.alternar|Ctrl+\}} | Muestra u oculta el panel lateral. |
| {{atajo:explorador.alternar|Ctrl+Shift+E}} | Muestra u oculta el explorador, con el foco en el árbol de archivos. |
| {{atajo:panel-derecho.alternar|Ctrl+Shift+\}} | Muestra u oculta el panel de enlaces de la nota. Funciona también con el cursor junto a un paréntesis. |
| **←** / **→**, **Inicio** / **Fin** | Con el foco en una pestaña, abren la de al lado (o la primera / la última). **Alt+←** / **Alt+→** solo se mueven, sin abrir. **Supr** cierra la enfocada. |
| **Shift+F10** o la tecla de menú | Con el foco en una pestaña, su menú: cerrar, fijar, dividir, anclar en el panel lateral y exportar. |

En la paleta (**Ctrl+P**) están además **Ir al panel de la izquierda** y **de la derecha**
(con la vista dividida), **Dividir a la derecha**, **Dividir hacia abajo**,
**Cerrar el panel activo** (con la vista dividida), **Anclar la pestaña en el panel lateral**
y las pestañas ancladas siguiente y anterior; y un comando por cada sección del rail
(**Abrir el explorador**, **Abrir el panel de Esporas**, **Abrir la papelera**…), que la
muestra y pone el foco en ella. Ninguno trae atajo, pero puedes darles uno.

Los botones laterales del mouse (atrás y adelante) también recorren el historial de la
pestaña. **Ctrl+clic** en un enlace lo abre en una pestaña nueva que conserva ese
historial, así que **Atrás** vuelve a la nota de origen.

## Crear sin el mouse

**{{atajo:crear.nuevo|Ctrl+Shift+N}}** abre el menú **Nuevo…**. Lo nuevo se crea en la
carpeta seleccionada del explorador o, si no hay ninguna, en la raíz.

| Atajo | Qué hace |
|---|---|
| **↑** / **↓**, **Inicio** / **Fin** | Recorren las opciones. |
| **Enter** | Crea lo elegido. Una nota se abre con el título listo para nombrarla; el resto, seleccionado (**Enter** entra a editarlo). |
| **→** | Sobre **Nueva desde Espora…**, muestra las [Esporas](ayuda:enlazar-y-organizar/esporas). |
| **←** o **Esc** | En las Esporas, vuelve a los tipos. En los tipos, **Esc** cierra. |

Cada opción es también un comando de la paleta: «Nueva carpeta», «Nuevo canvas», «Nueva
base», «Nuevo dibujo Excalidraw», «Nuevo diagrama draw.io» y «Nueva desde Espora…».

## Menús

En cualquier menú —el del clic derecho, el **⋯** de la barra de pestañas, el **Nuevo** del
explorador—, **↑** y **↓** recorren las entradas y **Enter** elige. En una entrada con
submenú (**▸**), **→** o **Enter** lo abren y llevan el foco adentro; **←** o **Esc** lo
cierran y vuelven a la entrada. **Esc** fuera de un submenú cierra el menú.

## Escribir en una nota

| Atajo | Qué hace |
|---|---|
| {{atajo:editor.vista-en-vivo|Ctrl+1}} · {{atajo:editor.vista-dividido|Ctrl+2}} · {{atajo:editor.vista-lectura|Ctrl+3}} · {{atajo:editor.vista-crudo|Ctrl+4}} | Vista **En vivo**, **Dividido**, **Lectura** o **Crudo**. Los números de la fila de arriba, no los del teclado numérico. |
| **Ctrl+B** | Negrita. |
| **Ctrl+I** | Cursiva. |
| **Ctrl+Shift+C** | Código en línea. |
| **Ctrl+K** | Inserta un enlace a una página web, con su texto y su dirección. |
| {{atajo:nota.buscar|Ctrl+F}} | Busca en la nota: **Enter** siguiente, **Shift+Enter** anterior, **Esc** cierra. |
| **Ctrl+Z** / **Ctrl+Y** | Deshacer / rehacer. |
| **Tab** / **Shift+Tab** | Aumenta / disminuye la sangría. |
| **Alt+↑** / **Alt+↓** | Sube o baja la línea. |
| **Shift+Alt+↑** / **Shift+Alt+↓** | Duplica la línea hacia arriba o hacia abajo. |
| **Ctrl+Shift+K** | Borra la línea. |
| `[[` | Sugiere notas para [enlazar](ayuda:enlazar-y-organizar/enlaces); **Enter** elige. |

Las casillas de las [tareas](ayuda:escribir-notas/tareas) también se manejan con el
teclado en la vista de lectura.

## Explorador

Con el foco en el árbol de archivos:

| Atajo | Qué hace |
|---|---|
| **↑** / **↓**, **Inicio** / **Fin** | Recorren las filas. |
| **→** / **←** | Abren / cierran la carpeta. |
| **Enter** o **Espacio** | Abre el archivo o pliega la carpeta. |
| **F2** | Renombra. |
| **Shift+F10** o la tecla de menú | El menú del clic derecho. |
| **Ctrl+Z** | Deshace el último movimiento de un archivo o carpeta. |

Las acciones de ese menú también están en la paleta (**Ctrl+P**), sobre el **elemento
seleccionado** —la última fila del árbol que tuvo el foco, o el archivo abierto— y con su
nombre: «Renombrar «Ideas»», «Mover a…», «Duplicar», «Copiar el enlace a», «Abrir al
lado», «Exportar como .md», «Exportar como PDF», «Mostrar en el explorador del sistema» y
«Eliminar». Están mientras el explorador está a la vista.

## Lienzos

Con el [lienzo](ayuda:tipos-de-archivo/lienzos) seleccionado, **Ctrl+Enter** (o **Enter**) entra
a la última tarjeta seleccionada (o a la primera). Con el foco en una tarjeta:

| Atajo | Qué hace |
|---|---|
| **←** **→** **↑** **↓**, o con **Alt** | Pasa a la tarjeta más cercana en esa dirección; la vista se desplaza para mostrarla. |
| **Ctrl** + flechas | Mueve la tarjeta (con **Shift**, más rápido). |
| **Enter** | Edita el texto de una tarjeta de texto, o abre la nota de una tarjeta de nota. |
| **Esc** | Termina de editar el texto y vuelve a la tarjeta. Sin texto en edición, deja el lienzo seleccionado. |
| **Supr** | Borra la tarjeta seleccionada (se recupera con Ctrl+Z). |
| **Ctrl+Z** | Deshace el último cambio del lienzo. |
| **Ctrl+Y** o **Ctrl+Shift+Z** | Rehace lo deshecho. |

## Grafo

El [grafo](ayuda:enlazar-y-organizar/grafo) —el de la pestaña y el mini-grafo del panel de
enlaces— se maneja con las flechas: en la pestaña, se entra con **Ctrl+Enter**; en el panel
de enlaces, se llega con **Alt+flechas**. Al llegar se elige la nota central (en el
mini-grafo, la nota abierta) o la más cercana al centro de la vista, con un **anillo**.

| Atajo | Qué hace |
|---|---|
| **←** **→** **↑** **↓** | Pasa a la nota más cercana en esa dirección; la vista la sigue. En la pestaña del grafo, también con **Alt**; en el mini-grafo, **Alt+flechas** sale al elemento vecino del panel. |
| **Inicio** | Vuelve a la nota de partida. |
| **Enter** | Abre la nota elegida. |
| **Esc** | Deja la pestaña del grafo seleccionada; en el mini-grafo, vuelve a la pestaña **Grafo** del panel. |

## Calendario

En el [calendario](ayuda:herramientas/calendario) —la pestaña y el calendario chico del
panel—, la grilla de días se recorre con las flechas desde el día elegido. **Ctrl+Enter** (o
**Enter**) sobre la pestaña del calendario seleccionada entra directo a ella; en la pestaña,
las flechas también funcionan con **Alt**:

| Atajo | Qué hace |
|---|---|
| **←** / **→** | Día anterior / siguiente. |
| **↑** / **↓** | Semana anterior / siguiente. |
| **Inicio** / **Fin** | Lunes / domingo de esa semana. |
| **RePág** / **AvPág** | Mes anterior / siguiente (con **Shift**, un año). Al salir del mes, la grilla pasa al mes nuevo. |
| **Enter** | Abre el día en la lista de la derecha, con sus recordatorios. |

## Tablas

En una [tabla](ayuda:tipos-de-archivo/bases), **Ctrl+Enter** sobre la tabla seleccionada entra a
la última fila elegida; las flechas (también con **Alt**) recorren las filas:

| Atajo | Qué hace |
|---|---|
| **↑** / **↓** | Fila anterior / siguiente. |
| **Inicio** / **Fin** | Primera / última fila. |
| **RePág** / **AvPág** | Diez filas arriba / abajo. |
| **Enter** | Abre la nota de la fila. |

Si la base tiene varias vistas, sus pestañas se recorren con **←** y **→**.

## Listas de los paneles

En los resultados de la [búsqueda](ayuda:enlazar-y-organizar/busqueda), las
[Esporas](ayuda:enlazar-y-organizar/esporas), la [papelera](ayuda:herramientas/papelera), la
actividad y la salud del vault:

| Atajo | Qué hace |
|---|---|
| **↑** / **↓**, **Inicio** / **Fin** | Pasan de una fila a otra (al mismo botón de la fila). **Alt+↑** en la primera sube a lo que está arriba (el campo, los botones). |
| **←** / **→** | Pasan entre los botones de la misma fila. |
| **Enter** | Lo del botón: abrir, usar, recuperar… |

En la búsqueda, **↓** desde el campo baja a los resultados; **Esc**, o **↑** en el primero,
vuelve al campo.

## Divisores y panel de enlaces

Los **divisores** que cambian el tamaño de los paneles —el borde del panel lateral, el del
panel de enlaces, el del visor de pestañas ancladas y los de la vista dividida— se alcanzan
con **Alt+flechas** desde lo que tienen al lado:

| Atajo | Qué hace |
|---|---|
| **←** / **→** (o **↑** / **↓** en uno horizontal) | Achica o agranda, como arrastrar el borde. Con **Shift**, de a más. |
| **Inicio** / **Fin** | El tamaño mínimo / máximo. |

En las pestañas del **panel de enlaces** (Propiedades, Grafo, Salientes, Retro), **←** y **→**
cambian de pestaña y **Ctrl+Enter** entra a su contenido. Con el foco dentro de una de ellas,
**Esc** vuelve a su pestaña (si había una lista de sugerencias abierta, el primer **Esc** la
cierra), y otro **Esc**, a la sección.

## Archivos con un visor propio

- **PDF**: el visor es el del sistema y se queda con las teclas mientras tiene el foco: ahí no
  llegan **F6**, **Esc** ni **F10**. **Tab** y **Shift+Tab** recorren sus botones y, al
  terminar, vuelven a Mycelium.
- **Excalidraw**: **Tab** recorre sus herramientas y **F6** sale del dibujo.

## Consolas

| Atajo | Qué hace |
|---|---|
| **Ctrl+C** | Con texto seleccionado, lo copia; sin selección, interrumpe el programa, como siempre. |
| **Ctrl+V** | Pega. |
| **F6** / **Shift+F6** | Sale de la consola a la sección siguiente / anterior. |
| **Ctrl+Num 1** … **Ctrl+Num 5** | Sale de la consola a esa sección. |

Con el foco en una consola, la shell recibe casi todas las teclas. De fábrica llegan a
Mycelium **F1**, **F6**, **F10**, **Ctrl+P**, **Ctrl+Shift+P**, **Ctrl+O**, **Ctrl+Tab**,
**Ctrl+Shift+Tab**, **Ctrl+\\**, **Ctrl+,**, **Ctrl+Shift+/** y **Ctrl+Num 1** a **Ctrl+Num 5**; la
shell ya no las recibe (para el comando anterior, usa **↑** en vez de **Ctrl+P**). **Ctrl+W**
sigue siendo de la shell (borra la palabra anterior): para cerrar la consola, sal con **F6**
y pulsa **Ctrl+W**.

La lista se cambia en **Configuración → Atajos de teclado → Teclas que salen de una
consola**: por ejemplo, devuélvele **Ctrl+P** a la shell o deja que **Ctrl+W** cierre la
consola. **F6** y **Shift+F6** salen siempre: son la salida. Las pistas (**F10**) también
llegan siempre.
