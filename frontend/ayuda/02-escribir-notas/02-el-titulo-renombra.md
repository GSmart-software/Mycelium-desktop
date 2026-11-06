---
titulo: El título renombra el archivo
tema: Escribir notas
sinonimos: [renombrar, nombre del archivo, cambiar el nombre, título de la nota, alias, nombre anterior, renombre externo]
---

El **título** que se ve arriba de la nota no es un texto aparte: es el **nombre del
archivo**, sin el `.md`. Por eso cambiarlo renombra el archivo, y renombrar el archivo
desde el explorador cambia el título.

## Para qué sirve

Para ponerle a una nota el nombre que corresponde sin salir de ella. Al renombrar,
Mycelium **repara los enlaces** que llegaban a esa nota desde otras: los
`[[enlaces]]` comunes, los que llevan alias (`[[Nota|otro texto]]`), los embebidos
(`![[Nota]]`), los que llevan la carpeta adelante (`[[Proyectos/Nota]]`) y los que están
en las propiedades. Nada queda apuntando al nombre viejo.

Si el nombre nuevo es el de otra nota de **otra carpeta**, se acepta: Mycelium te avisa
la coincidencia y escribe con su ruta los enlaces que, si no, cambiarían de nota. Ver
[Notas con el mismo nombre](ayuda:enlazar-y-organizar/enlaces).

## Cómo se usa

1. Haz **clic** en el título, en la vista en vivo, en la mitad izquierda del modo
   dividido o en el modo crudo. En lectura el título no se edita.
2. Escribe el nombre nuevo.
3. **Enter** confirma y deja el cursor al **principio del cuerpo** de la nota (después de
   las propiedades, si las tiene), listo para seguir escribiendo. **Tab** hace lo mismo.
4. **Esc** descarta y te devuelve al texto, donde estaba el cursor. Salir del campo con un
   clic en otro lado también descarta: renombrar es siempre un acto deliberado.

> [!tip] Una nota nueva ya abre con el título listo para escribir
> Al crear una nota con **Nueva nota** (el botón del explorador, el clic derecho en una
> carpeta, **{{atajo:nota.nueva|Ctrl+N}}** o el menú **Nuevo…** de
> **{{atajo:crear.nuevo|Ctrl+Shift+N}}**) o desde una Espora, la nota se abre con el título
> en edición y el nombre seleccionado: lo primero que escribas lo reemplaza. **Enter** la
> nombra y pasa al cuerpo, vacío y listo para escribir; **Esc** le deja el nombre con el que se creó («Sin título», o el de la Espora).

## Conservar el nombre anterior como alias

Al confirmar con **Mayús+Enter** en lugar de Enter —en el título o en el explorador—, la
nota se renombra como siempre y además guarda su nombre anterior en la propiedad `aliases`.
Mientras se escribe un nombre distinto, debajo del campo aparece el recordatorio
«Mayús+Enter: conservar … como alias».

Los enlaces se reparan de todos modos. El alias sirve para lo que no se reescribe: un
nombre citado en un texto, otro vault que enlaza a esta nota, o un `[[Nombre viejo]]`
escrito después por costumbre, que sigue llevando a la nota. Ver
[Otros nombres de una nota](ayuda:enlazar-y-organizar/enlaces).

Está apagado por defecto: la mayoría de los renombres corrigen un nombre, y un alias que
nadie pidió es un nombre viejo que sigue funcionando sin que se note. Solo las notas
Markdown tienen alias; en un dibujo, un lienzo o una tabla, Mayús+Enter es un Enter.

## Nombres que no se aceptan

Si el nombre no sirve, Mycelium no lo corrige por su cuenta: te dice el motivo debajo del
campo, que sigue abierto con lo que escribiste para que lo corrijas. Si lo descartas con
**Esc**, la nota conserva el nombre que tenía.

| No puede… | Ejemplo |
|---|---|
| Llevar `\ / : * ? " < > \|` | `Reunión 3/10` |
| Terminar en punto | `Ideas.` |
| Ser un nombre reservado de Windows | `CON`, `PRN`, `AUX`, `NUL`, `COM1`, `LPT1` |
| Estar vacío | |
| Repetir el de otra nota de la misma carpeta | |

Los espacios de más al final se recortan solos. Las reglas son las de Windows aunque uses
otro sistema, para que el vault se pueda copiar a cualquier computadora.

Desde el **explorador** (clic derecho → **Renombrar**, o **F2**) el campo se abre con el
nombre seleccionado, sin la extensión: lo que escribas lo reemplaza. Ahí, si el nombre
lleva alguno de esos caracteres, Mycelium no lo rechaza: lo cambia por `-` y te avisa
cuáles reemplazó y cómo quedó el nombre.

## Renombres hechos fuera de Mycelium

Si el archivo se renombra o se mueve desde el explorador del sistema, con la terminal o
con git, Mycelium no reescribe los enlaces por su cuenta: quedan apuntando al nombre
viejo. Pero cuando en el mismo momento desaparece una nota y aparece otra con el mismo
contenido (sin contar las propiedades, o con casi todas sus líneas iguales), muestra un
aviso:

> Parece que «Viejo» se renombró a «Nuevo» fuera de Mycelium. ¿Reparar 3 enlaces (en 2
> notas) que apuntaban a «Viejo»?

- **Reparar** reescribe esos enlaces igual que un renombre hecho desde Mycelium.
- **Reparar y guardar alias** además deja «Viejo» como alias de la nota.
- Cerrar el aviso, o dejar que se vaya, no cambia nada.

Solo aparece si había enlaces que reparar, y nunca por los renombres hechos desde la
propia app. La reparación queda en el registro de actividad, desde donde se puede
deshacer.

> [!warning] Lo más seguro sigue siendo renombrar desde Mycelium
> El aviso depende de que el borrado y la creación lleguen juntos y de que el contenido
> se parezca: un archivo renombrado y muy editado a la vez no se reconoce. Y en un cambio
> masivo —más de mil notas que desaparecen y mil que aparecen a la vez, como un `git
> checkout` grande— no se busca ningún renombre, para no trabar la app.

Más sobre cómo se escriben los enlaces en [Enlaces, alias y embeds](ayuda:enlazar-y-organizar/enlaces).
