---
name: mycelium-esporas
description: Esporas, las plantillas de notas de Mycelium — dónde viven, sus variables ({{titulo}}, {{fecha}}, {{hora}}, {{fecha:FORMATO}}), cómo escribir una buena y cómo crear una nota a partir de una desde la terminal (expandiendo vos las variables). Usar al crear una nota de un tipo que se repite (reunión, diario, proyecto, lectura) o cuando pidan crear o corregir una plantilla.
---
<!-- mycelium-ia v{{VERSION_IA}} -->
# Esporas: las plantillas del vault

Una **Espora** es una **nota normal** (`.md`) que vive en la **carpeta de Esporas** y
sirve de **molde**. En la app, el usuario la usa de tres formas: un clic en el panel
Esporas (crea una nota en la carpeta activa), «Nueva desde Espora» en el clic derecho de
una carpeta (crea ahí) o «Insertar Espora» en la barra del editor (la mete en la nota
abierta). En las tres, Mycelium **sustituye las variables** antes de escribir.

Son moldes, **no memoria**: no consolides conocimiento en ellas, no las cites como
fuente, no las reportes como huérfanas (una plantilla sin enlaces es normal).

## Dónde viven

- Por defecto, **`Esporas/`** en la raíz del vault. El usuario puede cambiarla en
  Configuración → Vault. Para saber cuál es, **leé** (sin tocar) la preferencia:

  ```sh
  grep -o '"carpetaEsporas": *"[^"]*"' .mycelium/preferencias.json
  ```

  Sin resultado (o sin el archivo) → `Esporas`. Nunca escribas en `.mycelium/`.
- Son las notas `.md` que están **directamente** en esa carpeta. **Las subcarpetas no se
  recorren**: `Esporas/Trabajo/Acta.md` no aparece en la lista.
- El **nombre del archivo es el nombre de la plantilla** (`Esporas/Reunión.md` →
  «Reunión»).
- Son notas del vault a todos los efectos: aparecen en el grafo, en la búsqueda y
  **en las bases** (`.base`). Si armás una tabla por etiqueta o propiedad, excluí la
  carpeta de Esporas o la plantilla va a salir como una fila más.

```sh
# Listar las Esporas (carpeta por defecto)
ls Esporas/*.md
```

## Las variables

Son **exactamente cuatro**, en español, minúsculas, entre llaves dobles (se admiten
espacios dentro: `{{ fecha }}`):

| Token | Se sustituye por | Ejemplo (30/09/2026, 14:05) |
|---|---|---|
| `{{titulo}}` | El título **final** de la nota que se crea (su nombre de archivo sin `.md`) o de la nota en la que se inserta | `Reunión con proveedores` |
| `{{fecha}}` | Fecha de hoy, `AAAA-MM-DD`, hora **local** | `2026-09-30` |
| `{{hora}}` | Hora actual, `hh:mm` 24 h | `14:05` |
| `{{fecha:FORMATO}}` | Fecha/hora con formato propio | ver abajo |

Letras de `FORMATO` (distinguen mayúsculas): `AAAA` año · `MM` mes · `DD` día · `hh`
hora · `mm` minuto · `ss` segundo. **Todo lo demás se copia literal.**

| Escribís | Sale |
|---|---|
| `{{fecha:DD/MM/AAAA}}` | `30/09/2026` |
| `{{fecha:AAAA-MM-DD hh:mm}}` | `2026-09-30 14:05` |
| `{{fecha:AAAA-MM-DDThh:mm}}` | `2026-09-30T14:05` (fecha y hora, sirve como propiedad) |
| `{{fecha:AAAA-MM}}` | `2026-09` |
| `{{fecha:hh:mm:ss}}` | `14:05:09` |

> [!warning] No hay nada más
> No existen `{{date}}`, `{{title}}`, `{{time}}` (Obsidian), `<% … %>` (Templater),
> `{{cursor}}`, `{{Titulo}}` con mayúscula, ni letras `YYYY`/`dd`/`HH`. **Un token
> desconocido llega a la nota escrito tal cual** (`{{autor}}` sigue diciendo `{{autor}}`),
> y `{{fecha:YYYY-MM-DD}}` produce `YYYY-09-30`. Tampoco hay día de la semana, fechas
> relativas («mañana») ni nombres de mes. Para pasar una plantilla de Obsidian, ver
> «Adaptar una plantilla de Obsidian».

## Cómo escribir una buena Espora

```md
---
tipo: reunion
fecha: {{fecha}}
participantes: []
proyecto: ""
tags: [reunion]
---
# {{titulo}}

> [!info] Reunión del {{fecha:DD/MM/AAAA}} a las {{hora}}

## Orden del día

- 

## Decisiones

## Próximos pasos

- [ ] 

## Relacionadas

- [[Reuniones]]
```

Reglas, por orden de importancia:

1. **Propiedades de fecha: `{{fecha}}` SIN comillas.** `fecha: {{fecha}}` produce
   `fecha: 2026-09-30`, una propiedad **de tipo fecha** (ordenable y comparable en una
   base). Con comillas (`"{{fecha}}"`) sale **texto**. Para fecha y hora:
   `inicio: {{fecha:AAAA-MM-DDThh:mm}}`. Una fecha **solo en el cuerpo** («Creada el
   {{fecha}}») no la ve ninguna base: si al revisar una Espora la encontrás así, proponé
   sumarla como propiedad (`creado: {{fecha}}`).
2. **Por eso la plantilla en sí se ve «cruda».** Mientras dice `{{fecha}}`, Mycelium lee
   `{…}` como un mapa en línea y no le muestra la tarjeta de propiedades **a la Espora**.
   Las notas que crea sí la tienen. Es esperable: no lo «arregles» entrecomillando.
3. **Nunca un token desconocido sin comillas en el frontmatter.** `autor: {{autor}}`
   no se sustituye, queda `{…}` y **la nota creada se queda sin propiedades**. Un campo
   para completar a mano va vacío: `autor: ""`, `participantes: []`.
4. **Frontmatter dentro del subconjunto de Mycelium**: mapa plano; texto, número,
   `true`/`false`, fecha, fecha y hora, lista (ver skill `mycelium-vault`). `tags` como
   **lista** (`tags: [reunion]`).
5. **Reusá las claves que ya hay en el vault** (`estado`, no `Estado` ni `status`): la
   plantilla las va a multiplicar en cada nota. Las claves del frontmatter de las notas,
   sin lo oculto (`.claude/`, `.mycelium/`) ni los `CLAUDE*.md`:

   ```sh
   find . -name '*.md' -not -path '*/.*' -not -name 'CLAUDE*.md' -exec awk '{sub(/\r$/,"")} FNR==1{fm=($0=="---");next} fm&&/^---$/{fm=0} fm&&/^[A-Za-z_][A-Za-z0-9_-]*:/{sub(/:.*/,"");print}' {} + | sort | uniq -c | sort -rn | head -30
   ```

6. **Dejá los enlaces de entrada puestos**: un `[[Reuniones]]` o `[[Mapa del vault]]` en
   la plantilla hace que cada nota creada nazca enlazada a su índice (y no huérfana).
   Tiene que ser una nota **que exista**: si no hay índice del tema, enlazá la nota más
   cercana que sí exista (el mapa del vault, la nota madre del área) y proponé crear el
   índice (crealo enlazado si el usuario acepta). Un enlace a una nota inexistente en la
   plantilla hace nacer **cada** nota con un enlace roto.
7. **¿Propiedad o sección?** Un campo que se va a **filtrar u ordenar** en una base, o
   buscar con `clave:valor` (`animo: 3`, `estado`, `calificacion`, una fecha), va como
   **propiedad**, con un valor corto y de vocabulario fijo. Lo que se escribe en prosa
   (qué pasó, qué aprendí, por qué) va como **sección** del cuerpo. Un «ánimo» que se va a
   seguir en el tiempo es `animo: ""` (o un número); uno para contarlo, una sección. Si no
   queda claro, propiedad, y decí qué elegiste.
8. **No repitas el título como propiedad**: el título ya es el nombre del archivo. Si lo
   necesitás en el cuerpo, `# {{titulo}}`.
9. Dejá la estructura vacía pero con **indicaciones breves** («Qué tiene que ser verdad
   cuando esto termine»); nada de contenido de ejemplo que después haya que borrar.
10. Guardala **directamente** en la carpeta de Esporas, con un nombre corto que diga el
   tipo de nota (`Reunión`, `Diario`, `Proyecto`, `Lectura`).

### Si ya hay una Espora parecida

Antes de crear, `ls Esporas/` y leé las que se parezcan.

- **Ya hay una para ese tipo de nota** (piden «una plantilla de actas» y existe
  `Reunión.md` con lo mismo): no la dupliques. Decilo y usala; si el pedido suma algo (una
  sección, una propiedad), proponé **mejorar la existente**. Editarla cambia solo las
  notas que se creen después: las ya creadas no se tocan.
- **Es otro tipo, aunque cercano** (acta de directorio con votaciones frente a reunión de
  equipo): creá otra, con un nombre que diga la diferencia (`Acta de directorio`), nunca
  `Reunión 2`.
- Nunca pises una Espora sin avisar: es del usuario, aunque la hayas creado vos.

## Crear una nota A PARTIR de una Espora (desde la terminal)

Vos no apretás botones: **la sustitución de Mycelium solo ocurre cuando se usa desde la
app**. Si copiás la plantilla con `cp`, la nota queda con `{{fecha}}` escrito y, peor,
sin propiedades. Así que **expandís vos las variables**, con las mismas reglas:

1. **Elegí la Espora** que corresponde al tipo de nota (`ls Esporas/`). Si el usuario
   pidió «una reunión» y hay `Esporas/Reunión.md`, partí de ella en vez de inventar una
   estructura.
2. **Decidí título y carpeta** como con cualquier nota (skill `mycelium-memoria`): título
   específico y único (`grep -ril` antes). La app, en cambio, le pone un nombre
   provisional numerado (`Reunión 1`, `Reunión 2`…, nunca el de la plantilla) y deja
   que el usuario lo cambie; no lo imites. **Carpeta**: la que el
   vault ya usa para ese tipo (mirá dónde están las otras notas del mismo `tipo` o
   etiqueta). Si no hay ninguna, no inventes una jerarquía nueva en silencio: proponé la
   carpeta (o la raíz) y, si el usuario no está para contestar, usá la del área más
   cercana y decilo.
3. **Tomá la fecha y la hora LOCALES del sistema**, no las supongas:

   ```sh
   # Windows (Git Bash o PowerShell): usa la zona de Windows, pase lo que pase con TZ
   powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"
   # Linux / macOS
   date '+%F %H:%M'
   ```

   `date` (y `node`) obedecen la variable `TZ`: si está puesta a otra zona, dan otra hora.
   Si usás `date`, mirá `date +%z`: tiene que ser el desfase del usuario (`-0300` en
   Argentina), no `+0000` por defecto. Una hora rara (las 02:55) **puede ser la real**: no
   la «corrijas»; si no cierra con la conversación, preguntá.

   **De madrugada** (antes de las 6, más o menos), «hoy» es ambiguo: un diario escrito a
   las 03:36 que cuenta «hoy fui a…» en pasado suele ser del **día anterior**. No elijas en
   silencio: preguntá en una línea («¿lo fecho el 29 o el 30?»). Si tenés que avanzar,
   usá el día anterior y decilo.

4. **Sustituí** en el texto crudo (frontmatter incluido):
   - `{{titulo}}` → el título final (el nombre del archivo que vas a crear, sin `.md`);
   - `{{fecha}}`, `{{hora}}` y cada `{{fecha:FORMATO}}` → con las letras de la tabla;
   - un token desconocido → **dejalo tal cual**, como la app, y avisale al usuario que la
     plantilla lo tiene. Si el usuario te dio ese dato («con Marta y Juan»), completarlo
     no es sustituir una variable: es escribir la nota, y está bien.
5. **Escribí la nota** con el resultado y **completá lo que sepas** (participantes,
   proyecto, orden del día) en lugar de dejar el esqueleto vacío.
6. Revisá que el frontmatter resultante quede dentro del subconjunto soportado, y
   **enlazala** desde su índice o nota madre. Si no hay índice, desde la nota más cercana
   que exista; si no hay ninguna razonable, creala igual y **proponé** el índice en la
   respuesta. Nunca la dejes huérfana en silencio.

Ejemplo — `Esporas/Reunión.md` de arriba, pedido «estoy en la reunión con proveedores,
con Marta y Juan: anotala», el 30/09/2026 a las 14:05:

```md
---
tipo: reunion
fecha: 2026-09-30
participantes: [Marta, Juan]
proyecto: "[[Rediseño del API]]"
tags: [reunion]
---
# Reunión con proveedores

> [!info] Reunión del 30/09/2026 a las 14:05
…
```

### `{{fecha}}` y `{{hora}}` cuando el evento ya pasó

En la app, las dos valen **el momento en que se crea la nota**, aunque la reunión haya
sido hace tres horas. Vos hacés lo mismo, salvo cuando **sabés** que la nota es de algo
ya ocurrido y la plantilla usa ese valor como el momento **del evento** (`fecha:`, `a las
{{hora}}`, `inicio:`):

- Si el usuario dijo cuándo fue («la de ayer a las 10»), poné **esa** fecha y hora: es
  contenido de la nota, como los participantes.
- Si fue hoy y no sabés la hora: `{{fecha}}` → hoy; la **hora** no la inventes ni pongas
  la de creación como si fuera la del evento. Dejala vacía (`hora: ""`, y sacá el «a las
  …» del cuerpo) y preguntala en una línea al final. Una hora falsa en la memoria es peor
  que ninguna.
- Si el evento es ahora («estoy en la reunión, anotá»), la hora de creación es la buena.

### Personas

- **Escribilas como ya las escribe el vault.** Mirá dos o tres notas del mismo tipo: si
  enlazan (`"[[Marta]]"`) y existe la nota de la persona, enlazá; si ponen nombres
  sueltos, nombres sueltos. Sin convención, **nombre suelto**: un `[[Marta]]` sin nota es
  un enlace roto (`/vault-huerfanas` lo reporta). No crees notas de personas por tu
  cuenta; si hacen falta, proponelo.
- En el frontmatter, un enlace va **entre comillas**: `participantes: ["[[Marta]]", Juan]`.
- **El usuario**: si las notas anteriores lo cuentan entre los participantes, con el
  mismo nombre; si no, no lo agregues (es el autor). No inventes su nombre ni pongas «yo».

### Insertar una Espora en una nota que ya existe

Si te piden «agregá la estructura de reunión a esta nota»:

- El **cuerpo** de la Espora (sin su bloque `---`) va donde corresponda — nunca pegues
  un segundo bloque `---` en medio de la nota: se vería como una línea y un título
  fantasma.
- Sus **propiedades se fusionan** con el frontmatter de la nota: se agregan las que la
  nota no tenía; **las que ya tenía, ganan** (no las pises); `tags` se **unen** sin
  duplicar. Si la nota no tenía frontmatter, se crea arriba de todo.
- `{{titulo}}` es el título de **esa** nota.

## Adaptar una plantilla de Obsidian

Las plantillas del plugin Templates de Obsidian usan otros tokens y letras de Moment.js.
Equivalencias (ejemplo: nota «Acta», 30/09/2026 a las 14:05:09):

| Obsidian | Mycelium | Sale |
|---|---|---|
| `{{title}}` | `{{titulo}}` | `Acta` |
| `{{date}}` | `{{fecha}}` | `2026-09-30` |
| `{{time}}` | `{{hora}}` | `14:05` |
| `{{date:YYYY-MM-DD}}` | `{{fecha:AAAA-MM-DD}}` | `2026-09-30` |
| `{{date:DD/MM/YYYY}}` | `{{fecha:DD/MM/AAAA}}` | `30/09/2026` |
| `{{date:YYYY-MM-DD HH:mm}}` | `{{fecha:AAAA-MM-DD hh:mm}}` | `2026-09-30 14:05` |
| `{{date:YYYY-MM-DDTHH:mm}}` | `{{fecha:AAAA-MM-DDThh:mm}}` | `2026-09-30T14:05` |
| `{{time:HH:mm:ss}}` | `{{fecha:hh:mm:ss}}` | `14:05:09` |
| `{{date:YYYY-MM}}` | `{{fecha:AAAA-MM}}` | `2026-09` |

Letras: `YYYY`→`AAAA` · `MM`→`MM` · `DD`→`DD` · `HH`→`hh` · `mm`→`mm` · `ss`→`ss`.
`{{time:…}}` también pasa a `{{fecha:…}}`. Ojo con `hh`: en Moment es la hora **de 12**;
en Mycelium, la de **24**.

**Sin equivalente** (no hay forma de escribirlos en una Espora): `YY`, `M`, `D` (sin cero),
`Do`, `MMM`/`MMMM` (nombre del mes), `ddd`/`dddd` (día de la semana), `ww` (semana), `A`
(AM/PM), el texto escapado entre `[corchetes]`, fechas relativas y todo Templater
(`<% … %>`). Qué hacer: usá la versión con números más cercana (`DD` por `D`, 24 h por
12 h), sacá el texto fijo **afuera** del token (`Acta del {{fecha:DD/MM/AAAA}}`, no
`{{date:[Acta del] DD/MM/YYYY}}`) y **decile al usuario** qué cambió.

Además:

- **Frontmatter**: `created: "{{date}}"` pasa a `created: {{fecha}}`, **sin comillas**, o
  la propiedad queda de texto (regla 1).
- **Claves del usuario** (`created`, `status`): si el vault ya usa una equivalente
  (`creado`, `estado`: miralo con el comando de la regla 5), usá la del vault y decilo; si
  no, **conservá la del usuario**: es su vocabulario, y quizá la sigue usando en Obsidian.
  No traduzcas claves por tu cuenta.
- **Nombre**: el que dio el usuario; si no, el del archivo de la plantilla original si dice
  el tipo de nota (`Reunión semanal.md` → `Reunión semanal`); si tampoco, el tipo
  (`Acta`). Comprobá que no choque con otra Espora ni con una nota del vault.

## Recetas

| Espora | Frontmatter útil | Cuerpo |
|---|---|---|
| **Reunión** | `tipo: reunion`, `fecha: {{fecha}}`, `participantes: []`, `proyecto: ""`, `tags: [reunion]` | Orden del día · Notas · Decisiones · Próximos pasos (`- [ ]`) · `[[Reuniones]]` |
| **Diario** | `tipo: diario`, `fecha: {{fecha}}`, `tags: [diario]` | `# {{fecha:DD/MM/AAAA}}` · Qué pasó · Qué aprendí · Para mañana · `[[Diario]]` |
| **Proyecto** | `tipo: proyecto`, `estado: activo`, `prioridad: 3`, `creado: {{fecha}}`, `vence: ""`, `tags: [proyecto]` | Objetivo (callout) · Contexto · Tareas · Decisiones · `[[Proyectos]]` |
| **Lectura** | `tipo: lectura`, `autor: ""`, `estado: leyendo`, `empezado: {{fecha}}`, `calificacion: 0`, `tags: [lectura]` | Ideas principales · Citas · Qué me llevo · `[[Lecturas]]` |

Una nota diaria se suele nombrar por su fecha (`2026-09-30.md`, y ahí `{{titulo}}` vale
`2026-09-30`), en la carpeta donde el vault ya guarda los diarios. Si todavía no hay
ninguna, preguntá o proponé una (`Diario/`) antes de crearla.

Estas propiedades combinan con las bases: una Espora `Proyecto` con `estado` y
`prioridad` alimenta directamente una tabla de proyectos activos (skill
`mycelium-base`).

## Cuándo proponer una Espora

Si ves al usuario (o a vos) armando la misma estructura a mano por tercera vez,
proponé convertirla en Espora. Si te pide crearla, seguí las reglas de arriba y decile
cómo usarla en la app: panel **Esporas** del rail, clic derecho en una carpeta → «Nueva
desde Espora», o «Insertar Espora» en la barra del editor.

## Errores comunes

- Copiar la plantilla con `cp` y dejar las variables sin sustituir.
- Usar sintaxis de Obsidian/Templater (`{{date}}`, `{{title}}`, `<% %>`, `YYYY`).
- `MM` por minuto (`{{fecha:hh:MM}}` da la hora y el **mes**).
- `fecha: "{{fecha}}"` entre comillas: la propiedad queda de texto.
- Un `{{algo}}` desconocido sin comillas en el frontmatter: la nota nace sin propiedades.
- Poner la plantilla en una subcarpeta de `Esporas/`: no aparece.
- Consolidar conocimiento dentro de una Espora, o citarla como fuente.
- Tocar `.mycelium/preferencias.json` para cambiar la carpeta: eso se hace en
  Configuración → Vault.

## Relacionadas

- skill `mycelium-vault`: el subconjunto de propiedades (frontmatter) que Mycelium entiende.
- skill `mycelium-memoria`: título, ubicación y enlaces de la nota que creás.
- skill `mycelium-base`: tablas que se alimentan de las propiedades que siembran las Esporas.
