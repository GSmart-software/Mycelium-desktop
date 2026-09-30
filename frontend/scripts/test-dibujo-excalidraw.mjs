// Test del generador de dibujos `.excalidraw` que viaja con la skill
// `mycelium-excalidraw` (`FUN-L-26`): lo que produce tiene que pasar el validador
// sin avisos, y modificar un dibujo no puede romper sus flechas.
//
//   node --test scripts/test-dibujo-excalidraw.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Dibujo, centro, tamanoPara } from "./dibujo-excalidraw.mjs";
import { validar } from "./validar-excalidraw.mjs";

const limpio = (d) => {
  const r = validar(JSON.stringify({ type: "excalidraw", version: 2, elements: d.elementos, appState: {}, files: {} }));
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, []);
};

/** Flujo vertical con un retorno por afuera, como la receta de la skill. */
function flujo() {
  const d = new Dibujo();
  const ini = d.caja("Inicio", 300, 170, { forma: "ellipse" });
  const rec = d.junto(ini, "abajo", "Recibir pedido");
  const dec = d.junto(rec, "abajo", "¿Hay stock?", { forma: "diamond" });
  const env = d.junto(dec, "abajo", "Preparar envío", { sep: 120 });
  const pro = d.junto(dec, "derecha", "Pedir al\nproveedor", { sep: 160 });
  d.flecha(ini, rec); d.flecha(rec, dec); d.flecha(dec, env, { etiqueta: "sí" }); d.flecha(dec, pro, { etiqueta: "no" });
  const cp = centro(pro), cr = centro(rec), xr = pro.x + pro.width + 60;
  const ret = d.flecha(pro, rec, { via: [{ x: xr, y: cp.y }, { x: xr, y: cr.y }], etiqueta: "cuando\nllega" });
  return { d, ini, rec, dec, env, pro, ret };
}

const ortogonal = (a) => a.points.slice(1).every((p, i) => p[0] === a.points[i][0] || p[1] === a.points[i][1]);

test("caja: centro entero y tamaño par, aunque el centro pedido tenga decimales", () => {
  const d = new Dibujo();
  const f = d.caja("Hola", 100.5, 200.25);
  assert.equal(f.width % 2, 0);
  assert.equal(f.height % 2, 0);
  assert.deepEqual(centro(f), { x: 101, y: 200 });
  const g = d.caja("Otra", 400, 200);
  const a = d.flecha(f, g);
  assert.equal(a.height, 0, "dos formas alineadas dan una flecha horizontal exacta");
});

test("junto: separa a la regla 6 entre bordes (o a sep)", () => {
  const { rec, dec, env, pro } = flujo();
  assert.equal(dec.y - (rec.y + rec.height), 50);
  assert.equal(env.y - (dec.y + dec.height), 120);
  assert.equal(pro.x - (dec.x + dec.width), 160);
  assert.equal(centro(pro).y, centro(dec).y);
});

test("el flujo de la receta pasa el validador sin avisos", () => {
  limpio(flujo().d);
});

test("mover una punta mantiene ortogonal un retorno con codos", () => {
  const { d, pro, rec, ret } = flujo();
  d.mover(pro, 0, 150);
  assert.ok(ortogonal(ret), JSON.stringify(ret.points));
  d.mover(rec, 0, -40);
  assert.ok(ortogonal(ret), JSON.stringify(ret.points));
  assert.equal(ret.y + ret.points.at(-1)[1], centro(rec).y);
});

test("mover varias formas juntas corre también los puntos intermedios entre ellas", () => {
  const { d, rec, pro, dec, ret } = flujo();
  const antes = d.via(ret);
  d.mover([rec, dec, pro], 100, 0);
  assert.deepEqual(d.via(ret), antes.map((p) => ({ x: p.x + 100, y: p.y })));
});

test("reconectar: binding, boundElements de las dos formas y trazo", () => {
  const { d, rec, dec, env } = flujo();
  const [f] = d.flechasEntre(rec, dec);
  d.reconectar(f, { hasta: env });
  assert.equal(f.endBinding.elementId, env.id);
  assert.ok(!dec.boundElements.some((b) => b.id === f.id));
  assert.ok(env.boundElements.some((b) => b.id === f.id));
  assert.ok(rec.boundElements.some((b) => b.id === f.id), "la punta que no cambia sigue enganchada");
  assert.equal(f.points.length, 2);
});

test("insertar un paso entre A y B (receta de la skill) deja el dibujo limpio", () => {
  const { d, rec, dec } = flujo();
  const [f] = d.flechasEntre(rec, dec);
  const hueco = dec.y - (rec.y + rec.height);
  const h = tamanoPara("rectangle", "Validar pago").h;
  d.mover(d.formas().filter((x) => centro(x).y > centro(rec).y), 0, h + hueco);
  const v = d.caja("Validar pago", centro(rec).x, rec.y + rec.height + hueco + h / 2);
  d.reconectar(f, { hasta: v });
  d.flecha(v, dec);
  limpio(d);
  assert.equal(dec.y - (v.y + v.height), hueco);
});

test("buscar ignora saltos de línea y espacios, y falla si hay dos iguales", () => {
  const { d, pro } = flujo();
  assert.equal(d.buscar("Pedir al proveedor"), pro);
  assert.equal(d.buscar("pedir  al\nPROVEEDOR"), pro);
  assert.equal(d.buscar("No existe"), undefined);
  d.caja("Pedir al proveedor", 900, 900);
  assert.throws(() => d.buscar("Pedir al proveedor"), /hay 2 textos iguales/);
});

test("Dibujo.desde: los ids nuevos siguen la numeración de los que ya hay", () => {
  const dir = mkdtempSync(join(tmpdir(), "dibujo-"));
  try {
    const { d } = flujo();
    const ruta = join(dir, "x.excalidraw");
    d.guardar(ruta);
    const maximo = Math.max(...d.elementos.map((e) => +/^[a-z]+-(\d+)-/.exec(e.id)[1]));
    const d2 = Dibujo.desde(ruta);
    const nueva = d2.caja("Nueva", 900, 170);
    assert.equal(+/^rectangle-(\d+)-/.exec(nueva.id)[1], maximo + 1);
    assert.deepEqual(JSON.parse(readFileSync(ruta, "utf8")).elements.length, d.elementos.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("marco: las flechas internas y sus etiquetas entran; las que cruzan el borde, no", () => {
  const d = new Dibujo();
  const fuera = d.caja("Navegador", 160, 360);
  const api = d.caja("API", 520, 240), db = d.caja("Base", 520, 480);
  const m = d.marco("Nube", [api, db], 50);
  const interna = d.flecha(api, db, { etiqueta: "SQL" });
  const cruza = d.flecha(fuera, api, { etiqueta: "HTTPS" });
  assert.equal(interna.frameId, m.id);
  assert.equal(d.textoDe(interna).frameId, m.id);
  assert.equal(cruza.frameId, null);
  assert.equal(d.textoDe(cruza).frameId, null);
  limpio(d);
  // meter una forma nueva al marco lo agranda y mete sus flechas internas
  const cache = d.caja("Caché", 880, 240);
  const lee = d.flecha(api, cache, { etiqueta: "lee" });
  assert.equal(lee.frameId, null);
  d.enMarco(m, [cache], 50);
  assert.equal(lee.frameId, m.id);
  assert.equal(m.x + m.width, cache.x + cache.width + 50);
  limpio(d);
});
