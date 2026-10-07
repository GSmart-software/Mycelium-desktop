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

«Descargar plantilla» baja un `.css` comentado con todo lo que se puede tocar. Viene entero
desactivado: descomentás las reglas que quieras usar. Lo más simple es cambiar las
**variables** del tema, que recolorean toda la app de una vez:

```text
:root {
  --mic-accent: #e0a040;
  --mic-glow:   #ffd27a;
}
```

`--mic-accent` es el color de botones, enlaces y acentos; `--mic-glow`, el del cursor, las
etiquetas y los resaltados. La plantilla lista el resto. Para el texto de las notas, los
selectores empiezan con `.mic-preview` (vista de lectura) o `.mic-editor-host` (el editor).

> [!warning] Cerrar el editor con la X no guarda
> Escape no cierra el editor, justamente para no perder lo que escribiste, pero la X sí, y
> sin preguntar. Tocá «Guardar» antes de cerrarlo.
