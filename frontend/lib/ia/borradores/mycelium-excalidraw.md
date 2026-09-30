---
name: mycelium-excalidraw
description: Crear, leer y modificar dibujos .excalidraw del vault de Mycelium — el JSON de Excalidraw, flechas enlazadas a sus formas, texto dentro de cajas, coordenadas y disposición legible. Usar cuando el usuario pida un dibujo, boceto, flujo, mapa mental o diagrama «a mano alzada», o cuando haya que cambiar un .excalidraw existente.
---
<!-- mycelium-ia v{{VERSION_IA}} -->
# Dibujos de Excalidraw en Mycelium

Un `.excalidraw` es un **dibujo**: formas con aspecto de hecho a mano, texto y
flechas, en un lienzo infinito. El archivo es JSON y **lo podés escribir vos**,
siempre que respetes lo que esta skill explica. Lo difícil no es poner cajas y
texto: es que **las flechas queden enganchadas a sus formas**, que **el texto entre**
en su caja y que **nada se encime**. Para eso hay que pensar en coordenadas.

## Cuándo usar Excalidraw (y cuándo no)

| Formato | Para qué | Elegilo si… |
|---|---|---|
| `.excalidraw` | Boceto, pizarra, flujo o mapa mental con aire informal | el usuario quiere «un dibujo», algo rápido para pensar o explicar |
| `.drawio` | Diagrama formal (UML, ER, red, BPMN) | hay que mantenerlo y retocarlo en meses, con conectores y estilos estrictos |
| `.canvas` | Notas del vault puestas en el espacio | los nodos son **notas** (`[[…]]`) o tarjetas de texto largo |
| Mermaid en una nota | Diagrama de texto dentro de la nota | alcanza con un flujo o secuencia sin cuidar la disposición |

Una nota muestra el dibujo con `![[Nombre.excalidraw]]` (se renderiza como imagen;
clic para editarlo). Si creás un dibujo para una nota, **embebelo ahí**: un dibujo
que nadie embebe no aparece en ninguna nota.

## Lo que hace Mycelium con el archivo (leído de su código)

- Lee **solo** `elements` y `files`. `appState` se ignora al abrir y se guarda
  como `{}`.
- Pasa los elementos por el `restore` de Excalidraw 0.18: completa los campos de
  estilo que falten, pero **no recalcula posiciones**. Lo que escribís en `x`, `y`,
  `width`, `height` y `points` es exactamente lo que el usuario ve.
- Lo abre mirando al **origen (0, 0), con zoom 100 % y sin centrar**. Si el dibujo
  empieza en (3000, 2000), el usuario ve una pantalla en blanco. **Arrancá cerca de
  (80, 100)** (la barra de herramientas tapa la franja de arriba) y crecé hacia la
  derecha y hacia abajo.
- **Al abrirlo lo reescribe**: normaliza cada elemento (agrega `index`, sube
  `version`), descarta lo borrado y lo que no entiende, y lo guarda. No te
  sorprendas si el archivo cambia después de que el usuario lo mira.

> [!danger] Un JSON roto se pierde
> Si el archivo no es JSON válido, Mycelium abre un dibujo **vacío** y a los
> ~800 ms lo **guarda vacío encima** del tuyo. Una flecha sin `points` hace algo
> parecido: Excalidraw no carga **ningún** elemento. Por eso: generá el JSON con un
> script, escribilo **de una vez** (a un temporal y `rename`), y **validalo** antes de
> darlo por terminado.

> [!warning] Si el usuario tiene el dibujo abierto
> Mycelium recarga la pestaña cuando el archivo cambia en disco, salvo que tenga
> cambios propios sin guardar. No edites un dibujo mientras el usuario lo está
> dibujando: pedile que lo cierre o esperá a que termine.
>
> El **editor modal** que se abre con clic sobre un dibujo embebido en una nota
> (`![[…excalidraw]]`) **no** se recarga: si está abierto mientras escribís, al
> cerrarlo guarda lo suyo y **pisa** lo tuyo. Pedile que lo cierre antes.

## El archivo

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "mycelium",
  "elements": [ … ],
  "appState": {},
  "files": {}
}
```

Un archivo vacío (0 bytes) también vale: es un dibujo en blanco.

### Campos comunes a todo elemento

```json
{
  "id": "rect-1", "type": "rectangle",
  "x": 100, "y": 100, "width": 180, "height": 70, "angle": 0,
  "strokeColor": "#1e1e1e", "backgroundColor": "#a5d8ff",
  "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
  "roughness": 1, "opacity": 100, "roundness": { "type": 3 },
  "seed": 1968410350, "version": 1, "versionNonce": 361174001,
  "isDeleted": false, "groupIds": [], "frameId": null,
  "boundElements": [], "updated": 1790000000000, "link": null, "locked": false
}
```

| Campo | Qué es |
|---|---|
| `id` | Único en el archivo. Los enlaces van por id |
| `type` | `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`, `frame` (hay más, pero con estos alcanza) |
| `x`, `y` | Esquina **superior izquierda** del rectángulo que envuelve al elemento |
| `width`, `height` | Tamaño. Nunca los dos en 0: Excalidraw descarta el elemento |
| `angle` | Rotación en **radianes**, alrededor del centro. Dejalo en 0 |
| `seed` | **Entero** que fija el trazo «a mano». Uno distinto por elemento |
| `version`, `versionNonce` | Enteros. Subí `version` y cambiá `versionNonce` cada vez que modifiques un elemento |
| `roughness` | 0 = prolijo (técnico), 1 = a mano (por defecto), 2 = muy a mano |
| `fillStyle` | `solid`, `hachure` (rayado), `cross-hatch`, `zigzag` |
| `strokeStyle` | `solid`, `dashed`, `dotted` |
| `roundness` | `null` = esquinas rectas; `{ "type": 3 }` en rectángulos y `{ "type": 2 }` en el resto = redondeadas |
| `boundElements` | Lo que está **enganchado** a este elemento: `{ "id", "type": "arrow" \| "text" }` |
| `groupIds` | Grupos a los que pertenece (del más interno al más externo) |
| `frameId` | El marco que lo contiene, o `null` |

### Texto

```json
{ "id": "txt-1", "type": "text", "x": 150, "y": 122, "width": 84, "height": 25,
  "text": "Inicio", "originalText": "Inicio", "fontSize": 20, "fontFamily": 5,
  "lineHeight": 1.25, "textAlign": "center", "verticalAlign": "middle",
  "containerId": "rect-1", "autoResize": true, … }
```

- `fontFamily`: **5** Excalifont (a mano, la de siempre), **6** Nunito (prolija),
  **3** Cascadia (código). Sin `fontFamily` el texto no se dibuja bien.
- `lineHeight`: 1.25 para Excalifont, 1.35 Nunito, 1.2 Cascadia.
- `height` = líneas × `fontSize` × `lineHeight`. `width` ≈ caracteres de la línea
  más larga × `fontSize` × 0,6 (es una cota con margen; ver «Medir texto»).
- Varias líneas: `\n` en `text` **y** en `originalText`. Excalidraw **no** parte
  líneas al abrir: si la línea no entra, se sale de la caja.
- Texto **suelto** (título, nota al margen): `containerId: null`, `textAlign: "left"`,
  `verticalAlign: "top"`.

### Texto dentro de una forma (etiqueta)

Dos lados que tienen que coincidir:

- el texto lleva `"containerId": "<id de la forma>"`, `textAlign: "center"`,
  `verticalAlign: "middle"`;
- la forma lista el texto: `"boundElements": [{ "id": "<id del texto>", "type": "text" }]`.

Un contenedor admite **un solo** texto. Contenedores válidos: `rectangle`,
`ellipse`, `diamond` y `arrow` (etiqueta de flecha). Posición del texto: **centrado
en la forma** — `x = forma.x + (forma.width − texto.width) / 2`, igual en `y`.

### Flecha

```json
{ "id": "flecha-1", "type": "arrow",
  "x": 288, "y": 135, "width": 104, "height": 0,
  "points": [[0, 0], [104, 0]],
  "startBinding": { "elementId": "rect-1", "focus": 0, "gap": 8 },
  "endBinding":   { "elementId": "rect-2", "focus": 0, "gap": 8 },
  "startArrowhead": null, "endArrowhead": "arrow",
  "roundness": { "type": 2 }, "elbowed": false, … }
```

- `x`, `y` es el **primer punto** en coordenadas de escena. `points` son
  **relativos** a él, y `points[0]` es siempre `[0, 0]`.
- `width`/`height` = extensión de `points` (máximo − mínimo en cada eje).
- `startBinding`/`endBinding` la **enganchan**: si el usuario mueve la forma, la
  flecha la sigue. `focus: 0` apunta al centro; `gap` es la distancia entre la punta
  y el borde (usá 8).
- **Recíproco obligatorio**: cada forma enganchada lista la flecha en sus
  `boundElements` (`{ "id": "flecha-1", "type": "arrow" }`). Sin eso, al mover la
  forma la flecha se queda quieta.
- Puntas: `endArrowhead` `"arrow"` (por defecto), `"triangle"`, `"dot"`, `"bar"`,
  `null`; `startArrowhead` igual. Para una línea de mapa mental, las dos en `null`.
- `line` es igual pero **no se engancha** (Excalidraw anula sus bindings).
  Para conectar formas, siempre `arrow`.
- Flechas con codo automático (`"elbowed": true`, con `fixedPoint` en cada
  binding): evitalas. Para esquivar obstáculos usá una flecha normal con **puntos
  intermedios** y `roundness: null` (tramos rectos).

### Marco y grupo

- **Marco** (`frame`): una zona con nombre (`"name": "Backend"`), `roughness: 0`.
  Cada hijo lleva `"frameId": "<id del marco>"` —su texto también— y tiene que
  quedar **adentro**: el marco recorta lo que sobresale.
- **Grupo**: el mismo id en `groupIds` de cada forma **y de su texto**. Se
  seleccionan y mueven juntas. No cambia el dibujo.

## Reglas de oro

1. **Ids únicos** en todo el archivo. Si Excalidraw encuentra uno repetido, le
   cambia el id al segundo y rompe sus enlaces.
2. **Enlaces recíprocos, siempre de a dos**: flecha → forma (`startBinding` /
   `endBinding`) **y** forma → flecha (`boundElements`); texto → contenedor
   (`containerId`) **y** contenedor → texto (`boundElements`).
3. En flechas y líneas, `points[0]` = `[0, 0]` y **al menos dos puntos**.
4. Todo elemento: `isDeleted: false`, `seed` entero, `width`/`height` no ambos 0,
   `fontFamily` y `lineHeight` en los textos.
5. **Extremos sobre el borde**: la punta de una flecha enganchada queda a `gap` px
   del contorno de su forma, ni adentro ni lejos (se calcula abajo).
6. **Nada encimado**: entre dos formas, al menos 60 px en horizontal y 50 en
   vertical; si la flecha que las une lleva etiqueta, **al menos 120 px**. Una forma
   puede contener **entera** a otra (una zona, una pantalla); pisarla a medias, no.
7. **El texto entra** en su forma (ver «Área útil»). Si no, agrandá la forma o partí
   la línea con `\n`.
8. **Conservá lo que no entendés**: al modificar, cargá el JSON, cambiá solo lo
   necesario y volvé a escribir todo lo demás tal cual (campos desconocidos
   incluidos, `files`, imágenes, `customData`).
9. **Escribilo de una vez y validalo** (ver «Verificar»).

## Geometría

### Coordenadas

- Coordenadas de **escena**, en píxeles: `x` crece hacia la derecha, **`y` hacia
  abajo**. (0, 0) es la esquina superior izquierda de lo que ve el usuario al abrir.
- El **centro** de una forma es `(x + width/2, y + height/2)`. Pensá la disposición
  en centros y derivá `x = cx − width/2`, `y = cy − height/2`.
- Alineá centros en **columnas y filas**: da un dibujo prolijo aunque el trazo sea
  a mano.

### Medir texto

Con `fontSize` 20, cada carácter ocupa en promedio ~0,5 × 20 px en Excalifont y
Nunito, 0,59 × 20 en Cascadia; las mayúsculas, ~0,68. Para no quedarte corto usá
**0,6 × fontSize por carácter** (0,55 en Nunito). Alto de línea: `fontSize × lineHeight`.

### Área útil de una forma para su texto

| Forma | Ancho útil | Alto útil | Tamaño para que la etiqueta entre con aire |
|---|---|---|---|
| `rectangle` | `width − 10` | `height − 10` | texto + 40 × texto + 30 |
| `ellipse` | `width × 0,707 − 10` | `height × 0,707 − 10` | (texto + 30) × 1,42 |
| `diamond` | `width / 2 − 10` | `height / 2 − 10` | (texto + 30) × 2 a lo ancho, (texto + 20) × 2 a lo alto |

El rombo es el que más engaña: la mitad de su ancho es para el texto. «¿Hay stock?»
(~130 px) pide un rombo de ~320 × 90.

### Dónde empieza y termina una flecha

Para una flecha de la forma A a la forma B con `focus: 0`:

1. `cA`, `cB` = centros. `d = (cB − cA) / |cB − cA|` = dirección unitaria `(dx, dy)`.
2. Distancia del centro al borde de A en esa dirección, con `a = width/2`, `b = height/2`:
   - rectángulo: `t = min(a / |dx|, b / |dy|)` (si un componente es 0, vale el otro);
   - elipse: `t = 1 / √((dx/a)² + (dy/b)²)`;
   - rombo: `t = 1 / (|dx|/a + |dy|/b)`.
3. Inicio `P1 = cA + d × (tA + gap)`. Final `P2 = cB − d × (tB + gap)`, con `tB`
   calculado igual para B en la dirección `−d`.
4. La flecha: `x = P1.x`, `y = P1.y`, `points = [[0, 0], [P2.x − P1.x, P2.y − P1.y]]`,
   `width = |P2.x − P1.x|`, `height = |P2.y − P1.y|`.

Con **puntos intermedios** (para rodear algo): `P1` apunta hacia el primer punto
intermedio en vez de hacia `cB`, y `P2` sale del último punto intermedio. Los puntos
intermedios van en `points` relativos a `P1`.

Etiqueta de flecha: texto con `containerId` = id de la flecha, centrado en el
**medio** de la flecha — con una cantidad impar de puntos, el punto del medio; con
una par, el medio del tramo central. Con **un** punto intermedio la etiqueta cae
**en el codo**: usá dos (o ninguno) si la flecha lleva etiqueta.

### Disposiciones legibles

- **Flujo vertical**: una columna principal (mismo `cx`), filas cada ~120–150 px
  según la altura de las formas; las ramas laterales en una segunda columna a
  ≥ 350 px; los retornos rodean por afuera con dos puntos intermedios.
- **Árbol / organigrama**: el ancho de cada subárbol es la suma de los anchos de
  sus hijos más 40 px entre hermanos; el padre va centrado sobre sus hijos; niveles
  cada ~150 px. Calculalo recursivo desde las hojas (receta abajo).
- **Mapa mental**: la idea central en el medio; las ramas sobre una elipse
  (radios ~300 × 190, porque las cajas son más anchas que altas); las hojas, si la
  rama sale hacia un costado, **apiladas en vertical** (cada 70 px) más afuera; si
  sale hacia arriba o abajo, **en fila** (cada 170 px).
- **Arquitectura**: capas en columnas (cliente → servicios → datos) cada ~350 px;
  lo que comparte zona, en un `frame`.
- Nada debe cruzar una forma que no sea su origen o su destino: si pasa, mové
  formas o agregá puntos intermedios.

## El generador de referencia

Calcular todo lo anterior a mano es donde se cometen los errores. Escribí el
dibujo con un **script de Node** que use este generador. Copialo a un archivo
temporal **fuera del vault** (por ejemplo en el directorio temporal del sistema:
`$TMPDIR`, `/tmp` o `%TEMP%`), junto con tu script, y corrélo con `node`.

```js
// dibujo.mjs — generador de dibujos .excalidraw para Mycelium
import fs from "node:fs";

const GAP = 8; // separación entre la punta de la flecha y el borde de la forma
const ANCHO = { 1: 0.6, 2: 0.55, 3: 0.6, 5: 0.6, 6: 0.55, 8: 0.6 }; // ancho por carácter / fontSize (con margen)
const ALTO = { 1: 1.25, 2: 1.15, 3: 1.2, 5: 1.25, 6: 1.35, 8: 1.25 }; // lineHeight de cada fuente
const azar = () => Math.floor(Math.random() * 2 ** 31);

export function medir(texto, fontSize = 20, fontFamily = 5) {
  const lineas = texto.split("\n");
  return {
    w: Math.ceil(Math.max(...lineas.map((l) => [...l].length)) * fontSize * ANCHO[fontFamily]),
    h: Math.ceil(lineas.length * fontSize * ALTO[fontFamily]),
  };
}

/** Tamaño de forma para que la etiqueta entre con aire (inverso del área útil de Excalidraw). */
export function tamanoPara(tipo, texto, fontSize = 20, fontFamily = 5) {
  const m = medir(texto, fontSize, fontFamily);
  if (tipo === "ellipse") return { w: Math.ceil((m.w + 30) * 1.42), h: Math.ceil((m.h + 20) * 1.42) };
  if (tipo === "diamond") return { w: Math.ceil(2 * (m.w + 30)), h: Math.ceil(2 * (m.h + 20)) };
  return { w: m.w + 40, h: m.h + 30 };
}

export const centro = (f) => ({ x: f.x + f.width / 2, y: f.y + f.height / 2 });

/** Distancia del centro al borde de la forma en la dirección unitaria (dx, dy). */
function alBorde(f, dx, dy) {
  const a = f.width / 2, b = f.height / 2;
  if (f.type === "ellipse") return 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  if (f.type === "diamond") return 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  return Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
}

/** Punto a GAP del borde de `f`, sobre la recta que va del centro de `f` hacia `hacia`. */
export function puntoDeBorde(f, hacia) {
  const c = centro(f);
  const L = Math.hypot(hacia.x - c.x, hacia.y - c.y) || 1;
  const dx = (hacia.x - c.x) / L, dy = (hacia.y - c.y) / L;
  const t = alBorde(f, dx, dy) + GAP;
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export class Dibujo {
  constructor(elementos = [], resto = {}) {
    this.elementos = elementos;
    this.resto = resto; // appState, files y campos que no tocamos
    this.n = 0;
  }

  static desde(ruta) {
    const texto = fs.readFileSync(ruta, "utf8");
    const j = texto.trim() ? JSON.parse(texto) : {};
    const { elements = [], ...resto } = j;
    return new Dibujo(elements, resto);
  }

  id(prefijo) {
    let id;
    do id = prefijo + "-" + (++this.n) + "-" + azar().toString(36).slice(0, 4);
    while (this.porId(id));
    return id;
  }
  porId(id) { return this.elementos.find((e) => e.id === id); }
  /** Forma (o texto suelto) cuyo texto visible es `t`. */
  buscar(t) {
    const txt = this.elementos.find((e) => e.type === "text" && !e.isDeleted && e.originalText === t);
    if (!txt) return undefined;
    return txt.containerId ? this.porId(txt.containerId) : txt;
  }
  textoDe(f) {
    const b = (f.boundElements || []).find((x) => x.type === "text");
    return b && this.porId(b.id);
  }

  base(type, x, y, width, height, extra = {}) {
    const e = {
      id: this.id(type), type, x, y, width, height, angle: 0,
      strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
      groupIds: [], frameId: null, roundness: null,
      seed: azar(), version: 1, versionNonce: azar(), isDeleted: false,
      boundElements: [], updated: Date.now(), link: null, locked: false,
      ...extra,
    };
    this.elementos.push(e);
    return e;
  }

  /** Texto suelto. (x, y) es su esquina superior izquierda. */
  texto(t, x, y, o = {}) {
    const fontSize = o.fontSize ?? 20, fontFamily = o.fontFamily ?? 5;
    const m = medir(t, fontSize, fontFamily);
    return this.base("text", x, y, m.w, m.h, {
      text: t, originalText: t, fontSize, fontFamily, textAlign: o.alinear ?? "left",
      verticalAlign: "top", containerId: null, lineHeight: ALTO[fontFamily], autoResize: true,
      strokeColor: o.color ?? "#1e1e1e",
    });
  }

  /** Forma con etiqueta centrada. (cx, cy) es el CENTRO de la forma. */
  caja(etiqueta, cx, cy, o = {}) {
    const type = o.forma ?? "rectangle";
    const fontSize = o.fontSize ?? 20, fontFamily = o.fontFamily ?? 5;
    const auto = tamanoPara(type, etiqueta || " ", fontSize, fontFamily);
    const w = Math.max(o.ancho ?? 0, auto.w), h = Math.max(o.alto ?? 0, auto.h);
    const f = this.base(type, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, {
      strokeColor: o.borde ?? "#1e1e1e", backgroundColor: o.fondo ?? "transparent",
      roundness: type === "rectangle" ? { type: 3 } : { type: 2 },
      strokeStyle: o.trazo ?? "solid", roughness: o.rugosidad ?? 1,
    });
    if (etiqueta) this.etiquetar(f, etiqueta, { fontSize, fontFamily, color: o.color });
    return f;
  }

  /** Texto dentro de un contenedor (forma o flecha): enlace recíproco y centrado. */
  etiquetar(cont, etiqueta, o = {}) {
    const fontSize = o.fontSize ?? (cont.type === "arrow" ? 16 : 20), fontFamily = o.fontFamily ?? 5;
    const m = medir(etiqueta, fontSize, fontFamily);
    const c = cont.type === "arrow" ? this.medioDeFlecha(cont) : centro(cont);
    const t = this.base("text", c.x - m.w / 2, c.y - m.h / 2, m.w, m.h, {
      text: etiqueta, originalText: etiqueta, fontSize, fontFamily,
      textAlign: "center", verticalAlign: "middle", containerId: cont.id,
      lineHeight: ALTO[fontFamily], autoResize: true, strokeColor: o.color ?? "#1e1e1e",
      groupIds: [...cont.groupIds], frameId: cont.frameId,
    });
    cont.boundElements = [...(cont.boundElements || []), { id: t.id, type: "text" }];
    return t;
  }

  medioDeFlecha(a) {
    const p = a.points, n = p.length;
    if (n % 2 === 1) { const q = p[(n - 1) / 2]; return { x: a.x + q[0], y: a.y + q[1] }; }
    const q1 = p[n / 2 - 1], q2 = p[n / 2];
    return { x: a.x + (q1[0] + q2[0]) / 2, y: a.y + (q1[1] + q2[1]) / 2 };
  }

  /**
   * Flecha enlazada de `desde` a `hasta` (formas). `o.via`: puntos intermedios
   * absolutos [{x,y}] para rodear obstáculos; `o.etiqueta`; `o.trazo`: "dashed".
   */
  flecha(desde, hasta, o = {}) {
    const a = this.base("arrow", 0, 0, 0, 0, {
      points: [[0, 0], [1, 1]], roundness: o.via ? null : { type: 2 },
      strokeColor: o.color ?? "#1e1e1e", strokeStyle: o.trazo ?? "solid",
      startBinding: { elementId: desde.id, focus: 0, gap: GAP },
      endBinding: { elementId: hasta.id, focus: 0, gap: GAP },
      startArrowhead: o.puntaInicio ?? null, endArrowhead: o.puntaFin === undefined ? "arrow" : o.puntaFin,
      elbowed: false,
    });
    desde.boundElements = [...(desde.boundElements || []), { id: a.id, type: "arrow" }];
    hasta.boundElements = [...(hasta.boundElements || []), { id: a.id, type: "arrow" }];
    this.trazar(a, o.via ?? []);
    if (o.etiqueta) this.etiquetar(a, o.etiqueta, { fontFamily: o.fontFamily, color: o.color });
    return a;
  }

  /** Recalcula los extremos de una flecha enlazada (después de mover sus formas). */
  trazar(a, via) {
    const s = a.startBinding && this.porId(a.startBinding.elementId);
    const e = a.endBinding && this.porId(a.endBinding.elementId);
    const abs = a.points.map(([px, py]) => ({ x: a.x + px, y: a.y + py }));
    const medio = via ?? abs.slice(1, -1);
    const fin0 = e ? centro(e) : abs[abs.length - 1];
    const ini0 = s ? centro(s) : abs[0];
    const p1 = s ? puntoDeBorde(s, medio[0] ?? fin0) : ini0;
    const p2 = e ? puntoDeBorde(e, medio[medio.length - 1] ?? ini0) : fin0;
    const todos = [p1, ...medio, p2];
    a.x = p1.x; a.y = p1.y;
    a.points = todos.map((p) => [p.x - p1.x, p.y - p1.y]);
    const xs = a.points.map((p) => p[0]), ys = a.points.map((p) => p[1]);
    a.width = Math.max(...xs) - Math.min(...xs);
    a.height = Math.max(...ys) - Math.min(...ys);
    this.tocar(a);
    const t = this.textoDe(a);
    if (t) { const c = this.medioDeFlecha(a); t.x = c.x - t.width / 2; t.y = c.y - t.height / 2; this.tocar(t); }
  }

  /** Mueve una forma con su texto y reengancha sus flechas. */
  mover(f, dx, dy) {
    f.x += dx; f.y += dy; this.tocar(f);
    const t = this.textoDe(f);
    if (t) { t.x += dx; t.y += dy; this.tocar(t); }
    for (const b of f.boundElements || []) {
      const a = this.porId(b.id);
      if (a && a.type === "arrow") this.trazar(a, null);
    }
  }

  /** Borra una forma, su texto y las flechas que la tocan, limpiando las referencias. */
  borrar(f) {
    const fuera = new Set([f.id]);
    for (const b of f.boundElements || []) fuera.add(b.id);
    for (const id of [...fuera]) { const x = this.porId(id); const t = x && x.type === "arrow" && this.textoDe(x); if (t) fuera.add(t.id); }
    this.elementos = this.elementos.filter((e) => !fuera.has(e.id));
    for (const e of this.elementos) {
      if (e.boundElements && e.boundElements.some((b) => fuera.has(b.id))) {
        e.boundElements = e.boundElements.filter((b) => !fuera.has(b.id)); this.tocar(e);
      }
    }
  }

  tocar(e) { e.version = (e.version || 1) + 1; e.versionNonce = azar(); e.updated = Date.now(); }

  /** Agrupa formas (con su texto): se seleccionan y mueven juntas. */
  agrupar(formas) {
    const g = this.id("grupo");
    for (const f of formas) { f.groupIds = [...f.groupIds, g]; const t = this.textoDe(f); if (t) t.groupIds = [...t.groupIds, g]; }
    return g;
  }

  /** Marco con nombre alrededor de `formas` (con margen). Va al final: se dibuja detrás. */
  marco(nombre, formas, margen = 40) {
    const x1 = Math.min(...formas.map((f) => f.x)) - margen, y1 = Math.min(...formas.map((f) => f.y)) - margen;
    const x2 = Math.max(...formas.map((f) => f.x + f.width)) + margen, y2 = Math.max(...formas.map((f) => f.y + f.height)) + margen;
    const m = this.base("frame", x1, y1, x2 - x1, y2 - y1, { name: nombre, roughness: 0, strokeWidth: 2 });
    for (const f of formas) { f.frameId = m.id; const t = this.textoDe(f); if (t) t.frameId = m.id; }
    return m;
  }

  guardar(ruta) {
    const j = { type: "excalidraw", version: 2, source: "mycelium", ...this.resto, elements: this.elementos };
    j.appState = j.appState ?? {}; j.files = j.files ?? {};
    const tmp = ruta + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
    fs.renameSync(tmp, ruta); // escritura atómica: Mycelium nunca ve un JSON a medias
  }
}
```

Resumen de uso:

| Llamada | Qué hace |
|---|---|
| `d.caja(etiqueta, cx, cy, { forma, ancho, alto, fondo, borde, trazo, rugosidad, fontSize, fontFamily })` | Forma con su etiqueta; `(cx, cy)` es el **centro**; el tamaño se ajusta solo al texto (`ancho`/`alto` son mínimos) |
| `d.texto(t, x, y, { fontSize, fontFamily, color })` | Texto suelto; `(x, y)` es su esquina |
| `d.flecha(a, b, { etiqueta, via, trazo, color, puntaFin, puntaInicio, fontFamily })` | Flecha enganchada a las dos formas, extremos calculados |
| `d.marco(nombre, formas, margen)` / `d.agrupar(formas)` | Zona con nombre / grupo |
| `Dibujo.desde(ruta)`, `d.buscar(texto)`, `d.mover(f, dx, dy)`, `d.borrar(f)` | Modificar uno existente |
| `d.guardar(ruta)` | Escribe el archivo de una vez |

Con `caja` las etiquetas quedan adentro y con `flecha` los enlaces quedan
recíprocos y los extremos en el borde. **Lo que el generador no hace es la
disposición**: los centros los elegís vos, con las reglas de «Disposiciones».

## Recetas

Cada receta es el script que importa el generador. Todas pasan el validador
y se comprobaron cargándolas en Excalidraw.

### Flujo con decisión (y un retorno)

```js
import { Dibujo, centro } from "./dibujo.mjs";
const d = new Dibujo();
d.texto("Proceso de pedido", 180, 40, { fontSize: 28 });
const ini = d.caja("Inicio", 300, 130, { forma: "ellipse", fondo: "#b2f2bb" });
const rec = d.caja("Recibir pedido", 300, 250, { fondo: "#a5d8ff" });
const dec = d.caja("¿Hay stock?", 300, 400, { forma: "diamond", fondo: "#ffec99" });
const env = d.caja("Preparar envío", 300, 600, { fondo: "#a5d8ff" });
const fin = d.caja("Fin", 300, 720, { forma: "ellipse", fondo: "#ffc9c9" });
const pro = d.caja("Pedir al\nproveedor", 720, 400, { fondo: "#d0bfff" });
d.flecha(ini, rec);
d.flecha(rec, dec);
d.flecha(dec, env, { etiqueta: "sí" });  // 200 px entre centros: sobra lugar para la etiqueta
d.flecha(env, fin);
d.flecha(dec, pro, { etiqueta: "no" });
// retorno: sale por la derecha, sube por afuera y entra a «Recibir pedido» por la derecha;
// dos puntos intermedios → la etiqueta cae en el tramo vertical, no en un codo
const cp = centro(pro), cr = centro(rec), xr = pro.x + pro.width + 60;
d.flecha(pro, rec, { via: [{ x: xr, y: cp.y }, { x: xr, y: cr.y }], trazo: "dashed", etiqueta: "cuando\nllega" });
d.guardar("Procesos/Pedido.excalidraw");
```

### Árbol u organigrama

```js
import { Dibujo, tamanoPara } from "./dibujo.mjs";
const d = new Dibujo();
const arbol = { t: "Dirección", h: [
  { t: "Producto", h: [{ t: "Diseño" }, { t: "Desarrollo" }] },
  { t: "Operaciones", h: [{ t: "Soporte" }, { t: "Finanzas" }, { t: "Personas" }] },
] };
const SEP = 40, NIVEL = 150;
const ancho = (n) => n.h ? Math.max(tamanoPara("rectangle", n.t).w, n.h.reduce((s, h) => s + ancho(h), 0) + SEP * (n.h.length - 1)) : tamanoPara("rectangle", n.t).w;
function colocar(n, x0, nivel) {                 // x0 = borde izquierdo del subárbol
  const w = ancho(n);
  const f = d.caja(n.t, x0 + w / 2, 150 + nivel * NIVEL, { fondo: nivel ? "#e9ecef" : "#a5d8ff" });
  let x = x0 + (w - (n.h ?? []).reduce((s, h) => s + ancho(h), 0) - SEP * ((n.h?.length ?? 1) - 1)) / 2;
  for (const h of n.h ?? []) { const fh = colocar(h, x, nivel + 1); d.flecha(f, fh); x += ancho(h) + SEP; }
  return f;
}
colocar(arbol, 80, 0);
d.guardar("Equipo/Organigrama.excalidraw");
```

### Mapa mental

```js
import { Dibujo } from "./dibujo.mjs";
const d = new Dibujo();
const C = { x: 700, y: 440 };
const raiz = d.caja("Mycelium", C.x, C.y, { forma: "ellipse", fondo: "#ffec99", fontSize: 28 });
const ramas = [["Notas", ["Markdown", "Propiedades"]], ["Grafo", ["Hubs", "Huérfanas"]],
  ["Dibujos", ["Excalidraw", "draw.io"]], ["IA", ["Skills", "Memoria"]],
  ["Tablas", [".base"]], ["Calendario", ["Recordatorios"]]];
const colores = ["#a5d8ff", "#b2f2bb", "#ffc9c9", "#d0bfff", "#ffd8a8", "#c3fae8"];
ramas.forEach(([nombre, hojas], i) => {
  const ang = (i / ramas.length) * 2 * Math.PI - Math.PI / 2;   // la primera, arriba
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const hx = C.x + 300 * cos, hy = C.y + 190 * sin;             // elipse 300 × 190
  const h = d.caja(nombre, hx, hy, { fondo: colores[i] });
  d.flecha(raiz, h, { puntaFin: null });                         // línea sin punta
  hojas.forEach((hoja, j) => {
    const k = j - (hojas.length - 1) / 2;
    const [lx, ly] = Math.abs(cos) >= 0.5
      ? [hx + Math.sign(cos) * 230, hy + k * 70]                // rama al costado: hojas en columna
      : [hx + k * 170, hy + Math.sign(sin) * 120];              // rama arriba/abajo: hojas en fila
    d.flecha(h, d.caja(hoja, lx, ly, { fontSize: 16, trazo: "dashed" }), { puntaFin: null });
  });
});
d.guardar("Mapas/Mycelium.excalidraw");
```

### Arquitectura: cajas, zona y flechas etiquetadas

```js
import { Dibujo } from "./dibujo.mjs";
const d = new Dibujo();
const tec = { rugosidad: 0, fontFamily: 6 };                     // trazo prolijo, letra Nunito
const web = d.caja("Navegador", 140, 300, { ...tec, fondo: "#e9ecef" });
const api = d.caja("API REST", 520, 180, { ...tec, fondo: "#a5d8ff", ancho: 200 });
const auth = d.caja("Servicio de\nautenticación", 520, 420, { ...tec, fondo: "#d0bfff", ancho: 200 });
const db = d.caja("PostgreSQL", 880, 300, { ...tec, forma: "ellipse", fondo: "#b2f2bb" });
d.marco("Backend", [api, auth, db], 50);
d.flecha(web, api, { etiqueta: "HTTPS", fontFamily: 6 });
d.flecha(api, auth, { etiqueta: "valida token", trazo: "dashed", fontFamily: 6 });
d.flecha(api, db, { etiqueta: "SQL", fontFamily: 6 });
d.flecha(auth, db);
d.agrupar([api, auth]);
d.guardar("Arquitectura/Backend.excalidraw");
```

### Boceto anotado (una pantalla con notas al margen)

```js
import { Dibujo } from "./dibujo.mjs";
const d = new Dibujo();
d.caja("", 400, 320, { ancho: 360, alto: 440, rugosidad: 2 });  // la pantalla contiene al resto
const barra = d.caja("Buscar…", 400, 150, { ancho: 300, alto: 50, fontSize: 16 });
d.caja("Resultados", 400, 320, { ancho: 300, alto: 220, fontSize: 16, fondo: "#e9ecef" });
const boton = d.caja("Guardar", 400, 490, { ancho: 140, alto: 50, fondo: "#a5d8ff", fontSize: 16 });
const n1 = d.texto("La búsqueda filtra\nmientras escribís", 700, 110, { color: "#e03131", fontSize: 16 });
const n2 = d.texto("Botón principal:\nun solo color fuerte", 700, 480, { color: "#e03131", fontSize: 16 });
d.flecha(n1, barra, { color: "#e03131" });                       // un texto suelto también se engancha
d.flecha(n2, boton, { color: "#e03131" });
d.guardar("Diseño/Pantalla de búsqueda.excalidraw");
```

## Leer y modificar un dibujo existente

**Leer**: el contenido son los `text` (`originalText`), y la estructura, las
flechas: `startBinding.elementId` → `endBinding.elementId`, resolviendo cada id a su
forma y cada forma a su texto (`boundElements` de tipo `text`). Ignorá lo que tenga
`isDeleted: true`.

**Modificar** con el generador, que conserva todo lo que no toca:

```js
import { Dibujo, centro } from "./dibujo.mjs";
const ruta = "Arquitectura/Backend.excalidraw";
const d = Dibujo.desde(ruta);
const db = d.buscar("PostgreSQL");                 // forma por el texto de su etiqueta
const api = d.buscar("API REST");
d.mover(db, 0, 140);                               // mueve su texto y reengancha sus flechas
const c = centro(db);
const redis = d.caja("Caché Redis", c.x, c.y - 260, { forma: "ellipse", fondo: "#ffc9c9", rugosidad: 0, fontFamily: 6 });
d.flecha(api, redis, { etiqueta: "lee", fontFamily: 6 });
// si la forma nueva va dentro de un marco: frameId en ella y en su texto, y el marco la abarca
const marco = d.elementos.find((e) => e.type === "frame" && e.name === "Backend");
redis.frameId = marco.id; d.textoDe(redis).frameId = marco.id;
marco.width = Math.max(marco.width, redis.x + redis.width + 50 - marco.x);
marco.height = Math.max(marco.height, db.y + db.height + 50 - marco.y);
d.tocar(marco);
d.guardar(ruta);
```

Qué arrastra cada cambio (lo hace el generador; si editás a mano, hacelo vos):

| Cambio | Además hay que… |
|---|---|
| Mover una forma | mover su texto lo mismo y **recalcular los extremos de cada flecha** de sus `boundElements` (y la posición de la etiqueta de esa flecha) |
| Agrandar una forma | recentrar su texto y recalcular sus flechas |
| Cambiar una etiqueta | `text` y `originalText`, `width`/`height` del texto, recentrarlo, y agrandar la forma si no entra |
| Reconectar una flecha | sacarla de `boundElements` de la forma vieja, agregarla a la nueva, cambiar el binding y recalcular sus extremos |
| Borrar una forma | borrar su texto y sus flechas (con sus etiquetas), y **sacar esos ids** de los `boundElements` de las demás formas |
| Cualquier cambio | `version` + 1, `versionNonce` nuevo, `updated` = ahora |

Antes de agregar algo, buscá lugar libre: calculá la caja envolvente de lo
existente y ubicá lo nuevo a ≥ 60 px de todo, o corré las formas vecinas.

## Verificar

1. **Validá** cada archivo que escribiste:

   ```sh
   node .claude/skills/mycelium-excalidraw/validar-excalidraw.mjs "Procesos/Pedido.excalidraw"
   ```

   Comprueba el JSON y la forma del archivo, ids únicos, campos obligatorios por
   tipo, enlaces recíprocos (flecha↔forma, texto↔contenedor) y a elementos que
   existen, extremos de flecha sobre el borde de su forma, `points`, texto que no
   entra, formas encimadas, flechas que atraviesan formas ajenas y dibujos lejos
   del origen. Sale con código 1 si hay **errores**: corregilos todos. Los
   **avisos** son cosas que se ven mal pero no rompen; resolvelos salvo que sean
   deliberados. Acepta varias rutas o una carpeta.
2. **Repasá la disposición** con los números: ¿las filas y columnas están
   alineadas?, ¿las flechas etiquetadas miden ≥ 120 px?, ¿el dibujo empieza cerca
   de (80, 100)?
3. Si el dibujo es para una nota, **embebelo** (`![[Nombre.excalidraw]]`) y decile
   al usuario dónde quedó.

## Estilo

| Uso | Relleno (`backgroundColor`) | Trazo (`strokeColor`) |
|---|---|---|
| Neutro | `#e9ecef` | `#1e1e1e` |
| Azul (proceso, servicio) | `#a5d8ff` | `#1971c2` |
| Verde (inicio, ok, datos) | `#b2f2bb` | `#2f9e44` |
| Amarillo (decisión, idea central) | `#ffec99` | `#f08c00` |
| Rojo (fin, error, alerta) | `#ffc9c9` | `#e03131` |
| Violeta (externo) | `#d0bfff` | `#6741d9` |
| Naranja | `#ffd8a8` | `#e8590c` |

- Rellená con `fillStyle: "solid"`; el rayado (`hachure`) ensucia cuando hay texto.
- El trazo casi siempre `#1e1e1e`; el color va en el relleno. Rojo en el trazo para
  anotaciones.
- `roughness` 1 y Excalifont para bocetos; `roughness` 0 y Nunito para diagramas
  técnicos. No mezcles en un mismo dibujo.
- Títulos 28, etiquetas 20, hojas y etiquetas de flecha 16. Menos de 14 no se lee
  embebido en una nota.
- En modo oscuro Excalidraw invierte los colores solo: no hace falta otra paleta.

## Errores frecuentes

| Síntoma en Mycelium | Causa |
|---|---|
| El dibujo abre vacío (y después el archivo queda vacío) | JSON inválido, o una flecha sin `points` |
| La flecha no sigue a la forma cuando el usuario la mueve | falta `{ id, type: "arrow" }` en `boundElements` de la forma |
| La flecha queda flotando lejos, o se mete dentro de la caja | extremos mal calculados, o se movió la forma sin recalcularlos |
| El texto sale de la caja | línea demasiado larga para el área útil (sobre todo en rombos y elipses) |
| El texto no se mueve con su caja | falta `containerId` en el texto o `{ type: "text" }` en la forma |
| Un elemento desapareció | tipo desconocido, `width` y `height` en 0, `text` vacío o id repetido |
| La pantalla abre en blanco | el dibujo está lejos de (0, 0) o en coordenadas negativas |
| Lo que dibujó el usuario se perdió | se escribió encima mientras la pestaña tenía cambios sin guardar |
