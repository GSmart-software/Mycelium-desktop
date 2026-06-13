# Test manual de HU-35/36 (compartir carpeta, roles efectivos, gestion).
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5279'
$log = Join-Path $env:TEMP 'mic-backend.log'

function Login($email, $pass) {
  $r = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = $email; password = $pass } | ConvertTo-Json)
  return @{ Authorization = "Bearer $($r.accessToken)" }
}

# 1. Registrar y verificar un segundo usuario (token desde el log local)
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$colega = "colega$ts@micelio.local"
$pass = 'micelio12345'
Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType 'application/json' -Body (@{ email = $colega; password = $pass; nombre = 'Colega' } | ConvertTo-Json) | Out-Null
Start-Sleep -Milliseconds 300
$logText = Get-Content $log -Raw
$token = ([regex]'verify-email\?token=([^\s]+)').Matches($logText) | Select-Object -Last 1 | ForEach-Object { $_.Groups[1].Value }
Invoke-RestMethod -Uri "$base/auth/verify-email" -Method Post -ContentType 'application/json' -Body (@{ token = $token } | ConvertTo-Json) | Out-Null

$A = Login 'dev@micelio.local' 'micelio123'
$B = Login $colega $pass

# 2. A crea carpeta + nota y comparte con B como editor
$v = (Invoke-RestMethod -Uri "$base/auth/me" -Headers $A).vaults[0].id
$folder = Invoke-RestMethod -Uri "$base/vaults/$v/carpetas" -Method Post -Headers $A -ContentType 'application/json' -Body (@{ nombre = "Compartida $ts"; padreId = $null } | ConvertTo-Json)
$note = Invoke-RestMethod -Uri "$base/vaults/$v/notas" -Method Post -Headers $A -ContentType 'application/json' -Body (@{ titulo = "Nota compartida"; carpetaId = $folder.id } | ConvertTo-Json)
Invoke-RestMethod -Uri "$base/notas/$($note.id)/contenido" -Method Put -Headers $A -ContentType 'application/json' -Body '{"contenido":"Hola desde A"}' | Out-Null
Invoke-RestMethod -Uri "$base/carpetas/$($folder.id)/compartir" -Method Post -Headers $A -ContentType 'application/json' -Body (@{ email = $colega; rol = 'editor' } | ConvertTo-Json) | Out-Null

# 3. B ve la carpeta en /compartido
$comp = Invoke-RestMethod -Uri "$base/compartido" -Headers $B
Write-Output "COMPARTIDO B: $($comp.compartidos.Count) carpeta(s) - '$($comp.compartidos[0].nombre)' rol=$($comp.compartidos[0].rol) (esperado 1, editor)"

# 4. B lee y edita la nota (editor)
$cont = Invoke-RestMethod -Uri "$base/notas/$($note.id)/contenido" -Headers $B
Write-Output "B LEE: '$($cont.contenido)' (esperado 'Hola desde A')"
Invoke-RestMethod -Uri "$base/notas/$($note.id)/contenido" -Method Put -Headers $B -ContentType 'application/json' -Body '{"contenido":"Editado por B"}' | Out-Null
Write-Output "B EDITA: OK (editor puede escribir)"

# 5. A baja a B a lector → B no puede editar
$bid = ((Invoke-RestMethod -Uri "$base/carpetas/$($folder.id)/miembros" -Headers $A).miembros | Where-Object { $_.email -eq $colega }).usuario_id
Invoke-RestMethod -Uri "$base/carpetas/$($folder.id)/miembros/$bid" -Method Patch -Headers $A -ContentType 'application/json' -Body '{"rol":"lector"}' | Out-Null
$status = 0
try {
  Invoke-RestMethod -Uri "$base/notas/$($note.id)/contenido" -Method Put -Headers $B -ContentType 'application/json' -Body '{"contenido":"intento lector"}' | Out-Null
} catch { $status = [int]$_.Exception.Response.StatusCode }
Write-Output "B (lector) EDITA: HTTP $status (esperado 403)"

# 6. A revoca acceso → B ya no ve la carpeta
Invoke-RestMethod -Uri "$base/carpetas/$($folder.id)/miembros/$bid" -Method Delete -Headers $A | Out-Null
$comp2 = Invoke-RestMethod -Uri "$base/compartido" -Headers $B
Write-Output "COMPARTIDO B tras revocar: $($comp2.compartidos.Count) (esperado 0)"
