---
version: 1
slug: "frontend-app-workspace-workspace-page-tsx"
primary_target: "frontend/app/(workspace)/workspace/page.tsx"
related_targets: []
---

# Cascarón del workspace (desktop)

Modo: Operate. Quien toma notas estilo Obsidian, en sesiones largas de escritura y
lectura, en escritorio y de noche; con o sin IA. La nota es la protagonista.

Primera entrega: prototipo de la pantalla principal (cascarón con una nota abierta) en
`experimento/ui-impeccable`, solo desktop. Grafo, Bases y Configuración heredan tokens,
no se rediseñan todavía.

Se conserva: la función, el teclado y la accesibilidad (árbol navegable, salto a la
nota, menús y modales), el título del documento con degradé, la paleta Bioluminiscencia
y Cantarela con sus modos, el vocabulario fúngico.

Abierto: la fuente de interfaz (Geist por ahora) y el detalle de la barra de estado.

## Direction contract

THESIS: El estándar de la categoría ejecutado con el oficio de VS Code y Obsidian: rail
de actividad, árbol, pestañas, editor y barra de estado. Rechaza las dos derivas del
cascarón actual: la barra de 25 íconos y los controles que no hacen nada.

OWN-WORLD: Esporo, Niebla y Lienzo separan las zonas por tono, sin bordes gruesos.
Brote solo en lo vivo (foco, selección, la nota activa, los enlaces). Íconos de línea de
un solo trazo; 13px para el marco, la nota a su medida de lectura. La marca vive en
detalles precisos: el degradé del título, el callout, el isotipo del grafo.

STORY: Abrir y leer o escribir la nota sin ruido. Saltar a cualquier nota o comando
desde el centro de la barra superior con Ctrl+O o Ctrl+P. Saber cuántos enlaces y citas
tiene la nota mirando la barra de estado, y abrirlos con un clic.

FIRST VIEWPORT: Barra superior: logo a la izquierda, al centro «Ir a una nota o
comando… Ctrl+P» como disparador de la paleta, sin Compartir. Rail: Explorador,
Búsqueda, Esporas, Grafo (isotipo), Consolas; abajo Papelera y Configuración. Árbol a la
izquierda. Pestañas enfocables que usan el espacio libre. Barra del editor mínima: modos,
buscar, panel de enlaces, «Formato ▾» y «…». La nota a ancho de lectura, con título,
igual en vivo y en lectura. Barra de estado al pie de 24px: «12 enlaces · 5 te citan ·
843 palabras · guardado 14:02»; el panel de enlaces arranca cerrado.

FORM: El estándar de la categoría (tarjeta canon), elegido por el usuario sobre las
direcciones sorteadas; vara de oficio: VS Code y Obsidian. Seed key: f12c8d73.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
