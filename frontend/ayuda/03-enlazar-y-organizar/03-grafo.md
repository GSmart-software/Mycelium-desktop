---
titulo: Grafo
tema: Enlazar y organizar
sinonimos: [conexiones, red, mapa, nodos, mini-grafo, grafo local]
---

El **grafo** dibuja tu vault como una red: cada nota es un punto y cada
[enlace](ayuda:enlazar-y-organizar/enlaces) es una línea entre dos puntos. Cuantas más
conexiones tiene una nota, más grande se ve.

## Para qué sirve

Para ver de un vistazo qué ideas son centrales, cuáles están aisladas y por dónde se
conectan dos temas que creías separados.

## Cómo se usa

1. Abrilo con el ícono **Grafo de conexiones** del rail, o con **Ctrl+P** → «Abrir el
   grafo de conexiones». Se abre como una pestaña más.
2. **Clic** en un punto abre esa nota. Pasá el mouse por encima para resaltar sus
   conexiones.
3. Arrastrá un punto para moverlo, arrastrá el fondo para desplazarte y usá la **rueda**
   para acercar o alejar.

## Opciones

El botón **Opciones del grafo** despliega:

| Opción | Qué hace |
|---|---|
| **Nombres** | Qué nombres se ven: **Todos**, **Vecinos** (el punto apuntado y los que conecta) o **Apuntado** (solo el que está bajo el mouse). Con **Todos**, cada nombre se acomoda al costado de su punto que no tape a otro, y al alejar mucho el zoom se desvanecen hasta que volvés a acercar. |
| **Indicador de dirección** | Cómo se ve hacia dónde va un enlace: **Ninguno**, **Animado**, **Flecha** o **Ambos**. |
| **Brillo de conexiones al apuntar** | Cuánto se iluminan las líneas del punto apuntado. |
| **Colores de nodos** | Reglas que pintan puntos por **Ruta**, **Etiqueta** o **Nombre**. |
| **Ocultar del grafo** | Reglas que esconden puntos por **Nombre**, **Ruta** o **Etiqueta**. |

Las reglas se pueden apagar sin borrarlas. El botón **Construcción temporal** rearma el
grafo en el orden en que se crearon las notas, día por día.

## El grafo de una nota

El panel de enlaces de cada nota (**Ctrl+Shift+\\**) tiene su pestaña **GRAFO**: la nota en
el centro, con lo que enlaza y lo que la enlaza. Los botones **Referencia** y **Lo
referencian** muestran u ocultan cada lado.

> [!tip] Si el grafo gasta mucho
> Por defecto los puntos dejan de moverse cuando el grafo se acomoda, para ahorrar
> procesador. **Configuración → Grafo → Simulación continua** los mantiene en movimiento,
> a costa de más consumo en vaults grandes.
