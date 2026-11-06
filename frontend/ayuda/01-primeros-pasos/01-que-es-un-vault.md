---
titulo: Qué es un vault
tema: Primeros pasos
sinonimos: [bóveda, carpeta, empezar, inicio, introducción, índice, reconstruir el índice, reindexar]
---

Un **vault** es una carpeta de tu computadora que Mycelium abre como tu red de notas. No
hay una base de datos escondida ni un formato propio: cada nota es un archivo `.md`, texto
plano en Markdown, que puedes abrir con cualquier otro programa, copiar o respaldar como
cualquier archivo.

## Para qué sirve

Todo lo que escribes vive ahí: notas, dibujos, lienzos, diagramas e imágenes. Mycelium lee
la carpeta, arma un índice para buscar al instante y dibuja las conexiones entre tus notas.
Si algún día dejas de usar Mycelium, tus notas siguen siendo tuyas y legibles.

## Cómo se usa

1. Al abrir Mycelium, elige una carpeta: una vacía para empezar de cero o una que ya tenga
   notas, como una que usabas con Obsidian.
2. Crea una nota con **{{atajo:nota.nueva|Ctrl+N}}**, con **Ctrl+P** → «Nueva nota» o desde el explorador. El
   nombre del archivo es su título: [cambiar uno cambia el otro](ayuda:escribir-notas/el-titulo-renombra).
3. Enlaza notas escribiendo `[[` y el título de otra. Esos enlaces son la red.

```ejemplo
Hoy hablé con Ana sobre el [[Proyecto Faro]]. #reunión
```

## Qué hay en la carpeta

| En la carpeta | Qué es |
|---|---|
| `Algo.md` | Una nota. Su nombre es su título. |
| `.base`, `.canvas`, `.excalidraw`, `.drawio` | Tablas, lienzos, dibujos y diagramas. |
| PDF, imágenes y otros | Se abren en el visor, pero no entran en la búsqueda. |
| `.mycelium/` | Lo que Mycelium guarda para sí: el índice, la papelera, el calendario y las preferencias del vault. |

> [!warning] No toques `.mycelium/`
> Es interno. Borrarlo no pierde tus notas, pero sí la papelera y los recordatorios.

## Reconstruir el índice

El índice es una copia de las notas que Mycelium arma para buscar, dibujar el grafo y
resolver los enlaces. Si alguna vez la búsqueda o el grafo muestran algo que no coincide
con los archivos, se puede armar de nuevo:

1. Abre **Configuración → Vault** y, en «Índice del vault», pulsa **Reconstruir el
   índice…**.
2. Confirma el aviso. El botón muestra cuántas notas lleva leídas.

No se pierde ninguna nota: el índice se arma a partir de los archivos. Los snippets, la
apariencia, las preferencias y la papelera viven en `.mycelium/` y no se tocan. En un
vault grande puede tardar varios minutos, y mientras tanto la búsqueda y el grafo pueden
verse incompletos. Solo afecta al vault de esa ventana.

## Si un archivo cambia por fuera

Cuando otro programa —otro editor, la IA, una sincronización— cambia una nota que tienes
abierta, Mycelium la recarga sola con lo nuevo.

Si justo tenías **cambios sin guardar** en esa nota, no recarga ni guarda encima: aparece
una barra arriba de la nota, «El archivo cambió fuera de Mycelium», y eliges tú:

| Opción | Qué hace |
|---|---|
| **Ver lo de afuera** | Descarta lo tuyo y muestra lo que tiene el archivo. Te pide confirmar, y Ctrl+Z lo trae de vuelta. |
| **Quedarme con lo mío** | Guarda lo tuyo encima de lo de afuera. |
| **Guardar lo mío como copia** | Lo tuyo va a una nota nueva, «Título (copia local)», y en esta queda lo de afuera. |

Mientras no se elija, se puede seguir escribiendo, pero esa nota no se guarda: la barra de
estado dice «Sin guardar: conflicto». Y lo escrito no se pierde sin preguntar: cerrar la
pestaña, ir atrás o adelante en ella o salir del vault ofrece antes guardar lo tuyo como copia.
Si la pestaña se va sin que se pueda preguntar —la IA borra la nota, o el archivo desaparece
de afuera—, la copia se guarda sola y Mycelium avisa dónde quedó. Al cerrar la ventana, lo
tuyo va a un archivo al lado de la nota, «Título (copia local fecha hora)».

> [!tip] Un vault por tema de tu vida
> Puedes tener varios (trabajo, estudio, personal) y abrir cada uno en su propia ventana.
