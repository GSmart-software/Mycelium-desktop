; Instalador de Mycelium (modo app local, datos en Cloudflare).
; Empaqueta dist/desktop (exe autocontenido + wwwroot + appsettings, incluyendo
; appsettings.Local.json con las credenciales). Instalacion por-usuario, sin admin.
;
; Compilar con:  scripts\build-installer.ps1   (requiere Inno Setup 6)
; Salida:        dist\installer\MycelioSetup.exe

#define MyAppName "Mycelium"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Mycelium"
#define MyAppExeName "Micelio.Api.exe"

[Setup]
; AppId identifica la app para upgrades/desinstalacion: NO cambiar entre versiones.
AppId={{B7E4B9B2-1C3D-4E5A-9F21-7A6C2D8E5F10}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Micelio
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Instalacion por usuario (sin privilegios de administrador).
PrivilegesRequired=lowest
OutputDir=..\dist\installer
OutputBaseFilename=MycelioSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#MyAppName}

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos adicionales:"

[Files]
; Todo el artefacto desktop (exe + wwwroot + appsettings*.json, incluido Local.json).
Source: "..\dist\desktop\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
; WorkingDir={app} es importante: la app lee appsettings.Local.json y wwwroot
; relativos al directorio de trabajo.
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir {#MyAppName} ahora"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
