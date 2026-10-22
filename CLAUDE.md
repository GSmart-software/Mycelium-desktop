# Mycelium desktop

La aplicación de escritorio de Mycelium: Tauri + Next.js + SQLite nativo sobre una carpeta
real. El código vive en `frontend/` (la app y `src-tauri/`); `eval/` mide el framework de IA
del vault; `.github/workflows/` compila los instaladores.

> [!important] La documentación y las instrucciones del proyecto NO están acá
> Viven en el repo **`mycelium-docs`**, que es el vault de Mycelium y la memoria del
> proyecto. En disco, este repo está dentro de ese vault (`<vault>/desktop/`), y Claude Code
> corre desde la raíz del vault, con su `CLAUDE.md` completo: el rol de orquestador, el
> contrato de los subagentes, las convenciones de commits y el flujo de versionado.
>
> Si estás leyendo esto con la sesión abierta **acá adentro**, abrí el `CLAUDE.md` del vault
> (`../CLAUDE.md`) antes de hacer nada.

En `frontend/` rige además [frontend/AGENTS.md](frontend/AGENTS.md).

Hasta el 2026-10-21 este código era la rama `desktop-tauri` del repo `Myceliumv2`, hoy
archivado. El historial está completo acá.
