---
titulo: Archivos ignorados (.mycignore)
tema: Configuración
solo: desktop
sinonimos: [ignorar, excluir, indexar, ocultar carpeta, gitignore, carpetas ocultas]
---

El **`.mycignore`** es un archivo en la raíz del vault que dice qué carpetas y archivos
Mycelium tiene que pasar por alto. Funciona como un `.gitignore`: un patrón por línea. Lo
ignorado sigue en el disco, intacto, pero no aparece en el explorador, ni en la búsqueda, ni
en el grafo.

## Para qué sirve

Para esconder lo que no son notas —carpetas de trabajo, borradores, copias— o, al revés, para
**ver** algo que por defecto queda oculto, como la carpeta `.claude/` con las
[instrucciones de IA](ayuda:ia/instrucciones-de-ia). Cada vault tiene el suyo.

## Cómo se usa

1. Abrí **Configuración → Vault** y tocá «Editar .mycignore». Se abre en una pestaña; si el
   vault no tenía uno, Mycelium lo crea con la lista por defecto, así que no cambia nada
   hasta que lo toques.
2. Tocá «Editar», agregá o borrá líneas y guardá con **Ctrl+S**.
3. Listo: al guardarlo, el vault se vuelve a filtrar solo.

## Sintaxis

| Escribís | Ignora |
|---|---|
| `# texto` | Nada: es un comentario. Las líneas vacías también se saltean. |
| `nombre/` | Las **carpetas** con ese nombre, en cualquier nivel, con todo lo que tengan. |
| `nombre` | Archivos **o** carpetas con ese nombre, en cualquier nivel. |
| `ruta/anidada/` | Esa ruta exacta, contada desde la raíz del vault. |
| `*` y `?` | Comodines dentro de un nombre: `*` es cualquier texto; `?`, un carácter. |

No hay negaciones: una línea con `!` no «des-ignora» nada.

Sin archivo, Mycelium ignora las carpetas que empiezan con punto y las de dependencias y
compilación. Es lo mismo que este `.mycignore`:

```text
.*/
node_modules/
target/
dist/
out/
```

Un ejemplo para un vault que además esconde sus borradores y los archivos temporales, pero
**sí** muestra `.claude/`:

```text
# las carpetas ocultas, menos .claude/
.git/
.obsidian/
node_modules/
# borradores de una carpeta puntual
Proyectos/borradores/
# cualquier nota que termine en .tmp.md
*.tmp.md
```

> [!warning] Tu archivo reemplaza a la lista por defecto entera
> Si el vault tiene `.mycignore`, solo vale lo que dice: lo que no escribas ahí deja de
> ignorarse. Si borrás `.*/`, todas las carpetas que empiezan con punto vuelven a verse.
> Conservá las líneas por defecto que te sirvan.

La carpeta `.mycelium/`, donde Mycelium guarda lo suyo, se ignora siempre, la nombres o no.
