---
titulo: Imágenes y archivos embebidos
tema: Escribir notas
sinonimos: [embed, embeber, insertar, imagen, foto, video, youtube, vimeo, tamaño, extensión, sin extensión, lienzo, canvas, base, tabla]
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
draw.io (en la versión de escritorio) dentro de la nota.

La extensión es opcional: `![[Boceto]]` busca el archivo **por su nombre**, igual que un
enlace, y lo muestra según lo que encuentre. Si varios archivos se llaman igual:

- **Una nota** (`.md`) gana siempre, y entonces el embed se ve como un enlace a ella.
- Si no hay nota, el orden es fijo: dibujo (`.excalidraw`), diagrama (`.drawio`),
  lienzo (`.canvas`) y tabla (`.base`).
- Para elegir otro, escribe la extensión (`![[Boceto.drawio]]`) o la carpeta delante
  (`![[Diseño/Boceto]]`): lo escrito siempre gana.

## Lienzos

```md
![[Tablero.canvas]]
![[Tablero]]
```

Muestran el [lienzo](ayuda:tipos-de-archivo/lienzos) dentro de la nota: sus tarjetas, sus
grupos y sus flechas, achicados para entrar en el ancho de la hoja. Es una **vista
previa de solo lectura**: para cambiar el lienzo hay que abrirlo. En la vista de lectura,
un clic en cualquier parte lo abre en su pestaña; en la vista en vivo, el clic muestra el
`![[…]]` para editarlo, y el botón **Abrir** de la esquina abre el lienzo. Un lienzo se
carga recién cuando llega a verse, así que una nota con muchos no tarda en abrir.

## Tablas

```md
![[Fichas.base]]
![[Fichas.base#Pendientes]]
```

Muestran la tabla de una [base](ayuda:tipos-de-archivo/bases): la vista que va después
del `#`, o la primera. Como el lienzo, es una vista previa de solo lectura —con las
primeras 15 filas— y un clic abre la base.

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
> como un enlace común. Para enlazar notas, ver
> [Enlaces, alias y embeds](ayuda:enlazar-y-organizar/enlaces).
