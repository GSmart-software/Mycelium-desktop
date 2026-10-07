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

## Cómo se usa

1. Hacé **clic** en el título, en la vista en vivo, en la mitad izquierda del modo
   dividido o en el modo crudo. En lectura el título no se edita.
2. Escribí el nombre nuevo.
3. **Enter** confirma. **Esc** descarta, y salir del campo con un clic en otro lado
   también descarta: renombrar es siempre un acto deliberado.

## Nombres que no se aceptan

Si el nombre no sirve, Mycelium no lo corrige por su cuenta: te dice el motivo y la nota
conserva el nombre que tenía.

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
