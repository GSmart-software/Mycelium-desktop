---
titulo: Callouts
tema: Escribir notas
sinonimos: [avisos, admonitions, cajas, recuadros, advertencia, nota destacada, plegable]
---

Un **callout** es una cita con un tipo: un recuadro con color, ícono y título que hace
saltar a la vista un aviso, un consejo o una pregunta. Se escribe como una cita de
Markdown (`>`) cuya primera línea es `[!tipo]`, igual que en Obsidian.

## Para qué sirve

Para separar del resto lo que no se puede pasar por alto —una advertencia, una decisión,
un dato clave— y para esconder detalles en un recuadro plegable que se abre cuando hace
falta.

## Cómo se usa

1. Empezá una línea con `> [!tipo]` y, si querés, un título después.
2. Seguí con más líneas que empiecen con `>`: son el cuerpo.
3. Para que se pueda plegar, poné `-` (empieza cerrado) o `+` (empieza abierto) justo
   después del corchete.

```ejemplo
> [!warning] Antes de borrar
> Revisá que ninguna nota enlace a esta.

> [!tip]
> Sin título, el callout usa el nombre de su tipo.
```

## Los tipos

Hay diez tipos con color e ícono propios. No importan las mayúsculas: `[!NOTE]` es lo
mismo que `[!note]`.

| Tipo | Título si no escribís uno |
|---|---|
| `note` | Nota |
| `tip` | Consejo |
| `important` | Importante |
| `warning` | Advertencia |
| `caution` | Precaución |
| `info` | Información |
| `success` | Éxito |
| `error` | Error |
| `danger` | Peligro |
| `question` | Pregunta |

Un tipo que no está en la lista también funciona: se ve con el color y el ícono de `note`
y, sin título, muestra el nombre del tipo. Con un [snippet de CSS](ayuda:configuracion/css-y-snippets)
le podés dar color e ícono propios.

## Plegables

```ejemplo
> [!question]- ¿Por qué se decidió así? (cerrado)
> Porque era la opción más simple.

> [!info]+ Detalles (abierto)
> Se puede cerrar con un clic en el título.
```

En la vista en vivo, la flecha al lado del título lo pliega y despliega, y escribe el
cambio en la nota: alterna el `-` y el `+`.

## Uno dentro de otro

Cada `>` de más es un nivel más adentro:

```ejemplo
> [!note] Proyecto
> Lo general.
>
> > [!warning] Riesgo
> > Lo que puede salir mal.
```

El título puede llevar formato: un enlace o un `_texto_` conservan su propio color; el
resto del título toma el del callout.

Fuera de la línea donde está el cursor, la vista en vivo esconde el `> [!tipo]` y deja solo
el título, como con el [énfasis](ayuda:escribir-notas/enfasis).
