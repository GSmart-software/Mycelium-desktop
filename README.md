# Micelio

Tu red de conocimiento, viva y conectada. Editor de notas Markdown con enlaces
`[[wiki]]`, grafo de conocimiento y colaboración — inspirado en Obsidian.

## Estructura del repo

| Carpeta | Contenido |
|---------|-----------|
| `frontend/` | Next.js (App Router, TypeScript). UI del workspace, editor CodeMirror, preview. |
| `backend/` | .NET 9 minimal API. Datos vía puertos `ID1Client` / `IBlobStorage` con adaptadores local (SQLite + disco) y Cloudflare (D1 + R2, pendientes). |
| `docs/` | `DESIGN_SYSTEM.md` (tokens, layout, estados visuales) y `FUTURE_IMPLEMENTATIONS.md`. |
| `legacy/` | Prototipo vanilla original (referencia; el grafo y el parser de wikilinks se portan desde aquí). |
| `HUs.md` | Backlog de historias de usuario con criterios de aceptación. |

## Desarrollo local

Todo corre local, sin Cloudflare (`Storage:Provider=local` en
`appsettings.Development.json`).

```bash
# Backend — http://localhost:5279
cd backend/src/Micelio.Api
dotnet run

# Frontend — http://localhost:3000
cd frontend
npm install
npm run dev
```

La base local (`micelio.local.db`) y los blobs (`./.local-storage/blobs/`) son
desechables: borrarlos reinicia el estado limpio.
