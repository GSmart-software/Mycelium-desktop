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
| `![[Dibujo.excalidraw]]` | Embebe el dibujo dentro de la nota. |

## Notas con el mismo nombre

Si dos notas se llaman igual, `[[Nota]]` lleva a la más cercana a la raíz del vault. Para
apuntar a la otra, anteponé su carpeta: `[[Proyectos/Nota]]`. El autocompletado ya lo
hace solo cuando el título está repetido.

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
