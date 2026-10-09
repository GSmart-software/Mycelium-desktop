---
titulo: CSS y snippets
tema: Configuración
sinonimos: [estilos, tema, personalizar, css personalizado, colores, plantilla, variables]
---

Un **snippet** es un pedazo de CSS tuyo que Mycelium aplica encima de su propio estilo. Con
uno podés cambiar un color, la letra de los títulos o cómo se ve un callout, sin tocar nada
más. Podés tener varios y prender o apagar cada uno con su interruptor.

## Para qué sirve

Para ajustar Mycelium a tu gusto más allá de lo que ofrecen los temas y la tipografía. Los
cambios se ven al instante, sin recargar, y apagar el snippet vuelve todo a como estaba.

## Cómo se usa

1. Abrí **Configuración → Snippets CSS** y elegí cómo empezar: «Nuevo snippet» crea uno a
   partir de la plantilla y lo abre en el editor; «Importar .css» trae un archivo que ya
   tengas.
2. En el editor, a la izquierda va el CSS; en el medio, un Markdown de ejemplo que podés
   cambiar; a la derecha, cómo se ve con tu CSS. La vista previa se actualiza mientras
   escribís. Tocá «Guardar».
3. En la lista, el interruptor prende o apaga cada snippet. **Clic** en el nombre lo
   renombra; los íconos lo editan, lo exportan a un `.css` o lo eliminan (con «Deshacer» en
   el aviso).

En la app de escritorio, los snippets se guardan **en el vault**: viajan con él, y al abrir
otro vault ves los de ese.

## La plantilla

«Descargar plantilla» baja un `.css` comentado con todo lo que se puede tocar, por secciones:
la paleta del tema, los colores de la interfaz, la tipografía, los títulos, el énfasis propio
de Mycelium, los callouts, las tareas y sus estados, las tablas, la tarjeta de propiedades,
los diagramas dentro de una nota, el calendario y las consolas. Viene entero desactivado:
descomentás los ejemplos que quieras usar. Lo más simple es cambiar las **variables** del
tema, que recolorean toda la app de una vez:

```text
:root[data-theme] {
  --mic-accent: #e0a040;
  --mic-glow:   #ffd27a;
}
```

`--mic-accent` es el color de botones, enlaces y acentos; `--mic-glow`, el del cursor, las
etiquetas y los resaltados. Va `:root[data-theme]` y no `:root` a secas porque los temas y
las atmósferas definen sus colores con un selector más fuerte, que le ganaría. Para un solo
modo, `:root[data-theme][data-dark='true']` (oscuro) o
`:root[data-theme]:not([data-dark='true'])` (claro); la plantilla trae el resto de los
selectores. Para el texto de las notas, las reglas empiezan con `.mic-preview` (vista de
lectura) o `.mic-editor-host` (el editor).

> [!tip] La letra de la nota
> La fuente y el tamaño de la nota se eligen en **Configuración → Tipografía**, y ese ajuste
> le gana a un snippet. Si igual querés fijarlos desde CSS, la plantilla muestra cómo.

> [!info] Cerrar el editor
> Escape no cierra el editor, para no perder lo que escribiste. La X sí: si hay cambios sin
> guardar, te pregunta antes de descartarlos.
