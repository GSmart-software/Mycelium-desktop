---
name: mycelium-canvas
description: Crear, leer y modificar lienzos .canvas (JSON Canvas) que se vean bien en Mycelium — coordenadas y tamaños, flechas con fromSide/toSide coherentes, grupos que contengan a sus tarjetas, colores y tarjetas de nota. Usar cuando el usuario pida un lienzo, mapa de ideas, tablero, línea de tiempo, organigrama, flujo o mapa de notas, o al tocar un .canvas existente.
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
| `fromSide` / `toSide` | Respetados. Sin ellos, Mycelium los elige por centros (ver «Anclas») |
| `label` de una flecha | **No se dibuja** |
| `color` de una flecha | **No se dibuja**: todas son grises |
| Claves desconocidas de nodos y flechas | Se conservan al guardar |
| Claves de la **raíz** que no sean `nodes`/`edges` | **Se pierden** en cuanto el usuario mueve algo |
| `type` que no sea text/file/link/group | Se convierte en `text` al guardar |
| Flecha a un nodo que no existe | No se dibuja y **se borra** al próximo guardado |

> [!warning] Dos cosas que sorprenden
> 1. **Las flechas se dibujan debajo de todas las tarjetas.** Una flecha que pasa
>    por detrás de otra tarjeta desaparece bajo ella: no la verías cortada, la verías
>    interrumpida.
> 2. **Toda tarjeta tiene cabecera** (~22 px), incluso las de texto y los grupos. El
>    alto que das incluye esa cabecera.

## Esqueleto mínimo

```json
{
  "nodes": [
    { "id": "idea", "type": "text", "text": "**Idea central**", "x": 0, "y": 0, "width": 260, "height": 110 },
    { "id": "plan", "type": "file", "file": "Proyectos/Plan.md", "x": 380, "y": 0, "width": 360, "height": 240 }
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
- Mycelium abre el lienzo **encuadrado en su contenido**: el origen no importa para
  verlo, y los negativos están permitidos. Por prolijidad, poné lo primero (el título,
  el centro del mapa) cerca de `(0, 0)` y crecé hacia la derecha y hacia abajo.
- **Compacto se lee mejor**: el encuadre achica el zoom para que entre todo, y un
  lienzo de más de ~2400 × 1400 abre con el texto chico. Si da para más, partilo.

### Tamaños

| Tarjeta | Ancho × alto |
|---|---|
| Rótulo de una línea (≤ 25 caracteres) | 260 × 110 |
| Título + una frase | 240 × 160 |
| Párrafo corto (~150 caracteres) | 320 × 200 |
| Nota (`file`) como vista previa | 320 × 220 a 400 × 280 |
| Título general del lienzo (`# …`) | tan ancho como el contenido; **120** de alto solo, **150** con una línea de bajada (sale de la fórmula) |
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

Los caracteres se cuentan **tal como están escritos**: `**`, `[[` y `]]` incluidos.
Sobreestima un poco a propósito (el validador sí los descuenta, así que nunca te va a
marcar de más por eso).

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

La flecha es una **bezier** cuyos tiradores salen perpendiculares a cada lado, con
largo `min(120, max(40, distancia/2))`.

**La condición** (es lo que mide el validador): el lado de salida tiene que **mirar
hacia el enganche de llegada**, y el de llegada hacia el de salida. Por ejemplo,
`right` exige que el otro enganche no quede a la izquierda de este; `top`, que no
quede más abajo. Si no, la curva sale para el otro lado, da la vuelta y pasa por
detrás de la propia tarjeta.

**Cómo elegirlos** (la regla que cumple siempre la condición): mirá el **hueco** entre
los rectángulos, no la distancia entre centros.

```
hx = hueco horizontal = max(b.x − (a.x + a.width), a.x − (b.x + b.width))
hy = hueco vertical   = max(b.y − (a.y + a.height), a.y − (b.y + b.height))
si hx ≥ hy:  b a la derecha → right → left      b a la izquierda → left → right
si no:       b abajo        → bottom → top      b arriba         → top → bottom
```

> [!warning] Sin `fromSide`/`toSide`, Mycelium elige por centros, y en diagonal falla
> Compara `|dx|` con `|dy|` entre centros. Con dos tarjetas en diagonal que se solapan
> en `x` (centros a −178, −178) elige `left → right`, y el `left` queda de espaldas
> al enganche de llegada. Por eso: **lados siempre explícitos**, con la regla del hueco.

Dentro de la condición podés elegir otros lados cuando la receta lo pide:

- **Dirección fija**: en un árbol o un flujo, `bottom → top` en todas las flechas
  aunque un hijo quede muy al costado: mientras haya hueco vertical, cumple.
- **Lazo por el mismo lado** (`right → right`): vale cuando los dos bordes derechos
  están **alineados** (misma columna, mismo ancho). La curva sale hacia afuera ~90 px
  y vuelve: nada en esa franja.
- **Codo** (`top → right`, `top → left`, `bottom → right`…): sale por un lado y entra
  por uno perpendicular. `top → right` vale cuando el destino está **más arriba y a
  la izquierda**: la flecha sube y entra al destino por su derecha. Los demás, igual
  girados.

Consecuencias de la bezier:

- Entre tarjetas a menos de ~40 px la punta casi no se ve: dejá 60 o más.
- Para que una flecha no cruce otra tarjeta, **conectá solo vecinos**: nivel con nivel
  siguiente, columna con columna contigua. Si una flecha tiene que saltar por encima de
  una tarjeta intermedia, mové la tarjeta o usá un lazo o un codo para rodearla.
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

| Preset | Color | Significado (uno solo en todo el lienzo) |
|---|---|---|
| `"1"` | rojo | bloqueado, riesgo, error |
| `"2"` | naranja | pendiente, por hacer, **decisión** de un flujo |
| `"3"` | amarillo | en curso |
| `"4"` | verde | hecho, decisión tomada, final feliz de un flujo |
| `"5"` | cian | información, referencia |
| `"6"` | morado | el centro, lo principal, la raíz |

Preferí los presets al hex: se ven igual en Obsidian. Usá **pocos** colores y con
significado; sin color, la tarjeta toma los colores del tema.

## Procedimiento para armar un lienzo

1. **Contenido primero**: listá las tarjetas con su texto final y las relaciones
   (quién apunta a quién). Decidí qué es nota existente (`file`) y qué es texto.
2. **Medí**: calculá el alto de cada tarjeta con la fórmula. En una misma fila o nivel,
   igualá los altos al mayor: se lee como estructura.
3. **Elegí la disposición** según la forma de las relaciones: centro con ramas →
   radial; jerarquía → árbol; pasos con decisiones → flujo; estados o categorías →
   columnas con grupos; secuencia → línea de tiempo; nota con sus vecinas → dos alas.
4. **Calculá las posiciones** con la receta, con el primer elemento en `(0, 0)`, y
   **redondeá** `x` e `y` a enteros.
5. **Grupos** a partir de las tarjetas ya ubicadas; ponelos al principio de `nodes`.
6. **Flechas** con la regla del hueco (o los lados fijos de la receta).
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
const igualarAlto = (ns) => { const h = Math.max(...ns.map((n) => n.height)); ns.forEach((n) => (n.height = h)); };
const lados = (a, b) => {   // la regla del hueco
  const hx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const hy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  const c = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  if (hx >= hy) return c(b).x >= c(a).x ? ["right", "left"] : ["left", "right"];
  return c(b).y >= c(a).y ? ["bottom", "top"] : ["top", "bottom"];
};
// Creá las flechas DESPUÉS de ubicar las tarjetas; `fijos` = ["top", "right"] para forzar.
const flecha = (id, a, b, [fromSide, toSide] = lados(a, b)) =>
  ({ id, fromNode: a.id, fromSide, toNode: b.id, toSide });
// fs.writeFileSync("Ruta/En el vault.canvas", JSON.stringify({ nodes, edges }, null, 2) + "\n");
```

## Recetas

### 1. Mapa de ideas radial alrededor de una nota

Centro: la nota (`file`, 360 × 240, color `"6"`). Ramas: tarjetas de texto del **mismo
tamaño** `W × H` (H = el mayor de los altos, contando también los hijos), repartidas en
una **elipse**. Los radios salen de dos condiciones: que cada rama quede a 80 del
centro **también en diagonal** (por eso el `1.4`), y que las ramas vecinas no se
toquen (el término con el ángulo):

```js
const cx = 180, cy = 120;                 // centro de la nota (x, y = 0, 0)
const paso1 = 2 * Math.PI / n;            // n ramas
const rx = Math.max(1.4 * ((360 + W) / 2 + 80), 1.5 * (W + 40) / paso1);
const ry = Math.max(1.4 * ((240 + H) / 2 + 80), 1.5 * (H + 40) / paso1);
const ang = (i) => -Math.PI / 2 + i * paso1;          // i = 0 arriba, sentido horario
// rama i: x = cx + rx·cos(ang(i)) − W/2,   y = cy + ry·sin(ang(i)) − H/2
```

**Segundo nivel** (hijos de una rama): otro anillo, más afuera **en los dos ejes**
(`W` suma en `x`, `H` en `y`), con los hijos de cada rama repartidos **dentro de su
porción** y centrados en el ángulo de la rama:

```js
const kmax = /* la mayor cantidad de hijos que tiene una rama */;
const paso2 = paso1 / kmax;               // el mismo para todas las ramas
const rx2 = Math.max(rx + 1.4 * (W + 80), 1.5 * (W + 40) / paso2);
const ry2 = Math.max(ry + 1.4 * (H + 80), 1.5 * (H + 40) / paso2);
// hijo j de la rama i (k hijos): a = ang(i) + (j − (k − 1) / 2) · paso2
// x = cx + rx2·cos(a) − W/2,   y = cy + ry2·sin(a) − H/2
```

Flechas del centro a cada rama y de cada rama a **sus** hijos (nunca del centro a un
hijo), todas con la regla del hueco. Con muchas ramas o muchos hijos el mapa crece
rápido: si pasa de ~2400 de ancho, pasá a dos alas (receta 6) o a un árbol.

### 2. Árbol (organigrama, desglose)

- Todas las tarjetas del mismo ancho `W` (200–240) y, por nivel, del mismo alto `H`.
- **Hojas** en el orden del recorrido, separadas **40** entre hermanas y **80** entre
  hojas de padres distintos (así se ve dónde termina cada equipo).
- **Cada padre centrado** sobre sus hijos: `x = (x_primer_hijo + x_último_hijo) / 2`.
- `y = nivel · (H + 90)`.
- Flechas **todas** `fromSide: "bottom"` → `toSide: "top"`.

**Girado, de izquierda a derecha** (si de arriba abajo queda más ancho que ~1600, o
con muchas hojas): niveles en columnas, `x = nivel · (W + 120)`; hojas apiladas en `y`,
con **40** entre hermanas y **80** entre equipos; cada padre centrado en `y` sobre sus
hijos, `y = (y_primer_hijo + y_último_hijo) / 2`; flechas todas `right → left`.

### 3. Flujo con decisiones (y vueltas atrás)

Como Mycelium no dibuja la `label` de la flecha, la condición va **al principio de la
tarjeta destino**: `**Sí →** Confirmar la compra`.

- **Columna principal** en `x = 0`: el camino feliz, de arriba abajo, con
  `y = fila · (H + 90)` y flechas `bottom → top`.
- **Decisión**: tarjeta `**¿Pago aprobado?**` con color `"2"`. La salida que sigue el
  camino principal va **abajo** (`bottom → top`); la otra va a una **tarjeta lateral**
  a la derecha, en la **misma fila**: `x = W + 120`, mismo `y`, flecha `right → left`.
- **Igualá el alto por fila, lateral incluida**: decisión y lateral miden lo mismo, y
  la flecha entre ellas sale recta.
- **Vuelta atrás** (un ciclo) desde la lateral: un **codo** `top → right` a la tarjeta
  de la columna principal a la que vuelve. Sube desde la lateral y entra por la
  derecha del destino, sin pisar la columna.
- **Vuelta atrás desde la columna principal**: lazo `right → right` (misma columna,
  bordes alineados). Si hay laterales, dejalas a 120 o más: el lazo ocupa ~90 px.
- Si entre una lateral y el destino de su vuelta hay **otra lateral** del mismo lado,
  el codo la cruzaría: pasá una de las dos a la izquierda (`x = −(W + 120)`, flechas
  `left → right` y el codo `top → left`).
- Final: el último paso del camino feliz con color `"4"`; un final alternativo (la
  lateral que no vuelve) sin color, o `"1"` si es un error.

### 4. Tablero por columnas con grupos (kanban, categorías)

Constantes: tarjeta `W = 260`, relleno `20`, cabecera del grupo `44`, separación
entre tarjetas `20`, entre columnas `60`.

```
grupo_i.x = i · (W + 40 + 60)              grupo.width = W + 40
tarjeta.x = grupo.x + 20
primera tarjeta.y = grupo.y + 44;  cada siguiente: y_anterior + alto_anterior + 20
grupo.height = (abajo de la última tarjeta) − grupo.y + 20  → igualalo al de la columna más alta
```

Un título general (`# …`, tan ancho como el tablero) arriba, 40 px por encima de los
grupos. Grupos con color por estado (`"2"` por hacer, `"3"` en curso, `"4"` hecho; `"1"`
solo para una columna de bloqueados) y `label` con el nombre de la columna. En
`nodes`: **primero los grupos**, después el título y las tarjetas. Un tablero no
suele llevar flechas.

### 5. Línea de tiempo

Hitos del mismo tamaño (220 × H), en **serpentina** de a 4 por fila, para que no se
estire de más:

```
fila = floor(i / 4);  col = i % 4;  si la fila es impar: col = 3 − col
x = col · (220 + 80);  y = altoTítulo + 60 + fila · (H + 100)
```

Cada hito lleva la fecha en negrita, línea en blanco y el suceso
(`"**1816**\n\nDeclaración de la Independencia"`). Flechas de cada hito al siguiente con
la regla del hueco: en las filas pares salen `right → left`, en las impares
`left → right`, y el cambio de fila `bottom → top`. Con pocos hitos (≤ 5), una sola fila.

### 6. Mapa de notas relacionadas (nodos `file`, en dos alas)

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
   16 caracteres: no los reuses). **Nunca renombres un id existente**.
8. Recalculá los lados de las flechas que tocan lo que moviste, y validá.

### Insertar un paso en medio de una cadena

Caso: una columna `paso-1 → … → paso-6` y hay que meter uno nuevo entre el 4 y el 5.

1. La tarjeta nueva va **donde estaba `paso-5`** (mismo `x`, mismo `y`, mismo ancho;
   alto: el mayor entre el suyo y el de la columna).
2. **Corré hacia abajo** todo lo que está a la altura de `paso-5` o más abajo, en todo
   el lienzo (laterales incluidas): `y += alto_nuevo + 90`. **Guardá el corte antes de
   mover** (`const corte = paso5.y`): si comparás contra `paso5.y` dentro del bucle, ya
   cambió y el resto no se mueve.
3. Un grupo que contenía a la cadena: agrandale el `height` en lo mismo. Uno que
   estaba entero debajo del corte se corre con su contenido.
4. **Redirigí la flecha vieja, no la borres**: la `e-4-5` pasa a apuntar a la nueva
   (`toNode = "paso-4b"`, lados recalculados). Conserva sus claves y su id aunque el
   nombre ya no describa el tramo: un id es un identificador, no un rótulo.
5. **Agregá la flecha** de la nueva al viejo `paso-5`, con un id nuevo que no choque
   (`e-4b-5`). La nueva se llama `paso-4b`, no `paso-5`: renumerar ids obligaría a
   reescribir todas las flechas que los nombran.
6. **Numeración visible**: si las tarjetas muestran el número (`**5.** Fabricar`),
   corregí el **texto** de las que quedaron debajo (`**6.** Fabricar`). El usuario lee
   el texto; los ids no los ve.
7. Las vueltas atrás que entran o salen de lo que se corrió: comprobá sus lados.

En una **serpentina** (línea de tiempo) no alcanza con correr: recalculá la posición de
todos los hitos desde el insertado con la fórmula de la receta 5, y los lados de sus
flechas (el que cambia de fila pasa a `bottom → top`).

Si el usuario tiene el lienzo abierto y lo está editando, lo que guarda la app puede
pisar lo tuyo (y al revés). Antes de reescribir un canvas que está usando, avisale.

## Verificar

```sh
node .claude/skills/mycelium-canvas/validar-canvas.mjs --vault . "Ruta/Al lienzo.canvas"
```

Sale con código ≠ 0 si hay **errores** (JSON inválido, ids repetidos, flechas a nodos
que no existen, tarjetas encimadas, grupos que contienen a medias o tapan lo suyo,
texto que no entra, notas `file` que no existen o no son notas). Los **avisos** también
se corrigen: lado que da la espalda al enganche del otro extremo (el aviso trae los
lados que corresponden según la regla del hueco), flecha que pasa por debajo de otra
tarjeta, flecha demasiado corta, tarjetas pegadas, `label` o `color` de flecha que no
se van a ver. Con `--estricto`, los avisos también fallan.

Sin el validador, revisá a mano: para cada par de tarjetas, que sus rectángulos no se
toquen; para cada flecha, que cada lado mire al enganche del otro extremo; para cada
grupo, que contenga enteras a sus tarjetas y esté antes en `nodes`; para cada `file`,
que la ruta exista.

## Qué aporta un canvas al grafo del vault

El `.canvas` es un **nodo** del grafo. De él salen aristas hacia:

- cada `[[enlace]]` escrito en una tarjeta de texto, y
- cada nota de un nodo `file`.

Las **flechas no** crean aristas: son disposición visual. Si una relación entre dos
notas tiene que quedar en la memoria, escribila como `[[enlace]]` en una de las notas;
una flecha del lienzo no la registra.
