---
titulo: Énfasis
tema: Escribir notas
sinonimos: [negrita, cursiva, guion bajo, asterisco, resaltar, degradado, tachado]
---

El **énfasis** destaca una palabra o una frase: cursiva, negrita o las dos. En Markdown se
marca con asteriscos (`*`) o con guiones bajos (`_`) alrededor del texto. Para casi
cualquier programa son lo mismo; **Mycelium los distingue**: el guion bajo, además, le da
color.

## Para qué sirve

Con asteriscos tenés el énfasis de siempre. Con guiones bajos tenés una segunda capa para
lo que querés que salte a la vista —un término clave, una advertencia— sin recurrir a
otra sintaxis. Si abrís la nota en otro programa, se sigue viendo como cursiva o negrita:
no se pierde nada.

## Cómo se usa

1. Rodeá el texto con uno, dos o tres símbolos iguales, sin espacios entre el símbolo y el
   texto.
2. Elegí `*` para el estilo clásico o `_` para la versión con color.

| Escribís | Se ve |
|---|---|
| `*texto*` | cursiva |
| `_texto_` | cursiva, con el color de brillo del tema |
| `**texto**` | negrita |
| `__texto__` | negrita, con el color de acento del tema |
| `***texto***` | negrita y cursiva |
| `___texto___` | negrita **sin** cursiva, con un degradado del brillo al acento |
| `~~texto~~` | tachado |

```ejemplo
*cursiva* y _cursiva con brillo_

**negrita** y __negrita con acento__

***negrita y cursiva*** y ___negrita con degradado___

~~tachado~~
```

> [!info] En medio de una palabra, el guion bajo no estiliza
> `nombre_de_archivo` queda tal cual, como en cualquier Markdown. Si querés destacar una
> parte de una palabra, usá asteriscos: `super*cali*fragilístico`.

```ejemplo
nombre_de_archivo y super*cali*fragilístico
```

En la vista en vivo los símbolos se esconden cuando el cursor no está en la línea, y
reaparecen al volver a ella para que los puedas editar.
