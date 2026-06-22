<#
.SYNOPSIS
  Empaqueta Mycelium como una app local de un solo ejecutable:
  el backend .NET sirve el frontend estático y la API en el mismo origen
  (http://localhost:5279), con los datos en Cloudflare (D1 + R2).

.DESCRIPTION
  1. Buildea el frontend (output:'export') apuntando al mismo origen (URL relativa).
  2. Copia el resultado a backend/.../wwwroot.
  3. Publica el backend como exe autocontenido single-file en dist/desktop.
  4. Quita appsettings.Production.json del artefacto (evita cookies SameSite=None).
  5. Deja appsettings.Local.example.json para que completes tus credenciales.

.NOTES
  Requiere: Node/npm y el SDK .NET 9. Ejecutar desde cualquier carpeta:
    powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
#>

$ErrorActionPreference = "Stop"

$repo     = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repo "frontend"
$apiProj  = Join-Path $repo "backend/src/Micelio.Api"
$wwwroot  = Join-Path $apiProj "wwwroot"
$outDir   = Join-Path $repo "dist/desktop"

Write-Host "==> [1/5] Build del frontend (export estatico, mismo origen)" -ForegroundColor Cyan
# URL relativa: los fetch van al mismo origen donde el exe sirve la API.
$env:NEXT_PUBLIC_API_URL = ""
npm --prefix $frontend run build
if ($LASTEXITCODE -ne 0) { throw "Fallo el build del frontend." }

Write-Host "==> [2/5] Copiando out/ -> wwwroot/" -ForegroundColor Cyan
if (Test-Path $wwwroot) { Remove-Item -Recurse -Force $wwwroot }
New-Item -ItemType Directory -Force -Path $wwwroot | Out-Null
Copy-Item -Recurse -Force (Join-Path $frontend "out/*") $wwwroot

Write-Host "==> [3/5] Publish del backend (self-contained single-file)" -ForegroundColor Cyan
# Preservar credenciales locales (gitignored) al reconstruir: se respaldan ANTES de
# borrar dist/ y se restauran SIEMPRE en el finally (aunque el publish falle), para
# no dejarlas huerfanas en TEMP y romper el modo desktop (puerto/ServeFrontend).
$localCfg = Join-Path $outDir "appsettings.Local.json"
$savedCfg = Join-Path $env:TEMP "micelio.appsettings.Local.json.bak"
if (Test-Path $localCfg) {
    Copy-Item -Force $localCfg $savedCfg
    Write-Host "    (appsettings.Local.json respaldado y se restaurara)" -ForegroundColor DarkGray
} elseif (Test-Path $savedCfg) {
    # Un build anterior quedo a medias: recuperamos el respaldo huerfano.
    Write-Host "    (recuperando appsettings.Local.json de un build previo interrumpido)" -ForegroundColor Yellow
}

try {
    if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
    dotnet publish $apiProj -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        -o $outDir
    if ($LASTEXITCODE -ne 0) { throw "Fallo el publish del backend." }

    Write-Host "==> [4/5] Limpiando config que no aplica al modo desktop" -ForegroundColor Cyan
    # En desktop NO queremos las cookies SameSite=None de produccion (rompen sobre http).
    $prod = Join-Path $outDir "appsettings.Production.json"
    if (Test-Path $prod) { Remove-Item -Force $prod }

    Write-Host "==> [5/5] Dejando la plantilla de credenciales" -ForegroundColor Cyan
    Copy-Item -Force (Join-Path $apiProj "appsettings.Local.example.json") (Join-Path $outDir "appsettings.Local.example.json")
}
finally {
    # Restaurar SIEMPRE las credenciales reales (aunque algo haya fallado arriba).
    if (Test-Path $savedCfg) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
        Copy-Item -Force $savedCfg $localCfg
        Remove-Item -Force $savedCfg
        Write-Host "    (appsettings.Local.json restaurado)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "OK. Artefacto en: $outDir" -ForegroundColor Green
Write-Host ""
Write-Host "Para usarlo:" -ForegroundColor Yellow
Write-Host "  1. Copia appsettings.Local.example.json -> appsettings.Local.json (en dist/desktop)"
Write-Host "  2. Completa AccountId, ApiToken, D1 DatabaseId, R2 (Bucket/AccessKeyId/SecretAccessKey) y Jwt:Secret"
Write-Host "  3. Doble clic en Micelio.Api.exe  ->  abre http://localhost:5279"
