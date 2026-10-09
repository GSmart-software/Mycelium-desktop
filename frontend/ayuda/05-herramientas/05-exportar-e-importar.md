---
titulo: Exportar e importar
tema: Herramientas
sinonimos: [pdf, respaldo, backup, obsidian, zip, markdown, migrar, imprimir]
---

**Exportar** saca una nota o el vault entero de Mycelium: una nota como Markdown o como PDF,
y el vault como ZIP. **Importar** trae notas de afuera, por ejemplo un vault de Obsidian.

## Para qué sirve

Para compartir una nota con alguien que no usa Mycelium, imprimirla, hacer un respaldo del
vault o mudarte desde Obsidian sin perder la estructura de carpetas.

## Exportar una nota

1. Abrí el menú **Más opciones** (los tres puntos de la barra del editor), o hacé clic
   derecho en la nota en el explorador.
2. Elegí **Exportar como .md** para el archivo de texto tal cual, o **Exportar como PDF…**.
3. Para el PDF, elegí el tamaño de página (**A4** o **Letter**) y cómo se ve:

| Opción | Qué hace |
|---|---|
| **Fondo blanco** | Texto negro sobre blanco. Sin ella, usa el fondo del tema. |
| **Incluir colores del texto** | Conserva los colores de enlaces, etiquetas y énfasis. |
| **Estilar callouts** | Los callouts salen como cajas; si no, como cita simple. |
| **Estilos de Mycelium** | La tipografía de Mycelium; si no, un documento plano. |

## Exportar el vault

En Configuración → **Vault** → **Exportar**: **Exportar vault como ZIP** guarda todas las
notas con su estructura de carpetas en un solo archivo. En la app de escritorio también
está **Exportar a carpeta…**, útil para tenerlo en git o en una carpeta sincronizada.

## Importar

En Configuración → **Vault** → **Importar vault de Obsidian**, elegí una carpeta o un
`.zip`. Se respeta la estructura de carpetas y se deja afuera la configuración de Obsidian
(`.obsidian/`).

Si un archivo ya existe con ese nombre en la carpeta de destino, Mycelium pregunta uno por
uno: **Renombrar**, **Reemplazar** o **Cancelar este archivo**.

> [!tip] Con la app de escritorio no hace falta importar
> Tu vault de Obsidian ya es una carpeta: podés abrirlo directamente como vault de
> Mycelium, sin copiar nada.
