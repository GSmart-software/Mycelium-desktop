// Test headless (sin navegador ni Tauri) de la migración de los dibujos de
// Excalidraw «embebidos» (`FUN-M-40`, D6 · `DEF-112`).
//
// Hasta la 2.1.0, soltar un `.excalidraw` sobre el editor guardaba la escena
// SOLO en la tabla `diagramas` del índice y escribía `![[<uuid>.excalidraw]]` en
// la nota: reconstruir el índice perdía el dibujo. `lib/db/legado.ts` los
// exporta a archivos del vault al abrirlo, reescribe el embed y borra la tabla.
// El criterio de la spec: **borrar el índice y reabrir no pierde ningún
// dibujo**, o sea que después de migrar cada dibujo es un archivo y cada embed
// resuelve a él.
//
// Mismo andamiaje que `scripts/test-capa-datos.mjs`: cada módulo se transpila y
// sus imports se reemplazan por data: URLs; `invoke` es un doble sobre un disco
// en memoria y el executor SQL, uno sobre una tabla `diagramas` en memoria.
//
//   node --test scripts/test-diagramas-legados.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const TAURI = aUrl(`export const invoke = (cmd, args) => globalThis.__invoke(cmd, args);`);

const ERRORS = await fuente("../lib/db/errors.ts");
const CLIENT = await fuente("../lib/db/client.ts", { "./errors": ERRORS });
const NOMBRES = await fuente("../lib/db/nombres.ts");
const LEGADO = await fuente("../lib/db/legado.ts", {
  "./client": CLIENT,
  "./nombres": NOMBRES,
  "@tauri-apps/api/core": TAURI,
});
const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });

const client = await import(CLIENT);
const legado = await import(LEGADO);
const { resolveWikilink } = await import(WIKILINKS);

const VAULT = "C:/vaults/prueba";
const UUID_A = "3f2a9c1e-0b7d-4e5f-9a8b-1c2d3e4f5a6b";
const UUID_B = "7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
const escena = (n) => JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: `e${n}` }] });

/** Disco en memoria con los dos comandos que usa la migración. */
function disco(inicial = {}) {
  const archivos = new Map(Object.entries(inicial));
  globalThis.__invoke = async (cmd, { rutaRel, contenido }) => {
    if (cmd === "leer_archivo_texto") return archivos.get(rutaRel) ?? null;
    if (cmd === "escribir_nota") {
      archivos.set(rutaRel, contenido);
      return 1;
    }
    throw `comando inesperado: ${cmd}`;
  };
  return archivos;
}

/**
 * Índice viejo en memoria: `diagramas` (o sin ella) más las ids de `notas` y
 * `carpetas`. `fallarEn` hace lanzar un `DELETE` de esa nota, para simular una
 * migración cortada a mitad de camino.
 */
function indice({ diagramas = null, notas = [], carpetas = [], fallarEn = null } = {}) {
  const estado = { diagramas: diagramas && [...diagramas] };
  estado.executor = {
    async select(sql, params = []) {
      if (sql.includes("sqlite_master")) {
        return params[0] === "diagramas" && estado.diagramas ? [{ name: "diagramas" }] : [];
      }
      if (sql.includes("FROM diagramas")) {
        return [...estado.diagramas].sort(
          (a, b) => a.nota_id.localeCompare(b.nota_id) || a.diag_id.localeCompare(b.diag_id),
        );
      }
      if (sql.includes("FROM notas")) return notas.map((id) => ({ id }));
      if (sql.includes("FROM carpetas")) return carpetas.map((id) => ({ id }));
      throw new Error(`consulta inesperada: ${sql}`);
    },
    async execute(sql, params = []) {
      if (sql.startsWith("DELETE FROM diagramas")) {
        if (params[0] === fallarEn) throw new Error("fallo simulado");
        estado.diagramas = estado.diagramas.filter((d) => d.nota_id !== params[0]);
        return { rowsAffected: 1 };
      }
      if (sql === "DROP TABLE diagramas") {
        estado.diagramas = null;
        return { rowsAffected: 0 };
      }
      throw new Error(`sentencia inesperada: ${sql}`);
    },
  };
  return estado;
}

/** Las notas del vault tal como las ve el explorador tras reindexar el disco. */
function notasDelDisco(archivos) {
  const notas = [];
  const carpetas = new Map();
  for (const ruta of archivos.keys()) {
    const partes = ruta.split("/");
    const nombre = partes.pop();
    let padre = null;
    for (let i = 0; i < partes.length; i++) {
      const id = partes.slice(0, i + 1).join("/");
      if (!carpetas.has(id)) carpetas.set(id, { id, nombre: partes[i], padreId: padre });
      padre = id;
    }
    const punto = nombre.lastIndexOf(".");
    const ext = nombre.slice(punto + 1);
    notas.push({
      id: ruta,
      titulo: nombre.slice(0, punto),
      carpetaId: padre,
      tipo: ext === "md" ? "markdown" : ext,
    });
  }
  return { notas, carpetas: [...carpetas.values()] };
}

/** Los `![[….excalidraw]]` de un texto, sin la extensión. */
const embeds = (texto) => [...texto.matchAll(/!\[\[([^[\]]+)\.excalidraw\]\]/g)].map((m) => m[1]);

beforeEach(() => client.setExecutor(null));

// ── Funciones puras ─────────────────────────────────────────────────────────

test("el destino va junto a la nota, con su título, y la ref lleva la carpeta", () => {
  assert.deepEqual(legado.destinoDeDiagrama("Proyectos/Plan.md", () => false), {
    ruta: "Proyectos/Plan - dibujo.excalidraw",
    ref: "Proyectos/Plan - dibujo",
  });
  assert.deepEqual(legado.destinoDeDiagrama("Idea.md", () => false), {
    ruta: "Idea - dibujo.excalidraw",
    ref: "Idea - dibujo",
  });
});

test("el destino se desambigua como cualquier creación, sin distinguir mayúsculas", () => {
  const ocupadas = new Set(["proyectos/plan - dibujo.excalidraw", "proyectos/plan - dibujo 1"]);
  assert.deepEqual(legado.destinoDeDiagrama("Proyectos/Plan.md", (r) => ocupadas.has(r)), {
    ruta: "Proyectos/Plan - dibujo 2.excalidraw",
    ref: "Proyectos/Plan - dibujo 2",
  });
});

test("reescribir cambia solo el embed de ese uuid, todas las veces", () => {
  const texto = `a ![[${UUID_A}.excalidraw]] b ![[${UUID_B}.excalidraw]] c ![[${UUID_A.toUpperCase()}.excalidraw]]`;
  assert.equal(
    legado.reescribirEmbedDeDiagrama(texto, UUID_A, "X/Plan - dibujo"),
    `a ![[X/Plan - dibujo.excalidraw]] b ![[${UUID_B}.excalidraw]] c ![[X/Plan - dibujo.excalidraw]]`,
  );
});

// ── La migración ─────────────────────────────────────────────────────────────

test("cada dibujo pasa a ser un archivo y el embed lo nombra (criterio de D6)", async () => {
  const archivos = disco({
    "Proyectos/Plan.md": `# Plan\n\n![[${UUID_A}.excalidraw]]\n\ntexto\n\n![[${UUID_B}.excalidraw]]\n`,
    "Idea.md": `![[${UUID_A}.excalidraw]]`,
  });
  const idx = indice({
    diagramas: [
      { nota_id: "Proyectos/Plan.md", diag_id: UUID_A, contenido: escena(1) },
      { nota_id: "Proyectos/Plan.md", diag_id: UUID_B, contenido: escena(2) },
      // El mismo uuid en otra nota: lo dejaba así «duplicar».
      { nota_id: "Idea.md", diag_id: UUID_A, contenido: escena(3) },
    ],
    notas: ["Proyectos/Plan.md", "Idea.md"],
    carpetas: ["Proyectos"],
  });
  client.setExecutor(idx.executor);

  await legado.migrarDiagramasEmbebidos(VAULT);

  assert.equal(idx.diagramas, null, "la tabla se borra");
  assert.equal(archivos.get("Proyectos/Plan - dibujo.excalidraw"), escena(1));
  assert.equal(archivos.get("Proyectos/Plan - dibujo 1.excalidraw"), escena(2));
  assert.equal(archivos.get("Idea - dibujo.excalidraw"), escena(3));

  // «Borrar el índice y reabrir»: lo único que queda es el disco. Cada embed
  // de cada nota resuelve a un dibujo, y a SU dibujo.
  const { notas, carpetas } = notasDelDisco(archivos);
  const esperado = {
    "Proyectos/Plan.md": ["Proyectos/Plan - dibujo.excalidraw", "Proyectos/Plan - dibujo 1.excalidraw"],
    "Idea.md": ["Idea - dibujo.excalidraw"],
  };
  for (const [nota, destinos] of Object.entries(esperado)) {
    const refs = embeds(archivos.get(nota));
    assert.equal(refs.length, destinos.length);
    refs.forEach((ref, i) => {
      const destino = resolveWikilink(`${ref}.excalidraw`, notas, carpetas);
      assert.equal(destino?.id, destinos[i], `${nota}: ${ref}`);
      assert.equal(destino.tipo, "excalidraw");
    });
  }
  assert.match(archivos.get("Proyectos/Plan.md"), /^# Plan\n\n!\[\[/, "el resto del texto no cambia");
  assert.match(archivos.get("Proyectos/Plan.md"), /\n\ntexto\n\n/);
});

test("no pisa un archivo que ya existe en disco aunque el índice no lo sepa", async () => {
  const archivos = disco({
    "Plan.md": `![[${UUID_A}.excalidraw]]`,
    "Plan - dibujo.excalidraw": "del usuario",
  });
  const idx = indice({
    diagramas: [{ nota_id: "Plan.md", diag_id: UUID_A, contenido: escena(1) }],
    notas: ["Plan.md"],
  });
  client.setExecutor(idx.executor);

  await legado.migrarDiagramasEmbebidos(VAULT);

  assert.equal(archivos.get("Plan - dibujo.excalidraw"), "del usuario");
  assert.equal(archivos.get("Plan - dibujo 1.excalidraw"), escena(1));
  assert.deepEqual(embeds(archivos.get("Plan.md")), ["Plan - dibujo 1"]);
});

test("una fila cuya nota ya no está en disco no crea nada", async () => {
  const archivos = disco({});
  const idx = indice({
    diagramas: [{ nota_id: "Borrada.md", diag_id: UUID_A, contenido: escena(1) }],
    notas: ["Borrada.md"],
  });
  client.setExecutor(idx.executor);

  await legado.migrarDiagramasEmbebidos(VAULT);

  assert.equal(archivos.size, 0);
  assert.equal(idx.diagramas, null);
});

test("un dibujo que su nota ya no muestra no se exporta", async () => {
  // Borrar el embed nunca borraba la fila: la tabla guarda dibujos que nadie ve.
  const archivos = disco({ "Plan.md": "ya sin el dibujo" });
  const idx = indice({
    diagramas: [{ nota_id: "Plan.md", diag_id: UUID_A, contenido: escena(1) }],
    notas: ["Plan.md"],
  });
  client.setExecutor(idx.executor);

  await legado.migrarDiagramasEmbebidos(VAULT);

  assert.deepEqual([...archivos.keys()], ["Plan.md"]);
  assert.equal(archivos.get("Plan.md"), "ya sin el dibujo");
  assert.equal(idx.diagramas, null);
});

test("un índice sin la tabla (nuevo, o ya migrado) no toca nada", async () => {
  const archivos = disco({ "Plan.md": `![[${UUID_A}.excalidraw]]` });
  client.setExecutor(indice().executor);
  await legado.migrarDiagramasEmbebidos(VAULT);
  assert.deepEqual([...archivos.keys()], ["Plan.md"]);
  assert.equal(archivos.get("Plan.md"), `![[${UUID_A}.excalidraw]]`);
});

test("cortada a mitad de camino, reabrir termina sin duplicar lo ya migrado", async () => {
  const archivos = disco({
    "A.md": `![[${UUID_A}.excalidraw]]`,
    "B.md": `![[${UUID_B}.excalidraw]]`,
  });
  const filas = [
    { nota_id: "A.md", diag_id: UUID_A, contenido: escena(1) },
    { nota_id: "B.md", diag_id: UUID_B, contenido: escena(2) },
  ];
  const errores = [];
  const original = console.error;
  console.error = (...a) => errores.push(a);
  const idx = indice({ diagramas: filas, notas: ["A.md", "B.md"], fallarEn: "B.md" });
  try {
    client.setExecutor(idx.executor);
    await legado.migrarDiagramasEmbebidos(VAULT); // no lanza
  } finally {
    console.error = original;
  }
  assert.ok(errores.length > 0, "el fallo queda registrado");
  assert.deepEqual(
    idx.diagramas.map((d) => d.nota_id),
    ["B.md"],
    "lo de A ya salió de la tabla; lo de B sigue para el próximo intento",
  );

  // Segunda apertura: ya sin fallo.
  const idx2 = indice({ diagramas: idx.diagramas, notas: ["A.md", "B.md"] });
  client.setExecutor(idx2.executor);
  await legado.migrarDiagramasEmbebidos(VAULT);

  assert.equal(idx2.diagramas, null);
  const dibujos = [...archivos.keys()].filter((r) => r.endsWith(".excalidraw")).sort();
  // B ya se había exportado en el primer intento —su archivo y su nota se
  // escribieron antes del fallo—, así que su nota ya no muestra el uuid y el
  // segundo intento solo limpia la fila: ningún archivo sale dos veces.
  assert.deepEqual(dibujos, ["A - dibujo.excalidraw", "B - dibujo.excalidraw"]);
  assert.deepEqual(embeds(archivos.get("A.md")), ["A - dibujo"]);
  assert.deepEqual(embeds(archivos.get("B.md")), ["B - dibujo"]);
});
