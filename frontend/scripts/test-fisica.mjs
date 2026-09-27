// Test headless (sin navegador ni Tauri) del motor de fuerzas del grafo
// (`FUN-L-25` · Parte B, `DEF-109`). El módulo bajo prueba
// (`components/graph/fisica.ts`) es puro —sin imports—, así que se transpila en
// el momento con el compilador de TypeScript y se importa vía data: URL.
//
// Lo que NO se prueba acá, porque necesita la app: el worker (`sim.worker.ts`),
// el dibujo de la capa estática y el flujo acotado. Eso lo confirma el usuario.
//
//   node --test scripts/test-fisica.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../components/graph/fisica.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const F = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

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

/** `n` nodos al azar en un disco de radio `radio`, y aristas a anteriores. */
function grafoAzar(n, radio, semilla, gradoMedio = 1.5) {
  const azar = azarCon(semilla);
  const pos = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = azar() * Math.PI * 2;
    const r = Math.sqrt(azar()) * radio;
    pos[i * 2] = Math.cos(a) * r;
    pos[i * 2 + 1] = Math.sin(a) * r;
  }
  const ar = [];
  for (let i = 1; i < n; i++) {
    const m = Math.floor(azar() * gradoMedio * 2);
    for (let j = 0; j < m; j++) ar.push(i, Math.floor(azar() * i));
  }
  return { pos, aristas: new Int32Array(ar) };
}

/** Fuerza de repulsión por nodo (lo que la repulsión suma a `vel` desde cero). */
function fuerzas(pos, aristas, c, metodo, alpha = 0.5) {
  const e = F.crearEstado(pos.length / 2, Float64Array.from(pos), aristas);
  metodo(e, c, alpha, azarCon(1));
  return e.vel;
}

const cumulo = F.constantesCumulo();

test("constantes: el cúmulo conserva las fuerzas de siempre", () => {
  assert.deepEqual(
    { k: cumulo.k, tope: cumulo.topeRepulsion, factor: cumulo.factorRepulsion, theta: cumulo.theta },
    { k: 80, tope: 8, factor: 1, theta: 0.9 },
  );
  // Parte C: el ciclo de `d3-force` (rozamiento 0,4) con la ganancia que lo
  // compensa, y el tope de velocidad en `k`.
  assert.deepEqual(
    { g: cumulo.ganancia, roz: cumulo.rozamiento, vmax: cumulo.velocidadMax },
    { g: 12, roz: 0.4, vmax: 80 },
  );
});

test("enfriar: como d3-force, de 1 a alphaMin en 300 pasos y hacia el objetivo", () => {
  assert.ok(Math.abs(F.ALPHA_DECAY - (1 - Math.pow(0.001, 1 / 300))) < 1e-15);
  assert.equal(F.ALPHA_MIN, 0.001);
  let a = 1;
  for (let i = 0; i < 300; i++) a = F.enfriar(a);
  assert.ok(Math.abs(a - 0.001) < 1e-9, `alpha tras 300 pasos: ${a}`);
  // Con objetivo 0,3 (arrastre) se acerca a 0,3 desde arriba y desde abajo.
  let b = 1;
  let c = 0;
  for (let i = 0; i < 2000; i++) {
    b = F.enfriar(b, 0.3);
    c = F.enfriar(c, 0.3);
  }
  assert.ok(Math.abs(b - 0.3) < 1e-6 && Math.abs(c - 0.3) < 1e-6);
});

test("Barnes-Hut con θ = 0 es exactamente la repulsión de pares", () => {
  const { pos, aristas } = grafoAzar(400, 900, 3);
  const c = { ...cumulo, theta: 0 };
  const a = fuerzas(pos, aristas, c, F.repulsionPares);
  const b = fuerzas(pos, aristas, c, F.repulsionBarnesHut);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-9, `componente ${i}`);
});

/** Error relativo global ‖F_bh − F_pares‖ / ‖F_pares‖ y sesgo proyectado sobre F_pares. */
function errorContraPares(a, b) {
  let err = 0;
  let norma = 0;
  let proy = 0;
  for (let i = 0; i < a.length; i++) {
    err += (a[i] - b[i]) ** 2;
    norma += a[i] ** 2;
    proy += a[i] * b[i];
  }
  return { rel: Math.sqrt(err / norma), sesgo: (proy - norma) / norma };
}

test("Barnes-Hut aproxima la repulsión de pares en 1.000 nodos, y converge con θ", () => {
  // Distribución como la de un cúmulo asentado (radio ≈ 40·√n).
  const { pos, aristas } = grafoAzar(1000, 1260, 7);
  const a = fuerzas(pos, aristas, cumulo, F.repulsionPares);
  // θ = 0,9 (el del motor, como d3-force): ~6 % de error por componente y un
  // sesgo de −2 % (una celda lejana empuja algo menos que sus nodos sueltos).
  // Medido en la réplica: el cúmulo asentado queda un 2 % más chico.
  const b = errorContraPares(a, fuerzas(pos, aristas, cumulo, F.repulsionBarnesHut));
  assert.ok(b.rel < 0.08, `error relativo con θ = 0,9: ${b.rel}`);
  assert.ok(Math.abs(b.sesgo) < 0.03, `sesgo con θ = 0,9: ${b.sesgo}`);
  // Con θ más chico el error baja: la aproximación es correcta, no un atajo.
  const fino = errorContraPares(a, fuerzas(pos, aristas, { ...cumulo, theta: 0.5 }, F.repulsionBarnesHut));
  assert.ok(fino.rel < 0.02, `error relativo con θ = 0,5: ${fino.rel}`);
  assert.ok(fino.rel < b.rel);
});

test("distanciaMax: más allá del corte no hay repulsión; adentro, la misma", () => {
  const c = { ...cumulo, theta: 0, distanciaMax: 300 };
  // Dos nodos a 200 (adentro) y uno a 1.000 (afuera de los dos).
  const pos = new Float64Array([0, 0, 200, 0, 0, 1000]);
  const vel = fuerzas(pos, new Int32Array(0), c, F.repulsionBarnesHut, 1);
  const f = Math.min((80 * 80) / (200 * 200), 8);
  assert.ok(Math.abs(vel[0] + f) < 1e-12, "el 0 empujado hacia −x por el 1");
  assert.ok(Math.abs(vel[1]) < 1e-12, "el 2 está fuera del corte: no empuja al 0");
  assert.ok(Math.abs(vel[2] - f) < 1e-12);
  assert.equal(vel[4], 0);
  assert.equal(vel[5], 0);

  // Con Barnes-Hut y muchos nodos, el corte coincide con los pares filtrados a mano.
  const { pos: p2, aristas } = grafoAzar(600, 1500, 11);
  const c2 = { ...cumulo, theta: 0.5, distanciaMax: 500 };
  const bh = fuerzas(p2, aristas, c2, F.repulsionBarnesHut);
  const ref = new Float64Array(p2.length);
  for (let i = 0; i < 600; i++)
    for (let j = 0; j < 600; j++) {
      if (i === j) continue;
      const dx = p2[i * 2] - p2[j * 2];
      const dy = p2[i * 2 + 1] - p2[j * 2 + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 >= 500 * 500) continue;
      const d = Math.sqrt(d2);
      const f2 = Math.min(6400 / d2, 8) * 0.5;
      ref[i * 2] += (dx / d) * f2;
      ref[i * 2 + 1] += (dy / d) * f2;
    }
  let err = 0;
  let norma = 0;
  for (let i = 0; i < ref.length; i++) {
    err += (ref[i] - bh[i]) ** 2;
    norma += ref[i] ** 2;
  }
  assert.ok(Math.sqrt(err / norma) < 0.02, `error ${Math.sqrt(err / norma)}`);
});

test("determinismo: misma entrada y misma semilla, mismo layout", () => {
  const correr = () => {
    const { pos, aristas } = grafoAzar(500, 300, 5);
    const e = F.crearEstado(500, pos, aristas, 0);
    const azar = azarCon(9);
    let alpha = 1;
    for (let s = 0; s < 120; s++) {
      F.paso(e, cumulo, alpha, azar);
      alpha = F.enfriar(alpha);
    }
    return e.pos;
  };
  assert.deepEqual(correr(), correr());
});

test("paso() con pares y las constantes de antes reproduce el simulate() de antes, número por número", () => {
  // Réplica literal del `simulate()` que vivía en MiniGraph.tsx (objetos).
  const viejo = (sim, edges, alpha, azar, centroId, drag) => {
    const k = 80;
    for (let i = 0; i < sim.length; i++) {
      const a = sim[i];
      for (let j = i + 1; j < sim.length; j++) {
        const b = sim[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = azar() - 0.5;
          dy = azar() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = Math.min((k * k) / d2, 8) * 1 * alpha;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const dx = e.t.x - e.s.x;
      const dy = e.t.y - e.s.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = ((d - k) / d) * 0.02 * alpha * 10;
      e.s.vx += dx * f * 0.05;
      e.s.vy += dy * f * 0.05;
      e.t.vx -= dx * f * 0.05;
      e.t.vy -= dy * f * 0.05;
    }
    for (const n of sim) {
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      if (n === drag) continue;
      if (n.id === centroId) {
        n.vx -= n.x * 0.05;
        n.vy -= n.y * 0.05;
      }
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x += n.vx;
      n.y += n.vy;
    }
  };
  const { pos, aristas } = grafoAzar(150, 200, 21);
  const sim = Array.from({ length: 150 }, (_, i) => ({
    id: String(i),
    x: pos[i * 2],
    y: pos[i * 2 + 1],
    vx: 0,
    vy: 0,
  }));
  const edges = [];
  for (let a = 0; a < aristas.length; a += 2) edges.push({ s: sim[aristas[a]], t: sim[aristas[a + 1]] });
  const e = F.crearEstado(150, Float64Array.from(pos), aristas, 0);
  e.fijo = 5;
  const az1 = azarCon(4);
  const az2 = azarCon(4);
  // Las constantes de antes de la Parte C: sin ganancia, rozamiento 0,15 (×0,85)
  // y sin tope de velocidad; y el enfriamiento de entonces (×0,995, piso 0,02).
  const antes = { ...cumulo, ganancia: 1, rozamiento: 0.15, velocidadMax: Infinity };
  let alpha = 1;
  for (let s = 0; s < 60; s++) {
    viejo(sim, edges, alpha, az1, "0", sim[5]);
    F.paso(e, antes, alpha, az2, F.repulsionPares);
    alpha = Math.max(alpha * 0.995, 0.02);
  }
  for (let i = 0; i < 150; i++) {
    assert.ok(Math.abs(sim[i].x - e.pos[i * 2]) < 1e-6, `x del nodo ${i}`);
    assert.ok(Math.abs(sim[i].y - e.pos[i * 2 + 1]) < 1e-6, `y del nodo ${i}`);
  }
});

test("nodos superpuestos se separan (desempate al azar en la hoja)", () => {
  const pos = new Float64Array([10, 10, 10, 10, 10, 10, 300, 0]);
  const e = F.crearEstado(4, pos, new Int32Array(0));
  const azar = azarCon(2);
  for (let s = 0; s < 20; s++) F.paso(e, cumulo, 0.5, azar);
  const d01 = Math.hypot(e.pos[0] - e.pos[2], e.pos[1] - e.pos[3]);
  const d12 = Math.hypot(e.pos[2] - e.pos[4], e.pos[3] - e.pos[5]);
  assert.ok(d01 > 5 && d12 > 5, `siguen pegados: ${d01}, ${d12}`);
});

test("activos, fijo y centro: solo se mueve lo que participa", () => {
  const { pos, aristas } = grafoAzar(50, 200, 13);
  const e = F.crearEstado(50, Float64Array.from(pos), aristas, 3);
  e.activos = new Uint8Array(50).fill(1);
  e.activos[7] = 0;
  e.fijo = 9;
  // Energía efectiva 0,5 (con la ganancia, `alpha · ganancia`): la de antes.
  for (let s = 0; s < 30; s++) F.paso(e, cumulo, 0.5 / cumulo.ganancia);
  assert.equal(e.pos[14], pos[14]);
  assert.equal(e.pos[15], pos[15]);
  assert.equal(e.pos[18], pos[18], "el arrastrado no se integra");
  assert.equal(e.pos[19], pos[19]);
  assert.ok(Math.hypot(e.pos[6], e.pos[7]) < Math.hypot(pos[6], pos[7]), "el centro va al origen");
  assert.ok(e.pos[0] !== pos[0], "los activos se mueven");
});

test("el árbol crece: miles de nodos apretados y uno lejísimos", () => {
  const n = 5000;
  const azar = azarCon(8);
  const pos = new Float64Array(n * 2);
  for (let i = 0; i < n - 1; i++) {
    pos[i * 2] = azar() * 1e-3;
    pos[i * 2 + 1] = azar() * 1e-3;
  }
  pos[(n - 1) * 2] = 1e7;
  const e = F.crearEstado(n, pos, new Int32Array(0));
  F.paso(e, cumulo, 0.1, azar);
  for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(e.pos[i]));
});

test("2.000 nodos: Barnes-Hut es varias veces más rápido que los pares", () => {
  const { pos, aristas } = grafoAzar(2000, 1800, 17);
  const medir = (metodo) => {
    const e = F.crearEstado(2000, Float64Array.from(pos), aristas);
    for (let s = 0; s < 3; s++) metodo(e, cumulo, 0.5);
    const t0 = performance.now();
    for (let s = 0; s < 10; s++) metodo(e, cumulo, 0.5);
    return (performance.now() - t0) / 10;
  };
  const pares = medir(F.repulsionPares);
  const bh = medir(F.repulsionBarnesHut);
  assert.ok(bh * 2 < pares, `pares ${pares.toFixed(1)} ms, Barnes-Hut ${bh.toFixed(1)} ms`);
});
