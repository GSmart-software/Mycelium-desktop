//! Las herramientas del MCP de control (`mcp-control` § 1 y § 3).
//!
//! Parte 1: `mycelium_estado` y `mycelium_abrir`. Cada herramienta nueva se
//! declara en [`definiciones`] y se atiende en [`llamar`]; la lógica de cada
//! operación vive en la app (`lib/mcpControl.ts`), donde ya existe, y acá solo
//! se valida lo evidente, se habla por el canal y se **redacta la respuesta**:
//! texto corto que dice el efecto, no el eco (spec § 3).
//!
//! Las búsquedas de la fase de memoria (`vault_buscar`, `vault_leer`) se
//! evaluaron y no entraron (`docs/arquitectura/MCP de Mycelium - tesina,
//! protocolo.md` § 9); su código quedó en la historia de `feat/mcp-desktop`.

use std::sync::atomic::{AtomicU64, Ordering};

use mycelium_vault::canal::{self as protocolo_canal, codigo};
use mycelium_vault::preferencias::control_encendido;
use serde_json::{json, Value};

use crate::canal::{self, Fallo, ESPERA_CLIENTE};
use crate::protocolo::texto;
use crate::servidor::Estado;
use crate::vault::VaultResuelto;

/// Los nombres de las herramientas que este servidor atiende.
const NOMBRES: [&str; 2] = ["mycelium_estado", "mycelium_abrir"];

/// Dónde enciende el usuario el control: se repite en varios mensajes.
const DONDE_SE_ENCIENDE: &str = "Configuración → Vault → «Asistente IA (Claude Code)» → «Dejar que la IA controle Mycelium»";

/// Lo que se responde a `tools/list`.
pub fn definiciones() -> Vec<Value> {
    vec![
        json!({
            "name": "mycelium_estado",
            "title": "Qué tiene abierto Mycelium",
            "description": "Si Mycelium está abierto con este vault, si el control está encendido y qué está \
                mirando el usuario: las pestañas de cada panel, cuál está activa y cuáles tienen cambios sin \
                guardar. Funciona también con la app cerrada (lo dice). No devuelve el contenido de las notas: \
                para eso leé los archivos.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": "mycelium_abrir",
            "title": "Mostrar algo en Mycelium",
            "description": "Abre en Mycelium una nota o archivo del vault, el grafo o el calendario, en una \
                pestaña. Por defecto NO le roba el foco al usuario (la pestaña queda en segundo plano); pedí \
                `foco: true` solo si tenés algo que mostrarle ahora. En una nota puede saltar a un encabezado, \
                una línea o un texto. Devuelve en qué panel quedó y qué pestañas hay. No crea nada: si el \
                objetivo no existe, contesta NO_ENCONTRADO con las candidatas más parecidas.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objetivo": {
                        "type": "string",
                        "description": "Ruta relativa al vault (`docs/Plan.md`), título de una nota (`Plan`, o \
                            `Carpeta/Plan` para desambiguar), `grafo` o `calendario`."
                    },
                    "ir_a": {
                        "type": "object",
                        "description": "Solo para notas markdown: a dónde saltar. Uno solo de los tres.",
                        "properties": {
                            "encabezado": { "type": "string", "description": "Texto del encabezado, sin los `#`." },
                            "linea": { "type": "integer", "minimum": 1, "description": "Número de línea (desde 1)." },
                            "texto": { "type": "string", "description": "Primer lugar donde aparece este texto." }
                        },
                        "additionalProperties": false
                    },
                    "revelar": { "type": "boolean", "description": "Mostrarla también en el explorador (abre su carpeta). Por defecto false." },
                    "foco": { "type": "boolean", "description": "Activar la pestaña y llevar al usuario a ella. Por defecto false." }
                },
                "required": ["objetivo"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        }),
    ]
}

/// Atiende un `tools/call`. `None` si la herramienta no existe (error de
/// JSON-RPC); los errores de una herramienta que sí existe van como texto
/// marcado `isError`, para que el agente los lea.
pub fn llamar(estado: &Estado, nombre: &str, args: &Value) -> Option<Value> {
    if !NOMBRES.contains(&nombre) {
        return None;
    }
    // Sin vault no hay ventana a la que hablarle: toda herramienta lo dice
    // igual, con los vaults registrados.
    let vault = match &estado.vault {
        Ok(v) => v,
        Err(msg) => return Some(texto(msg.clone(), true)),
    };
    Some(match nombre {
        "mycelium_estado" => herramienta_estado(estado, vault),
        "mycelium_abrir" => herramienta_abrir(estado, vault, args),
        _ => unreachable!("nombre validado arriba"),
    })
}

// ── Hablar con la app ──────────────────────────────────────────────────────

/// Por qué no se obtuvo un `resultado`: el texto ya redactado para el agente.
enum SinResultado {
    /// Nadie escucha en el canal (la app decide si es error según la herramienta).
    NadieEscucha,
    /// Cualquier otro error, ya redactado.
    Error(String),
}

fn pedir(estado: &Estado, vault: &VaultResuelto, op: &str, args: Value) -> Result<Value, SinResultado> {
    static ID: AtomicU64 = AtomicU64::new(1);
    let id = json!(ID.fetch_add(1, Ordering::Relaxed));
    let pedido = protocolo_canal::pedido(&id, op, args, &vault.registrado.ruta);
    match canal::pedir(&estado.canal, &pedido, estado.espera.unwrap_or(ESPERA_CLIENTE)) {
        Ok(r) if r.get("ok").and_then(Value::as_bool) == Some(true) => Ok(r.get("resultado").cloned().unwrap_or(Value::Null)),
        Ok(r) if r.get("ok").and_then(Value::as_bool) == Some(false) => {
            Err(SinResultado::Error(redactar_error(r.get("error").unwrap_or(&Value::Null))))
        }
        Ok(r) => Err(SinResultado::Error(format!("La app respondió algo que no es del protocolo: {r}"))),
        Err(Fallo::NadieEscucha) => Err(SinResultado::NadieEscucha),
        Err(Fallo::SinRespuesta) => Err(SinResultado::Error(format!(
            "{}: Mycelium no contestó a tiempo (quizás un diálogo abierto o la ventana trabada). \
             Probá de nuevo en unos segundos; si se repite, preguntale al usuario.",
            codigo::OCUPADA
        ))),
        // Un corte a mitad de la llamada (la ventana se cerró): la operación
        // puede haber ocurrido igual (spec de septiembre § 5.2).
        Err(Fallo::Roto(m)) => Err(SinResultado::Error(format!(
            "{}: se cortó el canal con Mycelium ({m}). La operación pudo haber ocurrido igual: \
             comprobalo con mycelium_estado antes de repetirla.",
            codigo::APP_CERRADA
        ))),
    }
}

/// El error cuando nadie escucha y la herramienta necesita la app: distingue
/// app cerrada de control apagado leyendo las preferencias del vault.
fn sin_ventana(vault: &VaultResuelto) -> String {
    let nombre = &vault.registrado.nombre;
    if control_encendido(&vault.raiz) {
        format!(
            "{}: Mycelium no está abierto con el vault «{nombre}» (nadie escucha en su canal). Sin la app \
             podés usar mycelium_estado, leer el calendario con la skill mycelium-calendario y leer o escribir \
             los archivos del vault como siempre. Para mostrarle algo, pedile al usuario que abra Mycelium con \
             este vault.",
            codigo::APP_CERRADA
        )
    } else {
        format!(
            "{}: el control de Mycelium está apagado en el vault «{nombre}». Lo enciende el usuario en \
             {DONDE_SE_ENCIENDE}. Apagado no te impide leer ni escribir los archivos del vault: solo operar la app.",
            codigo::MCP_DESACTIVADO
        )
    }
}

/// `CODIGO: mensaje`, más lo que trae `datos` que sirve para corregir la
/// llamada en la misma vuelta (candidatas, rutas, cuándo reintentar).
pub fn redactar_error(error: &Value) -> String {
    let cod = error.get("codigo").and_then(Value::as_str).unwrap_or("ERROR");
    let msg = error.get("mensaje").and_then(Value::as_str).unwrap_or("sin detalle");
    let mut t = format!("{cod}: {msg}");
    let datos = error.get("datos").unwrap_or(&Value::Null);
    if let Some(cands) = datos.get("candidatas").and_then(Value::as_array) {
        if !cands.is_empty() {
            t.push_str("\nLo más parecido:");
            for c in cands {
                t.push_str(&format!("\n  - {}", describir_ref(c)));
            }
        }
    }
    if let Some(rutas) = datos.get("rutas").and_then(Value::as_array) {
        t.push_str("\nRepetí la llamada con una de estas rutas:");
        for r in rutas {
            t.push_str(&format!("\n  - {}", r.as_str().unwrap_or_default()));
        }
    }
    if let Some(etapa) = datos.get("etapa").and_then(Value::as_str) {
        t.push_str(&format!("\nEtapa: {etapa}."));
    }
    if let Some(ms) = datos.get("reintentar_en_ms").and_then(Value::as_u64) {
        t.push_str(&format!(" Reintentá en {:.1} s.", ms as f64 / 1000.0));
    }
    t
}

/// `Título — ruta` (o solo el título si no tiene ruta).
fn describir_ref(v: &Value) -> String {
    let titulo = v.get("titulo").and_then(Value::as_str).unwrap_or("?");
    match v.get("ruta").and_then(Value::as_str) {
        Some(r) if !r.is_empty() => format!("{titulo} — {r}"),
        _ => titulo.to_string(),
    }
}

/// Las pestañas por panel, una línea por pestaña. `*` marca la activa de cada
/// panel; el panel con el foco lleva «(activo)».
pub fn redactar_paneles(paneles: &Value) -> String {
    let Some(lista) = paneles.as_array().filter(|l| !l.is_empty()) else {
        return "No hay pestañas abiertas.".to_string();
    };
    let mut t = String::new();
    for p in lista {
        let n = p.get("panel").and_then(Value::as_u64).unwrap_or(0);
        let activo = p.get("activo").and_then(Value::as_bool).unwrap_or(false);
        t.push_str(&format!("Panel {n}{}:", if activo { " (activo)" } else { "" }));
        let pestanas = p.get("pestanas").and_then(Value::as_array).cloned().unwrap_or_default();
        if pestanas.is_empty() {
            t.push_str(" vacío");
        }
        for pe in pestanas {
            let marca = if pe.get("activa").and_then(Value::as_bool) == Some(true) { "*" } else { "-" };
            let tipo = pe.get("tipo").and_then(Value::as_str).unwrap_or("?");
            let sucia = if pe.get("sin_guardar").and_then(Value::as_bool) == Some(true) { " · SIN GUARDAR" } else { "" };
            t.push_str(&format!("\n  {marca} {} [{tipo}]{sucia}", describir_ref(&pe)));
        }
        t.push('\n');
    }
    t.push_str("(* = pestaña visible de cada panel)");
    t
}

// ── mycelium_estado ────────────────────────────────────────────────────────

fn herramienta_estado(estado: &Estado, vault: &VaultResuelto) -> Value {
    let cabecera = format!("Vault «{}» ({}).", vault.registrado.nombre, vault.registrado.ruta);
    match pedir(estado, vault, "estado", json!({})) {
        Ok(r) => {
            let etapa = r.get("etapa").and_then(Value::as_str).unwrap_or("lista");
            let mut t = format!("app: abierta · control: encendido · {cabecera}");
            if etapa != "lista" {
                t.push_str(&format!("\nLa app está ocupada: {etapa}."));
            }
            t.push('\n');
            t.push_str(&redactar_paneles(r.get("paneles").unwrap_or(&Value::Null)));
            texto(t, false)
        }
        Err(SinResultado::NadieEscucha) => {
            // Con la app cerrada responde igual, con lo que se sabe del disco.
            let t = if control_encendido(&vault.raiz) {
                format!(
                    "app: cerrada · control: encendido · {cabecera}\nMycelium no está abierto con este vault: \
                     no hay pestañas que mirar. Los archivos se leen y escriben igual."
                )
            } else {
                format!(
                    "app: sin canal · control: apagado · {cabecera}\nCon el control apagado no se puede saber \
                     si Mycelium está abierto ni qué muestra. Lo enciende el usuario en {DONDE_SE_ENCIENDE}."
                )
            };
            texto(t, false)
        }
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}

// ── mycelium_abrir ─────────────────────────────────────────────────────────

/// Valida los argumentos de `mycelium_abrir` antes de molestar a la app.
pub fn validar_abrir(args: &Value) -> Result<Value, String> {
    let invalido = |m: &str| Err(format!("{}: {m}", codigo::INVALIDO));
    let Some(objetivo) = args.get("objetivo").and_then(Value::as_str).map(str::trim).filter(|o| !o.is_empty()) else {
        return invalido("falta `objetivo` (una ruta, un título, `grafo` o `calendario`).");
    };
    if let Some(ir_a) = args.get("ir_a").filter(|v| !v.is_null()) {
        let Some(o) = ir_a.as_object() else {
            return invalido("`ir_a` tiene que ser un objeto: {encabezado}, {linea} o {texto}.");
        };
        let claves: Vec<&str> = o.keys().map(String::as_str).collect();
        if claves.len() != 1 || !matches!(claves[0], "encabezado" | "linea" | "texto") {
            return invalido("`ir_a` lleva exactamente uno de: encabezado, linea, texto.");
        }
        match claves[0] {
            "linea" if !o["linea"].as_u64().is_some_and(|n| n >= 1) => {
                return invalido("`ir_a.linea` es un entero desde 1.");
            }
            "encabezado" | "texto" if o[claves[0]].as_str().map_or(true, |s| s.trim().is_empty()) => {
                return invalido(&format!("`ir_a.{}` es un texto no vacío.", claves[0]));
            }
            _ => {}
        }
    }
    for clave in ["revelar", "foco"] {
        if let Some(v) = args.get(clave).filter(|v| !v.is_null()) {
            if !v.is_boolean() {
                return invalido(&format!("`{clave}` es true o false."));
            }
        }
    }
    Ok(json!({
        "objetivo": objetivo,
        "ir_a": args.get("ir_a").cloned().unwrap_or(Value::Null),
        "revelar": args.get("revelar").and_then(Value::as_bool).unwrap_or(false),
        "foco": args.get("foco").and_then(Value::as_bool).unwrap_or(false),
    }))
}

/// El texto de un `abrir` que salió bien: qué se abrió, dónde, con o sin foco,
/// y las pestañas que hay después.
pub fn redactar_abrir(r: &Value) -> String {
    let abierto = r.get("abierto").unwrap_or(&Value::Null);
    let panel = r.get("panel").and_then(Value::as_u64).unwrap_or(0);
    let foco = r.get("foco").and_then(Value::as_bool).unwrap_or(false);
    let ya = r.get("ya_estaba").and_then(Value::as_bool).unwrap_or(false);
    let tipo = abierto.get("tipo").and_then(Value::as_str).unwrap_or("?");
    let mut t = format!(
        "{} «{}» [{tipo}] en el panel {panel}, {}.",
        if ya { "Ya estaba abierta" } else { "Abrí" },
        describir_ref(abierto),
        if foco { "con el foco: el usuario la está viendo" } else { "en segundo plano: no se tocó el foco del usuario" }
    );
    if let Some(s) = r.get("salto").and_then(Value::as_str) {
        t.push_str(&format!(" {s}"));
    }
    if r.get("revelado").and_then(Value::as_bool) == Some(true) {
        t.push_str(" Quedó a la vista en el explorador.");
    }
    for a in r.get("avisos").and_then(Value::as_array).into_iter().flatten() {
        if let Some(a) = a.as_str() {
            t.push_str(&format!("\nAviso: {a}"));
        }
    }
    t.push('\n');
    t.push_str(&redactar_paneles(r.get("paneles").unwrap_or(&Value::Null)));
    t
}

fn herramienta_abrir(estado: &Estado, vault: &VaultResuelto, args: &Value) -> Value {
    let args = match validar_abrir(args) {
        Ok(a) => a,
        Err(e) => return texto(e, true),
    };
    match pedir(estado, vault, "abrir", args) {
        Ok(r) => texto(redactar_abrir(&r), false),
        Err(SinResultado::NadieEscucha) => texto(sin_ventana(vault), true),
        Err(SinResultado::Error(e)) => texto(e, true),
    }
}
