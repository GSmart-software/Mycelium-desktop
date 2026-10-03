// Las piezas puras de la prueba gratis (eval/repetir-busquedas.mjs).
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { emparejar, llamadasMcp, medir, refPorTitulo, refsDeRespuesta } from "../repetir-busquedas.mjs";

test("repetir: las refs salen de la respuesta en orden, con espacios en la ruta", () => {
  const t = "3 resultados · mostrando 3\n\n[1] docs/estado/Version 2.1.0.md#s5 · Novedades\n    …x\n\n[2] docs/a.md#s12 · B\n\n[10] docs/c.md#s0\n";
  assert.deepEqual(refsDeRespuesta(t), ["docs/estado/Version 2.1.0.md#s5", "docs/a.md#s12", "docs/c.md#s0"]);
  assert.deepEqual(refsDeRespuesta("0 resultados para «x»"), []);
  assert.equal(refPorTitulo("docs/estado/Version 2.1.0.md#s5"), "Version 2.1.0#s5");
});

test("repetir: cada búsqueda de la transcripción se empareja con su línea del registro, una a una", () => {
  const e = (id, consulta, ts) => JSON.stringify({ type: "assistant", timestamp: new Date(ts).toISOString(), message: { content: [{ type: "tool_use", id, name: "mcp__mycelium__vault_buscar", input: { consulta } }] } });
  const texto = [e("a", "x y", 1000), e("a", "x y", 1000), e("b", "x y", 50_000)].join("\n");
  const ll = llamadasMcp(texto);
  assert.equal(ll.length, 2, "sin repetir el mismo tool_use");
  const reg = [{ consulta: "x y", ts: 51_000, n: 2 }, { consulta: "x y", ts: 1_500, n: 1 }, { consulta: "otra", ts: 1_000 }];
  assert.deepEqual(emparejar(ll, reg).map((c) => c.registro?.n), [1, 2]);
});

test("repetir: top 10 contra las secciones oro, vacías y por pregunta", () => {
  const b = (pregunta, refs) => ({ pregunta, refs, texto: "x".repeat(40) });
  const m = medir([
    b("D08", ["docs/features/titulo-renombra.md#s4"]),
    b("D08", Array.from({ length: 10 }, (_, i) => `docs/n${i}.md#s1`).concat(["docs/features/titulo-renombra.md#s4"])),
    b("D08", ["docs/features/titulo-renombra.md#s2"]),
    b("D09", []),
  ]);
  assert.equal(m.conOro, 3, "D09 no tiene sección oro");
  assert.equal(m.top10, 1, "la del puesto 11 no cuenta");
  assert.equal(m.notaTop10, 2);
  assert.equal(m.vacias, 1);
  assert.deepEqual(m.porPregunta.D08, { n: 3, top10: 1, vacias: 0 });
  assert.equal(m.tokensMediana, 10);
});
