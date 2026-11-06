// Test de la navegación con el teclado dentro de los componentes (`FUN-XL-04`,
// Parte 7): el vecino por dirección (grafo y lienzo), la grilla del calendario,
// las filas de una tabla, las pestañas y los divisores de tamaño
// (`lib/teclado/navegacion.ts`).
//
// El módulo se transpila en el momento, como en `scripts/test-teclado-zonas.mjs`.
//
//   node --test scripts/test-teclado-componentes.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

async function cargar(ruta) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  const { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript,${encodeURIComponent(outputText)}`);
}

const nav = await cargar("../lib/teclado/navegacion.ts");

test("direccionDeTecla: solo las flechas", () => {
  assert.equal(nav.direccionDeTecla("ArrowLeft"), "izquierda");
  assert.equal(nav.direccionDeTecla("ArrowRight"), "derecha");
  assert.equal(nav.direccionDeTecla("ArrowUp"), "arriba");
  assert.equal(nav.direccionDeTecla("ArrowDown"), "abajo");
  assert.equal(nav.direccionDeTecla("Enter"), null);
});

test("vecinoEnDireccion: el alineado gana al cercano de costado", () => {
  const o = { x: 0, y: 0 };
  const alineado = { id: "a", x: 100, y: 5 };
  const costado = { id: "b", x: 40, y: 60 };
  assert.equal(nav.vecinoEnDireccion(o, [costado, alineado], "derecha").id, "a");
});

test("vecinoEnDireccion: nada del otro lado, ni uno mismo", () => {
  const o = { x: 0, y: 0 };
  const yo = { id: "yo", x: 0, y: 0 };
  const izq = { id: "i", x: -50, y: 0 };
  assert.equal(nav.vecinoEnDireccion(o, [yo, izq], "derecha"), null);
  assert.equal(nav.vecinoEnDireccion(o, [yo, izq], "izquierda").id, "i");
});

test("vecinoEnDireccion: y crece hacia abajo; fuera del cono si no hay otro", () => {
  const o = { x: 0, y: 0 };
  const abajo = { id: "ab", x: 0, y: 80 };
  const arriba = { id: "ar", x: 10, y: -80 };
  assert.equal(nav.vecinoEnDireccion(o, [abajo, arriba], "abajo").id, "ab");
  assert.equal(nav.vecinoEnDireccion(o, [abajo, arriba], "arriba").id, "ar");
  // Casi todo hacia el costado: fuera del cono, pero es lo único de ese lado.
  const lejos = { id: "l", x: 300, y: -5 };
  assert.equal(nav.vecinoEnDireccion(o, [lejos], "arriba").id, "l");
});

test("masCercano", () => {
  assert.equal(nav.masCercano({ x: 0, y: 0 }, []), null);
  assert.equal(nav.masCercano({ x: 0, y: 0 }, [{ id: 1, x: 5, y: 5 }, { id: 2, x: 1, y: 1 }]).id, 2);
});

test("desplazamientoParaVer", () => {
  assert.deepEqual(nav.desplazamientoParaVer({ left: 50, top: 50, right: 100, bottom: 100 }, 500, 500), { dx: 0, dy: 0 });
  assert.deepEqual(nav.desplazamientoParaVer({ left: 480, top: 50, right: 560, bottom: 100 }, 500, 500), {
    dx: 500 - 24 - 560,
    dy: 0,
  });
  assert.deepEqual(nav.desplazamientoParaVer({ left: -100, top: -10, right: -20, bottom: 30 }, 500, 500), {
    dx: 124,
    dy: 34,
  });
});

test("pasoDeCalendario: días, semanas, fila y meses", () => {
  assert.deepEqual(nav.pasoDeCalendario("ArrowLeft", 3), { dias: -1 });
  assert.deepEqual(nav.pasoDeCalendario("ArrowDown", 3), { dias: 7 });
  assert.deepEqual(nav.pasoDeCalendario("ArrowUp", 3), { dias: -7 });
  assert.deepEqual(nav.pasoDeCalendario("Home", 3), { dias: -3 });
  assert.deepEqual(nav.pasoDeCalendario("End", 3), { dias: 3 });
  assert.deepEqual(nav.pasoDeCalendario("PageDown", 0), { meses: 1 });
  assert.deepEqual(nav.pasoDeCalendario("PageUp", 0, true), { meses: -12 });
  assert.equal(nav.pasoDeCalendario("a", 0), null);
});

test("pasoDeLista: sin vuelta, con páginas", () => {
  assert.equal(nav.pasoDeLista(0, 5, "ArrowUp"), 0);
  assert.equal(nav.pasoDeLista(4, 5, "ArrowDown"), 4);
  assert.equal(nav.pasoDeLista(2, 5, "ArrowDown"), 3);
  assert.equal(nav.pasoDeLista(2, 5, "Home"), 0);
  assert.equal(nav.pasoDeLista(2, 5, "End"), 4);
  assert.equal(nav.pasoDeLista(2, 50, "PageDown"), 12);
  assert.equal(nav.pasoDeLista(2, 50, "PageUp"), 0);
  assert.equal(nav.pasoDeLista(0, 0, "ArrowDown"), null);
  assert.equal(nav.pasoDeLista(0, 5, "Enter"), null);
});

test("pasoDePestanas: con vuelta", () => {
  assert.equal(nav.pasoDePestanas(0, 4, "ArrowLeft"), 3);
  assert.equal(nav.pasoDePestanas(3, 4, "ArrowRight"), 0);
  assert.equal(nav.pasoDePestanas(1, 4, "End"), 3);
  assert.equal(nav.pasoDePestanas(1, 4, "ArrowDown"), null);
  assert.equal(nav.pasoDePestanas(1, 4, "ArrowDown", true), 2);
});

test("valorDeSeparador: ejes, Shift, invertido y límites", () => {
  const s = { valor: 240, min: 160, max: 480, orientacion: "vertical", paso: 10, pasoGrande: 50 };
  assert.equal(nav.valorDeSeparador(s, "ArrowRight"), 250);
  assert.equal(nav.valorDeSeparador(s, "ArrowLeft", true), 190);
  assert.equal(nav.valorDeSeparador(s, "ArrowUp"), null);
  assert.equal(nav.valorDeSeparador(s, "Home"), 160);
  assert.equal(nav.valorDeSeparador(s, "End"), 480);
  assert.equal(nav.valorDeSeparador({ ...s, valor: 470 }, "ArrowRight", true), 480);
  assert.equal(nav.valorDeSeparador({ ...s, invertido: true }, "ArrowLeft"), 250);
  const h = { valor: 300, min: 120, max: 600, orientacion: "horizontal", invertido: true, paso: 10, pasoGrande: 50 };
  assert.equal(nav.valorDeSeparador(h, "ArrowUp"), 310);
  assert.equal(nav.valorDeSeparador(h, "ArrowDown"), 290);
  assert.equal(nav.valorDeSeparador(h, "ArrowLeft"), null);
});

// ── los niveles (rediseño del 2026-11-06) ─────────────────────────────────

const niv = await cargar("../lib/teclado/niveles.ts");

test("lienzo, grafo, calendario y tablas: Alt+flechas navega como las flechas dentro del documento", () => {
  const e = (m = {}) => ({ ctrlKey: false, altKey: false, metaKey: false, ...m });
  // Dentro de la pestaña: flechas y Alt+flechas, lo mismo.
  assert.equal(niv.flechaDelComponente(e(), true), true);
  assert.equal(niv.flechaDelComponente(e({ altKey: true }), true), true);
  // Ctrl+flechas no es del recorrido (en el lienzo, mueve la tarjeta).
  assert.equal(niv.flechaDelComponente(e({ ctrlKey: true }), true), false);
  // El mini-grafo del panel de enlaces está en una sección: Alt+flechas sale.
  assert.equal(niv.flechaDelComponente(e({ altKey: true }), false), false);
  assert.equal(niv.flechaDelComponente(e(), false), true);
});

test("dentro del documento, entre tarjetas: el vecino por cajas sigue la vista", () => {
  const c = (id, l, t, r, b) => ({ id, caja: { left: l, top: t, right: r, bottom: b } });
  const tarjetas = [c("a", 0, 0, 100, 60), c("b", 200, 0, 300, 60), c("c", 0, 200, 100, 260), c("d", 220, 180, 320, 240)];
  const ir = (id, dir) => {
    const o = tarjetas.find((x) => x.id === id);
    return niv.vecinoPorCajas(o.caja, tarjetas.filter((x) => x !== o), dir)?.id ?? null;
  };
  assert.equal(ir("a", "derecha"), "b");
  assert.equal(ir("a", "abajo"), "c");
  assert.equal(ir("c", "derecha"), "d");
  assert.equal(ir("b", "abajo"), "d");
  assert.equal(ir("a", "arriba"), null);
});
