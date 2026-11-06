---
titulo: Atajos de teclado
tema: Atajos de teclado
sinonimos: [teclas, shortcuts, combinaciones, teclado, F6, zonas, sin mouse, salir del editor, salir de la consola, modo navegar, modo escribir]
---

Los atajos que Mycelium entiende, agrupados por dónde funcionan. Algunos solo actúan con
el foco en un lugar —el texto de una nota, el explorador, una consola—: cada tabla lo dice.

## En toda la app

| Atajo | Qué hace |
|---|---|
| **F1** | Abre esta ayuda. Con la ayuda abierta, lleva al buscador. |
| **Ctrl+O** | Ir a una nota por su nombre. |
| **Ctrl+P** o **Ctrl+Shift+P** | La paleta de comandos. |
| **Ctrl+Shift+Espacio** | La [captura rápida](ayuda:herramientas/bandeja-y-captura-rapida): anota en la Bandeja del vault sin cambiar de pestaña. |
| **Ctrl+,** | Configuración. |
| **F12** o **Ctrl+Shift+I** | Las herramientas de desarrollo, si las encendiste para este vault en Configuración → Avanzado. |

## Moverse sin el mouse

La ventana se divide en **zonas**: el rail, el panel lateral, cada panel del área de
trabajo (su barra de pestañas y su documento), el panel de enlaces si está abierto y la
barra de estado. La zona donde estás lleva un **borde** del color de acento mientras usas
el teclado.

| Atajo | Qué hace |
|---|---|
| **F6** / **Shift+F6** | Pasa a la zona siguiente / anterior. Funciona desde cualquier lado, también desde una consola y desde el texto de una nota. |
| **Ctrl+Alt+←** / **Ctrl+Alt+→** | Pasa al panel de la izquierda / de la derecha cuando la vista está dividida. |

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
teclado lo tiene el editor de diagramas y ningún atajo de Mycelium llega mientras escribes
ahí: sal con un clic fuera del diagrama.

Después de **Ctrl+Tab**, **Ctrl+W** o **Ctrl+Shift+T**, el documento que queda a la vista
queda seleccionado; si venías escribiendo en una nota y la que queda también es una nota,
sigues escribiendo en ella. Una consola nunca toma el teclado sola: queda seleccionada y
**Enter** entra.

## Pestañas y paneles

| Atajo | Qué hace |
|---|---|
| **Ctrl+Tab** / **Ctrl+Shift+Tab** | Pestaña siguiente / anterior. |
| **Ctrl+W** | Cierra la pestaña activa. |
| **Ctrl+Shift+T** | Reabre la última pestaña cerrada. |
| **Alt+←** / **Alt+→** | Atrás y adelante en lo que se abrió en la pestaña. Dentro del texto de una nota, esas teclas mueven el cursor. |
| **Ctrl+\\** | Muestra u oculta el panel lateral. |
| **Ctrl+Shift+\\** | Muestra u oculta el panel de enlaces de la nota. |
| **←** / **→**, **Inicio** / **Fin** | Con el foco en la barra de pestañas, recorren las pestañas. **Supr** cierra la enfocada. |

Los botones laterales del mouse (atrás y adelante) también recorren el historial de la
pestaña. **Ctrl+clic** en un enlace lo abre en una pestaña nueva que conserva ese
historial, así que **Atrás** vuelve a la nota de origen.

## Escribir en una nota

| Atajo | Qué hace |
|---|---|
| **Ctrl+1** · **Ctrl+2** · **Ctrl+3** · **Ctrl+4** | Vista **En vivo**, **Dividido**, **Lectura** o **Crudo**. |
| **Ctrl+B** | Negrita. |
| **Ctrl+I** | Cursiva. |
| **Ctrl+Shift+C** | Código en línea. |
| **Ctrl+K** | Inserta un enlace a una página web, con su texto y su dirección. |
| **Ctrl+F** | Busca en la nota: **Enter** siguiente, **Shift+Enter** anterior, **Esc** cierra. |
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

Con el foco en una consola, la shell recibe casi todas las teclas. Llegan a Mycelium
**F1**, **F6**, **Ctrl+P**, **Ctrl+Shift+P**, **Ctrl+O**, **Ctrl+Tab**, **Ctrl+Shift+Tab**,
**Ctrl+\\**, **Ctrl+,** y **Ctrl+Alt+←**/**→**; la shell ya no las recibe (para el comando
anterior, usa **↑** en vez de **Ctrl+P**). **Ctrl+W** sigue siendo de la shell (borra la
palabra anterior): para cerrar la consola, sal con **F6** y pulsa **Ctrl+W**.
