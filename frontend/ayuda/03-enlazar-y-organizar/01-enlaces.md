---
titulo: Enlaces, alias y embeds
tema: Enlazar y organizar
sinonimos: [wikilink, vínculo, enlace interno, corchetes, enlace roto, alias, aliases, otro nombre, sinónimo, embeber]
---

Un **enlace** une una nota con otra: escribes el título de la nota entre corchetes dobles,
`[[así]]`. Es la pieza que convierte notas sueltas en una red: cada enlace es una línea en
el [grafo](ayuda:enlazar-y-organizar/grafo) y aparece en el panel de enlaces de las dos
notas.

## Para qué sirve

Para llegar de una idea a la relacionada con un clic, y para que la nota de destino sepa
quién la cita. No hace falta que la nota exista todavía: el enlace queda marcado como
pendiente, y un clic sobre él la crea.

## Cómo se usa

1. Escribe `[[` y empieza a escribir el título: Mycelium sugiere las notas del vault. Elige
   una con **Enter** y cierra los corchetes por ti.
2. Si quieres que se lea otro texto, agrega un **alias** después de una barra vertical.
3. **Clic** en el enlace para abrir la nota. **Ctrl+clic** la abre en una pestaña nueva y
   el clic con la rueda, en una pestaña nueva en segundo plano. En las dos, **Atrás**
   vuelve a la nota de la que salió el enlace.

```ejemplo
Lo hablamos en la [[Reunión de lanzamiento]].

El plan está en [[Plan 2026|el plan del año]].
```

| Escribes | Qué hace |
|---|---|
| `[[Nota]]` | Enlaza a la nota por su título, sin la extensión `.md`. |
| `[[Nota\|texto]]` | Enlaza a la nota y muestra «texto». |
| `[[Carpeta/Nota]]` | Elige entre dos notas con el mismo nombre en carpetas distintas. |
| `[[Otro nombre]]` | Enlaza a la nota que declara «Otro nombre» en su propiedad `aliases`. |
| `[[Nota#Encabezado]]` | Abre la nota y lleva al encabezado. Se lee «Nota › Encabezado». |
| `[[#Encabezado]]` | Lleva a un encabezado de la misma nota. |
| `[[Nota#^bloque]]` | Abre la nota y lleva a la línea que termina en `^bloque`. |
| `![[Dibujo.excalidraw]]` | Embebe el dibujo dentro de la nota. |

## Enlazar a un encabezado

Después del título, un `#` y el texto de un encabezado de esa nota: `[[Tomate#Cuidados]]`.
Se lee «Tomate › Cuidados» (o el alias, si le pusiste uno) y el clic abre la nota con el
encabezado arriba, en cualquier vista. No importan las mayúsculas ni los espacios de más.
Para un encabezado dentro de otro, encadénalos: `[[Tomate#Riego#Verano]]`.

Cuenta como un enlace a la nota: en el grafo, en el panel de enlaces y al renombrarla, que
conserva el `#Cuidados`. Si la nota existe pero ya no tiene ese encabezado, el enlace no se
marca roto: abre la nota desde el principio. El autocompletado sugiere notas, no
encabezados: el `#Encabezado` se escribe a mano.

## Otros nombres de una nota

Una nota puede tener **otros nombres** además de su título: se declaran en la propiedad
`aliases` del frontmatter, como una lista o como un texto.

```yaml
---
aliases: [HU-009, Gestión de usuarios]
---
```

Con eso, `[[HU-009]]` lleva a esa nota aunque el archivo se llame de otra forma: el enlace
no se marca roto, el clic la abre, y cuenta en el [grafo](ayuda:enlazar-y-organizar/grafo)
y en el panel de enlaces como cualquier otro. También funciona con un encabezado
(`[[HU-009#Criterios]]`). El autocompletado de `[[` sugiere los alias junto a los
títulos, con la nota a la que llevan (`→ HU-009 Gestión de usuarios`).

- **Un título siempre gana a un alias.** Si existe una nota que se llama `HU-009`,
  `[[HU-009]]` lleva a ella y no a la que lo declara como alias.
- **Dos notas con el mismo alias** se desempatan igual que dos con el mismo título: gana la
  más cercana a la raíz del vault. El autocompletado inserta la otra con su ruta.
- Las mayúsculas no importan (`[[hu-009]]` también sirve); las tildes sí.
- El alias se escribe solo, sin carpeta: `[[Carpeta/HU-009]]` no lo busca.
- También vale la clave `alias` (la forma vieja de Obsidian).

Es útil para siglas, sinónimos y nombres viejos: al renombrar una nota se puede
[conservar el nombre anterior como alias](ayuda:escribir-notas/el-titulo-renombra).
No hay que confundirlo con el texto que se muestra en un enlace (`[[Nota|texto]]`): ese
cambia cómo se lee un enlace, no a qué nota lleva.

## Notas con el mismo nombre

Dos notas de carpetas distintas pueden llamarse igual. Entonces `[[Nota]]` lleva a la más
cercana a la raíz del vault; para apuntar a la otra, antepón su carpeta:
`[[Proyectos/Nota]]`. El autocompletado ya lo hace solo cuando el título está repetido.

Cuando **renombras, creas, duplicas o mueves** una nota (o una carpeta) desde Mycelium y eso
deja dos notas con el mismo nombre —o cambia cuál de las dos queda más cerca de la raíz—,
ningún enlace que ya existía cambia de destino: Mycelium escribe con su ruta los que, si
no, pasarían a llevar a la otra. Por ejemplo, si ya existe `Cultivos/Tomate` y renombras
a «Tomate» una nota de la raíz, los `[[Tomate]]` que iban al cultivo pasan a ser
`[[Cultivos/Tomate]]`, con su alias, su `!` de embebido y su `#sección` intactos. Un aviso
te cuenta la coincidencia y en cuántas notas se escribió la ruta.

> [!tip] La nota de la raíz no necesita carpeta
> Para una nota que está en la raíz, `[[Tomate]]` ya es su ruta completa: le gana a
> cualquier homónima que esté en una carpeta.

Lo que escribas **después** decide a cuál apunta: un `[[Tomate]]` nuevo lleva a la de la
raíz.

## Enlaces rotos

Un enlace a una nota que no existe se ve en un tono más oscuro que los demás. Un **clic**
sobre él **crea la nota** con ese título y la abre, en la vista en vivo y en la de lectura
(con **Ctrl+clic** o la rueda, en una pestaña nueva):

| Enlace | Dónde se crea |
|---|---|
| `[[Idea nueva]]` | En la raíz del vault. |
| `[[Proyectos/Idea nueva]]` | En la carpeta `Proyectos`. Si no existe, se crea. |
| `[[Idea nueva#Sección]]` | La nota «Idea nueva», en la raíz, sin la sección. |
| `[[Mapa.canvas]]` | Un lienzo llamado «Mapa» (la extensión decide el tipo). |

Los caracteres que un nombre de archivo no admite (`? : * | " < > \`) se reemplazan por
`-`, como en cualquier nota nueva. Un enlace a una imagen o a un PDF que no existe no crea
nada.

Si la nota se crea por otro camino con ese título, el enlace se conecta solo. Y si se
renombra una nota desde Mycelium, los enlaces que la apuntaban se actualizan: [el título
renombra el archivo](ayuda:escribir-notas/el-titulo-renombra).

## Embeds

Con un `!` adelante, el enlace **muestra** el archivo en lugar de llevar a él. Sirve para
imágenes, dibujos y diagramas: los detalles están en
[Imágenes y archivos embebidos](ayuda:escribir-notas/imagenes-y-embebidos).

> [!warning] Embeber una nota entera todavía no muestra su contenido
> `![[Otra nota]]` cuenta como enlace en el grafo, pero no dibuja el texto de esa nota
> dentro de la tuya. Por ahora, para eso usa un enlace común.

> [!tip] Dentro de una tabla, escapa la barra del alias
> En una tabla, la barra vertical separa columnas. Para un alias ahí, escribe
> `[[Nota\|texto]]`: Mycelium lo entiende como el mismo enlace.
