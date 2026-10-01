// Sello de las preguntas de reserva (§ 2, «Desarrollo y reserva»).
//
// «Selladas: no se leen, no se corren, no se miran hasta el momento de la
// decisión». En un repo que es a la vez el vault —y que la IA que construye el
// MCP recorre con grep— un texto plano no está sellado: está a un `grep` de
// distancia. Por eso la reserva viaja cifrada (AES-256-GCM) y la clave vive FUERA
// del repo. Cada línea lleva además el SHA-256 del texto claro: es el compromiso
// que prueba, el día que se abra, que la pregunta no se cambió después.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const RUTA_CLAVE_DEFECTO = join(homedir(), ".mycelium-eval", "sello.key");

/** La clave del vault de Mycelium; otro vault pasa la suya (`lib/vault.mjs`, campo `sello`). */
export function rutaClave(propia = null) {
  return propia || process.env.MYCELIUM_EVAL_SELLO || RUTA_CLAVE_DEFECTO;
}

/** Lee la clave (64 hex). `crear` la genera si no existe. `ruta`: la del vault, si no es el de Mycelium. */
export function leerClave({ crear = false, ruta: propia = null } = {}) {
  const ruta = rutaClave(propia);
  if (!existsSync(ruta)) {
    if (!crear) throw new Error(`No está la clave del sello en ${ruta}. Sin ella la reserva no se abre (a propósito).`);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
  }
  const hex = readFileSync(ruta, "utf8").trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`La clave de ${ruta} no son 64 caracteres hex.`);
  return Buffer.from(hex, "hex");
}

export function sha256(texto) {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Cifra una pregunta de reserva. Lo único visible: id, clase y conjunto. */
export function sellar(pregunta, clave) {
  const claro = JSON.stringify(pregunta);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave, iv);
  const ct = Buffer.concat([c.update(claro, "utf8"), c.final()]);
  return {
    id: pregunta.id,
    clase: pregunta.clase,
    conjunto: "reserva",
    sellada: true,
    quemada: false,
    retirada: false,
    sha256: sha256(claro),
    cifrado: Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64"),
  };
}

/** Abre una línea sellada y verifica su compromiso. */
export function abrir(linea, clave) {
  const buf = Buffer.from(linea.cifrado, "base64");
  const d = createDecipheriv("aes-256-gcm", clave, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  const claro = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  if (sha256(claro) !== linea.sha256) throw new Error(`${linea.id}: el texto no coincide con su compromiso SHA-256`);
  return JSON.parse(claro);
}
