---
titulo: Tablas
tema: Escribir notas
sinonimos: [tabla, filas, columnas, celdas, alinear, grilla]
---

Una **tabla** se escribe en Markdown con barras `|` entre las columnas y una fila de
guiones debajo del encabezado. En la vista en vivo **no hace falta tocar ese texto**: la
tabla se ve dibujada y se edita sobre el dibujo, celda por celda.

## Para qué sirve

Para ordenar datos en filas y columnas dentro de una nota: una comparación, un
cronograma, una lista con varios campos. Como sigue siendo Markdown, cualquier otro
programa la lee igual.

## Cómo se usa

1. Escribí el encabezado y la fila de guiones; cuando el cursor sale de la tabla, se
   dibuja.
2. Hacé **clic** en una celda para escribir en ella. **Enter** o salir de la celda
   confirma; **Esc** descarta; **Tab** y **Shift+Tab** pasan a la celda siguiente o
   anterior.
3. Para agregar, quitar o mover, usá los tiradores que aparecen al pasar el puntero por
   una fila (⋮) o una columna (⋯), o los botones «+ Fila» y «+ Columna» del pie.

```ejemplo
| Tarea | Responsable | Horas |
|:---|:---:|---:|
| Diseño | Ana | 12 |
| Pruebas | Luis | 8 |
```

Los dos puntos de la fila de guiones alinean la columna: `:---` a la izquierda, `:---:`
al centro, `---:` a la derecha.

## Qué podés hacer sobre el dibujo

| Desde | Qué |
|---|---|
| El tirador de una fila (⋮) | Insertar fila encima o debajo, moverla arriba o abajo, eliminarla |
| El tirador de una columna (⋯) | Insertar columna a la izquierda o a la derecha, moverla, eliminarla, alinearla |
| El teclado, dentro de una celda | **Alt+Enter** abre el menú de la fila; **Alt+Shift+Enter**, el de la columna |
| «Editar como texto» | Muestra el Markdown de esa tabla hasta que el cursor sale de ella |

Cada cambio se deshace con **Ctrl+Z**. Al editar sobre el dibujo, Mycelium vuelve a
alinear las columnas del texto, para que la tabla se lea bien también en crudo.

## Dentro de una celda

Una celda puede llevar formato, enlaces y etiquetas. La barra `|` separa columnas, así
que dentro de una celda se escribe `\|`; también en el alias de un enlace:

```ejemplo
| Nota | Estado |
|---|---|
| [[Plan anual\|el plan]] | **listo** |
| `a \| b` | #pendiente |
```

> [!info] Una tabla dentro de un callout también se edita
> Mientras todas sus líneas empiecen con el mismo `>`, la tabla de un
> [callout](ayuda:escribir-notas/callouts) tiene los mismos controles.

Si preferís escribir las tablas siempre a mano, se puede apagar su dibujo en la vista en
vivo: ver [Vista en vivo y lectura](ayuda:escribir-notas/vista-en-vivo-y-lectura).
