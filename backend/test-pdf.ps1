# Test manual de HU-10 (exportar PDF vía PuppeteerSharp).
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5279'

$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"dev@micelio.local","password":"micelio123"}'
$h = @{ Authorization = "Bearer $($login.accessToken)" }
$v = (Invoke-RestMethod -Uri "$base/auth/me" -Headers $h).vaults[0].id

$n = Invoke-RestMethod -Uri "$base/vaults/$v/notas" -Method Post -Headers $h -ContentType 'application/json' -Body '{"titulo":"PDF Test"}'

$body = @{ pageSize = 'A4'; tema = 'bioluminiscencia'; modoOscuro = $false; html = '<h1>Hola PDF</h1><p>Contenido con <code>codigo</code> y una tabla.</p><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'; css = 'body{font-family:serif}' } | ConvertTo-Json

$out = Join-Path $env:TEMP 'mic-test.pdf'
Write-Output "Generando PDF (puede descargar Chromium la primera vez)..."
Invoke-WebRequest -Uri "$base/notas/$($n.id)/exportar-pdf" -Method Post -Headers $h -ContentType 'application/json' -Body $body -OutFile $out

$bytes = [System.IO.File]::ReadAllBytes($out)
$header = [System.Text.Encoding]::ASCII.GetString($bytes[0..4])
Write-Output "PDF bytes: $($bytes.Length), header: $header (esperado %PDF-)"
