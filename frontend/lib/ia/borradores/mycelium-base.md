---
name: mycelium-base
description: Bases de Mycelium (archivos .base, YAML) — tablas que consultan las notas del vault por carpeta, etiquetas y propiedades. Sintaxis EXACTA que Mycelium entiende (filtros, operadores, funciones, columnas, orden, límite, vistas), recetas y los errores que dan una tabla equivocada sin avisar. Usar al crear, corregir o leer un .base, o cuando pidan «una tabla/lista de notas que…».
---
<!-- mycelium-ia v{{VERSION_IA}} -->
# Bases: tablas consultables (`.base`)

Una **base** es un archivo `.base` en YAML que define una **consulta** sobre las notas
del vault y Mycelium la muestra como **tabla**: una fila por nota, una columna por
campo. Es el formato de las Bases de Obsidian, pero Mycelium entiende **un subconjunto
cerrado**: lo que está en esta skill. Todo lo demás, o rompe la tabla, o —peor— da un
resultado equivocado sin avisar.

**Cuándo usarla**: cuando el usuario quiere ver **muchas notas juntas** según sus
metadatos (proyectos activos, tareas por vencer, lecturas por calificación, todo lo
etiquetado `#receta`) y que la lista **se mantenga sola**. Si es una lista fija de
cinco enlaces, alcanza con una nota con `[[enlaces]]`. Una base no edita notas: para
cambiar un valor se edita la nota.

## Qué filas puede tener

- **Solo notas `.md`** del vault. No entran lienzos, dibujos, PDFs ni otras bases.
- Sin lo que está en la papelera ni lo que ignora `.mycignore`.
- **Las Esporas (plantillas) SÍ entran**: son notas. Si la tabla filtra por una etiqueta
  o propiedad que la plantilla también tiene, excluila (receta abajo).
- Las propiedades salen del **frontmatter** de cada nota (subconjunto de la skill
  `mycelium-vault`). Una nota cuyo frontmatter Mycelium no entiende **no tiene
  propiedades** para la base.

## Esqueleto

```yaml
filters:
  and:
    - file.inFolder("Proyectos")
    - estado != "hecho"
properties:
  estado:
    displayName: Estado
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
    limit: 50
```

| Clave | Qué hace |
|---|---|
| `filters` (raíz) | Qué notas entran, en **todas** las vistas. Opcional |
| `properties` | Solo `clave: { displayName: … }`: el título de la columna. Nada más se lee de ahí |
| `views` | Lista de vistas; cada una es una **pestaña** de la tabla |
| `views[].type` | Solo **`table`**. Omitido = `table`. `cards`, `list`, `map`… no se dibujan |
| `views[].name` | Nombre de la pestaña. Omitido = «Vista 1», «Vista 2»… |
| `views[].filters` | Filtro propio de la vista; se combina **con `and`** con el de la raíz |
| `views[].order` | Las **columnas**, en orden. Omitido = solo el nombre |
| `views[].sort` | Orden inicial: lista de `property` + `direction` (`ASC`/`DESC`) |
| `views[].limit` | Entero positivo: cuántas filas se muestran (la app dice cuántas ocultó) |

Sin `views`, Mycelium muestra una tabla «Tabla» con solo el nombre.

## Filtros

Un filtro es un **árbol**: un combinador con una lista de expresiones o de otros
combinadores.

```yaml
filters:
  and:
    - file.hasTag("proyecto")
    - or:
        - estado == "activo"
        - estado == "pausado"
    - not:
        - file.inFolder("Archivo")
```

Se lee: etiqueta `proyecto` **y** (activo **o** pausado) **y no** en `Archivo/`.

- **`and`** (todas) / **`or`** (alguna) / **`not`** (niega), anidables. Cada mapa lleva **exactamente un** combinador:
  `and:` y `or:` como hermanos en el mismo mapa **rompen la tabla**. Para «A y (B o C)»,
  anidá el `or` dentro del `and` como arriba.
- `not` con varias expresiones niega **su conjunción**: `not: [A, B]` = «no (A y B)».
  Para «ni A ni B», `not:` con un `or:` adentro.
- `filters: file.hasTag("idea")` (una sola expresión, sin combinador) también vale.

### Expresiones: comparaciones

`referencia OPERADOR valor`, con `==`, `!=`, `>`, `<`, `>=`, `<=`.

| Caso | Cómo se compara |
|---|---|
| Valor de la nota numérico **y** literal numérico **sin comillas** | Como **número**: `prioridad > 9` es verdadero con 10 |
| Cualquier otro caso | Como **texto**, **sin distinguir mayúsculas ni tildes**: `estado == "activo"` casa con `Activo` y `diseno` con `Diseño` |
| Número entre comillas (`prioridad > "9"`) | Como texto: `"10" < "9"`. **No entrecomilles números** |
| Fechas (`vence < "2026-10-01"`) | Como texto ISO, que ordena bien si los dos lados son `AAAA-MM-DD` |
| Casillas | `hecho == true`, `hecho != true` |
| Propiedad **de lista** (`tags`, `participantes`) | Verdadero si **algún** elemento cumple; `!=` es verdadero si **ninguno** es igual |
| La nota **no tiene** la propiedad | `!=` → **verdadero**; `==`, `>`, `<`… → falso. Por eso `hecho != true` incluye las notas sin `hecho` |

El valor de la derecha es **un literal**: texto entre comillas (`"activo"`, `'activo'`),
número, `true`/`false`. **No hay `now()`, `today()`, `date()` ni aritmética**: escribí la
fecha (`vence < "2026-10-01"`) y avisale al usuario que ese corte es fijo.

### Expresiones: funciones

| Función | Verdadera si… |
|---|---|
| `file.hasTag("x")` | La nota tiene la etiqueta `x` (del frontmatter o un `#x` del cuerpo; con o sin `#`; sin distinguir mayúsculas). Varios argumentos = **alguna**: `file.hasTag("a", "b")`. **No incluye anidadas**: `hasTag("proyecto")` NO casa con `#proyecto/huerta` |
| `file.inFolder("Carpeta")` | La nota está en esa carpeta **o en una subcarpeta**. Ruta desde la raíz (`"Proyectos/Mycelium"`). **Distingue mayúsculas** |
| `file.hasProperty("clave")` | La nota tiene esa propiedad, aunque esté vacía |
| `ref.isEmpty()` | La propiedad no existe o está vacía |
| `ref.contains("x")` | El valor (o algún elemento de la lista) contiene `x`; sin distinguir mayúsculas (las tildes sí cuentan) |
| `ref.startsWith("x")` / `ref.endsWith("x")` | Ídem, al principio / al final |

`ref` es una propiedad o un campo `file.*`: `file.name.startsWith("HU-")`,
`proyecto.contains("Mycelium")`, `file.tags.contains("ide")` (parcial, a diferencia de
`hasTag`).

**Nada más existe**: ni `file.hasLink`, `file.links`, `file.backlinks`, ni `.lower()`,
`.length`, `list()`, `if()`, ni métodos encadenados. Una función desconocida **rompe
la tabla** (Mycelium muestra el error y la expresión).

### Referencias

| Referencia | Valor |
|---|---|
| `file.name` (o `file.basename`) | Título de la nota: nombre de archivo sin `.md` |
| `file.folder` | Carpeta, ruta desde la raíz (`Proyectos/Mycelium`); `""` en la raíz |
| `file.path` | Carpeta + título **sin extensión** (`Proyectos/Mycelium/Grafo 3D`) |
| `file.ext` | `md` |
| `file.size` | Tamaño en bytes (la columna lo muestra en KB) |
| `file.tags` | Etiquetas: las de `tags:` **más** los `#tag` del cuerpo (no las que están en código) |
| `file.ctime` / `file.mtime` | ⚠ **No** son las fechas del archivo: son cuándo Mycelium **indexó** la nota por primera vez y cuándo registró su último cambio (ISO UTC). Sirven para «modificadas recientemente», no para fechas que importen |
| `estado` o `note.estado` | La propiedad `estado` del frontmatter. **Sin distinguir mayúsculas** en la clave |

Una propiedad que ninguna nota tiene no da error: vale «vacía» en todas (y con `!=`,
todas pasan). Revisá que la clave exista y esté escrita igual (comandos en la sección
siguiente).

## Del pedido a la consulta

El usuario pide en lenguaje natural («todos los proyectos», «los no terminados», «por
prioridad»); la base necesita **los valores que el vault usa de verdad**. Antes de escribir
el filtro, miralos. Estos comandos recorren solo las notas que ve una base: saltean los
directorios ocultos (`.claude/`, `.mycelium/`, `.git/`: lo que `.mycignore` ignora por
defecto) y los `CLAUDE*.md`, que son instrucciones y no notas.

```sh
# Claves del frontmatter, las más usadas primero
find . -name '*.md' -not -path '*/.*' -not -name 'CLAUDE*.md' -exec awk '{sub(/\r$/,"")} FNR==1{fm=($0=="---");next} fm&&/^---$/{fm=0} fm&&/^[A-Za-z_][A-Za-z0-9_-]*:/{sub(/:.*/,"");print}' {} + | sort | uniq -c | sort -rn

# Valores de una clave (acá, estado)
find . -name '*.md' -not -path '*/.*' -not -name 'CLAUDE*.md' -exec awk -v k=estado '{sub(/\r$/,"")} FNR==1{fm=($0=="---");next} fm&&/^---$/{fm=0} fm&&index($0,k":")==1{print}' {} + | sort | uniq -c

# Etiquetas con «proyecto»: las de tags: y los #tag del cuerpo
grep -rh --include="*.md" --exclude-dir=".?*" --exclude="CLAUDE*.md" "^tags:" . | sort | uniq -c
grep -rhoE --include="*.md" --exclude-dir=".?*" --exclude="CLAUDE*.md" "#[[:alnum:]_/-]*proyecto[[:alnum:]_/-]*" . | sort | uniq -c
```

Si el `.mycignore` del vault ignora algo más que lo oculto (p. ej. `Archivo/`), sumá
`-not -path './Archivo/*'` a `find` y `--exclude-dir=Archivo` a `grep`. **No uses
`--exclude-dir=".*"`**: también excluye el `.` de partida y `grep` no encuentra nada.

Con eso, decidí así y **decile al usuario qué decidiste** en una línea («tomé como
activos los `estado: activo` y `en curso`; dejé afuera `pausado`»):

- **«Todos los X»**: por la señal que el vault usa para X — etiqueta, `tipo:` o carpeta.
  Si conviven varias (unos tienen `#proyecto`, otros están en `Proyectos/` sin
  etiqueta), combinalas con `or:` y avisá.
- **Etiquetas anidadas**: `file.hasTag("proyecto")` **no** trae `#proyecto/huerta`.
  Para «los proyectos», sumá las hijas con un `or:` de `file.hasTag("proyecto")` y
  `file.tags.startsWith("proyecto/")` (receta de índice por etiqueta): así también entran
  las subetiquetas que se creen después. Evitá `file.tags.contains("proyecto")`, que
  además casa `#proyectos` o `#anteproyecto`.
- **«No terminados», «pendientes»**: **excluí** los valores de cierre que existen
  (`estado != "hecho"`, y `!= "cancelado"` si aparece) en vez de **listar** los abiertos:
  así entran también las notas **sin** `estado` y los valores que no conocías
  (`borrador`).
- **«Activos»**: ahí sí, listá los valores que significan activo (`or:` de `==`). Si hay
  ambiguos (`en pausa`, `bloqueado`), elegí, decilo y ofrecé cambiarlo.
- **Escalas (`prioridad`, `calificacion`, `urgencia`)**: la base no sabe si el número
  alto es el más importante. Buscá la convención del vault: los valores que hay, una
  nota que lo diga (una `prioridad: 1` que se describe como «urgente»), la Espora que
  siembra la clave. Si nada lo aclara, **preguntá**; si tenés que avanzar, ordená `DESC`
  (lo alto arriba) y **decí** que lo asumiste y que se invierte con `ASC`.
- **«Las más nuevas arriba»**: ordená por la propiedad de creación del vault (`creado`,
  `fecha`, `empezado`: buscala con el primer comando). Si no hay ninguna, usá
  `file.ctime` **y avisá** que es cuándo Mycelium indexó la nota, no cuándo se escribió
  (un vault copiado o reindexado las deja todas el mismo día). Proponé agregar
  `creado: {{fecha}}` a la Espora de ese tipo (skill `mycelium-esporas`), para que las
  próximas lo traigan. Si la Espora escribe la fecha en el **cuerpo** («Creada el
  {{fecha}}») y no como propiedad, decilo: la base no la puede leer.
- **Una nota en dos categorías** (`tags: [proyecto, idea]` en una tabla de proyectos):
  entra, porque cumple el filtro. Incluila y nombrala en la respuesta («[[Grafo 3D]] también
  es una idea»). Preguntá antes solo si el pedido la excluye de forma explícita («los
  proyectos que no son ideas»): ahí va un `not:` con la otra etiqueta.
- Un valor que el usuario nombra y **no existe** («las urgentes» sin ninguna
  `urgente`): no inventes el filtro; mostrá los valores que sí hay y preguntá.

## Columnas, títulos y celdas

- `order` lista las columnas: `file.*` o claves de propiedad. También en línea:
  `order: [file.name, estado]`.
- Título de columna: el `displayName` de `properties`; si no, la clave. Los `file.*`
  tienen título propio: Nombre, Carpeta, Ruta, Tipo, Etiquetas, Creada, Modificada, Tamaño.
- Celdas: listas como píldoras, `true`/`false` como casilla, números alineados, y un
  **`[[enlace]]` en un valor es clicable** (`proyecto: "[[Mycelium]]"` en la nota da una
  columna que navega). Clic en la fila abre la nota.

## Orden y límite

```yaml
    sort:
      - property: prioridad
        direction: DESC
      - property: file.name
        direction: ASC
```

- Varios criterios: el primero manda, el siguiente desempata.
- Número contra número se ordena como número; el resto como texto sin mayúsculas.
- **Las notas sin ese valor van siempre al final**, en las dos direcciones.
- `direction` distinto de `DESC` = ascendente. Cada criterio **en bloque**, como arriba:
  la forma en línea `sort: [{property: x}]` se ignora sin aviso.
- `limit` recorta **después** de ordenar.

## Reglas de YAML de Mycelium (más estrictas que YAML)

1. **Sangría con espacios**, de a dos. Una línea mal sangrada rompe el archivo.
2. **Comentarios solo en su propia línea** (`# …`). Un comentario al final de una
   línea **se vuelve parte del valor**: `- estado == "activo"  # activos` compara contra
   `activo"  # activos` y no casa nada; `type: table # vista` deja la vista sin dibujar.
3. **Nunca `: ` (dos puntos y espacio) dentro de una expresión**, ni entre comillas:
   el parser parte la línea en clave y valor. Reescribí con `.contains()` sobre un tramo
   sin los dos puntos.
4. Sin mapas en línea (`{…}`), sin escalares multilínea (`|`, `>`), sin anclas (`&`, `*`).
5. Nada de sintaxis de JavaScript: **no hay `&&`, `||`, `!expr`, `===`**. La app no
   avisa: da 0 filas o todas. Usá `and:` / `or:` / `not:`.

## Recetas

### Notas de un proyecto, una pestaña por estado

No hay `groupBy`: se agrupa con **una vista por grupo**.

```yaml
filters:
  and:
    - proyecto.contains("Mycelium")
    - not:
        - file.inFolder("Esporas")
properties:
  prioridad:
    displayName: Prioridad
views:
  - type: table
    name: Activos
    filters:
      and:
        - estado == "activo"
    order:
      - file.name
      - prioridad
      - vence
    sort:
      - property: prioridad
        direction: DESC
  - type: table
    name: Pausados
    filters:
      and:
        - estado == "pausado"
    order:
      - file.name
      - prioridad
  - type: table
    name: Sin estado
    filters:
      and:
        - estado.isEmpty()
    order:
      - file.name
      - file.folder
  - type: table
    name: Otros
    filters:
      not:
        - or:
            - estado == "activo"
            - estado == "pausado"
            - estado.isEmpty()
    order:
      - file.name
      - estado
```

«Otros» es la negación de todas las pestañas anteriores: junta los valores que no tienen
pestaña propia (`hecho`, y los que aparezcan después, como `bloqueado`), así ninguna nota
se pierde entre pestañas. Agregala siempre que agrupes por un valor libre.

### Tareas: vencidas y por vencer

```yaml
filters:
  and:
    - tipo == "tarea"
    - hecho != true
views:
  - type: table
    name: Vencidas
    filters:
      and:
        - vence < "2026-09-30"
    order:
      - file.name
      - vence
      - proyecto
    sort:
      - property: vence
        direction: ASC
  - type: table
    name: Por vencer y sin fecha
    filters:
      not:
        - vence < "2026-09-30"
    order:
      - file.name
      - vence
      - proyecto
    sort:
      - property: vence
        direction: ASC
```

- `"2026-09-30"` es **hoy** al crear la base (fecha local, ver skill
  `mycelium-calendario`). No hay `today()`: el corte queda **fijo** y hay que
  actualizarlo a mano. Decíselo al usuario.
- **Vencidas** = `vence < hoy`. Una tarea **sin** `vence` da falso y no entra.
- **Por vencer y sin fecha** = `not: [vence < hoy]`, la negación exacta de la anterior:
  entra lo que vence hoy o después **y** lo que no tiene `vence` (regla de la propiedad
  ausente). Con `ASC`, las sin fecha quedan al final. Entre las dos vistas están
  **todas** las pendientes.
- `vence >= "2026-09-30"` parece lo mismo pero **pierde las tareas sin fecha**: usalo
  solo si el usuario no las quiere ver, y avisale.

### Índice de notas por etiqueta

```yaml
filters:
  and:
    - or:
        - file.hasTag("receta")
        - file.tags.startsWith("receta/")
    - not:
        - file.inFolder("Esporas")
views:
  - type: table
    name: Recetas
    order:
      - file.name
      - file.folder
      - file.tags
    sort:
      - property: file.name
        direction: ASC
```

El `or` suma las anidadas (`#receta/postre`, y las que se creen después). Si el vault no
las usa, alcanza con `file.hasTag("receta")`. No uses `file.tags.contains("receta")`:
también casaría `#recetario`.

### Notas sin clasificar

```yaml
filters:
  and:
    - not:
        - file.hasProperty("tipo")
    - not:
        - file.inFolder("Esporas")
views:
  - type: table
    name: Sin tipo
    order:
      - file.name
      - file.folder
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC
```

### Lo que NO se puede con una base

- **Notas sin enlaces / huérfanas / backlinks**: no hay funciones de enlaces. Usá
  `/vault-huerfanas`.
- Fórmulas, totales, agrupar, tarjetas, fechas relativas («esta semana»), contar
  caracteres. Si el usuario los pide, decí que Mycelium no los tiene en las bases y
  ofrecé la alternativa (una vista por grupo, una fecha fija, una nota índice).

## Crear, enlazar y modificar

- Creá el archivo con extensión `.base` en la carpeta que corresponda (con un **nombre
  que no repita el de una nota**: los enlaces resuelven por título). Mycelium lo ve solo.
- **Nombre**: antes de inventarlo, fijate si alguna nota ya enlaza la tabla que falta.
  Listá los enlaces que mencionan el tema y quedate con los que no resuelven (no hay
  `Título.md` ni `Título.base`):
  `grep -rhoE --include="*.md" --exclude-dir=".?*" "\[\[[^]|#]*[Pp]royecto[^]|#]*" . | sort | uniq -c`.
  Si un enlace roto describe **este** contenido (`[[Proyectos activos]]` y la tabla es de
  proyectos activos), usá ese nombre: la base lo resuelve y ya nace enlazada. Si dice otra
  cosa (`[[Proyectos]]` para una tabla solo de pausados), **no lo fuerces**: poné el
  nombre que describe la tabla y mencioná el enlace roto al usuario.
- **Enlazala** con `[[Proyectos activos]]` (o `[[Proyectos activos.base]]`): navega a la
  tabla y es un nodo del grafo. **No se embebe**: `![[….base]]` no dibuja la tabla. El
  contenido del YAML no crea aristas. Desde dónde: su índice o MOC; si no hay, la nota
  **más cercana que exista** (el mapa del proyecto, la nota madre del tema). Si no hay
  ninguna razonable, no inventes un enlace a una nota que no existe: creá la base y
  **proponé** en la respuesta el índice que la enlazaría. Nunca la dejes suelta en
  silencio.
- **Al modificar una base existente, conservá lo que no entiendas** (`formulas`,
  `summaries`, `groupBy`, claves de Obsidian): Mycelium las ignora pero el usuario
  puede usarlas en Obsidian. Con cualquiera de ellas en el archivo, los botones
  Filtros/Columnas de la app se deshabilitan y solo se edita la fuente.
- Si el usuario después edita la base con esos botones, Mycelium **regenera el YAML**:
  tus comentarios se pierden. Poné las explicaciones en la nota que enlaza la base; si
  no hay ninguna, un comentario **en su propia línea** (`# Corte fijo: actualizar la fecha`)
  es aceptable.

## Verificar antes de entregar

1. Releé cada expresión contra las tablas de arriba: ¿comparación o función soportada?
   ¿literal a la derecha? ¿números sin comillas? ¿sin `&&`, `!`, `now()`?
2. ¿Cada mapa de filtros tiene un solo combinador? ¿Sangría de espacios, sin
   comentarios al final de línea, sin `: ` en expresiones?
3. **Cada clave y cada valor existen en el vault con esa grafía** (comandos de «Del
   pedido a la consulta»), cada etiqueta de `hasTag` existe tal cual (ojo con las
   anidadas) y cada carpeta de `inFolder` existe con esas mayúsculas (`ls`).
4. **Simulá dos o tres notas a mano**: una que debe entrar y una que no. Si una nota sin
   la propiedad aparece donde no debería, te falta un `file.hasProperty(...)` o un
   `== ` en vez de `!=`.
5. ¿La plantilla de `Esporas/` se cuela? Excluí la carpeta.
6. Pedile al usuario que la abra: si Mycelium no entiende un filtro, **no muestra la
   tabla** — muestra el motivo y la expresión exacta. Arreglá eso y nada más.

## Relacionadas

- skill `mycelium-vault`: el frontmatter que alimenta las columnas.
- skill `mycelium-esporas`: plantillas que siembran las propiedades con las que se filtra.
- skill `mycelium-memoria`: enlazar la base desde su índice para que no quede suelta.
