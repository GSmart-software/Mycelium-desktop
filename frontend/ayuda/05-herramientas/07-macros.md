---
titulo: Macros
tema: Herramientas
sinonimos: [macro, macros, mover un paso, Ctrl+flechas, secuencia, automatizar, repetir, pasos, grabar, grabar macro, insertar texto, snippet, nota del día, diario, plantilla, atajo propio]
---

Una **macro** es una lista de pasos con nombre que Mycelium ejecuta uno detrás de otro: abrir
una nota, dividir el panel, crear una nota desde una Espora, escribir un texto donde está el
cursor… Sirve para lo que haces siempre igual, y se ejecuta desde la paleta o con un atajo
propio.

Las macros son **tuyas**: valen en todos los vaults, como los atajos.

## Ejecutar una macro

- Desde la paleta de comandos (**{{atajo:paleta.comandos|Ctrl+P}}**): cada macro aparece como
  **Macro:** seguido de su nombre. Escribe «macro» para verlas todas.
- Con su **atajo**, si le diste uno (más abajo). Las macros con atajo aparecen también en la
  [hoja de atajos](ayuda:atajos-de-teclado/atajos-de-teclado), en el grupo **Macros**.

Los pasos se ejecutan **en orden** y cada uno espera a que el anterior termine. Si un paso
falla —el comando no está disponible en ese momento, la nota no existe, no hay una nota abierta
para escribir—, la macro **se detiene ahí** y un aviso te dice qué paso falló y por qué.

## Las macros de fábrica

Mycelium trae tres, que puedes cambiar o borrar:

| Macro | Qué hace |
|---|---|
| **Nota nueva al lado** | Divide el panel a la derecha y crea una nota nueva ahí, con el título listo para escribir. |
| **Nota del día** | Abre la nota de hoy (`Diario/AAAA-MM-DD`); si no existe, la crea con un encabezado con la fecha. |
| **Ordenar la Bandeja** | Abre la [Bandeja](ayuda:herramientas/bandeja-y-captura-rapida) del vault como nota completa, para repasar lo anotado. |

Ninguna trae atajo: dale el que quieras. **Restaurar las macros de fábrica** las vuelve a poner
como venían (las tuyas no se tocan).

## Crear y editar macros

En **Configuración → Macros** (o con **Editar las macros** en la paleta) están todas, con un
buscador. **Nueva macro** crea una vacía; pulsa una macro para desplegarla y editarla:

- **Nombre**: se cambia escribiendo; **Enter** lo confirma.
- **Probar**: cierra Configuración y ejecuta la macro.
- **Duplicar** y **Borrar**. Una macro de fábrica cambiada tiene además **Restaurar**.
- **Atajo**: igual que en Configuración → Atajos de teclado. Pulsa **+** y luego la
  combinación; si ya es de otro comando, te ofrece reemplazarla. Las teclas reservadas y las
  letras solas no se pueden usar.
- **Pasos**: elige el tipo y pulsa **Agregar paso**. Cada paso tiene botones para subirlo,
  bajarlo o quitarlo; con el foco en un paso, **Ctrl+↑** y **Ctrl+↓** también lo mueven.

Todo se maneja con el teclado: **Tab** recorre los campos y los botones, y el buscador de
comandos se usa con **↑**, **↓**, **Enter** y **Esc**.

## Los tipos de paso

| Paso | Qué hace |
|---|---|
| **Ejecutar un comando** | Cualquier comando de la paleta, o **otra macro**. Se elige con un buscador. |
| **Insertar texto** | Escribe el texto en la nota del panel activo, donde está el cursor (reemplaza lo seleccionado). Si el paso anterior abrió o creó una nota, espera a que esté lista. |
| **Abrir una nota** | Abre una nota por su título o su ruta, como un enlace `[[…]]` (`Ideas`, `Proyectos/Plan`). Con **Crearla si no existe**, la crea —con sus carpetas— y le pone el contenido que escribas. |
| **Crear desde una Espora** | Crea una nota desde la [Espora](ayuda:enlazar-y-organizar/esporas) con ese nombre, en la carpeta que indiques o, si la dejas vacía, en la seleccionada del explorador. |
| **Esperar** | Unos milisegundos, hasta 10 segundos. Casi nunca hace falta: cada paso ya espera al anterior. |

En los textos de los pasos —el texto que se inserta, la nota que se abre y su contenido, la
Espora y la carpeta— puedes usar las mismas variables que en las Esporas:

| Variable | Se reemplaza por |
|---|---|
| `{{fecha}}` | La fecha de hoy: `2026-11-06`. |
| `{{hora}}` | La hora: `14:30`. |
| `{{fecha:DD/MM/AAAA}}` | La fecha con tu formato (`AAAA`, `MM`, `DD`, `hh`, `mm`, `ss`). |
| `{{titulo}}` | El título de la nota activa; en el contenido de una nota que se crea, el de la nota nueva. |

Una macro **no puede llamarse a sí misma**, ni directamente ni a través de otras: el buscador
no te ofrece las macros que armarían esa vuelta, y si alguna quedara así, al ejecutarla se
detiene con un aviso en vez de repetirse sin fin.

## Grabar una macro

En lugar de armarla paso a paso, puedes **grabarla**:

1. Busca **Grabar una macro** en la paleta (o pulsa el botón en Configuración → Macros). En la
   barra de estado aparece **Grabando macro**, con la cantidad de pasos.
2. Haz lo que quieras repetir: lo que ejecutes **desde la paleta o con un atajo** queda
   anotado, y también las notas que abras con **Ir a una nota** (**{{atajo:paleta.notas|Ctrl+O}}**)
   y lo que elijas en el menú **Nuevo…**.
3. Detén la grabación con **Detener la grabación de la macro** en la paleta o pulsando el
   aviso de la barra de estado. Se abre Configuración → Macros con lo grabado: **Guardar como
   macro** la crea (con el nombre «Macro grabada», que puedes cambiar) y **Descartar** la olvida.

Lo que haces con el mouse o escribiendo dentro de una nota **no** se graba: solo los comandos.
Para que la macro escriba un texto, agrégale después un paso **Insertar texto**.

Tampoco se graba **moverse con el teclado** —**Ctrl+flechas**, **Enter** para entrar y **Alt** o
**Esc** para salir—, porque depende de dónde esté el foco en ese momento. Los accesos directos
a una sección (**Ctrl+Num 1** a **Ctrl+Num 5**) sí se graban: llevan siempre al mismo lugar.
