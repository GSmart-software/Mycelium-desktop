---
titulo: Calendario
tema: Herramientas
sinonimos: [recordatorios, agenda, aviso, alarma, fecha, vencimiento, recordatorios personales, todos los vaults]
---

El **calendario** guarda **recordatorios**: un título, una fecha (con hora o para todo el
día), una repetición, un color y un detalle en Markdown. Cuando llega el momento, Mycelium
te avisa. Los recordatorios son **de cada vault**: viajan con él, y abrir otro vault no los
muestra ni los avisa. Si quieres uno que te acompañe en todos tus vaults, hazlo
**personal** (abajo).

## Para qué sirve

Para lo que tiene fecha: un vencimiento, una reunión, algo que hay que retomar. El detalle
puede llevar `[[enlaces]]` a tus notas, y un clic en ellos abre la nota. Un recordatorio no
es una nota: no aparece en el explorador, en la búsqueda ni en el grafo.

## Cómo se usa

1. Abre el calendario con el botón **Calendario** del rail: se abre como panel, con el mes
   arriba y la lista abajo. Su botón **Abrir como pestaña** lo muestra en grande, con la
   grilla del mes.
2. **Nuevo** (en el panel) o **Nuevo recordatorio** (en la pestaña), o **doble clic** en
   un día para crearlo en esa fecha. La
   repetición puede ser cada día, cada semana, cada mes o cada año.
3. La lista muestra **Día**, **Semana** o **Mes**. Su casilla marca un recordatorio como
   **completado**: se oscurece y se tacha.
4. Con el teclado, en la grilla de la pestaña o del panel: las **flechas** cambian de día y de semana,
   **RePág** y **AvPág** de mes, y **Enter** muestra el día en la lista.
   Detalle en [Atajos de teclado](ayuda:atajos-de-teclado/atajos-de-teclado).

## Recordatorios personales: en todos los vaults

Al crear o editar un recordatorio, **Dónde** elige entre **Este vault** (lo de siempre, y
la opción por defecto) y **Todos los vaults**. Uno de **todos los vaults** es **personal**:
no se guarda en ningún vault sino en la carpeta de datos de Mycelium, junto a tu Bandeja
personal, y se ve y avisa desde cualquier vault que abras.

- En el calendario se ven **juntos** con los del vault; los personales llevan el ícono de
  una **persona**. El desplegable de arriba filtra: **Todos**, **Del vault** o
  **Personales**.
- Cambiar **Dónde** en uno que ya existe lo pasa de un lado al otro, con lo que ya
  marcaste como completado.
- Con varios vaults abiertos a la vez, un personal **avisa una sola vez**, en la ventana
  que estés usando. Completarlo, posponerlo o eliminarlo vale para todos los vaults.
- Un personal recuerda **en qué vault se creó**, y sus `[[enlaces]]` son de ese vault.
  Mirado desde otro, un clic en el enlace te ofrece abrir el vault de origen —en su
  ventana— con la nota. Si ese vault ya no está en tu lista, el enlace se ve roto.

## Los avisos

A la hora del recordatorio aparece una **tarjeta** abajo a la derecha, que no se va sola.
Tiene tres botones:

| Botón | Qué hace |
|---|---|
| **Listo** | Descarta este aviso. Si se repite, el próximo avisa de todos modos. |
| **Posponer** | Vuelve a avisar en **10 minutos**, en **1 hora** o **mañana a esta hora**. |
| **Abrir** | Abre el calendario en ese día. |

Si la ventana está minimizada o tapada, llega además una notificación. Uno sin hora avisa al
abrir el vault ese día. Lo que venció con Mycelium cerrado avisa al abrirlo, marcado como
vencido; si es uno que se repite, avisa una sola vez.

> [!info] Cada mes el 31, solo los meses que tienen 31
> Una repetición mensual no se corre al último día del mes: los meses sin esa fecha no
> tienen recordatorio. Igual el 29 de febrero que se repite cada año: solo en los
> bisiestos.

> [!warning] Eliminar no tiene vuelta atrás
> Los recordatorios no pasan por la papelera. Y en uno que se repite, eliminar borra la
> serie entera. Uno personal se elimina de todos los vaults.
