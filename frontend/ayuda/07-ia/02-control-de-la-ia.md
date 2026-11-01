---
titulo: Control de la IA (MCP)
tema: IA
solo: desktop
sinonimos: [mcp, claude code, servidor, actividad de la ia, deshacer, robot, operar la app, sesiones, reservas, reservar, varias sesiones]
---

El **control de la IA** deja que Claude Code **opere Mycelium**, no solo sus archivos: que te
muestre una nota, sepa qué tenés abierto, agende un recordatorio o renombre una nota sin
romper los enlaces que llegan a ella. Lo hace por un servidor MCP que viene con Mycelium. Está
**apagado** por defecto, y se prende por vault **en cada computadora**: la decisión no viaja
con la carpeta, así que un vault que te pasaron, o uno que nunca abriste acá, llega con el
control apagado aunque en otra computadora estuviera encendido.

## Para qué sirve

Leer y escribir notas la IA lo hace sola, con los archivos. Pero hay cosas que solo la app
sabe hacer bien: renombrar y mover reparando enlaces, mandar a la papelera, el calendario, el
diccionario del corrector. Con el control encendido, la IA las hace por Mycelium, igual que si
las hicieras vos, y todo queda a la vista con su Deshacer.

## Cómo se usa

1. Abrí **Configuración → Vault** y, en «Asistente IA (Claude Code)», prendé «Dejar que la IA
   controle Mycelium». Mycelium escribe un `.mcp.json` en la raíz del vault.
2. Abrí una sesión **nueva** de Claude Code en el vault. La primera vez te pide aprobar el
   servidor «mycelium».
3. Pedile cosas como «abrime la nota del proyecto», «recordame revisar esto el viernes a las
   10» o «renombrá Plan a Plan 2026».

Las [instrucciones de IA](ayuda:ia/instrucciones-de-ia) le enseñan a la IA cuándo usar cada
herramienta: generalas, o actualizalas si Configuración te ofrece una versión nueva.

## Qué puede hacer

- **Mostrar**: abrir una nota u otro archivo —y llevarte a un encabezado o a una línea—, el
  grafo o el calendario. Sin sacarte de lo que estás escribiendo, salvo que haga falta.
- **Saber qué tenés abierto**: tus pestañas y cuáles tienen cambios sin guardar.
- **Calendario**: leer lo agendado, y crear, cambiar, completar o borrar
  [recordatorios](ayuda:herramientas/calendario).
- **Renombrar y mover** notas y carpetas, reparando los enlaces que llegan a ellas.
- **Papelera**: mandar a la [papelera](ayuda:herramientas/papelera) y restaurar de ella.
  Nunca borra para siempre.
- **Diccionario**: agregar o quitar palabras del diccionario del vault del
  [corrector](ayuda:herramientas/corrector).
- **Consultar la memoria**, sin cambiar nada:
  - **buscar** con la misma [búsqueda](ayuda:enlazar-y-organizar/busqueda) de la app
    (nombre, contenido, frases, `clave:valor` y `tag:x`), solo en las notas que Mycelium
    indexa;
  - ver los **enlaces** de una nota: a qué apunta cada uno, cuáles están rotos y quién la
    enlaza, con la línea de cada uno;
  - leer las filas de una vista de una [base](ayuda:tipos-de-archivo/bases), calculadas
    igual que en su pestaña.

  - revisar la [salud del vault](ayuda:enlazar-y-organizar/salud-del-vault) —enlaces rotos,
    huérfanas, títulos duplicados— y **validar una nota** que acaba de escribir: título
    único, enlaces que resuelven y alguien que la enlace.

  Así la IA ve la memoria con el mismo criterio que la app: un `[[enlace]]` escrito dentro
  de un bloque de código no cuenta, y lo que oculta `.mycignore` no aparece. Estas
  consultas no se anotan en la actividad de la IA, salvo que fallen.

## Actividad de la IA

El ícono del robot en el rail abre **Actividad de la IA**. Arriba ves el estado: «Control
apagado» (con un botón para encenderlo), «Control encendido» (esperando a Claude Code) o
«Conectado». Abajo, todo lo que hizo la IA, de lo más nuevo a lo más viejo, con lo que cambió:
«Ir» te lleva a lo afectado y «Deshacer» lo revierte. Si después cambiaste eso mismo a mano,
Deshacer se apaga y te dice por qué: deshacerlo pisaría tu cambio.

Lo que hizo la IA se muestra **agrupado por sesión**: cada grupo lleva arriba la tarea que
declaró esa sesión (o «Sin tarea declarada») y su identificador, con «conectada» si sigue
abierta. Lo registrado antes de que existieran las sesiones aparece como «Sin sesión
identificada». Deshacer funciona igual dentro de cada grupo.

## Varias sesiones a la vez

Es común tener más de una sesión de Claude Code trabajando en el mismo vault, cada una en su
terminal. Mycelium las reconoce a todas:

- Con alguna conectada, el ícono del robot muestra **cuántas sesiones hay**; al pasar el
  mouse se ve la tarea de cada una. En el panel de actividad, debajo de «Conectado», aparece
  la lista con su tarea, desde cuándo está conectada, cuándo pidió algo por última vez y lo
  que tiene reservado.
- Cada sesión puede **declarar su tarea** («Reorganizar la carpeta de arquitectura»), y
  **reservar** una nota o una carpeta por un rato (media hora, si no pide otro tiempo), con un
  motivo. Una reserva es un **aviso, no un bloqueo**: nada impide escribir, ni a ti ni a otra
  sesión. Si una sesión quiere algo que otra ya reservó, se le concede igual pero se le avisa
  quién lo tiene y para qué, y la IA te consulta antes de tocarlo.
- Cuando la IA pregunta por el estado de Mycelium, además de tus pestañas ve las otras
  sesiones, lo que tienen reservado, lo que cambiaron hace poco por Mycelium y las notas que
  cambiaron en el disco por fuera de la app (en ese caso no se sabe quién las cambió: otra
  sesión, tú en otro editor o git).

> [!warning] Las sesiones y las reservas no se guardan
> Viven mientras Mycelium está abierto. Al cerrar una sesión de Claude Code desaparece con
> sus reservas. Si cierras Mycelium, apagas el control o cambias de vault, se pierden todas:
> al volver, cada sesión que siga abierta se reconecta sola en unos segundos, pero sin su
> tarea ni sus reservas, que tiene que declarar de nuevo.

## Lo que te pregunta antes

Lo que se deshace fácil, lo hace sin preguntar. Te pide confirmación, con un aviso que dice
«Lo pide Claude Code», cuando:

- renombrar o mover reescribiría enlaces en **más de 5 notas**;
- va a mandar una **carpeta** a la papelera.

Si decís que no, o no contestás en dos minutos, no se hace, y la IA no insiste.

> [!info] Apagarlo no le prohíbe los archivos
> Con el control apagado, ningún programa puede pedirle nada a Mycelium. Pero la IA puede
> seguir leyendo y escribiendo los archivos del vault con sus propias herramientas, como
> cualquier otro programa.
