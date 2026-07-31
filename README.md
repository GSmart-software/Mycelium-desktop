# Mycelium

Tu red de conocimiento, viva y conectada. Editor de notas Markdown con enlaces
`[[wiki]]`, grafo de conocimiento y colaboración — inspirado en Obsidian.

## Estructura del repo

| Carpeta | Contenido |
|---------|-----------|
| `frontend/` | Next.js (App Router, TypeScript). UI del workspace, editor CodeMirror, preview. |
| `backend/` | .NET 9 minimal API. Datos vía puertos `ID1Client` / `IBlobStorage` con adaptadores local (SQLite + disco) y Cloudflare (D1 + R2, pendientes). |
| `docs/` | Toda la documentación del proyecto, como red de notas enlazadas. Entrada: [[Mapa de documentacion]]. |
| `legacy/` | Prototipo vanilla original (referencia; el grafo y el parser de wikilinks se portan desde aquí). Solo en `web-cloud`. |

> [!tip] La documentación es un vault de Mycelium
> `docs/` se mantiene **con Mycelium**: notas enlazadas con `[[wikilinks]]`, navegables
> desde [[Mapa de documentacion]] y visibles en el grafo. Para orientarte rápido:
> [[Arquitectura de Mycelium]], [[Estado del proyecto]] y
> [[Levantar Mycelium en desarrollo]]. Las historias de usuario están en [[HUs]].

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

- Email: dev@micelio.local
- Password: micelio123