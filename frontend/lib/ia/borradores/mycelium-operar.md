---
name: mycelium-operar
description: Operar la app Mycelium con las herramientas mycelium_* del MCP de control — qué va por los archivos y qué por la app, mirar qué tiene abierto el usuario antes de escribir, renombrar/mover/borrar sin romper enlaces, qué hacer con RECHAZADO y los demás errores, el diccionario del vault, y cómo trabajar sin el MCP (mv, rm y los enlaces a mano). Usar antes de mostrarle algo al usuario, renombrar, mover o borrar notas o carpetas, tocar el calendario o el diccionario, o cuando las herramientas mycelium_* no respondan.
---
<!-- mycelium-ia v{{VERSION_IA}} -->
# Operar Mycelium (herramientas `mycelium_*`)

Si tenés las herramientas `mycelium_*` (el servidor MCP «mycelium», registrado en
`.mcp.json` cuando el usuario enciende «Dejar que la IA controle Mycelium» en
Configuración → Vault), podés **operar la app**, no solo sus archivos. Qué hace cada
herramienta lo dice su descripción; esta skill es el **criterio** para usarlas.

> [!important] El contenido va por los archivos; operar la app va por Mycelium
> **Leer y escribir** notas, lienzos, tablas o dibujos se hace como siempre, en los
> archivos. **Mostrarle algo al usuario, saber qué tiene abierto, el calendario,
> el diccionario del vault, y renombrar, mover o borrar** pasan por las
> herramientas: no adivines qué está mirando, no le pidas que abra algo a mano,
> **no escribas `.mycelium/recordatorios.json` ni `.mycelium/diccionario.txt`** y
> **no uses `mv` ni `rm`** con notas o carpetas.

## Antes de escribir

- **Antes de escribir un archivo que el usuario podría estar editando**, mirá
  `mycelium_estado`: si su pestaña figura **sin guardar**, avisale antes, porque lo
  que guarde después pisa lo tuyo.
- `mycelium_abrir` **no le roba el foco** salvo que pidas `foco: true`: pedilo solo
  cuando tengas algo que mostrarle ahora («mirá esta nota»), no cada vez que abrís algo.

## Renombrar, mover, borrar

- `mycelium_renombrar` y `mycelium_mover` reparan los `[[enlaces]]` entrantes con el
  mismo código que usa la app cuando el usuario renombra desde el explorador o el
  título. `mycelium_borrar` manda a la **papelera de Mycelium**, de donde se restaura
  (`mycelium_papelera`).
- El nombre no puede llevar `? : * | " < > \ /`.

## Lo que pregunta y lo que no

- **Lo reversible no pregunta**: lo que hacés en el calendario, renombrar o mover
  algo con pocos enlaces y mandar una nota a la papelera quedan en el **registro de
  actividad** de Mycelium (su ícono en el rail), con **Deshacer**. Decile al usuario
  qué hiciste con el texto que te devuelve la herramienta —dice el efecto: qué notas
  se reescribieron, con qué id se restaura— y no repitas la llamada para «confirmar».
- **Lo de alcance grande le pregunta al usuario**: renombrar o mover reescribiendo
  enlaces en **más de 5 notas**, y borrar una **carpeta**. La llamada espera su
  respuesta (hasta 2 minutos). Si contesta que no —o no contesta—, recibís
  `RECHAZADO`: **es una respuesta, no un error**. No lo pidas de nuevo con otras
  palabras ni en partes más chicas para que no pregunte, y no lo hagas por otro
  camino (`mv`, `rm`): contáselo y seguí.

## Errores

- Los errores dicen qué hacer: `NO_ENCONTRADO` trae las notas más parecidas,
  `AMBIGUO` las rutas para repetir la llamada, `APP_CERRADA` que Mycelium no está
  abierto con este vault y `MCP_DESACTIVADO` dónde se enciende. Contáselo al usuario
  en vez de reintentar a ciegas.
- `CAMBIOS_SIN_GUARDAR`: la nota (o una de las que habría que reescribir) tiene un
  borrador en su pestaña. Mycelium guarda solo en unos segundos: esperá y repetí.

## El diccionario del vault

`mycelium_diccionario` es para los **términos propios de este vault** que el corrector
subraya: nombres de proyectos y personas, siglas, jerga del área. Si el usuario te pide
«agregá al diccionario los términos de esta nota», elegí esos, no cualquier palabra
marcada: una errata no se agrega, se corrige. Cada entrada es **una palabra** como la ve
el corrector (sin espacios ni guiones ni dígitos); la respuesta dice cuáles se
rechazaron y por qué. En minúscula vale también Capitalizada y EN MAYÚSCULAS; con
mayúscula («Mycelium»), solo así. Se deshace desde el registro de actividad. El
diccionario **de Mycelium** (el de todos los vaults) no es tuyo: ese lo maneja el usuario.

## Sin las herramientas

Si no tenés las herramientas `mycelium_*` (o contestan `APP_CERRADA` o
`MCP_DESACTIVADO`), nada cambia en tu trabajo con los archivos. Solo:

- No podés mostrar ni saber qué está abierto.
- El calendario se **lee** (skill `mycelium-calendario`) pero no se modifica, y el
  diccionario del vault tampoco (el usuario agrega la palabra con el clic derecho):
  decíselo al usuario y **no toques** esos archivos.
- Renombrar o mover con `mv` **no repara nada**: buscá `[[nombre viejo` —incluidos
  alias `[[viejo|…]]`, embeds `![[viejo]]` y los que llevan carpeta
  `[[Carpeta/viejo]]`— y actualizá cada referencia vos. Un `rm` no pasa por la
  papelera: es para siempre.
- Con el control encendido, un hook te frena cuando corrés `mv` o `rm` sobre notas y
  te recuerda las herramientas: si el MCP no responde, repetí el comando con
  `MYCELIUM_SIN_MCP=1` delante y él te deja pasar.
