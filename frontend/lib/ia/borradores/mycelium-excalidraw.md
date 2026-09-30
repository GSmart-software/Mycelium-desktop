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

El embed resuelve **por nombre**, como un `[[enlace]]`: `![[Pedido.excalidraw]]`
encuentra `Procesos/Pedido.excalidraw` aunque la nota esté en otra carpeta. Pero el
nombre se compara **sin la extensión** y contra **todos** los archivos del vault: si
hay otro `Pedido` (una nota `Pedido.md`, un `Pedido.drawio` u otro dibujo), gana el
más cercano a la raíz, y si ese no es un dibujo el embed muestra «No se pudo cargar
el diagrama». Por eso:

- **Poné al dibujo un nombre que no tenga ningún otro archivo**, tampoco la nota que
  lo embebe: con `Pedido.md` y `Pedido.excalidraw` en la misma carpeta, hasta
  `[[Pedido]]` puede terminar abriendo el dibujo. Por ejemplo, `Pedido (flujo)`.
- Si igual hay homónimos, desambiguá con la carpeta: `![[Procesos/Pedido.excalidraw]]`.

## Lo que hace Mycelium con el archivo (leído de su código)

- Lee **solo** `elements` y `files`. `appState` se ignora al abrir y se guarda
  como `{}`.
- Pasa los elementos por el `restore` de Excalidraw 0.18: completa los campos de
  estilo que falten, pero **no recalcula posiciones**. Lo que escribís en `x`, `y`,
  `width`, `height` y `points` es exactamente lo que el usuario ve.
- Lo abre **encuadrado**: ajusta la vista para que se vea el dibujo entero. Dos
  consecuencias:
  - **Lo más alto del dibujo queda pegado al borde superior de la vista**, donde
    flotan la barra de herramientas (al centro) y, debajo, un cartel de ayuda. No
    pongas ahí nada que haga falta leer: el **título** de un dibujo embebido va en la
    nota, no en el dibujo; si el dibujo va suelto, ponelo arriba a la **izquierda**
    y chico (28). Un **marco** no debería ser lo más alto: su nombre se dibuja
    **encima** del borde, en letra chica, y es lo primero que se tapa.
  - Cuanto más grande el dibujo, más chica se ve la letra (y lo mismo embebido en
    una nota, que lo escala al ancho de la nota). Más de ~2400 px de ancho ya no se
    lee: compactalo (ver «Organigrama compacto»).

  El origen ya no importa para verlo, pero **arrancá cerca de (80, 100)** y crecé
  hacia la derecha y hacia abajo: es la convención de las recetas y de quien lo
  edite después.
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
  quedar **adentro**: el marco **recorta** lo que sobresale de sus hijos.
  - Una **flecha que une dos formas del marco** es hija del marco: `frameId` en la
    flecha **y en su etiqueta**.
  - Una **flecha que cruza el borde** (de adentro hacia afuera) lleva
    `frameId: null`, y su etiqueta también. Con el `frameId` del marco, el tramo de
    afuera **no se ve**, ni la etiqueta si cae afuera.
  - El nombre se dibuja arriba del borde superior, por fuera: dejá ~30 px libres
    encima del marco.
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
6. **Nada encimado ni pegado**. Se mide entre **bordes**, no entre centros: dos
   formas tienen que estar a **≥ 60 px en horizontal o a ≥ 50 px en vertical**
   (basta una: o están en columnas distintas, o en filas distintas). Si la flecha que
   las une lleva **etiqueta**, a **≥ 120 px** entre bordes en la dirección de la
   flecha, y más si la etiqueta es larga: el tramo que la lleva tiene que medir la
   etiqueta + 40 px. Una forma puede contener **entera** a otra (una zona, una
   pantalla); pisarla a medias, no.
7. **El texto entra** en su forma (ver «Área útil»). Si no, agrandá la forma o partí
   la línea con `\n`.
8. **Conservá lo que no entendés**: al modificar, cargá el JSON, cambiá solo lo
   necesario y volvé a escribir todo lo demás tal cual (campos desconocidos
   incluidos, `files`, imágenes, `customData`).
9. **Escribilo de una vez y validalo** (ver «Verificar»).

## Geometría

### Coordenadas

- Coordenadas de **escena**, en píxeles: `x` crece hacia la derecha, **`y` hacia
  abajo**.
- El **centro** de una forma es `(x + width/2, y + height/2)`. Pensá la disposición
  en centros y derivá `x = cx − width/2`, `y = cy − height/2`.
- **Centros enteros y tamaños pares**: si el centro cae en `.5`, una flecha
  «horizontal» entre dos formas alineadas sale torcida medio píxel.
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
una par, el medio del tramo central. Con **un** punto intermedio y tramos rectos
(`roundness: null`) la etiqueta cae **en el codo**, y como Excalidraw corta la línea
donde va la etiqueta, el codo desaparece y la flecha parece rota. Si una flecha en L
lleva etiqueta, agregale un segundo punto intermedio **alineado** sobre el tramo
largo: con cuatro puntos, la etiqueta va al medio del tramo central.

### Disposiciones legibles

**Calculá el paso desde el tamaño real**, nunca con un número fijo: el centro de la
forma siguiente es el de la anterior + su medio tamaño + la separación + el medio
tamaño de la nueva (`tamanoPara` da el tamaño antes de crearla, y `junto` hace la
cuenta). Un paso fijo de «70 px» se encima en cuanto una etiqueta es más larga.

- **Flujo vertical**: una columna principal (mismo `cx`), cada paso debajo del
  anterior a 50 px entre bordes (120 si la flecha lleva etiqueta); las ramas
  laterales en otra columna; los retornos rodean por afuera con dos puntos
  intermedios.
- **Árbol / organigrama**: el ancho de cada subárbol es la suma de los anchos de
  sus hijos más 60 px entre hermanos; el padre va centrado sobre sus hijos. Si el
  último nivel tiene muchas hojas, el árbol se va a lo ancho: **apilá las hojas**
  debajo de su jefe (receta compacta).
- **Mapa mental**: la idea central al medio y las ramas **en dos columnas**, a la
  derecha y a la izquierda; cada rama ocupa una banda del alto de sus hojas, y las
  hojas van en otra columna más afuera. Las líneas, curvas y sin punta.
- **Arquitectura**: capas en columnas (cliente → servicios → datos) cada ~350 px;
  lo que comparte zona, en un `frame`.
- Nada debe cruzar una forma que no sea su origen o su destino: si pasa, mové
  formas o agregá puntos intermedios.

## El generador: `dibujo.mjs`

Calcular todo lo anterior a mano es donde se cometen los errores. Al lado de esta
skill está **`.claude/skills/mycelium-excalidraw/dibujo.mjs`**, un generador sin
dependencias que hace la geometría: tamaño de cada forma según su texto, extremos de
flecha sobre el borde, enlaces recíprocos, marcos y escritura atómica.

1. Copialo a un directorio temporal **fuera del vault** (`$TMPDIR`, `/tmp` o
   `%TEMP%`), y escribí ahí tu script, que lo importa con `./dibujo.mjs`:

   ```sh
   cp .claude/skills/mycelium-excalidraw/dibujo.mjs "$TMPDIR/"
   ```

2. Corré el script **desde la raíz del vault**, así las rutas que le pasás a
   `guardar` son relativas al vault:

   ```sh
   node "$TMPDIR/pedido.mjs"
   ```

No escribas scripts ni copias del generador dentro del vault: el usuario los vería
como archivos suyos.

| Llamada | Qué hace |
|---|---|
| `new Dibujo()` / `Dibujo.desde(ruta)` | Dibujo nuevo / uno existente, conservando todo lo que no toques |
| `d.caja(etiqueta, cx, cy, o)` | Forma con su etiqueta. `(cx, cy)` es el **centro** (se redondea a entero). Opciones: `forma` (`"rectangle"`, `"ellipse"`, `"diamond"`), `ancho`, `alto`, `fondo`, `borde`, `trazo`, `rugosidad`, `fontSize`, `fontFamily`, `color`. El tamaño sale del texto; **`ancho` y `alto` son mínimos**: la forma crece si el texto no entra |
| `d.junto(ref, lado, etiqueta, o)` | Forma nueva `"abajo"`, `"arriba"`, `"derecha"` o `"izquierda"` de `ref`, alineada con su centro y a `o.sep` px entre bordes (por defecto la regla 6: 50 en vertical, 60 en horizontal; pasá `sep: 120` si la flecha que las une lleva etiqueta). Mismas opciones que `caja` |
| `d.texto(t, x, y, o)` | Texto suelto; `(x, y)` es su esquina. Opciones: `fontSize`, `fontFamily`, `color`, `alinear` |
| `d.flecha(a, b, o)` | Flecha enganchada de `a` a `b` (formas o textos sueltos). Opciones: `etiqueta`, `via` (puntos intermedios absolutos `[{x, y}]`, tramos rectos), `curva` (con `via`, curva en vez de tramos rectos), `trazo`, `color`, `puntaFin`, `puntaInicio`, `fontFamily`. Si `a` y `b` están en el mismo marco, la flecha también |
| `d.trazar(flecha, via)` | Recalcula los extremos y recoloca la etiqueta. Con `via` nuevo, rehace el recorrido; sin él, conserva los puntos intermedios; `trazar(f, [])` la deja recta |
| `d.mover(forma o [formas], dx, dy)` | Mueve formas con su texto y reengancha sus flechas (ver «Modificar») |
| `d.reconectar(flecha, { desde, hasta, via })` | Cambia una punta (o las dos) a otra forma: binding, `boundElements` de la forma vieja y de la nueva, y el trazo (recto, salvo que pases `via`) |
| `d.borrar(forma)` | Borra la forma, su texto y sus flechas (con sus etiquetas), y limpia las referencias |
| `d.marco(nombre, formas, margen)` | Marco alrededor de las formas. Las flechas entre ellas, creadas antes o después, quedan adentro |
| `d.enMarco(marco, formas, margen)` / `d.encuadrar(marco, margen)` | Mete formas a un marco existente / lo ajusta a sus hijos. Los dos reasignan las flechas: adentro las que unen dos hijos, afuera las que cruzan el borde |
| `d.agrupar(formas)` | Grupo: se seleccionan y mueven juntas |
| `d.buscar(texto)` | La forma cuya etiqueta es `texto` (o el texto suelto). Ignora saltos de línea y espacios repetidos, y si no hay coincidencia exacta, mayúsculas. Si hay dos iguales, falla: usá `porId` |
| `d.porId(id)`, `d.textoDe(forma)`, `d.formas()`, `d.flechasEntre(a, b)`, `d.via(flecha)` | Consultas: elemento por id, la etiqueta de una forma o flecha, todas las formas, las flechas de `a` a `b`, los puntos intermedios absolutos de una flecha |
| `d.tocar(e)` | Marca un elemento como modificado (`version`, `versionNonce`, `updated`). Hacelo si cambiás un campo a mano |
| `d.guardar(ruta)` | Escribe el archivo de una vez (a un temporal y `rename`) |
| `tamanoPara(tipo, texto, fontSize, fontFamily)`, `medir(texto, …)`, `centro(f)`, `SEP_H`, `SEP_V` | Tamaño de una forma para un texto (antes de crearla), tamaño del texto solo, centro de una forma, separaciones de la regla 6 |

Con `caja` las etiquetas quedan adentro y con `flecha` los enlaces quedan
recíprocos y los extremos en el borde. **Lo que el generador no hace es la
disposición**: los centros los elegís vos, con las reglas de «Disposiciones».

## Recetas

Cada receta es un script que importa el generador. Todas pasan el validador sin
avisos y se comprobaron cargándolas en Excalidraw.

### Flujo con decisión (y un retorno)

```js
import { Dibujo, centro } from "./dibujo.mjs";
const d = new Dibujo();
d.texto("Proceso de pedido", 80, 60, { fontSize: 28 });           // solo si no va embebido: arriba a la izquierda
const ini = d.caja("Inicio", 300, 170, { forma: "ellipse", fondo: "#b2f2bb" });
const rec = d.junto(ini, "abajo", "Recibir pedido", { fondo: "#a5d8ff" });
const dec = d.junto(rec, "abajo", "¿Hay stock?", { forma: "diamond", fondo: "#ffec99" });
const env = d.junto(dec, "abajo", "Preparar envío", { fondo: "#a5d8ff", sep: 120 }); // su flecha lleva etiqueta
const fin = d.junto(env, "abajo", "Fin", { forma: "ellipse", fondo: "#ffc9c9" });
const pro = d.junto(dec, "derecha", "Pedir al\nproveedor", { fondo: "#d0bfff", sep: 160 });
d.flecha(ini, rec);
d.flecha(rec, dec);
d.flecha(dec, env, { etiqueta: "sí" });
d.flecha(env, fin);
d.flecha(dec, pro, { etiqueta: "no" });
// retorno: sale por la derecha, sube por afuera y entra a «Recibir pedido» por la derecha;
// dos puntos intermedios → la etiqueta cae en el tramo vertical, no en un codo
const cp = centro(pro), cr = centro(rec), xr = pro.x + pro.width + 60;
d.flecha(pro, rec, { via: [{ x: xr, y: cp.y }, { x: xr, y: cr.y }], trazo: "dashed", etiqueta: "cuando\nllega" });
d.guardar("Procesos/Pedido (flujo).excalidraw");
```

### Árbol u organigrama

```js
import { Dibujo, tamanoPara, SEP_H } from "./dibujo.mjs";
const d = new Dibujo();
const arbol = { t: "Dirección", h: [
  { t: "Producto", h: [{ t: "Diseño" }, { t: "Desarrollo" }] },
  { t: "Operaciones", h: [{ t: "Soporte" }, { t: "Finanzas" }, { t: "Personas" }] },
] };
const NIVEL = 140;                                   // entre centros de niveles: cajas de ~56 px + 84 de aire
const propio = (n) => tamanoPara("rectangle", n.t).w;
const hijos = (n) => (n.h ?? []).reduce((s, h) => s + ancho(h), 0) + SEP_H * ((n.h?.length ?? 1) - 1);
const ancho = (n) => Math.max(propio(n), n.h ? hijos(n) : 0);  // ancho del subárbol, entre bordes
function colocar(n, x0, nivel) {                      // x0 = borde izquierdo del subárbol
  const w = ancho(n);
  const f = d.caja(n.t, x0 + w / 2, 120 + nivel * NIVEL, { fondo: nivel ? "#e9ecef" : "#a5d8ff" });
  let x = x0 + (w - hijos(n)) / 2;
  for (const h of n.h ?? []) { d.flecha(f, colocar(h, x, nivel + 1)); x += ancho(h) + SEP_H; }
  return f;
}
colocar(arbol, 80, 0);
d.guardar("Equipo/Organigrama.excalidraw");
```

### Organigrama compacto (muchas hojas)

Con una docena de hojas en el último nivel, el árbol de arriba mide ~3000 px de
ancho y no se lee. Acá las hojas se **apilan** debajo de su jefe, colgadas de una
línea vertical, y los jefes cuelgan de un **bus** horizontal:

```js
import { Dibujo, tamanoPara, centro, SEP_H, SEP_V } from "./dibujo.mjs";
const d = new Dibujo();
const areas = [
  ["Producto", ["Diseño", "Desarrollo", "Calidad"]],
  ["Operaciones", ["Soporte", "Finanzas", "Personas", "Compras"]],
  ["Comercial", ["Ventas", "Marketing", "Alianzas", "Eventos"]],
];
const SANGRIA = 30;                                   // las hojas cuelgan 30 px a la derecha de la línea del jefe
const hoja = (t) => tamanoPara("rectangle", t, 16);
const cols = areas.map(([g, hs]) => {
  const wg = tamanoPara("rectangle", g).w, wh = Math.max(...hs.map((h) => hoja(h).w));
  return { g, hs, wh, izq: wg / 2, der: Math.max(wg / 2, SANGRIA + wh) }; // cuánto ocupa a cada lado de su centro
});
const total = cols.reduce((s, c) => s + c.izq + c.der, 0) + SEP_H * (cols.length - 1);
const raiz = d.caja("Dirección", 80 + total / 2, 120, { fondo: "#a5d8ff" });
const yG = 260, yBus = (raiz.y + raiz.height + yG - 28) / 2;          // el bus corre entre la raíz y los jefes
let x = 80;
for (const c of cols) {
  const cx = x + c.izq;
  const g = d.caja(c.g, cx, yG, { fondo: "#e9ecef" });
  d.flecha(raiz, g, { via: [{ x: centro(raiz).x, y: yBus }, { x: cx, y: yBus }] }); // bus ortogonal
  let y = g.y + g.height + SEP_V;
  for (const t of c.hs) {
    const hh = hoja(t).h;
    const f = d.caja(t, cx + SANGRIA + c.wh / 2, y + hh / 2, { fontSize: 16, ancho: c.wh });
    d.flecha(g, f, { via: [{ x: cx, y: y + hh / 2 }] }); // baja por la línea del jefe y entra por la izquierda
    y += hh + SEP_V;
  }
  x += c.izq + c.der + SEP_H;
}
d.guardar("Equipo/Organigrama compacto.excalidraw");
```

### Mapa mental

```js
import { Dibujo, tamanoPara, SEP_V } from "./dibujo.mjs";
const d = new Dibujo();
const ramas = [["Notas", ["Markdown", "Propiedades"]], ["Grafo", ["Hubs", "Huérfanas"]],
  ["Dibujos", ["Excalidraw", "draw.io"]], ["IA", ["Skills", "Memoria"]], ["Tablas", [".base"]]];
const colores = ["#a5d8ff", "#b2f2bb", "#ffc9c9", "#d0bfff", "#ffd8a8", "#c3fae8"];
const H = 100;                                                     // entre columnas: ≥ 60 y lugar para la curva
const tRama = (t) => tamanoPara("rectangle", t), tHoja = (t) => tamanoPara("rectangle", t, 16);
const altoHojas = (hs) => hs.reduce((s, h) => s + tHoja(h).h, 0) + SEP_V * (hs.length - 1);
const altoRama = ([r, hs]) => Math.max(tRama(r).h, altoHojas(hs));
const alto = (rs) => rs.reduce((s, r) => s + altoRama(r), 0) + SEP_V * (rs.length - 1);
const lados = [ramas.filter((_, i) => i % 2 === 0), ramas.filter((_, i) => i % 2 === 1)]; // derecha, izquierda
const wRama = Math.max(...ramas.map(([r]) => tRama(r).w));
const wHoja = Math.max(...ramas.flatMap(([, hs]) => hs.map((h) => tHoja(h).w)));
const wRaiz = tamanoPara("ellipse", "Mycelium", 28).w;
const C = { x: 80 + wHoja + H + wRama + H + wRaiz / 2, y: 100 + Math.max(...lados.map(alto)) / 2 };
const raiz = d.caja("Mycelium", C.x, C.y, { forma: "ellipse", fondo: "#ffec99", fontSize: 28 });
lados.forEach((rs, lado) => {
  const s = lado === 0 ? 1 : -1;
  const xR = C.x + s * (wRaiz / 2 + H + wRama / 2), xH = xR + s * (wRama / 2 + H + wHoja / 2);
  let y = C.y - alto(rs) / 2;                                      // borde superior de la banda de la rama
  for (const rama of rs) {
    const [nombre, hojas] = rama, a = altoRama(rama), cy = y + a / 2;
    const r = d.caja(nombre, xR, cy, { fondo: colores[ramas.indexOf(rama)], ancho: wRama });
    // curva que pasa por la mitad del hueco, a la altura de la rama, y entra de costado
    d.flecha(raiz, r, { puntaFin: null, curva: true, via: [{ x: xR - s * (wRama / 2 + H / 2), y: cy }] });
    let yh = cy - altoHojas(hojas) / 2;
    for (const t of hojas) {
      const hh = tHoja(t).h;
      const f = d.caja(t, xH, yh + hh / 2, { fontSize: 16, trazo: "dashed", ancho: wHoja });
      d.flecha(r, f, { puntaFin: null, curva: true, via: [{ x: xH - s * (wHoja / 2 + H / 2), y: yh + hh / 2 }] });
      yh += hh + SEP_V;
    }
    y += a + SEP_V;
  }
});
d.guardar("Mapas/Mycelium (mapa).excalidraw");
```

### Arquitectura: cajas, marco y flechas etiquetadas

```js
import { Dibujo } from "./dibujo.mjs";
const d = new Dibujo();
const tec = { rugosidad: 0, fontFamily: 6 };                        // trazo prolijo, letra Nunito
d.texto("Arquitectura del backend", 80, 60, { fontSize: 28, fontFamily: 6 }); // encima del marco, no al revés
const web = d.caja("Navegador", 160, 360, { ...tec, fondo: "#e9ecef" });
const api = d.caja("API REST", 520, 240, { ...tec, fondo: "#a5d8ff", ancho: 200 });
const auth = d.caja("Servicio de\nautenticación", 520, 480, { ...tec, fondo: "#d0bfff", ancho: 200 });
const db = d.caja("PostgreSQL", 880, 360, { ...tec, forma: "ellipse", fondo: "#b2f2bb" });
d.marco("Nube", [api, auth, db], 50);
d.flecha(web, api, { etiqueta: "HTTPS", fontFamily: 6 });           // cruza el borde: queda fuera del marco
d.flecha(api, auth, { etiqueta: "valida token", trazo: "dashed", fontFamily: 6 }); // adentro: va al marco
d.flecha(api, db, { etiqueta: "SQL", fontFamily: 6 });
d.flecha(auth, db);
d.agrupar([api, auth]);
d.guardar("Arquitectura/Backend (esquema).excalidraw");
```

### Boceto anotado (una pantalla con notas al margen)

```js
import { Dibujo } from "./dibujo.mjs";
const d = new Dibujo();
d.caja("", 320, 360, { ancho: 380, alto: 480, rugosidad: 2 });       // la pantalla contiene al resto
const barra = d.caja("Buscar…", 320, 180, { ancho: 300, alto: 50, fontSize: 16 });
d.caja("Resultados", 320, 340, { ancho: 300, alto: 170, fontSize: 16, fondo: "#e9ecef" });
const boton = d.caja("Guardar", 320, 530, { ancho: 140, alto: 50, fondo: "#a5d8ff", fontSize: 16 });
const n1 = d.texto("La búsqueda filtra\nmientras escribís", 620, 140, { color: "#e03131", fontSize: 16 });
const n2 = d.texto("Botón principal:\nun solo color fuerte", 620, 510, { color: "#e03131", fontSize: 16 });
d.flecha(n1, barra, { color: "#e03131" });                          // un texto suelto también se engancha
d.flecha(n2, boton, { color: "#e03131" });
d.guardar("Diseño/Pantalla de búsqueda.excalidraw");
```

## Leer y modificar un dibujo existente

**Leer**: el contenido son los `text` (`originalText`), y la estructura, las
flechas: `startBinding.elementId` → `endBinding.elementId`, resolviendo cada id a su
forma y cada forma a su texto (`boundElements` de tipo `text`). Ignorá lo que tenga
`isDeleted: true`.

**Modificar** con el generador, que conserva todo lo que no toca. Los ids nuevos
siguen la numeración de los que ya hay.

`mover` corre la forma, su texto y reengancha sus flechas. Con los **puntos
intermedios** de esas flechas hace esto:

- si las dos puntas de la flecha se mueven juntas (pasale un array de formas),
  corre todos los puntos lo mismo;
- si se mueve una sola punta, el punto intermedio **vecino** a esa punta copia el
  desplazamiento en el eje en que estaba **alineado** con el centro de la forma
  (mismo `x` o mismo `y`): un retorno con codos sigue siendo ortogonal;
- si el recorrido igual queda mal (la forma pasó al otro lado), rehacelo con
  `d.trazar(flecha, via)`.

### Insertar un paso entre A y B

```js
import { Dibujo, centro, tamanoPara } from "./dibujo.mjs";
const ruta = "Procesos/Pedido (flujo).excalidraw";
const d = Dibujo.desde(ruta);
const a = d.buscar("Recibir pedido"), b = d.buscar("¿Hay stock?");
const [f] = d.flechasEntre(a, b);
const hueco = b.y - (a.y + a.height);                                 // aire actual entre A y B (flujo vertical)
const h = tamanoPara("rectangle", "Validar pago").h;
// 1. correr hacia abajo todo lo que está debajo de A (sus flechas y retornos se reenganchan solos)
d.mover(d.formas().filter((x) => centro(x).y > centro(a).y), 0, h + hueco);
// 2. el paso nuevo, donde estaba B, con el mismo aire arriba y abajo
const v = d.caja("Validar pago", centro(a).x, a.y + a.height + hueco + h / 2, { fondo: "#a5d8ff" });
// 3. la flecha A→B pasa a ser A→nuevo (conserva su etiqueta, si tenía) y se agrega nuevo→B
d.reconectar(f, { hasta: v });
d.flecha(v, b);
d.guardar(ruta);
```

### Mover una forma y agregar otra a un marco

```js
import { Dibujo, centro } from "./dibujo.mjs";
const ruta = "Arquitectura/Backend (esquema).excalidraw";
const d = Dibujo.desde(ruta);
const db = d.buscar("PostgreSQL");                 // forma por el texto de su etiqueta
const api = d.buscar("API REST");
d.mover(db, 0, 140);                               // mueve su texto y reengancha sus flechas
const c = centro(db);
const redis = d.caja("Caché Redis", c.x, c.y - 260, { forma: "ellipse", fondo: "#ffc9c9", rugosidad: 0, fontFamily: 6 });
d.flecha(api, redis, { etiqueta: "lee", fontFamily: 6 });
const marco = d.elementos.find((e) => e.type === "frame" && e.name === "Nube");
d.enMarco(marco, [redis], 50);                     // la mete al marco, lo agranda y reasigna las flechas
d.guardar(ruta);
```

Qué arrastra cada cambio (lo hace el generador; si editás a mano, hacelo vos):

| Cambio | Además hay que… |
|---|---|
| Mover una forma | mover su texto lo mismo y **recalcular los extremos de cada flecha** de sus `boundElements` (y la posición de la etiqueta de esa flecha); correr los puntos intermedios que dependían de ella |
| Agrandar una forma | recentrar su texto y recalcular sus flechas |
| Cambiar una etiqueta | `text` y `originalText`, `width`/`height` del texto, recentrarlo, y agrandar la forma si no entra |
| Reconectar una flecha | sacarla de `boundElements` de la forma vieja, agregarla a la nueva, cambiar el binding y recalcular sus extremos |
| Borrar una forma | borrar su texto y sus flechas (con sus etiquetas), y **sacar esos ids** de los `boundElements` de las demás formas |
| Agregar o mover algo dentro de un marco | `frameId` en la forma, su texto y las flechas internas; agrandar el marco para que la abarque |
| Cualquier cambio | `version` + 1, `versionNonce` nuevo, `updated` = ahora |

Antes de agregar algo, buscá lugar libre: calculá la caja envolvente de lo
existente y ubicá lo nuevo respetando la regla 6, o corré las formas vecinas.

## Verificar

1. **Validá** cada archivo que escribiste:

   ```sh
   node .claude/skills/mycelium-excalidraw/validar-excalidraw.mjs "Procesos/Pedido.excalidraw"
   ```

   Comprueba el JSON y la forma del archivo, ids únicos, campos obligatorios por
   tipo, enlaces recíprocos (flecha↔forma, texto↔contenedor) y a elementos que
   existen, extremos de flecha sobre el borde de su forma, `points`, texto que no
   entra, formas encimadas o más juntas que la regla 6, etiquetas de flecha sin
   lugar o sobre un codo, hijos que se salen de su marco, flechas que atraviesan
   formas ajenas y dibujos demasiado grandes para leerse. Sale con código 1 si hay **errores**: corregilos todos. Los
   **avisos** son cosas que se ven mal pero no rompen; resolvelos salvo que sean
   deliberados. Acepta varias rutas o una carpeta.
2. **Repasá la disposición** con los números: ¿las filas y columnas están
   alineadas?, ¿hay algo importante arriba de todo, donde lo tapa la barra?, ¿el
   dibujo empieza cerca de (80, 100)?
3. Si el dibujo es para una nota, **embebelo** (`![[Nombre.excalidraw]]`, con un
   nombre que no tenga otro archivo) y decile al usuario dónde quedó.

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
| Parte de una flecha o su etiqueta no se ve | la flecha tiene el `frameId` de un marco y cruza su borde: el marco la recorta |
| El embed dice «No se pudo cargar el diagrama» | no hay dibujo con ese nombre, u otro archivo con el mismo nombre (una nota, otro diagrama) está más cerca de la raíz |
| El título o el nombre de un marco quedan tapados al abrir | son lo más alto del dibujo y caen bajo la barra de herramientas |
| Todo se ve diminuto | el dibujo es muy ancho, o hay algo perdido lejos del resto |
| Lo que dibujó el usuario se perdió | se escribió encima mientras la pestaña tenía cambios sin guardar |
