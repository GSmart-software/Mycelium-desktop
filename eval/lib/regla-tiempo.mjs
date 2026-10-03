// La regla de decisión de la tesina, aplicada tal como está escrita.
// Especificación: docs/arquitectura/"MCP de Mycelium - tesina, regla de decision.md"
// (pre-registrada el 2026-09-24, antes de cualquier tanda sobre la tesina).
//
// Es la § 9 de «MCP de Mycelium - evaluacion» con el TIEMPO decidiendo junto al
// costo. Los filtros de validez, `Δ`, `K`, el desglose por clase y el bloqueante
// de C7 son los mismos, y se toman de `aplicarRegla` sin copiarlos; esta función
// agrega `R` (lib/tiempo.mjs), la tabla propia y el bloqueante de C9. Un vault
// la elige con `"regla": "costo-y-tiempo"` en su configuración; el de Mycelium
// sigue con la § 9, que no se toca.
//
// Lógica pura. La prueba `eval/test/regla-tiempo.test.mjs`.

import { agrupar, aplicarRegla, media, UMBRALES } from "./regla.mjs";
import { razonTiempo } from "./tiempo.mjs";

export const UMBRALES_TIEMPO = Object.freeze({
  ...UMBRALES,
  rCaro: 2, // fila 2, salvedad: R > 2
  rAhorro: 0.75, // fila 4: R ≤ 0,75 con IC sin el 1
  bloqueanteC9: -30, // igual que el de C7
});

/**
 * Bloqueante de una clase fuera del índice: el MCP pierde por 30 puntos o más
 * y NUNCA se replegó (a grep en C7, a leer el PDF en C9). Como el de C7 en la
 * § 9.4: «sí» solo si nunca se replegó; si se replegó alguna vez, «indeterminado».
 */
function bloqueante(clase, preguntas, grupos, claves, base, trat, umbral, seReplego) {
  const qs = preguntas.filter((q) => claves[q]?.clase === clase);
  if (!qs.length) return null;
  const pq = (b, q) => media(grupos[b][q].map((f) => f.acierto_citado));
  const delta = media(qs.map((q) => (pq(trat, q) - pq(base, q)) * 100));
  const fs = qs.flatMap((q) => grupos[trat][q]);
  const conDato = fs.map(seReplego).filter((x) => x !== null);
  const tasa = conDato.length ? conDato.filter(Boolean).length / conDato.length : null;
  let estado = "no";
  if (delta <= umbral) estado = tasa === 0 ? "sí" : "indeterminado";
  return { delta, tasaRepliegue: tasa, sinDato: fs.length - conDato.length, estado };
}

/**
 * Aplica la regla de la tesina. `opciones` como `aplicarRegla`, más
 * `leyoPdf`: session_id → boolean (de las transcripciones, `leyoPdf`), para el
 * bloqueante de C9. Devuelve lo mismo que `aplicarRegla` más `r`, `icR` y
 * `bloqueanteC9`, con `fila`/`decision` de ESTA tabla.
 */
export function aplicarReglaTiempo(filas, claves, opciones = {}) {
  const U = { ...UMBRALES_TIEMPO, ...(opciones.umbrales ?? {}) };
  const base = opciones.brazoBase ?? "base";
  const trat = opciones.brazoTratamiento ?? "mcp";
  const s = aplicarRegla(filas, claves, { ...opciones, umbrales: U });
  const salida = { ...s, regla: "costo-y-tiempo", r: null, icR: null, bloqueanteC9: null, defectos: [...s.defectos] };
  if (!s.preguntas.length) return salida;

  const grupos = agrupar(filas);
  const leyo = opciones.leyoPdf ?? new Map();
  salida.bloqueanteC9 = bloqueante("C9", s.preguntas, grupos, claves, base, trat, U.bloqueanteC9, (f) =>
    leyo.has(f.session_id) ? leyo.get(f.session_id) : null,
  );
  if (salida.bloqueanteC9?.sinDato)
    salida.defectos.push(`Bloqueante C9: ${salida.bloqueanteC9.sinDato} corridas del MCP sin transcripción: no se sabe si leyeron el PDF.`);
  if (salida.bloqueanteC9?.estado === "indeterminado")
    salida.defectos.push(
      `Bloqueante C9: Δ(C9) = ${salida.bloqueanteC9.delta.toFixed(1)} pts, pero el MCP leyó el PDF en el ${((salida.bloqueanteC9.tasaRepliegue ?? 0) * 100).toFixed(0)} % de sus corridas C9: se revisa a mano, como el de C7.`,
    );

  // Si la § 9.2 ya cortó (piso o adopción), no hay más que decidir.
  if (s.delta === null) return salida;

  // `R` solo es comparable donde `K` lo es: la compactación mete una llamada más
  // al modelo y rompe el tiempo igual que el costo (§ 9.2).
  const costoComparable = s.k !== null;
  if (costoComparable) {
    const t = razonTiempo(filas, claves, { ...opciones, brazoBase: base, brazoTratamiento: trat });
    Object.assign(salida, { r: t.r, icR: t.icR });
  }
  const { delta, icDelta, k, icK, r, icR } = salida;
  const decide = (fila, decision) => Object.assign(salida, { fila, decision });
  const noDecidible = (n) => decide(n, `Fila ${n} alcanzada, pero necesita K y R, y no son comparables (un brazo compactó): NO DECIDIBLE.`);

  // ── La tabla de la tesina, en orden: la primera fila que se cumple decide ──
  if (delta <= U.empeora) return decide(1, "Fila 1 — el MCP empeora la recuperación: no entra.");
  const icPositivo = icDelta[0] > 0;
  if (delta >= U.contundente && icPositivo) {
    if (!costoComparable) return decide(2, "Fila 2 — entra. Sus salvedades («salvo que K > 2 o R > 2») quedan sin evaluar: un brazo compactó.");
    if (k > U.kCaro || r > U.rCaro)
      return decide(2, `Fila 2 con K = ${k.toFixed(2)}, R = ${r.toFixed(2)} — entra solo con decisión explícita del usuario: la exactitud se paga cara.`);
    return decide(2, "Fila 2 — encuentra cosas que grep no: entra.");
  }
  if (!costoComparable) return noDecidible(delta > 0 && icPositivo ? 3 : 4);
  if (delta > 0 && icPositivo && delta < U.contundente && k <= 1 && r <= 1)
    return decide(3, "Fila 3 — más exacto sin costar ni tardar más (K ≤ 1 y R ≤ 1): entra.");
  // Si la fila 3 no se cumple por costo o tiempo, sigue la tabla: con K > 1 o
  // R > 1 la fila 4 es imposible y decide la 5.
  if (k <= U.kAhorro && icK[1] < 1 && r <= U.rAhorro && icR[1] < 1)
    return decide(4, "Fila 4 — igual de exacto, y claramente más barato y más rápido: entra.");
  if (k > 1 || r > 1) return decide(5, `Fila 5 — K = ${k.toFixed(2)}, R = ${r.toFixed(2)}: sin acertar más, cuesta o tarda más que grep. Se rehace.`);
  return decide(
    6,
    `Fila 6 — ninguna de las anteriores: K = ${k.toFixed(2)} [${icK.map((x) => x.toFixed(2)).join(", ")}], R = ${r.toFixed(2)} [${icR.map((x) => x.toFixed(2)).join(", ")}]. La ventaja no está demostrada en las dos cosas: no entra como está.`,
  );
}
