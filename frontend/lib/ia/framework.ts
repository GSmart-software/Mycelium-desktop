import { invoke } from "@tauri-apps/api/core";

/**
 * Framework IA del vault (FUN-L-08, solo-desktop). Genera en el vault un conjunto
 * VERSIONADO de instrucciones para asistentes de IA por terminal (Claude Code):
 * `CLAUDE.md` + skill de referencia + comandos, para que la IA entienda cómo
 * navegar la documentación de Mycelium (vínculos, extensiones, metadatos y
 * funciones del sistema — conocerlas, no controlarlas).
 *
 * El contenido evoluciona con Mycelium: al agregar funciones que la IA deba
 * conocer, subir `FRAMEWORK_IA_VERSION` y actualizar los templates. El botón de
 * Configuración detecta la versión instalada en el vault y ofrece actualizar.
 */

/** Versión del framework generado (independiente de la versión de la app). */
export const FRAMEWORK_IA_VERSION = "1.0.0";

/** Marcador de versión dentro del vault. */
const RUTA_VERSION = ".claude/mycelium-ia.json";

const CLAUDE_MD = `<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} — generado por Mycelium; se actualiza desde Configuración → Vault -->
# Este vault es un vault de Mycelium

Mycelium es un sistema de gestión de conocimiento (estilo Obsidian): todo el
contenido son archivos de texto plano en esta carpeta. Tu rol como asistente es
ayudar a crear, organizar y navegar esta documentación **aprovechando los
vínculos entre notas**: cada enlace construye el grafo de conocimiento del vault
(su "memoria" navegable). Antes de trabajar, lee la skill \`mycelium-vault\` para
la referencia completa de sintaxis y convenciones.

## Estructura

- **Notas**: archivos \`.md\`. El **título de la nota ES su nombre de archivo**
  (sin extensión). Las carpetas organizan la jerarquía.
- **Diagramas**: archivos \`.excalidraw\` (JSON de Excalidraw). No los edites a
  mano salvo pedido explícito.
- **\`.mycelium/\`**: índice interno de Mycelium y su papelera
  (\`.mycelium/.trash/\`). **NUNCA lo modifiques ni lo borres.**
- **\`.claude/\`**: este framework de instrucciones (skill + comandos).

## Vínculos — el corazón del vault

- \`[[Título de nota]]\` enlaza a la nota con ese título; \`[[Título|alias]]\`
  muestra el alias. Los enlaces resuelven por **título**, no por ruta.
- \`![[Título]]\` embebe el contenido; \`![[Título.excalidraw]]\` embebe un diagrama.
- \`#tag\` crea una etiqueta.
- **Cada wikilink es una arista del grafo** que Mycelium visualiza. Al crear o
  editar notas, enlaza SIEMPRE las notas relacionadas (y desde ellas hacia la
  nueva): una nota sin vínculos es un nodo perdido.

## Reglas para la IA

1. **Títulos únicos**: los \`[[enlaces]]\` resuelven por título; evita crear dos
   notas con el mismo nombre (aunque estén en carpetas distintas).
2. **Renombrar rompe enlaces**: Mycelium aún NO reescribe los \`[[enlaces]]\` al
   renombrar una nota. Si renombrás una, buscá (\`grep\`) todas las referencias
   \`[[nombre viejo]]\` y actualizalas.
3. **No dejes huérfanas**: al crear una nota, agrégale al menos un enlace saliente
   y enlázala desde alguna nota existente (índice, mapa o nota relacionada).
4. **Respetá la estructura**: creá las notas en la carpeta temática que
   corresponda; no inventes jerarquías paralelas.
5. **Frontmatter YAML** (\`---\` al inicio): podés usarlo para metadatos (tags,
   fecha, estado…), pero Mycelium todavía **no lo interpreta** — lo muestra como
   texto. Usalo con moderación y consistencia.
6. **Idioma**: escribí en el idioma dominante del vault.
7. **No toques** \`.mycelium/\` ni edites \`.claude/\` (se regenera desde Mycelium).

## Qué sabe hacer Mycelium (conocimiento, no control)

No controlás la aplicación; solo trabajás sobre sus archivos. Pero conviene saber
qué verá el usuario: editor Markdown con vista en vivo y vista de lectura;
callouts (\`> [!note]\`, \`tip\`, \`important\`, \`warning\`, \`caution\`, \`info\`,
\`success\`, \`error\`, \`danger\`, \`question\`; plegables con \`[!tipo]-\`), incluso
anidados; **grafo de conexiones** global y mini-grafo por nota (tus enlaces se ven
ahí); búsqueda global; panel lateral con pestañas ancladas; **terminal integrada**
(probablemente estás corriendo en ella, con cwd en el vault); exportación a
Markdown/PDF/carpeta; papelera propia; Mermaid en bloques \`\`\`mermaid y KaTeX
\`$...$\`. Mycelium detecta los cambios que hagas en disco y refresca la UI solo.
`;

const SKILL_MD = `---
name: mycelium-vault
description: Referencia del vault de Mycelium — sintaxis de vínculos, estructura, metadatos y flujos para navegar y mantener la documentación. Usar al crear, enlazar, renombrar o auditar notas.
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
# Trabajar en un vault de Mycelium

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

## Cómo explorar el vault

- Árbol: listá \`.md\`/\`.excalidraw\` ignorando \`.mycelium/\` y \`.claude/\`.
- Backlinks de una nota: \`grep -rl "[[Título" --include="*.md" .\`
- Enlaces salientes: buscá \`[[...]]\` dentro del archivo.
- Huérfanas: notas que no aparecen en ningún \`[[...]]\` de otras y no contienen
  enlaces. Son nodos sueltos del grafo: intégralas o proponé integrarlas.
- Enlaces rotos: \`[[Objetivo]]\` sin archivo \`Objetivo.md\` en el vault.

## Flujos recomendados

1. **Crear una nota**: elegí carpeta temática → título único → contenido con
   \`[[enlaces]]\` a lo relacionado → agregá un enlace hacia ella desde su índice o
   nota madre.
2. **Renombrar**: renombrá el archivo → \`grep\` de \`[[nombre viejo\` → actualizá
   cada referencia (incluidos alias \`[[viejo|...]]\` y embeds \`![[viejo]]\`).
3. **Documentar un proyecto**: mantené una nota "mapa" (MOC) por área que enlace
   las notas del tema; el grafo la mostrará como hub.
4. **Responder preguntas del usuario sobre su vault**: buscá primero en las notas
   (evidencia), citá de qué nota sale cada cosa con su \`[[enlace]]\`.

## Precauciones

- No editar \`.mycelium/\` (índice/papelera de Mycelium) ni \`.claude/\`.
- Mycelium reindexa solo al detectar cambios en disco: no hace falta avisar.
- El frontmatter YAML no es interpretado aún por Mycelium (se ve como texto).
`;

const CMD_MAPA = `---
description: Genera o actualiza el "Mapa del vault" (MOC) con las áreas y notas principales enlazadas
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Recorré el vault (ignorando \`.mycelium/\` y \`.claude/\`) y generá o actualizá la
nota **Mapa del vault.md** en la raíz:

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

1. Leé la nota objetivo y extraé sus conceptos/nombres clave.
2. Buscá en el vault (grep por esos términos, ignorando \`.mycelium/\` y
   \`.claude/\`) notas relacionadas que EXISTAN.
3. Convertí en \`[[enlaces]]\` las menciones directas de títulos existentes dentro
   del texto (sin cambiar la redacción).
4. Si hay notas relacionadas no mencionadas, agregá al final una sección
   \`## Relacionadas\` con esos \`[[enlaces]]\` y una razón breve por enlace.
5. Evaluá agregar el enlace inverso en las notas destino si tienen sección de
   relacionadas. Mostrá un resumen de qué enlazaste y por qué.
`;

const CMD_HUERFANAS = `---
description: Audita el grafo del vault — notas huérfanas y enlaces rotos — y propone cómo integrarlas
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
Auditá la salud del grafo del vault (ignorando \`.mycelium/\` y \`.claude/\`):

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

1. Verificá que no exista ya una nota con ese título (los \`[[enlaces]]\` resuelven
   por título: deben ser únicos). Si existe, avisá y proponé otro título.
2. Elegí la carpeta temática adecuada según la estructura actual (si el usuario
   indicó una, usala).
3. Redactá el contenido con la sintaxis de Mycelium (callouts para avisos,
   \`[[enlaces]]\` en las menciones a notas existentes).
4. Cerrá con una sección \`## Relacionadas\` si hay notas afines.
5. Agregá un \`[[enlace]]\` hacia la nota nueva desde su índice/mapa o nota madre
   (que no quede huérfana). Informá dónde la creaste y desde dónde la enlazaste.
`;

/** Marcador de versión (JSON) que se escribe en el vault. */
const versionJson = () =>
  JSON.stringify({ version: FRAMEWORK_IA_VERSION, generado: new Date().toISOString() }, null, 2) +
  "\n";

/** Archivos que componen el framework (ruta relativa al vault → contenido). */
export function archivosFramework(): { ruta: string; contenido: string }[] {
  return [
    { ruta: "CLAUDE.md", contenido: CLAUDE_MD },
    { ruta: ".claude/skills/mycelium-vault/SKILL.md", contenido: SKILL_MD },
    { ruta: ".claude/commands/vault-mapa.md", contenido: CMD_MAPA },
    { ruta: ".claude/commands/vault-vincular.md", contenido: CMD_VINCULAR },
    { ruta: ".claude/commands/vault-huerfanas.md", contenido: CMD_HUERFANAS },
    { ruta: ".claude/commands/vault-nota.md", contenido: CMD_NOTA },
    { ruta: RUTA_VERSION, contenido: versionJson() },
  ];
}

/** Versión del framework instalada en el vault, o null si no está generado. */
export async function versionInstalada(vaultRuta: string): Promise<string | null> {
  try {
    const crudo = await invoke<string | null>("leer_archivo_texto", {
      vaultRuta,
      rutaRel: RUTA_VERSION,
    });
    if (!crudo) return null;
    const dato = JSON.parse(crudo) as { version?: string };
    return dato.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Genera (o regenera) el framework IA en el vault. Sobrescribe los archivos del
 * framework; no toca nada más del vault.
 */
export async function generarFramework(vaultRuta: string): Promise<void> {
  for (const archivo of archivosFramework()) {
    await invoke("escribir_nota", {
      vaultRuta,
      rutaRel: archivo.ruta,
      contenido: archivo.contenido,
    });
  }
}
