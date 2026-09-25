// El tiempo como métrica de primera clase. Lógica pura: recibe filas de
// `resultados.jsonl` (y, si las hay, mediciones sacadas de las transcripciones y
// del registro de búsquedas del MCP) y devuelve números. La prueba
// `eval/test/tiempo.test.mjs`.
//
// **No entra en la § 9** de «MCP de Mycelium - evaluacion»: esa regla está
// congelada y no incluye el tiempo. Donde el tiempo sí decide —la regla de la
// tesina, pre-registrada aparte— lo usa `lib/regla-tiempo.mjs`.

import { agrupar, bootstrap, contaminadas, mediana, redondear } from "./regla.mjs";

/**
 * `R`: razón de tiempo de reloj tratamiento/base, pareada por pregunta, con la
 * MISMA construcción que `K` (§ 9.1): por pregunta, mediana de `ms_total` de sus
 * repeticiones en cada brazo; `R` es la mediana de esas razones. El IC sale del
 * mismo *bootstrap* remuestreando preguntas, con la misma semilla: las réplicas
 * eligen las mismas preguntas que las de `K`.
 *
 * Las preguntas son las mismas que usa la regla: las que tienen los dos brazos,
 * sin las contaminadas.
 */
export function razonTiempo(filas, claves, opciones = {}) {
  const base = opciones.brazoBase ?? "base";
  const trat = opciones.brazoTratamiento ?? "mcp";
  const ciego = opciones.brazoCiego ?? "ciego";
  const g = agrupar(filas);
  const fuera = new Set(contaminadas(g, claves, ciego).map((c) => c.pregunta));
  const med = (b, q) => mediana(g[b][q].map((f) => f.ms_total).filter((x) => Number.isFinite(x) && x > 0));
  const porPregunta = Object.keys(g[base] ?? {})
    .filter((q) => g[trat]?.[q] && !fuera.has(q))
    .sort()
    .map((q) => ({ q, base: med(base, q), trat: med(trat, q) }))
    .filter((x) => Number.isFinite(x.base) && Number.isFinite(x.trat) && x.base > 0)
    .map((x) => ({ ...x, razon: x.trat / x.base }));
  if (!porPregunta.length) return { r: null, icR: null, porPregunta, masRapido: 0 };
  const r = redondear(mediana(porPregunta.map((x) => x.razon)));
  const bs = bootstrap(
    porPregunta.map((x) => ({ d: 0, razon: x.razon })),
    { ...opciones.bootstrap, conK: true },
  );
  return { r, icR: bs.icK, porPregunta, masRapido: porPregunta.filter((x) => x.razon < 1).length };
}

/**
 * Por brazo: mediana del tiempo total, del tiempo en herramientas y del resto
 * (lo que no es herramienta: el modelo pensando y la latencia de la API), y de
 * los turnos. `herramientas`: session_id → `tiemposDeHerramientas(...)`; las
 * filas sin transcripción no entran en esas dos columnas.
 */
export function tiemposPorBrazo(filas, herramientas = new Map()) {
  const out = {};
  for (const f of filas) {
    if (f.descartada) continue;
    const b = (out[f.brazo] ??= { total: [], herramientas: [], modelo: [], turnos: [], sinTranscripcion: 0 });
    if (Number.isFinite(f.ms_total)) b.total.push(f.ms_total);
    if (Number.isFinite(f.num_turns)) b.turnos.push(f.num_turns);
    const t = herramientas.get(f.session_id);
    if (!t) {
      b.sinTranscripcion++;
      continue;
    }
    b.herramientas.push(t.ms_herramientas);
    if (Number.isFinite(f.ms_total)) b.modelo.push(Math.max(0, f.ms_total - t.ms_herramientas));
  }
  const res = {};
  for (const [brazo, x] of Object.entries(out))
    res[brazo] = {
      corridas: x.total.length,
      ms_total: mediana(x.total),
      ms_herramientas: x.herramientas.length ? mediana(x.herramientas) : null,
      ms_resto: x.modelo.length ? mediana(x.modelo) : null,
      turnos: x.turnos.length ? mediana(x.turnos) : null,
      sin_transcripcion: x.sinTranscripcion,
    };
  return res;
}

function percentil(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

/**
 * Latencia interna del MCP por llamada, del campo `ms` de su registro de
 * búsquedas: lo que tardó el servidor en buscar, sin el viaje por stdio ni el
 * cliente. Solo `vault_buscar` se registra. `llamadas`: las de las
 * transcripciones ya emparejadas con su línea (`emparejar`).
 */
export function latenciaMcp(llamadas) {
  const ms = llamadas.filter((c) => c.registro && Number.isFinite(c.registro.ms)).map((c) => c.registro.ms);
  const buscar = llamadas.filter((c) => c.herramienta === "vault_buscar").length;
  return {
    llamadas_buscar: buscar,
    emparejadas: ms.length,
    ms_mediana: ms.length ? mediana(ms) : null,
    ms_p95: percentil(ms, 0.95),
    ms_max: ms.length ? Math.max(...ms) : null,
  };
}
