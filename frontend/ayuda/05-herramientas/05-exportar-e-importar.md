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
`.zip`. Se respeta la estructura de carpetas y entran las notas, las imágenes, los PDF y
cualquier otro archivo.

Si un archivo ya existe con ese nombre en la carpeta de destino, Mycelium pregunta uno por
uno: **Renombrar**, **Reemplazar** o **Cancelar este archivo**.

### Lo que nunca se importa

- **Todo lo oculto**: cualquier archivo o carpeta cuyo nombre empiece con un punto, en
  cualquier nivel. Por ejemplo `.obsidian/`, `.git/`, `.claude/`, `.vscode/`, `.mcp.json`,
  `.env`, `.mycignore` o el `.mycelium/` de otro vault. Es la configuración de otras
  herramientas, y parte de ella puede ejecutar programas en tu equipo.
- **Las carpetas de dependencias y de compilación**: `node_modules/`, `target/`, `dist/` y
  `out/`.

Esto no cambia aunque lo que importás traiga su propio `.mycignore`: lo que dice ese
archivo no se aplica.

### El aviso al terminar

Al terminar aparece un resumen con lo que se importó, lo que se omitió agrupado (por ejemplo
«No se importó: .claude/, .git/ y 3 archivos ocultos») y, si entre lo copiado hay
instrucciones para asistentes de IA (`CLAUDE.md`, `AGENTS.md` y sus variantes), la lista de
esos archivos. Se importan porque son notas, pero un asistente que abra el vault las sigue:
leelos antes de usarlo.

> [!info] Un `.zip` bajado de internet sigue marcado como descargado
> En Windows, cada archivo que sale de un `.zip` descargado conserva la marca de «descargado
> de internet» del zip. Así Office abre un documento importado en la Vista protegida, como
> si lo hubieras bajado directamente.

> [!tip] Con la app de escritorio no hace falta importar
> Tu vault de Obsidian ya es una carpeta: podés abrirlo directamente como vault de
> Mycelium, sin copiar nada.
