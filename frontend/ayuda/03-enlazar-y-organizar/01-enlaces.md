---
titulo: Enlaces, alias y embeds
tema: Enlazar y organizar
sinonimos: [wikilink, vínculo, enlace interno, corchetes, enlace roto, alias, embeber]
---

Un **enlace** une una nota con otra: escribís el título de la nota entre corchetes dobles,
`[[así]]`. Es la pieza que convierte notas sueltas en una red: cada enlace es una línea en
el [grafo](ayuda:enlazar-y-organizar/grafo) y aparece en el panel de enlaces de las dos
notas.

## Para qué sirve

Para llegar de una idea a la relacionada con un clic, y para que la nota de destino sepa
quién la cita. No hace falta que la nota exista todavía: el enlace queda marcado como
pendiente hasta que la crees.

## Cómo se usa

1. Escribí `[[` y empezá a tipear el título: Mycelium sugiere las notas del vault. Elegí
   una con **Enter** y cierra los corchetes por vos.
2. Si querés que se lea otro texto, agregá un **alias** después de una barra vertical.
3. **Clic** en el enlace para abrir la nota.

```ejemplo
Lo hablamos en la [[Reunión de lanzamiento]].

El plan está en [[Plan 2026|el plan del año]].
```

| Escribís | Qué hace |
|---|---|
| `[[Nota]]` | Enlaza a la nota por su título, sin la extensión `.md`. |
| `[[Nota\|texto]]` | Enlaza a la nota y muestra «texto». |
| `[[Carpeta/Nota]]` | Elige entre dos notas con el mismo nombre en carpetas distintas. |
| `[[Nota#Encabezado]]` | Abre la nota y lleva al encabezado. Se lee «Nota › Encabezado». |
| `[[#Encabezado]]` | Lleva a un encabezado de la misma nota. |
| `[[Nota#^bloque]]` | Abre la nota y lleva a la línea que termina en `^bloque`. |
| `![[Dibujo.excalidraw]]` | Embebe el dibujo dentro de la nota. |

## Enlazar a un encabezado

Después del título, un `#` y el texto de un encabezado de esa nota: `[[Tomate#Cuidados]]`.
Se lee «Tomate › Cuidados» (o el alias, si le pusiste uno) y el clic abre la nota con el
encabezado arriba, en cualquier vista. No importan las mayúsculas ni los espacios de más.
Para un encabezado dentro de otro, encadenalos: `[[Tomate#Riego#Verano]]`.

Cuenta como un enlace a la nota: en el grafo, en el panel de enlaces y al renombrarla, que
conserva el `#Cuidados`. Si la nota existe pero ya no tiene ese encabezado, el enlace no se
marca roto: abre la nota desde el principio. El autocompletado sugiere notas, no
encabezados: el `#Encabezado` se escribe a mano.

## Notas con el mismo nombre

Dos notas de carpetas distintas pueden llamarse igual. Entonces `[[Nota]]` lleva a la más
cercana a la raíz del vault; para apuntar a la otra, anteponé su carpeta:
`[[Proyectos/Nota]]`. El autocompletado ya lo hace solo cuando el título está repetido.

Cuando **renombrás, creás, duplicás o movés** una nota (o una carpeta) desde Mycelium y eso
deja dos notas con el mismo nombre —o cambia cuál de las dos queda más cerca de la raíz—,
ningún enlace que ya existía cambia de destino: Mycelium escribe con su ruta los que, si
no, pasarían a llevar a la otra. Por ejemplo, si ya existe `Cultivos/Tomate` y renombrás
a «Tomate» una nota de la raíz, los `[[Tomate]]` que iban al cultivo pasan a ser
`[[Cultivos/Tomate]]`, con su alias, su `!` de embebido y su `#sección` intactos. Un aviso
te cuenta la coincidencia y en cuántas notas se escribió la ruta.

> [!tip] La nota de la raíz no necesita carpeta
> Para una nota que está en la raíz, `[[Tomate]]` ya es su ruta completa: le gana a
> cualquier homónima que esté en una carpeta.

Lo que escribas **después** decide a cuál apunta: un `[[Tomate]]` nuevo lleva a la de la
raíz.

## Enlaces rotos

Un enlace a una nota que no existe se ve en un tono más oscuro que los demás y no lleva
a ningún lado. Cuando creás la nota con ese título, el enlace se conecta solo. Y si renombrás una
nota desde Mycelium, los enlaces que la apuntaban se actualizan: [el título renombra el
archivo](ayuda:escribir-notas/el-titulo-renombra).

## Embeds

Con un `!` adelante, el enlace **muestra** el archivo en lugar de llevar a él. Sirve para
imágenes, dibujos y diagramas: los detalles están en
[Imágenes y archivos embebidos](ayuda:escribir-notas/imagenes-y-embebidos).

> [!warning] Embeber una nota entera todavía no muestra su contenido
> `![[Otra nota]]` cuenta como enlace en el grafo, pero no dibuja el texto de esa nota
> dentro de la tuya. Por ahora, para eso usá un enlace común.

> [!tip] Dentro de una tabla, escapá la barra del alias
> En una tabla, la barra vertical separa columnas. Para un alias ahí, escribí
> `[[Nota\|texto]]`: Mycelium lo entiende como el mismo enlace.
