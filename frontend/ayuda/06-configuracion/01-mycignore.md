---
titulo: Archivos ignorados (.mycignore)
tema: Configuración
solo: desktop
sinonimos: [ignorar, excluir, indexar, ocultar carpeta, gitignore, carpetas ocultas, negación, des-ignorar, mostrar .claude]
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
| `ruta/anidada/` o `/nombre` | Esa ruta exacta, contada desde la raíz del vault. |
| `*` y `?` | Comodines dentro de un nombre: `*` es cualquier texto; `?`, un carácter. |
| `**` | Cualquier cantidad de carpetas: `docs/**/borrador.md`, `adjuntos/**`. |
| `!patrón` | Nada: **vuelve a mostrar** lo que una línea anterior ignoró. |
| `\!nombre` | Lo que se llama `!nombre`: la barra hace que el `!` no sea una negación. |

## Volver a mostrar algo con `!`

Una línea que empieza con `!` des-ignora. Dos reglas deciden qué pasa:

- **Gana la última línea que coincide.** El `!` va **debajo** de la línea que ignora:
  `*.log` y después `!importante.log` muestra ese archivo; al revés, no.
- **Lo que está dentro de una carpeta ignorada no vuelve solo.** Primero hay que volver a
  mostrar la carpeta. Con `.*/` arriba, `!.claude/*.md` no muestra nada, porque `.claude/`
  sigue ignorada; hace falta `!.claude/`. Es la misma regla que en git.

Para ver `.claude/` entera, agregá una línea debajo de la lista por defecto:

```text
.*/
node_modules/
target/
dist/
out/
!.claude/
```

Para ver **solo las notas** de primer nivel de `.claude/` —sin sus subcarpetas ni sus otros
archivos—, mostrá la carpeta, volvé a ignorar lo que tiene y des-ignorá los `.md`:

```text
.*/
node_modules/
target/
dist/
out/
!.claude/
.claude/*
!.claude/*.md
```

La carpeta `.mycelium/`, donde Mycelium guarda lo suyo, se ignora siempre, la nombres o no:
ningún `!` la muestra.

## La lista por defecto

Sin archivo, Mycelium ignora las carpetas que empiezan con punto y las de dependencias y
compilación. Es lo mismo que este `.mycignore`:

```text
.*/
node_modules/
target/
dist/
out/
```

Un ejemplo para un vault que además esconde sus borradores y los archivos temporales:

```text
.*/
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
