---
titulo: Dibujos de Excalidraw
tema: Tipos de archivo
cubre: [excalidraw]
sinonimos: [dibujo, boceto, pizarra, mano alzada, esquema]
---

Un **dibujo** es un archivo `.excalidraw`: una pizarra a mano alzada con formas, flechas y
texto, hecha con el editor de Excalidraw dentro de Mycelium. Es un archivo más del vault, y
una nota lo puede mostrar adentro.

## Para qué sirve

Para pensar en voz alta: un boceto de una pantalla, un esquema rápido, un flujo que todavía
no tiene forma. Si lo que querés es poner notas en el espacio y enlazarlas, te conviene un
[lienzo](ayuda:tipos-de-archivo/lienzos).

## Cómo se usa

1. En el explorador, **Nuevo dibujo Excalidraw**: con el botón de la barra o con clic
   derecho en una carpeta. Se abre en su pestaña y se guarda solo mientras dibujás.
2. Desde una nota, el botón **Insertar diagrama Excalidraw** de la barra del editor crea el
   dibujo en la carpeta de la nota, escribe su embed donde está el cursor y abre el editor
   encima de la nota.
3. Para mostrar en una nota un dibujo que ya existe, escribí su embed:

```markdown
![[Diagrama de la idea.excalidraw]]
```

En la vista de lectura, un clic sobre el dibujo lo abre para editarlo sin salir de la nota,
y el clic derecho ofrece **Exportar como PNG** y **Exportar como SVG**. En la vista en vivo,
el clic muestra la línea del embed para que la puedas editar.

> [!warning] El editor encima de la nota guarda al cerrar
> Lo que dibujás ahí se escribe recién con **Guardar y cerrar**. El dibujo abierto en su
> propia pestaña, en cambio, se guarda solo.
