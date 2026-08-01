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

| Versión | Rama | Versión actual | Stack de datos |
|---|---|---|---|
| **Desktop** | `desktop-tauri` | **1.1.1** | Tauri + **SQLite nativo** (`tauri-plugin-sql`) sobre una carpeta real; `frontend/lib/db/*` + `lib/api.ts` = dispatcher local |
| **Web** | `web-cloud` | **1.0.0** | Next.js + backend **.NET** (D1/R2); `frontend/lib/api.ts` = cliente HTTP |

Ambas comparten el frontend (React/CodeMirror/Excalidraw/grafo/stores).

> [!important] Las dos líneas se separaron en 1.1.0
> Todo lo que entró después de 1.0.0 es **solo-desktop** (terminal integrada,
> framework de IA del vault, `.mycignore`, rendimiento del grafo, devtools en
> producción), así que web sigue en `1.0.0`. La regla "si se puede en las dos, se hace
> en las dos" **sigue vigente**, pero el foco actual —la línea de IA sobre el vault—
> por naturaleza no aplica a web. Ver [[Diferencias funcionales aceptadas entre versiones]].

## La documentación del proyecto ES un vault de Mycelium

`docs/` no es una carpeta de documentos sueltos: es la **memoria del proyecto**, una red
de notas enlazadas con `[[wikilinks]]` (y este repo es el primer caso de uso de
[[Mycelium como memoria de la IA]]). Aplica la sección de arriba: **recuperá antes de
responder y consolidá lo que valga recordar**, ahí.

- **Puerta de entrada: [[Mapa de documentacion]]** (`docs/Mapa de documentacion.md`).
  Empezá siempre por ahí; casi cualquier nota lleva al resto por enlaces.
- Atajos útiles: [[Estado del proyecto]] (dónde está todo hoy) ·
  [[Arquitectura de Mycelium]] · [[RAMAS]] (archivos divergentes) ·
  [[BACKLOG]] (qué falta, con IDs y tamaños) · [[Aprendizajes tecnicos]] ·
  [[Levantar Mycelium en desarrollo]].
- Al cerrar un tema, **escribí la nota y enlazala** desde su mapa/nota madre. Las specs
  de funcionalidad van en `docs/features/<slug>.md`; los procesos en `docs/procesos/`;
  las decisiones en `docs/decisiones/`.

> [!warning] Documentos desactualizados a propósito
> `docs/DESKTOP-LOCAL.md` (empaquetado pre-Tauri), `docs/Roadmap general.md`
> (brainstorming previo) y el `README.md` de la raíz (describe la estructura de la línea
> **web**: `backend/`, `legacy/`, que no existen en `desktop-tauri`). Se conservan como
> registro, **no** como referencia.

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

> [!tip] Alternativa: reflejar en vez de implementar en paralelo
> Cuando el cambio **ya está hecho y confirmado por el usuario en desktop**, en lugar de
> lanzar un subagente para web se usa la receta de [[Reflejar cambios de desktop a web]]:
> worktree temporal de `web-cloud`, clasificar cada archivo en **compartido** (se trae
> entero con `git checkout desktop-tauri -- <archivo>`) o **divergente** (se aplica a
> mano o con parche `--3way`), y verificar con `npm ci` + `tsc` + `next build`. Es lo que
> más se usó en la fase de bugs `DEF-*`. La lista viva de archivos divergentes está en
> [[RAMAS]].

---

## Contrato del SUBAGENTE (incluir en el prompt que se le pasa)

- Trabajas **solo** en tu rama/worktree asignada. No toques la otra versión ni su rama.
- Sigue la spec compartida y las notas de tu versión; iguala el estilo del código
  existente (nombres, comentarios en español, idioms del repo).
- En `frontend/` lee `frontend/AGENTS.md` y la doc de Next en `node_modules` antes de
  escribir código de Next.
- **Verifica antes de terminar** (según lo que toques) — ver [[Verificar antes de integrar]]:
  - Frontend (ambas): `cd frontend && npx tsc --noEmit -p tsconfig.json`.
  - Desktop/Rust: `cd frontend/src-tauri && cargo check` (y `cargo test --lib <modulo>`
    si el módulo tiene tests, p. ej. `mycignore`).
  - Web/.NET: compila el backend (`dotnet build` en `backend/`).
  - Reflejo a web o empaquetado: además `npm ci` + `npx next build`.
  - Si hay smoke tests (`frontend/scripts/smoke-*.mjs`), adáptalos/córrelos.
- **Al interpretar la verificación**: no canalices el comando cuyo éxito querés evaluar
  (`| tee`, `| grep` devuelven **su** exit code y ya reportaron éxito sobre builds rotos);
  en Rust, el **primer** error cronológico es el que importa. Y `tsc` verde **no** prueba
  comportamiento: lo visible lo confirma el usuario en la app.
- Commits en **español**, estilo del repo (`tipo(area): descripción`), referenciando el ID
  entre corchetes (`[DEF-023]`, `[FUN-L-07]`) y explicando la **causa raíz** en los fix.
  Nunca terminar con: `Co-Authored-By: Claude {model} <noreply@anthropic.com>`. Siempre se
  harán los commits como si los creara el propio usuario. Ningún commit debe figurar como
  si Claude (o cualquier IA) hubiera participado. Ver [[Convenciones de commits]].
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
- **No `push`/borrado de remoto sin confirmación del usuario.** `origin` está
  desalineado **a propósito** (tiene `desktop-cloud`, `main`, `deploy/cloudflare`; los
  renombres se hicieron en local). Los comandos para alinearlo están en [[RAMAS]],
  pendientes de decisión del usuario.
- Verificación: `tsc` (frontend), `cargo check` (Rust), `dotnet build` (.NET) deben
  quedar verdes antes de integrar.
- **La memoria del proyecto vive en `docs/`** como red de notas enlazadas (entrada:
  [[Mapa de documentacion]]). Ahí van decisiones, procesos y aprendizajes. engram y
  `~/.claude/.../memory/` son complementos operativos, no el registro canónico.
- `frontend/src-tauri/Cargo.toml` puede aparecer modificado por diferencia de fin de
  línea (CRLF/LF): es ruido del working tree, no un cambio real.

## Versionar y empaquetar (solo desktop)

Al subir de versión hay que tocar **todos** estos lugares a mano (no hay automatización):
`frontend/lib/version.ts` (`APP_VERSION`, es lo que ve el usuario) · `frontend/package.json`
· `frontend/src-tauri/Cargo.toml` · `frontend/src-tauri/tauri.conf.json` (define el nombre
del instalador). El criterio lo decide **qué cambia para el usuario**, no el tamaño del
trabajo: si no puede hacer nada que antes no pudiera, es **patch** —aunque el cambio haya
costado mucho—; si gana funcionalidad, minor; si es rearquitectura, major. Los tamaños
del [[BACKLOG]] (`FUN-S/M/L/XL`) miden **esfuerzo**, no impacto de versión.
**Si una rama no recibió cambios funcionales, no se le sube la versión.**

> [!important] Una unidad de versión POR funcionalidad
> Si entran **dos** funcionalidades, la versión sube **dos** minors: desde `1.1.1` se va
> a **`1.3.0`**, no a `1.2.0`. Nunca se agrupan varias funcionalidades en un solo salto.
> Lo mismo con las correcciones: cada una suma un patch. **Al subir un dígito, los de la
> derecha vuelven a `0`** (por eso 1 funcionalidad + 2 correcciones desde `1.1.1` es
> `1.2.0`: el minor sube y el patch se resetea). Detalle y ejemplos en
> [[Versionado del sistema]].

> [!important] El framework de IA se versiona aparte
> `FRAMEWORK_IA_VERSION` en `frontend/lib/ia/framework.ts` **no** sigue la versión de la
> app. Si Mycelium gana una función que la IA deba conocer → subir esa versión y
> actualizar los templates. Historial: `1.0.0` inicial · `1.1.0` `.mycignore` + política
> de conflictos · `1.2.0` reenfoque a memoria (**el instalado en este vault**) · `1.2.1`
> default de `.mycignore` corregido en los templates (disponible, sin regenerar acá).

Empaquetado: `cd frontend && CARGO_BUILD_JOBS=2 npx tauri build` (sin el límite de jobs,
rustc se queda sin memoria). Genera MSI y NSIS en `src-tauri/target/release/bundle/`; se
preservan en `installers/v<version>/` (fuera de git). **Nunca cambiar el
`bundle.windows.wix.upgradeCode`** de `tauri.conf.json`: es la identidad de la app para
Windows. Ver [[Generar instaladores desktop]].
