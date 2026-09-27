// Test headless del ciclo de asentamiento del grafo (`FUN-L-25` · Parte C,
// `DEF-109`): `components/graph/cicloFisica.ts` (decaimiento como `d3-force`,
// arrastre, simulación continua, presupuesto por tanda y siembra en
// filotaxis) sobre el motor de `fisica.ts`. Los dos módulos son puros; se
// transpilan en el momento y se importan vía data: URL, como
// `scripts/test-fisica.mjs` (el import de `./fisica` se reemplaza por la URL).
//
// Lo que NO se prueba acá, porque necesita la app: el worker libre
// (`sim.worker.ts`), el dibujo a fidelidad reducida y los nombres. Eso lo
// confirma el usuario en la app (y la consola dice cuándo se asentó).
//
//   node --test scripts/test-ciclo.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const transpilar = async (archivo) =>
  ts.transpileModule(
    await readFile(fileURLToPath(new URL(`../components/graph/${archivo}`, import.meta.url)), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
const urlFisica = `data:text/javascript,${encodeURIComponent(await transpilar("fisica.ts"))}`;
const F = await import(urlFisica);
const C = await import(
  `data:text/javascript,${encodeURIComponent((await transpilar("cicloFisica.ts")).replace('"./fisica"', JSON.stringify(urlFisica)))}`
);

/** Generador pseudoaleatorio con semilla (mulberry32): corridas reproducibles. */
function azarCon(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grafo como el de un vault: cada nota enlaza a 1–3 anteriores, con preferencia por los hubs. */
function grafoVault(n, semilla) {
  const r = azarCon(semilla);
  const ar = [];
  for (let i = 1; i < n; i++) {
    if (r() < 0.15) continue;
    const m = 1 + Math.floor(r() * 3);
    for (let j = 0; j < m; j++) {
      const t = r() < 0.5 && ar.length ? ar[Math.floor(r() * ar.length)] : Math.floor(r() * i);
      if (t !== i) ar.push(i, t);
    }
  }
  return new Int32Array(ar);
}

/** Reloj quieto: `avanzarCiclo` no corta por tiempo, solo por `maxPasos` o al asentarse. */
const relojQuieto = () => 0;
const cumulo = F.constantesCumulo();

function cicloDe(n, aristas, alpha, continuo = false) {
  const pos = new Float64Array(n * 2);
  C.sembrarFilotaxis(pos, Array.from({ length: n }, (_, i) => i), cumulo.k);
  const c = C.crearCiclo(F.crearEstado(n, pos, aristas), cumulo, continuo);
  C.calentar(c, alpha);
  return c;
}

test("asentarse: 300 pasos desde 1, ~170 desde la caché (0,05), ~250 con nodos nuevos (0,3)", () => {
  const aristas = grafoVault(60, 1);
  for (const [alpha, esperado] of [
    [1, 300],
    [C.ALPHA_CACHE, 170],
    [C.ALPHA_NUEVOS, 250],
  ]) {
    const c = cicloDe(60, aristas, alpha);
    const dados = C.avanzarCiclo(c, 1, relojQuieto);
    assert.equal(c.corriendo, false, `desde ${alpha} se asienta`);
    assert.ok(Math.abs(dados - esperado) <= 2, `desde ${alpha}: ${dados} pasos`);
    assert.equal(c.pasos, dados);
    assert.ok(c.alpha < F.ALPHA_MIN);
    // Asentado, no da más pasos.
    assert.equal(C.avanzarCiclo(c, 1, relojQuieto), 0);
  }
});

test("calentar no baja la energía y reinicia la cuenta de pasos solo si estaba quieto", () => {
  const c = cicloDe(40, grafoVault(40, 2), 1);
  C.avanzarCiclo(c, 1, relojQuieto, 10);
  const a = c.alpha;
  C.calentar(c, 0.05);
  assert.equal(c.alpha, a, "no la baja");
  assert.equal(c.pasos, 10, "seguía corriendo: la cuenta sigue");
  C.avanzarCiclo(c, 1, relojQuieto);
  C.calentar(c, 0.3);
  assert.equal(c.pasos, 0, "estaba quieto: cuenta de nuevo");
  assert.equal(c.alpha, 0.3);
});

test("arrastre: con el nodo fijo no se asienta; al soltar, sí, en ~300 pasos", () => {
  const c = cicloDe(80, grafoVault(80, 3), C.ALPHA_CACHE);
  C.fijar(c, 5, 400, -300);
  C.avanzarCiclo(c, 1, relojQuieto, 2000);
  assert.equal(c.corriendo, true, "mientras se arrastra sigue vivo");
  assert.ok(Math.abs(c.alpha - C.ALPHA_ARRASTRE) < 1e-3, `alpha ${c.alpha}`);
  assert.deepEqual([c.estado.pos[10], c.estado.pos[11]], [400, -300], "el fijo no se integra");
  C.soltar(c);
  assert.equal(c.estado.fijo, -1);
  const dados = C.avanzarCiclo(c, 1, relojQuieto);
  assert.equal(c.corriendo, false);
  assert.ok(dados > 200 && dados < 300, `de 0,3 a alphaMin: ${dados} pasos`);
});

test("simulación continua: nunca se asienta y la energía se queda en su piso", () => {
  const c = cicloDe(40, grafoVault(40, 4), 1, true);
  C.avanzarCiclo(c, 1, relojQuieto, 3000);
  assert.equal(c.corriendo, true);
  assert.ok(Math.abs(c.alpha - C.ALPHA_CONTINUO) < 1e-4, `alpha ${c.alpha}`);
});

test("avanzarCiclo respeta el presupuesto de tiempo (y da al menos un paso)", () => {
  const c = cicloDe(40, grafoVault(40, 5), 1);
  let t = 0;
  const reloj = () => t++; // cada lectura avanza 1 ms
  const dados = C.avanzarCiclo(c, 5, reloj);
  assert.ok(dados >= 1 && dados <= 6, `${dados} pasos en 5 ms`);
  assert.equal(C.avanzarCiclo(c, 0, reloj), 1, "sin presupuesto, igual da uno");
});

test("filotaxis: radio k/4·√i, ángulo áureo, sin amontonar", () => {
  const n = 2000;
  const pos = new Float64Array(n * 2);
  const orden = Array.from({ length: n }, (_, i) => n - 1 - i); // el orden manda, no el índice
  C.sembrarFilotaxis(pos, orden, 80);
  const u = (i) => orden[i];
  assert.deepEqual([pos[u(0) * 2], pos[u(0) * 2 + 1]], [0, 0], "el primero, en el origen");
  for (const i of [1, 10, 500, 1999]) {
    const r = Math.hypot(pos[u(i) * 2], pos[u(i) * 2 + 1]);
    assert.ok(Math.abs(r - 20 * Math.sqrt(i)) < 1e-9, `radio del ${i}`);
  }
  const a1 = Math.atan2(pos[u(1) * 2 + 1], pos[u(1) * 2]);
  assert.ok(Math.abs(a1 - Math.PI * (3 - Math.sqrt(5))) < 1e-9, "ángulo áureo");
  // Distancia mínima entre dos semillas cualesquiera: la filotaxis no deja pares pegados.
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      min = Math.min(min, Math.hypot(pos[i * 2] - pos[j * 2], pos[i * 2 + 1] - pos[j * 2 + 1]));
    }
  }
  assert.ok(min > 20 * 0.9, `distancia mínima ${min.toFixed(1)}`);
});

test("un hub de 400 enlaces no vibra con energía sostenida (inercia)", () => {
  // Estrella: el nodo 0 enlazado con todos. Sin normalizar, sus resortes
  // suman 0,01·400·alpha·ganancia = 12 a alpha 0,3 y el integrador diverge.
  // Normalizados (Parte G) casi no los siente, pero las 400 hojas lo empujan
  // desde todos lados: sin la masa por enlace saltaba 80 px por paso.
  const n = 401;
  const ar = [];
  for (let i = 1; i < n; i++) ar.push(0, i);
  const c = cicloDe(n, new Int32Array(ar), 1);
  C.avanzarCiclo(c, 1, relojQuieto);
  C.fijar(c, 7, 0, 600); // arrastre: alpha sostenida en 0,3
  let vmax = 0;
  for (let s = 0; s < 300; s++) {
    C.avanzarCiclo(c, 1, relojQuieto, 1);
    if (s > 100) vmax = Math.max(vmax, Math.hypot(c.estado.vel[0], c.estado.vel[1]));
  }
  for (let i = 0; i < n * 2; i++) assert.ok(Number.isFinite(c.estado.pos[i]));
  assert.ok(vmax < 20, `velocidad del hub ${vmax.toFixed(1)} px/paso`);
});

/** Radio RMS del cúmulo alrededor de su centroide. */
function radio(p) {
  const n = p.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += p[i * 2];
    cy += p[i * 2 + 1];
  }
  cx /= n;
  cy /= n;
  let r2 = 0;
  for (let i = 0; i < n; i++) r2 += (p[i * 2] - cx) ** 2 + (p[i * 2 + 1] - cy) ** 2;
  return Math.sqrt(r2 / n);
}

test("el layout asentado es del mismo tipo que el del ciclo de antes (radio ±5 %)", () => {
  // Réplica de la medición de la spec (Parte C) a escala de test: el ciclo
  // de antes (siembra en anillo, ×0,995, rozamiento 0,15, sin ganancia, 1.000
  // pasos) contra el de ahora (filotaxis, d3, ganancia) sobre el mismo grafo
  // y con las mismas fuerzas: el ciclo no cambia el tamaño.
  const n = 700;
  const aristas = grafoVault(n, 9);
  const azar = azarCon(3);
  const pv = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 50 + azar() * 90;
    pv[i * 2] = Math.cos(a) * r;
    pv[i * 2 + 1] = Math.sin(a) * r;
  }
  const viejo = F.crearEstado(n, pv, aristas);
  const antes = { ...cumulo, ganancia: 1, rozamiento: 0.15, velocidadMax: Infinity };
  let alpha = 1;
  for (let s = 0; s < 1000; s++) {
    F.paso(viejo, antes, alpha, azar);
    alpha = Math.max(alpha * 0.995, 0.02);
  }
  const c = cicloDe(n, aristas, 1);
  C.avanzarCiclo(c, 1, relojQuieto);
  const rv = radio(viejo.pos);
  const rn = radio(c.estado.pos);
  assert.ok(Math.abs(rn / rv - 1) < 0.05, `radio antes ${rv.toFixed(0)}, ahora ${rn.toFixed(0)}`);
});

test("Parte G: las fuerzas de d3 dejan el cúmulo del mismo tamaño que las de antes (±15 %)", () => {
  // Mismo ciclo (filotaxis, 300 pasos), fuerzas de antes contra las de ahora.
  // En los vaults reales: Tesina +7 %, Trabajo y Estudio +10 %, este repo +6 %;
  // este grafo sintético (casi todo enlazado) se achica: −7 %.
  const n = 700;
  const aristas = grafoVault(n, 9);
  const asentar = (constantes) => {
    const pos = new Float64Array(n * 2);
    C.sembrarFilotaxis(pos, Array.from({ length: n }, (_, i) => i), constantes.k);
    const c = C.crearCiclo(F.crearEstado(n, pos, aristas), constantes);
    C.calentar(c, 1);
    const dados = C.avanzarCiclo(c, 1, relojQuieto);
    return { r: radio(c.estado.pos), dados };
  };
  const antes = asentar(F.constantesAntes());
  const ahora = asentar(cumulo);
  assert.ok(Math.abs(ahora.r / antes.r - 1) < 0.15, `radio antes ${antes.r.toFixed(0)}, ahora ${ahora.r.toFixed(0)}`);
  assert.equal(ahora.dados, antes.dados, "los mismos pasos hasta asentarse");
});

// ── Parte E: precálculo a ciegas y física residual ──

test("precalcular: se asienta en ~300 pasos aunque la simulación sea continua", () => {
  const aristas = grafoVault(60, 11);
  for (const continuo of [false, true]) {
    const c = cicloDe(60, aristas, 0, continuo);
    c.corriendo = false;
    C.precalcular(c, 1);
    const dados = C.avanzarCiclo(c, 1, relojQuieto, 5000);
    assert.equal(c.corriendo, false, `continuo=${continuo}: termina`);
    assert.ok(Math.abs(dados - 300) <= 2, `${dados} pasos`);
  }
});

test("residual: fija la energía (también la baja) y vuelve al objetivo de siempre", () => {
  const c = cicloDe(40, grafoVault(40, 12), 1);
  C.fijar(c, 3, 100, 100);
  C.avanzarCiclo(c, 1, relojQuieto, 50);
  C.soltar(c);
  C.residual(c, C.ALPHA_CACHE);
  assert.equal(c.alpha, C.ALPHA_CACHE, "tras el arrastre la baja a 0,05");
  assert.equal(c.objetivo, 0);
  const dados = C.avanzarCiclo(c, 1, relojQuieto);
  assert.ok(Math.abs(dados - 170) <= 2, `${dados} pasos desde 0,05`);
  // Quieto, la sube y cuenta de nuevo.
  C.residual(c, C.ALPHA_CACHE);
  assert.equal(c.corriendo, true);
  assert.equal(c.pasos, 0);
  // Con la simulación continua, el objetivo es su piso y no se asienta.
  const k = cicloDe(40, grafoVault(40, 13), 0, true);
  C.precalcular(k, 1);
  C.avanzarCiclo(k, 1, relojQuieto, 5000);
  C.residual(k, C.ALPHA_CACHE);
  assert.equal(k.objetivo, C.ALPHA_CONTINUO);
  C.avanzarCiclo(k, 1, relojQuieto, 1000);
  assert.equal(k.corriendo, true);
});

test("residual tras el precálculo: movimiento apenas perceptible, sin saltos entre pasos", () => {
  // Criterio 2 de la Parte E: después del revelado el grafo se mueve poco,
  // y a un paso por frame ningún paso es un salto. Medido (1.000 nodos):
  // 170 pasos, salto máximo 3,1 px por paso (k = 80: a zoom 0,35, un píxel
  // de pantalla por frame), desplazamiento medio 16 px en 2,8 s a 60 fps. El
  // precálculo se detiene al enfriarse, no en el equilibrio exacto: lo que
  // queda lo recorre la residual, despacio.
  const n = 1000;
  const c = cicloDe(n, grafoVault(n, 14), 0);
  c.corriendo = false;
  C.precalcular(c, 1);
  C.avanzarCiclo(c, 1, relojQuieto);
  const inicio = Float64Array.from(c.estado.pos);
  C.residual(c, C.ALPHA_CACHE);
  let saltoMax = 0;
  let previo = Float64Array.from(c.estado.pos);
  let pasos = 0;
  while (c.corriendo) {
    C.avanzarCiclo(c, 0, relojQuieto, 1); // lo que hace un pedido del hilo principal
    pasos++;
    const p = c.estado.pos;
    for (let i = 0; i < n; i++) {
      saltoMax = Math.max(saltoMax, Math.hypot(p[i * 2] - previo[i * 2], p[i * 2 + 1] - previo[i * 2 + 1]));
    }
    previo = Float64Array.from(p);
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += Math.hypot(previo[i * 2] - inicio[i * 2], previo[i * 2 + 1] - inicio[i * 2 + 1]);
  }
  assert.ok(Math.abs(pasos - 170) <= 2);
  assert.ok(saltoMax < 5, `salto máximo ${saltoMax.toFixed(2)} px por paso`);
  assert.ok(total / n < 25, `desplazamiento medio ${(total / n).toFixed(2)} px`);
});
