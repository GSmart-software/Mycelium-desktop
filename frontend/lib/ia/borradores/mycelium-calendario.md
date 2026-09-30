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
- **«Las próximas N veces»** (del alquiler, de la reunión): contá N ocurrencias desde hoy,
  sin tope de fecha (corré el script con un rango amplio y quedate con las primeras N).
- **«El martes»**: el próximo martes, o hoy si hoy es martes.

En todos los casos, **decí el rango que tomaste** («del lunes 28/09 al domingo 04/10»):
el usuario ve enseguida si entendiste otra cosa.

### Orden al listar

Por fecha; dentro del día, **los de todo el día primero**, después por hora, y a igual
hora por título. Es el orden de la lista de la app.

## Cómo responder «¿qué tengo…?»

1. Leé el archivo (`cat .mycelium/recordatorios.json`). Si no existe, el vault no tiene
   recordatorios: decilo.
2. Calculá el rango con la fecha de hoy.
3. Expandí cada recordatorio día por día con la tabla de arriba y cruzá cada ocurrencia
   con `ocurrencias["id@fecha"]`.
4. Respondé por día, con hora (o «todo el día»), título, repetición si la tiene, «✓ hecha»
   si está completada, y los `[[enlaces]]` del detalle **tal como están escritos** —con
   su alias si lo tienen—, para que el usuario pueda seguirlos. Si el detalle enlaza una
   nota que te sirve para contestar (el orden del día, la lista de regalos), leéla y usala,
   citándola.
5. Si la pregunta es de agenda en general («¿qué tengo…?», «¿qué vence…?»), sumá las
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

Las propiedades de fecha de todas las notas, dentro de un rango (sin lo oculto ni los
`CLAUDE*.md`):

```sh
# notas-con-fecha: propiedades de fecha entre d y h (inclusive)
find . -name '*.md' -not -path '*/.*' -not -name 'CLAUDE*.md' -exec awk -v d=2026-09-28 -v h=2026-10-04 '{sub(/\r$/,"")} FNR==1{fm=($0=="---");next} fm&&/^---$/{fm=0} fm&&match($0,/^[A-Za-z_][A-Za-z0-9_-]*: *"?[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/){f=substr($0,RLENGTH-9,10); if(f>=d&&f<=h) print f"  "FILENAME"  "$0}' {} + | sort
```

Para las vencidas de antes, corrélo con `d=0000-01-01` y `h=` el día anterior al rango, y
leé cada nota para ver si sigue abierta.

### Con `node` (más seguro en rangos largos)

Si `node` está disponible (Claude Code suele instalarse con él), este script aplica
exactamente las reglas de la app. Solo lee. Correlo desde la raíz del vault, con el
rango como argumentos:

```sh
node - 2026-09-28 2026-10-04 <<'EOF'
// consultar-recordatorios: ocurrencias entre dos fechas (inclusive). Solo lee.
const fs = require("fs");
const [desde, hasta] = process.argv.slice(-2);
let a;
try { a = JSON.parse(fs.readFileSync(".mycelium/recordatorios.json", "utf8")); }
catch { console.log("Sin calendario (.mycelium/recordatorios.json no existe o no se lee)."); process.exit(0); }
const valida = (f) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f || ""); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };
const mas = (f, n) => { const [y, m, d] = f.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const entre = (x, y) => Math.round((Date.parse(y) - Date.parse(x)) / 864e5);
const REP = ["ninguna", "dia", "semana", "mes", "anio"];
const recs = (Array.isArray(a.recordatorios) ? a.recordatorios : [])
  .filter((r) => r && typeof r.id === "string" && r.id !== "" && typeof r.titulo === "string" && valida(r.fecha))
  .map((r) => ({ ...r, hora: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.hora) ? r.hora : null,
    repeticion: REP.includes(r.repeticion) ? r.repeticion : "ninguna", detalle: typeof r.detalle === "string" ? r.detalle : "" }));
const ocurre = (r, f) => {
  if (f < r.fecha) return false;
  if (f === r.fecha) return true;
  const [, rm, rd] = r.fecha.split("-"), [, fm, fd] = f.split("-");
  switch (r.repeticion) {
    case "dia": return true;
    case "semana": return entre(r.fecha, f) % 7 === 0;
    case "mes": return fd === rd;
    case "anio": return fm === rm && fd === rd;
    default: return false;
  }
};
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const salida = [];
for (let f = desde; f <= hasta; f = mas(f, 1))
  for (const r of recs) if (ocurre(r, f)) salida.push({ f, r });
// Orden de la app: fecha; en el día, los de todo el día (hora null) primero; después hora; después título.
const cmp = (p, q) => (p < q ? -1 : p > q ? 1 : 0);
salida.sort((x, y) => cmp(x.f, y.f)
  || (x.r.hora === null ? 0 : 1) - (y.r.hora === null ? 0 : 1)
  || cmp(x.r.hora ?? "", y.r.hora ?? "")
  || x.r.titulo.localeCompare(y.r.titulo, "es"));
const oc = a.ocurrencias || {};
for (const { f, r } of salida) {
  const hecha = oc[`${r.id}@${f}`]?.completada === true ? "  ✓ hecha" : "";
  const rep = r.repeticion === "ninguna" ? "" : `  (cada ${{ dia: "día", semana: "semana", mes: "mes", anio: "año" }[r.repeticion]})`;
  const enl = (r.detalle.match(/\[\[[^\]]+\]\]/g) || []).join(" ");
  console.log(`${f} ${DIAS[(new Date(f + "T00:00:00Z").getUTCDay() + 6) % 7]}  ${r.hora ?? "todo el día"}  ${r.titulo}${rep}${hecha}${enl ? "  → " + enl : ""}`);
}
if (salida.length === 0) console.log(`Nada agendado entre ${desde} y ${hasta}.`);
// Marcas de hecha en días del rango en que ese recordatorio NO ocurre: la app no las muestra.
const hay = new Set(salida.map(({ f, r }) => `${r.id}@${f}`));
for (const [clave, e] of Object.entries(oc)) {
  const i = clave.lastIndexOf("@"), f = clave.slice(i + 1), r = recs.find((x) => x.id === clave.slice(0, i));
  if (i > 0 && r && e?.completada === true && f >= desde && f <= hasta && !hay.has(clave))
    console.log(`Aviso: «${r.titulo}» tiene una marca de hecha el ${f}, pero ese día no ocurre: se ignora.`);
}
EOF
```

Sin `node`, hacelo razonando con la tabla: para rangos cortos es seguro si recorrés el
rango **día por día** y no «saltás» de a semanas o meses a ojo.

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
