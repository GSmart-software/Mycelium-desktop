# Test de HU-05/06/37 en modo local: la colaboracion debe venir DESHABILITADA.
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5279'

$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"dev@micelio.local","password":"micelio123"}'
$h = @{ Authorization = "Bearer $($login.accessToken)" }
$v = (Invoke-RestMethod -Uri "$base/auth/me" -Headers $h).vaults[0].id

# Nota suelta (no compartida)
$n = Invoke-RestMethod -Uri "$base/vaults/$v/notas" -Method Post -Headers $h -ContentType 'application/json' -Body '{"titulo":"Colab local"}'
$c1 = Invoke-RestMethod -Uri "$base/notas/$($n.id)/colaboracion" -Headers $h
Write-Output "NOTA SUELTA habilitada=$($c1.habilitada) (esperado False)"

# Nota dentro de una carpeta compartida
$f = Invoke-RestMethod -Uri "$base/vaults/$v/carpetas" -Method Post -Headers $h -ContentType 'application/json' -Body '{"nombre":"Colab compartida","padreId":null}'
$n2 = Invoke-RestMethod -Uri "$base/vaults/$v/notas" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ titulo='En compartida'; carpetaId=$f.id } | ConvertTo-Json)
Invoke-RestMethod -Uri "$base/carpetas/$($f.id)/compartir" -Method Post -Headers $h -ContentType 'application/json' -Body '{"email":"dev@micelio.local","rol":"editor"}' | Out-Null
$c2 = Invoke-RestMethod -Uri "$base/notas/$($n2.id)/colaboracion" -Headers $h
Write-Output "NOTA COMPARTIDA habilitada=$($c2.habilitada) url=$($c2.url) usuario.color=$($c2.usuario.color) (esperado habilitada False en local, color presente)"
