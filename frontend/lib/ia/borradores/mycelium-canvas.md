---
name: mycelium-canvas
description: Crear, leer y modificar lienzos .canvas (JSON Canvas) que se vean bien en Mycelium — coordenadas y tamaños, flechas con fromSide/toSide coherentes, grupos que contengan a sus tarjetas, colores y tarjetas de nota. Usar cuando el usuario pida un lienzo, mapa de ideas, tablero, línea de tiempo, organigrama o mapa de notas, o al tocar un .canvas existente.
---
<!-- mycelium-ia v{{VERSION_IA}} -->
# Lienzos `.canvas` en Mycelium

Un `.canvas` es un **lienzo infinito**: tarjetas colocadas en el espacio y unidas por
flechas. El formato es **JSON Canvas 1.0**, el de Obsidian, así que el archivo se abre
igual allá. Escribirlo es fácil; que **se vea bien** no: eso depende de la geometría
—dónde cae cada tarjeta, cuánto mide, por qué lado sale cada flecha—, y esta skill es
sobre todo eso.

## Cuándo un canvas (y cuándo otra cosa)

| Querés… | Usá |
|---|---|
| Ordenar **ideas o notas en el espacio**: mapa de ideas, tablero, línea de tiempo, notas relacionadas | **`.canvas`** |
| Un diagrama **formal** con figuras y conectores que se enganchan (UML, ER, BPMN, red) | `.drawio` (skill `mycelium-drawio`) |
| Un **dibujo** a mano alzada, un boceto | `.excalidraw` (skill `mycelium-excalidraw`) |
| Un diagrama chico **dentro de una nota** | bloque ` ```mermaid ` en la nota |
| Solo texto con enlaces | una **nota** `.md`: siempre es la opción más recuperable |

La ventaja propia del canvas es que una tarjeta puede **ser una nota real** (nodo
`file`): el lienzo muestra la nota viva, no una copia.

## Qué dibuja Mycelium (y qué no)

Mycelium no dibuja todo el estándar. Lo que no dibuja **se conserva** al guardar, pero
el usuario no lo ve.

| Elemento | En Mycelium |
|---|---|
| Nodo `text` | Tarjeta con el markdown renderizado (enlaces `[[…]]` clicables, negrita, listas, títulos chicos). Cabecera que dice «Texto» |
| Nodo `file` a una **nota `.md`** | Tarjeta con la nota **entera** renderizada (se desplaza si no entra). Cabecera con el título y botón «Abrir» |
| Nodo `file` a una imagen, un PDF o cualquier archivo que no sea nota | **No se dibuja**: la tarjeta dice «La nota … ya no existe» |
| Nodo `file` a un `.canvas`/`.base`/`.excalidraw`/`.drawio` | Muestra su JSON/YAML/XML **crudo**. No lo hagas |
| `subpath` (`"#Sección"`) de un `file` | Se ignora: se ve la nota entera |
| Nodo `link` | Solo la URL como enlace, con cabecera «Texto». Mejor: una tarjeta `text` con `[título](url)` |
| Nodo `group` | Marco punteado con fondo translúcido y cabecera con su `label` («Grupo» si no tiene) |
| `background` / `backgroundStyle` de un grupo | No se dibuja |
| `color` de un nodo (`"1"`…`"6"` o `"#RRGGBB"`) | Tiñe el **borde y la cabecera**; el cuerpo queda neutro |
| Flecha (`edges`) | Curva bezier gris con punta en el destino |
| `toEnd: "none"` / `fromEnd: "arrow"` | Sin punta / punta también en el origen |
| `fromSide` / `toSide` | Respetados. Sin ellos, Mycelium los elige (ver «Anclas») |
| `label` de una flecha | **No se dibuja** |
| `color` de una flecha | **No se dibuja**: todas son grises |
| Claves desconocidas de nodos y flechas | Se conservan al guardar |
| Claves de la **raíz** que no sean `nodes`/`edges` | **Se pierden** en cuanto el usuario mueve algo |
| `type` que no sea text/file/link/group | Se convierte en `text` al guardar |
| Flecha a un nodo que no existe | No se dibuja y **se borra** al próximo guardado |

> [!warning] Tres cosas que sorprenden
> 1. **La vista abre en `(0, 0)`**, con ese punto en la esquina superior izquierda
>    de la pantalla y zoom 100 %. No hay «ajustar al contenido»: lo que esté en
>    coordenadas negativas queda fuera de pantalla hasta que el usuario arrastre.
>    **Empezá el contenido en `(40, 40)`** y crecé hacia la derecha y hacia abajo.
> 2. **Las flechas se dibujan debajo de todas las tarjetas.** Una flecha que pasa
>    por detrás de otra tarjeta desaparece bajo ella: no la verías cortada, la verías
>    interrumpida.
> 3. **Toda tarjeta tiene cabecera** (~22 px), incluso las de texto y los grupos. El
>    alto que das incluye esa cabecera.

## Esqueleto mínimo

```json
{
  "nodes": [
    { "id": "idea", "type": "text", "text": "**Idea central**", "x": 40, "y": 40, "width": 260, "height": 110 },
    { "id": "plan", "type": "file", "file": "Proyectos/Plan.md", "x": 420, "y": 40, "width": 360, "height": 240 }
  ],
  "edges": [
    { "id": "e1", "fromNode": "idea", "fromSide": "right", "toNode": "plan", "toSide": "left" }
  ]
}
```

## Reglas de oro

1. **JSON válido**: sin comas finales ni comentarios. Guardalo con
   `JSON.stringify(canvas, null, 2)` + salto de línea final (así lo escribe Mycelium).
2. **Ids únicos** entre nodos y flechas juntos. Usá ids legibles (`idea-1`, `e-3`).
3. `x`, `y`, `width`, `height` **enteros**, en todos los nodos.
4. Toda flecha apunta a **nodos que existen**, y nunca de un nodo a sí mismo.
5. Un nodo `file` lleva la **ruta relativa a la raíz del vault**, con `/`, con
   extensión y con **las mayúsculas exactas** (`Proyectos/Plan.md`, no
   `proyectos/plan.md` ni `Plan`). Comprobá que exista antes de escribirla. Solo
   notas `.md`.
6. **Ninguna tarjeta encima de otra.** Lo único que puede contener a otro nodo es un
   grupo, y lo contiene **por completo**.
7. **Los grupos van primero** en `nodes`: el orden del array es el orden de dibujo, y
   un grupo listado después de sus tarjetas se dibuja encima y las tapa.
8. **Conservá lo que no entendés**: al modificar un canvas ajeno, editá el objeto
   parseado y reescribilo; nunca lo regeneres desde cero.
9. `fromSide`/`toSide` **explícitos y coherentes** con la posición (ver «Anclas»).
10. **Verificá con el validador** antes de dar el trabajo por hecho.

## Geometría

### Coordenadas

- `x`, `y` son la **esquina superior izquierda** del nodo; `y` crece **hacia abajo**.
  Se admiten negativos, pero en Mycelium quedan fuera de la vista inicial.
- La pantalla típica muestra unos **1200 × 700** a zoom 100 %. Si el lienzo es más
  grande está bien, pero lo importante (el título, el centro del mapa) va arriba a la
  izquierda.

### Tamaños

| Tarjeta | Ancho × alto |
|---|---|
| Rótulo de una línea (≤ 25 caracteres) | 260 × 110 |
| Título + una frase | 240 × 160 |
| Párrafo corto (~150 caracteres) | 320 × 200 |
| Nota (`file`) como vista previa | 320 × 220 a 400 × 280 |
| Título general del lienzo | tan ancho como el contenido, 150 de alto |
| Mínimo que permite la app | 120 × 60 (no lo uses para texto) |

**El alto de una tarjeta de texto se calcula**, no se adivina:

```
caracteres por renglón  cpr = floor((ancho − 56) / 7)
alto = 80
     + 24 × ceil(caracteres / cpr)          por cada párrafo
     + 24 × ceil(caracteres / (cpr − 4))    por cada ítem de lista
     + 36 × ceil(1.2 × caracteres / cpr)    por cada título (#)
     + 8                                    por cada línea en blanco
redondeado hacia arriba a múltiplo de 10
```

> [!important] Un salto de línea simple NO corta el renglón
> Mycelium renderiza sin «breaks»: `"**1810**\nRevolución"` se ve como **un** renglón,
> «**1810** Revolución». Para separar, dejá una **línea en blanco**:
> `"**1810**\n\nRevolución de Mayo"`. Los ítems de lista (`- …`) y los títulos sí van
> en líneas simples.

Los títulos `#` dentro de una tarjeta se ven chicos (apenas más grandes que el texto):
sirven para encabezar, no para gritar. Mantené las tarjetas **cortas**: si el texto
pide más de ~8 renglones, es una nota, y en el lienzo va como nodo `file`.

### Separaciones

| Entre | Mínimo | Cómodo |
|---|---|---|
| Tarjetas sin flecha entre ellas | 24 | 40 |
| Tarjetas unidas por una flecha | 60 | 80–140 |
| Borde del grupo y sus tarjetas | 20 a los lados y abajo, **44 arriba** (ahí va la etiqueta) | igual |
| Grupo y grupo vecino | 40 | 60 |

### Anclas: por dónde sale y entra una flecha

Cada lado tiene **un solo** punto de enganche, en su centro:

| Lado | Punto |
|---|---|
| `top` | `(x + width/2, y)` |
| `bottom` | `(x + width/2, y + height)` |
| `left` | `(x, y + height/2)` |
| `right` | `(x + width, y + height/2)` |

**Cómo elegir los lados** (es la misma regla que usa Mycelium cuando no los das):

```
dx = centroX(destino) − centroX(origen)
dy = centroY(destino) − centroY(origen)
si |dx| ≥ |dy|:  dx ≥ 0 → right → left      dx < 0 → left → right
si no:           dy ≥ 0 → bottom → top      dy < 0 → top → bottom
```

Escribilos **siempre explícitos**: Obsidian puede elegir distinto, y en un árbol
conviene forzar `bottom → top` en todas las flechas para que se vea parejo aunque un
hijo quede muy al costado.

> [!warning] Nunca un lado que le da la espalda al destino
> Si la flecha sale por `right` y el destino está a la izquierda, la curva sale hacia
> la derecha, da la vuelta y pasa por detrás de la propia tarjeta. Lo mismo al entrar.

La flecha es una **bezier** cuyos tiradores salen perpendiculares a cada lado, con
largo `min(120, max(40, distancia/2))`. Consecuencias:

- Entre tarjetas a menos de ~40 px la punta casi no se ve: dejá 60 o más.
- Para que una flecha no cruce otra tarjeta, **conectá solo vecinos**: nivel con nivel
  siguiente, columna con columna contigua. Si una flecha tiene que saltar por encima de
  una tarjeta intermedia, mové la tarjeta o hacé que la flecha salga por otro lado
  (`top`/`bottom`) para rodearla.
- Varias flechas que salen del mismo lado **comparten el punto**: se abren en abanico,
  lo cual está bien. Si son más de 4 por lado, repartilas en dos lados.

### Grupos

- Un grupo es un rectángulo: **calculalo a partir de sus tarjetas**, nunca al revés.
  `x = minX − 20`, `y = minY − 44`, `width = maxDerecha − minX + 40`,
  `height = maxAbajo − minY + 64`.
- Todo nodo que toca un grupo está **entero** adentro. Grupos anidados: igual, el de
  adentro entero dentro del de afuera, y el de afuera antes en `nodes`.
- Una flecha puede ir **a un grupo** (a su borde); sirve para «esto aplica a toda la
  etapa».

### Colores

| Preset | Color | Uso sugerido |
|---|---|---|
| `"1"` | rojo | bloqueado, riesgo |
| `"2"` | naranja | pendiente, atención |
| `"3"` | amarillo | en curso |
| `"4"` | verde | hecho, decisión tomada |
| `"5"` | cian | información, referencia |
| `"6"` | morado | el centro, lo principal |

Preferí los presets al hex: se ven igual en Obsidian. Usá **pocos** colores y con
significado; sin color, la tarjeta toma los colores del tema.

## Procedimiento para armar un lienzo

1. **Contenido primero**: listá las tarjetas con su texto final y las relaciones
   (quién apunta a quién). Decidí qué es nota existente (`file`) y qué es texto.
2. **Medí**: calculá el alto de cada tarjeta con la fórmula. En una misma fila o nivel,
   igualá los altos al mayor: se lee como estructura.
3. **Elegí la disposición** según la forma de las relaciones: centro con ramas →
   radial; jerarquía → árbol; estados o categorías → columnas con grupos; secuencia →
   línea de tiempo; nota con sus vecinas → dos alas.
4. **Calculá las posiciones** con la receta (en coordenadas relativas, sin miedo a
   negativos) y **después trasladá todo** para que el mínimo quede en `(40, 40)`.
5. **Grupos** a partir de las tarjetas ya ubicadas; ponelos al principio de `nodes`.
6. **Flechas** con los lados de la regla.
7. **Validá** y corregí hasta que no haya errores ni avisos.

Para más de 5 tarjetas no calcules a mano: escribí un script de Node **fuera del
vault** (en el directorio temporal del sistema, o borralo al terminar), que genere el
JSON con esta caja de herramientas:

```js
const alto = (texto, ancho) => {
  const cpr = Math.floor((ancho - 56) / 7);
  let px = 80;
  for (const l of texto.split("\n")) {
    if (l.trim() === "") { px += 8; continue; }
    const t = /^#{1,6}\s+(.*)$/.exec(l);
    if (t) { px += 36 * Math.max(1, Math.ceil((t[1].length * 1.2) / cpr)); continue; }
    const li = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(l);
    px += 24 * Math.max(1, Math.ceil((li ? li[2] : l).length / (li ? cpr - 4 : cpr)));
  }
  return Math.ceil(px / 10) * 10;
};
const texto = (id, ancho, t, extra = {}) =>
  ({ id, type: "text", text: t, x: 0, y: 0, width: ancho, height: alto(t, ancho), ...extra });
const centro = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
const lados = (a, b) => {
  const dx = centro(b).x - centro(a).x, dy = centro(b).y - centro(a).y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
};
const flecha = (id, a, b) => {
  const [fromSide, toSide] = lados(a, b);
  return { id, fromNode: a.id, fromSide, toNode: b.id, toSide };
};
const alOrigen = (nodos) => {   // llamalo ANTES de crear las flechas
  const mx = Math.min(...nodos.map((n) => n.x)), my = Math.min(...nodos.map((n) => n.y));
  for (const n of nodos) { n.x = Math.round(n.x - mx + 40); n.y = Math.round(n.y - my + 40); }
};
// …ubicar, alOrigen(todos), crear flechas, y:
// fs.writeFileSync("Ruta/En el vault.canvas", JSON.stringify({ nodes, edges }, null, 2) + "\n");
```

## Recetas

### 1. Mapa de ideas radial alrededor de una nota

Centro: la nota (`file`, 360 × 240, color `"6"` o `"5"`). Ramas: tarjetas de texto del
**mismo tamaño** (`W × H`, H = el mayor de los altos), repartidas en una **elipse**
—más ancha que alta, porque las tarjetas lo son—:

```
rx = anchoCentro/2 + W/2 + 140        ry = altoCentro/2 + H/2 + 90
ángulo_i = −90° + i · 360°/n          (i = 0 arriba, en sentido horario)
x_i = cx + rx·cos(ángulo_i) − W/2     y_i = cy + ry·sin(ángulo_i) − H/2
```

Con más de 8 ramas multiplicá `rx` y `ry` por `n/8`, o pasá a dos alas (receta 5).
Flechas del centro a cada rama con la regla de lados: las de arriba y abajo salen por
`top`/`bottom`, las de los costados por `left`/`right`. Para un segundo nivel, poné
los hijos de cada rama **más afuera en la misma dirección** (otro anillo, `rx` y `ry`
+ `W + 80`) y conectalos a su rama, no al centro.

### 2. Árbol o flujo de arriba hacia abajo (organigrama, decisión, desglose)

- Todas las tarjetas del mismo ancho `W` (200–240) y, por nivel, del mismo alto.
- **Hojas** de izquierda a derecha: `x = i · (W + 40)`, en el orden del recorrido.
- **Cada padre centrado** sobre sus hijos: `x = (x_primer_hijo + x_último_hijo) / 2`.
- `y = nivel · (H + 90)`.
- Flechas **todas** `fromSide: "bottom"` → `toSide: "top"`.
- Si el árbol queda más ancho que ~1600, pasalo a **izquierda → derecha**: niveles en
  columnas (`x = nivel · (W + 120)`), hojas apiladas en `y`, flechas `right → left`.

Para un flujo con decisiones: como Mycelium no dibuja la `label` de la flecha, poné la
condición **al principio de la tarjeta destino** (`**Sí →** Aprobar el pedido`). Una
flecha que vuelve atrás (un ciclo) sale por un costado (`right` → `right` de una tarjeta
de más arriba) para no cruzar el flujo principal.

### 3. Tablero por columnas con grupos (kanban, categorías)

Constantes: tarjeta `W = 260`, relleno `20`, cabecera del grupo `44`, separación
entre tarjetas `20`, entre columnas `60`.

```
grupo_i.x = 40 + i · (W + 40 + 60)          grupo.width = W + 40
tarjeta.x = grupo.x + 20
primera tarjeta.y = grupo.y + 44;  cada siguiente: y_anterior + alto_anterior + 20
grupo.height = (abajo de la última tarjeta) − grupo.y + 20  → igualalo al de la columna más alta
```

Un título general (`# …`, tan ancho como el tablero) arriba, 40 px por encima de los
grupos. Grupos con color por estado (`"1"` por hacer, `"3"` en curso, `"4"` hecho) y
`label` con el nombre de la columna. En `nodes`: **primero los grupos**, después el
título y las tarjetas. Un tablero no suele llevar flechas.

### 4. Línea de tiempo

Hitos del mismo tamaño (220 × H), en **serpentina** de a 4 por fila, para que no se
salga de la pantalla:

```
fila = floor(i / 4);  col = i % 4;  si la fila es impar: col = 3 − col
x = col · (220 + 80);  y = altoTítulo + 60 + fila · (H + 100)
```

Cada hito lleva la fecha en negrita, línea en blanco y el suceso
(`"**1816**\n\nDeclaración de la Independencia"`). Flechas de cada hito al siguiente con
la regla de lados: en las filas pares salen `right → left`, en las impares
`left → right`, y el cambio de fila `bottom → top`. Con pocos hitos (≤ 5), una sola fila.

### 5. Mapa de notas relacionadas (nodos `file`, en dos alas)

Centro: la nota principal (`file`, 400 × 280). A la izquierda, en columna, las notas
de las que **depende**; a la derecha, las que la **usan** o la documentan (`file`,
320 × 220, separadas 40 en vertical, la columna centrada en `y` respecto del centro, y a
120 del centro en horizontal). Flechas del centro a cada una (`left → right` hacia la
izquierda, `right → left` hacia la derecha). Debajo del centro, una tarjeta de texto que
explique qué significa cada ala.

Antes de escribir cada `file`, comprobá la ruta: `ls "Carpeta/Nota.md"`. Para
encontrar candidatas: los `[[enlaces]]` salientes de la nota y sus backlinks
(`grep -rl "\[\[Título" --include="*.md" .`).

## Modificar un canvas existente

1. **Leé el archivo entero** y parsealo. Si no es JSON válido, no lo toques: avisá.
2. Editá **el objeto parseado** (agregar a `nodes`/`edges`, cambiar campos) y
   reescribilo con `JSON.stringify(c, null, 2) + "\n"`. Así sobreviven las claves que
   no conocés. No reescribas el JSON a mano entero.
3. **Buscá espacio libre** para lo nuevo: poné la tarjeta donde corresponde (a la
   derecha de la que la origina, a 80 px) y, mientras choque con alguna tarjeta
   —rectángulos agrandados 24 px—, bajala `alto + 24`. Si cae dentro de un grupo,
   **agrandá el grupo** para que la contenga con su margen.
4. **Mover una rama**: mové el nodo y todos sus descendientes con el mismo `dx, dy`.
   **Mover un grupo**: mové también todo lo que contiene (Mycelium no lo hace solo).
5. **Borrar un nodo**: borrá también todas las flechas que lo tocan.
6. Un grupo nuevo alrededor de tarjetas existentes va **antes** de ellas en `nodes`
   (`nodes.unshift(grupo)`).
7. Ids nuevos que no choquen con ninguno existente (Mycelium genera ids aleatorios de
   16 caracteres: no los reuses).
8. Recalculá los lados de las flechas que tocan lo que moviste.

Si el usuario tiene el lienzo abierto y lo está editando, lo que guarda la app puede
pisar lo tuyo (y al revés). Antes de reescribir un canvas que está usando, avisale.

## Verificar

```sh
node .claude/skills/mycelium-canvas/validar-canvas.mjs --vault . "Ruta/Al lienzo.canvas"
```

Sale con código ≠ 0 si hay **errores** (JSON inválido, ids repetidos, flechas a nodos
que no existen, tarjetas encimadas, grupos que contienen a medias o tapan lo suyo,
texto que no entra, notas `file` que no existen o no son notas). Los **avisos** también
se corrigen: lado que da la espalda al destino, flecha que pasa por debajo de otra
tarjeta, flecha demasiado corta, tarjetas pegadas, contenido en negativo, `label` o
`color` de flecha que no se van a ver. Con `--estricto`, los avisos también fallan.

Sin el validador, revisá a mano: para cada par de tarjetas, que sus rectángulos no se
toquen; para cada flecha, que el lado de salida mire al destino; para cada grupo, que
contenga enteras a sus tarjetas y esté antes en `nodes`; para cada `file`, que la ruta
exista.

## Qué aporta un canvas al grafo del vault

El `.canvas` es un **nodo** del grafo. De él salen aristas hacia:

- cada `[[enlace]]` escrito en una tarjeta de texto, y
- cada nota de un nodo `file`.

Las **flechas no** crean aristas: son disposición visual. Si una relación entre dos
notas tiene que quedar en la memoria, escribila como `[[enlace]]` en una de las notas;
una flecha del lienzo no la registra.
