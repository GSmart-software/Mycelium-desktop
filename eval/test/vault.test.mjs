// Tests del arnés para más de un vault: el de Mycelium sigue con sus rutas de
// siempre; otro se describe con un JSON; la copia excluye lo que se pide y no
// toca el repo de origen; y la clase C9 (dato solo en un PDF).
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inventario, prepararCorpus, RAIZ_EVAL } from "../lib/corpus.mjs";
import { puntuar } from "../lib/puntuacion.mjs";
import { normalizar } from "../lib/texto.mjs";
import { cargarVault, EVAL, prepararCorpusDe, vaultDeArgs, vaultMycelium } from "../lib/vault.mjs";
import { puestoPorGrep, verificar } from "../verificar-claves.mjs";

test("sin --vault, el vault es el de Mycelium con las rutas de siempre", () => {
  const v = vaultDeArgs(["node", "x.mjs"], {});
  assert.equal(v.nombre, "mycelium");
  assert.equal(v.preguntas, join(EVAL, "preguntas.jsonl"));
  assert.equal(v.resultados, join(EVAL, "resultados.jsonl"));
  assert.equal(v.juicios, join(EVAL, "juicios.jsonl"));
  assert.equal(v.corridas, join(EVAL, "corridas"));
  assert.equal(v.mcp_config, join(EVAL, "mcp.json"));
  assert.equal(v.raiz_corpus, join(RAIZ_EVAL, "corpus"));
  assert.deepEqual(v.excluir, ["eval"]);
  assert.equal(v.control, "checkout");
  assert.equal(v.regla, "§9");
  assert.equal(v.commit_vault, JSON.parse(readFileSync(join(EVAL, "config.json"), "utf8")).commit_vault);
  assert.deepEqual(v, vaultMycelium());
});

test("un vault descrito por JSON: rutas relativas a su carpeta y protocolo que pisa config.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "vault-json-"));
  try {
    const ruta = join(dir, "vault.json");
    writeFileSync(
      ruta,
      JSON.stringify({ nombre: "otro", repo: "C:\\algun\\repo", commit_vault: "abc1234", excluir: [".claude/metrics"], regla: "costo-y-tiempo", protocolo: { repeticiones: 3 } }),
    );
    for (const args of [["node", "x.mjs", "--vault", ruta], ["node", "x.mjs", `--vault=${ruta}`]]) {
      const v = vaultDeArgs(args, {});
      assert.equal(v.nombre, "otro");
      assert.equal(v.preguntas, join(dir, "preguntas.jsonl"));
      assert.equal(v.sello, join(dir, "sello.key"));
      assert.equal(v.app_mcp, join(dir, "app"));
      assert.equal(v.raiz_corpus, join(dir, "corpus"));
      assert.equal(v.control, "commit");
      assert.equal(v.regla, "costo-y-tiempo");
      assert.equal(v.config.repeticiones, 3);
      assert.equal(v.config.commit_vault, "abc1234");
      assert.equal(v.config.modelo_principal, vaultMycelium().config.modelo_principal);
    }
    assert.equal(vaultDeArgs(["node", "x.mjs"], { MYCELIUM_EVAL_VAULT: ruta }).nombre, "otro");
    writeFileSync(ruta, JSON.stringify({ nombre: "otro", repo: "x", commit_vault: "y", regla: "inventada" }));
    assert.throws(() => cargarVault(ruta), /regla/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(dir, ...args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("la copia sale del commit, excluye lo pedido y no toca el repo de origen", () => {
  const raiz = mkdtempSync(join(tmpdir(), "vault-copia-"));
  try {
    const repo = join(raiz, "repo");
    const archivos = {
      "CLAUDE.md": "control",
      ".claude/skills/mycelium-memoria/SKILL.md": "skill",
      ".claude/metrics/sesion.jsonl": "respuesta de una sesión vieja",
      ".claude/settings.json": "{}",
      "Notas/Una nota.md": "texto",
      "basura, con coma": "",
    };
    for (const [p, t] of Object.entries(archivos)) {
      mkdirSync(join(repo, p, ".."), { recursive: true });
      writeFileSync(join(repo, p), t);
    }
    git(raiz, "init", "-q", repo);
    git(repo, "add", "-A");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x");
    const sha = git(repo, "rev-parse", "HEAD");
    // Un cambio sin commitear no entra: la copia sale del commit.
    writeFileSync(join(repo, "Notas/Una nota.md"), "cambio sin commitear");
    const antes = git(repo, "status", "--porcelain");

    const json = join(raiz, "vault.json");
    writeFileSync(json, JSON.stringify({ nombre: "prueba", repo, commit_vault: sha, excluir: [".claude/metrics", ".claude/settings.json", "basura, con coma"] }));
    const c = prepararCorpusDe(cargarVault(json));
    assert.ok(c.dir.startsWith(join(raiz, "corpus")));
    assert.equal(readFileSync(join(c.dir, "CLAUDE.md"), "utf8"), "control");
    assert.equal(readFileSync(join(c.dir, "Notas/Una nota.md"), "utf8"), "texto");
    assert.ok(existsSync(join(c.dir, ".claude/skills/mycelium-memoria/SKILL.md")), "el control viene del commit");
    assert.ok(!existsSync(join(c.dir, ".claude/metrics")));
    assert.ok(!existsSync(join(c.dir, ".claude/settings.json")));
    assert.ok(!existsSync(join(c.dir, "basura, con coma")));
    assert.deepEqual(c.copiados, []);
    assert.ok(c.hash_skill_memoria);
    assert.equal(git(repo, "status", "--porcelain"), antes, "el repo de origen no cambió");
    // Reutiliza la copia: no la rehace.
    assert.equal(prepararCorpus({ repo, commit: sha, control: null, raiz: join(raiz, "corpus") }).preparado, c.preparado);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("C9 · la puntuación: como C7, y un PDF citado sin extensión no es una cita inventada", () => {
  const clave = {
    id: "X",
    clase: "C9",
    veredicto: "dato",
    aceptadas: ["dato del pdf"],
    notas_clave: [],
    notas_admisibles: ["Nota que resume el pdf"],
    fuentes_codigo: ["Docs/documentos/Un paper 2020.pdf"],
  };
  const ctx = { titulos: new Set(["Nota que resume el pdf"]), archivos: new Set(["Un paper 2020.pdf"]) };
  const p = puntuar(clave, { respuesta: "Es el dato del PDF.", citas: ["Un paper 2020"], no_esta: false }, ctx);
  assert.equal(p.citas_inventadas, 0);
  assert.equal(p.citas_precision, 1);
  assert.equal(p.acierto_citado, 1);
  const inventada = puntuar(clave, { respuesta: "Es el dato del PDF.", citas: ["Otro paper"], no_esta: false }, ctx);
  assert.equal(inventada.citas_inventadas, 1);
});

test("C9 · el verificador: el dato tiene que estar en el PDF y en ningún otro texto del vault", () => {
  const inv = { titulos: new Set(["Nota"]), archivos: new Set(), notas: new Map([["Nota", "x"]]) };
  const q = {
    id: "T1",
    clase: "C9",
    conjunto: "desarrollo",
    pregunta: "¿Cuánto?",
    fuente: { tipo: "estructura" },
    veredicto: "dato",
    dato: "42 qubits",
    aceptadas: ["42"],
    notas_clave: [],
    notas_admisibles: [],
    fuentes_codigo: ["Docs/p.pdf"],
    prueba_fuera_indice: "/42 qubits/",
  };
  const leerNota = () => "una nota sin el número";
  const leerPdf = () => "el paper dice 42 qubits";
  const opciones = { composicion: null, otrosTextos: () => [] };
  assert.deepEqual(verificar([q], inv, leerNota, leerPdf, "", opciones).errores, []);
  const enHtml = verificar([q], inv, leerNota, leerPdf, "", { ...opciones, otrosTextos: () => [{ t: "a.html", x: normalizar("son 42 qubits") }] });
  assert.ok(enHtml.errores.some((e) => /archivo de texto «a\.html»/.test(e)));
  const enNota = verificar([q], inv, () => "acá dice 42 qubits", leerPdf, "", opciones);
  assert.ok(enNota.errores.some((e) => /C9 pero la nota/.test(e)));
  const noPdf = verificar([{ ...q, fuentes_codigo: ["x.html"] }], inv, leerNota, leerPdf, "", opciones);
  assert.ok(noPdf.errores.some((e) => /no es un PDF/.test(e)));
});

test("C8 con `c8: encabezados`: vocabulario contra título y encabezados, y el puesto por grep", () => {
  const md = "## Capitulo largo\n\n### La espera en la fila\n\nnadie publica cuanto se tarda en atender un pedido remoto\n";
  const inv = { titulos: new Set(["Capitulo largo"]), archivos: new Set(), notas: new Map([["Capitulo largo", "x"]]) };
  const base = {
    id: "C8a", clase: "C8", conjunto: "desarrollo", fuente: { tipo: "estructura" }, veredicto: "dato", dato: "nadie publica",
    aceptadas: ["nadie publica"], notas_clave: ["Capitulo largo"], notas_admisibles: ["Capitulo largo"],
    secciones_clave: ["Capitulo largo > Capitulo largo > La espera en la fila"],
  };
  const otras = Array.from({ length: 12 }, (_, i) => ({ t: `Docs/otra ${i}.md`, x: normalizar("demora remoto pedido atender") }));
  const notas = () => [{ t: "Docs/Capitulo largo.md", x: normalizar(md) }, ...otras];
  const opciones = { composicion: null, c8: "encabezados", todasLasNotas: notas };
  // Comparte «espera» con el encabezado: error, aunque el texto no importe en este modo.
  const r1 = verificar([{ ...base, pregunta: "¿Cuánta espera hay?" }], inv, () => md, () => "", "", opciones);
  assert.ok(r1.errores.some((e) => /comparte vocabulario/.test(e)));
  // Sin palabras del encabezado, pero doce notas le ganan por grep: puesto 13, pasa con aviso.
  const r2 = verificar([{ ...base, pregunta: "¿Cuánto demora que atiendan un pedido remoto?" }], inv, () => md, () => "", "", opciones);
  assert.deepEqual(r2.errores, []);
  assert.ok(r2.avisos.some((a) => /puesto 13/.test(a)));
  // Con tope 20, el mismo puesto es un error.
  const r3 = verificar([{ ...base, pregunta: "¿Cuánto demora que atiendan un pedido remoto?" }], inv, () => md, () => "", "", { ...opciones, c8Puesto: 20 });
  assert.ok(r3.errores.some((e) => /puesto 13/.test(e)));
  // Los empates cuentan en contra; una nota que no existe queda en el infinito.
  assert.equal(puestoPorGrep(new Set(["a", "b"]), [{ t: "x.md", x: "a b" }, { t: "y.md", x: "a b" }], "y"), 2);
  assert.equal(puestoPorGrep(new Set(["a"]), [{ t: "x.md", x: "a" }], "z"), Infinity);
});

test("la composición del vault de Mycelium se sigue exigiendo por defecto; otro vault puede no declararla", () => {
  const inv = { titulos: new Set(), archivos: new Set(), notas: new Map() };
  assert.ok(verificar([], inv, () => "", () => "", "").errores.some((e) => /C1: 0 de desarrollo/.test(e)));
  assert.ok(!verificar([], inv, () => "", () => "", "").errores.some((e) => /C9/.test(e)), "C9 no es parte de la composición de Mycelium");
  assert.deepEqual(verificar([], inv, () => "", () => "", "", { composicion: null }).errores, []);
  assert.ok(inventario(EVAL).rutas.length > 0);
});
