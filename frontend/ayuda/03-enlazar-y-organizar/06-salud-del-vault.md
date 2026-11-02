---
titulo: Salud del vault
tema: Enlazar y organizar
solo: desktop
sinonimos: [tablero, dashboard, gráficas, estadísticas, peso del vault, anillos, informe de salud, informe como nota, enlaces rotos, huérfanas, notas sueltas, títulos repetidos, duplicados, homónimas, auditoría, revisar el vault, esquemas, propiedades inválidas]
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

En la nota abierta, los mismos problemas se ven además subrayados: ver
[Avisos en la nota](ayuda:escribir-notas/avisos-en-la-nota).

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
| Propiedades | Notas cuyas [propiedades](ayuda:escribir-notas/propiedades) no cumplen los [esquemas](ayuda:escribir-notas/esquemas-de-propiedades) de `esquemas.yml` (una obligatoria que falta, un tipo o un valor que no corresponde) o tienen un valor que empieza con `#` sin comillas. Cada aviso lleva a su línea |
| Sin enlaces salientes | Notas que no enlazan a ninguna otra. Está plegada: suele ser normal en notas cortas |

Si `esquemas.yml` tiene algo que no se entiende, arriba del panel aparece qué y en qué línea:
esa parte se ignora y lo demás se aplica.

> [!info] Lo que no se revisa
> Las [Esporas](ayuda:enlazar-y-organizar/esporas) son plantillas: sus `[[{{titulo}}]]` no son
> enlaces rotos ni ellas huérfanas. Tampoco se revisan `CLAUDE.md` ni `AGENTS.md` de la raíz,
> que son instrucciones para agentes de IA y no notas del vault. Lo que oculta `.mycignore`
> no está en el índice, así que tampoco aparece.

## La pestaña con las gráficas

**Ctrl+P** → «Abrir la salud del vault en una pestaña» abre un tablero con todo lo que sabe la
revisión, en una pestaña con el ícono de un pulso. Al abrirla se cierra el panel de salud del
costado, para dejarle lugar.

- **Arriba**: cuándo se revisó, cuántos archivos y en cuánto tiempo, y dos botones: «Generar
  informe como nota» (ver abajo) y «Volver a revisar».
- **El resumen**: problemas (y cuántos son graves), archivos, notas, peso en disco, enlaces (con
  el promedio por nota) y etiquetas.
- **Qué hay en el vault**: los archivos agrupados en notas, imágenes, PDF, visuales (dibujos,
  diagramas y lienzos) y otros. Con **Anillos**, los grupos van en el anillo de adentro y las
  carpetas de primer nivel en el de afuera, teñidas con el grupo que más pesa en cada una; en el
  centro está el total y el porcentaje de notas conectadas. Con **Barras**, una barra por tipo de
  archivo, de mayor a menor. **Peso** y **Cantidad** cambian qué se mide. Al lado, la lista con
  cada grupo, su valor y su porcentaje: pasar el puntero por la gráfica resalta su fila, y al
  revés. La elección entre anillos y barras se recuerda en cada vault.
- **Problemas**: los mismos del panel, por gravedad, con un ícono y su nombre. Cada clase se
  despliega y cada fila lleva a la nota y a la línea.
- **Qué ocupa espacio**: el peso de cada carpeta de primer nivel, partido por grupo, y los cinco
  archivos más pesados (un clic los abre).
- **La red**: cuántas notas están conectadas, la red principal y las islas sueltas, las
  huérfanas, cuántas notas tienen 0, 1, 2… conexiones (las huérfanas en gris) y las cinco más
  conectadas, que se abren con un clic.
- **Crecimiento**: notas nuevas por mes en el último año. Si el vault se indexó de una vez, lo
  dice en vez de dibujar un pico falso.
- **Etiquetas**: las ocho más usadas. Un clic busca `tag:` con esa etiqueta.

Pasa el puntero por cualquier barra o porción para ver su detalle. Los colores son tonos del
tema activo y cambian con él.

La pestaña revisa el vault al abrirse (si la última revisión tiene más de un minuto) y con
«Volver a revisar». No se actualiza sola al guardar: así no gasta nada mientras escribes.

## El informe como nota

**Ctrl+P** → «Generar informe de salud del vault» (o el botón de la pestaña) revisa el vault y guarda el resultado como
una nota común: `Informes/Salud del vault AAAA-MM-DD.md` (si el del día ya existe, se le
agrega la hora). La nota se abre sola y un aviso dice dónde quedó.

El informe es una foto de ese momento, no se actualiza solo. Lleva:

- **Propiedades** con la fecha de la revisión, la cantidad de archivos y de notas, el peso en
  MB y el total de problemas, más la etiqueta `#salud-del-vault`.
- Los **problemas en callouts**: graves (enlaces y embeds rotos), avisos (títulos duplicados,
  enlaces ambiguos, propiedades que no cumplen los esquemas) y para revisar (huérfanas y notas
  sin enlaces salientes), con `[[enlaces]]` a las primeras notas afectadas.
- **Qué hay en el vault**: una torta con el peso de cada grupo de archivos y una tabla con cada
  tipo por separado, también los que tienen 0.
- **Qué ocupa espacio** (peso por carpeta), **la red** (cuántas notas están conectadas y cuáles
  conectan más), el **crecimiento** (notas nuevas por mes en el último año) y las
  **etiquetas** más usadas.

Las gráficas son bloques de [Mermaid](ayuda:escribir-notas/formulas-y-diagramas): Mycelium las
dibuja al abrir la nota con los colores del tema que esté activo, y Obsidian también las lee.
Si el vault se indexó de una vez, las fechas de creación no dicen cuándo se escribió cada nota:
en ese caso el informe lo explica en vez de dibujar el crecimiento.

La carpeta se cambia en **Configuración → Vault → Carpeta de los informes**. Si no existe, se
crea; cambiarla no mueve los informes que ya están.

## Con la IA

Con el [control de la IA](ayuda:ia/control-de-la-ia) encendido, Claude Code puede pedir este
mismo informe —del vault, de una carpeta o de una nota— y validar una nota que acaba de
escribir antes de darla por terminada: que su título sea único, que sus enlaces lleguen a
algún lado, que alguna nota la enlace y que sus propiedades cumplan los esquemas.
