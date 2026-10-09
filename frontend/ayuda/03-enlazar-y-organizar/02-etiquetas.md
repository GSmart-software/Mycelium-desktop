---
titulo: Etiquetas
tema: Enlazar y organizar
sinonimos: [tags, numeral, almohadilla, hashtag, categorías]
---

Una **etiqueta** es una palabra con `#` adelante, como `#reunión`. Marca de qué trata una
nota sin importar en qué carpeta está: una carpeta ordena, una etiqueta cruza.

## Para qué sirve

Para juntar notas de un mismo tema o estado —`#pendiente`, `#idea`, `#cliente`— y después
encontrarlas todas de una vez con la [búsqueda](ayuda:enlazar-y-organizar/busqueda) o
pintarlas de un color en el [grafo](ayuda:enlazar-y-organizar/grafo).

## Cómo se usa

1. Escribí `#` y la palabra, pegada, en cualquier parte del texto. Se ve como una píldora.
2. Para buscar las notas que la llevan, escribí `tag:reunión` en la búsqueda global. Trae
   solo las que tienen la etiqueta —no las que mencionan la palabra—, sin importar tildes ni
   mayúsculas, y con `tag:proyecto` también las anidadas, como `#proyecto/faro`.

```ejemplo
Ideas para el lanzamiento #marketing #idea

Seguimiento del cliente #proyecto/faro
```

Una etiqueta admite letras (con tildes), números, `_`, `-` y `/`. Termina en el primer
espacio o signo de puntuación. La barra sirve para ordenarlas por niveles, como
`#proyecto/faro`.

## Etiquetas en las propiedades

La propiedad `tags` también son etiquetas de la nota: valen lo mismo que las del cuerpo y
se encuentran con la misma búsqueda. Se escriben como lista, con o sin `#`.

```yaml
---
tags: [proyecto, faro]
---
```

> [!info] Antes del `#` tiene que haber un espacio
> La etiqueta empieza al principio de una línea, después de un espacio o de un paréntesis.
> En `texto#algo` el `#` queda como texto. Y `# Título`, con espacio, es un encabezado.

Más sobre las propiedades en [Propiedades](ayuda:escribir-notas/propiedades).
