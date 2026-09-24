// La detección del acceso a la red (diagnóstico de la fase 1, § 3.6): una
// corrida que sale del corpus no mide la memoria del vault y se descarta.
//
//   node --test eval/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { motivoDescarte } from "../correr.mjs";
import { accesosARed, motivoRed } from "../lib/red.mjs";
import { resumirTranscripcion } from "../lib/transcripcion.mjs";
import { descartesPorRed } from "../revisar-red.mjs";

const bash = (command, id = "t") => ({ type: "tool_use", id, name: "Bash", input: { command } });
const motivos = (usos) => accesosARed(usos).map((a) => a.motivo);

test("red: el caso real de D12 r3 (curl al bucket de R2) se detecta", () => {
  const cmd = 'curl -s "https://pub-4a4b6d7b99be4917a2fe0074be9dfa40.r2.dev/versions.json" | jq .';
  assert.deepEqual(motivos([bash(cmd)]), ["curl+url"]);
});

test("red: wget, los cmdlets de PowerShell y sus alias", () => {
  assert.deepEqual(motivos([bash("wget -qO- example.org")]), ["wget"]);
  const ps = (command) => ({ name: "PowerShell", input: { command } });
  assert.deepEqual(motivos([ps("Invoke-WebRequest example.org -UseBasicParsing")]), ["Invoke-WebRequest"]);
  assert.deepEqual(motivos([ps("(irm example.org/v.json).version")]), ["irm"]);
  assert.deepEqual(motivos([ps("iwr example.org | select -expand Content")]), ["iwr"]);
  assert.deepEqual(motivos([ps("Invoke-RestMethod x")]), ["Invoke-RestMethod"]);
  assert.deepEqual(motivos([bash("cd /x && curl.exe -s x")]), ["curl"]);
});

test("red: una URL en un comando cuenta aunque no haya un programa conocido", () => {
  assert.deepEqual(motivos([bash("python -c \"import urllib.request as u; print(u.urlopen('http://x.dev').read())\"")]), ["url"]);
});

test("red: las herramientas web cuentan siempre", () => {
  assert.deepEqual(motivos([{ name: "WebFetch", input: { url: "https://x" } }, { name: "WebSearch", input: { query: "mycelium" } }]), ["WebFetch", "WebSearch"]);
});

test("red: buscar y leer en el corpus NO es red (sin falsos positivos)", () => {
  const limpios = [
    bash('grep -ril "curling" docs --include="*.md"'),
    bash("grep -rn \"firma\" docs/ | head"),
    bash("find . -name '*.md' | xargs grep -l wgetter"),
    bash('grep -rn "irma" docs'),
    { name: "Grep", input: { pattern: "https://pub-.*r2.dev" } },
    { name: "Read", input: { file_path: "C:/corpus/docs/curl.md" } },
    { name: "mcp__mycelium__vault_buscar", input: { consulta: "curl https" } },
  ];
  assert.deepEqual(accesosARed(limpios), []);
});

test("red: el motivo de descarte es propio y lista los motivos una vez", () => {
  const a = accesosARed([bash("curl https://a"), bash("curl https://b"), { name: "WebFetch", input: { url: "u" } }]);
  assert.equal(motivoRed(a), "acceso a la red (curl+url, WebFetch)");
});

test("red: la transcripción junta los tool_use (subagentes incluidos, sin repetir) y el arnés descarta", () => {
  const lineas = [
    { type: "assistant", message: { id: "m1", model: "claude-haiku-4-5-20251001", usage: {}, content: [bash("curl https://x", "t1")] } },
    { type: "assistant", message: { id: "m1", model: "claude-haiku-4-5-20251001", usage: {}, content: [bash("curl https://x", "t1")] } },
    { type: "assistant", isSidechain: true, message: { id: "s1", usage: {}, content: [{ type: "tool_use", id: "t2", name: "WebSearch", input: { query: "q" } }] } },
  ];
  const t = resumirTranscripcion(lineas.map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(t.red.length, 2);
  const r = { is_error: false, subtype: "success", stop_reason: "end_turn", structured_output: { respuesta: "x" } };
  assert.equal(motivoDescarte(r, { ...t, instrucciones: [] }, "claude-haiku-4-5-20251001", "C:\\corpus"), "acceso a la red (curl+url, WebSearch)");
  // Sin red, la misma corrida no se descarta.
  assert.equal(motivoDescarte(r, { ...t, red: [], instrucciones: [], modelos: [] }, "claude-haiku-4-5-20251001", "C:\\corpus"), null);
});

test("red: la revisión de corridas hechas agrega una fila nueva (append-only) y no toca las ya descartadas", () => {
  const fila = (o) => ({ session_id: "a", tanda: "t", pregunta: "D12", brazo: "mcp", rep: 3, acierto_citado: 0, descartada: false, motivo_descarte: null, ...o });
  const trans = (cmd) => JSON.stringify({ type: "assistant", message: { id: "m", content: [bash(cmd)] } });
  const textos = { a: trans("curl https://x"), b: trans("grep -r x docs"), c: trans("wget y") };
  const filas = [fila({}), fila({ session_id: "b" }), fila({ session_id: "c", descartada: true, motivo_descarte: "is_error" }), fila({ session_id: "d" })];
  const r = descartesPorRed(filas, (id) => textos[id] ?? null);
  assert.equal(r.hallazgos.length, 2);
  assert.deepEqual(r.nuevas.map((f) => [f.session_id, f.descartada, f.motivo_descarte]), [["a", true, "acceso a la red (curl+url)"]]);
  assert.equal(r.nuevas[0].acierto_citado, 0, "la fila nueva conserva el resto de la última");
  assert.deepEqual(r.sinTranscripcion.map((f) => f.session_id), ["d"]);
});
