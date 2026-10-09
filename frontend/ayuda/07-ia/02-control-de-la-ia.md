---
titulo: Control de la IA (MCP)
tema: IA
solo: desktop
sinonimos: [mcp, claude code, servidor, actividad de la ia, deshacer, robot, operar la app]
---

El **control de la IA** deja que Claude Code **opere Mycelium**, no solo sus archivos: que te
muestre una nota, sepa qué tenés abierto, agende un recordatorio o renombre una nota sin
romper los enlaces que llegan a ella. Lo hace por un servidor MCP que viene con Mycelium. Está
**apagado** por defecto, y se prende por vault.

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

## Actividad de la IA

El ícono del robot en el rail abre **Actividad de la IA**. Arriba ves el estado: «Control
apagado» (con un botón para encenderlo), «Control encendido» (esperando a Claude Code) o
«Conectado». Abajo, todo lo que hizo la IA, de lo más nuevo a lo más viejo, con lo que cambió:
«Ir» te lleva a lo afectado y «Deshacer» lo revierte. Si después cambiaste eso mismo a mano,
Deshacer se apaga y te dice por qué: deshacerlo pisaría tu cambio.

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
