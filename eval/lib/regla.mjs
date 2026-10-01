// La regla de decisión pre-registrada, aplicada tal como está escrita.
// Lógica pura: recibe filas de `resultados.jsonl` y las claves, devuelve el
// veredicto y todo lo que lo explica. La prueban `eval/test/regla.test.mjs`.
//
// Especificación: docs/arquitectura/"MCP de Mycelium - evaluacion.md" § 9 (y § 7
// «Qué se hace con la varianza», § 8 sesgo 2). Donde la regla no se deja aplicar
// mecánicamente, el resultado lo dice con `defectos` en vez de inventar un criterio.

export const UMBRALES = Object.freeze({
  pisoBase: 0.5, // § 9.2: el brazo base llega al 50 % de acierto citado
  adopcion: 0.5, // § 9.2: adopción del MCP ≥ 50 %
  compactacion: 0.2, // § 9.2: un brazo compactó en menos del 20 % de sus corridas
  contaminacion: 2, // § 8.2: el ciego acierta en ≥ 2 de 5
  empeora: -5, // fila 1
  contundente: 10, // fila 2
  kCaro: 2, // fila 2, salvedad
  kAhorro: 0.6, // fila 4
  bloqueanteC7: -30, // «fuera del orden de la tabla»
});

/** PRNG determinista (mulberry32): el bootstrap tiene que poder repetirse. */
export function prng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function media(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function mediana(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function redondear(x) {
  return Math.round(x * 1e9) / 1e9;
}

function percentil(ordenados, p) {
  if (!ordenados.length) return NaN;
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.floor(p * ordenados.length)));
  return ordenados[i];
}

const FAMILIA_GREP = new Set(["Grep", "Glob", "Bash", "Read", "PowerShell"]);

function usaMcp(fila) {
  return Object.entries(fila.llamadas ?? {}).some(([n, k]) => n.startsWith("mcp__") && k > 0);
}
function usaGrep(fila) {
  return Object.entries(fila.llamadas ?? {}).some(([n, k]) => FAMILIA_GREP.has(n) && k > 0);
}

/** Agrupa las filas válidas por brazo y pregunta. */
export function agrupar(filas) {
  const g = {};
  for (const f of filas) {
    if (f.descartada) continue;
    ((g[f.brazo] ??= {})[f.pregunta] ??= []).push(f);
  }
  return g;
}

/**
 * § 8, sesgo 2: una pregunta que el ciego acierta en ≥ 2 corridas está
 * contaminada. DEFECTO DE LA REGLA, corregido acá y anotado: una pregunta de
 * AUSENCIA la «acierta» cualquier brazo que no encuentre nada —y el ciego nunca
 * encuentra nada—, así que el filtro sacaría todas las C5. No se aplica a ellas.
 */
export function contaminadas(grupos, claves, brazoCiego = "ciego", umbral = UMBRALES.contaminacion) {
  const out = [];
  for (const [q, filas] of Object.entries(grupos[brazoCiego] ?? {})) {
    if (claves[q]?.veredicto === "ausencia" || claves[q]?.clase === "C5") continue;
    const aciertos = filas.filter((f) => f.acierto === 1).length;
    if (aciertos >= umbral) out.push({ pregunta: q, aciertos, corridas: filas.length });
  }
  return out;
}

/**
 * Bootstrap pareado remuestreando PREGUNTAS (§ 7): cada réplica elige |Q|
 * preguntas con reposición y recalcula Δ y K.
 */
export function bootstrap(porPregunta, { replicas = 10000, semilla = 20260924, conK = true } = {}) {
  const r = prng(semilla);
  const n = porPregunta.length;
  const deltas = [];
  const ks = [];
  for (let b = 0; b < replicas; b++) {
    let sd = 0;
    const razones = [];
    for (let i = 0; i < n; i++) {
      const q = porPregunta[Math.floor(r() * n)];
      sd += q.d;
      if (conK) razones.push(q.razon);
    }
    deltas.push(redondear((sd / n) * 100));
    if (conK) ks.push(redondear(mediana(razones)));
  }
  deltas.sort((a, b) => a - b);
  ks.sort((a, b) => a - b);
  return {
    icDelta: [percentil(deltas, 0.025), percentil(deltas, 0.975)],
    icK: conK ? [percentil(ks, 0.025), percentil(ks, 0.975)] : null,
  };
}

/**
 * Aplica la § 9 completa. `claves`: id → clave (necesita `clase` y `veredicto`).
 * Devuelve `{ valida, filtros, delta, icDelta, k, icK, fila, decision, defectos, ... }`.
 */
export function aplicarRegla(filas, claves, opciones = {}) {
  const U = { ...UMBRALES, ...(opciones.umbrales ?? {}) };
  const base = opciones.brazoBase ?? "base";
  const trat = opciones.brazoTratamiento ?? "mcp";
  const ciego = opciones.brazoCiego ?? "ciego";
  const grupos = agrupar(filas);
  const defectos = [];

  const cont = contaminadas(grupos, claves, ciego, U.contaminacion);
  const fuera = new Set(cont.map((c) => c.pregunta));
  const preguntas = Object.keys(grupos[base] ?? {})
    .filter((q) => grupos[trat]?.[q] && !fuera.has(q))
    .sort();

  const pq = (b, q) => media(grupos[b][q].map((f) => f.acierto_citado));
  const costoMed = (b, q) => mediana(grupos[b][q].map((f) => f.costo).filter((x) => Number.isFinite(x)));

  // ── § 9.2: filtros de validez ──────────────────────────────────────────────
  const todasTrat = preguntas.flatMap((q) => grupos[trat][q]);
  const piso = preguntas.length ? media(preguntas.map((q) => pq(base, q))) : NaN;
  const adop = todasTrat.length ? todasTrat.filter(usaMcp).length / todasTrat.length : NaN;
  const tasaComp = (b) => {
    const fs = preguntas.flatMap((q) => grupos[b][q]);
    return fs.length ? fs.filter((f) => f.compactado).length / fs.length : NaN;
  };
  const filtros = {
    piso: { valor: piso, umbral: U.pisoBase, pasa: piso >= U.pisoBase },
    adopcion: { valor: adop, umbral: U.adopcion, pasa: adop >= U.adopcion },
    compactacion: {
      [base]: { valor: tasaComp(base), pasa: tasaComp(base) < U.compactacion },
      [trat]: { valor: tasaComp(trat), pasa: tasaComp(trat) < U.compactacion },
    },
  };
  const costoComparable = filtros.compactacion[base].pasa && filtros.compactacion[trat].pasa;

  const salida = {
    preguntas,
    contaminadas: cont,
    filtros,
    delta: null,
    icDelta: null,
    k: null,
    icK: null,
    fila: null,
    decision: null,
    defectos,
    porClase: {},
    inestables: {},
    bloqueanteC7: null,
  };

  if (!preguntas.length) {
    salida.decision = "Sin preguntas comparables entre los dos brazos: no hay nada que decidir.";
    return salida;
  }

  // Desglose por clase e inestables: se reportan siempre (§ 5, § 7).
  for (const q of preguntas) {
    const clase = claves[q]?.clase ?? "?";
    (salida.porClase[clase] ??= []).push((pq(trat, q) - pq(base, q)) * 100);
  }
  for (const k of Object.keys(salida.porClase)) salida.porClase[k] = media(salida.porClase[k]);
  for (const b of [base, trat, ciego]) {
    salida.inestables[b] = Object.entries(grupos[b] ?? {})
      .filter(([, fs]) => {
        const p = media(fs.map((f) => f.acierto_citado));
        return p > 0 && p < 1;
      })
      .map(([q]) => q);
  }

  // Bloqueante de clase (fuera del orden de la tabla).
  const c7 = preguntas.filter((q) => claves[q]?.clase === "C7");
  if (c7.length) {
    const d7 = media(c7.map((q) => (pq(trat, q) - pq(base, q)) * 100));
    const fs = c7.flatMap((q) => grupos[trat][q]);
    const caida = fs.filter(usaGrep).length / fs.length;
    // DEFECTO DE LA REGLA: «sin caer a grep» no tiene umbral. Solo se decide en
    // los extremos; en el medio lo dice.
    let estado = "no";
    if (d7 <= U.bloqueanteC7) estado = caida === 0 ? "sí" : "indeterminado";
    if (estado === "indeterminado")
      defectos.push(
        `Bloqueante C7: Δ(C7) = ${d7.toFixed(1)} pts, pero el MCP cayó a grep en el ${(caida * 100).toFixed(0)} % de sus corridas C7 y la regla no dice cuánta caída alcanza para descartar el bloqueo.`,
      );
    salida.bloqueanteC7 = { delta: d7, tasaCaidaAGrep: caida, estado };
  }

  if (!filtros.piso.pasa || !filtros.adopcion.pasa) {
    const tareas = [];
    if (!filtros.piso.pasa)
      tareas.push(`el brazo base no llega al piso (${(piso * 100).toFixed(1)} % < 50 %): subir al modelo siguiente y anotarlo`);
    if (!filtros.adopcion.pasa)
      tareas.push(`adopción del MCP ${(adop * 100).toFixed(1)} % < 50 %: corregir nombres, descripciones o instrucciones y volver a correr`);
    salida.decision = `Sin conclusión (§ 9.2): ${tareas.join("; ")}.`;
    return salida;
  }

  // ── § 9.1: Δ y K ───────────────────────────────────────────────────────────
  const datos = preguntas.map((q) => ({
    q,
    d: pq(trat, q) - pq(base, q),
    razon: costoComparable ? costoMed(trat, q) / costoMed(base, q) : NaN,
  }));
  // Redondeo a 1e-9: sin él, un Δ de exactamente +10 sale 9,999999999 por la
  // aritmética de coma flotante y cae en la fila equivocada.
  const delta = redondear(media(datos.map((x) => x.d)) * 100);
  const k = costoComparable ? redondear(mediana(datos.map((x) => x.razon))) : null;
  const bs = bootstrap(datos, { ...opciones.bootstrap, conK: costoComparable });
  Object.assign(salida, { delta, icDelta: bs.icDelta, k, icK: bs.icK });

  // § 9.2: si un brazo compactó, se lee la exactitud (filas 1 y 2) y el costo
  // queda sin decidir. Ya no es un defecto: la regla lo dice así desde el
  // 2026-09-24.

  const icSinCeroPositivo = bs.icDelta[0] > 0;
  const sinK = (n) => {
    salida.fila = n;
    salida.decision = `Fila ${n} alcanzada, pero necesita K y K no es comparable: NO DECIDIBLE.`;
    return salida;
  };

  // ── § 9.3: primera fila que se cumple ──────────────────────────────────────
  if (delta <= U.empeora) {
    salida.fila = 1;
    salida.decision = "Fila 1 — el MCP empeora la recuperación: se abandona o se rehace de cero (y se investiga por qué).";
    return salida;
  }
  if (delta >= U.contundente && icSinCeroPositivo) {
    salida.fila = 2;
    if (k === null) {
      salida.decision = "Fila 2 — entra. Su salvedad de costo («salvo que K > 2») queda sin evaluar: un brazo compactó (§ 9.2).";
    } else if (k > U.kCaro) {
      salida.decision = `Fila 2 con K = ${k.toFixed(2)} > 2 — entra solo con decisión explícita del usuario: la exactitud se paga cara.`;
    } else {
      salida.decision = "Fila 2 — encuentra cosas que grep no: entra.";
    }
    return salida;
  }
  if (delta > 0 && icSinCeroPositivo && delta < U.contundente) {
    if (k === null) return sinK(3);
    salida.fila = 3;
    salida.decision =
      k <= 1
        ? "Fila 3 con K ≤ 1 — algo más exacto y sin costar más: entra."
        : "Fila 3 con K > 1 — se trata como la fila 5: no entra como está; se rehace el diseño de las herramientas o se recorta el alcance.";
    return salida;
  }
  if (k === null) return sinK(4);
  if (k <= U.kAhorro && bs.icK[1] < 1) {
    salida.fila = 4;
    salida.decision = "Fila 4 — igual de exacto y claramente más barato: entra, con el ahorro como justificación explícita.";
    return salida;
  }
  if (k > U.kAhorro && k <= 1) {
    salida.fila = 5;
    salida.decision = "Fila 5 — ni más exacto ni lo bastante más barato: no entra como está.";
    return salida;
  }
  if (k > 1) {
    salida.fila = 6;
    salida.decision = "Fila 6 — cuesta más que grep sin acertar más: se rehace.";
    return salida;
  }
  // Fila 7 (§ 9.3, agregada el 2026-09-24): lo que no cayó en ninguna de las
  // anteriores no demostró nada, y se lee como la fila 5. El caso típico es
  // K ≤ 0,6 con el IC de K tocando el 1: el ahorro no está probado. Antes de
  // esta fila era un hueco de la tabla, y lo encontró este mismo código.
  salida.fila = 7;
  salida.decision = `Fila 7 — ninguna de las anteriores: K = ${k.toFixed(2)}, IC [${bs.icK[0].toFixed(2)}, ${bs.icK[1].toFixed(2)}]. El ahorro o la mejora no están probados: se lee como la fila 5, no entra como está.`;
  return salida;
}
