---
titulo: Bandeja y captura rápida
tema: Herramientas
sinonimos: [bandeja, captura, captura rápida, anotar, apunte rápido, inbox, bandeja de entrada, notas rápidas, pendientes, Ctrl+Shift+Espacio]
---

La **captura rápida** sirve para anotar algo en el momento, sin decidir dónde va: lo que
escribes se agrega a la **Bandeja** del vault, una nota con un apunte por línea y la hora
en que lo anotaste. Después, con tiempo, la repasas y llevas cada cosa a su lugar.

## Para qué sirve

Para no perder una idea, un dato o una tarea por no querer interrumpir lo que estás
haciendo: no hay que crear una nota, ni ponerle nombre, ni elegir carpeta.

## Cómo se usa

1. Pulsa **Ctrl+Shift+Espacio** desde cualquier lugar de la app (o busca **Captura
   rápida** en la paleta de comandos, **Ctrl+P**). Aparece una cajita arriba, sobre lo que
   tengas abierto.
2. Escribe lo que quieras anotar. Si empiezas con `[]`, entra como **tarea**; si no, como
   **nota**. La etiqueta de la derecha te dice cuál será.
3. **Enter** lo anota y cierra la cajita; un aviso breve te confirma dónde fue. **Esc** o
   un clic afuera cierra sin anotar.

La pestaña que tenías abierta no cambia y el cursor vuelve adonde estaba: puedes seguir
escribiendo como si nada.

## La Bandeja

La Bandeja del vault es la nota `Bandeja.md` en la raíz del vault. Se crea con la primera
captura (o al abrirla desde el explorador). Cada día abre su encabezado y cada apunte va
al final, con la hora:

```markdown
## 2026-11-05
- 09:40 La panadería prefiere hablar por la tarde
- [ ] 10:05 Renovar el dominio antes del 15
```

Las tareas usan los mismos [estados de tarea](ayuda:escribir-notas/tareas) que cualquier
nota.

Es una nota común: se busca, se enlaza (`[[Bandeja]]`), aparece en el grafo y se edita
como cualquier otra. Puedes marcar las tareas, borrar lo que ya procesaste o reordenarla:
la captura siempre agrega al final y no toca lo que ya había, aunque le hayas dado otro
formato.

## En el explorador

La sección **Bandeja**, arriba de **Archivos**, tiene la entrada **Del vault** con un
número: cuántas entradas te quedan por procesar. Cuenta cada apunte (nota o tarea), sin
las tareas hechas ni las canceladas; sin entradas, no muestra número. Como tiene su propia
sección, `Bandeja.md` no se repite en el árbol de **Archivos**. La sección se pliega con un
clic en su título, como **Archivos**, y lo recuerda.

| Acción | Qué hace |
|---|---|
| **Clic** | Abre la Bandeja en una pestaña. |
| **Doble clic** o **Abrir como nota** | La abre en una pestaña fija. |
| **Abrir al lado** | La abre en un panel nuevo a la derecha. |
| **Copiar enlace** | Copia el `[[enlace]]` a la Bandeja. |

## No se renombra ni se elimina

La Bandeja no se puede renombrar, mover ni mandar a la papelera: en su menú, **Renombrar**
y **Mover a la papelera** aparecen apagados, y su título no se edita. Tampoco se elimina
una carpeta que la contenga. La IA del vault tiene el mismo límite.

Si el archivo se borra por fuera de Mycelium, se vuelve a crear vacío la próxima vez que
anotas o la abres.

## Cambiar dónde está

En **Configuración → Vault**, **Bandeja del vault** dice qué nota es la Bandeja
(`Bandeja.md`, si no la cambiaste). Puede estar en una carpeta (`Entrada/Bandeja.md`).
Cambiarla **no mueve el archivo**: la Bandeja pasa a ser la nota de la ruta nueva, y la
anterior queda como una nota más. Si renombras o mueves la carpeta donde está, la Bandeja
la sigue sola.

## Si la tienes abierta

Si la Bandeja está abierta en una pestaña sin cambios, lo que anotas aparece enseguida. Si
la estás editando y todavía no se guardó, Mycelium no pisa lo tuyo: te avisa que el archivo
cambió y te deja elegir, como con cualquier cambio hecho por fuera.
