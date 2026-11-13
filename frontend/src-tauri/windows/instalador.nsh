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

;
; La carpeta **no** se escribe dentro del comando: va por la variable de entorno
; MYCELIUM_INSTDIR, que el PowerShell hijo hereda y lee como dato. Escrita entre
; comillas simples, un apóstrofo en la ruta (un usuario O'Brien) rompía el
; filtro y no cerraba nada, y una carpeta armada a propósito podía ampliarlo a
; cualquier ruta (red team, 2026-11-06).

!macro MYCELIUM_CERRAR_MCP
  System::Call 'Kernel32::SetEnvironmentVariable(t "MYCELIUM_INSTDIR", t "$INSTDIR")i'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$mcp = Join-Path $$env:MYCELIUM_INSTDIR 'mycelium-mcp.exe'; Get-CimInstance Win32_Process -Filter \"Name='mycelium-mcp.exe'\" | Where-Object { $$_.ExecutablePath -eq $$mcp } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
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
