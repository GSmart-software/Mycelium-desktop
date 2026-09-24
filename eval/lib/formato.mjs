// El formato de una fila de `resultados.jsonl`, esquema 1 (§ 10). Sirve para
// comprobar que el arnés escribe exactamente eso: ni un campo más, ni uno menos.

const T = {
  str: (v) => typeof v === "string",
  strN: (v) => v === null || typeof v === "string",
  int: (v) => Number.isInteger(v),
  intN: (v) => v === null || Number.isInteger(v),
  num: (v) => typeof v === "number" && Number.isFinite(v),
  numN: (v) => v === null || (typeof v === "number" && Number.isFinite(v)),
  bool: (v) => typeof v === "boolean",
  boolN: (v) => v === null || typeof v === "boolean",
  bin: (v) => v === 0 || v === 1,
  frac: (v) => typeof v === "number" && v >= 0 && v <= 1,
  fracN: (v) => v === null || (typeof v === "number" && v >= 0 && v <= 1),
  citas: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  tokens: (v) =>
    v !== null &&
    typeof v === "object" &&
    Object.keys(v).sort().join() === "cache_escritura,cache_lectura,entrada,salida" &&
    Object.values(v).every(Number.isInteger),
  llamadas: (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(Number.isInteger),
  brazo: (v) => ["ciego", "base", "mcp", "corpus"].includes(v),
  clase: (v) => /^C[1-8]$/.test(v),
  fecha: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v),
  puntuador: (v) => ["mecanico", "requiere-juez", "juez", "humano"].includes(v),
};

/** Los campos de la § 10, en su orden. */
export const CAMPOS = [
  ["esquema", (v) => v === 1],
  ["tanda", T.str],
  ["pregunta", T.str],
  ["clase", T.clase],
  ["brazo", T.brazo],
  ["rep", T.int],
  ["fecha", T.fecha],
  ["commit_vault", (v) => typeof v === "string" && /^[0-9a-f]{7,40}$/.test(v)],
  ["hash_claude_md", T.strN],
  ["hash_skill_memoria", T.strN],
  ["modelo", T.str],
  ["effort", T.strN],
  ["version_cc", T.strN],
  ["version_mcp", T.strN],
  ["semilla_orden", T.intN],
  ["session_id", T.str],
  ["respuesta", T.strN],
  ["citas", T.citas],
  ["no_esta", T.boolN],
  ["acierto", T.bin],
  ["distractor", T.bin],
  ["citas_precision", T.fracN],
  ["citas_exhaustividad", T.frac],
  ["citas_inventadas", T.int],
  ["acierto_citado", T.bin],
  ["puntuador", T.puntuador],
  ["juez_motivo", T.strN],
  ["tokens", T.tokens],
  ["tokens_recuperacion", T.intN],
  ["tokens_pensamiento", T.int],
  ["compactado", T.bool],
  ["costo", T.numN],
  ["costo_usd", T.numN],
  ["pesos_costo", T.str],
  ["num_turns", T.intN],
  ["llamadas", T.llamadas],
  ["ms_total", T.intN],
  ["ms_api", T.intN],
  ["descartada", T.bool],
  ["motivo_descarte", T.strN],
];

/** Lista de problemas de una fila (vacía si cumple el esquema 1). */
export function validarFila(f) {
  const problemas = [];
  const esperados = CAMPOS.map(([k]) => k);
  for (const k of Object.keys(f)) if (!esperados.includes(k)) problemas.push(`campo de más: ${k}`);
  for (const [k, ok] of CAMPOS) {
    if (!(k in f)) problemas.push(`falta: ${k}`);
    else if (!ok(f[k])) problemas.push(`tipo o valor inválido en ${k}: ${JSON.stringify(f[k])}`);
  }
  if (Object.keys(f).join() !== esperados.filter((k) => k in f).join() && !problemas.length) problemas.push("los campos no están en el orden de la § 10");
  if (f.acierto_citado === 1 && (f.acierto !== 1 || f.citas_exhaustividad !== 1)) problemas.push("acierto_citado = 1 sin acierto y exhaustividad plenos");
  if (f.descartada && !f.motivo_descarte) problemas.push("descartada sin motivo");
  return problemas;
}
