---
name: mycelium-calendario
description: Consultar el calendario de recordatorios del vault de Mycelium (.mycelium/recordatorios.json) — qué hay agendado hoy, esta semana, un día o un mes, con las repeticiones bien expandidas y lo completado. SOLO LECTURA. Usar cuando el usuario pregunte por su agenda, recordatorios, vencimientos o «qué tengo…».
---
<!-- mycelium-ia v{{VERSION_IA}} -->
# El calendario del vault (solo lectura)

Mycelium tiene un **calendario de recordatorios** por vault: un título, una fecha, una
hora opcional, una repetición, un color y un detalle en markdown que puede tener
`[[enlaces]]`. Vive en **`.mycelium/recordatorios.json`**. No son notas: no aparecen en
el explorador, en la búsqueda ni en el grafo, así que un `grep` sobre `*.md` no los
encuentra.

> [!danger] Regla dura: solo LEÉS este archivo
> **Nunca escribas en `.mycelium/`** — ni en `recordatorios.json` ni en ningún otro.
> La app no vigila ese archivo: lo que escribas no aparece hasta reabrir el vault, y
> el próximo guardado de la app lo pisa (o peor, lo pisás vos a ella). Es decisión
> del usuario: la IA consulta el calendario, no lo maneja.
>
> Si te piden **agendar, mover, borrar o completar** un recordatorio, no lo hagas:
> decile que lo haga desde el calendario de Mycelium (ícono «Calendario» del rail, o
> doble clic en un día) y ofrecé redactarle el título y el detalle para que lo pegue.
> Lo que sí podés hacer es crear o actualizar la **nota** a la que el recordatorio va
> a enlazar.

## El formato

```json
{
  "version": 1,
  "recordatorios": [
    {
      "id": "3f2c…",
      "titulo": "Reunión de equipo",
      "fecha": "2026-09-01",
      "hora": "10:30",
      "repeticion": "semana",
      "color": 1,
      "detalle": "Orden del día en [[Reuniones/Equipo]].",
      "vigenteDesde": "2026-08-30T18:12"
    }
  ],
  "ocurrencias": {
    "3f2c…@2026-09-29": { "completada": true },
    "3f2c…@2026-09-22": { "descartada": true },
    "3f2c…@2026-10-06": { "pospuestaHasta": "2026-10-06T11:30" }
  }
}
```

| Campo | Qué es |
|---|---|
| `fecha` | `AAAA-MM-DD`, **fecha local** (no UTC). El día del recordatorio, o el de **su primera vez** si se repite |
| `hora` | `HH:MM` en 24 h, local. `null`, ausente o inválida (`"25:00"`) = **todo el día** |
| `repeticion` | `ninguna` · `dia` · `semana` · `mes` · `anio`. Cualquier otro valor la app lo lee como `ninguna` |
| `color` | 1 a 8 (Hifa, Musgo, Liquen, Yesca, Amanita, Coral, Espora, Bruma). Fuera de rango = 1. Solo sirve para decir «el amarillo» si el usuario lo menciona |
| `detalle` | Markdown libre, puede estar vacío. Sus `[[enlaces]]` apuntan a notas del vault |
| `vigenteDesde` | Solo afecta a **cuándo avisa**, no a qué se muestra. Ignoralo para responder |
| `ocurrencias` | Estado **por ocurrencia**, con clave `idDelRecordatorio@AAAA-MM-DD` |

**Lo que la app descarta** (no existe para el usuario, no lo reportes como agendado): un
recordatorio sin `id`, sin `titulo` de texto, o con una `fecha` que no existe
(`2026-02-30`). Las entradas de `ocurrencias` de un id que ya no está, se ignoran.

### El estado de una ocurrencia

| Marca | Qué significa | Cómo contarlo |
|---|---|---|
| `completada: true` | El usuario la marcó hecha (se ve oscurecida y tachada) | «✓ hecha». Es por ocurrencia: completar el martes 29 no completa el martes 6 |
| `descartada: true` | Apretó «Listo» en el **aviso**. Solo apaga la notificación | **No** es «hecha». No lo menciones salvo que pregunten por los avisos |
| `pospuestaHasta` | Pospuso el **aviso** hasta ese momento (`AAAA-MM-DDTHH:MM`) | El recordatorio **sigue siendo** del mismo día; solo el aviso se corrió |

El calendario de la app muestra todas las ocurrencias, descartadas y pospuestas
incluidas. Solo `completada` cambia cómo se ven.

**Una marca en un día en que el recordatorio no ocurre** (`id@2026-09-30` de un
recordatorio mensual del 31, o de uno que empieza después) no muestra nada en la app:
suele quedar de cuando el recordatorio tenía otra fecha. **Ignorala**: no la cuentes como
hecha ni la «corras» a la ocurrencia vecina (la del 31 de octubre sigue pendiente). Si
toca lo que preguntaron («¿ya pagué el alquiler de septiembre?»), mencionala en una línea;
si no, callala.

## Expandir las repeticiones

Una repetición no tiene fecha de fin. Un recordatorio **ocurre** el día `F` si:

1. `F` es **anterior** a `fecha` → **nunca** (la serie empieza en su fecha).
2. `F == fecha` → **siempre**, sea cual sea la repetición.
3. Si no, según `repeticion`:

| `repeticion` | Ocurre cuando | Borde |
|---|---|---|
| `ninguna` | Solo el día de `fecha` | — |
| `dia` | Todos los días desde `fecha` | — |
| `semana` | Los días a un múltiplo exacto de 7 de `fecha` | El mismo día de la semana que `fecha` |
| `mes` | Los días con **el mismo número de día** que `fecha` | **Un día 31 NO cae en los meses sin 31**, y un 30 no cae en febrero. **No se corre al último día del mes**: ese mes, simplemente, no hay |
| `anio` | Mismo mes y día que `fecha` | Un **29 de febrero** solo cae en años bisiestos (2028, 2032…) |

Así lo resuelve la app (igual que Google Calendar). No «corrijas» la regla: si el
usuario pregunta por qué el alquiler del 31 no aparece en septiembre, esa es la razón,
y conviene decírsela.

### Rangos

- **«Hoy»**: la fecha **local** del sistema. No la supongas, y no te fíes de un `date`
  a secas en Windows:

  ```sh
  # Windows (Git Bash o PowerShell): usa la zona de Windows, pase lo que pase con TZ
  powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"
  # Linux / macOS
  date '+%F %H:%M'
  ```

  `date` y `node` obedecen la variable `TZ`: si apunta a otra zona (o a UTC), cerca de
  medianoche te dan **otro día**. Si usás `date`, `date +%z` tiene que dar el desfase del
  usuario (`-0300` en Argentina). Una hora rara (las 02:55) puede ser la real: no la
  corrijas; si no cierra con la conversación, preguntá.
- **«Esta semana»**: de **lunes a domingo** (así la muestra la app), la que contiene hoy,
  **entera**: si hoy es jueves, lo de lunes a miércoles va igual, marcado como ya pasado
  («ya pasó», o «✓ hecha» si está completada).
- **«Este mes»**, **«el mes que viene»**: el mes calendario, del día 1 al último.
- **«Los próximos N meses»**: de **hoy** al **mismo día** N meses después (si ese día no
  existe, el último de ese mes): desde el 30/09, tres meses llega al 30/12. No redondees
  a meses completos.
- **«En N meses»** (un momento, no un plazo): el mes calendario que cae N meses después,
  entero: «¿qué tengo en seis meses?» el 30/09/2026 es marzo de 2027.
- **«Las próximas N veces»** (del alquiler, de la reunión): N ocurrencias desde hoy, sin
  tope de fecha (`--proximas N --buscar <título>`).
- **«El martes»**: el próximo martes, o hoy si hoy es martes.

En todos los casos, **decí el rango que tomaste** («del lunes 28/09 al domingo 04/10»):
el usuario ve enseguida si entendiste otra cosa.

### Orden al listar

Por fecha; dentro del día, **los de todo el día primero**, después por hora, y a igual
hora por título. Es el orden de la lista de la app.

## Cómo responder «¿qué tengo…?»

1. **Corré el script que viaja con esta skill**, desde la raíz del vault. Solo lee, no
   tiene dependencias y aplica exactamente las reglas de la app (descartes, repeticiones,
   orden, marcas):

   ```sh
   node .claude/skills/mycelium-calendario/consultar.mjs --semana            # esta semana
   node .claude/skills/mycelium-calendario/consultar.mjs --hoy               # o --dia 2026-10-02
   node .claude/skills/mycelium-calendario/consultar.mjs --mes 2026-10-01    # el mes que contiene esa fecha
   node .claude/skills/mycelium-calendario/consultar.mjs --desde 2026-09-30 --hasta 2026-12-30
   node .claude/skills/mycelium-calendario/consultar.mjs --proximas 3 --buscar medicacion
   ```

   `--semana` y `--mes` sin fecha toman la de hoy. `--buscar` filtra por título (sin
   mayúsculas ni tildes); `--json` da la salida estructurada. El script toma «hoy» del
   reloj de `node`, que obedece a `TZ`: la primera línea dice qué fecha y hora usó. Si no
   coincide con la de PowerShell/`date` de arriba, repetí con `--fecha-hoy AAAA-MM-DD`.
   Sin `node`, razoná con la tabla **día por día**, sin «saltar» semanas o meses a ojo.
2. Si el script dice que no hay calendario, el vault no tiene recordatorios: decilo.
3. Respondé por día, con hora (o «todo el día»), título, repetición si la tiene, «✓ hecha»
   si está completada, y los `[[enlaces]]` del detalle **tal como están escritos** —con
   su alias si lo tienen—, para que el usuario pueda seguirlos. Si el detalle enlaza una
   nota que te sirve para contestar (el orden del día, la lista de regalos), leéla y usala,
   citándola.
4. **De hoy**, lo que tiene hora anterior a la actual ya pasó: decilo («la de las 21:00 ya
   pasó»), y en «las próximas N» no la cuentes si el usuario habla de lo que viene.
5. **Avisos corridos** (`[aviso pospuesto hasta …]` en la salida): la ocurrencia sigue
   siendo de **su** día; no la muevas. Mencioná el aviso en una línea solo si puede
   confundir —el usuario lo pospuso a otro día, o pregunta «¿cuándo tengo que…?» y el
   aviso le va a sonar en otro momento—. `descartada` no se menciona salvo que pregunten
   por los avisos.
6. Si la pregunta es de agenda en general («¿qué tengo…?», «¿qué vence…?»), sumá las
   **fechas de las notas**, en una sección aparte (abajo). Si preguntan solo por el
   calendario o los recordatorios, no.

### Aparte: las fechas de las notas

El calendario no ve las notas, pero el usuario también «tiene» lo que vence en ellas.
Presentalo **separado** («En el calendario» / «En tus notas»), nunca mezclado con los
recordatorios, y con este criterio:

- **Entran** las notas con una **propiedad de fecha** del frontmatter (`vence:`,
  `fecha:`, `inicio:`, una fecha y hora) dentro del rango. Citalas con `[[enlace]]` y el
  nombre de la propiedad («[[Pagar dominio]] — vence el lunes 28»).
- **Tareas vencidas antes del rango** que siguen abiertas (`vence:` anterior a hoy y sin
  `hecho: true` ni un `estado` de cierre): van, en una línea propia «vencidas de antes».
  Es lo que el usuario más necesita ver. Lo cerrado (`hecho: true`) no va.
- **Lo que ya pasó de un evento** (una reunión anotada el lunes) no es algo que «tenga»:
  mencionalo solo si ayuda.
- **Fechas escritas en el cuerpo** («el 2 de octubre llamo a Marta»): no las barras por
  defecto, son ambiguas y ruidosas. Si el usuario las pide o el vault no usa
  propiedades de fecha, buscá las fechas concretas del rango
  (`grep -rn --include="*.md" --exclude-dir=".?*" -e "2026-10-02" -e "2/10" .`) y
  presentalas como «menciones», no como agenda.
- **Esporas** (plantillas) no cuentan: sus `{{fecha}}` no son fechas.
- **Un recordatorio y una nota que hablan de lo mismo con fechas distintas** (el
  recordatorio «Entregar informe» el 02/10 y `vence: 2026-10-09` en [[Informe Q3]]):
  mostrá los dos, cada uno en su sección, y señalá la diferencia en una línea como posible
  inconsistencia. No elijas por tu cuenta cuál vale.

Las propiedades de fecha de todas las notas, dentro de un rango (sin lo oculto ni los
`CLAUDE*.md`):

```sh
# notas-con-fecha: propiedades de fecha entre d y h (inclusive)
find . -name '*.md' -not -path '*/.*' -not -name 'CLAUDE*.md' -exec awk -v d=2026-09-28 -v h=2026-10-04 '{sub(/\r$/,"")} FNR==1{fm=($0=="---");next} fm&&/^---$/{fm=0} fm&&match($0,/^[A-Za-z_][A-Za-z0-9_-]*: *"?[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/){f=substr($0,RLENGTH-9,10); if(f>=d&&f<=h) print f"  "FILENAME"  "$0}' {} + | sort
```

Para las vencidas de antes, corrélo con `d=0000-01-01` y `h=` el día anterior al rango, y
leé cada nota para ver si sigue abierta.

## Errores comunes

- **Escribir en `.mycelium/`**. Nunca, ni para «marcar como hecho» algo que el usuario
  te pide. Explicale dónde hacerlo en la app.
- **Correr el día 31 al 30** en una repetición mensual, o poner el 29 de febrero en el 28
  en años no bisiestos. La app no lo hace.
- **Contar ocurrencias antes de `fecha`**: la serie empieza ahí.
- **Tratar `descartada` como hecha**: solo es el aviso.
- **Mezclar fechas UTC**: todo el archivo es hora local. No conviertas zonas horarias, y
  sacá «hoy» de la hora local (PowerShell en Windows), no de un `date` con otra `TZ`.
- **Contar una marca de hecha en un día en que el recordatorio no ocurre**, o correrla a
  la ocurrencia vecina.
- **Semana de domingo a sábado**: en Mycelium la semana empieza el lunes.
- **Buscar recordatorios con `grep --include="*.md"`**: no están en las notas.
- **Citar el detalle como si fuera una nota**: el detalle no es memoria del vault; lo que
  sí es memoria son las notas que enlaza.

## Relacionadas

- skill `mycelium-vault`: la sintaxis de los `[[enlaces]]` del detalle.
- skill `mycelium-memoria`: para contestar con las notas enlazadas, citándolas.
