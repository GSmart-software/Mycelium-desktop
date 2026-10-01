//! El servidor de punta a punta, sin stdio: los mismos mensajes que manda un
//! cliente MCP, procesados por `procesar`.

use super::*;
use mycelium_vault::registro::VaultRef;

/// Un servidor con un vault resuelto (la carpeta no hace falta que exista:
/// el servidor no lee el disco).
fn con_vault() -> Estado {
    let v = VaultResuelto {
        registrado: VaultRef { ruta: "C:\\Notas\\Prueba".into(), nombre: "Prueba".into(), ultimo_acceso: None },
        raiz: "C:\\Notas\\Prueba".into(),
        origen: "test",
    };
    Estado { vault: Ok(v) }
}

fn uno(e: &mut Estado, msg: Value) -> Value {
    let mut r = procesar(e, &msg.to_string());
    assert_eq!(r.len(), 1, "{r:?}");
    r.remove(0)
}

#[test]
fn habla_mcp_de_punta_a_punta() {
    let mut e = con_vault();
    let ini = uno(
        &mut e,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
    );
    assert_eq!(ini["result"]["protocolVersion"], "2025-06-18");
    assert!(ini["result"]["capabilities"]["tools"].is_object());
    assert_eq!(ini["result"]["serverInfo"]["name"], "mycelium");
    let instr = ini["result"]["instructions"].as_str().unwrap();
    assert!(instr.contains("«Prueba» (C:\\Notas\\Prueba)"), "{instr}");
    // Una notificación no se responde.
    assert!(procesar(&mut e, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_empty());
    // Sin herramientas todavía: la Parte 1 las agrega.
    let lista = uno(&mut e, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    assert_eq!(lista["result"]["tools"], json!([]));
    assert_eq!(uno(&mut e, json!({"jsonrpc":"2.0","id":3,"method":"ping"}))["result"], json!({}));

    let x = uno(&mut e, json!({"jsonrpc":"2.0","id":5,"method":"no/existe"}));
    assert_eq!(x["error"]["code"], protocolo::METHOD_NOT_FOUND);
    let x = uno(&mut e, json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"vault_buscar"}}));
    assert_eq!(x["error"]["code"], protocolo::INVALID_PARAMS, "la búsqueda ya no existe");
    let x = uno(&mut e, json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{}}));
    assert_eq!(x["error"]["code"], protocolo::INVALID_PARAMS);
    assert_eq!(procesar(&mut e, "{no es json")[0]["error"]["code"], protocolo::PARSE_ERROR);
}

#[test]
fn atiende_un_lote_y_no_responde_las_notificaciones() {
    let mut e = con_vault();
    let r = procesar(
        &mut e,
        r#"[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]"#,
    );
    assert_eq!(r.len(), 2);
    assert_eq!(r[0]["id"], 1);
    assert_eq!(r[1]["id"], 2);
}

#[test]
fn sin_vault_arranca_igual_y_dice_por_que() {
    let mut e = Estado { vault: Err("VAULT_DESCONOCIDO: prueba\n  - Notas (C:\\Notas)".into()) };
    let ini = uno(&mut e, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}));
    let instr = ini["result"]["instructions"].as_str().unwrap();
    assert!(instr.contains("VAULT_DESCONOCIDO") && instr.contains("Notas (C:\\Notas)"), "{instr}");
    let lista = uno(&mut e, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    assert!(lista["result"]["tools"].is_array());
}
