---
titulo: Instrucciones de IA del vault
tema: IA
solo: desktop
sinonimos: [claude, claude code, agente, memoria, asistente, CLAUDE.md, skills, comandos]
---

Las **instrucciones de IA** son un conjunto de archivos que Mycelium escribe en tu vault para
que un asistente de IA por terminal —Claude Code— entienda cómo está armado: que cada nota
es un archivo, que los `[[enlaces]]` las asocian, qué sintaxis usa Mycelium y cómo se
trabaja con lienzos, diagramas, bases o el calendario. Con eso, la IA usa el vault como
**su memoria**: busca ahí antes de responder y anota lo que vale la pena recordar.

## Para qué sirve

Para pedirle a la IA cosas sobre tus notas sin explicarle cada vez cómo funciona Mycelium:
«¿qué decidimos sobre tal tema?», «anotá esto», «hacé un lienzo con estas ideas». Sin las
instrucciones, la IA ve una carpeta de archivos sueltos; con ellas, ve una red.

## Cómo se usa

1. Abrí **Configuración → Vault** y, en «Asistente IA (Claude Code)», tocá «Generar
   instrucciones IA». Solo se crean si lo pedís ahí.
2. Abrí una [terminal](ayuda:herramientas/terminal): arranca en la carpeta del vault.
   Iniciá Claude Code y pedile lo que necesites.
3. Cuando Mycelium trae instrucciones nuevas, el mismo bloque muestra la versión instalada
   y la disponible, y el botón pasa a «Actualizar a v…». Con todo al día, dice
   «Regenerar».

## Qué escribe en el vault

| Archivo | Qué es |
|---|---|
| `CLAUDE.md` | Lo que la IA lee primero: cómo es el vault y cómo usarlo de memoria. |
| `.claude/skills/` | Guías por tema: la sintaxis de las notas, buscar y anotar, y una por herramienta (lienzos, draw.io, Excalidraw, bases, Esporas, calendario), algunas con un validador. |
| `.claude/commands/` | Comandos que le podés pedir: `/vault-buscar`, `/vault-recordar`, `/vault-nota`, `/vault-vincular`, `/vault-mapa` y `/vault-huerfanas`. |

`.claude/` empieza con punto, así que no lo ves en el explorador. Si querés verlo, sacalo de
los [archivos ignorados](ayuda:configuracion/mycignore).

## Si ya tenías un CLAUDE.md

Mycelium **no pisa** un `CLAUDE.md` tuyo, ni el suyo si lo editaste. Escribe la versión
nueva al lado, como `CLAUDE (mycelium-ia v…).md`, y deja en la raíz la nota «Conflictos
instrucciones IA» con lo que no tocó. Pasá a tu archivo lo que te sirva de la versión nueva.

> [!warning] Lo de `.claude/` se reescribe al regenerar
> Los archivos que Mycelium escribió en `.claude/` vuelven a escribirse enteros cada vez
> que regenerás o actualizás. Si querés agregarle algo propio a la IA, ponelo en tu
> `CLAUDE.md`, no ahí.

Para que la IA además pueda **operar** la app —mostrarte una nota, agendar un recordatorio,
renombrar sin romper enlaces—, mirá [Control de la IA](ayuda:ia/control-de-la-ia).
