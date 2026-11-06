---
titulo: Bases
tema: Tipos de archivo
cubre: [base]
sinonimos: [tabla, consulta, filtro, columnas, base de datos, embeber tabla, vista]
---

Una **base** es un archivo `.base` que junta notas de tu vault en una **tabla**: eliges qué
notas entran (por carpeta, etiqueta o propiedad) y qué columnas se ven. Usa el mismo formato
que las Bases de Obsidian, así que el archivo se abre en los dos programas.

## Para qué sirve

Para mirar tus notas como un conjunto: los proyectos activos con su estado, las lecturas
pendientes, las reuniones de este mes. La tabla se arma sola con las
[propiedades](ayuda:escribir-notas/propiedades) de cada nota y se actualiza cuando las
cambias.

La tabla es de solo lectura: muestra las notas, no las edita. Un clic en una fila abre la
nota, y el valor se cambia ahí.

## Cómo se usa

1. En el explorador, **Nueva base**: con el botón de la barra o con clic derecho en una
   carpeta, o con el menú **Nuevo…** (**{{atajo:crear.nuevo|Ctrl+Shift+N}}**). Nace con una vista «Todas» que muestra cada nota con su fecha de modificación.
2. En la cabecera de la tabla, **Filtros** decide qué notas entran: condiciones de
   propiedad, operador y valor, en grupos que se cumplen todas o alguna, y que se pueden
   negar. **Columnas** elige qué se muestra.
3. Clic en el encabezado de una columna para ordenar: ascendente, descendente y sin orden.
   Con **Shift+clic** suma esa columna al orden que ya había. El orden se guarda en el
   archivo (en el `sort:` de la vista, como en Obsidian) para que la tabla se abra igual la
   próxima vez; el resto del archivo no se toca.

También puedes buscar dentro de la tabla con el buscador de la cabecera (solo mira lo que se
ve, y no se guarda) y arrastrar el borde de una columna para cambiar su ancho; doble clic en
el borde vuelve al ancho automático.

## El archivo por dentro

**Fuente** muestra el YAML y deja editarlo; **Ctrl+S** guarda. Una base mínima con un
filtro, tres columnas y un orden:

```yaml
filters:
  and:
    - file.inFolder("Proyectos")
    - estado != "archivado"
views:
  - type: table
    name: Activos
    order:
      - file.name
      - estado
      - prioridad
    sort:
      - property: prioridad
        direction: DESC
```

Mycelium entiende un subconjunto del formato: filtros con `and`, `or` y `not`, los
comparadores (`==`, `!=`, `>`, `<`, `>=`, `<=`), `file.inFolder`, `file.hasTag` y
`file.hasProperty`, y las vistas de tipo tabla.

> [!warning] Si algo no se entiende, la base no adivina
> Un filtro que Mycelium no sabe evaluar no se ignora: la vista dice cuál es y ofrece
> «Ver todas las notas, sin filtrar», avisando que el filtro no se aplicó. Y si el archivo
> trae algo que los controles no saben representar (fórmulas, agrupaciones), **Filtros** y
> **Columnas** se apagan para no borrarlo al guardar: se edita desde **Fuente**.

## Mostrarla dentro de una nota

Para que una nota índice muestre la tabla que la base ya arma —en vez de una copia escrita
a mano que se queda vieja—, escribe su embed:

```md
![[Fichas.base]]
![[Fichas.base#Pendientes]]
![[Fichas#Pendientes]]
```

Después del `#` va el nombre de la vista; sin él se muestra la primera. Es una **vista
previa de solo lectura** con las columnas de la vista y sus primeras 15 filas; si hay más,
debajo dice cuántas faltan. En la vista de lectura, un clic la abre en su pestaña, donde se
filtra, se ordena y se busca; en la vista en vivo, el botón **Abrir** de la esquina. La
tabla se consulta solo cuando llega a verse.
