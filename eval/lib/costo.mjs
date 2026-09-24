// Costo recalculado con pesos congelados (§ 9.1, «El costo se recalcula, no se
// copia de la factura»). Lógica pura.

/** Precios del modelo: el id exacto (`claude-haiku-4-5-20251001`) empieza por la clave. */
export function preciosDe(pesos, modelo) {
  const clave = Object.keys(pesos.modelos)
    .sort((a, b) => b.length - a.length)
    .find((k) => String(modelo).startsWith(k));
  return clave ? pesos.modelos[clave] : null;
}

/**
 * Suma los tokens por categoría de `modelUsage` (todas las llamadas de la
 * sesión, también las auxiliares que Claude Code hace con otro modelo).
 */
export function tokensPorCategoria(modelUsage = {}) {
  const t = { entrada: 0, cache_escritura: 0, cache_lectura: 0, salida: 0 };
  for (const u of Object.values(modelUsage)) {
    t.entrada += u.inputTokens ?? 0;
    t.cache_escritura += u.cacheCreationInputTokens ?? 0;
    t.cache_lectura += u.cacheReadInputTokens ?? 0;
    t.salida += u.outputTokens ?? 0;
  }
  return t;
}

/**
 * Costo en USD con la tabla congelada. `ttl` es el reparto de la escritura de
 * caché entre 5 min y 1 h ({ "5m": n, "1h": m }, de la transcripción); si no hay
 * desglose se asume 5 min, que es el TTL por defecto de la API.
 *
 * Devuelve `null` si algún modelo usado no está en la tabla: un costo a medias
 * sería peor que ninguno.
 */
export function costoRecalculado(modelUsage, pesos, ttl = null) {
  const total5 = ttl?.["5m"] ?? 0;
  const total1 = ttl?.["1h"] ?? 0;
  const f1 = total5 + total1 > 0 ? total1 / (total5 + total1) : 0;
  let usd = 0;
  for (const [modelo, u] of Object.entries(modelUsage ?? {})) {
    const p = preciosDe(pesos, modelo);
    if (!p) return null;
    const cw = u.cacheCreationInputTokens ?? 0;
    usd +=
      (u.inputTokens ?? 0) * p.entrada +
      cw * (1 - f1) * p.cache_escritura_5m +
      cw * f1 * p.cache_escritura_1h +
      (u.cacheReadInputTokens ?? 0) * p.cache_lectura +
      (u.outputTokens ?? 0) * p.salida;
  }
  return usd / 1e6;
}
