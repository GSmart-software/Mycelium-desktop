import { invoke } from "@tauri-apps/api/core";
import { MARCADOR_VERSION_IA, SKILLS_GENERADAS } from "./skillsGeneradas";

/**
 * Framework IA del vault (FUN-L-08, solo-desktop). Genera en el vault un conjunto
 * VERSIONADO de instrucciones para asistentes de IA por terminal (Claude Code):
 * un **bloque gestionado** dentro de `CLAUDE.md` + skills + comandos.
 *
 * Eje del framework: el vault **es la memoria de largo plazo** de la IA, no un
 * repositorio de documentos a ordenar. De ahí los dos protocolos que enseña —
 * RECUPERAR antes de responder (buscar en la red de notas, expandir por
 * backlinks, citar procedencia) y CONSOLIDAR lo que valga recordar (escribir
 * autosuficiente y enlazado) — más el mapa de cuándo usar cada skill/comando.
 *
 * Por capas (`FUN-L-29`, 2.0.0): en `CLAUDE.md`, que se carga en CADA sesión,
 * va solo un **núcleo** de ~2 KB (las dos obligaciones, las reglas duras y un
 * puntero por skill) entre `<!-- mycelium:inicio vX -->` y `<!-- mycelium:fin -->`;
 * el resto vive en skills, que la IA carga cuando las necesita, y en la
 * `description` de cada herramienta del MCP. Mycelium reescribe solo lo que hay
 * entre los marcadores y los archivos con prefijo `mycelium`; todo lo demás es
 * del usuario y no se toca.
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
 * - 1.2.1 — corrección de texto: al cambiar el default de `.mycignore`
 *   (`FUN-M-12`), los templates que lo describían quedaron mintiendo. Se
 *   actualizan la regla 9 del `CLAUDE.md` y la sección `.mycignore` de la skill
 *   `mycelium-vault`. **Patch**: el framework no gana instrucciones nuevas.
 * - 1.3.0 — **propiedades del frontmatter** (`FUN-M-04`): hasta 1.2.1 los
 *   templates afirmaban que el frontmatter YAML no se interpreta, que pasó a ser
 *   falso. La regla dura 6 del `CLAUDE.md` y la skill `mycelium-vault` describen
 *   ahora el subconjunto soportado, que `tags:` son etiquetas de la nota y que
 *   los valores se consultan con `clave:valor`. **Minor**: la IA gana
 *   instrucciones sobre una capacidad nueva del vault.
 * - 1.4.0 — **Esporas** (`FUN-M-03`): el vault puede tener una carpeta cuyas
 *   notas NO son conocimiento sino MOLDES. La IA debe saberlo para no tratarlas
 *   como notas normales (no consolidar ahí, no reportarlas como huérfanas) y
 *   para poder ofrecerlas al crear una nota. Se documenta qué es una Espora,
 *   dónde vive, que la carpeta es configurable y qué variables admite.
 *   **Minor**: conocimiento nuevo, no una corrección.
 * - 1.5.0 — **el vault dejó de ser solo notas**, y los templates seguían
 *   describiendo uno que sí lo era. Se documentan los tipos de archivo que la IA
 *   puede crear y editar —`.base` (tablas consultables), `.canvas` (notas en el
 *   espacio), `.excalidraw`— y los que el vault **lista pero no indexa** (PDF,
 *   imágenes, código), que es lo que más importa para recuperar: un `grep` los
 *   encuentra y el grafo no, así que no se pueden citar como si fueran notas.
 *
 *   Corrige además la regla dura 2, que mentía desde `FUN-M-08`: Mycelium **sí**
 *   repara los `[[enlaces]]` al renombrar. Pero solo cuando el renombrado pasa
 *   por la app — un `mv` desde la terminal no lo hace, y la IA renombra así. La
 *   regla pasa a decir esa diferencia, que es la que la afecta.
 *
 *   **Minor**: conocimiento nuevo sobre capacidades del vault, con una
 *   corrección absorbida.
 * - 1.6.0 — **diagramas de draw.io** (`FUN-L-20`): el vault gana un tipo de
 *   archivo más, `.drawio` (XML de mxGraph). La IA tiene que saber que existe
 *   —si no, lo trata como un archivo cualquiera— y, sobre todo, que **no se
 *   edita a mano**: es el mismo trato que `.excalidraw`, y por el mismo motivo
 *   (lo escribe una herramienta, y tocar el XML a ciegas rompe el diagrama).
 *   Tampoco se indexa, como el resto de lo que no es `.md`.
 *   **Minor**: un tipo de archivo nuevo que la IA se va a encontrar.
 * - 1.7.0 — **una skill por herramienta** (`FUN-L-26`): `mycelium-drawio`,
 *   `mycelium-canvas`, `mycelium-excalidraw`, `mycelium-base`,
 *   `mycelium-esporas` y `mycelium-calendario`. La IA pasa de saber que esos
 *   formatos existen a **crearlos y modificarlos** bien —geometría, flechas
 *   enganchadas, texto que entra— y a **consultar el calendario** (solo
 *   lectura: la regla 8 admite leer `.mycelium/recordatorios.json` y
 *   `.mycelium/preferencias.json`). Las skills de draw.io, canvas y Excalidraw
 *   llevan su validador (`validar-<formato>.mjs`, sin dependencias) para que la
 *   IA compruebe lo que escribió; la de Excalidraw lleva además su generador
 *   (`dibujo.mjs`). `.drawio` y `.excalidraw` dejan de ser «no
 *   editar a mano». También: las pestañas de lienzos, diagramas y dibujos se
 *   recargan desde disco, así que «Mycelium refresca la UI solo» es cierto para
 *   ellos. `mycelium-vault` adelgaza (bases, lienzos y Esporas remiten a su
 *   skill) y se corrigen dos errores: el `.canvas` **sí** aporta aristas al
 *   grafo, y renombrar desde la app **sí** repara los enlaces.
 *   El contenido de las seis skills y sus validadores sale de
 *   `lib/ia/borradores/` y `scripts/validar-*.mjs` por `scripts/generar-skills-ia.mjs`
 *   (`lib/ia/skillsGeneradas.ts`); no se copia a mano.
 *   **Minor**: la IA gana capacidades nuevas.
 *
 *   La misma `1.7.0` (todavía sin publicar: un release lleva un solo
 *   incremento) suma el **MCP de control** (`FUN-L-09`), por partes. Parte 1:
 *   la sección «Operar Mycelium» del `CLAUDE.md` —la línea divisoria entre el
 *   contenido (archivos) y operar la app (herramientas `mycelium_*`), con una
 *   tabla a la que las partes 2–4 agregan filas— y el `.mcp.json`, que no es un
 *   template: lo escribe `lib/mcpControl.ts` al encender el control o al
 *   generar con el control encendido. Parte 2: el **calendario** por MCP
 *   (`mycelium_recordatorios` y `mycelium_recordatorio_*`) en «Operar
 *   Mycelium», la regla 8 (el calendario se modifica **solo** con esas
 *   herramientas) y la skill `mycelium-calendario`, que deja de ser solo
 *   lectura: lee preferentemente por MCP y modifica únicamente por MCP.
 *   Parte 3: **archivos** por MCP (`mycelium_renombrar`, `_mover`, `_borrar`,
 *   `_papelera`) en «Operar Mycelium», la **regla dura 2** al revés —para
 *   renombrar o mover, la herramienta; `mv` solo sin MCP, y entonces los
 *   enlaces los arregla la IA—, qué hacer con un `RECHAZADO`, y un **hook
 *   `PreToolUse`** (`lib/ia/hookMvRm.ts`) que frena `mv`/`rm` sobre notas. El
 *   hook, como el `.mcp.json`, no es un template: lo instala `lib/mcpControl.ts`
 *   solo con el control encendido, fusionándolo con el `.claude/settings.json`
 *   del usuario. Parte 4: el **diccionario del vault** por MCP
 *   (`mycelium_diccionario`) en «Operar Mycelium» —cuándo usarlo: los términos
 *   propios del vault— y en la regla 8: `.mycelium/diccionario.txt` no se
 *   escribe a mano.
 * - 1.8.0 — **estados de tarea** (`FUN-S-01`): el símbolo dentro de `[ ]`
 *   (`-`, `/`, `>`, `*`, `!`, `?`, `+`, además de espacio y `x`) es el estado
 *   de la tarea, con los símbolos de Obsidian, y Mycelium lo dibuja. La IA
 *   tiene que saberlo para escribir —y leer— una tarea cancelada o en curso
 *   con el símbolo, en vez de inventar otra marca. Va en la tabla de sintaxis
 *   de `mycelium-vault`.
 *   **Minor**: conocimiento nuevo sobre la sintaxis del vault.
 * - 1.8.1 — **la tabla de sintaxis decía dos cosas que Mycelium no hace**
 *   (`DEF-131`): que \`![[Título]]\` de una nota muestra su contenido (el embed
 *   de notas nunca se implementó, `FUN-M-37`) y que una \`#etiqueta\` es una
 *   píldora clicable (el clic no hace nada; la vista de etiquetas quedó
 *   semidescartada). La IA podía prometerle al usuario algo que no iba a ver.
 *   **Patch**: corrige texto, no suma conocimiento.
 * - 2.0.0 — **instrucciones por capas** (`FUN-L-29`). Cambia dónde y cómo se
 *   instala:
 *   - `CLAUDE.md` deja de ser un archivo de Mycelium: lleva un **bloque
 *     gestionado** (`<!-- mycelium:inicio vX -->` … `<!-- mycelium:fin -->`) y
 *     Mycelium reescribe solo eso. Un `CLAUDE.md` propio recibe el bloque al
 *     principio; uno que generó entero una versión anterior, sin tocar, se
 *     reemplaza por el bloque. Desaparecen `CLAUDE (mycelium-ia vX).md` y
 *     `Conflictos instrucciones IA.md`.
 *   - El bloque es un **núcleo de ~2 KB** (pesaba ~20 KB y se cargaba en cada
 *     sesión): lo demás pasa a `mycelium-vault` (tipos de archivo, qué ve el
 *     usuario), a `mycelium-memoria` (la anatomía de la memoria y los
 *     protocolos) y a una skill nueva, `mycelium-operar` (el MCP de control).
 *     La tabla «Querés… / Herramienta» se va: lo dice la `description` de cada
 *     herramienta del MCP.
 *   - Todo lo de Mycelium lleva prefijo `mycelium`: los comandos pasan a
 *     `.claude/commands/mycelium/` (siguen llamándose `/vault-*`). La regla
 *     pasa de «no edites `.claude/`» a «no edites lo que lleva prefijo
 *     `mycelium`». Los comandos viejos sin tocar se borran al regenerar.
 *   - `.mycignore` admite negaciones `!` (`FUN-S-30`).
 *   **Major**: cambia dónde se instala y qué es de quién.
 */
export const FRAMEWORK_IA_VERSION = "2.0.0";

/** Marcador de versión dentro del vault. */
const RUTA_VERSION = ".claude/mycelium-ia.json";

/**
 * El NÚCLEO: lo único que va en `CLAUDE.md`, dentro del bloque gestionado
 * (`bloqueGestionado`). Se carga en CADA sesión, así que se mide en bytes: las
 * dos obligaciones, las reglas duras en una línea cada una y un puntero por
 * skill (`FUN-L-29`). `scripts/test-framework-ia.mjs` falla si el bloque pasa de
 * 2,5 KB. Lo que no entra acá va a una skill: no se agranda el núcleo.
 */
const NUCLEO = `# Este vault es tu memoria

Vault de **Mycelium**: notas Markdown unidas por \`[[enlaces]]\`, estilo Obsidian. Es tu
memoria de largo plazo, compartida con el usuario. Dos obligaciones:

1. **Recuperá antes de responder.** Si el vault puede saberlo, buscá, leé las notas
   enteras, seguí enlaces y backlinks, y citá con \`[[Título]]\`. Si no está, decilo.
2. **Consolidá lo que valga recordar.** Lo que se decide, se aprende o se cierra:
   escribilo y enlazalo, con fecha y motivo.

## Reglas duras

1. **Títulos únicos**: los enlaces resuelven por título, no por ruta.
2. **Renombrar, mover, borrar**: con \`mycelium_renombrar\`, \`_mover\`, \`_borrar\`; \`mv\` o
   \`rm\` solo sin MCP, y los enlaces los arreglás vos.
3. **Nada huérfano**: toda nota nueva enlaza a algo y la enlaza su mapa o nota madre.
4. **No dupliques**: buscá antes de crear; ampliá antes que fragmentar.
5. **Estructura**: usá las carpetas que ya existen.
6. **Propiedades**: frontmatter plano; reusá las claves del vault.
7. **Idioma**: el del vault.
8. **Solo los \`.md\` son memoria**: un \`.py\` o un \`.csv\` no se cita con \`[[ ]]\`.
9. **\`.mycelium/\`**: no se escribe nunca; calendario y diccionario, solo por MCP.
10. **Lo que lleva prefijo \`mycelium\`** (este bloque, \`.claude/**/mycelium*\`) no se
    edita: lo regenera Mycelium. Lo demás de \`CLAUDE.md\` y \`.claude/\` es del usuario.
11. **\`.mycignore\`** oculta de la app: no escondas ahí lo que el usuario deba ver.
12. **Esporas**: son moldes, no memoria. No consolides ni cites ahí.

## Skills: cargá la que toque

- \`mycelium-memoria\`: buscar y registrar a fondo.
- \`mycelium-vault\`: sintaxis, propiedades, tipos de archivo, qué ve el usuario.
- \`mycelium-operar\`: las herramientas \`mycelium_*\`, y qué hacer sin ellas.
- \`mycelium-base\`: tablas \`.base\`.
- \`mycelium-canvas\`: lienzos \`.canvas\`.
- \`mycelium-drawio\`: diagramas \`.drawio\`.
- \`mycelium-excalidraw\`: dibujos \`.excalidraw\`.
- \`mycelium-esporas\`: notas desde una plantilla.
- \`mycelium-calendario\`: agenda y recordatorios.

Comandos: \`/vault-buscar\`, \`/vault-recordar\`, \`/vault-nota\`, \`/vault-vincular\`,
\`/vault-mapa\`, \`/vault-huerfanas\`.
`;

const SKILL_MD = `---
name: mycelium-vault
description: Referencia del vault de Mycelium — sintaxis de vínculos, tipos de archivo y cuáles están en la memoria, metadatos, .mycignore, qué ve el usuario en la app y cómo explorar el vault. Usar al crear, enlazar, renombrar o auditar notas, o antes de escribir en el vault.
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
# Referencia del vault de Mycelium

Este vault es la memoria del usuario y tuya (ver el bloque de Mycelium en \`CLAUDE.md\`).
Esta skill es la **referencia técnica**: sintaxis exacta, qué hay en el vault, qué ve el
usuario y cómo recorrer los archivos. Para las técnicas de búsqueda y registro, ver la
skill \`mycelium-memoria\`; para operar la app, \`mycelium-operar\`.

## Sintaxis (verificada contra Mycelium)

| Elemento | Sintaxis | Notas |
|---|---|---|
| Enlace interno | \`[[Título]]\` | Resuelve por título (nombre de archivo sin \`.md\`) |
| Enlace con alias | \`[[Título\\|alias]]\` | El alias es lo visible |
| Embed de nota | \`![[Título]]\` | **No se dibuja**: se ve como \`!\` y un enlace común. Para relacionar notas, enlazá con \`[[Título]]\` |
| Embed de diagrama | \`![[Título.excalidraw]]\` / \`![[Título.drawio]]\` | Renderiza el dibujo o el diagrama |
| Etiqueta | \`#tag\` | Faceta de la nota; se busca con \`tag:x\`. Hacer clic en ella no hace nada |
| Propiedades | bloque \`---\` al inicio | Mapa plano \`clave: valor\` (ver abajo) |
| Callout | \`> [!note] Título\` | Tipos: note, tip, important, warning, caution, info, success, error, danger, question |
| Callout plegable | \`> [!tip]- Título\` | \`-\` plegado, \`+\` desplegado |
| Callout anidado | \`> > [!info]\` | Un nivel de \`>\` por profundidad |
| Tarea | \`- [ ] algo\` / \`- [x] algo\` | El símbolo entre corchetes es el **estado** (abajo) |
| Mermaid | bloque \`\`\`mermaid | Diagramas de texto |
| Matemáticas | \`$inline$\` / \`$$bloque$$\` | KaTeX |

### Estados de tarea

El carácter dentro de \`[ ]\` dice el estado de la tarea; son los mismos símbolos
que usan los temas de Obsidian, así que el vault sigue siendo intercambiable.

| Símbolo | Estado | Cómo se ve |
|---|---|---|
| \`[ ]\` | Pendiente | Casilla vacía |
| \`[x]\` (o \`[X]\`) | Hecha | Casilla marcada; texto apagado (gris), sin tachar |
| \`[-]\` | Cancelada | Cruz; texto tachado y más atenuado |
| \`[/]\` | En curso | Casilla medio llena |
| \`[>]\` | Pospuesta | Flecha |
| \`[*]\` | Destacada | Estrella |
| \`[!]\` | Importante | Signo de exclamación |
| \`[?]\` | Pregunta | Signo de pregunta |
| \`[+]\` | Agregada | Casilla marcada, otro color |

Cualquier otro símbolo se ve como hecha. Para cambiar un estado, **editá ese
carácter** en el archivo; no hay otra marca. Un clic del usuario en la casilla
alterna pendiente ↔ hecha (un estado especial vuelve a pendiente), y con clic
derecho elige cualquiera.

## Qué puede haber en el vault (y qué de eso está en la memoria)

Un vault no es solo notas. Esto es lo que podés encontrarte y qué podés hacer con
cada cosa:

| Archivo | Qué es | Podés |
|---|---|---|
| \`.md\` | **Nota**. La unidad de la memoria; su título es el nombre del archivo | Crear y editar libremente |
| \`.base\` | **Tabla consultable**: un YAML que agrega notas por sus propiedades y las muestra en una tabla, con filtros. Formato de Obsidian | Crear y editar con la skill \`mycelium-base\` (Mycelium entiende un subconjunto cerrado) |
| \`.canvas\` | **Lienzo**: notas y textos en el espacio, unidos por flechas. JSON Canvas, formato de Obsidian | Crear y editar con la skill \`mycelium-canvas\` |
| \`.excalidraw\` | **Dibujo** a mano alzada (JSON de Excalidraw) | Crear y editar con la skill \`mycelium-excalidraw\` |
| \`.drawio\` | **Diagrama formal**: figuras y conectores que se enganchan (UML, ER, red, BPMN). XML de mxGraph, formato nativo de draw.io | Crear y editar con la skill \`mycelium-drawio\` |
| Cualquier otro | PDF, imágenes, código, texto | Leerlos y editarlos como archivos normales |

Los lienzos, diagramas y dibujos **se rompen fácil** escritos a ojo: cada skill
explica la geometría y trae un validador (\`node .claude/skills/<skill>/validar-<formato>.mjs\`)
que se corre antes de dar el trabajo por hecho. La de Excalidraw trae además un generador
(\`dibujo.mjs\`) que calcula los extremos de las flechas y los enlaces por vos.

> [!warning] Solo las notas están en la memoria
> Mycelium **indexa \`.md\`, y nada más**. Los demás archivos existen, se listan y
> se abren, pero **no** están en la búsqueda del vault, **no** aparecen en el
> autocompletado de \`[[\`, y **no** son nodos del grafo.
>
> Para vos eso significa una cosa concreta: un \`grep\` los encuentra igual, así
> que podés terminar citando como evidencia de la memoria algo que la memoria no
> tiene. Si una respuesta se apoya en un \`.py\` o en un \`.csv\`, decilo así —
> «según el archivo \`x.py\`»— y no con un \`[[enlace]]\`, que no va a resolver.

Dos excepciones: un \`.base\` y un \`.canvas\` **sí** son destinos válidos de
\`[[enlace]]\` y nodos del grafo (detalle en «Tablas, lienzos…», abajo).

Además, fuera de las notas:

- **\`Esporas/\`** (o la carpeta configurada): plantillas, no conocimiento (ver abajo).
- **\`.mycelium/\`**: índice interno, papelera (\`.mycelium/.trash/\`), calendario
  (\`recordatorios.json\`), preferencias, el diccionario del vault del corrector
  (\`diccionario.txt\`) y el registro de actividad de la IA. **No escribir nunca**;
  leer, solo \`recordatorios.json\` (skill \`mycelium-calendario\`) y \`preferencias.json\`
  (p. ej. cuál es la carpeta de Esporas, skill \`mycelium-esporas\`). El calendario se
  modifica solo con las herramientas \`mycelium_recordatorio_*\` y el diccionario solo con
  \`mycelium_diccionario\` (skill \`mycelium-operar\`): sin ellas, decíselo al usuario y no
  toques esos archivos.
- **\`CLAUDE.md\`**: lo que va entre \`<!-- mycelium:inicio … -->\` y \`<!-- mycelium:fin -->\`
  lo escribe Mycelium y se reescribe al regenerar; lo de fuera del bloque es del usuario.
- **\`.claude/\`**: lo que lleva prefijo \`mycelium\` —\`skills/mycelium-*\`,
  \`commands/mycelium/\`, \`hooks/mycelium-*\`, \`mycelium-ia.json\`— es de Mycelium y se pisa
  al regenerar: **no lo edites**. Lo demás (agentes, comandos, hooks, \`settings.json\`)
  es del usuario y Mycelium no lo toca.
- **\`.mycignore\`** (opcional, raíz): qué ignora Mycelium (abajo).

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

## Propiedades (frontmatter YAML)

El bloque entre \`---\` al **inicio** del archivo (primera línea, sin espacios
delante; se cierra con \`---\` o \`...\`) son las **propiedades** de la nota:
Mycelium las muestra como tarjeta, las deja editar en el panel PROPIEDADES y las
indexa para poder consultarlas.

Subconjunto soportado — un **mapa plano** cuyos valores sean:

| Tipo | Se escribe | Ejemplo |
|---|---|---|
| Texto | escalar suelto o entrecomillado | \`estado: activo\` |
| Número | entero o decimal | \`prioridad: 3\` |
| Casilla | \`true\` / \`false\` | \`publicado: false\` |
| Fecha | \`YYYY-MM-DD\` | \`vence: 2026-08-30\` |
| Fecha y hora | \`YYYY-MM-DDTHH:mm\` | \`reunion: 2026-08-30T15:00\` |
| Lista | \`[a, b]\` o una línea \`- \` por elemento | \`tags: [proyecto, activo]\` |

- **\`tags:\`** es la única clave con comportamiento: sus valores son **etiquetas
  de la nota**, se suman a los \`#tag\` del cuerpo y navegan igual. Se aceptan con
  y sin \`#\`.
- Un escalar entrecomillado es siempre texto (\`version: "1.0"\` NO es número).
- Un \`[[enlace]]\` dentro de un valor cuenta como enlace saliente y se ve en el grafo.
- **No soportado**: mapas anidados, escalares multilínea (\`|\`, \`>\`), anclas y
  alias (\`&\`/\`*\`), etiquetas (\`!!\`), listas de mapas y claves repetidas. Esa
  nota no se rompe, pero se muestra cruda y sin propiedades. No lo uses.
- Usá propiedades **con moderación** y **reusá las claves que ya existen** en el vault
  en vez de inventar sinónimos (\`estado\` / \`Estado\` / \`status\` fragmentan la memoria):
  \`grep -rh "^[a-zA-Z_-]*:" --include="*.md" . | sort -u\`.
- En la búsqueda de Mycelium, \`clave:valor\` filtra por propiedad y \`tag:x\` por
  etiqueta.

\`\`\`md
---
estado: activo
prioridad: 3
tags: [proyecto, mycelium]
relacionada: "[[Mapa del vault]]"
---
\`\`\`

## Tablas, lienzos, diagramas, dibujos y Esporas

Cada uno tiene **su skill**, con el formato exacto que Mycelium entiende, la
geometría y recetas. Consultala antes de crear o modificar uno:

| Qué | Skill |
|---|---|
| Tabla \`.base\` (YAML; subconjunto cerrado: lo que no entiende rompe la tabla o la equivoca en silencio) | \`mycelium-base\` |
| Lienzo \`.canvas\` (JSON Canvas) | \`mycelium-canvas\` |
| Diagrama \`.drawio\` (XML de mxGraph) | \`mycelium-drawio\` |
| Dibujo \`.excalidraw\` (JSON de Excalidraw) | \`mycelium-excalidraw\` |
| Esporas (plantillas de notas) y sus variables | \`mycelium-esporas\` |
| Calendario de recordatorios (leer; modificar, solo por MCP) | \`mycelium-calendario\` |

Lo que importa para la memoria: un \`.base\` y un \`.canvas\` son **nodos del
grafo** y destinos válidos de \`[[enlace]]\`. El \`.canvas\` **aporta aristas**
hacia cada \`[[enlace]]\` de sus tarjetas de texto y hacia cada nota de sus
tarjetas \`file\` (las **flechas** del lienzo no crean aristas). El YAML de un
\`.base\` no se escanea: un \`[[…]]\` ahí no crea una asociación. \`.drawio\` y \`.excalidraw\`
no se indexan: solo una nota que los embebe (\`![[Nombre.drawio]]\`, con la extensión) los
conecta. Si hay una nota natural —la que nombró el usuario o la del tema—, embebelos ahí y
decí dónde; si no la hay, no inventes una: creá el archivo y ofrecé embeberlo donde el
usuario elija.

Las **Esporas** son moldes, no memoria: no consolides ahí, no las cites como
fuente, no las reportes como huérfanas (una plantilla sin enlaces es normal). Viven
directamente en \`Esporas/\` (o la carpeta configurada) y sus variables son \`{{titulo}}\`,
\`{{fecha}}\`, \`{{hora}}\` y \`{{fecha:FORMATO}}\`: Mycelium las sustituye **solo cuando se usa
desde la app**. Si vas a crear una nota de un tipo que ya tiene Espora, **partí de ella** y
expandí vos las variables —copiarla deja \`{{fecha}}\` escrito—: skill \`mycelium-esporas\`.

## \`.mycignore\`: qué ve Mycelium

Archivo opcional en la raíz, sintaxis tipo \`.gitignore\`:

- \`nombre/\` → directorios con ese nombre en cualquier nivel.
- \`nombre\` → archivos o carpetas con ese nombre en cualquier nivel.
- \`ruta/anidada/\` (con \`/\` interno) o \`/nombre\` (con \`/\` inicial) → anclada a la raíz del vault.
- \`*\` y \`?\` → comodines dentro de un segmento (\`*.tmp.md\`); \`**\` → cero o más carpetas.
- \`!patrón\` → **negación**, como en git: vuelve a incluir lo que una regla anterior
  ignoró, y gana la última regla que coincide. Igual que en git, una carpeta ignorada no
  se recorre: para ver algo de adentro, primero des-ignorá la carpeta.
- \`# …\` → comentario.
- Sin archivo, el defecto ignora los directorios ocultos (\`.*/\`) y las carpetas de
  dependencias/build: \`node_modules/\`, \`target/\`, \`dist/\`, \`out/\`.
- Si el archivo **existe**, **reemplaza al default por completo**: si lo creás, repetí
  las líneas del default que quieras conservar.
- \`.mycelium/\` está ignorado **siempre**.

Un archivo ignorado existe en disco (podés leerlo y escribirlo) pero **no aparece
en la app ni en el grafo**. No escondas ahí documentación que el usuario deba ver. Si
el usuario dice que no ve una nota que creaste, revisá este archivo primero.

## Qué ve el usuario

Fuera de las herramientas \`mycelium_*\` (skill \`mycelium-operar\`) no controlás la
aplicación: trabajás sobre sus archivos. Pero conviene saber qué ve el usuario, porque es
el efecto de lo que escribís: editor Markdown con vista en vivo y de lectura; callouts
(los diez tipos de la tabla, plegables con \`[!tipo]-\`), incluso anidados; **listas de
tareas con estados** según el símbolo de la casilla; **propiedades** del frontmatter como
tarjeta arriba de la nota y como pestaña editable en el panel; **Esporas** en su propio
panel del rail, en la barra del editor y en el clic derecho de una carpeta; **tablas**
\`.base\` con sus filtros, orden y buscador; **lienzos** \`.canvas\`; **diagramas** \`.drawio\`
con el editor de draw.io y **dibujos** \`.excalidraw\`, en su pestaña o embebidos en una
nota; un **calendario** con recordatorios (fecha, hora, repetición y avisos) en su panel
del rail; **grafo de conexiones** global y mini-grafo por nota (tus enlaces se ven ahí);
búsqueda global —por nombre, por contenido o los dos, con \`clave:valor\` y \`tag:x\`, y con
los resultados agrupables por carpeta—; un **visor** para los archivos que no son notas
(PDF, imágenes, y código con resaltado de sintaxis, que además se puede editar); panel
lateral con pestañas ancladas; **terminal integrada** (es probable que estés corriendo en
ella, con cwd en el vault); exportación a Markdown/PDF/carpeta; papelera propia; Mermaid y
KaTeX.

El usuario puede además **renombrar una nota escribiendo en su título**, arriba del
documento. Mycelium detecta tus cambios en disco y refresca la UI solo: notas, tablas,
lienzos, diagramas y dibujos abiertos se recargan con lo que escribiste. **Salvo** que el
usuario tenga ahí cambios sin guardar (o una tarjeta de lienzo en edición): entonces no
recarga, y lo que guarde después pisa lo tuyo. Y el **editor modal** de un dibujo
embebido en una nota no recarga nunca: si está abierto, al cerrarlo pisa lo que
escribiste. Si sabés que el usuario está editando ese archivo, avisale antes de escribir
(con el control encendido, \`mycelium_estado\` te dice qué pestañas tienen cambios sin
guardar).

## Precauciones

- Renombrar o mover **por Mycelium** —desde la app, o vos con \`mycelium_renombrar\`
  y \`mycelium_mover\`— repara los \`[[enlaces]]\` que la apuntaban; un \`mv\` desde
  la terminal **no**: si no tenés las herramientas, actualizalos vos (alias
  \`[[viejo|…]]\`, embeds \`![[viejo]]\` y \`[[Carpeta/viejo]]\` incluidos). Detalle en
  \`mycelium-operar\`.
- Un nombre de archivo no puede llevar \`? : * | " < > \\ /\`.
- Mycelium reindexa solo al detectar cambios en disco: no hace falta avisar.
- El frontmatter que cae fuera del subconjunto soportado se muestra crudo y la
  nota queda sin propiedades indexadas: revisalo antes de dar por hecho que se
  guardaron.
`;

const SKILL_MEMORIA_MD = `---
name: mycelium-memoria
description: Usar el vault de Mycelium como memoria de largo plazo — cómo está construida (notas, enlaces, tags, mapas), cómo BUSCAR conocimiento previo (recuperación, backlinks, expansión por el grafo) y cómo REGISTRARLO para poder recuperarlo después. Usar al responder preguntas sobre el vault o al consolidar decisiones y aprendizajes.
---
<!-- mycelium-ia v${FRAMEWORK_IA_VERSION} -->
# El vault como memoria

Un vault de Mycelium no es un archivo de documentos: es una **red asociativa**.
Recuperar es *navegar asociaciones*, no solo *buscar cadenas de texto*. Registrar
es *dejar caminos* para que el conocimiento pueda evocarse mañana.

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

Solo las notas \`.md\` están en la memoria: lo demás que encuentre un \`grep\` (un \`.py\`,
un \`.csv\`) se cita como archivo, no con \`[[enlace]]\` (ver \`mycelium-vault\`).

## Recuperación en seis movimientos

1. **Entradas** — buscá notas mapa/índice del área (\`Mapa del vault\`, \`Índice …\`,
   MOCs) y arrancá desde ahí. Dan el marco y suelen enlazar lo importante.
2. **Léxico** — buscá los términos de la consulta y sus sinónimos en todo el vault:
   \`grep -ril "término" --include="*.md" .\`. Revisá también los **nombres de
   archivo**: un título que coincide es, casi siempre, la nota canónica del tema.
3. **Lectura** — leé las candidatas enteras antes de concluir. Los fragmentos de
   \`grep\` mienten por falta de contexto (negaciones, "esto se descartó", condiciones).
4. **Expansión asociativa** — desde cada nota relevante, seguí:
   - sus \`[[enlaces]]\` salientes (dónde continúa la idea),
   - sus **backlinks** (\`grep -rl "\\[\\[Título" --include="*.md" .\`) — quién la
     usa y para qué; aquí aparecen las decisiones que la afectan: la que revirtió a
     otra, el detalle en la nota vecina.
   Uno o dos saltos suelen bastar; frená cuando deja de aportar.
5. **Facetas** — si el tema es transversal, buscá el \`#tag\` correspondiente
   (\`grep -rl "#tema" --include="*.md" .\`, o \`tags:\` en las propiedades).
6. **Síntesis con procedencia** — respondé indicando de qué nota sale cada
   afirmación (\`[[enlace]]\`). Señalá contradicciones entre notas en vez de
   promediarlas. Si la memoria **no** tiene la respuesta, **decilo explícitamente** en
   vez de rellenar con suposiciones, y ofrecé crear la nota que falta.

### Señales de que falta recuperar más

- La respuesta depende de una fecha, un número o un nombre que no viste escrito.
- Encontraste la conclusión pero no el motivo (buscá la nota de decisión).
- Dos notas dicen cosas distintas y no sabés cuál es posterior.

## Consolidación: escribir para poder recuperar

**Antes de crear, buscá** (movimiento 2). Si el tema ya tiene nota, **ampliala**; los
duplicados degradan la memoria (dos verdades parciales, ninguna canónica).

Cuándo crear una nota nueva:

| Situación | Acción |
|---|---|
| Idea nueva y con identidad propia | Nota nueva, título específico |
| Matiz o detalle de algo existente | Ampliar la nota existente |
| Decisión que cambia algo previo | Nota o sección nueva **+ enlace** desde/hacia la anterior, dejando claro qué reemplaza |
| Dato efímero (no vale recordar) | No lo escribas |

Cómo redactar para tu vos futuro:

- **Una idea por nota**, con **título específico y único**: los enlaces resuelven por
  título, y dos notas homónimas rompen la memoria.
- **Título como consulta**: elegí el título que usarías para buscarlo dentro de seis
  meses (específico, no genérico).
- **Autosuficiencia**: la nota debe entenderse sin la conversación que la originó.
  Incluí fecha, contexto y por qué, no solo el qué: fecha y motivo de una decisión
  valen más que su enunciado.
- **Enlazá hacia afuera**: al menos un \`[[enlace]]\` a algo existente, y decí *en qué
  se relaciona* ("depende de \`[[X]]\`", "reemplaza a \`[[Y]]\`"). Una lista de enlaces
  sin razón envejece mal.
- **Enlazá hacia adentro**: agregá el enlace a la nota nueva desde su mapa/índice o
  su nota madre. Si nadie la enlaza, queda **huérfana**: memoria inaccesible.
- **Estructura**: usá las carpetas/áreas que ya existen; no crees jerarquías paralelas.
- **Destacá lo crítico** con callouts (\`> [!warning]\`, \`> [!important]\`, \`> [!info]\`).

## Mantenimiento de la memoria

- **Huérfanas**: notas sin enlaces en ninguna dirección. Integralas (o proponé
  integrarlas) — usá \`/vault-huerfanas\`.
- **Enlaces rotos**: apuntan a notas que no existen; corregí el título o creá la
  nota faltante.
- **Hubs sobrecargados**: si una nota mapa creció demasiado, dividila por subtemas y
  reenlazá.
- **Al renombrar o mover**: con \`mycelium_renombrar\` / \`mycelium_mover\` Mycelium
  repara los \`[[enlaces]]\` que la apuntaban; con \`mv\` (solo si no tenés las
  herramientas), actualizalos vos.

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
   Excluí la carpeta de **Esporas** (las plantillas son moldes: que no tengan
   enlaces es lo normal, no un defecto de la memoria). Una nota que solo aparece
   en un \`.canvas\` (como tarjeta de nota o con un \`[[enlace]]\` en una tarjeta de
   texto) **no** es huérfana: el lienzo la enlaza. Buscá también ahí
   (\`grep -rl "Título" --include="*.canvas" .\`).
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
3. Mirá si hay una **Espora** (plantilla) para este tipo de nota en \`Esporas/\` —o
   la carpeta configurada—; si la hay, partí de ella siguiendo la skill
   \`mycelium-esporas\`. Las variables (\`{{titulo}}\`, \`{{fecha}}\`, \`{{hora}}\`,
   \`{{fecha:FORMATO}}\`) las **expandís vos** —fecha y hora con \`date\`, no
   supuestas—: copiar la plantilla tal cual deja \`{{fecha}}\` escrito en la nota.
4. Redactá contenido **autosuficiente** (se entiende sin esta conversación) con la
   sintaxis de Mycelium: callouts para avisos, \`[[enlaces]]\` en las menciones a
   notas existentes.
5. Cerrá con \`## Relacionadas\` si hay notas afines, indicando la razón del vínculo.
6. Agregá un \`[[enlace]]\` hacia la nota nueva desde su índice/mapa o nota madre
   (que no quede huérfana). Informá dónde la creaste y desde dónde la enlazaste.
`;

/** Marcador de versión (JSON) que se escribe en el vault. */
const versionJson = () =>
  JSON.stringify({ version: FRAMEWORK_IA_VERSION, generado: new Date().toISOString() }, null, 2) + "\n";

// ── El bloque gestionado de `CLAUDE.md` (`FUN-L-29`) ─────────────────────────
//
// `CLAUDE.md` es del usuario: Mycelium escribe solo entre dos marcadores, que
// van cada uno en su propia línea:
//
//   <!-- mycelium:inicio v2.0.0 — lo escribe Mycelium (…); lo tuyo, fuera del bloque -->
//   …el núcleo…
//   <!-- mycelium:fin -->
//
// La versión va en el de inicio (se ve en el archivo sin abrir la app); el
// aviso, también, para quien lo abra a mano. Al regenerar se reemplaza desde el
// `<` del inicio hasta el `>` del fin: lo de antes y lo de después —incluido el
// salto de línea que sigue al fin— queda byte a byte igual.

/** Cómo empieza la línea que abre el bloque (sigue la versión). */
export const INICIO_BLOQUE = "<!-- mycelium:inicio v";
/** La línea que lo cierra. */
export const FIN_BLOQUE = "<!-- mycelium:fin -->";

/** El bloque entero, sin salto de línea final, con los saltos pedidos. */
export function bloqueGestionado(eol: "\n" | "\r\n" = "\n"): string {
  const texto =
    `${INICIO_BLOQUE}${FRAMEWORK_IA_VERSION} — lo escribe Mycelium (Configuración → Vault); ` +
    `lo tuyo, fuera del bloque -->\n${NUCLEO}${FIN_BLOQUE}`;
  return eol === "\n" ? texto : texto.replace(/\n/g, "\r\n");
}

/**
 * Dónde está el bloque en `texto` (`[desde, hasta)`), `null` si no hay, o
 * `"roto"` si está el marcador de inicio sin el de fin. El inicio cuenta solo
 * al principio de una línea (tras un BOM, si es la primera): un marcador citado
 * dentro de un párrafo o entre backticks no es el bloque.
 */
function ubicarBloque(texto: string): { desde: number; hasta: number } | "roto" | null {
  const m = /(^﻿?|\n)<!-- mycelium:inicio v/.exec(texto);
  if (!m) return null;
  const desde = m.index + m[1].length;
  const fin = texto.indexOf(FIN_BLOQUE, desde);
  if (fin < 0) return "roto";
  return { desde, hasta: fin + FIN_BLOQUE.length };
}

/**
 * sha256 de cada `CLAUDE.md` que generó **entero** una versión 1.x del
 * framework, calculados desde el historial de git de este archivo (incluidas
 * las partes de la 1.7.0, que salieron sin subir la versión). Reconocen uno
 * viejo sin tocar, para reemplazarlo por el bloque solo. **Lista cerrada**:
 * desde la 2.0.0 Mycelium ya no escribe `CLAUDE.md` entero.
 * `scripts/test-framework-ia.mjs` comprueba que no falte ninguno.
 */
const HUELLAS_CLAUDE_MD_PREVIAS = new Set([
  "bc507f4dc66893c998967e6104a87e5b46ddd4c2a75e8ffa090521b007b587b7", // 1.0.0
  "ea63278e65346ff3968131cb29040ded59aea68f9334ce22725ac3a7377e6840", // 1.1.0
  "1778489db8861bfa06afec4d1d5ceb0c601d1b067012b5b38cf5dbeef1568c7f", // 1.2.0
  "ddfa96650c361c1d0662f243141723561657a133f681eae252ed8b4e0b9d5e96", // 1.2.1
  "4a64363990f492d70f147a39313f5313ef8a079e5782a0c25eff17b1a346a572", // 1.3.0
  "41c0ec8bf7364ee93e064fc04bd900a71c7f6786a703d0bb7c35fd2907fb1276", // 1.4.0
  "14e416b1135990104ac720d6b9e25b745727b7984b1d03c215f73b1b6cea644a", // 1.5.0
  "b852f037cb45df3e3b7008986639b289d0b09ca1ee9897b7ac9661d8f9a7ed2b", // 1.6.0
  "44f35a58cfe6b9bb1b3f7ccdde1650a0327473826b8d8323d7f6baee4deaaed4", // 1.7.0 (dd7c8eb)
  "f509a0a013f9b1d79ddef7d38c8a4c96947c58202c3067c43c6130c6ec8c7b99", // 1.7.0 (a603324)
  "8a889d9f01d1ab33e8332aa3afd42301e680525ecee50d2ec9816014f0f7a505", // 1.7.0 (517bb11)
  "f05a14b6c215b6ca06c15e3b095b6dd0cc1c2647d7f50ab4fed2146a21fcec60", // 1.7.0 (437d40c)
  "5783dbda160e611c31e5a582fc9e560779d2d1b9e8c8197e67244c7453dc07b9", // 1.7.0 (e430aae)
  "b3628333dac78b447e6347218bb13f1ed21dcfb1fe5381c56d43925ce7937f83", // 1.7.0 (7bda21e)
  "731a6d7cde1e3af48cd9096c8d17310c773598ffd3da7352400336359077149f", // 1.8.0
  "f214dad9f8d124943fab6ed52c5f2eae96a7128b3fd043835184eaf51cdbc52e", // 1.8.1
]);

/** La marca que llevaba en su primera línea el `CLAUDE.md` de la 1.x. */
const MARCA_ANTERIOR = "<!-- mycelium-ia v";

/** sha256 en hex, con los saltos de línea normalizados (git puede pasarlos a CRLF). */
async function huella(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto.replace(/\r\n/g, "\n"));
  const digesto = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(digesto), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Qué se hizo con `CLAUDE.md`:
 * - `creado` — no había (o estaba vacío): queda el bloque solo.
 * - `actualizado` — ya tenía el bloque: se reemplazó su contenido.
 * - `insertado` — era del usuario, sin bloque: el bloque va arriba y lo suyo
 *   queda debajo, intacto.
 * - `reemplazado` — lo había generado entero una versión 1.x y nadie lo tocó:
 *   queda el bloque solo.
 * - `insertado-sobre-anterior` — lo había generado una 1.x pero el usuario lo
 *   editó: como `insertado`, y además las instrucciones viejas quedan debajo
 *   del bloque, duplicadas, hasta que el usuario las borre (la UI se lo dice).
 */
export type AccionClaudeMd =
  | "creado"
  | "actualizado"
  | "insertado"
  | "reemplazado"
  | "insertado-sobre-anterior";

/**
 * El `CLAUDE.md` nuevo a partir del que hay (`null` si no existe). Pura, para
 * poder probarla sin disco. `huellaRegistrada` es la que guardó en
 * `mycelium-ia.json` la última generación 1.6–1.8 (`DEF-118`): con ella se
 * reconoce también un `CLAUDE.md` viejo sin tocar.
 *
 * El bloque se escribe con los saltos de línea del archivo (CRLF si los
 * tiene), para no mezclar estilos. Lanza un error, sin cambiar nada, si el
 * bloque está roto (inicio sin fin): adivinar dónde terminaba podría comerse
 * texto del usuario.
 */
export async function planificarClaudeMd(
  existente: string | null,
  huellaRegistrada?: string,
): Promise<{ contenido: string; accion: AccionClaudeMd }> {
  if (existente === null || existente.trim() === "") {
    return { contenido: `${bloqueGestionado()}\n`, accion: "creado" };
  }
  const eol = existente.includes("\r\n") ? "\r\n" : "\n";
  const lugar = ubicarBloque(existente);
  if (lugar === "roto") {
    throw new Error(
      "CLAUDE.md tiene el marcador «<!-- mycelium:inicio … -->» pero no «<!-- mycelium:fin -->», " +
        "así que no se sabe dónde termina el bloque de Mycelium: no se tocó nada. Agregá el " +
        "marcador de fin donde termina el bloque (o borrá el de inicio) y volvé a generar.",
    );
  }
  if (lugar) {
    return {
      contenido: existente.slice(0, lugar.desde) + bloqueGestionado(eol) + existente.slice(lugar.hasta),
      accion: "actualizado",
    };
  }
  const actual = await huella(existente);
  if (HUELLAS_CLAUDE_MD_PREVIAS.has(actual) || actual === huellaRegistrada) {
    return { contenido: `${bloqueGestionado(eol)}${eol}`, accion: "reemplazado" };
  }
  // Del usuario: el bloque arriba (decisión del usuario, 2026-10-06) y lo suyo
  // debajo, separado por una línea en blanco. El BOM, si hay, sigue primero.
  const bom = existente.startsWith("﻿") ? "﻿" : "";
  const resto = existente.slice(bom.length);
  return {
    contenido: `${bom}${bloqueGestionado(eol)}${eol}${eol}${resto}`,
    accion: resto.startsWith(MARCA_ANTERIOR) ? "insertado-sobre-anterior" : "insertado",
  };
}

// ── Los comandos de la 1.x (`FUN-L-29`) ──────────────────────────────────────
//
// Hasta la 1.8 los comandos vivían sueltos en `.claude/commands/`, mezclados
// con los del usuario. Desde la 2.0.0 van en `.claude/commands/mycelium/`
// (Claude Code nombra un comando por su archivo, sin la subcarpeta: siguen
// siendo `/vault-buscar`, etc.). Al regenerar, los viejos que siguen tal cual
// los escribió Mycelium se borran; los que el usuario editó se quedan donde
// están, ya como suyos.

const COMANDOS = ["vault-buscar", "vault-recordar", "vault-mapa", "vault-vincular", "vault-huerfanas", "vault-nota"];

/** Dónde vivían los comandos hasta la 1.8 (la lista cerrada que el backend deja borrar). */
const RUTAS_COMANDOS_ANTERIORES = COMANDOS.map((c) => `.claude/commands/${c}.md`);

/**
 * sha256 de cada comando que escribió una versión 1.x, **sin su línea de
 * marca** (`<!-- mycelium-ia vX -->`, lo único que cambiaba de una versión a
 * otra en la mayoría). Del historial de git; lista cerrada, como la de
 * `CLAUDE.md`, y comprobada por el mismo test.
 */
const HUELLAS_COMANDOS_ANTERIORES = new Set([
  "d6b8e0b02c6793cf0fc207c648ec83f2fe561fa74dc684421d7dcf3d48356f92", // vault-buscar 1.2.0–1.8.1
  "196190f7b66cc2a6fa81376e7c5077c1b749c16705bc69d6d2b80f1105daf748", // vault-recordar 1.2.0–1.8.1
  "1d30d5e8758daaefca6f3b0e9ef3a92df1569b98ae76a7cbe989ce390d45ad95", // vault-mapa 1.2.0–1.8.1
  "a31305bbd95d967c820eac767dcb4824162ab8f810543110cf13b7e33e1034e2", // vault-mapa 1.0.0–1.1.0
  "97997caa63e6a8d00b0598d6e609cbf157aa0e493a6929880c03f2957cf181eb", // vault-vincular 1.2.0–1.8.1
  "3d6fa5f7e542993b4cb9b448fd067e2f9e2d8f3c958dc461a8220d69c7bafa89", // vault-vincular 1.0.0–1.1.0
  "a6a25b795d5de86326eeca41fb1ea179535204cb912014b016d97de944514fe7", // vault-huerfanas 1.7.0–1.8.1
  "d57db054bf7e460fcb11ae28a1e8bcd2ec2e86ac08da541b2113c404c6e38c1e", // vault-huerfanas 1.4.0–1.6.0
  "efe2b11356feb305906506ea17f75d77ccb2047cefd0e0ef2d4eacddea63c200", // vault-huerfanas 1.2.0–1.3.0
  "8cab123813fe3c0f66d1e6eb34a1c026ffaf4117fbe6aaf48afba1ba60404cc3", // vault-huerfanas 1.0.0–1.1.0
  "28d158c11d7b0f9bbdca7999273bd5130f497aabc0eacfcede79f5d71604041a", // vault-nota 1.7.0–1.8.1
  "2568b527f3ea37d90302dc62e02fae2df60cd3ffc7ae48462099bff056cf827f", // vault-nota 1.4.0–1.6.0
  "5710414750e83937e9ef3a05a1494dbf577833d496e32869558020d992f1c5ce", // vault-nota 1.2.0–1.3.0
  "fa0a7a75eb48c6c072bf9b4357236f10c3814d99dd7a06fe2a55140f64d8538f", // vault-nota 1.0.0–1.1.0
]);

/** La huella de un comando sin su línea de marca. */
const huellaComando = (texto: string) => huella(texto.replace(/^<!-- mycelium-ia v[^\n]*-->\r?\n/m, ""));

/** Las huellas registradas en `mycelium-ia.json` por la 1.6–1.8 (vacío si no hay). */
async function huellasRegistradas(vaultRuta: string): Promise<Record<string, string>> {
  const crudo = await leerTexto(vaultRuta, RUTA_VERSION);
  if (!crudo) return {};
  try {
    return (JSON.parse(crudo) as { huellas?: Record<string, string> }).huellas ?? {};
  } catch {
    return {};
  }
}

/**
 * Los archivos de Mycelium en `.claude/` (ruta relativa al vault → contenido).
 * Todos llevan prefijo `mycelium` en su ruta: son de Mycelium y se pisan al
 * regenerar. `CLAUDE.md` no está: es del usuario y solo se toca su bloque
 * (`planificarClaudeMd`).
 */
export function archivosFramework(): { ruta: string; contenido: string }[] {
  return [
    { ruta: ".claude/skills/mycelium-vault/SKILL.md", contenido: SKILL_MD },
    { ruta: ".claude/skills/mycelium-memoria/SKILL.md", contenido: SKILL_MEMORIA_MD },
    { ruta: ".claude/commands/mycelium/vault-buscar.md", contenido: CMD_BUSCAR },
    { ruta: ".claude/commands/mycelium/vault-recordar.md", contenido: CMD_RECORDAR },
    { ruta: ".claude/commands/mycelium/vault-mapa.md", contenido: CMD_MAPA },
    { ruta: ".claude/commands/mycelium/vault-vincular.md", contenido: CMD_VINCULAR },
    { ruta: ".claude/commands/mycelium/vault-huerfanas.md", contenido: CMD_HUERFANAS },
    { ruta: ".claude/commands/mycelium/vault-nota.md", contenido: CMD_NOTA },
    // Una skill por herramienta (`FUN-L-26`) y la del MCP de control
    // (`mycelium-operar`), con los scripts que viajan con ellas. Salen de
    // `lib/ia/borradores/` y `scripts/*.mjs` vía `scripts/generar-skills-ia.mjs`.
    ...SKILLS_GENERADAS.map(({ ruta, contenido }) => ({
      ruta,
      contenido: contenido.split(MARCADOR_VERSION_IA).join(FRAMEWORK_IA_VERSION),
    })),
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

/** Lo que hizo `generarFramework`, para contárselo al usuario. */
export type ResultadoIa = {
  claudeMd: AccionClaudeMd;
  /** Comandos de la 1.x, sin tocar, que se borraron (ya están en `commands/mycelium/`). */
  borrados: string[];
  /** Comandos de la 1.x que el usuario editó: quedan donde estaban, como suyos. */
  conservados: string[];
};

/**
 * Genera (o actualiza) el framework IA en el vault. Ya no hay conflictos
 * (`FUN-L-29`): lo de Mycelium lleva prefijo `mycelium` —el bloque de
 * `CLAUDE.md`, `.claude/skills/mycelium-*`, `.claude/commands/mycelium/`,
 * `.claude/mycelium-ia.json`— y se reescribe siempre; lo demás es del usuario y
 * no se toca. `CLAUDE.md` se resuelve primero: si su bloque está roto, se
 * lanza el error antes de escribir nada.
 */
export async function generarFramework(vaultRuta: string): Promise<ResultadoIa> {
  const escribir = (rutaRel: string, contenido: string) =>
    invoke("escribir_nota", { vaultRuta, rutaRel, contenido });

  const existente = await leerTexto(vaultRuta, "CLAUDE.md");
  const registradas = await huellasRegistradas(vaultRuta);
  const plan = await planificarClaudeMd(existente, registradas["CLAUDE.md"]);
  // Sin cambios, no se escribe: no tiene sentido despertar al watcher.
  if (plan.contenido !== existente) await escribir("CLAUDE.md", plan.contenido);

  for (const archivo of archivosFramework()) await escribir(archivo.ruta, archivo.contenido);

  // Migración desde la 1.x: los comandos sueltos.
  const borrados: string[] = [];
  const conservados: string[] = [];
  for (const ruta of RUTAS_COMANDOS_ANTERIORES) {
    const texto = await leerTexto(vaultRuta, ruta);
    if (texto === null) continue;
    if (HUELLAS_COMANDOS_ANTERIORES.has(await huellaComando(texto))) {
      await invoke("ia_borrar_anterior", { vaultRuta, rutaRel: ruta });
      borrados.push(ruta);
    } else {
      conservados.push(ruta);
    }
  }

  // El marcador de versión va último: si algo falló antes, la app sigue
  // ofreciendo actualizar.
  await escribir(RUTA_VERSION, versionJson());
  return { claudeMd: plan.accion, borrados, conservados };
}
