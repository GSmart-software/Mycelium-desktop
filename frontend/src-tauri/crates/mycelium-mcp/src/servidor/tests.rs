//! El servidor de punta a punta, sin stdio: los mismos mensajes que manda un
//! cliente MCP, procesados por `procesar`.

use super::*;
use mycelium_vault::registro::VaultRef;

/// Un servidor sobre un vault temporal.
fn estado(nombre: &str, listo: bool) -> (Estado, PathBuf) {
    let base = std::env::temp_dir().join(format!("mycelium-mcp-{nombre}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let raiz = base.join("vault");
    std::fs::create_dir_all(raiz.join("docs")).unwrap();
    std::fs::write(raiz.join("docs/Plan.md"), "# Plan\nintro\n## Índice propio\nel MCP tiene su índice\n").unwrap();
    std::fs::write(raiz.join("docs/Otra.md"), "Ver [[Plan]] y `[[Ejemplo]]`.\n").unwrap();
    let ruta = raiz.to_string_lossy().to_string();
    let v = VaultResuelto {
        registrado: VaultRef { ruta, nombre: "Prueba".into(), ultimo_acceso: None },
        raiz,
        db: base.join("mcp.db"),
        origen: "test",
    };
    let celda: Celda = Arc::new(Mutex::new(None));
    if listo {
        let abierto = preparar(&v, &Progreso::default()).unwrap();
        *celda.lock().unwrap() = Some(Ok(abierto));
    }
    (Estado { vault: Ok(v), celda, progreso: Arc::new(Progreso::default()) }, base)
}

fn uno(e: &mut Estado, msg: Value) -> Value {
    let mut r = procesar(e, &msg.to_string());
    assert_eq!(r.len(), 1, "{r:?}");
    r.remove(0)
}

fn texto_de(r: &Value) -> &str {
    r["result"]["content"][0]["text"].as_str().unwrap()
}

#[test]
fn habla_mcp_de_punta_a_punta() {
    let (mut e, base) = estado("punta", true);
    let ini = uno(
        &mut e,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
    );
    assert_eq!(ini["result"]["protocolVersion"], "2025-06-18");
    assert!(ini["result"]["capabilities"]["tools"].is_object());
    // Una notificación no se responde.
    assert!(procesar(&mut e, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_empty());
    let lista = uno(&mut e, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    let nombres: Vec<_> =
        lista["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(nombres, ["vault_buscar", "vault_leer"]);

    let b = uno(
        &mut e,
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call",
               "params":{"name":"vault_buscar","arguments":{"consulta":"indice propio"}}}),
    );
    assert_eq!(b["result"]["isError"], false);
    let t = texto_de(&b);
    assert!(t.starts_with("1 resultados"), "{t}");
    assert!(t.contains("[1] docs/Plan.md#s2 · Índice propio"), "{t}");
    assert!(t.contains("Detalle: vault_leer"), "{t}");

    let l = uno(
        &mut e,
        json!({"jsonrpc":"2.0","id":4,"method":"tools/call",
               "params":{"name":"vault_leer","arguments":{"refs":["docs/Plan.md#s2", "Otra"]}}}),
    );
    let t = texto_de(&l);
    assert!(t.contains("── docs/Plan.md#s2 · Índice propio · L3–4"), "{t}");
    assert!(t.contains("el MCP tiene su índice"), "{t}");
    // El ejemplo en código no es un enlace: no aparece, ni como roto.
    assert!(t.contains("→ enlaza a: [[Plan]]\n"), "{t}");
    assert!(!t.contains("rotos"), "{t}");

    let x = uno(&mut e, json!({"jsonrpc":"2.0","id":5,"method":"no/existe"}));
    assert_eq!(x["error"]["code"], protocolo::METHOD_NOT_FOUND);
    let x = uno(&mut e, json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"vault_borrar"}}));
    assert_eq!(x["error"]["code"], protocolo::INVALID_PARAMS);
    assert_eq!(procesar(&mut e, "{no es json")[0]["error"]["code"], protocolo::PARSE_ERROR);
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

/// Un servidor listo sobre el vault de `estado` más los archivos dados.
fn estado_con(nombre: &str, archivos: &[(&str, String)]) -> (Estado, PathBuf) {
    let (e, base) = estado(nombre, false);
    let v = e.vault.as_ref().unwrap().clone();
    for (rel, texto) in archivos {
        std::fs::write(v.raiz.join(rel), texto).unwrap();
    }
    *e.celda.lock().unwrap() = Some(Ok(preparar(&v, &Progreso::default()).unwrap()));
    (e, base)
}

fn leer(e: &mut Estado, refs: Value) -> String {
    let r = uno(
        e,
        json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"vault_leer","arguments":{"refs":refs}}}),
    );
    texto_de(&r).to_string()
}

/// Una nota de `n` secciones de ~`bytes` cada una.
fn nota(n: usize, bytes: usize) -> String {
    let relleno = "palabra ".repeat(bytes / 8);
    (0..n).map(|i| format!("## Parte {i:02}\n{relleno}\n")).collect()
}

#[test]
fn una_nota_de_hasta_20_kb_se_devuelve_entera() {
    // ~18 KB, como `drawio.md`: con el tope de 8 KB devolvía el índice y el
    // agente eligió secciones sin la del costo real (D03).
    let (mut e, base) = estado_con("umbral", &[("docs/Mediana.md", nota(20, 900)), ("docs/Grande.md", nota(30, 900))]);
    let t = leer(&mut e, json!(["docs/Mediana.md"]));
    assert!(t.contains("· nota completa ·"), "{}", &t[..200]);
    assert!(t.contains("## Parte 19"), "trae la última sección");
    // Por encima del tope: el índice, no el texto, y el precio de la entera.
    let t = leer(&mut e, json!(["docs/Grande.md"]));
    assert!(t.contains("no se devuelve entera") && t.contains("forzar=true"), "{t}");
    assert!(!t.contains("## Parte 29"), "no trae el texto de la última");
    // Y leer una sección de la mediana dice cuánto cuesta la nota entera.
    let t = leer(&mut e, json!(["docs/Mediana.md#s3"]));
    assert!(t.contains("(la nota tiene 20 secciones; entera: vault_leer(refs=[\"docs/Mediana.md\"])"), "{t}");
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn el_indice_de_una_nota_grande_no_se_corta() {
    // 85 secciones, como el catálogo de defectos: el índice se cortaba en 40
    // filas y dejaba afuera los defectos que D11 enumeraba.
    let (mut e, base) = estado_con("indice", &[("docs/Catalogo.md", nota(85, 400))]);
    let t = leer(&mut e, json!(["docs/Catalogo.md"]));
    assert!(t.contains("no se devuelve entera"), "{}", &t[..200]);
    for i in [0, 40, 41, 84] {
        assert!(t.contains(&format!("Parte {i:02} ·")), "falta la sección {i} en el índice:\n{t}");
    }
    assert!(!t.contains("solo hasta H"), "sin resumen por niveles");
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn antes_de_terminar_el_arranque_en_frio_dice_indexando() {
    let (mut e, base) = estado("frio", false);
    e.progreso.total.store(40, Ordering::Relaxed);
    e.progreso.hechas.store(12, Ordering::Relaxed);
    let r = uno(
        &mut e,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call",
               "params":{"name":"vault_buscar","arguments":{"consulta":"x"}}}),
    );
    assert_eq!(r["result"]["isError"], true);
    assert!(texto_de(&r).starts_with("INDEXANDO") && texto_de(&r).contains("12/40"));
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn un_vault_desconocido_lo_dice_en_cada_herramienta() {
    let mut e = Estado {
        vault: Err("VAULT_DESCONOCIDO: prueba".into()),
        celda: Arc::new(Mutex::new(None)),
        progreso: Arc::new(Progreso::default()),
    };
    let r = uno(
        &mut e,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call",
               "params":{"name":"vault_leer","arguments":{"refs":["x"]}}}),
    );
    assert_eq!(r["result"]["isError"], true);
    assert!(texto_de(&r).starts_with("VAULT_DESCONOCIDO"));
}
