---
target: cascarón del workspace
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
target_fingerprint: "sha256:de24383033e611a34ab22f0ea8decb3b9d65f3240c56118bdf27a0884d1c7924"
target_path: "C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
timestamp: 2026-09-19T05-32-36Z
slug: frontend-app-workspace-workspace-page-tsx
closed: true
---
Method: dual-agent (A: revisión de diseño · B: detector + navegador)

# Critique 2: cascarón del workspace (2026-09-19, tras DEF-091/092 y el H2)

## Design Health Score — 21/40 (Aceptable; antes 20/40)

| # | Heurística | Puntaje | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | "Sincronizado" = punto de 6 px solo por color; el explorador no revela la nota activa; búsqueda superior muda |
| 2 | Coincidencia con el mundo real | 3 | "Raw", "RETRO", "Opciones del pane", "AND implícito" |
| 3 | Control y libertad | 2 | Escape no cierra "Más opciones", el menú de pane ni el modal Compartir (verificado en código) |
| 4 | Consistencia | 2 | Dos buscadores; callout distinto en vivo y en lectura; "Exportar" duplicado en dos menús |
| 5 | Prevención de errores | 3 | Autoguardado y papelera; pero el título grande renombra con un clic y Compartir está habilitado en desktop |
| 6 | Reconocer antes que recordar | 2 | Todo ícono con `title` nativo; pestañas del panel derecho truncadas sin tooltip |
| 7 | Flexibilidad y eficiencia | 2 | Sin Ctrl+O/P, paleta, Ctrl+N ni atajo de búsqueda global; árbol sin flechas |
| 8 | Estética y minimalismo | 2 | 25 controles fijos en la barra del editor; dos titulares compitiendo |
| 9 | Recuperación de errores | 2 | Fallas silenciosas (búsqueda superior); Compartir pide email sin explicar |
| 10 | Ayuda y documentación | 1 | Sin ayuda ni lista de atajos; "Tags" es un placeholder |

## Qué se movió desde la primera corrida
Resueltos y confirmados por las dos evaluaciones: DEF-091 (código legible en claro) y DEF-092 (lectura a 72ch, "serena", columna de 590 px). El contraste del texto pasa en los cuatro combos; el único caso bajo 4.5 es el enlace roto dentro de código en un callout (4.37:1), que es DEF-089.

## Especificidad de diseño
Igual que en la primera corrida: la identidad está en el color, no en la composición (plantilla VS Code/Obsidian). El principio "el enlace es la unidad de valor" no se refleja: backlinks y mini-grafo escondidos, árbol protagonista. Detector CLI: 3 hallazgos (logo: falso positivo; 2 transition width: reales, impacto bajo). Navegador: ai-color-palette (paleta propia, no defecto), clipped-overflow/cramped-padding/gradient-text/em-dash (falsos positivos), overused-font Inter (preferencia del usuario), low-contrast 1 (DEF-089). Mediciones: 0 sin nombre; 10 botones con nombre solo por `title`; cerrar pestaña 16×16.

## Priority Issues
- [P1] Compartir por email habilitado en desktop local, el botón más destacado del marco; sección "Compartido" vacía; modal sin Escape. → /impeccable distill + /impeccable harden
- [P1] Doble titular: título del archivo con degradé centrado (30 px) sobre un H1 cian a la izquierda (28 px) con el "#" visible; el nombre del archivo gana al contenido; un clic renombra. → /impeccable typeset + /impeccable layout
- [P1] Teclado y lector de pantalla: árbol sin role=tree, 140 tab stops sin salto al contenido, menús sin Escape ni foco, modos con nombre solo en `title`. → /impeccable harden
- [P2] Pared de 25 controles en la barra del editor. → /impeccable distill
- [P2] Red de enlaces escondida y navegación duplicada o vacía (dos buscadores, Tags placeholder, pestañas truncadas, explorador que no revela la nota activa). → /impeccable layout + /impeccable clarify

## Persona Red Flags
- Alex: sin Ctrl+O/P ni paleta; menús sin Escape y dos abiertos a la vez; pestañas truncadas a 120 px con 800 px libres.
- Sam: 140 Tab sin salto; árbol anunciado como "button, draggable"; sin aria-current; estado de sincronización solo por color.
- Lucía (escritora sin IA): ve .claude/.impeccable/.wrangler y archivos de IA en la raíz; email para compartir en una app local; Tags vacío; "Raw" y "pane".

## Minor Observations
En vivo no limita el ancho de línea (1175 px); la preferencia Inter 13 px anula "Two Densities"; el isotipo usa un tercer color (azul Info) contra "Two Voices"; callout con dos looks; "Renderizar tablas" dentro de un menú de exportar; columna fantasma en tablas en vivo; carpeta seleccionada y archivo activo con el mismo resaltado; pestañas del panel derecho a 11 px.

## Questions to Consider
- ¿Y si el panel izquierdo abriera por defecto en "conexiones de esta nota"?
- ¿Qué tendría que existir para que, sin la paleta, se reconociera Mycelium?
- ¿Barra de formato permanente o barra sobre la selección más paleta de comandos?
