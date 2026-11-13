---
titulo: Otros archivos
tema: Tipos de archivo
solo: desktop
sinonimos: [pdf, imagen, visor, soltar, arrastrar, código, texto, importar archivos]
---

Tu vault no tiene solo notas: también el PDF que descargaste, la captura que pegaste o el
script que acompaña a una nota. Mycelium los muestra en el explorador como cualquier otro
archivo y los abre en un **visor**, en su propia pestaña.

## Para qué sirve

Para tener a mano todo lo de un tema sin salir de la app: leer un PDF al lado de la nota
que lo resume, mirar una imagen, consultar un archivo de configuración o retocarlo.

## Cómo se usa

1. Haz clic en el archivo en el explorador. Se abre según su tipo:
   - **Texto y código**: con números de línea, colores según el lenguaje y un buscador.
   - **PDF**: el documento, paginado. Mientras tiene el foco, sus teclas son del visor: **F6**, **Esc** y
     **F10** no llegan a Mycelium; **Tab** recorre sus botones y, al terminar, vuelve.
   - **Imágenes**: con zoom desde los botones **−** y **+**, o con el **pellizco del touchpad**:
     separar dos dedos acerca y juntarlos aleja, hacia el punto que está bajo el puntero
     (**Ctrl+rueda** del mouse hace lo mismo). Con la imagen ampliada, arrástrala para moverte;
     **Ajustar al panel** vuelve a encajarla.
   - Lo que no es texto ni sabe dibujar, lo dice y ofrece **Abrir con el sistema**.
2. Un archivo de texto se abre en solo lectura. Para cambiarlo, **Editar**; los cambios no se
   escriben hasta **Guardar** (o **Ctrl+S**), y **Salir de edición** vuelve a la lectura.
3. Para traer archivos de afuera, arrástralos desde el explorador de tu sistema y suéltalos
   sobre una carpeta del explorador de Mycelium (o sobre el espacio vacío, para la raíz). Se
   copian al vault, carpetas incluidas, y el original queda donde estaba. También está
   **Importar archivos…** en el botón de la barra y en el clic derecho de una carpeta.

Si al traer algo ya hay un archivo con ese nombre, Mycelium pregunta qué hacer:
**Renombrar**, **Reemplazar** o **Cancelar este archivo**.

## El menú de un archivo

Con clic derecho: **Abrir**, **Abrir al lado** (en un panel nuevo a la derecha), **Abrir
con la aplicación predeterminada**, **Renombrar**,
**Duplicar**, **Guardar una copia…** (fuera del vault), **Mostrar en el explorador** y
**Eliminar**.

**Abrir con la aplicación predeterminada** no abre programas ni scripts (`.exe`, `.bat`,
`.cmd`, `.ps1`, `.lnk`, `.msi` y parecidos): abrirlos sería ejecutarlos. Para esos, **Mostrar
en el explorador** y ábrelo desde ahí si sabes qué es.

Los documentos que pueden ejecutar código sin ser programas —de Office con macros (`.docm`,
`.xlsm`, `.pptm` y parecidos), complementos de Excel (`.xll`), ayuda compilada (`.chm`) e
imágenes de disco (`.iso`, `.img`, `.vhd`)— se abren, pero antes Mycelium pregunta si
quieres hacerlo.

> [!warning] Estos archivos no tienen la red de las notas
> Eliminar uno lo manda a la papelera **del sistema**, no a la de Mycelium: se recupera
> desde ahí. Tampoco entran en la búsqueda, ni en el grafo, ni en el autocompletado de `[[`.
> Y un archivo de más de 2 MB se muestra solo en parte y no se puede editar desde
> Mycelium, para no perder el resto al guardar.
