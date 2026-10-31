// Tests del hook que avisa de las referencias sin enlazar (`FUN-S-10`).
//
//   node scripts/test-hook-referencias.mjs
//
// El script del hook es la fuente de verdad (`scripts/hook-referencias.mjs`): se
// importa tal cual y se prueba su detección con un disco de mentira. Al final,
// una corrida de punta a punta en un vault temporal, con el JSON que manda
// Claude Code por stdin.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hook = await import(new URL("./hook-referencias.mjs", import.meta.url).href);

const LEXICO = JSON.stringify({
  version: 1,
  destinos: {
    "HU/HU-009 Gestion de usuarios.md": { titulo: "HU-009 Gestion de usuarios", formas: ["HU-009", "HU009"] },
    "Plan.md": { titulo: "Plan", formas: ["Plan"] },
  },
  descartadas: [{ forma: "Estado", motivo: "palabra común" }],
});
const FORMAS = hook.formasDelLexico(LEXICO);
const DISCO = new Set(["docs/Otra.md", "Plan.md", "HU/HU-009 Gestion de usuarios.md", "docs/sub/Hondo.md"]);
const detectar = (texto, extra = {}) =>
  hook.detectar({ texto, nota: "docs/Nota.md", formas: FORMAS, existe: (r) => DISCO.has(r), ...extra });
const sugerencias = (texto, extra) => detectar(texto, extra).map((r) => [r.original, r.sugerencia]);

test("un enlace Markdown a una nota del vault se avisa con su forma [[…]]", () => {
  assert.deepEqual(sugerencias("Ver [Otra](Otra.md)."), [["[Otra](Otra.md)", "[[Otra]]"]]);
  assert.deepEqual(sugerencias("Ver [la otra](Otra.md)."), [["[la otra](Otra.md)", "[[Otra|la otra]]"]]);
  // Relativo a la carpeta de la nota, a una subcarpeta y a la raíz.
  assert.deepEqual(sugerencias("[x](sub/Hondo.md)"), [["[x](sub/Hondo.md)", "[[Hondo|x]]"]]);
  assert.deepEqual(sugerencias("[Plan](../Plan.md)"), [["[Plan](../Plan.md)", "[[Plan]]"]]);
  assert.deepEqual(sugerencias("[Plan](Plan.md)"), [["[Plan](Plan.md)", "[[Plan]]"]], "no está en docs/: se busca en la raíz");
  // Con espacios codificados, entre <…> y con ancla.
  assert.deepEqual(sugerencias("[HU](../HU/HU-009%20Gestion%20de%20usuarios.md)"), [
    ["[HU](../HU/HU-009%20Gestion%20de%20usuarios.md)", "[[HU-009 Gestion de usuarios|HU]]"],
  ]);
  assert.deepEqual(sugerencias("[Otra](<Otra.md#Un título>)"), [["[Otra](<Otra.md#Un título>)", "[[Otra#Un título]]"]]);
});

test("un enlace a una nota que no existe se avisa igual, marcado", () => {
  const [r] = detectar("[Nueva](Nueva.md)");
  assert.equal(r.sugerencia, "[[Nueva]]");
  assert.equal(r.tipo, "enlace-markdown-roto");
  assert.match(hook.aviso("docs/Nota.md", [r]), /esa nota no existe todavía/);
});

test("los enlaces web, las imágenes, otros archivos y lo que sale del vault no se avisan", () => {
  assert.deepEqual(detectar("[sitio](https://ejemplo.com/a.md)"), []);
  assert.deepEqual(detectar("[correo](mailto:x@y.md)"), []);
  assert.deepEqual(detectar("![foto](img/foto.png)"), []);
  assert.deepEqual(detectar("![diagrama](Otra.md)"), [], "con ! es una imagen");
  assert.deepEqual(detectar("[pdf](doc.pdf) [carpeta](docs/)"), []);
  assert.deepEqual(detectar("[afuera](../../Otro.md)"), []);
});

test("dentro de código no hay referencias", () => {
  assert.deepEqual(detectar("```md\n[Otra](Otra.md) y HU-009\n```"), [], "bloque cercado");
  assert.deepEqual(detectar("~~~\nHU-009\n~~~\n"), []);
  assert.deepEqual(detectar("Escribe `[Otra](Otra.md)` para un enlace Markdown."), [], "código en línea");
  assert.deepEqual(detectar("```\nsin cerrar [Otra](Otra.md)"), [], "una valla sin cerrar protege hasta el final");
  assert.deepEqual(detectar("La función `cargarHU-009()` falla."), [], "un identificador dentro de código");
});

test("lo que ya es [[…]] no se avisa", () => {
  assert.deepEqual(detectar("Ver [[Otra]] y [[HU-009 Gestion de usuarios|HU-009]]."), []);
  assert.deepEqual(detectar("Embebido: ![[Plan]]"), []);
});

test("una forma del léxico sin corchetes se avisa, también entre backticks", () => {
  assert.deepEqual(sugerencias("Lo pide la HU-009 desde marzo."), [["HU-009", "[[HU-009 Gestion de usuarios|HU-009]]"]]);
  assert.deepEqual(sugerencias("Lo pide la `HU-009`."), [["`HU-009`", "[[HU-009 Gestion de usuarios|HU-009]]"]]);
  assert.deepEqual(sugerencias("Sin distinguir: hu009."), [["hu009", "[[HU-009 Gestion de usuarios|hu009]]"]]);
  assert.deepEqual(sugerencias("El Plan sigue."), [["Plan", "[[Plan]]"]], "si la forma es el título, sin alias");
  const [r] = detectar("HU-009");
  assert.equal(r.tipo, "lexico");
  assert.equal(r.linea, 1);
});

test("el léxico respeta los bordes de palabra, lo descartado y lo que no registra", () => {
  assert.deepEqual(detectar("HU-0091 y XHU-009 y Planeta"), [], "una forma más larga no contiene a la corta");
  assert.deepEqual(detectar("El Estado del proyecto."), [], "descartada: no es una forma");
  assert.deepEqual(detectar("HU-010 no está en el léxico."), []);
  assert.deepEqual(detectar("[HU-009] entre corchetes que no son enlace"), []);
  assert.deepEqual(
    sugerencias("Un enlace [HU-009](../HU/HU-009 Gestion de usuarios.md)"),
    [["[HU-009](../HU/HU-009 Gestion de usuarios.md)", "[[HU-009 Gestion de usuarios|HU-009]]"]],
    "con espacios sin <>: CommonMark no lo admite, pero es una referencia",
  );
  assert.deepEqual(
    sugerencias("Un enlace [HU-009](<../HU/HU-009 Gestion de usuarios.md>)"),
    [["[HU-009](<../HU/HU-009 Gestion de usuarios.md>)", "[[HU-009 Gestion de usuarios|HU-009]]"]],
    "la forma dentro de un enlace Markdown se avisa una vez, como enlace",
  );
  assert.deepEqual(detectar("Plan", { nota: "Plan.md" }), [], "una nota no se enlaza a sí misma");
  assert.deepEqual(hook.formasDelLexico("{ roto"), [], "un léxico ilegible no tumba el hook");
});

test("el frontmatter y las URLs no se miran", () => {
  assert.deepEqual(detectar("---\naliases: [HU-009]\n---\nTexto."), []);
  assert.deepEqual(detectar("Ver https://x.com/HU-009/Plan"), []);
});

test("en una edición solo cuenta lo que escribió esa edición", () => {
  const texto = "Viejo: HU-009.\n\nNuevo: [Otra](Otra.md).\n";
  const rangos = hook.rangosDe(texto, ["Nuevo: [Otra](Otra.md)."]);
  assert.deepEqual(sugerencias(texto, { rangos }), [["[Otra](Otra.md)", "[[Otra]]"]]);
  assert.equal(hook.rangosDe(texto, ["no está"]), null, "un fragmento que no se encuentra: se mira todo");
  assert.deepEqual(hook.fragmentosDe("MultiEdit", { edits: [{ new_string: "a" }, { new_string: "b" }] }), ["a", "b"]);
  assert.deepEqual(hook.fragmentosDe("Edit", { new_string: "x" }), ["x"]);
  assert.deepEqual(hook.fragmentosDe("Write", { content: "y" }), ["y"]);
  assert.deepEqual(hook.fragmentosDe("Read", { file_path: "z" }), []);
});

test("el aviso agrupa repetidas y no pasa de quince", () => {
  const refs = detectar("HU-009 y HU-009\n[Otra](Otra.md)");
  const m = hook.aviso("docs/Nota.md", refs);
  assert.match(m, /«docs\/Nota\.md» tiene 2 referencias/);
  assert.match(m, /- HU-009 → \[\[HU-009 Gestion de usuarios\|HU-009\]\] \(línea 1, forma del léxico\)/);
  assert.match(hook.aviso("x.md", detectar("HU-009\nHU-009")), /\(líneas 1, 2, forma del léxico\)/);
  assert.equal(m.split("\n").filter((l) => l.startsWith("- ")).length, 2);
  assert.equal(hook.aviso("x.md", []), null);
  const muchas = Array.from({ length: 20 }, (_, i) => `[N${i}](N${i}.md)`).join("\n");
  assert.match(hook.aviso("x.md", detectar(muchas)), /… y 5 más\./);
  // Lo público va en español neutro (regla del usuario, 2026-10).
  assert.doesNotMatch(m, /convertilas|dejá|fijate/i);
});

test("de punta a punta: el hook lee el JSON de Claude Code y contesta additionalContext", () => {
  const vault = mkdtempSync(join(tmpdir(), "mic-hook-ref-"));
  try {
    mkdirSync(join(vault, ".claude", "hooks"), { recursive: true });
    mkdirSync(join(vault, "docs"), { recursive: true });
    const script = readFileSync(fileURLToPath(new URL("./hook-referencias.mjs", import.meta.url)), "utf8");
    writeFileSync(join(vault, ".claude", "hooks", "mycelium-referencias.mjs"), script);
    writeFileSync(join(vault, ".claude", "enlaces-lexico.json"), LEXICO);
    writeFileSync(join(vault, "docs", "Otra.md"), "otra");
    const nota = join(vault, "docs", "Nota.md");
    writeFileSync(nota, "Ver [Otra](Otra.md) y la HU-009.\n");
    const correr = (entrada) =>
      spawnSync(process.execPath, [join(vault, ".claude", "hooks", "mycelium-referencias.mjs")], {
        input: JSON.stringify(entrada),
        encoding: "utf8",
      });

    const r = correr({ tool_name: "Write", tool_input: { file_path: nota, content: "Ver [Otra](Otra.md) y la HU-009.\n" }, cwd: vault });
    assert.equal(r.status, 0, r.stderr);
    const salida = JSON.parse(r.stdout);
    assert.equal(salida.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(salida.hookSpecificOutput.additionalContext, /\[Otra\]\(Otra\.md\) → \[\[Otra\]\]/);
    assert.match(salida.hookSpecificOutput.additionalContext, /HU-009 → \[\[HU-009 Gestion de usuarios\|HU-009\]\]/);

    // Nada que avisar, un archivo que no es nota, o algo oculto: silencio.
    writeFileSync(nota, "Ver [[Otra]].\n");
    assert.equal(correr({ tool_name: "Write", tool_input: { file_path: nota, content: "Ver [[Otra]].\n" }, cwd: vault }).stdout, "");
    assert.equal(correr({ tool_name: "Write", tool_input: { file_path: join(vault, "a.txt"), content: "[x](Otra.md)" }, cwd: vault }).stdout, "");
    assert.equal(
      correr({ tool_name: "Write", tool_input: { file_path: join(vault, ".claude", "x.md"), content: "[x](Otra.md)" }, cwd: vault }).stdout,
      "",
    );
    // Entrada ilegible: tampoco.
    const roto = spawnSync(process.execPath, [join(vault, ".claude", "hooks", "mycelium-referencias.mjs")], { input: "{", encoding: "utf8" });
    assert.equal(roto.status, 0);
    assert.equal(roto.stdout, "");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
