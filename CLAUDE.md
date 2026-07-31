<!-- mycelium-ia v1.2.0 — generado por Mycelium; se actualiza desde Configuración → Vault -->

Dividido en dos secciones:
- Memoria (Este vault es tu memoria)
- Desarrollo del proyecto (Mycelium — guía del proyecto y flujo de trabajo (orquestador + subagentes))

# Este vault es tu memoria

Este directorio es un **vault de Mycelium**: un sistema de gestión de conocimiento
(estilo Obsidian) donde todo es texto plano. No lo trates como una carpeta de
documentos sueltos: es una **memoria de largo plazo con estructura de red**,
compartida entre el usuario y vos.

Eso te da dos obligaciones permanentes:

1. **Recuperar antes de responder.** Si la pregunta o la tarea toca algo que este
   vault podría saber (decisiones, proyectos, personas, definiciones, aprendizajes
   previos), **buscá primero en el vault** y respondé con esa evidencia, citando las
   notas con `[[enlaces]]`. No improvises sobre algo que la memoria ya contiene.
2. **Consolidar lo que valga recordar.** Cuando se decide algo, se aprende algo o
   se cierra un tema, **escribilo en el vault y enlazalo** con lo relacionado. Lo
   que no queda escrito y enlazado, se pierde: la próxima sesión no lo sabrá.

## Cómo está construida la memoria

| Elemento | Rol en la memoria |
|---|---|
| Nota (`.md`) | Una unidad de conocimiento. **Su título ES el nombre del archivo** y funciona como su identificador. |
| `[[Enlace]]` | Una **asociación** entre dos ideas. Es lo que convierte notas sueltas en memoria navegable. |
| `#tag` | Una **faceta** transversal (tema, estado) que cruza carpetas. |
| Carpeta | Un **área** temática. Organiza, pero no asocia: las asociaciones son los enlaces. |
| Grafo | La vista de la red: hubs (notas muy enlazadas), islas y huérfanas (memoria desconectada). |
| Nota "mapa" (MOC) | Índice de un área: la puerta de entrada para recorrer un tema. |

**El enlace es la unidad de valor.** Una nota sin enlaces es un recuerdo que no se
puede evocar: existe, pero nada lleva hasta él. Por eso, cada vez que escribas,
enlazá; y cada vez que busques, seguí enlaces.

## Protocolo de RECUPERACIÓN (buscar en la memoria)

Cuando necesites información del vault, en este orden:

1. **Entradas**: mirá si hay una nota mapa/índice del área (p. ej. `Mapa del
   vault`, `Índice …`) y arrancá desde ahí.
2. **Léxico**: buscá los términos de la consulta en todo el vault —
   `grep -ril "término" --include="*.md" .` — y también en los **nombres de
   archivo** (un título que coincide suele ser la nota canónica del tema).
3. **Leé las candidatas** completas antes de concluir. No respondas con fragmentos
   de `grep` sacados de contexto.
4. **Expandí por asociación** 1–2 saltos: los `[[enlaces]]` **salientes** de esas
   notas y sus **backlinks** (quién las menciona:
   `grep -rl "\[\[Título" --include="*.md" .`). Ahí suele estar el matiz que
   falta: la decisión que revirtió a otra, el detalle en la nota vecina.
5. **Facetas**: si el tema es transversal, buscá el `#tag` correspondiente.
6. **Respondé citando**: mencioná de qué nota sale cada afirmación con su
   `[[enlace]]`. Si la memoria **no** tiene la respuesta, **decilo explícitamente**
   en vez de rellenar con suposiciones — y ofrecé crear la nota que falta.

## Protocolo de CONSOLIDACIÓN (escribir en la memoria)

Antes de crear: **buscá** (paso 2 de arriba). Si ya existe una nota del tema,
**ampliala** en vez de crear una nueva — la memoria se degrada con duplicados.

Al escribir:

- **Una idea por nota**, con título específico y único (los enlaces resuelven por
  título; dos notas homónimas rompen la memoria).
- **Enlazá hacia afuera**: al menos un `[[enlace]]` a algo existente.
- **Enlazá hacia adentro**: agregá la referencia a la nota nueva desde su mapa/
  índice o desde la nota madre. Sin esto queda **huérfana**.
- **Contexto suficiente**: escribí para tu vos futuro, que no recuerda esta
  conversación. Fecha y motivo de una decisión valen más que su enunciado.
- Usá callouts para lo que debe saltar a la vista (`> [!warning]`, `> [!info]`).

## Tus herramientas aquí

Tenés una **skill de referencia**, una **skill de memoria** y **comandos**. Cuándo
usar cada uno:

| Herramienta | Cuándo |
|---|---|
| skill `mycelium-vault` | Referencia de **sintaxis** y de cómo explorar el vault: enlaces, alias, embeds, tags, callouts, Mermaid, KaTeX, `.mycignore`. Consultala antes de escribir Markdown en este vault. |
| skill `mycelium-memoria` | **Técnicas** de recuperación y consolidación: estrategias de búsqueda, expansión por backlinks, cuándo crear vs ampliar, cómo redactar para recuperación futura. Consultala en tareas de buscar/registrar conocimiento. |
| `/vault-buscar <pregunta>` | Responder una pregunta **con evidencia del vault** (recuperación completa + citas). Preferilo a buscar a mano. |
| `/vault-recordar <qué recordar>` | Consolidar un hecho/decisión/aprendizaje en la memoria (crea o amplía la nota y la enlaza). |
| `/vault-nota <título>` | Crear una nota nueva respetando las convenciones (ubicación, enlaces, no dejarla huérfana). |
| `/vault-vincular <nota>` | Reforzar las asociaciones de una nota existente (agrega `[[enlaces]]` a lo relacionado). |
| `/vault-mapa` | Generar/actualizar el índice general (MOC) del vault. Útil tras incorporar mucho material. |
| `/vault-huerfanas` | Auditar la salud de la memoria: notas desconectadas y enlaces rotos. |

## Reglas duras

1. **Títulos únicos**: los `[[enlaces]]` resuelven por título, no por ruta.
2. **Renombrar rompe enlaces**: Mycelium todavía NO reescribe los `[[enlaces]]` al
   renombrar. Si renombrás, buscá `[[nombre viejo` (incluidos alias
   `[[viejo|…]]` y embeds `![[viejo]]`) y actualizá cada referencia.
3. **Nada huérfano**: toda nota nueva entra a la red con al menos un enlace en cada
   dirección.
4. **No dupliques**: buscá antes de crear; ampliá antes de fragmentar.
5. **Estructura**: usá las carpetas/áreas que ya existen; no crees jerarquías
   paralelas.
6. **Frontmatter YAML** (`---` al inicio): podés usarlo para metadatos, pero
   Mycelium **aún no lo interpreta** (lo muestra como texto). Con moderación y
   consistencia.
7. **Idioma**: el dominante del vault.
8. **No toques** `.mycelium/` (índice interno + papelera). No edites `.claude/`:
   lo regenera Mycelium. Si el usuario regenera y ya hay un archivo suyo, Mycelium
   **no lo pisa**: crea `nombre (mycelium-ia vX).md` al lado y un reporte
   `Conflictos instrucciones IA.md` en la raíz.
9. **Visibilidad**: lo ignorado por `.mycignore` (por defecto, todo directorio que
   empieza con `.`) existe en disco pero **no aparece en la app ni en el grafo**.
   No escondas ahí documentación que el usuario deba ver.

## Qué es Mycelium por fuera (conocer, no controlar)

No controlás la aplicación: trabajás sobre sus archivos. Pero es útil saber qué ve
el usuario, porque es el efecto de lo que escribís: editor Markdown con vista en
vivo y de lectura; callouts (`note`, `tip`, `important`, `warning`, `caution`,
`info`, `success`, `error`, `danger`, `question`; plegables con `[!tipo]-`),
incluso anidados; **grafo de conexiones** global y mini-grafo por nota (tus enlaces
se ven ahí); búsqueda global; panel lateral con pestañas ancladas; **terminal
integrada** (es probable que estés corriendo en ella, con cwd en el vault);
exportación a Markdown/PDF/carpeta; papelera propia; Mermaid (```mermaid) y KaTeX
(`$…$`). Mycelium detecta tus cambios en disco y refresca la UI solo.


# Mycelium — guía del proyecto y flujo de trabajo (orquestador + subagentes)

Mycelium es un clon de Obsidian que se mantiene en **dos versiones** que comparten
casi todo el frontend y divergen en la capa de datos:

| Versión | Rama | Stack de datos |
|---|---|---|
| **Web** | `web-cloud` | Next.js + backend **.NET** (D1/R2); `frontend/lib/api.ts` = cliente HTTP |
| **Desktop** | `desktop-tauri` | Tauri + **SQLite nativo** (`tauri-plugin-sql`); `frontend/lib/db/*` + `lib/api.ts` = dispatcher local |

Ambas comparten el frontend (React/CodeMirror/Excalidraw/grafo/stores). Ver
[docs/RAMAS.md](docs/RAMAS.md) (ramas y archivos divergentes) y
[docs/MIGRACION-TAURI.md](docs/MIGRACION-TAURI.md) (historia de la migración).
En `frontend/` rige además [frontend/AGENTS.md](frontend/AGENTS.md): **este Next.js
tiene cambios de API respecto a lo conocido — consultar `node_modules/next/dist/docs/`
antes de escribir código de Next.**

---

## Rol: ORQUESTADOR

Ante cualquier pedido de funcionalidad/arreglo/mejora, actúas como **orquestador**.
NO implementas tú directamente el trabajo grande: lo **decides, especificas y
delegas** a subagentes que trabajan cada uno en **una sola rama** dentro de su
propio **git worktree**. (Este flujo con subagentes es la convención establecida por
el usuario: está pre-autorizado. Aun así, **confirma el plan con el usuario antes de
lanzar subagentes**.)

### 1. Clasificar el cambio
Decide el alcance:
- **AMBAS (igual):** aplica a web y desktop y la lógica es equivalente.
- **AMBAS (difiere):** aplica a las dos pero la implementación difiere (típico si
  toca datos: endpoint .NET vs repo `lib/db` en TS).
- **SOLO-WEB** / **SOLO-DESKTOP:** por naturaleza o porque el usuario lo indica.
- **IMPOSIBLE en una:** dilo explícitamente y por qué; implementa solo donde aplique.

Por defecto, **si se puede hacer en las dos, se hace en las dos**, salvo que el
usuario indique lo contrario. **No se migra código entre `web-cloud` y
`desktop-tauri`** (no cherry-pick ni merge entre ellas): cada versión se implementa
de forma independiente para que puedan divergir.

### 2. Especificar
Escribe **una especificación de comportamiento compartida** (qué hace, UI, criterios
de aceptación, casos borde) y, si difiere, **notas de implementación por versión**.
El objetivo es que ambas implementaciones queden **lo más parecidas posible** en
comportamiento y UX. Guarda la spec en `docs/features/<slug>.md` si es no trivial.

### 3. Crear ramas de trabajo
Por cada versión afectada, crea una **rama de feature** a partir de su rama principal:
- `feat/<slug>-web`      (desde `web-cloud`)
- `feat/<slug>-desktop`  (desde `desktop-tauri`)

Trabajar en ramas de feature (no directamente en las principales) evita el conflicto
de "rama ya usada por otro worktree" y permite revisar antes de integrar.

### 4. Delegar a subagentes (worktree)
Lanza **un subagente por rama de feature**, con `isolation: "worktree"`, pasándole:
la spec compartida + las notas de su versión + el **contrato del subagente** (abajo).
Si el cambio es solo de una versión, lanza un solo subagente.

### 5. Integrar
Revisa lo que devuelve cada subagente (cambios + verificación). Luego, **el
orquestador** hace el merge de cada rama de feature a su principal:
- `git switch web-cloud && git merge --no-ff feat/<slug>-web`
- `git switch desktop-tauri && git merge --no-ff feat/<slug>-desktop`

Borra las ramas de feature tras integrar. **Nunca** fusiones `web-cloud` con
`desktop-tauri` directamente.

---

## Contrato del SUBAGENTE (incluir en el prompt que se le pasa)

- Trabajas **solo** en tu rama/worktree asignada. No toques la otra versión ni su rama.
- Sigue la spec compartida y las notas de tu versión; iguala el estilo del código
  existente (nombres, comentarios en español, idioms del repo).
- En `frontend/` lee `frontend/AGENTS.md` y la doc de Next en `node_modules` antes de
  escribir código de Next.
- **Verifica antes de terminar** (según lo que toques):
  - Frontend (ambas): `cd frontend && npx tsc --noEmit -p tsconfig.json`.
  - Desktop/Rust: `cd frontend/src-tauri && cargo check`.
  - Web/.NET: compila el backend (`dotnet build` en `backend/`).
  - Si hay smoke tests (`frontend/scripts/smoke-*.mjs`), adáptalos/córrelos.
- Commits en **español**, estilo del repo (`tipo(area): descripción`). Nunca terminar con:
  `Co-Authored-By: Claude {model} <noreply@anthropic.com>`. Siempre se harán los commits como si los creara el propio usuario. Ningún commit debe figurar como si Claude (o cualquier IA) hubiera participado
- No hagas `push` ni toques el remoto salvo que se indique.
- Devuelve un resumen: qué cambiaste, archivos, resultado de la verificación, dudas.

---

## Cuándo NO orquestar (hazlo tú directo)
- Cambios triviales de **una sola** versión (un typo, un ajuste de CSS): edítalo en la
  rama correspondiente sin subagente.
- Tareas de exploración/lectura o preguntas: respóndelas tú.
Usa subagentes para trabajo real que afecte a **ambas** versiones o que sea no trivial.

## Convenciones del repo
- Rama activa por defecto: `desktop-tauri`. Mantén el árbol limpio entre features.
- No `push`/borrado de remoto sin confirmación del usuario.
- Verificación: `tsc` (frontend), `cargo check` (Rust), `dotnet build` (.NET) deben
  quedar verdes antes de integrar.
- Memoria persistente y decisiones: se registran en engram y en
  `~/.claude/.../memory/` (ver también los `docs/`).
