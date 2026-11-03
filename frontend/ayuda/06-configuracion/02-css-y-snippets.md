---
titulo: CSS y snippets
tema: Configuración
sinonimos: [estilos, tema, personalizar, css personalizado, colores, plantilla, variables, cssclasses, clase, estilo por nota]
---

Un **snippet** es un pedazo de CSS tuyo que Mycelium aplica encima de su propio estilo. Con
uno puedes cambiar un color, la letra de los títulos o cómo se ve un callout, sin tocar nada
más. Puedes tener varios y encender o apagar cada uno con su interruptor.

## Para qué sirve

Para ajustar Mycelium a tu gusto más allá de lo que ofrecen los temas y la tipografía. Los
cambios se ven al instante, sin recargar, y apagar el snippet vuelve todo a como estaba.

## Cómo se usa

1. Abre **Configuración → Snippets CSS** y elige cómo empezar: «Nuevo snippet» crea uno a
   partir de la plantilla y lo abre en el editor; «Importar .css» trae un archivo que ya
   tengas.
2. En el editor, a la izquierda va el CSS; en el medio, un Markdown de ejemplo que puedes
   cambiar; a la derecha, cómo se ve con tu CSS. La vista previa se actualiza mientras
   escribes. Toca «Guardar».
3. En la lista, el interruptor enciende o apaga cada snippet. **Clic** en el nombre lo
   renombra; los íconos lo editan, lo exportan a un `.css` o lo eliminan (con «Deshacer» en
   el aviso).

En la app de escritorio, los snippets se guardan **en el vault**: viajan con él, y al abrir
otro vault ves los de ese.

> [!warning] Los snippets de un vault que llega de otro lado arrancan apagados
> Cuáles están activos lo decide **esta computadora**, no el vault. Si abres un vault que te
> pasaron —un zip, una carpeta compartida— o uno que nunca abriste aquí, sus snippets se ven
> en la lista pero no se aplican, y Configuración te avisa cuántos trae. Revisa el CSS de cada
> uno antes de encenderlo: un snippet puede cambiar cualquier cosa de la pantalla. Los que
> creas o importas tú arrancan encendidos.

## La plantilla

«Descargar plantilla» baja un `.css` comentado con todo lo que se puede tocar, por secciones:
la paleta del tema, los colores de la interfaz, la tipografía, los títulos, el énfasis propio
de Mycelium, los callouts, las tareas y sus estados, las tablas, la tarjeta de propiedades,
los diagramas dentro de una nota, el calendario y las consolas. Viene entero desactivado:
descomentas los ejemplos que quieras usar. Lo más simple es cambiar las **variables** del
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
> le gana a un snippet. Si aun así quieres fijarlos desde CSS, la plantilla muestra cómo.

> [!info] Cerrar el editor
> Escape no cierra el editor, para no perder lo que escribiste. La X sí: si hay cambios sin
> guardar, te pregunta antes de descartarlos.

## Estilo para una sola nota

Un snippet se aplica a todas las notas. Para que alcance solo a algunas —una ficha, una
portada, el diario—, se le pone a cada una la propiedad `cssclasses` y el snippet apunta a
esa clase:

```text
---
cssclasses: [ficha]
---
```

```text
.mic-preview.ficha h1,
.mic-editor-host.ficha .mic-live-h1 {
  text-align: center;
}
```

La clase se agrega al contenedor de la nota al editarla (`.mic-editor-host`), al leerla
(`.mic-preview`) y al exportarla a PDF, y se quita en cuanto se borra de la propiedad o se
cambia de nota. Puede ser una lista o un texto con varias separadas por espacios o comas.
Solo valen letras sin tilde, dígitos, `_` y `-`, y no puede empezar con un dígito: un
nombre que no cumple se descarta sin aviso.
