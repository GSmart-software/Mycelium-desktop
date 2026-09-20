---
target: cascarón del workspace
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
target_fingerprint: "sha256:de24383033e611a34ab22f0ea8decb3b9d65f3240c56118bdf27a0884d1c7924"
target_path: "C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
timestamp: 2026-09-19T05-00-19Z
slug: frontend-app-workspace-workspace-page-tsx
---
Method: dual-agent (A: revisión de diseño · B: detector + navegador)

# Critique: cascarón del workspace (2026-09-19)

## Design Health Score — 20/40 (Aceptable)

| # | Heurística | Puntaje | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | "Sincronizado" es un punto de 6 px sin texto; Compartir confirma "Acceso concedido." sin hacer nada |
| 2 | Coincidencia con el mundo real | 3 | Se cuelan "Raw", "Opciones del pane", "Tags", "Retro", "AND implícito" |
| 3 | Control y libertad | 2 | Escape no cierra el modal Compartir |
| 4 | Consistencia | 2 | Mismo ícono para Compartir y Grafo; Metadatos ≈ Dividido; dos buscadores; input en Arial |
| 5 | Prevención de errores | 2 | Compartir por email en una versión sin cuenta ni red |
| 6 | Reconocer antes que recordar | 2 | Rail y barra del editor solo íconos; "Esporas" no evoca plantillas |
| 7 | Flexibilidad y eficiencia | 2 | Sin selector rápido ni paleta (Ctrl+O/P) |
| 8 | Estética y minimalismo | 2 | 25 controles fijos en la barra del editor; título duplicado |
| 9 | Recuperación de errores | 2 | Poco observable; el error de Compartir muestra el mensaje crudo |
| 10 | Ayuda y documentación | 1 | Ninguna entrada de ayuda en el marco |

## Especificidad de diseño
"Obsidian teñido": identidad en color y vocabulario, no en estructura. Lo que el producto dice que lo diferencia (el enlace como unidad de valor, la memoria para la IA) no se ve en el marco: backlinks y mini-grafo escondidos tras "Panel de metadatos"; el centro de la barra superior es un buscador muerto (DEF-090) y el único botón con énfasis es un Compartir falso.
Detector CLI: 3 hallazgos (1 falso positivo: degradé del logo documentado; 2 reales de impacto mínimo: transition width en barras de progreso). Navegador (inyección OK): line-length 44 (real, coincide con P1-c), ai-color-palette 187 (paleta propia del tema, señal y no defecto), clipped-overflow 4 (probablemente intencional), cramped-padding 6 (título: falso positivo), gradient-text 1 (falso positivo), overused-font 1 (Inter: preferencia del usuario), em-dash 1 (contenido de la nota). Mediciones: 0 controles sin nombre; cerrar pestaña 16×16 px; atrás/adelante y opciones del pane 22×22.

## Priority Issues
- [P1] DEF-091: código en línea ilegible en todo modo claro (1.04:1 en lectura). --mic-bg-code sigue oscuro en claro y el texto usa la tinta. → /impeccable colorize
- [P1] DEF-092: la lectura no limita el ancho (selector `.mic-layout-read .mic-preview > div` nunca coincide: las dos clases van en el mismo elemento). 170-180 caracteres por línea. → /impeccable typeset
- [P1] Compartir es falso en desktop (noop que responde "Acceso concedido.") y ocupa el botón de mayor énfasis; la sección "Compartido" siempre vacía. → /impeccable distill
- [P1] DEF-090: la búsqueda de la barra superior no busca. → decisión de producto, luego /impeccable shape
- [P2] Marco sobrecargado y ambiguo: 25 controles en la barra del editor, íconos repetidos, título doble, cerrar pestaña de 16 px. → /impeccable distill + /impeccable clarify
- [P2] Teclado: 80 paradas de Tab antes de la nota, explorador sin semántica de árbol, modal Compartir sin foco atrapado ni Escape. → /impeccable harden

## Persona Red Flags
- Alex (power user): sin Ctrl+O/Ctrl+P; el buscador natural no hace nada; backlinks tras un ícono sin atajo visible; 25 botones de formato.
- Sam (accesibilidad): 80 Tab hasta la nota; modal sin foco ni Escape; estado de sincronización solo por color; código a 1.04:1 en claro.
- Lucía (estudiante, público amplio sin IA): ve .env, .gitignore, .verify-*.log en la raíz; lee "Raw", "Retro", "AND implícito"; un Compartir que miente.
- Gabriel (autor con IA): nada en el marco habla de la IA salvo "Consolas"; el framework desactualizado del vault no se ve.

## Minor Observations
Input de la barra superior en Arial; pestañas del panel lateral truncadas; Salientes/Referencia y Retro/Lo referencian; mini-grafo cortado en el panel; cursiva de vista previa sin explicar; columna vacía y cabecera alta en tablas en vivo; "Salir del vault" pegado a Compartir; modal Compartir sin velo en oscuro; divisor de Compartido parece scroll.

## Questions to Consider
- ¿Y si el centro de la barra superior mostrara la red de la nota activa ("12 enlaces · 5 te citan")?
- ¿Un editor Markdown en vivo necesita 25 botones siempre visibles, o una barra que aparezca al seleccionar?
- ¿Y si una nota huérfana se viera apagada y las conectadas brillaran?
