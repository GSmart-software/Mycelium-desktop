<#
.SYNOPSIS
  Construye el instalador de Mycelium (MycelioSetup.exe) con Inno Setup.

.DESCRIPTION
  1. Reconstruye la app desktop (build-desktop.ps1), preservando appsettings.Local.json.
  2. Verifica que existan las credenciales (se incluyen en el instalador).
  3. Compila installer/micelio.iss con Inno Setup -> dist/installer/MycelioSetup.exe.

.NOTES
  Requiere Inno Setup 6 (ISCC.exe). Instalar con:
    winget install JRSoftware.InnoSetup
  o desde https://jrsoftware.org/isdl.php

  Uso:
    powershell -ExecutionPolicy Bypass -File scripts/build-installer.ps1
#>

$ErrorActionPreference = "Stop"

$repo    = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $repo "dist/desktop"
$cfg     = Join-Path $desktop "appsettings.Local.json"
$example = Join-Path $desktop "appsettings.Local.example.json"
$iss     = Join-Path $repo "installer/micelio.iss"

Write-Host "==> [1/3] Reconstruyendo la app desktop" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "build-desktop.ps1")

Write-Host "==> [2/3] Verificando credenciales (se incluyen en el instalador)" -ForegroundColor Cyan
if (-not (Test-Path $cfg)) {
    if (Test-Path $example) { Copy-Item -Force $example $cfg }
    Write-Host ""
    Write-Host "FALTA configurar las credenciales." -ForegroundColor Yellow
    Write-Host "Edita este archivo con tus keys de Cloudflare y volve a correr este script:" -ForegroundColor Yellow
    Write-Host "  $cfg" -ForegroundColor Yellow
    exit 1
}

Write-Host "==> [3/3] Compilando el instalador con Inno Setup" -ForegroundColor Cyan
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    foreach ($p in @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
        if (Test-Path $p) { $iscc = $p; break }
    }
}
if (-not $iscc) {
    throw "No se encontro Inno Setup (ISCC.exe). Instalalo con 'winget install JRSoftware.InnoSetup' o desde https://jrsoftware.org/isdl.php"
}

& $iscc $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup fallo al compilar." }

Write-Host ""
Write-Host "OK. Instalador en: $(Join-Path $repo 'dist/installer/MycelioSetup.exe')" -ForegroundColor Green
Write-Host "Distribui ese unico .exe; al instalarlo crea accesos directos y un desinstalador." -ForegroundColor Green
