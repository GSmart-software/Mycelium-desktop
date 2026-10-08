---
titulo: El título renombra el archivo
tema: Escribir notas
sinonimos: [renombrar, nombre del archivo, cambiar el nombre, título de la nota]
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

1. Hacé **clic** en el título, en la vista en vivo, en la mitad izquierda del modo
   dividido o en el modo crudo. En lectura el título no se edita.
2. Escribí el nombre nuevo.
3. **Enter** confirma y deja el cursor al **principio del cuerpo** de la nota (después de
   las propiedades, si las tiene), listo para seguir escribiendo. **Tab** hace lo mismo.
4. **Esc** descarta y te devuelve al texto, donde estaba el cursor. Salir del campo con un
   clic en otro lado también descarta: renombrar es siempre un acto deliberado.

> [!tip] Una nota nueva ya abre con el título listo para escribir
> Al crear una nota con **Nueva nota** (el botón del explorador, el clic derecho en una
> carpeta o **Ctrl+P** → «Nueva nota») o desde una Espora, la nota se abre con el título
> en edición y el nombre seleccionado: lo primero que escribas lo reemplaza. **Enter** la
> nombra y pasa al cuerpo, vacío y listo para escribir; **Esc** le deja el nombre con el que se creó («Sin título», o el de la Espora).

## Nombres que no se aceptan

Si el nombre no sirve, Mycelium no lo corrige por su cuenta: te dice el motivo debajo del
campo, que sigue abierto con lo que escribiste para que lo corrijas. Si lo descartás con
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

> [!warning] Fuera de Mycelium, los enlaces no se reparan
> Si renombrás o movés el archivo desde el explorador del sistema o con la terminal,
> Mycelium ve el cambio pero no reescribe los enlaces de las otras notas: quedan
> apuntando al nombre viejo. Renombrá desde el título o desde el explorador de Mycelium.

Más sobre cómo se escriben los enlaces en [Enlaces, alias y embeds](ayuda:enlazar-y-organizar/enlaces).
