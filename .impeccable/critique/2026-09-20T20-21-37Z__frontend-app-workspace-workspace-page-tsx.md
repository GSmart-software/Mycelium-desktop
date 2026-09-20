---
target: cascarón del workspace
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
target_fingerprint: "sha256:5db52e06463b400febc4453db06e437822c1fc62b0b293e67b347e6581cea771"
target_path: "C:\\Trabajo\\GSmart\\Mycelium\\frontend\\app\\(workspace)\\workspace\\page.tsx"
timestamp: 2026-09-20T20-21-37Z
slug: frontend-app-workspace-workspace-page-tsx
---
Method: dual-agent (A: revisión de diseño · B: detector + navegador)

# Crítica del cascarón del workspace — 25/40

Superficie: `frontend/app/(workspace)/workspace/page.tsx`. Modo Operate. Vara: VS Code y
Obsidian. Runs anteriores: 20 → 21 → 21.

## Puntaje

| # | Heurístico | Pts | Hallazgo clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 3 | La barra de estado es el mayor avance; pierde por el borrado sin aviso y por «Guardado 19 sept» (fecha donde se espera hora) |
| 2 | Sistema ↔ mundo real | 3 | El español es genuino («te citan»); «Raw» quedó sin traducir |
| 3 | Control y libertad | 2 | Borrar una nota no pregunta ni deja deshacer; la carpeta sí, con diálogo nativo de Windows |
| 4 | Consistencia | 3 | El disparador dice `Ctrl+P` y abre notas; `Ctrl+P` abre comandos |
| 5 | Prevención de errores | 2 | `.mycignore` reemplaza los patrones por defecto: reaparecen `.claude`, `.impeccable` |
| 6 | Reconocer antes que recordar | 3 | La paleta vacía lista el vault entero en orden alfabético: sin recientes |
| 7 | Flexibilidad | 3 | No hay `Ctrl+Tab` para ciclar pestañas |
| 8 | Estético y minimalista | 2 | «Mycelium» dos veces en la barra superior; el título de la nota, dos veces |
| 9 | Recuperación de errores | 2 | Desde «Sin guardar» no hay camino a ninguna acción |
| 10 | Ayuda | 2 | Ninguna puerta a la ayuda en el cascarón |
| **Total** | | **25/40** | Antes 21/40 |

## Veredicto de especificidad

Específico en la superficie, genérico en la estructura. Lo autorado: el marco teñido en
claro, «84 enlaces · 54 te citan» como tesis dicha en palabras, el isotipo del grafo. El
esqueleto es el de la categoría **por contrato**. Nada en la primera pantalla dice que
esto es una red.

Detector: 14 avisos, todos warning. **11 falsos positivos** (7 `side-tab`: callouts por
decisión escrita, citas de Markdown, el chevron de plegado dibujado con dos bordes; 4
`gradient-text`: los tres usos sancionados). **3 reales**: barras de progreso que animan
`width` (importar, abrir vault, actualizador).

Overlay: no hay. La inyección de eventos de teclado no llega al WebView de Tauri (24
pulsaciones de Tab, ningún evento). El foco se midió forzando `:focus-visible` por CDP
sobre 85 elementos, y se revirtió.

## Lo que funciona

- La barra de estado: la tesis en el único lugar siempre visible, en idioma humano, y
  solo para notas de texto.
- Las atmósferas como sistema, no estilo: fórmulas sobre los raw, válidas en los dos temas.
- Medido: 0 fallos de contraste de texto (mínimo 5.50:1), 0 íconos bajo 3:1, 0 botones sin
  nombre accesible, sin scroll horizontal, anillo de foco en 70 de 85 paradas.

## Problemas prioritarios

**[P0] Borrar una nota es silencioso.** Verificado en `ExplorerPanel.tsx`: la carpeta
confirma (`confirmar()`), la nota llama directo a `deleteNota`. Sin aviso ni deshacer. Y
la confirmación de carpeta es un diálogo nativo de Windows, en la app que se sacó la barra
de título para no parecerse a eso. Arreglo: aviso «fue a la papelera · Deshacer» y diálogo
propio con `useDialogoModal`. → `/impeccable harden`

**[P1] La paleta no recuerda nada.** Sin consulta lista el vault entero alfabéticamente
(`PaletaComandos.tsx`: `puntaje()` devuelve 0 y desempata `localeCompare`). No hay
recientes ni `Ctrl+Tab`. Arreglo: MRU desde `tabsStore` y ciclado de pestañas.
→ `/impeccable shape`

**[P1] El disparador enseña la tecla equivocada.** Dice `Ctrl+P` y abre notas; `Ctrl+P`
abre comandos. Arreglo: que diga `Ctrl+O` y que la ayuda al pie muestre las dos.
→ `/impeccable clarify`

**[P2] El botón de la barra de estado no parece un botón.** El contrato promete abrir los
enlaces con un clic; en reposo es idéntico a «1420 palabras». Arreglo: isotipo de 12px
delante de la cifra y moverlo al extremo izquierdo. → `/impeccable polish`

**[P3] Ruido heredado en árbol y paleta.** Que `.mycignore` reemplace el default está
documentado como decisión (la sintaxis no tiene negaciones), así que no es defecto; el
efecto visible sí molesta. Arreglo barato: que la plantilla traiga `.*/` ya escrito.

## Señales por persona

- **Viene de VS Code**: `Ctrl+Tab` no hace nada, `Ctrl+P` abre lo contrario, no hay lista
  de atajos.
- **Primerizo**: tres carpetas de máquina arriba de todo, 23 íconos sin rótulo, ninguna
  puerta de ayuda, nada explica qué es un `[[enlace]]`.
- **Usa el vault como memoria de una IA**: el andamiaje del agente tapa el árbol y la
  paleta; «¿qué de esto ve la IA?» no tiene respuesta en el cascarón.

## Observaciones menores

Título de la nota centrado sobre un cuerpo alineado a la izquierda. La paleta abre 16px
corrida respecto de su disparador. El explorador arranca con seis íconos sin encabezado.
Configuración dice `v1.7.0` y el proyecto documenta 1.3.0 en desktop. El documento no
tiene ningún `h1`–`h6`: los títulos son `div`.

## Preguntas que deja

Si la red es la tesis, ¿por qué lo único que la muestra vive en el rincón que nadie mira?
¿Por qué la prosa más tranquilizadora del producto está en Configuración y no en el
momento en que se borra algo?
