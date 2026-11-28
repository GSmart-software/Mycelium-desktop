---
titulo: Instrucciones de IA del vault
tema: IA
solo: desktop
sinonimos: [claude, claude code, agente, memoria, asistente, CLAUDE.md, skills, comandos, hook, enlace markdown, referencias sin enlazar, desactualizadas, actualizar instrucciones]
---

Las **instrucciones de IA** son un conjunto de archivos que Mycelium escribe en tu vault para
que un asistente de IA por terminal —Claude Code— entienda cómo está armado: que cada nota
es un archivo, que los `[[enlaces]]` las asocian, qué sintaxis usa Mycelium y cómo se
trabaja con lienzos, diagramas, bases o el calendario. Con eso, la IA usa el vault como
**su memoria**: busca ahí antes de responder y anota lo que vale la pena recordar.

## Para qué sirve

Para pedirle a la IA cosas sobre tus notas sin explicarle cada vez cómo funciona Mycelium:
«¿qué decidimos sobre tal tema?», «anota esto», «haz un lienzo con estas ideas». Sin las
instrucciones, la IA ve una carpeta de archivos sueltos; con ellas, ve una red.

## Cómo se usa

1. Abre **Configuración → Vault** y, en «Asistente IA (Claude Code)», toca «Generar
   instrucciones IA». Solo se crean si lo pides ahí.
2. Abre una [terminal](ayuda:herramientas/terminal): arranca en la carpeta del vault.
   Inicia Claude Code y pídele lo que necesites.
3. Cuando Mycelium trae instrucciones nuevas, el mismo bloque muestra la versión instalada
   y la disponible, y el botón pasa a «Actualizar a v…». Con todo al día, dice
   «Regenerar».

## Cuando quedan desactualizadas

Al actualizar Mycelium, las instrucciones de tu vault no cambian solas: siguen siendo las
que generaste. Mientras no las actualices, la IA no conoce lo nuevo —una herramienta, un
parámetro, una forma de trabajar— y puede hacer las cosas a la manera vieja.

Por eso, al abrir un vault cuyas instrucciones son más viejas que las que trae Mycelium:

- El ícono de **Actividad de la IA** (el robot del rail) lleva un **punto**, aunque el panel
  esté cerrado.
- Arriba del panel aparece el aviso, con la versión que tienes y la que trae Mycelium.
  **Actualizar** hace lo mismo que el botón de Configuración; **Ver en Configuración** te
  lleva a ese bloque. **Ahora no** lo esconde hasta la próxima vez que abras el vault.
- Si la IA tiene el [control de Mycelium](ayuda:ia/control-de-la-ia) encendido, también se
  entera: cuando mira el estado de la app, Mycelium le dice que sus instrucciones son viejas
  para que te sugiera actualizarlas.

Si los archivos tienen versiones distintas entre sí —por ejemplo, una actualización que se
cortó a mitad—, cuenta la más vieja. Si el vault no tiene instrucciones, no hay aviso: solo
se crean si las pides. Y si son **más nuevas** que las de tu Mycelium —el vault se actualizó
desde una versión posterior, en otra computadora—, no hay punto ni botón, solo una nota en
el panel: lo que conviene es actualizar Mycelium, no volver las instrucciones atrás.

## Qué escribe en el vault

| Dónde | Qué es |
|---|---|
| `CLAUDE.md` | Un **bloque corto** al principio, entre `<!-- mycelium:inicio … -->` y `<!-- mycelium:fin -->`: lo que la IA lee en cada sesión —que el vault es su memoria, las reglas y qué guía cargar para cada cosa—. |
| `.claude/skills/mycelium-*` | Guías por tema, que la IA carga cuando las necesita: la sintaxis de las notas, buscar y anotar, cómo operar Mycelium y una por herramienta (lienzos, draw.io, Excalidraw, bases, Esporas, calendario), algunas con un validador. |
| `.claude/commands/mycelium/` | Comandos que le puedes pedir: `/vault-buscar`, `/vault-recordar`, `/vault-nota`, `/vault-vincular`, `/vault-mapa` y `/vault-huerfanas`. |
| `.claude/hooks/mycelium-referencias.mjs` | El **aviso de referencias sin enlazar** (abajo), registrado en `.claude/settings.json`. |

`.claude/` empieza con punto, así que no lo ves en el explorador. Si quieres verlo, agrega
`!.claude/` al final de los [archivos ignorados](ayuda:configuracion/mycignore).

## El aviso de referencias sin enlazar

Mycelium solo cuenta como enlace lo que va entre corchetes dobles, `[[así]]`. Un enlace de
Markdown común, `[texto](otra.md)`, no cuenta: no aparece en el
[grafo](ayuda:enlazar-y-organizar/grafo) ni en el panel de enlaces. Lo mismo pasa con un
nombre que la auditoría de referencias (**Configuración → Vault → Auditar las referencias**) ya registró
—como `HU-009`— escrito sin corchetes.

Cada vez que la IA escribe o edita una nota, un hook revisa lo nuevo y, si encuentra una de
esas referencias, le avisa con la forma `[[…]]` que corresponde para que la convierta. No
bloquea nada ni cambia el texto por su cuenta. Ignora el código, los enlaces a páginas web y
lo que ya está entre corchetes dobles.

## Lo tuyo no se toca

Mycelium escribe **solo** el bloque de `CLAUDE.md` y lo que lleva `mycelium` en el nombre
dentro de `.claude/`. Todo lo demás es tuyo y queda como está, cada vez que generas o
actualizas:

- Si ya tenías un `CLAUDE.md`, el bloque se agrega **al principio** y lo tuyo queda debajo,
  sin cambios. Al actualizar, se reemplaza solo el bloque.
- Tus propios agentes, comandos, hooks y ajustes de `.claude/` no se tocan. En
  `.claude/settings.json`, Mycelium solo agrega la entrada de su hook y deja lo demás como
  estaba; si el archivo no es JSON válido, no lo toca y lo avisa.

> [!warning] Lo de Mycelium se reescribe al regenerar
> El bloque y los archivos con `mycelium` en el nombre vuelven a escribirse enteros cada
> vez. Si quieres agregarle algo propio a la IA, ponlo en tu `CLAUDE.md`, **fuera** del
> bloque, o en tus propios archivos de `.claude/`.

### Si venías de una versión anterior

Hasta la versión 1.8 de las instrucciones, Mycelium escribía el `CLAUDE.md` entero. Al
actualizar:

- Si no lo habías tocado, se reemplaza por el bloque solo.
- Si lo habías editado, el bloque queda arriba y **no se borra nada**: debajo siguen las
  instrucciones viejas, que empiezan en «# Este vault es tu memoria». Bórralas y deja solo
  lo tuyo; Mycelium te lo avisa al generar.
- Los comandos viejos que estaban sueltos en `.claude/commands/` se borran; si habías
  editado alguno, se queda donde estaba, como tuyo.

Para que la IA además pueda **operar** la app —mostrarte una nota, agendar un recordatorio,
renombrar sin romper enlaces—, mira [Control de la IA](ayuda:ia/control-de-la-ia).
