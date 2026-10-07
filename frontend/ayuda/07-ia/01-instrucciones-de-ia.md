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

| Dónde | Qué es |
|---|---|
| `CLAUDE.md` | Un **bloque corto** al principio, entre `<!-- mycelium:inicio … -->` y `<!-- mycelium:fin -->`: lo que la IA lee en cada sesión —que el vault es su memoria, las reglas y qué guía cargar para cada cosa—. |
| `.claude/skills/mycelium-*` | Guías por tema, que la IA carga cuando las necesita: la sintaxis de las notas, buscar y anotar, cómo operar Mycelium y una por herramienta (lienzos, draw.io, Excalidraw, bases, Esporas, calendario), algunas con un validador. |
| `.claude/commands/mycelium/` | Comandos que le podés pedir: `/vault-buscar`, `/vault-recordar`, `/vault-nota`, `/vault-vincular`, `/vault-mapa` y `/vault-huerfanas`. |

`.claude/` empieza con punto, así que no lo ves en el explorador. Si querés verlo, sacalo de
los [archivos ignorados](ayuda:configuracion/mycignore).

## Lo tuyo no se toca

Mycelium escribe **solo** el bloque de `CLAUDE.md` y lo que lleva `mycelium` en el nombre
dentro de `.claude/`. Todo lo demás es tuyo y queda como está, cada vez que generás o
actualizás:

- Si ya tenías un `CLAUDE.md`, el bloque se agrega **al principio** y lo tuyo queda debajo,
  sin cambios. Al actualizar, se reemplaza solo el bloque.
- Tus propios agentes, comandos, hooks y ajustes de `.claude/` no se tocan.

> [!warning] Lo de Mycelium se reescribe al regenerar
> El bloque y los archivos con `mycelium` en el nombre vuelven a escribirse enteros cada
> vez. Si querés agregarle algo propio a la IA, ponelo en tu `CLAUDE.md`, **fuera** del
> bloque, o en tus propios archivos de `.claude/`.

### Si venías de una versión anterior

Hasta la versión 1.8 de las instrucciones, Mycelium escribía el `CLAUDE.md` entero. Al
actualizar:

- Si no lo habías tocado, se reemplaza por el bloque solo.
- Si lo habías editado, el bloque queda arriba y **no se borra nada**: debajo siguen las
  instrucciones viejas, que empiezan en «# Este vault es tu memoria». Borralas y dejá solo
  lo tuyo; Mycelium te lo avisa al generar.
- Los comandos viejos que estaban sueltos en `.claude/commands/` se borran; si habías
  editado alguno, se queda donde estaba, como tuyo.

Para que la IA además pueda **operar** la app —mostrarte una nota, agendar un recordatorio,
renombrar sin romper enlaces—, mirá [Control de la IA](ayuda:ia/control-de-la-ia).
