## Épica: Editor Markdown

### HU-01 · Vista previa en tiempo real (3 SP, alta)
Como usuario, quiero ver la vista previa renderizada mientras escribo, para no alternar
entre modos para verificar el formato.

**Contexto:** Área central del workspace — pane del editor (modos `live`, `split`, `read`).

#### Criterios de aceptación
1. En modo `live`: el documento se muestra renderizado (HTML). Solo la línea donde está el cursor muestra el markdown crudo; el resto permanece renderizado.
2. Al mover el cursor a una línea diferente, la anterior vuelve a renderizarse inmediatamente (sin debounce).
3. La vista previa se actualiza con un debounce de 100–150 ms tras cada cambio de contenido para evitar re-renders innecesarios.
4. Documentos de más de 10.000 palabras se editan sin bloquear el hilo principal, gracias a la virtualización de viewport de CodeMirror 6.
5. Los encabezados (`# H1`, `## H2`, etc.) se renderizan como `<h1>`, `<h2>` etc. con los estilos de `.mic-preview`. El cursor en esa línea revela el `#` crudo.
6. El texto en negritas (`**texto**`), cursiva (`*texto*`) y tachado (`~~texto~~`) se renderiza inline en todas las líneas excepto la activa.
7. El código inline (`` `code` ``) se renderiza con `font-family: var(--mic-font-mono)` y `background: var(--mic-bg-code)`.
8. Los enlaces internos `[[nombre-nota]]` se renderizan como links con `color: var(--mic-accent)`. Al hacer clic navegan a esa nota sin recargar la página.
9. Los tags `#etiqueta` se renderizan como píldoras con `background: color-mix(in srgb, var(--mic-glow) 15%, transparent)` y `color: var(--mic-glow)`.
10. El parsing y renderizado ocurre exclusivamente en el cliente (unified/rehype). Nunca hay llamada al servidor.
11. En modo `split`: pane izquierdo = CodeMirror puro (markdown crudo), pane derecho = HTML renderizado. Scroll sincronizado entre ambos panes.
12. En modo `read`: solo el HTML renderizado, sin cursor de edición ni CodeMirror activo.
13. En modo `raw`: solo CodeMirror puro, sin decoraciones ni renderizado de ningún tipo.
14. El cursor en una línea de tabla (pipe syntax `|`) revela la sintaxis cruda de esa fila completa.

#### Comportamiento detallado
- **Línea activa:** Al escribir `# Mi título`, el `#` es visible solo con el cursor en esa línea. Al moverse, aparece `<h1>Mi título</h1>`. Este comportamiento es idéntico al Live Preview de Obsidian.
- **Bloques de código:** ` ```lenguaje ` — el bloque completo revela la sintaxis cruda solo si el cursor está dentro. Fuera, muestra el bloque renderizado con resaltado.
- **Sin conexión:** el editor funciona completamente desde IndexedDB. Live preview no requiere red.
- **Imágenes:** `![alt](url)` renderiza como `<img max-width: 100%>`. Adjuntos de R2 se sirven con URL prefirmada.

#### Notas de diseño
- Estilos del preview: `.mic-preview` en `docs/DESIGN_SYSTEM.md`.
- Tokens clave: `--mic-accent` (links), `--mic-glow` (tags), `--mic-bg-code` (código).

> **Estado de implementación:** Los CAs 1–6 (modo live WYSIWYG por línea) y CAs 8–9
> (renderizado de `[[enlaces]]` y `#tags` en live mode) son el objetivo de diseño.
> El código actual de HU-01 implementa el cambio de layout CSS entre paneles; las
> decoraciones inline de CodeMirror 6 se construyen en el próximo ciclo SDD de HU-01.

---

### HU-02 · Navegación entre modos de visualización y barra de formato (2 SP, alta)
Como usuario, quiero alternar entre modos de edición con atajo o botón, y acceder a herramientas
de formato sin memorizar sintaxis markdown.

**Contexto:** Barra de herramientas fija en la parte SUPERIOR del pane de editor (entre el tab bar y el contenido).

#### Criterios de aceptación
1. La barra de herramientas es visible en los modos `live`, `split` y `raw`. En modo `read` se oculta.
2. La barra tiene dos secciones: herramientas de formato (izquierda) y selector de modo (derecha), separadas por un divisor visual.
3. **Herramientas de formato disponibles** (de izquierda a derecha): Negrita, Cursiva, Tachado, Código inline, H1, H2, H3, Lista desordenada, Lista ordenada, Cita (blockquote), Link, Divisor horizontal.
4. Si hay texto seleccionado al hacer clic en una herramienta, envuelve la selección con la sintaxis correspondiente (ej: "texto" seleccionado + Negrita → `**texto**`).
5. Sin selección: inserta la sintaxis con el cursor en el lugar de edición (ej: Negrita → inserta `****` con cursor entre los `**`).
6. Atajos de teclado: Ctrl+B (negrita), Ctrl+I (cursiva), Ctrl+K (link), Ctrl+Shift+C (código inline).
7. **Selector de modo** (derecha): cuatro íconos Lucide — `PenLine` (live) · `Columns2` (split) · `Eye` (read) · `Code` (raw).
8. El modo activo tiene el ícono resaltado: `background: var(--mic-bg-surface)` + `border: 1px solid var(--mic-accent)`.
9. Cambiar de modo NO pierde la posición del cursor ni el scroll.
10. El modo activo persiste por nota al recargar (guardado en `localStorage` por ID de nota).
11. Atajos de modo: Ctrl+1 (live), Ctrl+2 (split), Ctrl+3 (read), Ctrl+4 (raw).
12. En pantallas `<768px`: solo se muestran los modos `live` y `read`. Split y raw se ocultan.
13. H1/H2/H3 en la toolbar inserta o reemplaza el prefijo `#` de la línea actual. H1 en una línea con `## Título` → `# Título`.

#### Comportamiento detallado
- **Inserción de lista:** clic en "Lista desordenada" en línea vacía → inserta `- `. En línea con contenido → prepende `- `.
- **Link:** abre un pequeño popover inline con campos "Texto del enlace" y "URL". Si hay selección, pre-rellena el texto.
- **Divisor:** inserta `---` en una línea nueva.
- **Blockquote:** prepende `> ` al inicio de la línea actual.
- **En modo `split`:** la barra de herramientas aparece sobre el pane izquierdo (editor). El pane derecho (preview) no tiene barra.

#### Notas de diseño
- Altura de la barra: `var(--mic-toolbar-height)` = 40px. Background: `var(--mic-bg-surface)`.
- Separador entre grupos: `border-right: 1px solid color-mix(in srgb, var(--mic-text-muted) 30%, transparent)`.
- Botones de la barra: patrón hover estándar `color-mix(in srgb, var(--mic-glow) 15%, transparent)`.

> **Estado de implementación:** El `ModeSwitcher` existe con etiquetas de texto
> ("En vivo", "Dividido", "Lectura", "Raw"). La barra de herramientas de formato
> completa (CAs 2–6, íconos Lucide, Ctrl+B/I/K) se construye en el próximo ciclo
> SDD de HU-02.

---

### HU-03 · Sintaxis extendida (2 SP, media)
Como usuario, quiero tablas, callouts, notas al pie, KaTeX y Mermaid, para crear contenido
enriquecido sin herramientas externas.

**Contexto:** Pipeline de renderizado del preview (unified/rehype). Afecta modos `live`, `split`, `read`.

#### Criterios de aceptación
1. Las tablas Markdown se renderizan como `<table>` con los estilos de `.mic-preview table`. Encabezados con `background: var(--mic-bg-surface)`.
2. El resaltado de sintaxis en bloques de código soporta: JavaScript/TypeScript, XML/HTML, CSS, JSON, Shell/Bash, Python, Markdown, C#, YAML.
3. Las expresiones matemáticas inline (`$f(x)$`) y de bloque (`$$f(x)$$`) se renderizan con KaTeX.
4. Los bloques ` ```mermaid ` se renderizan como diagramas. Sintaxis inválida → mensaje de error inline sin romper el resto de la nota.
5. Los callouts usan la sintaxis `> [!TIPO]` donde TIPO puede ser: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`. Cada tipo tiene color de borde e ícono distinto.
6. Tipos de callout y sus íconos Lucide:
   - `NOTE`: borde `--mic-glow`, ícono `Info`
   - `TIP`: borde `--mic-glow`, ícono `Lightbulb`
   - `IMPORTANT`: borde `--mic-accent`, ícono `Star`
   - `WARNING`: borde `--mic-amber-icon`, ícono `AlertTriangle`
   - `CAUTION`: borde `#D95040`, ícono `AlertCircle`
7. Las notas al pie (`[^1]`) se renderizan al final del documento con links de vuelta al texto.
8. Los bloques de código muestran el lenguaje como badge en la esquina superior derecha y un botón "Copiar" al hover. *(Pendiente de implementación — aún no construido en el ciclo actual de HU-03.)*
9. `- [ ]` y `- [x]` renderizan como checkboxes. En modo `read` son interactivos (clic cambia el estado en el markdown). *(Pendiente de implementación — checkboxes interactivos aún no construidos en el ciclo actual de HU-03.)*
10. Callout con título: `> [!NOTE] Mi título` usa el texto tras el tipo como título del callout. *(Pendiente de implementación — títulos inline en callouts aún no construidos en el ciclo actual de HU-03.)*

#### Notas de diseño
- Fondos de callout: `color-mix(in srgb, {color-tipo} 8%, transparent)`. No hardcodear hex.
- Ver tokens existentes en `docs/DESIGN_SYSTEM.md`. Agregar tokens semánticos para tipos de callout si se necesitan colores nuevos.

---

### HU-04 · Autoguardado continuo (3 SP, alta)
Como usuario, quiero que los cambios se guarden solos, para no perder trabajo aunque cierre
la pestaña o pierda conexión.

**Contexto:** Motor de persistencia del editor. Indicador visual en el tab bar de cada nota.

#### Criterios de aceptación
1. Cada cambio en el editor se persiste en IndexedDB en menos de 500 ms.
2. El contenido de IndexedDB se sincroniza con R2 cada 10 segundos o al cerrar/abandonar la nota.
3. El estado de sync se muestra como un punto pequeño (6px) en la pestaña de la nota:
   - **Gris:** guardado en IndexedDB, sin sync pendiente con R2.
   - **Pulsando (animado):** sync con R2 en progreso.
   - **Verde:** sincronizado exitosamente con R2.
   - **Naranja/Rojo:** offline o error — cambios pendientes.
4. Sin conexión: los cambios van a IndexedDB y se encolan. Al recuperar la red, el sync se dispara automáticamente.
5. Si el contenido remoto (R2) es más reciente que el local, aparece una notificación no bloqueante en el editor: "Hay cambios remotos disponibles — [Aplicar]". El usuario puede ignorarla o aplicarla.
6. El dot de sync es visible aunque la pestaña no tenga foco.
7. Al cerrar el navegador con sync pendiente, el contenido en IndexedDB preserva los cambios para el próximo acceso.
8. El sync a R2 está throttled a máximo 1 request cada 10 segundos por nota.
9. No hay botón manual de "guardar". El autoguardado es el único mecanismo.
10. **Almacenamiento conmutable:** la lectura/escritura de contenido a R2 se hace a través
    de un puerto `IBlobStorage` con dos implementaciones — `LocalDiskBlobStorage` (archivos
    en disco local) y `R2BlobStorage` (Cloudflare, con `DisablePayloadSigning = true`) —
    seleccionadas por la config `Storage:Provider`, espejando el patrón de HU-39. Permite
    probar el autoguardado en local sin Cloudflare.

#### Comportamiento detallado
- **Clave IndexedDB:** ID de la nota como clave, markdown crudo como valor.
- **Conflicto:** timestamp R2 > timestamp local → notificación. Opciones: [Aplicar remoto] o [Ignorar] (mantiene local, lo sincronizará encima).
- **`beforeunload`:** al cerrar la pestaña, se dispara un sync inmediato si hay cambios pendientes.

#### Notas de diseño
- Dot: `<span>` de 6×6px, `border-radius: 50%`, posicionado en esquina superior derecha del texto del tab.
- Animación pulsando: `animation: pulse 1.2s ease-in-out infinite`.
- **Doble almacenamiento (local + Cloudflare):** ver HU-39 para el patrón de proveedor
  conmutable. Modo local: `.md` a disco (p. ej. `./.local-storage/blobs/{r2_key}`); modo
  cloudflare: R2.

---

## Épica: Colaboración

### HU-05 · Edición simultánea sin conflictos (5 SP, alta)
Como usuario, quiero editar la misma nota desde dos dispositivos a la vez y ver los cambios
en tiempo real.

**Contexto:** Notas dentro de carpetas compartidas únicamente. Requiere HU-04.

#### Criterios de aceptación
1. Cambios de otro editor visibles en el cliente local en menos de 300 ms en red normal.
2. Ediciones concurrentes se fusionan vía Yjs CRDT sin pérdida de datos ni intervención manual.
3. Sincronización vía Durable Objects de Cloudflare (relay de updates Yjs entre sesiones de la misma nota).
4. Al reconectar tras desconexión, el CRDT local se fusiona con el remoto automáticamente.
5. La colaboración se activa SOLO para notas en carpetas compartidas. Las notas privadas no exponen presencia.
6. Yjs persiste el CRDT en IndexedDB localmente y en el Durable Object remotamente.
7. La nota sigue siendo editable sin conexión. El merge ocurre al reconectar.

---

### HU-06 · Indicadores de presencia (2 SP, media)
Como usuario, quiero ver quién más está en la misma nota y dónde, para coordinar la edición.

**Contexto:** Superpuesto sobre el editor, solo en notas de carpetas compartidas.

#### Criterios de aceptación
1. Cada sesión activa muestra un cursor de color distinto con etiqueta del nombre del usuario.
2. El cursor desaparece a los 5 segundos de que la sesión se desconecta o pierde foco.
3. Los colores de cursor se generan a partir del ID de usuario (no hardcodeados).
4. El cursor no interfiere con la selección ni edición del usuario local.
5. En modo `read`: los cursores son visibles pero no se puede editar.
6. Máximo 8 cursores simultáneos; el resto se agrupa como "+N más".

---

## Épica: Archivos e importación

### HU-07 · Importar archivos `.md` desde el sistema de archivos (3 SP, alta)
Como usuario, quiero importar archivos Markdown desde mi computadora, para migrar notas
existentes sin reescribirlas.

**Contexto:** Explorer (panel izquierdo) — menú contextual de carpeta y zona de drag & drop.

#### Criterios de aceptación
1. Triggers: (a) menú contextual de carpeta → "Importar archivos .md", (b) drag & drop de archivos `.md` sobre el árbol del explorer.
2. Admite selección múltiple de archivos `.md`.
3. Arrastrar una carpeta importa toda la estructura recursivamente, preservando la jerarquía.
4. Conflicto de nombre: modal con opciones [Reemplazar] / [Renombrar (sufijo "-1", "-2")] / [Cancelar este archivo]. En importación múltiple, el modal se repite por cada conflicto.
5. Los archivos importados están disponibles inmediatamente, sin recargar.
6. Solo UTF-8. Si un archivo tiene otro encoding, se omite con advertencia.
7. Barra de progreso en el panel cuando hay más de 3 archivos.
8. Los archivos importados se sincronizan a R2 en segundo plano (HU-04).

#### Comportamiento detallado
- **Carpeta destino:** la carpeta activa en el explorer al hacer el drop. Sin carpeta activa → raíz del vault.
- **Drag & drop visual:** la carpeta destino se resalta con `color-mix(in srgb, var(--mic-glow) 20%, transparent)`.

---

### HU-08 · Exportar nota como `.md` (2 SP, alta)
Como usuario, quiero descargar la nota activa como archivo `.md`, para backup o uso externo.

**Contexto:** Menú contextual de la nota en el explorer + menú "..." del editor.

#### Criterios de aceptación
1. Triggers: (a) clic derecho en nota del explorer → "Exportar como .md", (b) menú "..." de la barra del editor.
2. El archivo exportado contiene el markdown crudo (no HTML).
3. Nombre del archivo = nombre de la nota + `.md`.
4. Exportación 100% en cliente (Blob + `URL.createObjectURL`). Sin llamada al servidor.
5. Disponible sin conexión (usa IndexedDB si R2 no está disponible).

---

### HU-09 · Exportar vault como ZIP (3 SP, media)
Como usuario, quiero descargar todas mis notas en un ZIP para backup completo del vault.

**Contexto:** Menú de opciones del vault (configuración).

#### Criterios de aceptación
1. Trigger en el menú de configuración del vault.
2. El ZIP preserva la estructura de carpetas exacta del vault.
3. Los adjuntos se incluyen en una subcarpeta `adjuntos/` en la raíz del ZIP.
4. Para vaults < 200 MB: JSZip en el cliente con barra de progreso.
5. Para vaults ≥ 200 MB: compresión delegada al servidor con polling de progreso.
6. Nombre del archivo: `vault-{nombre_vault}-{YYYY-MM-DD}.zip`.

---

### HU-10 · Exportar nota como PDF (4 SP, alta)
Como usuario, quiero descargar la nota como PDF con el tema visual aplicado, para compartir
documentos formateados.

**Contexto:** Menú contextual de la nota + menú "..." del editor.

#### Criterios de aceptación
1. Mismo trigger que HU-08 pero con "Exportar como PDF".
2. El PDF respeta el tema visual activo (CSS de Micelio aplicado vía PuppeteerSharp en el servidor).
3. El usuario elige el tamaño de página: A4 o Letter.
4. Mermaid y Excalidraw se incrustan como SVG vectorial.
5. Sin saltos de página en medio de bloques de código ni tablas.
6. Generación < 10 segundos para notas de hasta 5.000 palabras.
7. Nombre del PDF = nombre de la nota + `.pdf`.

---

### HU-11 · Importar vault de Obsidian (2 SP, media)
Como usuario, quiero importar un vault de Obsidian completo, para migrar sin perder mi estructura.

**Contexto:** Opciones de importación en la configuración del vault.

#### Criterios de aceptación
1. Trigger: selector de carpeta (File System Access API) o selector de archivo `.zip`.
2. Lectura recursiva de `.md`, `.excalidraw` y adjuntos (`.png`, `.jpg`, `.pdf`, `.svg`, `.gif`, `.webp`).
3. La carpeta `.obsidian/` y todo su contenido se ignoran sin error.
4. Se preserva la estructura de carpetas del vault importado.
5. Conflictos de nombre se resuelven igual que en HU-07.
6. Al finalizar, modal de resumen: "X notas importadas, Y adjuntos, Z archivos omitidos (listado)".

---

## Épica: Temas y personalización

### HU-12 · Seleccionar tema predefinido y modo oscuro (3 SP, alta)
Como usuario, quiero elegir entre temas visuales y activar el modo oscuro, para adaptar
la interfaz a mis preferencias de lectura y ambiente de trabajo.

**Contexto:** Settings drawer — sección "Apariencia".

#### Criterios de aceptación
1. Dos temas predefinidos: **Bioluminiscencia** (verde-cian, predeterminado) y **Cantarela** (ámbar).
2. Cada tema tiene una variante de **modo oscuro** activable de forma independiente.
3. Tema y modo oscuro son **ortogonales**: 4 combinaciones posibles (Bio Claro, Bio Oscuro, Cant Claro, Cant Oscuro).
4. El cambio de tema y el toggle oscuro/claro son instantáneos — sin recarga.
5. La preferencia persiste en el backend y se restaura en cualquier dispositivo al iniciar sesión.
6. El tema activo se aplica via `data-theme="bioluminiscencia"` (o `cantarela`) en `<html>`.
7. El modo oscuro se aplica via `data-dark="true"` en `<html>` — adicional al atributo de tema.
8. En modo oscuro solo cambian: `--mic-raw-canvas`, `--mic-raw-mist`, `--mic-raw-ink`, `--mic-raw-ink-muted`. Los tokens de acento y glow no varían.
9. El settings drawer tiene un toggle sol/luna para el modo oscuro, separado del selector de tema.
10. El selector de tema muestra las opciones como swatches de color con nombre y una mini-preview.

#### Tokens de modo oscuro
- **Bioluminiscencia Oscuro:** `--mic-raw-canvas: #04342C`, `--mic-raw-mist: #085041`, `--mic-raw-ink: #E1F5EE`, `--mic-raw-ink-muted: rgba(225, 245, 238, 0.55)`.
- **Cantarela Oscuro:** `--mic-raw-canvas: #412402`, `--mic-raw-mist: #633806`, `--mic-raw-ink: #FAEEDA`, `--mic-raw-ink-muted: rgba(250, 238, 218, 0.55)`.

#### Notas de diseño
- Ver `docs/DESIGN_SYSTEM.md` para tokens raw completos y sección "Dark Mode".

---

### HU-13 · Personalizar con CSS propio (4 SP, alta)
Como usuario, quiero escribir CSS personalizado para modificar el aspecto más allá de los
temas predefinidos.

**Contexto:** Settings drawer — sección/pestaña "CSS personalizado".

#### Criterios de aceptación
1. Editor de código con números de línea en el settings drawer.
2. Los cambios en el CSS se aplican en tiempo real mientras el usuario escribe.
3. El CSS se guarda en R2 (`usuarios/{userId}/temas/custom.css`) al confirmar.
4. El CSS guardado se carga automáticamente al iniciar sesión en cualquier dispositivo.
5. Toggle "Activar / Desactivar CSS personalizado" (no borra el CSS).
6. Si el CSS tiene errores de sintaxis, se muestran anotaciones sobre las líneas erróneas. La UI no se rompe.
7. El CSS puede sobreescribir tokens `--mic-*` raw para crear temas completamente diferentes.

---

### HU-14 · Personalizar tipografía (2 SP, media)
Como usuario, quiero cambiar la fuente y el tamaño del editor y el preview de forma independiente.

**Contexto:** Settings drawer — sección "Tipografía".

#### Criterios de aceptación
1. Fuente del editor: al menos 5 opciones mono (JetBrains Mono, Fira Code, Source Code Pro) y proporcionales (Geist Sans, Inter, Source Serif 4, Lora).
2. Tamaño del editor: slider 12–24px.
3. Fuente del preview: al menos 3 opciones proporcionales (Geist Sans, Source Serif 4, Inter, Lora).
4. Tamaño del preview: slider independiente 12–24px.
5. Cambios inmediatos (sin guardar). Preferencias persistidas en el backend.

---

### HU-15 · Importar/exportar temas como `.css` (2 SP, baja)
Como usuario, quiero descargar mi CSS actual e importar temas externos.

**Contexto:** Settings drawer — sección "CSS personalizado".

#### Criterios de aceptación
1. Botón "Descargar CSS" exporta el CSS personalizado actual como `.css`.
2. Botón "Importar .css" abre selector de archivo.
3. Al importar, se muestra una preview antes de aplicar (temporal, sin guardar).
4. El usuario confirma o cancela tras la preview.
5. Si supera 50 KB, advertencia pero se permite continuar.

---

## Épica: Diagramas

### HU-16 · Crear y editar diagramas Excalidraw en una nota (4 SP, alta)
Como usuario, quiero insertar y editar diagramas de forma libre directamente desde el editor.

**Contexto:** Editor (modo live/split/raw) — inserción inline.

#### Criterios de aceptación
1. Triggers de inserción: (a) botón en la barra de herramientas del editor, (b) drag & drop de un archivo `.excalidraw` sobre el editor.
2. En el preview, el diagrama renderizado aparece inline en lugar de la referencia `![[diagrama.excalidraw]]`.
3. Clic en el diagrama renderizado → abre el editor Excalidraw en un modal o panel expandido.
4. El archivo `.excalidraw` se guarda en R2: `vaults/{vaultId}/diagramas/{notaId}/{diagId}.excalidraw`.
5. Cambios en el diagrama se guardan automáticamente al cerrar el editor Excalidraw.
6. Si el archivo no existe o no se puede cargar, se muestra un placeholder de error sin romper la nota.
7. El editor Excalidraw se integra via `@excalidraw/excalidraw` como componente React embebido.

---

### HU-17 · Exportar Excalidraw como imagen (2 SP, media)
Como usuario, quiero exportar un diagrama Excalidraw como PNG o SVG.

**Contexto:** Menú contextual del bloque Excalidraw renderizado en el preview.

#### Criterios de aceptación
1. Menú contextual (clic derecho o botón "...") sobre el diagrama renderizado: "Exportar como PNG" y "Exportar como SVG".
2. La exportación respeta el modo claro/oscuro activo.
3. El SVG resultante es vectorial y escalable.
4. En exportaciones a PDF (HU-10), el diagrama se incrusta como SVG.

---

### HU-18 · Diagramas con Mermaid (3 SP, media)
Como usuario, quiero escribir bloques Mermaid y verlos renderizados en tiempo real.

**Contexto:** Pipeline de renderizado del preview.

#### Criterios de aceptación
1. Los bloques ` ```mermaid ` se renderizan como diagramas SVG en el preview.
2. El diagrama se actualiza en tiempo real al editar el bloque (debounce 100-150ms de HU-01).
3. Sintaxis inválida: mensaje de error en rojo debajo del bloque. El resto de la nota no se ve afectado.
4. Tipos soportados: `flowchart`, `sequenceDiagram`, `gantt`, `classDiagram`, `erDiagram`, `pie`, `gitGraph`.
5. En exportaciones a PDF, el diagrama se exporta como SVG vectorial.

---

## Épica: Rendimiento

### HU-19 · Carga instantánea de notas recientes (3 SP, alta)
Como usuario, quiero que las notas visitadas abran en menos de 100 ms, para no interrumpir
el flujo de pensamiento.

**Contexto:** Motor de cache en IndexedDB.

#### Criterios de aceptación
1. Una nota visitada previamente abre desde IndexedDB en < 100 ms.
2. La sincronización con R2 ocurre en segundo plano, sin bloquear la UI.
3. Si R2 tiene una versión más reciente, se aplica de forma no disruptiva mientras el cursor está inactivo.
4. Un indicador visible muestra el estado de sync: "Local", "Sincronizado", "Desactualizado".

---

### HU-20 · Navegación sin recarga (2 SP, alta)
Como usuario, quiero que al clicar en una nota el contenido cambie sin recargar la página.

**Contexto:** SPA — router Next.js + store de navegación.

#### Criterios de aceptación
1. Clic en nota del explorer → contenido del editor intercambiado < 200 ms si la nota está en cache.
2. La URL refleja la nota activa: `/workspace?note={d1Uuid}`.
3. El botón "Atrás" del navegador navega a la nota anterior sin abandonar la app.
4. Una URL con `/workspace?note={d1Uuid}` abre esa nota directamente (links directos compartibles).

---

### HU-21 · Búsqueda full-text en el vault (3 SP, media)
Como usuario, quiero buscar texto en todas mis notas a la vez, para encontrar información
sin recordar en qué nota está.

**Contexto:** Panel izquierdo — activado desde el ícono de búsqueda del rail (lupa).

#### Criterios de aceptación
1. Al activar la búsqueda del rail, el panel izquierdo REEMPLAZA su contenido por el panel de búsqueda (no modal, no overlay). El explorer queda oculto.
2. El campo de búsqueda recibe el foco automáticamente.
3. Resultados en < 1 segundo para vaults de hasta 1.000 notas.
4. Cada resultado muestra: título de la nota + ruta de carpeta + fragmento(s) con coincidencias resaltadas (`color-mix(in srgb, var(--mic-glow) 30%, transparent)`).
5. Filtros soportados: texto del contenido, nombre del archivo, tags (`#tag` inline o `tag:nombre`).
6. Multi-término: "agua micelio" → AND implícito (contiene ambas palabras).
7. Frase exacta: `"red de conocimiento"` entre comillas.
8. Clic en resultado → abre la nota y posiciona el cursor en la primera coincidencia.
9. Vaciar el campo o Esc → restaura el explorer en el panel izquierdo.
10. El índice FTS5 en D1 se actualiza cuando se guarda una nota.

#### Comportamiento detallado
- **Sin resultados:** "Sin resultados para '{query}'" con sugerencia.
- **Cerrar búsqueda:** botón × en el panel o Esc restaura el explorer.

---

## Épica: Gestión de archivos

### HU-22 · Organizar en carpetas anidadas (3 SP, alta)
Como usuario, quiero crear, renombrar y anidar carpetas para estructurar mis notas.

**Contexto:** Panel izquierdo — explorer.

#### Criterios de aceptación
1. Crear carpeta: menú contextual → "Nueva carpeta" o botón `+` del panel.
2. Renombrar: doble clic en el nombre o menú contextual → "Renombrar".
3. Eliminar: menú contextual → "Eliminar". Si tiene contenido, diálogo de confirmación con conteo de notas.
4. Anidamiento ilimitado de subcarpetas.
5. Estado expandido/colapsado persiste en localStorage.
6. Drag & drop de carpetas implementado (DndContext + PointerSensor en Explorer). El D&D de notas entre carpetas distintas se completa en HU-24.
7. Carpetas compartidas muestran el ícono `Users` de Lucide en color `--mic-glow`.
8. Todas las notas dentro de una carpeta compartida muestran un ícono de compartición (`Users` pequeño) junto a su nombre en el explorer.

---

### HU-23 · Crear, renombrar, eliminar notas (2 SP, alta)
Como usuario, quiero gestionar las notas desde el explorador para mantener el vault organizado.

**Contexto:** Panel izquierdo — explorer. Panel de papelera (ícono trash del rail).

#### Criterios de aceptación
1. Crear nota: menú contextual de carpeta → "Nueva nota" o Ctrl+N con carpeta activa. Se crea en la carpeta activa.
2. **El título de la nota ES el nombre del archivo** (sin extensión `.md`). No existe un campo de metadata separado para el título.
3. Renombrar una nota actualiza `notas.titulo` en D1. La `r2_key` permanece invariante (es ID-based). La reescritura de `[[enlaces]]` en el vault se implementa en una HU futura.
4. Al renombrar, la nota es inmediatamente accesible bajo el nuevo título en el explorer.
5. Duplicar: crea copia en la misma carpeta con sufijo numérico incremental ("Nota" → "Nota 2", "Nota 2" → "Nota 3", etc.).
6. Eliminar: mueve la nota a la papelera (no elimina permanentemente). Desaparece del explorer principal.
7. La papelera retiene notas 30 días; luego, eliminación permanente de D1 y R2.
8. Recuperar desde papelera: restaura al directorio original. Si el directorio ya no existe, va a la raíz del vault personal.
9. La papelera es accesible desde el ícono de trash en la parte INFERIOR del rail (abre la vista de papelera en el panel izquierdo). *(La API de papelera y los datos en D1 están implementados. La vista UI del panel de papelera se construye junto con el grupo inferior del rail — HU-28 siguiente ciclo.)*
10. Vista de papelera muestra por nota: nombre, ruta original, fecha de eliminación, días restantes. Botones [Recuperar] y [Eliminar ahora]. *(Pendiente de implementación — ver nota del CA 9.)*

---

### HU-24 · Reorganizar con drag & drop (2 SP, media)
Como usuario, quiero mover notas y carpetas arrastrándolas para reorganizar el vault.

**Contexto:** Panel izquierdo — explorer.

#### Criterios de aceptación
1. Las notas y carpetas son arrastrables desde el explorer.
2. Durante el drag, el elemento destino (carpeta) se resalta visualmente.
3. Entre ítems al mismo nivel, aparece una línea indicadora de posición.
4. Al soltar, la nota/carpeta se mueve al destino. La clave en R2 se actualiza.
5. Mover una nota actualiza todos los `[[enlaces internos]]` en el vault.
6. No se puede mover una carpeta dentro de sí misma ni de sus hijos. Feedback visual (cursor prohibido).
7. La acción de mover es deshacible con Ctrl+Z inmediatamente después.

---

## Épica: Espacio de trabajo

### HU-25 · Gestionar pestañas (5 SP, alta)
Como usuario, quiero abrir varias notas en pestañas para trabajar con múltiples documentos
simultáneamente.

**Contexto:** Área central del workspace — tab bar de cada pane.

#### Criterios de aceptación
1. Clic en nota del explorer → se abre en nueva pestaña en el pane activo (o reutiliza la existente).
2. Cada pane tiene su propio tab bar con las pestañas de las notas abiertas en ese pane.
3. Las pestañas muestran el nombre de la nota (sin `.md`) y el dot de sync de HU-04.
4. Cerrar pestaña: botón × o Ctrl+W (cierra la activa).
5. Último tab cerrado → el pane muestra estado vacío con prompt "Abrí una nota desde el explorador".
6. Reordenar tabs por drag dentro del tab bar.
7. Ctrl+Shift+T reabre el último tab cerrado (historial de 10).
8. Al cerrar una pestaña con cambios pendientes, el sync con R2 se completa en segundo plano.
9. **Splitear:** arrastrar una pestaña al borde de un pane (zona de 20px en top/right/bottom/left) crea un split en esa dirección con esa nota.
10. Las pestañas recuerdan el scroll y la posición del cursor mientras están abiertas.
11. **Sin pinning** en esta versión (ver `docs/FUTURE_IMPLEMENTATIONS.md`).
12. **Sin persistencia al recargar** en esta versión (ver `docs/FUTURE_IMPLEMENTATIONS.md`).

#### Comportamiento detallado
- **Misma nota en múltiples panes:** los cambios en una se reflejan en la otra en tiempo real (misma fuente Yjs local).
- **Hover en tab truncado:** tooltip con nombre completo y ruta de la nota.

---

### HU-26 · Dividir la pantalla en múltiples panes (5 SP, alta)
Como usuario, quiero dividir el área de edición en paneles para ver y editar varias notas
simultáneamente.

**Contexto:** Área central del workspace.

#### Criterios de aceptación
1. Crear un split arrastrando una pestaña a cualquiera de los cuatro bordes de un pane: **arriba**, **abajo**, **izquierda**, **derecha**.
2. Al arrastrar al borde, aparece un overlay visual semitransparente indicando la dirección del split.
3. Cada pane resultante tiene su propio tab bar completo (mismas capacidades de HU-25).
4. El divisor entre panes es arrastrable para ajustar la proporción de espacio.
5. Se pueden crear splits anidados (un pane dividido se puede volver a dividir), generando grids M×N.
6. La misma nota en dos panes: cambios en uno reflejados en el otro en tiempo real.
7. Al cerrar todas las pestañas de un pane, ese pane se colapsa y el espacio se redistribuye.
8. **Sin persistencia al recargar** en esta versión (ver `docs/FUTURE_IMPLEMENTATIONS.md`).

---

### HU-27 · Vincular panel a vista previa (2 SP, media)
Como usuario, quiero que un pane muestre automáticamente la preview de lo que edito en otro.

**Contexto:** Menú de opciones del tab bar de un pane.

#### Criterios de aceptación
1. Opción "Vincular como preview de [pane X]" en el menú "..." del tab bar de un pane.
2. El pane vinculado muestra el preview (modo `read`) de la nota activa en el pane de origen.
3. Editar en el origen actualiza el pane vinculado en tiempo real.
4. Scroll sincronizable: toggle en el menú del vínculo.
5. El vínculo se rompe si cualquiera de los dos panes se cierra.
6. Un indicador visual (badge) en el tab bar señala que el pane está en modo "preview vinculado".

---

## Épica: Navegación y paneles

### HU-28 · Rail de íconos persistente (3 SP, alta)
Como usuario, quiero una barra lateral izquierda siempre visible con íconos de navegación,
para acceder a cualquier sección con un clic desde cualquier contexto.

**Contexto:** Rail izquierdo del workspace. `width: var(--mic-rail-width)` = 56px. Nunca colapsa.

#### Criterios de aceptación
1. El rail tiene dos grupos separados por un spacer flexible:
   - **Grupo superior:** Explorador (`Files`), Búsqueda global (`Search`), Grafo global (`Share2`), Tags (`Tag` — reservado, ver `docs/FUTURE_IMPLEMENTATIONS.md`).
   - **Grupo inferior:** Papelera (`Trash2`), Configuración (`Settings`).
2. Clic en Explorador, Búsqueda, Grafo, o Papelera: abre/activa el panel izquierdo con el contenido correspondiente.
3. Clic en Tags: actualmente abre un panel placeholder. La UI completa de tags está en `docs/FUTURE_IMPLEMENTATIONS.md`.
4. Clic en Configuración (gear): abre el **settings drawer** deslizable desde el lateral derecho de la pantalla. No reemplaza el panel izquierdo.
5. El ícono activo: `color: var(--mic-glow)` a opacidad plena + barra izquierda de 3px `background: var(--mic-glow)` (patrón `::before`).
6. Los íconos inactivos: `color: var(--mic-glow)` con `opacity: 0.55`.
7. Tooltip con el nombre de la función al hover de cualquier ícono (incluso el activo).
8. Clic en ícono ya activo → colapsa/cierra el panel izquierdo (comportamiento toggle).
9. El rail nunca se colapsa.

#### Notas de diseño
- Background: `var(--mic-bg-sidebar)`. Íconos: Lucide React.
- Patrón `::before` de la barra indicadora: ver `docs/DESIGN_SYSTEM.md` sección "Barra indicadora del rail".
- Sobre `--mic-bg-sidebar`: íconos inactivos = `opacity: 0.55`, activos/hover = `opacity: 1`. No usar `--mic-text-muted`.
- El ícono `CalendarDays` (Daily Note) está en el código como placeholder — clic sin efecto. Implementación completa en `docs/FUTURE_IMPLEMENTATIONS.md`.
- El grupo inferior (Trash2 + Settings) está pendiente de implementación. El rail actual tiene 5 íconos en un solo grupo (sin grupo inferior separado).

---

### HU-29 · Desplegar/colapsar paneles laterales (3 SP, alta)
Como usuario, quiero controlar cuánto espacio ocupan los paneles laterales para maximizar
el área de edición.

**Contexto:** Paneles izquierdo y derecho del workspace.

#### Criterios de aceptación
1. El panel izquierdo cambia de contenido según el ícono activo del rail.
2. El panel izquierdo se colapsa/expande con: (a) clic en el ícono activo del rail (toggle), (b) Ctrl+\ .
3. El panel derecho se colapsa/expande con: (a) ícono de grafo del rail si ya está activo, (b) Ctrl+Shift+\ .
4. Ambos paneles colapsados → el editor ocupa el ancho completo.
5. El ancho de cada panel es ajustable arrastrando su borde interior.
6. El ancho ajustado persiste (localStorage o preferencias).
7. Límites: mínimo `var(--mic-panel-min-width)` = 160px, máximo `var(--mic-panel-max-width)` = 480px.
8. Panel colapsado: `width: 0; overflow: hidden`. El track del CSS grid no cambia.

---

### HU-30 · Grafo local, enlaces salientes, retroenlaces y metadatos (3 SP, media)
Como usuario, quiero ver en el panel derecho las conexiones de la nota activa y sus metadatos,
para explorar la red y conocer el contexto del documento.

**Contexto:** Panel derecho del workspace. Tres tabs + sección de metadatos debajo.

#### Criterios de aceptación
1. El panel derecho tiene tres tabs: **GRAFO**, **SALIENTES**, **RETRO**.
2. **Tab GRAFO:** mini-grafo D3 force-directed con la nota activa como nodo central y sus conexiones inmediatas (1 hop). Sin tags ni nodos especiales.
3. Los nodos del mini-grafo tienen tamaño proporcional a su cantidad total de conexiones en el vault.
4. Las líneas del mini-grafo usan curvas bezier suaves (estilo Obsidian).
5. Clic en un nodo → navega a esa nota.
6. **Tab SALIENTES (N):** lista clickeable de notas que la nota activa enlaza via `[[nombre]]`.
7. **Tab RETRO (N):** lista de notas del vault que contienen `[[enlace]]` hacia la nota activa. Cada ítem muestra nombre + fragmento de contexto del enlace.
8. Clic en ítem de SALIENTES o RETRO → abre la nota en una pestaña.
9. **Sección METADATOS** siempre visible debajo de los tabs:
   - Creada: `{fecha y hora}`
   - Modificada: `{fecha y hora}`
   - Ruta: `{nombre-vault}/{carpeta}/{nombre-archivo}`
   - Tamaño: `{N} KB`
10. Los contadores de tabs se actualizan al agregar o quitar enlaces en la nota activa.
11. Sin conexiones: tab GRAFO muestra solo el nodo de la nota activa, sin líneas.

#### Notas de diseño
- Tags en grafo: **no implementados** en esta versión. Ver `docs/FUTURE_IMPLEMENTATIONS.md`.
- Metadatos: `font-size: 0.75rem`, `color: var(--mic-text-muted)`.

---

### HU-31 · Buscar dentro de la nota actual (2 SP, media)
Como usuario, quiero buscar y reemplazar texto dentro de la nota activa para navegar rápidamente
y corregir repeticiones.

**Contexto:** Barra flotante entre el AppTopbar y el editor. Dos entry points.

#### Criterios de aceptación
1. **Dos entry points:** (a) clic en la barra de búsqueda central del AppTopbar (HU-38), (b) Ctrl+F dentro del editor.
2. Al activarse, aparece una barra flotante entre el AppTopbar y el editor.
3. Todas las coincidencias se resaltan en el editor: `background: color-mix(in srgb, var(--mic-glow) 35%, transparent)`.
4. La coincidencia activa tiene resaltado más intenso para diferenciarse del resto.
5. Navegación: Enter (siguiente), Shift+Enter (anterior), botones `‹` `›` en la barra.
6. Contador: `3 de 12`.
7. Case-insensitive por defecto. Botón `Aa` en la barra activa case-sensitive.
8. Campo de reemplazo expandible: botones [Reemplazar uno] y [Reemplazar todos].
9. Esc cierra la barra y elimina los resaltados.

---

## Épica: Usuarios y cuentas

### HU-32 · Registro e inicio de sesión (5 SP, alta)
Como usuario, quiero registrarme y acceder a Micelio de forma segura desde cualquier dispositivo.

**Contexto:** Rutas `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`.

#### Criterios de aceptación
1. Registro con email único + contraseña (mínimo 8 caracteres, validación visible).
2. OAuth de GitHub disponible como alternativa.
3. Email de verificación antes de activar la cuenta.
4. JWT de corta duración (15 min) + refresh token HttpOnly en cookie (7 días, rotado en cada uso).
5. Sesión persiste entre dispositivos mientras el refresh token esté vigente.
6. "Olvidé mi contraseña" envía link de un solo uso por email.
7. Contraseñas como hash BCrypt. Nunca en texto plano.
8. Logout invalida el refresh token en el servidor.

---

### HU-33 · Vault personal privado por defecto (3 SP, alta)
Como usuario, quiero que mis notas sean privadas por defecto y que lo compartido sea
claramente distinguible.

**Contexto:** Modelo de datos — tabla `membresias`. Explorer — indicadores visuales.

#### Criterios de aceptación
1. Al registrarse, se crea automáticamente un vault personal privado.
2. Las notas en el vault personal son invisibles para cualquier otro usuario.
3. Las carpetas y notas compartidas aparecen bajo "Compartido" en el explorer, distinguidas visualmente (ícono `Users`, color `--mic-glow`).
4. **Cada nota** dentro de una carpeta compartida muestra un ícono de compartición junto a su nombre en el explorer (no solo la carpeta padre).
5. Una carpeta compartida comparte TODO su contenido por defecto. Las excepciones se configuran en las opciones de la carpeta.
6. No hay necesidad de cambiar de cuenta para acceder a lo privado y lo compartido.

---

### HU-34 · Perfil y preferencias (2 SP, media)
Como usuario, quiero gestionar mi perfil y personalizar la experiencia, y que mis preferencias
se sincronicen en todos mis dispositivos.

**Contexto:** Settings drawer — secciones "Cuenta" y "Apariencia".

#### Criterios de aceptación
1. El usuario puede cambiar: nombre visible, avatar (upload de imagen), contraseña (requiere confirmación de la actual).
2. El usuario puede elegir el tema visual: Bioluminiscencia o Cantarela.
3. El usuario puede activar/desactivar el modo oscuro con un toggle sol/luna.
4. Tema y modo oscuro son independientes (4 combinaciones — ver HU-12).
5. Todas las preferencias se sincronizan al backend y se restauran en cualquier dispositivo.
6. Botón "Cerrar sesión en todos los dispositivos" invalida todos los refresh tokens activos.

---

## Épica: Compartición y colaboración

### HU-35 · Compartir una carpeta (5 SP, alta)
Como usuario, quiero compartir una carpeta con otros usuarios asignándoles un rol, para
colaborar en un espacio acotado sin exponer el resto de mi vault.

**Contexto:** Menú contextual de carpeta en el explorer + botón "Compartir" del AppTopbar (HU-38).

#### Criterios de aceptación
1. Triggers: (a) clic derecho en carpeta → "Compartir", (b) botón "Compartir" del AppTopbar (activo cuando la nota activa está en una carpeta compartible).
2. Panel de compartir: ingresar email del destinatario + asignar rol (Lector, Editor, Propietario).
3. Se crea una entrada en `membresias` con `recurso_tipo="carpeta"`.
4. El destinatario ve la carpeta en su sección "Compartido" del explorer sin recargar.
5. Las notas dentro de la carpeta compartida muestran ícono `Users` en el explorer del destinatario.
6. Solo la carpeta compartida (y su contenido) es accesible al destinatario; el resto del vault del propietario es privado.
7. El propietario puede cambiar el rol o revocar el acceso en cualquier momento.
8. El sistema impide que la carpeta quede sin propietario.
9. El destinatario recibe una notificación al concedérsele acceso.

#### Roles y permisos

| Rol         | Ver | Exportar | Editar/Crear | Gestionar miembros | Borrar recurso |
|-------------|-----|----------|--------------|--------------------|----------------|
| Lector      | ✓   | ✓        | ✗            | ✗                  | ✗              |
| Editor      | ✓   | ✓        | ✓            | ✗                  | ✗              |
| Propietario | ✓   | ✓        | ✓            | ✓                  | ✓              |

---

### HU-36 · Gestionar miembros y permisos (3 SP, alta)
Como propietario de una carpeta compartida, quiero ver y gestionar los miembros y sus roles.

**Contexto:** Panel de gestión de la carpeta compartida.

#### Criterios de aceptación
1. Lista de miembros con email, nombre, rol actual y fecha de incorporación.
2. El propietario puede cambiar el rol de cualquier miembro (excepto el suyo si es el único propietario).
3. El propietario puede eliminar el acceso (revocar).
4. El sistema impide que quede la carpeta sin propietario. Error visible: "Debe haber al menos un propietario".
5. Cambio de rol o revocación envía notificación al miembro afectado.
6. Accesible desde menú contextual de la carpeta → "Gestionar acceso".

---

### HU-37 · Edición colaborativa en tiempo real (3 SP, media)
Como usuario con rol Editor o Propietario, quiero editar notas compartidas en tiempo real
con otros miembros.

**Contexto:** Notas dentro de carpetas compartidas con dos o más sesiones activas.

#### Criterios de aceptación
1. La sincronización en tiempo real se activa automáticamente al abrir una nota de carpeta compartida.
2. Cambios de otro editor visibles en < 300 ms.
3. Fusión CRDT (Yjs) sin pérdida de datos ni intervención manual.
4. Cursor de color único con nombre por cada miembro activo.
5. Miembros con rol Lector ven los cambios en tiempo real pero NO pueden editar (editor en modo `read`).
6. El historial de versiones (futura implementación) registrará qué miembro realizó cada cambio.

---

## Épica: Workspace

### HU-38 · AppTopbar del workspace (2 SP, alta)
Como usuario, quiero una barra superior permanente con acceso rápido a búsqueda en la nota,
el botón de compartir y mi perfil, para orientarme y actuar desde cualquier estado del workspace.

**Contexto:** Banda horizontal superior del workspace. `grid-row: 1; grid-column: 1 / -1`. `height: var(--mic-topbar-height)` = 52px.

#### Criterios de aceptación
1. El AppTopbar es visible en todo momento en el workspace (no se colapsa ni oculta).
2. **Izquierda:** logo "Micelio" (texto con tipografía de marca o ícono). Clic → recarga el workspace.
3. **Centro:** barra de búsqueda con comportamiento dinámico:
   - Sin nota activa: placeholder "Micelio" o vacío.
   - Con nota activa: muestra el nombre de la nota activa como placeholder de contexto.
   - Clic en la barra → activa la búsqueda en nota (mismo comportamiento que Ctrl+F, HU-31).
4. **Derecha:** botón "Compartir" + avatar del usuario.
5. El botón "Compartir" está activo cuando la nota activa puede ser compartida (está en carpeta compartible). En cualquier otro caso, está deshabilitado visualmente.
6. El avatar muestra las iniciales del usuario o su foto de perfil. Clic → abre el settings drawer.
7. Background: `var(--mic-bg-sidebar)` — forma la banda oscura continua con el rail.
8. Todos los elementos interactivos tienen focus ring: `outline: 2px solid var(--mic-glow); outline-offset: 2px`.
9. En mobile (`<768px`): logo comprimido (solo ícono), barra de búsqueda comprimida a ícono de lupa.

#### Comportamiento detallado
- **Búsqueda vs rail search:** el AppTopbar NO replica la búsqueda del vault (esa es del rail). La barra del topbar es exclusivamente para buscar dentro de la nota activa.
- **Barra vacía vs con nota:** si no hay nota activa, la barra puede mostrar el nombre de la app o estar vacía. Clicarla activa igualmente HU-31.

#### Notas de diseño
- `grid-row: 1; grid-column: 1 / -1` — ocupa las 4 columnas del workspace grid.
- Ver referencia visual actualizada en `docs/DESIGN_SYSTEM.md` sección "Referencia visual del workspace".
- La barra de búsqueda central usa `var(--mic-bg-surface)` como fondo y `var(--mic-text-muted)` para el placeholder.

---

## Épica: Infraestructura de desarrollo

### HU-39 · Proveedor de almacenamiento local conmutable (3 SP, alta)
Como desarrollador, quiero ejecutar el backend contra una base SQLite local en lugar de
Cloudflare D1, para probar el sistema de punta a punta sin desplegar ni configurar Cloudflare.

**Contexto:** Backend .NET 9. Seam `ID1Client` (puerto de acceso a datos). No toca
repositorios, use cases ni endpoints existentes.

#### Criterios de aceptación
1. Una clase `LocalSqliteD1Client : ID1Client` ejecuta el SQL de los repositorios contra un
   archivo SQLite local usando `Microsoft.Data.Sqlite`.
2. Devuelve el MISMO envelope JSON que Cloudflare D1
   (`{ "results": [...], "success": true, "meta": { "changes", "last_row_id" } }`), de modo
   que los mappers existentes funcionan sin cambios.
3. `QueryAsync` (SELECT y escrituras) y `BatchAsync` (única transacción con rollback ante
   fallo) replican el contrato de `D1Client`.
4. Parámetros posicionales `?` enlazados en orden; `null` ↔ `DBNull`/JSON null.
5. La búsqueda full-text FTS5 (`MATCH`, `snippet`, `rank`) funciona en local.
6. Los 4 repos de Auth que dependen del concreto `D1Client` se refactorizan a `ID1Client`
   (sin cambio de comportamiento en producción).
7. Un `LocalDbInitializer` crea el esquema en el arranque (modo local) desde
   `backend/migrations/local/local_schema.sql` con todas las tablas como
   `CREATE TABLE IF NOT EXISTS` (usuarios con columnas finales, vaults, membresias,
   carpetas, notas, papelera, notas_fts). Idempotente.
8. El initializer siembra (solo local, idempotente) un usuario pre-verificado + vault
   personal + membresía propietario, para hacer login sin el flujo de email (Resend no corre
   en local).
9. La selección de proveedor es por config `Storage:Provider` (`cloudflare` por defecto |
   `local`). La rama `cloudflare` queda intacta — riesgo cero para producción.
10. `appsettings.Development.json` activa el modo local y define un `Jwt:Secret` de desarrollo.

#### Comportamiento detallado
- La base local (`micelio.local.db`) es desechable: borrarla reinicia el estado limpio.
- Cubre auth, carpetas, notas (metadatos), papelera, búsqueda y preferencias. NO cubre el
  contenido `.md` de las notas (R2), que se introduce en HU-04.

#### Notas de diseño
- Patrón replicable: al implementar R2 (HU-04) se define un puerto `IBlobStorage` con
  adaptadores local (disco) y Cloudflare R2 seleccionados por la misma config
  `Storage:Provider`.
- Frontend para probar contra el backend local: `NEXT_PUBLIC_API_URL=http://localhost:5279`.
