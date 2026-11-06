---
titulo: Atajos de teclado
tema: Atajos de teclado
sinonimos: [teclas, macros, atajo de una macro, shortcuts, combinaciones, teclado, F6, zonas, sin mouse, salir del editor, salir de la consola, modo navegar, modo escribir, cambiar atajos, personalizar atajos, hoja de atajos, teclado numérico, crear, nueva nota, nuevo, menú contextual, dividir, pistas, F10, hacer clic con el teclado, letras sobre los botones]
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
| **Ctrl+Shift+Espacio** | La [captura rápida](ayuda:herramientas/bandeja-y-captura-rapida): anota en la Bandeja del vault sin cambiar de pestaña. |
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

La ventana se divide en **zonas**: el rail, el panel lateral, cada panel del área de
trabajo (su barra de pestañas y su documento), el panel de enlaces si está abierto y la
barra de estado. La zona donde estás lleva un **borde** del color de acento mientras usas
el teclado.

| Atajo | Qué hace |
|---|---|
| {{atajo:zona.siguiente|F6}} / {{atajo:zona.anterior|Shift+F6}} | Pasa a la zona siguiente / anterior. Funciona desde cualquier lado, también desde una consola y desde el texto de una nota. |
| {{atajo:panel.izquierda|Ctrl+Alt+←}} / {{atajo:panel.derecha|Ctrl+Alt+→}} | Pasa al panel de la izquierda / de la derecha cuando la vista está dividida. |

Cada documento abierto en una pestaña —una nota, un lienzo, una tabla, el calendario, una
consola…— tiene **dos modos**:

- **Escribiendo**: el foco está dentro del documento y las teclas son suyas. Solo actúan
  los atajos con **Ctrl**, **Alt** o una tecla **F**, así que escribir nunca dispara nada.
- **Seleccionado**: el documento entero tiene el foco, con un **contorno punteado**. Desde
  ahí te mueves por la app.

| Atajo | Qué hace |
|---|---|
| **Esc** | Sale de escribir y deja el documento seleccionado. Si hay algo abierto —las sugerencias de `[[`, la búsqueda en la nota, un menú, el texto de una tarjeta—, el primer **Esc** lo cierra y el segundo sale. |
| **Enter** | Sobre un documento seleccionado, vuelve a escribir donde estabas: en una nota, con el cursor donde lo dejaste; en la lectura, en el primer enlace o casilla; en una tabla, en la primera fila. |

En una **consola** y en un **dibujo de Excalidraw**, **Esc** es suyo (lo usan la shell, vim
o la herramienta de dibujo): de ahí se sale con **F6**. En un **diagrama de draw.io** el
teclado lo tiene el editor de diagramas y los demás atajos de Mycelium no llegan mientras
escribes ahí: también se sale con **F6** (o **Shift+F6**, hacia atrás).

Después de **Ctrl+Tab**, **Ctrl+W** o **Ctrl+Shift+T**, el documento que queda a la vista
queda seleccionado; si venías escribiendo en una nota y la que queda también es una nota,
sigues escribiendo en ella. Una consola nunca toma el teclado sola: queda seleccionada y
**Enter** entra.

## Hacer clic con el teclado: las pistas

**{{atajo:pistas.mostrar|F10}}** muestra una **pista** —una letra, o dos si hay muchas
cosas a la vista— sobre cada botón, enlace, pestaña, fila, campo y documento que se ve en la
ventana. Escribir esas letras es como hacer clic ahí, sin el mouse.

| Atajo | Qué hace |
|---|---|
| Las letras de una pista | Hace clic en lo que señala. En un campo de texto, en el texto de una nota o en una consola, pone el cursor ahí para escribir; en un diagrama o un PDF, entra en él. Al escribir la primera letra de un par, las pistas que no empiezan así se apagan. |
| **Shift** + las letras | Solo pone el foco ahí, sin hacer clic: para seguir con el teclado desde ese lugar. |
| **Retroceso** | Borra la última letra escrita. |
| **Esc** o {{atajo:pistas.mostrar|F10}} | Cierra las pistas sin hacer nada. |

- Las letras funcionan igual con cualquier idioma del teclado: cuenta la **posición** de la
  tecla. Las pistas te muestran la letra de tu teclado.
- Con un diálogo abierto —la paleta, Configuración, un aviso—, las pistas son las del
  diálogo.
- El texto de una nota es **una** pista (el cursor vuelve donde estaba), no una por renglón.
  El grafo también es una sola: selecciona la pestaña. En un lienzo, cada tarjeta lleva la
  suya y la letra la selecciona.
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
| {{atajo:historial.atras|Alt+←}} / {{atajo:historial.adelante|Alt+→}} | Atrás y adelante en lo que se abrió en la pestaña. Dentro del texto de una nota, esas teclas mueven el cursor. |
| {{atajo:panel-izquierdo.alternar|Ctrl+\}} | Muestra u oculta el panel lateral. |
| {{atajo:explorador.alternar|Ctrl+Shift+E}} | Muestra u oculta el explorador, con el foco en el árbol de archivos. |
| {{atajo:panel-derecho.alternar|Ctrl+Shift+\}} | Muestra u oculta el panel de enlaces de la nota. Funciona también con el cursor junto a un paréntesis. |
| **←** / **→**, **Inicio** / **Fin** | Con el foco en la barra de pestañas, recorren las pestañas. **Supr** cierra la enfocada. |
| **Shift+F10** o la tecla de menú | Con el foco en una pestaña, su menú: cerrar, fijar, dividir, anclar en el panel lateral y exportar. |

En la paleta (**Ctrl+P**) están además **Dividir a la derecha**, **Dividir hacia abajo**,
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

Después de tocar el lienzo, con el foco fuera del texto de una tarjeta:

| Atajo | Qué hace |
|---|---|
| **Ctrl+Z** | Deshace el último cambio del [lienzo](ayuda:tipos-de-archivo/lienzos). |
| **Ctrl+Y** o **Ctrl+Shift+Z** | Rehace lo deshecho. |
| **Supr** | Borra la tarjeta seleccionada (se recupera con Ctrl+Z). |
| **Esc** | Termina de editar el texto de una tarjeta. |

## Consolas

| Atajo | Qué hace |
|---|---|
| **Ctrl+C** | Con texto seleccionado, lo copia; sin selección, interrumpe el programa, como siempre. |
| **Ctrl+V** | Pega. |
| **F6** / **Shift+F6** | Sale de la consola a la zona siguiente / anterior. |

Con el foco en una consola, la shell recibe casi todas las teclas. De fábrica llegan a
Mycelium **F1**, **F6**, **F10**, **Ctrl+P**, **Ctrl+Shift+P**, **Ctrl+O**, **Ctrl+Tab**,
**Ctrl+Shift+Tab**, **Ctrl+\\**, **Ctrl+,**, **Ctrl+Shift+/** y **Ctrl+Alt+←**/**→**; la
shell ya no las recibe (para el comando anterior, usa **↑** en vez de **Ctrl+P**). **Ctrl+W**
sigue siendo de la shell (borra la palabra anterior): para cerrar la consola, sal con **F6**
y pulsa **Ctrl+W**.

La lista se cambia en **Configuración → Atajos de teclado → Teclas que salen de una
consola**: por ejemplo, devuélvele **Ctrl+P** a la shell o deja que **Ctrl+W** cierre la
consola. **F6** y **Shift+F6** salen siempre: son la salida. Las pistas (**F10**) también
llegan siempre.
