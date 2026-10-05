import { invoke } from "@tauri-apps/api/core";
import { MARCADOR_VERSION_IA, SKILLS_GENERADAS } from "./skillsGeneradas";

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
 */
export const FRAMEWORK_IA_VERSION = "1.8.0";

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

## Qué puede haber en el vault (y qué de eso está en la memoria)

Un vault no es solo notas. Esto es lo que podés encontrarte y qué podés hacer con
cada cosa:

| Archivo | Qué es | Podés |
|---|---|---|
| \`.md\` | **Nota**. La unidad de la memoria | Crear y editar libremente |
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
\`[[enlace]]\` y nodos del grafo. El \`.canvas\` además **aporta aristas**: hacia
cada \`[[enlace]]\` de sus tarjetas de texto y hacia cada nota de una tarjeta de
nota (las flechas del lienzo, no). El contenido de un \`.base\` no se escanea: un
\`[[…]]\` dentro de su YAML no crea una asociación.

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

Tenés una **skill de referencia**, una **skill de memoria**, **una skill por
herramienta** del vault y **comandos**. Cuándo usar cada uno:

| Herramienta | Cuándo |
|---|---|
| skill \`mycelium-vault\` | Referencia de **sintaxis** de las notas y de cómo explorar el vault: enlaces, alias, embeds, tags, propiedades, callouts, Mermaid, KaTeX, \`.mycignore\`. Consultala antes de escribir en este vault. |
| skill \`mycelium-memoria\` | **Técnicas** de recuperación y consolidación: estrategias de búsqueda, expansión por backlinks, cuándo crear vs ampliar, cómo redactar para recuperación futura. Consultala en tareas de buscar/registrar conocimiento. |
| skill \`mycelium-drawio\` | Crear o modificar un **diagrama formal** \`.drawio\` (flujo, organigrama, ER, arquitectura, red, UML): XML, coordenadas, flechas enganchadas. Trae validador. |
| skill \`mycelium-canvas\` | Crear o modificar un **lienzo** \`.canvas\` (mapa de ideas, tablero, línea de tiempo, mapa de notas): tarjetas, grupos, lados de las flechas. Trae validador. |
| skill \`mycelium-excalidraw\` | Crear o modificar un **dibujo** \`.excalidraw\` (boceto, pizarra, flujo informal): flechas enlazadas, texto en su caja. Trae validador. |
| skill \`mycelium-base\` | Crear, corregir o leer una **tabla** \`.base\` («una lista de las notas que…»): el subconjunto exacto de filtros, columnas y orden que Mycelium entiende. |
| skill \`mycelium-esporas\` | Crear una nota **a partir de una Espora** (plantilla) expandiendo vos sus variables, o crear/corregir una Espora. |
| skill \`mycelium-calendario\` | Responder «¿qué tengo hoy / esta semana…?» con los **recordatorios** del calendario, con las repeticiones bien expandidas, y agendar, cambiar, completar o borrar recordatorios **por las herramientas \`mycelium_recordatorio_*\`** (sin ellas, el calendario no se modifica). |
| \`/vault-buscar <pregunta>\` | Responder una pregunta **con evidencia del vault** (recuperación completa + citas). Preferilo a buscar a mano. |
| \`/vault-recordar <qué recordar>\` | Consolidar un hecho/decisión/aprendizaje en la memoria (crea o amplía la nota y la enlaza). |
| \`/vault-nota <título>\` | Crear una nota nueva respetando las convenciones (ubicación, enlaces, no dejarla huérfana). |
| \`/vault-vincular <nota>\` | Reforzar las asociaciones de una nota existente (agrega \`[[enlaces]]\` a lo relacionado). |
| \`/vault-mapa\` | Generar/actualizar el índice general (MOC) del vault. Útil tras incorporar mucho material. |
| \`/vault-huerfanas\` | Auditar la salud de la memoria: notas desconectadas y enlaces rotos. |
| herramientas \`mycelium_*\` | **Operar la app** (si el control está encendido): mostrarle algo al usuario, saber qué tiene abierto, **leer y modificar el calendario**, **renombrar, mover o mandar a la papelera** notas y carpetas sin romper enlaces, y **agregar o quitar palabras del diccionario del vault** del corrector. Ver «Operar Mycelium». |

## Reglas duras

1. **Títulos únicos**: los \`[[enlaces]]\` resuelven por título, no por ruta.
2. **Para renombrar o mover, usá la herramienta**: \`mycelium_renombrar\` y
   \`mycelium_mover\` reparan los \`[[enlaces]]\` entrantes con el mismo código que
   usa la app cuando el usuario renombra desde el explorador o el título. Para
   borrar, \`mycelium_borrar\`: va a la **papelera de Mycelium**, de donde se
   restaura. \`mv\` y \`rm\` solo si el MCP no está (no tenés las herramientas, o
   contestan \`APP_CERRADA\` o \`MCP_DESACTIVADO\`), y entonces **los enlaces los
   arreglás vos**: un \`mv\` no dispara nada, así que buscá \`[[nombre viejo\`
   (incluidos alias \`[[viejo|…]]\`, embeds \`![[viejo]]\` y los que llevan carpeta
   \`[[Carpeta/viejo]]\`) y actualizá cada referencia; un \`rm\` no pasa por la
   papelera. Y ojo con el nombre: si lleva \`? : * | " < > \ /\` el archivo no
   puede llamarse así.
3. **Nada huérfano**: toda nota nueva entra a la red con al menos un enlace en cada
   dirección.
4. **No dupliques**: buscá antes de crear; ampliá antes de fragmentar.
5. **Estructura**: usá las carpetas/áreas que ya existen; no crees jerarquías
   paralelas.
6. **Propiedades** (frontmatter YAML entre \`---\` al inicio de la nota): Mycelium
   **las interpreta**. Soporta un mapa PLANO cuyos valores sean texto, número,
   casilla (\`true\`/\`false\`), fecha (\`YYYY-MM-DD\`), fecha y hora
   (\`YYYY-MM-DDTHH:mm\`) o lista (\`[a, b]\` o con \`- \`). \`tags:\` son
   **etiquetas de la nota**, igual que los \`#tag\` del cuerpo. Los valores se
   consultan en la búsqueda con \`clave:valor\`. Lo que NO soporta —mapas
   anidados, escalares multilínea (\`|\`, \`>\`), anclas/alias, listas de mapas,
   claves repetidas— no se rompe, pero esa nota se muestra cruda y sin
   propiedades: evitalo. Usá propiedades con moderación y con claves consistentes
   (reusá las que ya existen en el vault en vez de inventar sinónimos).
7. **Idioma**: el dominante del vault.
8. **No toques** \`.mycelium/\` (índice interno, papelera, calendario, preferencias):
   **escribir** ahí, nunca. La única excepción es de **lectura**: podés leer
   \`.mycelium/recordatorios.json\` (el calendario, skill \`mycelium-calendario\`) y
   \`.mycelium/preferencias.json\` (p. ej. cuál es la carpeta de Esporas). El
   calendario se **modifica solo** con las herramientas \`mycelium_recordatorio_*\`:
   si no las tenés, decíselo al usuario y no toques el archivo. Lo mismo el
   **diccionario del vault** del corrector (\`.mycelium/diccionario.txt\`): solo con
   \`mycelium_diccionario\`, nunca a mano. No edites
   \`.claude/\`: lo regenera Mycelium. Si el usuario regenera y ya hay un archivo
   suyo, Mycelium **no lo pisa**: crea \`nombre (mycelium-ia vX).md\` al lado y un
   reporte \`Conflictos instrucciones IA.md\` en la raíz.
9. **Visibilidad**: lo ignorado por \`.mycignore\` existe en disco pero **no aparece
   en la app ni en el grafo**. Por defecto se ignoran los directorios que empiezan
   con \`.\` y las carpetas de dependencias/build (\`node_modules/\`, \`target/\`,
   \`dist/\`, \`out/\`). No escondas ahí documentación que el usuario deba ver.
10. **Esporas** (carpeta \`Esporas/\` en la raíz, o la que el usuario haya
    configurado): sus notas **no son conocimiento, son moldes** para crear otras
    notas. Trátalas aparte: no consolides recuerdos ahí, no las cites como fuente,
    y no las reportes como huérfanas (una plantilla sin enlaces es normal). Si vas
    a crear una nota de un tipo que ya tiene Espora, **partí de ella** —y expandí
    vos sus variables: copiarla deja \`{{fecha}}\` escrito—. Cómo, en la skill
    \`mycelium-esporas\`.

## Operar Mycelium (herramientas \`mycelium_*\`)

Si tenés las herramientas \`mycelium_*\` (el servidor MCP «mycelium», registrado en
\`.mcp.json\` cuando el usuario enciende «Dejar que la IA controle Mycelium» en
Configuración → Vault), podés **operar la app**, no solo sus archivos. La línea
divisoria es una sola:

> [!important] El contenido va por los archivos; operar la app va por Mycelium
> **Leer y escribir** notas, lienzos, tablas o dibujos se hace como siempre, en los
> archivos. **Mostrarle algo al usuario, saber qué tiene abierto, el calendario,
> el diccionario del vault, y renombrar, mover o borrar** pasan por las
> herramientas: no adivines qué está mirando, no le pidas que abra algo a mano,
> **no escribas \`.mycelium/recordatorios.json\` ni \`.mycelium/diccionario.txt\`** y
> **no uses \`mv\` ni \`rm\`** con notas o carpetas.

| Querés… | Herramienta |
|---|---|
| Saber qué tiene abierto el usuario: pestañas por panel, la visible, las que tienen **cambios sin guardar** | \`mycelium_estado\` |
| Mostrarle una nota o archivo, el grafo o el calendario —y llevarlo a un encabezado, una línea o un texto— | \`mycelium_abrir\` |
| Leer el calendario entre dos fechas (las repeticiones ya expandidas, con id y si está completada) | \`mycelium_recordatorios\` |
| Agendar un recordatorio (título, fecha, hora, repetición, color por nombre, detalle) | \`mycelium_recordatorio_crear\` |
| Cambiar uno existente | \`mycelium_recordatorio_editar\` |
| Marcar o desmarcar como hecha una ocurrencia | \`mycelium_recordatorio_completar\` |
| Borrar uno (la serie entera, si se repite) | \`mycelium_recordatorio_borrar\` |
| Renombrar una nota o carpeta **reparando los enlaces** que llegaban a ella | \`mycelium_renombrar\` |
| Moverla a otra carpeta (que exista), con la misma reparación | \`mycelium_mover\` |
| Mandarla a la **papelera de Mycelium** (nunca se borra para siempre) | \`mycelium_borrar\` |
| Ver la papelera, o **restaurar** algo en su lugar | \`mycelium_papelera\` |
| Ver, agregar o quitar palabras del **diccionario del vault** del corrector ortográfico | \`mycelium_diccionario\` |

- **Antes de escribir un archivo que el usuario podría estar editando**, mirá
  \`mycelium_estado\`: si su pestaña figura **sin guardar**, avisale antes, porque lo
  que guarde después pisa lo tuyo.
- \`mycelium_abrir\` **no le roba el foco** salvo que pidas \`foco: true\`: pedilo solo
  cuando tengas algo que mostrarle ahora («mirá esta nota»), no cada vez que abrís algo.
- Los errores dicen qué hacer: \`NO_ENCONTRADO\` trae las notas más parecidas,
  \`AMBIGUO\` las rutas para repetir la llamada, \`APP_CERRADA\` que Mycelium no está
  abierto con este vault y \`MCP_DESACTIVADO\` dónde se enciende. Contáselo al usuario
  en vez de reintentar a ciegas.
- **Lo reversible no pregunta**: lo que hacés en el calendario, renombrar o mover
  algo con pocos enlaces y mandar una nota a la papelera quedan en el **registro de
  actividad** de Mycelium (su ícono en el rail), con **Deshacer**. Decile al usuario
  qué hiciste con el texto que te devuelve la herramienta —dice el efecto: qué notas
  se reescribieron, con qué id se restaura— y no repitas la llamada para «confirmar».
- **Lo de alcance grande le pregunta al usuario**: renombrar o mover reescribiendo
  enlaces en **más de 5 notas**, y borrar una **carpeta**. La llamada espera su
  respuesta (hasta 2 minutos). Si contesta que no —o no contesta—, recibís
  \`RECHAZADO\`: **es una respuesta, no un error**. No lo pidas de nuevo con otras
  palabras ni en partes más chicas para que no pregunte, y no lo hagas por otro
  camino (\`mv\`, \`rm\`): contáselo y seguí.
- **El diccionario del vault** es para los **términos propios de este vault** que
  el corrector subraya: nombres de proyectos y personas, siglas, jerga del área. Si
  el usuario te pide «agregá al diccionario los términos de esta nota», elegí esos,
  no cualquier palabra marcada: una errata no se agrega, se corrige. Cada entrada es
  **una palabra** como la ve el corrector (sin espacios ni guiones ni dígitos); la
  respuesta dice cuáles se rechazaron y por qué. En minúscula vale también
  Capitalizada y EN MAYÚSCULAS; con mayúscula («Mycelium»), solo así. Se deshace
  desde el registro de actividad. El diccionario **de Mycelium** (el de todos los
  vaults) no es tuyo: ese lo maneja el usuario.
- \`CAMBIOS_SIN_GUARDAR\`: la nota (o una de las que habría que reescribir) tiene un
  borrador en su pestaña. Mycelium guarda solo en unos segundos: esperá y repetí.
- **Si no tenés las herramientas**, nada de esto cambia tu trabajo con los archivos:
  solo no podés mostrar, saber qué está abierto ni modificar el calendario (leerlo
  sí, con la skill \`mycelium-calendario\`) ni el diccionario del vault (el usuario
  agrega la palabra con el clic derecho), y si renombrás o movés con \`mv\`, los
  enlaces los arreglás vos (regla dura 2). Un hook te recuerda las herramientas
  cuando corrés \`mv\` o \`rm\` sobre notas con el control encendido: si el MCP no
  responde, repetí el comando con \`MYCELIUM_SIN_MCP=1\` delante y él te deja pasar.

## Qué es Mycelium por fuera (conocer, no controlar)

Fuera de las herramientas \`mycelium_*\` no controlás la aplicación: trabajás sobre
sus archivos. Pero es útil saber qué ve el usuario, porque es el efecto de lo que
escribís: editor Markdown con vista en vivo y de lectura; callouts (\`note\`, \`tip\`, \`important\`, \`warning\`, \`caution\`,
\`info\`, \`success\`, \`error\`, \`danger\`, \`question\`; plegables con \`[!tipo]-\`),
incluso anidados; **listas de tareas con estados** según el símbolo de la casilla
(\`[x]\` hecha, \`[-]\` cancelada, \`[/]\` en curso…, ver la skill \`mycelium-vault\`);
**propiedades** del frontmatter como tarjeta arriba de la nota y
como pestaña editable en el panel; **Esporas** (plantillas de notas) en su propio
panel del rail, en la barra del editor y en el clic derecho de una carpeta;
**tablas** \`.base\` con sus filtros, orden y buscador; **lienzos** \`.canvas\`;
**diagramas** \`.drawio\` con el editor de draw.io y **dibujos** \`.excalidraw\`, en
su pestaña o embebidos en una nota; un **calendario** con recordatorios (fecha,
hora, repetición y avisos) en su panel del rail;
**grafo de conexiones** global y mini-grafo por nota (tus enlaces se ven ahí);
búsqueda global —por nombre, por contenido o los dos, con \`clave:valor\` y
\`tag:x\`, y con los resultados agrupables por carpeta—; un **visor** para los
archivos que no son notas (PDF, imágenes, y código con resaltado de sintaxis, que
además se puede editar); panel lateral con pestañas ancladas; **terminal
integrada** (es probable que estés corriendo en ella, con cwd en el vault);
exportación a Markdown/PDF/carpeta; papelera propia; Mermaid (\`\`\`mermaid) y KaTeX
(\`$…$\`).

El usuario puede además **renombrar una nota escribiendo en su título**, arriba
del documento. Mycelium detecta tus cambios en disco y refresca la UI solo:
notas, tablas, lienzos, diagramas y dibujos abiertos se recargan con lo que
escribiste. **Salvo** que el usuario tenga ahí cambios sin guardar (o una tarjeta
de lienzo en edición): entonces no recarga, y lo que guarde después pisa lo tuyo.
Y el **editor modal** de un dibujo embebido en una nota no recarga nunca: si está
abierto, al cerrarlo pisa lo que escribiste. Si sabés que el usuario está
editando ese archivo, avisale antes de escribir.
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
| Embed de diagrama | \`![[Título.excalidraw]]\` / \`![[Título.drawio]]\` | Renderiza el dibujo o el diagrama |
| Etiqueta | \`#tag\` | Píldora clicable |
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
| \`[x]\` (o \`[X]\`) | Hecha | Casilla marcada; texto tachado y atenuado |
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

## Estructura del vault

- **Notas**: \`.md\`. El título de la nota es su nombre de archivo (sin extensión).
  **Son lo único que Mycelium indexa** (ver \`CLAUDE.md\`).
- **Tablas**: \`.base\` (YAML). Skill \`mycelium-base\`.
- **Lienzos**: \`.canvas\` (JSON Canvas). Skill \`mycelium-canvas\`.
- **Dibujos**: \`.excalidraw\` (JSON). Skill \`mycelium-excalidraw\`.
- **Diagramas**: \`.drawio\` (XML de mxGraph). Figuras y conectores que se enganchan,
  para el diagrama que hay que retocar dentro de seis meses. Skill \`mycelium-drawio\`.
- **Cualquier otro archivo** (PDF, imágenes, código, texto): el vault los guarda y
  la app los muestra, pero no están indexados.
- **\`Esporas/\`** (o la carpeta configurada): plantillas, no conocimiento (ver abajo).
- **\`.mycelium/\`**: índice interno, papelera (\`.mycelium/.trash/\`), calendario
  (\`recordatorios.json\`), preferencias, el diccionario del vault del corrector
  (\`diccionario.txt\`) y el registro de actividad de la IA. No escribir nunca;
  leer, solo esos dos JSON (skills \`mycelium-calendario\` y
  \`mycelium-esporas\`). El calendario y el diccionario se modifican por MCP.
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
- **Reusá las claves que ya existen** en el vault en vez de inventar sinónimos
  (\`estado\` / \`Estado\` / \`status\` fragmentan la memoria):
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
\`.base\` no se escanea. \`.drawio\` y \`.excalidraw\` no se indexan: solo una nota que
los embebe (\`![[Nombre.drawio]]\`, con la extensión) los conecta. Si hay una nota natural
—la que nombró el usuario o la del tema—, embebelos ahí y decí dónde; si no la hay, no
inventes una: creá el archivo y ofrecé embeberlo donde el usuario elija.

Las **Esporas** son moldes, no memoria: no consolides ahí, no las cites como
fuente, no las reportes como huérfanas. Viven directamente en \`Esporas/\` (o la
carpeta configurada) y sus variables son \`{{titulo}}\`, \`{{fecha}}\`, \`{{hora}}\` y
\`{{fecha:FORMATO}}\`: Mycelium las sustituye **solo cuando se usa desde la app**;
si creás una nota a partir de una, expandilas vos.

## \`.mycignore\`: qué ve Mycelium

Archivo opcional en la raíz, sintaxis tipo \`.gitignore\` **sin negaciones**:

- \`nombre/\` → directorios con ese nombre en cualquier nivel.
- \`nombre\` → archivos o carpetas con ese nombre en cualquier nivel.
- \`ruta/anidada/\` (con \`/\` interno) → anclada a la raíz del vault.
- \`*\` y \`?\` → comodines dentro de un segmento (\`*.tmp.md\`).
- \`# …\` → comentario.
- Sin archivo, el defecto ignora los directorios ocultos (\`.*/\`) y las carpetas de
  dependencias/build: \`node_modules/\`, \`target/\`, \`dist/\`, \`out/\`.
- Si el archivo **existe**, **reemplaza al default por completo** (no hay
  negaciones): si lo creás, repetí las líneas del default que quieras conservar.
- \`.mycelium/\` está ignorado **siempre**.

Un archivo ignorado existe en disco (podés leerlo y escribirlo) pero **no aparece
en la app ni en el grafo**. Si el usuario dice que no ve una nota que creaste,
revisá este archivo primero.

## Precauciones

- Renombrar o mover **por Mycelium** —desde la app, o vos con \`mycelium_renombrar\`
  y \`mycelium_mover\`— repara los \`[[enlaces]]\` que la apuntaban; un \`mv\` desde
  la terminal **no**: si no tenés las herramientas, actualizalos vos (alias
  \`[[viejo|…]]\`, embeds \`![[viejo]]\` y \`[[Carpeta/viejo]]\` incluidos).
- Mycelium reindexa solo al detectar cambios en disco: no hace falta avisar.
- El frontmatter que cae fuera del subconjunto soportado se muestra crudo y la
  nota queda sin propiedades indexadas: revisalo antes de dar por hecho que se
  guardaron.
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

/**
 * Marcador de versión (JSON) que se escribe en el vault. `huellas` guarda el
 * sha256 de lo que se escribió en cada archivo protegido (`DEF-118`): es lo que
 * permite saber, la próxima vez, si el usuario lo tocó.
 */
const versionJson = (huellas: Record<string, string>) =>
  JSON.stringify(
    { version: FRAMEWORK_IA_VERSION, generado: new Date().toISOString(), huellas },
    null,
    2,
  ) + "\n";

/** Marca presente en todo archivo generado por el framework. */
const MARCA_FRAMEWORK = "<!-- mycelium-ia v";

/**
 * Archivos del framework que el usuario puede ampliar a mano (`DEF-118`). Solo
 * se sobrescriben si están **intactos**; si no, la versión nueva va al lado.
 * Lo de `.claude/` no entra: es de Mycelium («No edites `.claude/`») y una
 * copia al lado de un comando sería un comando más.
 */
const RUTAS_PROTEGIDAS = new Set(["CLAUDE.md"]);

/**
 * sha256 de cada `CLAUDE.md` que generó Mycelium antes de que existieran las
 * `huellas` de `mycelium-ia.json` (framework 1.0.0 a 1.6.0), calculados desde el
 * historial de git de este archivo. Reconocen un `CLAUDE.md` viejo sin tocar
 * sin tener que adivinar. **Lista cerrada**: lo generado desde la 1.6.0 en
 * adelante queda registrado en `huellas` al escribirlo.
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
]);

/** sha256 en hex, con los saltos de línea normalizados (git puede pasarlos a CRLF). */
async function huella(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto.replace(/\r\n/g, "\n"));
  const digesto = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(digesto), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Las huellas registradas en `mycelium-ia.json` (vacío si no hay o es viejo). */
async function huellasRegistradas(vaultRuta: string): Promise<Record<string, string>> {
  const crudo = await leerTexto(vaultRuta, RUTA_VERSION);
  if (!crudo) return {};
  try {
    return (JSON.parse(crudo) as { huellas?: Record<string, string> }).huellas ?? {};
  } catch {
    return {};
  }
}

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
    // Una skill por herramienta (`FUN-L-26`), con los validadores que viajan
    // con ellas. Salen de `lib/ia/borradores/` y `scripts/validar-*.mjs` vía
    // `scripts/generar-skills-ia.mjs`; los `.mjs` llevan la marca en un
    // comentario de su primera línea, así que se actualizan como el resto de
    // `.claude/`.
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
 *   `<!-- mycelium-ia … -->`), se sobrescribe (es la actualización esperada)…
 * - …salvo que sea protegido (`CLAUDE.md`) y el usuario lo haya editado
 *   (`DEF-118`): la marca sobrevive a la edición, así que no alcanza. Se lo da
 *   por intacto solo si su huella es la de algo que Mycelium escribió —la
 *   registrada en `mycelium-ia.json` o la de un `CLAUDE.md` publicado—.
 * - Si existe un archivo del usuario (sin la marca, o editado), NO se toca: la
 *   versión nueva se escribe al lado como `nombre (mycelium-ia vX).ext` (con
 *   `(1)`, `(2)`… si hiciera falta) para que el usuario la integre a mano.
 * Si hubo conflictos, escribe además un reporte en la raíz
 * (`Conflictos instrucciones IA.md`) con archivos y rutas.
 */
export async function generarFramework(vaultRuta: string): Promise<ConflictoIa[]> {
  const conflictos: ConflictoIa[] = [];
  const registradas = await huellasRegistradas(vaultRuta);
  const huellas: Record<string, string> = {};

  for (const archivo of archivosFramework()) {
    const existente = await leerTexto(vaultRuta, archivo.ruta);
    const protegido = RUTAS_PROTEGIDAS.has(archivo.ruta);
    let destino = archivo.ruta;
    if (existente !== null) {
      let delFramework = existente.includes(MARCA_FRAMEWORK);
      if (delFramework && protegido) {
        const actual = await huella(existente);
        delFramework = actual === registradas[archivo.ruta] || HUELLAS_CLAUDE_MD_PREVIAS.has(actual);
      }
      if (!delFramework) {
        destino = await rutaAlternativa(vaultRuta, archivo.ruta);
        conflictos.push({ original: archivo.ruta, generado: destino });
      }
    }
    await invoke("escribir_nota", {
      vaultRuta,
      rutaRel: destino,
      contenido: archivo.contenido,
    });
    // Se registra lo generado aunque haya ido al lado: el original del usuario
    // no coincide con esta huella (se sigue respetando), y si el usuario adopta
    // la copia como su `CLAUDE.md`, la próxima actualización la reconoce.
    if (protegido) huellas[archivo.ruta] = await huella(archivo.contenido);
  }

  // Marcador de versión: es siempre del framework, se sobrescribe.
  await invoke("escribir_nota", {
    vaultRuta,
    rutaRel: RUTA_VERSION,
    contenido: versionJson(huellas),
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
