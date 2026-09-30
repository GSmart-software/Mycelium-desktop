---
name: mycelium-calendario
description: Consultar el calendario de recordatorios del vault de Mycelium (.mycelium/recordatorios.json) — qué hay agendado hoy, esta semana, un día o un mes, con las repeticiones bien expandidas y lo completado. SOLO LECTURA. Usar cuando el usuario pregunte por su agenda, recordatorios, vencimientos o «qué tengo…».
---
<!-- mycelium-ia v1.7.0 -->
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

- **«Hoy»**: la fecha local del sistema — `date +%F` (y `date +%H:%M` si importa la hora).
  No la supongas.
- **«Esta semana»**: de **lunes a domingo** (así la muestra la app), la que contiene hoy.
- **«Este mes»**: del día 1 al último del mes.
- **«El martes»**: el próximo martes, o hoy si hoy es martes; si hay duda, decí qué
  fecha tomaste.

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
5. Aclará que son **recordatorios del calendario**, no notas: si además hay notas con
   fecha que vengan al caso (propiedad `vence:`, notas diarias), buscalas aparte y
   presentalas separadas.

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
salida.sort((x, y) => (x.f !== y.f ? (x.f < y.f ? -1 : 1)
  : (x.r.hora ?? "") !== (y.r.hora ?? "") ? ((x.r.hora ?? "") < (y.r.hora ?? "") ? -1 : 1)
  : x.r.titulo.localeCompare(y.r.titulo, "es")));
const oc = a.ocurrencias || {};
for (const { f, r } of salida) {
  const hecha = oc[`${r.id}@${f}`]?.completada === true ? "  ✓ hecha" : "";
  const rep = r.repeticion === "ninguna" ? "" : `  (cada ${{ dia: "día", semana: "semana", mes: "mes", anio: "año" }[r.repeticion]})`;
  const enl = (r.detalle.match(/\[\[[^\]]+\]\]/g) || []).join(" ");
  console.log(`${f} ${DIAS[(new Date(f + "T00:00:00Z").getUTCDay() + 6) % 7]}  ${r.hora ?? "todo el día"}  ${r.titulo}${rep}${hecha}${enl ? "  → " + enl : ""}`);
}
if (salida.length === 0) console.log(`Nada agendado entre ${desde} y ${hasta}.`);
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
- **Mezclar fechas UTC**: todo el archivo es hora local. No conviertas zonas horarias.
- **Semana de domingo a sábado**: en Mycelium la semana empieza el lunes.
- **Buscar recordatorios con `grep --include="*.md"`**: no están en las notas.
- **Citar el detalle como si fuera una nota**: el detalle no es memoria del vault; lo que
  sí es memoria son las notas que enlaza.

## Relacionadas

- skill `mycelium-vault`: la sintaxis de los `[[enlaces]]` del detalle.
- skill `mycelium-memoria`: para contestar con las notas enlazadas, citándolas.
