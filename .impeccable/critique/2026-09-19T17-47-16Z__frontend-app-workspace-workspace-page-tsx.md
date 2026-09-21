---
target: cascarón del workspace
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
target_fingerprint: "sha256:2b15a97814f77ab70dedf6ad709ec4c805a899be1691de3d4284b5fbf9aab81d"
target_path: "C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
timestamp: 2026-09-19T17-47-16Z
slug: frontend-app-workspace-workspace-page-tsx
---
Method: dual-agent (A: revisión de diseño · B: detector + navegador)

# Critique 3: cascarón del workspace (2026-09-19, cierre del refinamiento)

## Design Health Score — 21/40 (Aceptable; 20 → 21 → 21)

| # | Heurística | Puntaje | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | Guardado = punto de 6 px; búsqueda superior muda; Compartir sin respuesta real |
| 2 | Coincidencia con el mundo real | 3 | "Raw", "Link", "pane" |
| 3 | Control y libertad | 3 (antes 2) | Escape en menús y modales; historial, reabrir, deshacer |
| 4 | Consistencia | 1 (antes 2) | Dos buscadores y tres lupas; Grafo y Compartir con el mismo ícono; título en vivo y no en lectura; callout distinto por modo; inputs en Arial; Exportar en dos menús |
| 5 | Prevención de errores | 2 | Compartir habilitado en desktop (no-op) |
| 6 | Reconocer antes que recordar | 2 | Todo ícono con title lento; íconos repetidos |
| 7 | Flexibilidad y eficiencia | 2 | Sin Ctrl+O/P, paleta, Ctrl+N |
| 8 | Estética y minimalismo | 2 | Doble encabezado; barra de 25 controles; Compartido fijo y vacío |
| 9 | Recuperación de errores | 2 | Fallas silenciosas (Compartir, búsqueda) |
| 10 | Ayuda y documentación | 1 | Sin ayuda ni lista de atajos |

## Qué se movió en el refinamiento
Accesibilidad resuelta y confirmada por las dos evaluaciones: 0 controles sin nombre; "Saltar a la nota" como parada 1; árbol con una sola parada (22 paradas hasta la nota, antes 80); Escape y foco en menús y modal; anillo visible. El puntaje no sube porque la consistencia bajó de 2 a 1 con una mirada más fina, y lo que frena es estructural (el marco, no los defectos).

## Especificidad de diseño
Mitad propio (paleta, Cantarela como mundo propio, degradé, callout, logo), mitad intercambiable (estructura e iconografía de Obsidian). El grafo, la metáfora central, se representa con el ícono genérico de compartir. Ningún elemento del cascarón habla de enlaces. Detector CLI: 3 hallazgos (logo: falso positivo; 2 transition width: menores). Navegador: paleta propia (falso positivo), recortes de paneles, padding del título y rayas del contenido (falsos positivos); low-contrast "enlaces" 4.37:1 (DEF-089). Nuevo y real: el degradé del título en claro arranca en 2.21:1 (texto grande exige 3:1).

## Priority Issues
- [P1] Funciones muertas o falsas en el lugar más visible: búsqueda superior (DEF-090), Compartir no-op, sección Compartido vacía, Tags placeholder. → /impeccable distill
- [P1] Dos documentos según el modo: título en vivo y no en lectura, "#" visible, callout distinto, ancho sin límite en vivo. (El título se conserva por decisión del usuario.) → /impeccable layout
- [P2] Barra del editor de 25 controles; Grafo y Compartir con el mismo ícono; tres lupas. → /impeccable distill + /impeccable clarify
- [P2] Sin camino para el usuario avanzado: Ctrl+O/P, paleta, Ctrl+N, lista de atajos. → /impeccable shape
- [P3] Desvíos tipográficos: input/textarea en Arial; cabeceras del explorador en 700. → /impeccable typeset
- [P3] Degradé del título en claro a 2.21:1 al inicio. → /impeccable colorize

## Persona Red Flags
- Alex: sin Ctrl+O/P/N; atajos solo en tooltips lentos; dos menús "…" con Exportar repetido.
- Sam: la pestaña (role=tab) no es enfocable y el Tab cae en su "×"; guardado solo por color; Atrás/Adelante deshabilitados casi invisibles.
- Lucía (sin IA): "Consolas" fija en el rail; Compartir le promete colaboración inexistente; "Raw", "Link", "pane".

## Minor Observations
Tercer color en el isotipo; pestaña truncada con espacio libre; al abrir Compartir quedan dos filas resaltadas; ".md" en el árbol y no en la pestaña; tabla en vivo con manija vacía y cabecera alta; ancho sin límite en vivo; el autor usa Inter 13 px (la regla de dos densidades no es lo que ve).

## Questions to Consider
- ¿Y si cada pestaña mostrara los enlaces entrantes y salientes de la nota?
- ¿Y si "Buscar en Mycelium…" fuera el selector rápido y la paleta de comandos (Ctrl+O)?
- ¿El título del documento y el H1 son dos cosas o una?
