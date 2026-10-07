---
titulo: Tareas y sus estados
tema: Escribir notas
sinonimos: [checkbox, casilla, pendiente, hecha, cancelada, lista de tareas, to-do]
---

Una **tarea** es un ítem de lista con una casilla: `- [ ]`. El carácter entre los
corchetes es su **estado**. Además de pendiente y hecha, Mycelium entiende siete estados
más, con los mismos símbolos que los temas de Obsidian: el vault sigue siendo
intercambiable.

## Para qué sirve

Para llevar el seguimiento dentro de la nota misma, sin otra herramienta: lo que está en
curso, lo que se pospuso, lo que se canceló o lo que tiene una pregunta abierta.

## Cómo se usa

1. Empezá una línea con `- [ ] ` (guion, espacio, corchetes con un espacio adentro y otro
   espacio) y escribí la tarea.
2. **Clic** en la casilla: una pendiente pasa a hecha; cualquier otra vuelve a pendiente.
3. **Clic derecho** en la casilla: un menú con los nueve estados para elegir uno.

```ejemplo
- [ ] Pendiente
- [x] Hecha
- [/] En curso
- [-] Cancelada
- [>] Pospuesta
- [*] Destacada
- [!] Importante
- [?] Pregunta
- [+] Agregada
```

Solo **hecha** y **cancelada** cambian el texto: hecha lo apaga, cancelada lo tacha. Los
demás estados cambian solo la casilla. El estilo alcanza al texto propio del ítem; las
subtareas conservan el suyo:

```ejemplo
- [x] Preparar la reunión
  - [ ] Mandar el resumen
```

> [!tip] Con el teclado
> En la vista de lectura, Tab llega a la casilla, Espacio la alterna y la tecla de menú
> (o Shift+F10) abre el menú de estados. En la vista en vivo, con el cursor en la línea
> se ve el marcador en crudo y el símbolo se cambia a mano.

Cualquier otro símbolo entre los corchetes se ve como hecha. `- []` (sin espacio) o
`- [xx]` no son tareas.
