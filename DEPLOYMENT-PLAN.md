# Plan de despliegue — Mycelium en Cloudflare (D1 + R2) + Render + Pages

## Contexto

El proyecto está arquitectónicamente listo para Cloudflare (puertos `ID1Client` /
`IBlobStorage` / `ICollabRelay` / `IEmailSender` seleccionados por
`Storage:Provider`), pero los adaptadores Cloudflare son stubs que lanzan
`NotImplementedException`. El objetivo: **datos en Cloudflare (D1 + R2)**,
desplegar **frontend y backend**, en una **rama nueva** sin tocar el estado local,
y dejar un **conmutador rápido local ↔ despliegue**.

Restricción central descubierta: **ASP.NET Core (.NET 9) NO corre en Cloudflare
Workers** (solo JS/Wasm). Por eso Cloudflare guarda los datos (D1 vía HTTP API, R2
vía API S3) y el contenedor .NET se hospeda aparte. Decisiones tomadas:

- **Backend** → **Render** (contenedor Docker, TLS gestionado).
- **Frontend** → **Cloudflare Pages**, export estático (`output: 'export'`) — la app
  es 100% cliente (`"use client"`, sin rutas server ni `app/api`).
- **Email** → se mantiene deshabilitado (`LogEmailSender`). **Sin auto-verificación**:
  el administrador verifica cada cuenta manualmente desde la DB (D1) por ahora.
- **Alcance** → implementar adaptadores D1/R2 + config de despliegue completa.

### Topología objetivo

```
Navegador
  │  (HTTPS, fetch credentials:include)
  ├──────────────► Cloudflare Pages  (frontend estático, out/)
  └──────────────► Render            (contenedor .NET 9, Micelio.Api)
                        │  HTTPS
                        ├──► Cloudflare D1  (SQLite gestionada, REST API)
                        └──► Cloudflare R2  (blobs .md/.css, API S3)
```

---

## Estrategia de rama

- Crear `deploy/cloudflare` desde `main` **tras** commitear o stashear los cambios
  sueltos actuales (hay 11 archivos `M` de pulido UI no relacionados — confirmar si
  entran en `main` antes de ramificar).
- Todo el trabajo de despliegue vive en `deploy/cloudflare`. `main` sigue siendo
  100% local-first y desechable.
- Los secretos (claves D1/R2, `Jwt:Secret` de prod) **nunca** se commitean: van como
  variables de entorno en Render / Pages y como `appsettings.Production.json`
  plantilla con placeholders + `.env.production.example`.

---

## Parte A — Backend: adaptadores Cloudflare + despliegue

### A1. Implementar `D1Client` (REST API de D1)
`backend/src/Micelio.Api/Adapters/Cloudflare/D1Client.cs` (hoy stub).

- Inyectar `IHttpClientFactory` + `IConfiguration`. Registrar `AddHttpClient` en
  `Program.cs` (rama cloudflare).
- `QueryAsync(sql, params)` → `POST https://api.cloudflare.com/client/v4/accounts/{accountId}/d1/database/{databaseId}/query`
  con `Authorization: Bearer {apiToken}` y body `{ "sql": sql, "params": [...] }`.
  La respuesta D1 es `{ "result": [ { "results": [...], "success": true, "meta": { "changes", "last_row_id" } } ], "success", "errors" }`.
  Mapear `result[0]` a `D1Result(Results, Success, D1Meta(Changes, LastRowId))` — el
  envelope ya coincide con el que produce `LocalSqliteD1Client`, así que los
  repos/mappers no cambian.
- `BatchAsync(statements)`: D1 REST no expone transacciones explícitas como el binding
  de Workers. Implementar concatenando las N sentencias en un único `sql`
  separado por `;` con los `params` aplanados en orden (D1 enlaza `?`
  posicionalmente sobre toda la cadena y ejecuta la petición de forma atómica por
  request). Documentar el caveat de rollback en un comentario. Devolver un
  `D1Result` por sentencia a partir del array `result`.
- Config: `Cloudflare:AccountId`, `Cloudflare:D1:DatabaseId`, `Cloudflare:ApiToken`.

### A2. Implementar `R2BlobStorage` (API S3 de R2)
`backend/src/Micelio.Api/Adapters/Cloudflare/R2BlobStorage.cs` (hoy stub).

- Añadir `PackageReference` **`AWSSDK.S3`** al `.csproj`.
- Construir `AmazonS3Client` con `ServiceURL = https://{accountId}.r2.cloudflarestorage.com`,
  `AuthenticationRegion = "auto"`, `ForcePathStyle = true`, y
  `DisablePayloadSigning = true` (R2 lo requiere; ya anotado en HU-04). Credenciales
  R2 = Access Key ID + Secret Access Key.
- Mapear los 4 métodos del puerto a `GetObject` / `PutObject` / `DeleteObject` /
  `GetObjectMetadata` sobre el bucket `Cloudflare:R2:Bucket`. `GetAsync` devuelve
  `null` ante 404 (`AmazonS3Exception` con `NotFound`), igual que el adaptador local.
- Config: `Cloudflare:R2:Bucket`, `Cloudflare:R2:AccessKeyId`, `Cloudflare:R2:SecretAccessKey`,
  `Cloudflare:AccountId`.

### A3. Email deshabilitado en prod — verificación manual por el admin
La rama `cloudflare` ya registra `LogEmailSender`; **sin cambios de código** en el
flujo de registro. Los usuarios nuevos se crean con `email_verificado = 0` y no
pueden completar login hasta ser verificados. Por ahora el administrador los
verifica manualmente contra D1:

```bash
wrangler d1 execute micelio-prod --remote \
  --command "UPDATE usuarios SET email_verificado = 1 WHERE email = 'usuario@ejemplo.com'"
```

Documentar este procedimiento en `docs/DEPLOYMENT.md`. (Resend / verificación
automática quedan como mejora futura.)

### A4. Cookies y proxy — el punto crítico del despliegue
Hoy en `AuthEndpoints.cs:246-253` el refresh cookie es
`SameSite=Lax`, `Secure = http.Request.IsHttps`, `Path=/auth`.

Problemas en despliegue y arreglos:

1. **Cross-site**: `*.pages.dev` ↔ `*.onrender.com` son dominios registrables
   distintos → un cookie `Lax` **no se envía** en el fetch a `/auth/refresh`, la
   sesión no persiste. Hacer el modo configurable: leer
   `Auth:CookieSameSite` (`Lax` | `None`) y `Auth:CookieDomain` (opcional).
   - Camino recomendado: **dominio propio con subdominios** (`app.midominio.com` +
     `api.midominio.com`) → mismo sitio registrable → `Lax` sigue funcionando, sin
     problemas de cookies de terceros. Set `Auth:CookieDomain=.midominio.com`.
   - Sin dominio propio: `Auth:CookieSameSite=None` (+ `Secure`). Funciona en
     Chrome/Firefox pero Safari bloquea cookies de terceros — por eso se recomienda
     el dominio propio.
2. **Secure tras proxy de Render**: Render termina TLS en su proxy; la app ve HTTP y
   `IsHttps` da `false`, lo que impediría marcar `Secure` (y `SameSite=None` exige
   `Secure`). Añadir en `Program.cs` `app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = XForwardedFor | XForwardedProto })`
   **antes** de CORS/auth, y forzar `Secure = true` en producción vía config
   `Auth:CookieSecure` (default sigue `IsHttps` en local).
   Aplicar los mismos `Domain`/`SameSite`/`Secure` a los `Cookies.Delete` de
   logout/refresh (líneas 128, 160) para que el borrado haga match.
3. **CORS**: `Cors:FrontendOrigin` ya alimenta la policy con `AllowCredentials`.
   En prod ponerlo a la URL exacta de Pages (sin barra final).

### A5. Switch de proveedor y config de producción
- `Program.cs` ya conmuta por `Storage:Provider`. Sin cambios de lógica salvo A1-A4.
- Crear `appsettings.Production.json` (plantilla, **placeholders** no secretos):
  `Storage:Provider=cloudflare`, claves `Cloudflare:*`, `Cors:FrontendOrigin`,
  `Auth:*`, `Jwt:Issuer`. Los valores reales (tokens, `Jwt:Secret`) se inyectan en
  Render como env vars con notación doble guion bajo: `Storage__Provider`,
  `Cloudflare__ApiToken`, `Cloudflare__R2__SecretAccessKey`, `Jwt__Secret`,
  `Cors__FrontendOrigin`, `Auth__CookieSameSite`, etc.

### A6. Dockerfile + Render
- Crear `backend/Dockerfile` multi-stage: `mcr.microsoft.com/dotnet/sdk:9.0` para
  `dotnet publish -c Release`, runtime `mcr.microsoft.com/dotnet/aspnet:9.0`.
  **PuppeteerSharp** (export PDF, HU-10) necesita Chromium: instalar deps de
  Chromium en la imagen runtime (o documentar que el PDF puede quedar diferido si se
  prefiere imagen mínima). Exponer el puerto vía `ASPNETCORE_URLS=http://+:${PORT}`
  (Render inyecta `PORT`).
- Crear `render.yaml` (Blueprint) o documentar el setup manual: servicio Web tipo
  Docker, `dockerfilePath: backend/Dockerfile`, health check `GET /health`, y todas
  las env vars de A5.
- `migrations/local/local_schema.sql` **no** se ejecuta en modo cloudflare
  (el `LocalDbInitializer` solo se registra en la rama local) → el esquema se aplica
  a D1 por separado (Parte B).

---

## Parte B — Recursos Cloudflare (una vez, vía Wrangler/dashboard)

- **D1**: `wrangler d1 create micelio-prod` → anotar `database_id`.
- **Esquema D1**: copiar `local_schema.sql` a `migrations/d1/schema.sql` (es SQLite
  puro y D1-compatible, FTS5 incluido) y aplicar:
  `wrangler d1 execute micelio-prod --remote --file=migrations/d1/schema.sql`.
- **Seed prod**: `migrations/d1/seed.sql` con un usuario verificado + su vault +
  membresía (espejo de `LocalDbInitializer`, con `email_verificado=1`), aplicado con
  `wrangler d1 execute`. Hash BCrypt generado una vez.
- **R2**: `wrangler r2 bucket create micelio-blobs`; crear un **R2 API Token**
  (Access Key ID + Secret) con permisos sobre el bucket.
- **API Token D1**: token de cuenta con permiso `D1:Edit` para el `D1Client`.
- Cargar todos estos valores como env vars en Render (Parte A5). Guardar un
  `wrangler.toml` en la raíz solo para referenciar D1/R2 (y futura fase Durable
  Objects), aunque el binding nativo no lo use el backend .NET.

---

## Parte C — Frontend en Cloudflare Pages (export estático)

- `frontend/next.config.ts`: añadir `output: 'export'` (+ `images: { unoptimized: true }`
  por si acaso; no usan `next/image`). `next build` genera `out/`.
- Verificar que el export no rompe: la app es client-only, navegación por query
  params (`?note=`), sin `app/api`, sin server actions, `next/font` compatible con
  export. Posible ajuste menor: páginas de auth que dependan de runtime — revisar que
  ninguna use APIs server-only.
- Env: crear `frontend/.env.production` con `NEXT_PUBLIC_API_URL=https://<api-en-render>`
  (o `https://api.midominio.com`). En Pages, definir `NEXT_PUBLIC_API_URL` como
  variable de build.
- Deploy: `npx wrangler pages deploy out --project-name=micelio` (o conectar el repo
  en el dashboard de Pages con build command `npm run build` y output dir `out`).
  Añadir script `npm run deploy:pages`.
- Si más adelante se quiere SSR, migrar a `@opennextjs/cloudflare` (fuera de alcance).

---

## Parte D — Conmutador rápido local ↔ despliegue

Objetivo: cambiar de modo "rápidamente".

- **Backend local** (sin cambios): `appsettings.Development.json` ya fuerza
  `Storage:Provider=local`. `dotnet run` sigue igual.
- **Backend prod**: `ASPNETCORE_ENVIRONMENT=Production` + env vars → modo cloudflare.
  Documentar en `README`/`docs/DEPLOYMENT.md` el set completo de variables.
- **Frontend**: `.env.local` (→ `localhost:5279`) vs `.env.production` (→ API Render).
  `npm run dev` usa local; el build de Pages usa production. Sin tocar código.
- Crear `docs/DEPLOYMENT.md` con: checklist de recursos Cloudflare, tabla de env vars
  (Render + Pages), comandos de deploy, y el procedimiento de rollback (Render guarda
  releases; Pages guarda deployments).

---

## Archivos a crear / modificar

**Backend (implementación):**
- `backend/src/Micelio.Api/Adapters/Cloudflare/D1Client.cs` — implementar (A1)
- `backend/src/Micelio.Api/Adapters/Cloudflare/R2BlobStorage.cs` — implementar (A2)
- `backend/src/Micelio.Api/Micelio.Api.csproj` — `AWSSDK.S3`
- `backend/src/Micelio.Api/Program.cs` — `AddHttpClient`, `UseForwardedHeaders`
- `backend/src/Micelio.Api/Features/Auth/AuthEndpoints.cs` — cookie config-driven (A4)
- `backend/src/Micelio.Api/appsettings.Production.json` — plantilla (A5)

**Despliegue / infra (nuevos):**
- `backend/Dockerfile`, `render.yaml`
- `wrangler.toml`, `migrations/d1/schema.sql`, `migrations/d1/seed.sql`
- `frontend/next.config.ts` (export), `frontend/.env.production`, `frontend/.env.production.example`
- `docs/DEPLOYMENT.md`
- scripts npm `deploy:pages`

**Sin cambios:** repos/mappers (el envelope D1 coincide), stores frontend, `lib/api.ts`
(ya lee `NEXT_PUBLIC_API_URL`), esquema de negocio.

---

## Verificación

1. **Local intacto**: en `main`/local, `dotnet run` (Storage=local) + `npm run dev`
   siguen funcionando (login seed `dev@micelio.local` / `micelio123`).
2. **Adaptadores D1/R2 (staging)**: con env vars de Cloudflare y
   `Storage:Provider=cloudflare`, correr el backend en local apuntando a D1/R2 reales;
   `GET /health` → `storageProvider: "cloudflare"`; registrar usuario, crear nota,
   recargar → la nota persiste en D1 + R2 (verificar con `wrangler d1 execute "SELECT..."`
   y `wrangler r2 object get`).
3. **Auth cross-site**: tras desplegar, login desde el dominio de Pages → confirmar en
   DevTools que el cookie de refresh se setea (`Secure`, `SameSite` correcto) y que
   `/auth/refresh` mantiene sesión al recargar. Este es el punto de fallo más probable.
4. **FTS5 en D1**: búsqueda global devuelve resultados (HU-21).
5. **Export estático**: `npm run build` genera `out/` sin errores; servir `out/`
   localmente y verificar que la SPA arranca y llega al backend.
6. **PDF (HU-10)**: si se incluye Chromium en la imagen, probar export PDF en Render;
   si no, marcar diferido.

---

## Diferido (no en este plan)

- **Colaboración en tiempo real (HU-05/06/37)**: requiere un Durable Object
  (relay y-websocket que persista el CRDT) + `Collab:RelayBaseUrl`. El puerto
  `ICollabRelay` y el frontend ya están listos; las notas compartidas se editan por
  turnos vía HU-04 hasta entonces. Es la única pieza que necesita compute en
  Cloudflare (Workers/DO), separada de este despliegue.
- **Email transaccional (Resend) y verificación automática**: deshabilitado por
  decisión. Mientras tanto el administrador verifica cada cuenta a mano en D1 (A3).
