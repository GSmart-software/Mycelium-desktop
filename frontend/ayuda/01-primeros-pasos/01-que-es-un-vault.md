---
titulo: Qué es un vault
tema: Primeros pasos
sinonimos: [bóveda, carpeta, empezar, inicio, introducción]
---

Un **vault** es una carpeta de tu computadora que Mycelium abre como tu red de notas. No
hay una base de datos escondida ni un formato propio: cada nota es un archivo `.md`, texto
plano en Markdown, que podés abrir con cualquier otro programa, copiar o respaldar como
cualquier archivo.

## Para qué sirve

Todo lo que escribís vive ahí: notas, dibujos, lienzos, diagramas e imágenes. Mycelium lee
la carpeta, arma un índice para buscar al instante y dibuja las conexiones entre tus notas.
Si algún día dejás de usar Mycelium, tus notas siguen siendo tuyas y legibles.

## Cómo se usa

1. Al abrir Mycelium, elegí una carpeta: una vacía para empezar de cero o una que ya tenga
   notas, como una que usabas con Obsidian.
2. Creá una nota con **Ctrl+P** → «Nueva nota», o desde el explorador. El
   nombre del archivo es su título: [cambiar uno cambia el otro](ayuda:escribir-notas/el-titulo-renombra).
3. Enlazá notas escribiendo `[[` y el título de otra. Esos enlaces son la red.

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

> [!tip] Un vault por tema de tu vida
> Podés tener varios (trabajo, estudio, personal) y abrir cada uno en su propia ventana.
