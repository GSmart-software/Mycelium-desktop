import { invoke } from "@tauri-apps/api/core";

/**
 * Framework IA del vault (FUN-L-08, solo-desktop). Genera en el vault un conjunto
 * VERSIONADO de instrucciones para asistentes de IA por terminal (Claude Code):
 * `CLAUDE.md` + skills + comandos.
 *
 * Eje del framework: el vault **es la memoria de largo plazo** de la IA, no un
 * repositorio de documentos a ordenar. De ahí los dos protocolos que enseña —
 * RECUPERAR antes de responder (buscar en la red de notas, expandir por
 * backlinks, citar procedencia) y CONSOLIDAR lo que valga recordar (escribir
 * autosuficiente y enlazado) — más el mapa de cuándo usar cada skill/comando.
 * La IA entiende Mycelium (vínculos, extensiones, metadatos, funciones) pero no
 * lo controla.
 *
 * El contenido evoluciona con Mycelium: al agregar funciones que la IA deba
 * conocer, subir `FRAMEWORK_IA_VERSION` y actualizar los templates. El botón de
 * Configuración detecta la versión instalada en el vault y ofrece actualizar.
 */

/**
 * Versión del framework generado (independiente de la versión de la app).
 * Historial:
 * - 1.0.0 — primera versión (estructura, vínculos, reglas, 4 comandos).
 * - 1.1.0 — `.mycignore` (qué ignora Mycelium, configurable por vault) y aviso
 *   de que los archivos generados no se pisan (conflictos → copia al lado).
 * - 1.2.0 — reenfoque: el vault es la MEMORIA de la IA. Protocolos de
 *   recuperación y consolidación, skill `mycelium-memoria`, comandos
 *   `/vault-buscar` y `/vault-recordar`, y mapa de cuándo usar cada herramienta.
 */
export const FRAMEWORK_IA_VERSION = "1.2.0";

/** Marcador de versión dentro del vault. */
const RUTA_VERSION = ".claude/mycelium-ia.json";

const CLAUDE_MD = `<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} — generado por Mycelium; se actualiza desde Configuración → Vault -->
# Este vault es tu memoria

Este directorio es un **vault de Mycelium**: un sistema de gestión de conocimiento
(estilo Obsidian) donde todo es texto plano. No lo trates como una carpeta de
documentos sueltos: es una **memoria de largo plazo con estructura de red**,
compartida entre el usuario y vos.

Eso te da dos obligaciones permanentes:

1. **Recuperar antes de responder.** Si la pregunta o la tarea toca algo que este
   vault podría saber (decisiones, proyectos, personas, definiciones, aprendizajes
   previos), **buscá primero en el vault** y respondé con esa evidencia, citando las
   notas con \`[[enlaces]]\`. No improvises sobre algo que la memoria ya contiene.
2. **Consolidar lo que valga recordar.** Cuando se decide algo, se aprende algo o
   se cierra un tema, **escribilo en el vault y enlazalo** con lo relacionado. Lo
   que no queda escrito y enlazado, se pierde: la próxima sesión no lo sabrá.

## Cómo está construida la memoria

| Elemento | Rol en la memoria |
|---|---|
| Nota (\`.md\`) | Una unidad de conocimiento. **Su título ES el nombre del archivo** y funciona como su identificador. |
| \`[[Enlace]]\` | Una **asociación** entre dos ideas. Es lo que convierte notas sueltas en memoria navegable. |
| \`#tag\` | Una **faceta** transversal (tema, estado) que cruza carpetas. |
| Carpeta | Un **área** temática. Organiza, pero no asocia: las asociaciones son los enlaces. |
| Grafo | La vista de la red: hubs (notas muy enlazadas), islas y huérfanas (memoria desconectada). |
| Nota "mapa" (MOC) | Índice de un área: la puerta de entrada para recorrer un tema. |

**El enlace es la unidad de valor.** Una nota sin enlaces es un recuerdo que no se
puede evocar: existe, pero nada lleva hasta él. Por eso, cada vez que escribas,
enlazá; y cada vez que busques, seguí enlaces.

## Protocolo de RECUPERACIÓN (buscar en la memoria)

Cuando necesites información del vault, en este orden:

1. **Entradas**: mirá si hay una nota mapa/índice del área (p. ej. \`Mapa del
   vault\`, \`Índice …\`) y arrancá desde ahí.
2. **Léxico**: buscá los términos de la consulta en todo el vault —
   \`grep -ril "término" --include="*.md" .\` — y también en los **nombres de
   archivo** (un título que coincide suele ser la nota canónica del tema).
3. **Leé las candidatas** completas antes de concluir. No respondas con fragmentos
   de \`grep\` sacados de contexto.
4. **Expandí por asociación** 1–2 saltos: los \`[[enlaces]]\` **salientes** de esas
   notas y sus **backlinks** (quién las menciona:
   \`grep -rl "\\[\\[Título" --include="*.md" .\`). Ahí suele estar el matiz que
   falta: la decisión que revirtió a otra, el detalle en la nota vecina.
5. **Facetas**: si el tema es transversal, buscá el \`#tag\` correspondiente.
6. **Respondé citando**: mencioná de qué nota sale cada afirmación con su
   \`[[enlace]]\`. Si la memoria **no** tiene la respuesta, **decilo explícitamente**
   en vez de rellenar con suposiciones — y ofrecé crear la nota que falta.

## Protocolo de CONSOLIDACIÓN (escribir en la memoria)

Antes de crear: **buscá** (paso 2 de arriba). Si ya existe una nota del tema,
**ampliala** en vez de crear una nueva — la memoria se degrada con duplicados.

Al escribir:

- **Una idea por nota**, con título específico y único (los enlaces resuelven por
  título; dos notas homónimas rompen la memoria).
- **Enlazá hacia afuera**: al menos un \`[[enlace]]\` a algo existente.
- **Enlazá hacia adentro**: agregá la referencia a la nota nueva desde su mapa/
  índice o desde la nota madre. Sin esto queda **huérfana**.
- **Contexto suficiente**: escribí para tu vos futuro, que no recuerda esta
  conversación. Fecha y motivo de una decisión valen más que su enunciado.
- Usá callouts para lo que debe saltar a la vista (\`> [!warning]\`, \`> [!info]\`).

## Tus herramientas aquí

Tenés una **skill de referencia**, una **skill de memoria** y **comandos**. Cuándo
usar cada uno:

| Herramienta | Cuándo |
|---|---|
| skill \`mycelium-vault\` | Referencia de **sintaxis** y de cómo explorar el vault: enlaces, alias, embeds, tags, callouts, Mermaid, KaTeX, \`.mycignore\`. Consultala antes de escribir Markdown en este vault. |
| skill \`mycelium-memoria\` | **Técnicas** de recuperación y consolidación: estrategias de búsqueda, expansión por backlinks, cuándo crear vs ampliar, cómo redactar para recuperación futura. Consultala en tareas de buscar/registrar conocimiento. |
| \`/vault-buscar <pregunta>\` | Responder una pregunta **con evidencia del vault** (recuperación completa + citas). Preferilo a buscar a mano. |
| \`/vault-recordar <qué recordar>\` | Consolidar un hecho/decisión/aprendizaje en la memoria (crea o amplía la nota y la enlaza). |
| \`/vault-nota <título>\` | Crear una nota nueva respetando las convenciones (ubicación, enlaces, no dejarla huérfana). |
| \`/vault-vincular <nota>\` | Reforzar las asociaciones de una nota existente (agrega \`[[enlaces]]\` a lo relacionado). |
| \`/vault-mapa\` | Generar/actualizar el índice general (MOC) del vault. Útil tras incorporar mucho material. |
| \`/vault-huerfanas\` | Auditar la salud de la memoria: notas desconectadas y enlaces rotos. |

## Reglas duras

1. **Títulos únicos**: los \`[[enlaces]]\` resuelven por título, no por ruta.
2. **Renombrar rompe enlaces**: Mycelium todavía NO reescribe los \`[[enlaces]]\` al
   renombrar. Si renombrás, buscá \`[[nombre viejo\` (incluidos alias
   \`[[viejo|…]]\` y embeds \`![[viejo]]\`) y actualizá cada referencia.
3. **Nada huérfano**: toda nota nueva entra a la red con al menos un enlace en cada
   dirección.
4. **No dupliques**: buscá antes de crear; ampliá antes de fragmentar.
5. **Estructura**: usá las carpetas/áreas que ya existen; no crees jerarquías
   paralelas.
6. **Frontmatter YAML** (\`---\` al inicio): podés usarlo para metadatos, pero
   Mycelium **aún no lo interpreta** (lo muestra como texto). Con moderación y
   consistencia.
7. **Idioma**: el dominante del vault.
8. **No toques** \`.mycelium/\` (índice interno + papelera). No edites \`.claude/\`:
   lo regenera Mycelium. Si el usuario regenera y ya hay un archivo suyo, Mycelium
   **no lo pisa**: crea \`nombre (mycelium-ia vX).md\` al lado y un reporte
   \`Conflictos instrucciones IA.md\` en la raíz.
9. **Visibilidad**: lo ignorado por \`.mycignore\` (por defecto, todo directorio que
   empieza con \`.\`) existe en disco pero **no aparece en la app ni en el grafo**.
   No escondas ahí documentación que el usuario deba ver.

## Qué es Mycelium por fuera (conocer, no controlar)

No controlás la aplicación: trabajás sobre sus archivos. Pero es útil saber qué ve
el usuario, porque es el efecto de lo que escribís: editor Markdown con vista en
vivo y de lectura; callouts (\`note\`, \`tip\`, \`important\`, \`warning\`, \`caution\`,
\`info\`, \`success\`, \`error\`, \`danger\`, \`question\`; plegables con \`[!tipo]-\`),
incluso anidados; **grafo de conexiones** global y mini-grafo por nota (tus enlaces
se ven ahí); búsqueda global; panel lateral con pestañas ancladas; **terminal
integrada** (es probable que estés corriendo en ella, con cwd en el vault);
exportación a Markdown/PDF/carpeta; papelera propia; Mermaid (\`\`\`mermaid) y KaTeX
(\`$…$\`). Mycelium detecta tus cambios en disco y refresca la UI solo.
`;

const SKILL_MD = `---
name: mycelium-vault
description: Referencia del vault de Mycelium — sintaxis de vínculos, estructura, metadatos, .mycignore y cómo explorar el vault. Usar al crear, enlazar, renombrar o auditar notas.
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
# Referencia del vault de Mycelium

Este vault es la memoria del usuario y tuya (ver \`CLAUDE.md\`). Esta skill es la
**referencia técnica**: sintaxis exacta y cómo recorrer los archivos. Para las
técnicas de búsqueda/registro, ver la skill \`mycelium-memoria\`.

## Sintaxis (verificada contra Mycelium)

| Elemento | Sintaxis | Notas |
|---|---|---|
| Enlace interno | \`[[Título]]\` | Resuelve por título (nombre de archivo sin \`.md\`) |
| Enlace con alias | \`[[Título\\|alias]]\` | El alias es lo visible |
| Embed de nota | \`![[Título]]\` | Muestra el contenido inline |
| Embed de diagrama | \`![[Título.excalidraw]]\` | Renderiza el dibujo |
| Etiqueta | \`#tag\` | Píldora clicable |
| Callout | \`> [!note] Título\` | Tipos: note, tip, important, warning, caution, info, success, error, danger, question |
| Callout plegable | \`> [!tip]- Título\` | \`-\` plegado, \`+\` desplegado |
| Callout anidado | \`> > [!info]\` | Un nivel de \`>\` por profundidad |
| Mermaid | bloque \`\`\`mermaid | Diagramas de texto |
| Matemáticas | \`$inline$\` / \`$$bloque$$\` | KaTeX |

## Estructura del vault

- **Notas**: \`.md\`. El título de la nota es su nombre de archivo (sin extensión).
- **Diagramas**: \`.excalidraw\` (JSON). No editar a mano salvo pedido explícito.
- **\`.mycelium/\`**: índice interno y papelera (\`.mycelium/.trash/\`). No tocar.
- **\`.claude/\`**: este framework (skills + comandos). Lo regenera Mycelium.
- **\`.mycignore\`** (opcional, raíz): qué ignora Mycelium.

## Recorrer el vault (comandos útiles)

\`\`\`sh
# Todas las notas (excluyendo internos)
grep -rl "" --include="*.md" . | grep -v "^./.mycelium/" | grep -v "^./.claude/"

# Buscar un término (insensible a mayúsculas, con nombre de archivo)
grep -ril "término" --include="*.md" .

# Backlinks de una nota (quién la menciona)
grep -rl "\\[\\[Título" --include="*.md" .

# Enlaces salientes de una nota
grep -o "\\[\\[[^]]*\\]\\]" "ruta/Nota.md"

# Notas por etiqueta
grep -rl "#tema" --include="*.md" .
\`\`\`

- **Huérfanas**: notas sin backlinks y sin enlaces salientes.
- **Enlaces rotos**: \`[[Objetivo]]\` sin archivo \`Objetivo.md\` en el vault
  (contemplar alias \`[[Objetivo|…]]\` y embeds \`![[Objetivo]]\`).

## \`.mycignore\`: qué ve Mycelium

Archivo opcional en la raíz, sintaxis tipo \`.gitignore\` **sin negaciones**:

- \`nombre/\` → directorios con ese nombre en cualquier nivel.
- \`nombre\` → archivos o carpetas con ese nombre en cualquier nivel.
- \`ruta/anidada/\` (con \`/\` interno) → anclada a la raíz del vault.
- \`*\` y \`?\` → comodines dentro de un segmento (\`*.tmp.md\`).
- \`# …\` → comentario.
- Sin archivo, el defecto es \`.*/\` (se ignoran los directorios ocultos).
- \`.mycelium/\` está ignorado **siempre**.

Un archivo ignorado existe en disco (podés leerlo y escribirlo) pero **no aparece
en la app ni en el grafo**. Si el usuario dice que no ve una nota que creaste,
revisá este archivo primero.

## Precauciones

- Renombrar una nota **no** actualiza los \`[[enlaces]]\` que la apuntaban: hacelo vos.
- Mycelium reindexa solo al detectar cambios en disco: no hace falta avisar.
- El frontmatter YAML todavía no se interpreta (se ve como texto).
`;

const SKILL_MEMORIA_MD = `---
name: mycelium-memoria
description: Usar el vault de Mycelium como memoria de largo plazo — cómo BUSCAR conocimiento previo (recuperación, backlinks, expansión por el grafo) y cómo REGISTRARLO para poder recuperarlo después. Usar al responder preguntas sobre el vault o al consolidar decisiones y aprendizajes.
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
# El vault como memoria

Un vault de Mycelium no es un archivo de documentos: es una **red asociativa**.
Recuperar es *navegar asociaciones*, no solo *buscar cadenas de texto*. Registrar
es *dejar caminos* para que el conocimiento pueda evocarse mañana.

## Recuperación en cinco movimientos

1. **Entradas** — buscá notas mapa/índice del área (\`Mapa del vault\`, \`Índice …\`,
   MOCs). Dan el marco y suelen enlazar lo importante.
2. **Léxico** — buscá los términos de la consulta y sus sinónimos:
   \`grep -ril "término" --include="*.md" .\`. Revisá también los **nombres de
   archivo**: un título que coincide es, casi siempre, la nota canónica del tema.
3. **Lectura** — leé las candidatas enteras. Los fragmentos de \`grep\` mienten por
   falta de contexto (negaciones, "esto se descartó", condiciones).
4. **Expansión asociativa** — desde cada nota relevante, seguí:
   - sus \`[[enlaces]]\` salientes (dónde continúa la idea),
   - sus **backlinks** (\`grep -rl "\\[\\[Título" --include="*.md" .\`) — quién la
     usa y para qué; aquí aparecen las decisiones que la afectan.
   Uno o dos saltos suelen bastar; frená cuando deja de aportar.
5. **Síntesis con procedencia** — respondé indicando de qué nota sale cada
   afirmación (\`[[enlace]]\`). Señalá contradicciones entre notas en vez de
   promediarlas, y **decí explícitamente lo que la memoria no contiene**.

### Señales de que falta recuperar más

- La respuesta depende de una fecha, un número o un nombre que no viste escrito.
- Encontraste la conclusión pero no el motivo (buscá la nota de decisión).
- Dos notas dicen cosas distintas y no sabés cuál es posterior.

## Consolidación: escribir para poder recuperar

**Antes de crear, buscá.** Si el tema ya tiene nota, **ampliala**; los duplicados
degradan la memoria (dos verdades parciales, ninguna canónica).

Cuándo crear una nota nueva:

| Situación | Acción |
|---|---|
| Idea nueva y con identidad propia | Nota nueva, título específico |
| Matiz o detalle de algo existente | Ampliar la nota existente |
| Decisión que cambia algo previo | Nota o sección nueva **+ enlace** desde/hacia la anterior, dejando claro qué reemplaza |
| Dato efímero (no vale recordar) | No lo escribas |

Cómo redactar para tu vos futuro:

- **Título como consulta**: elegí el título que usarías para buscarlo dentro de seis
  meses (específico, no genérico).
- **Autosuficiencia**: la nota debe entenderse sin la conversación que la originó.
  Incluí fecha, contexto y por qué, no solo el qué.
- **Asociaciones explícitas**: enlazá lo relacionado y decí *en qué se relaciona*
  ("depende de \`[[X]]\`", "reemplaza a \`[[Y]]\`"). Una lista de enlaces sin razón
  envejece mal.
- **Entrada a la red**: agregá el enlace a la nota nueva desde su mapa/índice o su
  nota madre. Si nadie la enlaza, es memoria inaccesible.
- **Destacá lo crítico** con callouts (\`> [!warning]\`, \`> [!important]\`).

## Mantenimiento de la memoria

- **Huérfanas**: notas sin enlaces en ninguna dirección. Integralas (o proponé
  integrarlas) — usá \`/vault-huerfanas\`.
- **Enlaces rotos**: apuntan a notas que no existen; corregí el título o creá la
  nota faltante.
- **Hubs sobrecargados**: si una nota mapa creció demasiado, dividila por subtemas y
  reenlazá.
- **Al renombrar**: actualizá todos los \`[[enlaces]]\` que la apuntaban (Mycelium
  todavía no lo hace).

## Antipatrones

- Responder de memoria propia cuando el vault tiene la respuesta.
- Crear una nota "por si acaso" sin enlazarla desde ningún lado.
- Volcar transcripciones completas en vez de conocimiento destilado y enlazado.
- Enlazar todo con todo: si cada nota apunta a cada nota, el grafo deja de informar.
`;

const CMD_BUSCAR = `---
description: Responde una pregunta buscando en el vault (recuperación completa) y cita las notas de donde sale cada dato
argument-hint: <pregunta>
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Pregunta: $ARGUMENTS

Aplicá el protocolo de recuperación de la skill \`mycelium-memoria\`:

1. Buscá notas mapa/índice del área para orientarte.
2. Buscá los términos de la pregunta y sus sinónimos en contenido **y** en nombres
   de archivo (\`grep -ril\`), ignorando \`.mycelium/\` y \`.claude/\`.
3. Leé completas las notas candidatas (no concluyas desde fragmentos de grep).
4. Expandí 1–2 saltos por \`[[enlaces]]\` salientes y por **backlinks** de esas
   notas, para capturar decisiones o matices que las afecten.
5. Respondé de forma directa y **citá la procedencia** de cada afirmación con
   \`[[enlaces]]\`. Si hay contradicciones entre notas, mostralas en vez de
   promediarlas.
6. Si la memoria NO tiene la respuesta, decilo explícitamente y ofrecé registrar la
   nota que falta (\`/vault-recordar\`).

No modifiques ningún archivo: este comando solo lee.
`;

const CMD_RECORDAR = `---
description: Consolida un hecho, decisión o aprendizaje en la memoria del vault (crea o amplía la nota y la enlaza)
argument-hint: <qué hay que recordar>
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Recordar: $ARGUMENTS

Aplicá el protocolo de consolidación de la skill \`mycelium-memoria\`:

1. **Buscá primero** si el tema ya tiene una nota (contenido y nombres de archivo).
2. Decidí y explicá la decisión:
   - existe → **ampliar** esa nota (sin duplicar ni contradecir en silencio);
   - es una idea con identidad propia → **nota nueva** con título específico y único;
   - reemplaza algo previo → registralo **enlazando** a la nota anterior y aclarando
     qué queda superado.
3. Escribí de forma autosuficiente: contexto, fecha y **por qué**, no solo el qué.
4. Enlazá: \`[[enlaces]]\` a lo relacionado (con la razón del vínculo) y agregá la
   referencia a esta nota desde su mapa/índice o nota madre para que no quede
   huérfana.
5. Informá al usuario: qué escribiste, dónde, y qué enlaces creaste.
`;

const CMD_MAPA = `---
description: Genera o actualiza el "Mapa del vault" (MOC) con las áreas y notas principales enlazadas
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Recorré el vault (ignorando \`.mycelium/\` y \`.claude/\`) y generá o actualizá la
nota **Mapa del vault.md** en la raíz. Es la **puerta de entrada** de la memoria:
la usarás vos mismo para orientarte en futuras recuperaciones.

1. Agrupá por carpeta/área temática.
2. Por cada área, listá sus notas clave como \`[[enlaces]]\` con una línea de
   descripción (leé lo necesario para describir bien, no inventes).
3. Marcá con ⚠ las notas huérfanas (sin enlaces entrantes) para visibilizarlas.
4. Mantené el mapa conciso: es un índice navegable, no un resumen del contenido.

Si el mapa ya existe, actualizalo preservando anotaciones manuales del usuario.
`;

const CMD_VINCULAR = `---
description: Analiza una nota y agrega enlaces [[...]] hacia las notas relacionadas del vault
argument-hint: <título o ruta de la nota>
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Nota objetivo: $ARGUMENTS

Objetivo: fortalecer las **asociaciones** de esta nota para que pueda recuperarse
desde varios caminos.

1. Leé la nota objetivo y extraé sus conceptos/nombres clave.
2. Buscá en el vault (grep por esos términos, ignorando \`.mycelium/\` y
   \`.claude/\`) notas relacionadas que EXISTAN.
3. Convertí en \`[[enlaces]]\` las menciones directas de títulos existentes dentro
   del texto (sin cambiar la redacción).
4. Si hay notas relacionadas no mencionadas, agregá al final una sección
   \`## Relacionadas\` con esos \`[[enlaces]]\` **y la razón** de cada vínculo.
5. Evaluá agregar el enlace inverso en las notas destino (una asociación útil suele
   valer en los dos sentidos). Mostrá un resumen de qué enlazaste y por qué.
`;

const CMD_HUERFANAS = `---
description: Audita el grafo del vault — notas huérfanas y enlaces rotos — y propone cómo integrarlas
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Auditá la **salud de la memoria** (ignorando \`.mycelium/\` y \`.claude/\`): una nota
desconectada es conocimiento que no se puede evocar.

1. **Huérfanas**: notas sin enlaces entrantes ni salientes. Listalas con su ruta.
2. **Enlaces rotos**: \`[[Objetivo]]\` cuyo archivo \`Objetivo.md\` no existe
   (contemplá alias \`[[Objetivo|...]]\` y embeds \`![[Objetivo]]\`). Indicá en qué
   nota está cada uno.
3. Para cada huérfana, proponé desde qué nota existente convendría enlazarla.
4. Para cada enlace roto, proponé la corrección (¿typo de un título existente?
   ¿nota que falta crear?).

NO apliques cambios automáticamente: presentá el reporte y aplicá solo lo que el
usuario confirme.
`;

const CMD_NOTA = `---
description: Crea una nota nueva siguiendo las convenciones del vault (ubicación, enlaces, formato)
argument-hint: <título> [tema o carpeta]
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Crear la nota: $ARGUMENTS

1. **Buscá primero**: verificá que no exista ya una nota de ese tema o con ese
   título (los \`[[enlaces]]\` resuelven por título: deben ser únicos). Si existe,
   avisá y proponé ampliarla en vez de duplicar.
2. Elegí la carpeta temática adecuada según la estructura actual (si el usuario
   indicó una, usala).
3. Redactá contenido **autosuficiente** (se entiende sin esta conversación) con la
   sintaxis de Mycelium: callouts para avisos, \`[[enlaces]]\` en las menciones a
   notas existentes.
4. Cerrá con \`## Relacionadas\` si hay notas afines, indicando la razón del vínculo.
5. Agregá un \`[[enlace]]\` hacia la nota nueva desde su índice/mapa o nota madre
   (que no quede huérfana). Informá dónde la creaste y desde dónde la enlazaste.
`;

/** Marcador de versión (JSON) que se escribe en el vault. */
const versionJson = () =>
  JSON.stringify({ version: FRAMEWORK_IA_VERSION, generado: new Date().toISOString() }, null, 2) +
  "\n";

/** Marca presente en todo archivo generado por el framework. */
const MARCA_FRAMEWORK = "<!-- mycelium-ia v";

/** Reporte de conflictos que se escribe en la raíz del vault. */
const RUTA_REPORTE = "Conflictos instrucciones IA.md";

/** Un archivo del framework que no pudo escribirse en su ruta original. */
export type ConflictoIa = { original: string; generado: string };

/** Archivos que componen el framework (ruta relativa al vault → contenido). */
export function archivosFramework(): { ruta: string; contenido: string }[] {
  return [
    { ruta: "CLAUDE.md", contenido: CLAUDE_MD },
    { ruta: ".claude/skills/mycelium-vault/SKILL.md", contenido: SKILL_MD },
    { ruta: ".claude/skills/mycelium-memoria/SKILL.md", contenido: SKILL_MEMORIA_MD },
    { ruta: ".claude/commands/vault-buscar.md", contenido: CMD_BUSCAR },
    { ruta: ".claude/commands/vault-recordar.md", contenido: CMD_RECORDAR },
    { ruta: ".claude/commands/vault-mapa.md", contenido: CMD_MAPA },
    { ruta: ".claude/commands/vault-vincular.md", contenido: CMD_VINCULAR },
    { ruta: ".claude/commands/vault-huerfanas.md", contenido: CMD_HUERFANAS },
    { ruta: ".claude/commands/vault-nota.md", contenido: CMD_NOTA },
  ];
}

async function leerTexto(vaultRuta: string, rutaRel: string): Promise<string | null> {
  try {
    return await invoke<string | null>("leer_archivo_texto", { vaultRuta, rutaRel });
  } catch {
    return null;
  }
}

/** Versión del framework instalada en el vault, o null si no está generado. */
export async function versionInstalada(vaultRuta: string): Promise<string | null> {
  const crudo = await leerTexto(vaultRuta, RUTA_VERSION);
  if (!crudo) return null;
  try {
    return (JSON.parse(crudo) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/** `carpeta/nombre (sufijo).ext` a partir de `carpeta/nombre.ext`. */
function conSufijo(ruta: string, sufijo: string): string {
  const punto = ruta.lastIndexOf(".");
  const barra = ruta.lastIndexOf("/");
  if (punto <= barra) return `${ruta} (${sufijo})`;
  return `${ruta.slice(0, punto)} (${sufijo})${ruta.slice(punto)}`;
}

/**
 * Ruta alternativa LIBRE para un archivo en conflicto: primero
 * `nombre (mycelium-ia vX).ext`; si también existe, `… (1)`, `… (2)`, etc.
 */
async function rutaAlternativa(vaultRuta: string, ruta: string): Promise<string> {
  const base = conSufijo(ruta, `mycelium-ia v${FRAMEWORK_IA_VERSION}`);
  if ((await leerTexto(vaultRuta, base)) === null) return base;
  for (let n = 1; ; n++) {
    const candidata = conSufijo(base, String(n));
    if ((await leerTexto(vaultRuta, candidata)) === null) return candidata;
  }
}

/**
 * Genera (o actualiza) el framework IA en el vault SIN pisar archivos del
 * usuario:
 * - Si la ruta está libre, se escribe normalmente.
 * - Si existe un archivo GENERADO por el framework (lleva la marca
 *   `<!-- mycelium-ia … -->`), se sobrescribe (es la actualización esperada).
 * - Si existe un archivo del usuario (sin la marca), NO se toca: la versión
 *   nueva se escribe al lado como `nombre (mycelium-ia vX).ext` (con `(1)`,
 *   `(2)`… si hiciera falta) para que el usuario la integre a mano.
 * Si hubo conflictos, escribe además un reporte en la raíz
 * (`Conflictos instrucciones IA.md`) con archivos y rutas.
 */
export async function generarFramework(vaultRuta: string): Promise<ConflictoIa[]> {
  const conflictos: ConflictoIa[] = [];

  for (const archivo of archivosFramework()) {
    const existente = await leerTexto(vaultRuta, archivo.ruta);
    let destino = archivo.ruta;
    if (existente !== null && !existente.includes(MARCA_FRAMEWORK)) {
      destino = await rutaAlternativa(vaultRuta, archivo.ruta);
      conflictos.push({ original: archivo.ruta, generado: destino });
    }
    await invoke("escribir_nota", {
      vaultRuta,
      rutaRel: destino,
      contenido: archivo.contenido,
    });
  }

  // Marcador de versión: es siempre del framework, se sobrescribe.
  await invoke("escribir_nota", {
    vaultRuta,
    rutaRel: RUTA_VERSION,
    contenido: versionJson(),
  });

  if (conflictos.length > 0) {
    const lineas = conflictos
      .map((c) => `- \`${c.original}\` ya existía → generado como \`${c.generado}\``)
      .join("\n");
    const reporte =
      `${MARCA_FRAMEWORK}${FRAMEWORK_IA_VERSION} -->\n# Conflictos al generar las instrucciones IA\n\n` +
      `Estos archivos ya existían en el vault y NO se tocaron; la versión del\n` +
      `framework se generó al lado para que la integres o renombres a mano:\n\n` +
      `${lineas}\n`;
    await invoke("escribir_nota", { vaultRuta, rutaRel: RUTA_REPORTE, contenido: reporte });
  }

  return conflictos;
}
