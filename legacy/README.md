# Mycelium 🍄

Clon frontend de Obsidian con estética bioluminiscente (verdes y azules sobre fondo abisal).
**100 % web, sin backend y sin dependencias**: tus notas Markdown viven en tu PC y se leen y
guardan directamente con la File System Access API del navegador.

## Cómo usarlo

Abre `index.html` con doble clic, o sírvelo en local si lo prefieres:

```
npx serve .
# o
python -m http.server
```

> Recomendado: **Chrome o Edge**. Son los navegadores que permiten abrir carpetas y guardar
> los archivos directamente en disco. En otros navegadores puedes importar archivos
> (solo lectura) y al guardar se descargan.

## Funciones

- **Panel de archivos y carpetas** — pulsa *Abrir carpeta* y elige cualquier carpeta de tu PC
  como bóveda; se listan sus `.md` respetando las subcarpetas.
- **Importar fácil** — botón *Importar notas*, o arrastra archivos `.md` a la ventana.
- **Vista y edición de Markdown** — encabezados, listas, tareas, tablas, citas, código,
  resaltado `==así==`, etiquetas `#tag`… Alterna con el lápiz o `Ctrl+E`; guarda con `Ctrl+S`.
- **Wikilinks** — `[[Nombre de nota]]` enlaza notas (con alias usando `|`); si el destino no
  existe, se crea al hacer clic.
- **Paneles divisibles** — divide a la derecha o abajo cuantas veces quieras y redimensiona
  arrastrando los separadores.
- **Grafo de conexiones** — red de nodos luminosos construida a partir de los wikilinks:
  arrastra nodos, haz zoom con la rueda y clic para abrir la nota.

## Estructura

```
index.html      punto de entrada
styles.css      tema bioluminiscente
js/markdown.js  renderizador de Markdown + wikilinks
js/vault.js     bóveda (File System Access API)
js/panes.js     paneles divisibles del espacio de trabajo
js/graph.js     grafo de fuerzas en canvas
js/app.js       aplicación y arranque
```

## Atajos

| Atajo | Acción |
| --- | --- |
| `Ctrl+S` | Guardar la nota del panel activo |
| `Ctrl+E` | Alternar edición / vista previa |
