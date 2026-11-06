; Ganchos del instalador NSIS de Windows (DEF-181).
;
; El servidor MCP de Mycelium (`mycelium-mcp.exe`) no lo lanza la app: lo lanza
; la herramienta de IA (Claude Code, por ejemplo) desde la carpeta de
; instalación, según el `.mcp.json` del vault, y queda corriendo mientras dure
; esa sesión. Windows no deja reemplazar un .exe en uso, así que al actualizar
; con una sesión de IA abierta el instalador se detenía pidiendo Abortar,
; Reintentar u Omitir. Antes de copiar (y antes de desinstalar) se cierran los
; `mycelium-mcp.exe` que corren DESDE ESTA INSTALACIÓN: solo esos, comparando
; la ruta completa, nunca cualquier proceso con ese nombre. La sesión de IA
; pierde el MCP hasta que lo reconecte (en Claude Code, `/mcp`).
;
; `$$` es un `$` literal para NSIS (lo que lee PowerShell); `$INSTDIR` lo
; reemplaza NSIS por la carpeta de instalación.
;
; La ruta se lee por WMI (`Win32_Process.ExecutablePath`) y no con
; `Get-Process ... .Path`: el instalador es de 32 bits, lanza el PowerShell de
; 32 bits, y desde ahí `.Path` de un proceso de 64 bits sale vacío, así que el
; filtro no encontraba nada (probado con makensis el 2026-11-06).

!macro MYCELIUM_CERRAR_MCP
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='mycelium-mcp.exe'\" | Where-Object { $$_.ExecutablePath -eq '$INSTDIR\mycelium-mcp.exe' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  ; Windows tarda un instante en soltar el archivo tras cerrar el proceso.
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro MYCELIUM_CERRAR_MCP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro MYCELIUM_CERRAR_MCP
!macroend
