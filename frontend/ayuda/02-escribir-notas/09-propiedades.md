---
titulo: Propiedades
tema: Escribir notas
sinonimos: [frontmatter, metadatos, yaml, campos, atributos, tags]
---

Las **propiedades** son datos de la nota escritos como `clave: valor` en un bloque entre
dos líneas `---`, al principio del archivo. Es el *frontmatter* de YAML que usan Obsidian
y muchos otros programas. Mycelium lo muestra como una tarjeta arriba de la nota, te deja
editarlo sin tocar el YAML y lo usa para buscar.

## Para qué sirve

Para darle a cada nota un estado, una fecha, una prioridad o una lista de etiquetas, y
después encontrar o listar las notas por esos datos: en la búsqueda, o en una
[base](ayuda:tipos-de-archivo/bases) que arma una tabla con ellas.

## Cómo se usa

1. Escribí el bloque en la primera línea del archivo, o tocá «Propiedades de la nota» en
   la barra de formato para que Mycelium lo cree.
2. En la vista en vivo la tarjeta se edita en el lugar: clic en un valor para cambiarlo,
   clic en la clave para renombrarla, «+ Agregar propiedad» al pie y × para quitar una.
3. También podés editarlas desde la pestaña **PROPIEDADES** del panel de la nota.

```yaml
---
estado: activo
prioridad: 3
publicado: false
vence: 2026-08-30
reunion: 2026-08-30T15:00
tags: [proyecto, mycelium]
relacionada: "[[Plan anual]]"
---
```

## Tipos de valor

Mycelium reconoce el tipo por cómo está escrito el valor:

| Tipo | Se escribe | Ejemplo |
|---|---|---|
| Texto | cualquier cosa, con o sin comillas | `estado: activo` |
| Número | entero o con decimales | `prioridad: 3` |
| Casilla | `true` o `false` | `publicado: false` |
| Fecha | `AAAA-MM-DD` | `vence: 2026-08-30` |
| Fecha y hora | `AAAA-MM-DDTHH:mm` | `reunion: 2026-08-30T15:00` |
| Lista | `[a, b]`, o una línea `- ` por elemento | `tags: [proyecto, activo]` |

Un valor entre comillas es siempre texto: `version: "1.0"` no es un número.

- **`tags`** es especial: sus valores son etiquetas de la nota, igual que un `#tag` del
  cuerpo. Se pueden escribir con o sin `#`. Ver [Etiquetas](ayuda:enlazar-y-organizar/etiquetas).
- Un `[[enlace]]` dentro de un valor funciona como cualquier enlace. Va entre comillas,
  como en el ejemplo.

## Buscar por propiedad

En la [búsqueda](ayuda:enlazar-y-organizar/busqueda), `clave:valor` encuentra las notas
cuya propiedad tiene ese valor, sin importar las mayúsculas ni las tildes: `estado:activo`, y
`familia:solanaceas` encuentra `familia: Solanáceas`. Sin comillas alcanza con una palabra
del valor (`bancal:bancal` encuentra «Bancal 1»); entre comillas tiene que ser el valor
entero, y es como se escribe uno con espacios: `bancal:"Bancal 1"`. En una
lista alcanza con que coincida un elemento. Se puede combinar con texto común:
`estado:activo reunión`. Para las etiquetas se usa `tag:proyecto`.

> [!warning] Lo que Mycelium no entiende, lo deja como está
> Solo se interpreta un mapa plano. Un mapa anidado, un texto de varias líneas (`|` o
> `>`), anclas y alias de YAML (`&`, `*`), un mapa en línea (`{…}`), una lista de mapas o
> una clave repetida hacen que el bloque se muestre **crudo**, con un aviso que dice el
> motivo, y la nota queda sin propiedades. Nada se borra ni se reescribe: corregilo con
> «Editar como texto» o en el modo crudo.
