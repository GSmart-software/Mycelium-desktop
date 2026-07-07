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
