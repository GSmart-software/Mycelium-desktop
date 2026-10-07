---
titulo: Imágenes y archivos embebidos
tema: Escribir notas
sinonimos: [embed, embeber, insertar, imagen, foto, video, youtube, vimeo, tamaño]
---

**Embeber** es mostrar otro archivo dentro de la nota, en el lugar donde lo escribís: una
imagen, un dibujo, un diagrama o un video. Se escribe con un `!` adelante; lo que cambia
es la forma de nombrar el archivo.

## Para qué sirve

Para que la nota tenga lo que explica a la vista: la captura, el boceto, el diagrama del
proceso. El archivo sigue siendo uno solo: si lo cambiás, todas las notas que lo embeben
muestran la versión nueva.

## Cómo se usa

1. Guardá la imagen dentro del vault, en la carpeta que quieras.
2. Escribí `![[` y su nombre con la extensión: `![[foto.png]]`.
3. Si la querés más chica, agregá el ancho en píxeles después de una barra:
   `![[foto.png|300]]`.

## Imágenes

Hay dos formas, las mismas que en Obsidian:

```md
![[foto.png]]
![[foto.png|300]]
![[foto.png|300x200]]
![[Adjuntos/foto.png]]

![Un atardecer](Adjuntos/foto.png)
![Un atardecer|300](foto.png)
![](https://ejemplo.com/logo.png)
```

- **`![[nombre]]`** busca la imagen **por nombre** en todo el vault. Si hay dos con el
  mismo nombre, poné la carpeta adelante para elegir; si no, gana la de ruta más corta.
- **`![texto](ruta)`** busca la ruta primero **desde la carpeta de la nota** y, si no
  está ahí, **desde la raíz del vault**. Una ruta que empieza con `/` va directo a la
  raíz, y un nombre suelto se busca por nombre como en `![[…]]`. Si la ruta tiene
  espacios, encerrala entre `< >`: `![](<Mis fotos/playa.png>)`.
- El número después de la barra es el ancho; con `300x200`, ancho y alto.
- Una dirección `https://` muestra la imagen de la web tal cual.

Se embeben PNG, JPG, GIF, WebP, BMP, ICO, AVIF y SVG.

## Dibujos y diagramas

```md
![[Boceto.excalidraw]]
![[Arquitectura.drawio]]
```

Muestran el [dibujo de Excalidraw](ayuda:tipos-de-archivo/excalidraw) o el diagrama de
draw.io (en la versión de escritorio) dentro de la nota. Acá la extensión es obligatoria:
sin ella, `![[Boceto]]` se ve como un enlace y no como el dibujo.

## Videos

```md
![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)
![](https://youtu.be/dQw4w9WgXcQ)
![](https://vimeo.com/76979871)
```

Un enlace de YouTube (también `shorts`, `live` y `embed`) o de Vimeo escrito como imagen
muestra el reproductor. Necesita conexión: sin ella, en su lugar se ve el enlace y el
aviso de que no se pudo cargar.

> [!warning] Embeber una nota todavía no muestra su contenido
> `![[Otra nota]]` cuenta como enlace en el grafo, pero no dibuja la nota adentro: se ve
> como un enlace común. Tampoco se dibujan los lienzos (`![[Tablero.canvas]]`). Para
> enlazar notas, ver [Enlaces, alias y embeds](ayuda:enlazar-y-organizar/enlaces).
