//! El bucle del servidor y su estado.
//!
//! > [!important] Nada espera a una indexación completa dentro de una llamada
//! > (revisión crítica § 3.3). El cliente tiene un plazo para `initialize`: si
//! > el primer índice de un vault grande se construyera antes de contestar, el
//! > servidor aparecería caído y **ninguna** herramienta estaría en la sesión.
//! > Por eso el arranque en frío corre en un hilo aparte, `initialize` contesta
//! > enseguida, y una herramienta llamada antes de que termine devuelve
//! > `INDEXANDO` con el progreso.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use mycelium_vault::indice::Indice;
use serde_json::{json, Value};

use crate::herramientas;
use crate::protocolo::{self, error, respuesta};
use crate::vault::{self, VaultResuelto};

/// Progreso del arranque en frío.
#[derive(Default)]
pub struct Progreso {
    pub hechas: AtomicUsize,
    pub total: AtomicUsize,
}

/// El índice, cuando está listo (o el motivo por el que no lo estará).
pub type Celda = Arc<Mutex<Option<Result<Abierto, String>>>>;

/// El índice abierto y dónde vive.
pub struct Abierto {
    pub indice: Indice,
    /// El registro de búsquedas, al lado del índice.
    pub bitacora: PathBuf,
    /// `true` si hubo que usar el directorio temporal (app-data sin permisos).
    pub de_respaldo: bool,
}

pub struct Estado {
    pub vault: Result<VaultResuelto, String>,
    pub celda: Celda,
    pub progreso: Arc<Progreso>,
}

/// Abre el índice (con el respaldo en el temporal) y hace la primera pasada.
fn preparar(v: &VaultResuelto, progreso: &Progreso) -> Result<Abierto, String> {
    let (mut indice, db, de_respaldo) = match Indice::abrir(&v.db, &v.raiz, &v.registrado.ruta) {
        Ok(ix) => (ix, v.db.clone(), false),
        Err(err_app) => {
            let alt = vault::db_de_respaldo(v);
            match Indice::abrir(&alt, &v.raiz, &v.registrado.ruta) {
                Ok(ix) => {
                    eprintln!("mycelium-mcp: el app-data no se pudo usar ({err_app}); índice en {}", alt.display());
                    (ix, alt, true)
                }
                Err(err_tmp) => {
                    return Err(format!(
                        "INDICE_NO_DISPONIBLE: no se pudo abrir el índice ni en {} ({err_app}) ni en {} \
                         ({err_tmp}). Usá grep mientras tanto: sin índice no se devuelven resultados.",
                        v.db.display(),
                        alt.display()
                    ))
                }
            }
        }
    };
    let t0 = std::time::Instant::now();
    let r = indice.revalidar(&mut |hechas, total| {
        progreso.total.store(total, Ordering::Relaxed);
        progreso.hechas.store(hechas, Ordering::Relaxed);
    })?;
    eprintln!(
        "mycelium-mcp: índice listo · {} archivos, {} reindexados, {} borrados · {} ms (recorrido {} ms)",
        r.archivos,
        r.reindexadas,
        r.borradas,
        t0.elapsed().as_millis(),
        r.ms_recorrido
    );
    Ok(Abierto { bitacora: vault::bitacora_para(&db), indice, de_respaldo })
}

pub fn correr(arg_vault: Option<String>) {
    let vault = vault::resolver(arg_vault);
    let celda: Celda = Arc::new(Mutex::new(None));
    let progreso = Arc::new(Progreso::default());

    match &vault {
        Ok(v) => {
            eprintln!(
                "mycelium-mcp {}: vault «{}» ({}, desde {}) · índice {}",
                crate::VERSION,
                v.registrado.nombre,
                v.registrado.ruta,
                v.origen,
                v.db.display()
            );
            let (v, celda, progreso) = (v.clone(), celda.clone(), progreso.clone());
            std::thread::spawn(move || {
                let r = preparar(&v, &progreso);
                if let Ok(mut c) = celda.lock() {
                    *c = Some(r);
                }
            });
        }
        Err(msg) => eprintln!("mycelium-mcp: {msg}"),
    }

    let mut estado = Estado { vault, celda, progreso };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for linea in stdin.lock().lines() {
        let Ok(linea) = linea else { break };
        if linea.trim().is_empty() {
            continue;
        }
        let salidas = procesar(&mut estado, &linea);
        for s in salidas {
            // Un mensaje por línea: `to_string` no mete saltos de línea.
            if writeln!(stdout, "{s}").and_then(|_| stdout.flush()).is_err() {
                return;
            }
        }
    }
}

/// Procesa una línea (un mensaje o un lote) y devuelve las respuestas.
pub fn procesar(estado: &mut Estado, linea: &str) -> Vec<Value> {
    let msg: Value = match serde_json::from_str(linea) {
        Ok(v) => v,
        Err(e) => return vec![error(&Value::Null, protocolo::PARSE_ERROR, &format!("JSON inválido: {e}"))],
    };
    match msg {
        Value::Array(lote) => lote.iter().filter_map(|m| despachar(estado, m)).collect(),
        m => despachar(estado, &m).into_iter().collect(),
    }
}

fn despachar(estado: &mut Estado, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let Some(metodo) = msg.get("method").and_then(Value::as_str) else {
        // Una respuesta del cliente (no pedimos nada) o basura: se ignora si no
        // tiene id; si lo tiene, es una petición inválida.
        return id.map(|id| error(&id, protocolo::INVALID_REQUEST, "falta `method`"));
    };
    // Sin `id` es una notificación: no se responde.
    let id = id?;
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    Some(match metodo {
        "initialize" => {
            let pedida = params.get("protocolVersion").and_then(Value::as_str);
            respuesta(
                &id,
                json!({
                    "protocolVersion": protocolo::negociar(pedida),
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "mycelium", "title": "Mycelium · memoria del vault", "version": crate::VERSION },
                    "instructions": instrucciones(estado),
                }),
            )
        }
        "ping" => respuesta(&id, json!({})),
        "tools/list" => respuesta(&id, json!({ "tools": herramientas::definiciones() })),
        "tools/call" => {
            let Some(nombre) = params.get("name").and_then(Value::as_str) else {
                return Some(error(&id, protocolo::INVALID_PARAMS, "falta `name`"));
            };
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match herramientas::llamar(estado, nombre, &args) {
                Some(r) => respuesta(&id, r),
                None => error(&id, protocolo::INVALID_PARAMS, &format!("herramienta desconocida: {nombre}")),
            }
        }
        otro => error(&id, protocolo::METHOD_NOT_FOUND, &format!("método no soportado: {otro}")),
    })
}

fn instrucciones(estado: &Estado) -> String {
    let donde = match &estado.vault {
        Ok(v) => format!("el vault «{}» ({})", v.registrado.nombre, v.registrado.ruta),
        Err(_) => "ningún vault (no se pudo resolver: cualquier herramienta explica por qué)".to_string(),
    };
    // Decía «preferí esto a grep», y el agente dejó grep justo donde era
    // imprescindible: 0 de 10 corridas de C7 leyeron código (diagnóstico de la
    // fase 1, causa 5). Estas instrucciones y las descripciones de las
    // herramientas son lo único que ve solo el brazo MCP: el CLAUDE.md y la
    // skill del vault son el grupo de control y no se tocan.
    format!(
        "Memoria de Mycelium sobre {donde}. Para las NOTAS .md del vault: vault_buscar devuelve \
         previews de SECCIONES (migas + fragmento) con consultas cortas, y vault_leer lee las \
         secciones elegidas o la nota entera si es chica, del disco y al día. El índice NO tiene el \
         código, la configuración ni otros tipos de archivo: para eso, grep/Grep y Read, como \
         siempre. La documentación puede ir por detrás del código. Las herramientas vault_* andan \
         con la app abierta o cerrada."
    )
}

#[cfg(test)]
mod tests;
