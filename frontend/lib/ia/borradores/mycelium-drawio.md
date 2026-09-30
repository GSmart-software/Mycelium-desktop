---
name: mycelium-drawio
description: Crear, leer y modificar diagramas de draw.io (.drawio, XML de mxGraph) que se vean bien en Mycelium — figuras, flechas enganchadas, contenedores, coordenadas y disposición sin cajas encimadas ni texto cortado. Usar cuando el usuario pida un diagrama de flujo, organigrama, modelo ER, arquitectura, red o UML, o al tocar un .drawio existente.
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
# Diagramas de draw.io en Mycelium

Un `.drawio` es un **diagrama formal**: figuras y conectores que se **enganchan**. Si el
usuario mueve una caja dentro de seis meses, las flechas la siguen. Mycelium lo abre en
una pestaña con el editor de draw.io embebido (v31.4.6, sin conexión) y lo muestra
dentro de una nota con `![[Nombre.drawio]]`.

Vos lo escribís **a mano**, como XML. Lo difícil no es poner cajas y texto: es que las
**flechas** salgan y entren por donde deben, que **nada se encime** y que **el texto
entre**. Esta skill es sobre eso.

## ¿draw.io, o mejor otra cosa?

| Herramienta | Cuándo |
|---|---|
| **Mermaid** (bloque ` ```mermaid ` en la nota) | Diagrama chico que vive en la nota y que nadie va a acomodar a mano: la disposición la calcula Mermaid y vos no tocás coordenadas. **Diagramas de secuencia: Mermaid**, salvo pedido explícito |
| **draw.io** | Diagrama que el usuario va a **retocar** y mantener: arquitectura, ER, organigrama, flujo largo, red, UML. O cuando pide draw.io |
| **Canvas** (`.canvas`) | Notas y textos del vault distribuidos en el espacio |
| **Excalidraw** | Boceto a mano alzada |

## Cómo lo trata Mycelium (comprobado con la app)

- **Guarda sin comprimir**, con sangría: `<mxfile><diagram><mxGraphModel>…`. Un archivo
  **comprimido** (el contenido de `<diagram>` es base64) se abre bien, y la primera vez
  que el usuario guarda queda sin comprimir. **Vos nunca escribas comprimido.**
- **Varias páginas**: un `<diagram>` por página; se conservan todas. Los ids pueden
  repetirse entre páginas, no dentro de una.
- **XML inválido = lienzo vacío.** Si el XML no se puede leer, draw.io muestra «No es un
  archivo de diagrama» y abre un diagrama **en blanco**; si el usuario guarda, **pisa el
  archivo y se pierde todo**. Por eso se valida siempre (abajo).
- Errores que draw.io **tapa en silencio**: un `id` repetido se renombra (y las flechas
  quedan en el primero); un `source`/`target` que no existe se borra (la flecha queda
  colgando). Nada avisa: por eso el validador.
- Un `.drawio` **no se indexa** ni aporta enlaces al grafo: un `[[…]]` adentro no crea
  una asociación. Para que el diagrama no quede huérfano, **embebelo o enlazalo desde una
  nota** (`![[Arquitectura.drawio]]`).
- Si el diagrama está abierto en una pestaña, Mycelium lo recarga al detectar tu cambio,
  salvo que el usuario tenga cambios sin guardar ahí. Si sabés que lo está editando,
  avisale antes de escribir.

## El esqueleto

```xml
<mxfile host="Mycelium">
  <diagram id="pagina-1" name="Página 1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="a" value="Recibir pedido" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="b" value="Preparar envío" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="140" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="a-b" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="a" target="b">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

| Pieza | Qué es |
|---|---|
| `mxCell id="0"` | La raíz. Sin `parent`. Siempre |
| `mxCell id="1" parent="0"` | La capa. Todo lo demás cuelga de ella (o de un contenedor) |
| **Vértice** | `vertex="1"` + `<mxGeometry x y width height as="geometry"/>` |
| **Arista** | `edge="1"` + `source` + `target` + `<mxGeometry relative="1" as="geometry"/>` |
| **Contenedor** | Un vértice del que cuelgan otros (`parent="id-del-contenedor"`) |
| `value` | El texto. Con `html=1` es HTML **escapado** |
| `style` | `clave=valor;` separados por `;`. Un nombre suelto (`rhombus;`, `swimlane;`, `text;`) aplica un estilo predefinido |

## Reglas de oro

1. **Siempre las celdas `0` y `1`**, y toda figura o arista con `parent`.
2. **Ids únicos y legibles**: `cobrar`, `capa-datos`, `e-cobrar-pago`. Nunca repetidos.
3. **Toda arista con `source` y `target` que existan y sean figuras**, y con su
   `<mxGeometry relative="1" as="geometry"/>`. Las aristas van con `parent="1"`, aunque
   unan figuras de contenedores distintos.
4. **Los hijos de un contenedor llevan `x`,`y` RELATIVAS al contenedor**, no absolutas.
   Es el error más común: una caja en (440,350) absoluta dentro de un contenedor en
   (400,300) se escribe `x="40" y="50"`.
5. **Escapá el XML**: `&` → `&amp;`, `<` → `&lt;`, `"` → `&quot;`. Con `html=1` el valor
   es HTML dentro de un atributo: negrita `&lt;b&gt;Ana&lt;/b&gt;`, salto `&lt;br&gt;`. Un
   salto también puede ir como `&#xa;`. Nada de `&nbsp;` suelto (va `&amp;nbsp;`).
6. **Sin comprimir**, UTF-8, sin BOM.
7. **Modificar no es reescribir**: cambiá lo necesario con ediciones puntuales y
   **conservá** lo que no entiendas (páginas, `<object>`/`<UserObject>`, estilos raros,
   capas, atributos). Otra herramienta o el usuario pusieron eso ahí por algo.
8. **Validá** antes de dar por terminado (ver el final). Cero errores.

## Geometría: el espacio donde vive el diagrama

- **Origen arriba a la izquierda, `y` crece hacia abajo.** Unidades en px a zoom 100 %.
- **`x`,`y` son la esquina superior izquierda** de la caja, no su centro.
  Centro = `(x + width/2, y + height/2)`. Para alinear dos cajas de anchos distintos en
  una columna, alineá los **centros**: `x = centroColumna − width/2`.
- **Grilla de 10**: usá múltiplos de 10 para posiciones y tamaños.
- Empezá en `x=40, y=40`. Nada negativo.

### Tamaños

| Figura | Estilo | Tamaño base |
|---|---|---|
| Proceso / caja | `rounded=1;whiteSpace=wrap;html=1;` | 160 × 60 (mín. 120 × 40) |
| Decisión | `rhombus;whiteSpace=wrap;html=1;` | 180 × 90 |
| Inicio / fin | `ellipse;whiteSpace=wrap;html=1;` | 120 × 50 |
| Base de datos | `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;` | 160 × 80 |
| Contenedor con título | `swimlane;startSize=30;html=1;whiteSpace=wrap;align=left;spacingLeft=10;` | lo que ocupen sus hijos + 40 de margen; título de 30 |
| Tabla ER | ver receta 3 | 220 de ancho; 30 de título + 26 por fila |

**El texto tiene que entrar.** A `fontSize` 12 (el default) calculá **~7 px por
carácter** más 20 de margen, y **cada línea mide 18 px** de alto:

- Ancho: `width = redondearA10(max(120, caracteres × 7 + 20))`.
- Si pasa de ~200, **no ensanches más**: dejá `width` en 160–200 con `whiteSpace=wrap`
  y subí el alto: `height = max(60, líneas × 18 + 24)`.
- **Sin `whiteSpace=wrap` el texto no se parte** y se sale por los costados. Ponelo
  siempre (salvo en `text;`).
- **Rombo**: el texto se parte al ancho de la caja pero el rombo es más angosto arriba y
  abajo; necesita **~2× el ancho del texto** y el texto en una o dos líneas cortas
  («¿Hay stock?», no «¿El cliente tiene deuda pendiente con la empresa?»).
- Figuras chicas (actor, evento, ícono): poné la etiqueta **afuera**:
  `verticalLabelPosition=bottom;verticalAlign=top;` y dejá 30 px libres debajo.
- Con `fontStyle=1` (negrita) sumá un 10 %.

### Separación

| Entre | Mínimo |
|---|---|
| Cajas consecutivas de un flujo (vertical) | 40 |
| Si la flecha lleva etiqueta («Sí», «REST») | 60 |
| Hermanos en un árbol (horizontal) | 20; entre subárboles, 40 |
| Columnas de un flujo | 80 (lugar para la flecha y su etiqueta) |
| Contenedores entre sí | 40 |
| Hijo y borde de su contenedor | 20 (y debajo del título: `y ≥ startSize + 20`) |

### Flechas: cómo salen, por dónde van y dónde entran

Con `edgeStyle=orthogonalEdgeStyle` las flechas van en tramos horizontales y
verticales. Lo que hace draw.io (comprobado):

- **Cajas alineadas** (una debajo de otra con los centros en la misma columna, o una al
  lado de otra en la misma fila) y sin puertos → **recta**.
- **Puertos** — fracciones de la caja, de 0 a 1 — fijan por dónde sale y entra:

  | Lado | Salida | Entrada |
  |---|---|---|
  | Abajo, centro | `exitX=0.5;exitY=1;` | `entryX=0.5;entryY=1;` |
  | Arriba, centro | `exitX=0.5;exitY=0;` | `entryX=0.5;entryY=0;` |
  | Derecha | `exitX=1;exitY=0.5;` | `entryX=1;entryY=0.5;` |
  | Izquierda | `exitX=0;exitY=0.5;` | `entryX=0;entryY=0.5;` |

  Sumá `exitDx=0;exitDy=0;` / `entryDx=0;entryDy=0;` al lado de cada par.
- Salida y entrada verticales (abajo → arriba) → forma de **Z**: baja, cruza en
  horizontal **a mitad de camino** entre las dos cajas, y baja. Salida vertical y
  entrada horizontal → forma de **L**.
- **draw.io NO esquiva obstáculos.** Si hay una caja en el camino, la flecha pasa por
  encima. Lo resolvés vos: moviendo cajas o con **waypoints**:

  ```xml
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="700" y="275" />
      <mxPoint x="700" y="715" />
    </Array>
  </mxGeometry>
  ```

  Los puntos son **absolutos** (porque la arista cuelga de `"1"`). Para rodear, elegí un
  **pasillo libre**: una `x` 60 px a la derecha de la caja más ancha, o una `y` entre dos
  filas.
- **Fijá puertos cuando**: sale más de una flecha de la misma caja (ramas de una
  decisión), una flecha vuelve hacia atrás (bucles), llegan varias al mismo lado (repartí
  las entradas: `entryX=0.3` y `entryX=0.7`, para que no se encimen las puntas), o es un
  árbol. Entre dos cajas alineadas, no hacen falta.
- **Etiqueta de flecha**: el `value` de la arista (va al medio del recorrido). Corta:
  «Sí», «No», «REST», «1..N». Dejá al menos 40 px de tramo para que se lea.
- Puntas: `endArrow=block;endFill=1;` (proceso), `endArrow=none;` (jerarquía),
  `dashed=1;` (dependencia débil / asíncrono).

## Procedimiento: calcular la disposición antes de escribir

No escribas XML «a ojo». Calculá primero, en este orden:

1. **Listá nodos y aristas.** Decidí la forma: **flujo** (un camino principal y ramas),
   **árbol** (jerarquía), **capas** (contenedores apilados) o **red** (grafo general:
   tratalo como capas por distancia al nodo central).
2. **Medí cada caja** con la regla de texto de arriba. Dentro de una misma fila o
   columna, usá **el mismo tamaño** (el mayor): se ve ordenado y alinea las flechas.
3. **Asigná rangos**: flujo → número de paso por el camino principal; árbol →
   profundidad; capas → la capa.
4. **Ordená dentro de cada rango** siguiendo el orden de los padres (así no se cruzan
   las flechas). En un flujo, el **camino feliz va en una sola columna recta** y las
   ramas alternativas a la derecha.
5. **Coordenadas**:
   - `y` de cada rango = `y` del anterior + su alto máximo + separación.
   - `x` por columnas: `x = centroColumna − width/2`.
   - **Árbol** (de abajo hacia arriba): las hojas de un padre, lado a lado con 20 entre
     sí; cada subárbol separado 40 del siguiente; cada padre **centrado sobre sus hijos**:
     `centro = (centro del primer hijo + centro del último) / 2`.
   - **Árbol muy ancho** (más de ~6 hojas bajo un padre, o el total pasa de ~1600 px):
     apilá esas hojas en vertical debajo del padre: `x = centroDelPadre + 30`, la
     primera 30 debajo del padre, cajas de 40 de alto separadas 20, flechas
     `exitX=0.5;exitY=1` → `entryX=0;entryY=0.5` con `endArrow=none`. Queda un tronco
     vertical con ramas a cada hoja.
6. **Flechas**: elegí puertos según la dirección. Para cada flecha que no una vecinos
   inmediatos, **recorré su camino** (recta, Z o L según lo de arriba) y comprobá que no
   pase sobre otra caja. Si pasa, waypoints por un pasillo libre.
7. **Escribí** en orden: contenedores, figuras, aristas al final.
8. **Validá** y corregí hasta cero errores.

> [!tip] Un ejemplo del paso 5 (organigrama de 12)
> Hojas de 160 con 20 entre sí: Tecnología tiene 3 → ocupan x 40…560, centro 300, su
> gerente va en `x = 300 − 80 = 220`. Comercial (2 hojas) arranca 40 después: x 600…940,
> centro 770. Operaciones (3): x 980…1500, centro 1240. La directora va centrada sobre
> sus gerentes: `(300 + 1240) / 2 = 770` → `x = 690`. Filas en y = 40, 160, 280.

## Recetas (probadas en el draw.io de Mycelium)

### 1. Flujo con decisión y bucle

Camino feliz en la columna de centro 300; las ramas «No» a la derecha (centro 560),
alineadas con su rombo. Lo esencial:

```xml
<mxCell id="stock" value="¿Hay stock?" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
  <mxGeometry x="210" y="230" width="180" height="90" as="geometry" />
</mxCell>
<mxCell id="cobrar" value="Cobrar al cliente" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="220" y="360" width="160" height="60" as="geometry" />
</mxCell>
<mxCell id="sinStock" value="Avisar: sin stock" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="480" y="245" width="160" height="60" as="geometry" />
</mxCell>
<!-- Rama "Sí": recta hacia abajo (centros alineados, sin puertos). -->
<mxCell id="e-si" value="Sí" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="stock" target="cobrar">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
<!-- Rama "No": sale por la derecha del rombo, entra por la izquierda. -->
<mxCell id="e-no" value="No" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="stock" target="sinStock">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
<!-- Bucle hacia atrás: sale por arriba de la caja lateral y entra por la DERECHA del paso anterior. -->
<mxCell id="e-reintento" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;" edge="1" parent="1" source="medio" target="cobrar">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

- Inicio y fin: `ellipse` de 120 × 50, con `x = 300 − 60`.
- Una rama lateral que tiene que bajar hasta el final **rodea** por un pasillo a la
  derecha de todo (`x = 700`) con dos waypoints, en vez de pasar por encima de otra
  caja lateral.
- Colores habituales: decisión `#fff2cc/#d6b656`, inicio `#d5e8d4/#82b366`, fin
  `#f8cecc/#b85450`.

### 2. Organigrama / árbol

Posiciones con el paso 5 del procedimiento. Nombre y cargo en dos líneas:

```xml
<mxCell id="tec" value="&lt;b&gt;Laura Gómez&lt;/b&gt;&lt;br&gt;Tecnología" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
  <mxGeometry x="220" y="160" width="160" height="60" as="geometry" />
</mxCell>
<mxCell id="e-tec-back" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="tec" target="back">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

Todas las aristas iguales: de abajo del jefe a arriba del subordinado. El tramo
horizontal cae a mitad de camino entre niveles y las de un mismo jefe se funden en un
solo «peine». Un color por nivel (`#dae8fc`, `#d5e8d4`, `#fff2cc`).

### 3. Modelo entidad-relación

Cada tabla es un `swimlane` con `stackLayout`; cada campo, una fila hija de 26 de alto
con `x` omitida (= 0), `y` = 30, 56, 82… y el ancho de la tabla. Alto de la tabla =
`30 + 26 × filas`. Tablas en fila, separadas 80, para que las relaciones vayan de costado.

```xml
<mxCell id="cliente" value="Cliente" style="swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=30;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="220" height="108" as="geometry" />
</mxCell>
<mxCell id="cliente-id" value="PK  id_cliente: INT" style="text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=4;spacingRight=4;overflow=hidden;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;rotatable=0;whiteSpace=wrap;html=1;fontStyle=1;" vertex="1" parent="cliente">
  <mxGeometry y="30" width="220" height="26" as="geometry" />
</mxCell>
<!-- …una fila por campo… -->
<!-- Relación: de la fila PK (lado "uno") a la fila FK (lado "muchos"). -->
<mxCell id="r-cliente-pedido" style="edgeStyle=entityRelationEdgeStyle;fontSize=12;html=1;endArrow=ERzeroToMany;startArrow=ERmandOne;endFill=0;startFill=0;" edge="1" parent="1" source="cliente-id" target="pedido-cliente">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

| Cardinalidad | Punta |
|---|---|
| exactamente uno | `ERmandOne` |
| cero o uno | `ERzeroToOne` |
| uno o muchos | `ERoneToMany` |
| cero o muchos | `ERzeroToMany` |
| muchos (sin precisar) | `ERmany` |

`startArrow` es la punta junto al `source`, `endArrow` la del `target`. Las relaciones
enganchan **filas**, no tablas: así la línea sale a la altura del campo. Una N:M lleva su
tabla intermedia (ponela **entre** las dos que une). Si una relación tuviera que cruzar
una tabla intermedia, reordená las tablas en vez de cruzarla.

### 4. Arquitectura por capas (contenedores)

Una capa = un `swimlane` ancho; sus componentes, hijos con coordenadas **relativas**.
Las aristas entre capas cuelgan de `"1"`.

```xml
<mxCell id="capa-serv" value="Capa de servicios" style="swimlane;startSize=30;html=1;whiteSpace=wrap;fillColor=#f5f5f5;strokeColor=#666666;fontStyle=1;align=left;spacingLeft=10;" vertex="1" parent="1">
  <mxGeometry x="40" y="210" width="760" height="130" as="geometry" />
</mxCell>
<mxCell id="gateway" value="API Gateway" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="capa-serv">
  <mxGeometry x="300" y="50" width="160" height="60" as="geometry" />
</mxCell>
<mxCell id="e-web" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.3;entryY=0;entryDx=0;entryDy=0;" edge="1" parent="1" source="web" target="gateway">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

- **Título alineado a la izquierda** (`align=left;spacingLeft=10;`): las flechas que
  cruzan el encabezado por el medio **tachan un título centrado**.
- Capas de 130 de alto (título 30 + margen 20 + caja 60 + margen 20), separadas 40: el
  codo de las flechas cae en ese hueco.
- Alineá cada componente con el de la capa de abajo con el que se habla: la flecha
  queda recta.

### Otras formas (verificadas)

| Qué | Estilo |
|---|---|
| Actor | `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;` (30 × 60) |
| Documento | `shape=document;whiteSpace=wrap;html=1;boundedLbl=1;` |
| Entrada/salida de datos | `shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;` |
| Subproceso | `shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;` |
| Nota | `shape=note;whiteSpace=wrap;html=1;size=14;` |
| Nube / sistema externo | `ellipse;shape=cloud;whiteSpace=wrap;html=1;` |
| Terminador (píldora) | `rounded=1;whiteSpace=wrap;html=1;arcSize=50;` |
| Carpeta / paquete | `shape=folder;fontStyle=1;tabWidth=80;tabHeight=20;tabPosition=left;html=1;boundedLbl=1;whiteSpace=wrap;` |
| Texto suelto | `text;html=1;align=center;verticalAlign=middle;` |
| Grupo invisible | `group;` (sus hijos, relativos; sin título) |

## Leer y modificar un diagrama existente

1. **Leelo entero.** Si `<diagram>` tiene texto en base64 en vez de `<mxGraphModel>`,
   está comprimido; para verlo:

   ```sh
   node -e "const z=require('zlib'),fs=require('fs');for(const m of fs.readFileSync(process.argv[1],'utf8').matchAll(/<diagram[^>]*>([^<]+)<\/diagram>/g))console.log(decodeURIComponent(z.inflateRawSync(Buffer.from(m[1].trim(),'base64')).toString()))" archivo.drawio
   ```

   Si tenés que modificarlo, reescribí esa página **sin comprimir** (con el XML de
   arriba dentro de `<diagram>`), conservando el `id` y el `name` de la página.
2. **Mirá el mapa**: `node .claude/skills/mycelium-drawio/validar-drawio.mjs --mapa archivo.drawio` lista cada figura con su
   posición **absoluta**, su tamaño, su contenedor (y la posición relativa que va en el
   XML), las aristas, y el lugar libre del diagrama.
3. **Agregar** una figura: seguí el patrón de sus vecinos — mismo tamaño, **mismo
   `style` copiado**, misma separación, en la fila o columna que le corresponde. Si no
   hay lugar, **corré** lo que está a la derecha o debajo: sumá el mismo Δ a su `x` o `y`
   (solo a las figuras de primer nivel; los hijos viajan con su contenedor) y a los
   waypoints de las aristas afectadas. Si agregás un hijo a un árbol, recalculá ese
   subárbol y recentrá a su padre.
4. **Editá con cambios puntuales** (reemplazar una celda, insertar otra antes de
   `</root>`), no regenerando el archivo: lo que no tocás queda idéntico. Antes de
   inventar un id, buscá que no exista: `grep -c 'id="nuevo-id"' archivo.drawio`.
5. **Borrar** una figura es borrar también sus aristas (`grep -n 'source="x"\|target="x"'`)
   y, si es contenedor, sus hijos.
6. **Validá**, y compará el número de figuras y aristas antes y después: tiene que haber
   cambiado solo lo que pediste.

## Verificar

```sh
node .claude/skills/mycelium-drawio/validar-drawio.mjs archivo.drawio
```

Sale con código ≠ 0 si hay **errores**. Lo que te dice y cómo se arregla:

| Código | Arreglo |
|---|---|
| `xml-malformado` | Mirá línea y columna: casi siempre un `&`, `<` o `"` sin escapar, o una etiqueta sin cerrar |
| `sin-celda-raiz`, `sin-capa`, `parent-inexistente` | Faltan `0`/`1`, o un `parent` apunta a un id que no existe |
| `id-duplicado` | Renombrá uno (y las aristas que lo usan) |
| `arista-extremo-inexistente`, `arista-sin-extremo` | `source`/`target` con un typo o faltante |
| `superposicion` | Dos hermanas se pisan: recalculá posiciones con las separaciones de arriba |
| `encima-sin-ser-hijo` | Una caja está dibujada dentro de otra sin ser su hija: hacela hija (`parent` + coordenadas relativas) o sacala |
| `fuera-del-contenedor` | Un hijo con coordenadas absolutas, o un contenedor chico: pasá a relativas o agrandalo |
| `texto-no-cabe` | Agrandá la caja (regla de 7 px/carácter), poné `whiteSpace=wrap`, o acortá el texto |
| aviso `arista-atraviesa` | La flecha pasa sobre otra caja: puertos, waypoints por un pasillo libre, o mové cajas |
| aviso `arista-tacha-titulo` | Cruza un título centrado: `align=left;spacingLeft=10;` en el contenedor |
| aviso `tapa-encabezado` | Un hijo arranca sobre el título: `y ≥ startSize` (mejor `startSize + 20`) |
| aviso `coordenadas-negativas`, `muy-lejos` | Llevá todo a partir de (40, 40) |
| aviso `pagina-comprimida` | Solo informa; si la modificás, escribila sin comprimir |

**Cero errores** siempre. Los avisos se corrigen, salvo que tengas un motivo (y
entonces decíselo al usuario). El validador **estima** el texto y los recorridos: no ve el
dibujo. Si el usuario dice que algo se ve mal, creele a él.

Sin Node a mano, revisá a mano: `0` y `1`; ids únicos (`grep -o 'id="[^"]*"' | sort |
uniq -d` no imprime nada); cada `source`/`target` existe; ningún rectángulo de hermanas
se solapa; cada texto entra según la regla de 7 px.
