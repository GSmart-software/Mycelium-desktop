---
titulo: Salud del vault
tema: Enlazar y organizar
solo: desktop
sinonimos: [enlaces rotos, huérfanas, notas sueltas, títulos repetidos, duplicados, homónimas, auditoría, revisar el vault]
---

La **salud del vault** muestra lo que va degradando la red de notas sin que se note: enlaces
que apuntan a notas que ya no existen, notas que nadie enlaza y títulos repetidos que dejan
dudando a los enlaces. Cada problema lleva a la nota y a la línea donde está.

## Para qué sirve

Un vault crece rápido, sobre todo si una IA escribe en él. Renombrar una nota por fuera de
Mycelium, borrar otra o crear dos con el mismo nombre rompe [enlaces](ayuda:enlazar-y-organizar/enlaces)
en silencio. Este panel los encuentra con el mismo criterio que usa Mycelium para el
[grafo](ayuda:enlazar-y-organizar/grafo): un `[[enlace]]` escrito dentro de un bloque de
código no cuenta, y `[[Nota|alias]]` o `[[Nota#Encabezado]]` son enlaces a `Nota`.

## Cómo se usa

1. Abre el panel con el ícono **Salud del vault** del rail (un corazón con pulso), o con
   **Ctrl+P** → «Revisar la salud del vault».
2. Arriba está el total de problemas. Debajo, cada clase en su sección, con su cantidad.
3. Haz clic en un problema para abrir la nota en esa línea, y corrígelo ahí.

El panel se actualiza solo cuando guardas, cuando algo cambia en el vault por fuera de la app
o cuando creas, renombras, mueves o borras una nota (unos instantes después, no a cada
tecla). El botón de las flechas vuelve a revisar al momento.

## Qué revisa

| Sección | Qué es |
|---|---|
| Enlaces rotos | Un `[[enlace]]` a una nota que no existe. Un enlace a una imagen o un PDF que sí está en el vault no está roto |
| Embeds rotos | Un `![[…]]` de algo que no está, por ejemplo un dibujo que se borró |
| Títulos duplicados | Dos notas del mismo tipo con el mismo nombre en carpetas distintas. Muestra los enlaces **ambiguos**: los que no dicen la carpeta y por eso van a la más cercana a la raíz |
| Huérfanas | Notas que ninguna otra enlaza. Si un [lienzo](ayuda:tipos-de-archivo/lienzos) la tiene como tarjeta, ya no es huérfana |
| Sin enlaces salientes | Notas que no enlazan a ninguna otra. Está plegada: suele ser normal en notas cortas |

> [!info] Lo que no se revisa
> Las [Esporas](ayuda:enlazar-y-organizar/esporas) son plantillas: sus `[[{{titulo}}]]` no son
> enlaces rotos ni ellas huérfanas. Tampoco se revisan `CLAUDE.md` ni `AGENTS.md` de la raíz,
> que son instrucciones para agentes de IA y no notas del vault. Lo que oculta `.mycignore`
> no está en el índice, así que tampoco aparece.

## Con la IA

Con el [control de la IA](ayuda:ia/control-de-la-ia) encendido, Claude Code puede pedir este
mismo informe —del vault, de una carpeta o de una nota— y validar una nota que acaba de
escribir antes de darla por terminada: que su título sea único, que sus enlaces lleguen a
algún lado y que alguna nota la enlace.
