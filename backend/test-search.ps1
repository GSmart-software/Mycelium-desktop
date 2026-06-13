# Test manual de HU-21 (búsqueda FTS5) y HU-30 (conexiones)
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5279'

$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"email":"dev@micelio.local","password":"micelio123"}'
$h = @{ Authorization = "Bearer $($login.accessToken)" }
$v = (Invoke-RestMethod -Uri "$base/auth/me" -Headers $h).vaults[0].id

$n1 = Invoke-RestMethod -Uri "$base/vaults/$v/notas" -Method Post -Headers $h -ContentType 'application/json' -Body '{"titulo":"Hongos"}'
$n2 = Invoke-RestMethod -Uri "$base/vaults/$v/notas" -Method Post -Headers $h -ContentType 'application/json' -Body '{"titulo":"Esporas"}'
$n3 = Invoke-RestMethod -Uri "$base/vaults/$v/notas" -Method Post -Headers $h -ContentType 'application/json' -Body '{"titulo":"Lluvia"}'

Invoke-RestMethod -Uri "$base/notas/$($n1.id)/contenido" -Method Put -Headers $h -ContentType 'application/json' -Body '{"contenido":"Los hongos liberan [[Esporas]] tras la lluvia. #micologia"}' | Out-Null
Invoke-RestMethod -Uri "$base/notas/$($n2.id)/contenido" -Method Put -Headers $h -ContentType 'application/json' -Body '{"contenido":"Las esporas viajan con el viento y la [[Lluvia]]."}' | Out-Null
Invoke-RestMethod -Uri "$base/notas/$($n3.id)/contenido" -Method Put -Headers $h -ContentType 'application/json' -Body '{"contenido":"El agua de lluvia despierta al micelio."}' | Out-Null

$r1 = Invoke-RestMethod -Uri "$base/vaults/$v/buscar?q=lluvia%20micelio" -Headers $h
Write-Output "BUSCAR AND: $($r1.resultados.Count) resultado(s) - '$($r1.resultados[0].titulo)' (esperado 1, Lluvia)"

$r2 = Invoke-RestMethod -Uri ("$base/vaults/$v/buscar?q=" + [uri]::EscapeDataString('"agua de lluvia"')) -Headers $h
Write-Output "FRASE EXACTA: $($r2.resultados.Count) (esperado 1) - fragmento: $($r2.resultados[0].fragmento)"

$r3 = Invoke-RestMethod -Uri "$base/vaults/$v/buscar?q=tag:micologia" -Headers $h
Write-Output "TAG: $($r3.resultados.Count) (esperado 1) - $($r3.resultados[0].titulo)"

$c = Invoke-RestMethod -Uri "$base/notas/$($n2.id)/conexiones" -Headers $h
Write-Output "CONEXIONES - salientes: $($c.salientes.titulo -join ','), retro: $($c.retro.titulo -join ',') frag: '$($c.retro[0].fragmento)'"
Write-Output "GRAFO - nodos: $($c.grafo.nodos.Count) (esperado 3), aristas: $($c.grafo.aristas.Count) (esperado 2), tamano: $($c.nota.tamanoBytes) bytes"
