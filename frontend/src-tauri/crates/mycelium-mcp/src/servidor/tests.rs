//! El servidor de punta a punta, sin stdio: los mismos mensajes que manda un
//! cliente MCP, procesados por `procesar`. Las herramientas hablan con un
//! servidor de canal falso que hace de app (`canal_falso.rs`).

use super::*;
use crate::canal::falso::{canal_de_prueba, levantar};
use mycelium_vault::registro::VaultRef;

/// Un servidor con un vault resuelto. La carpeta existe (las herramientas leen
/// `.mycelium/preferencias.json`) y el canal es uno de prueba, sin nadie.
fn con_vault(nombre: &str, control: Option<bool>) -> Estado {
    let raiz = std::env::temp_dir().join(format!("mycelium-mcp-srv-{nombre}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&raiz);
    std::fs::create_dir_all(raiz.join(".mycelium")).unwrap();
    if let Some(c) = control {
        std::fs::write(raiz.join(".mycelium/preferencias.json"), format!(r#"{{"controlIa":{c}}}"#)).unwrap();
    }
    let v = VaultResuelto {
        registrado: VaultRef { ruta: raiz.to_string_lossy().to_string(), nombre: "Prueba".into(), ultimo_acceso: None },
        raiz,
        origen: "test",
    };
    Estado { vault: Ok(v), canal: canal_de_prueba(nombre), espera: Some(std::time::Duration::from_secs(5)), confirmacion: None }
}

fn uno(e: &mut Estado, msg: Value) -> Value {
    let mut r = procesar(e, &msg.to_string());
    assert_eq!(r.len(), 1, "{r:?}");
    r.remove(0)
}

/// Llama a una herramienta y devuelve `(texto, es_error)`.
fn llamar(e: &mut Estado, nombre: &str, args: Value) -> (String, bool) {
    let r = uno(e, json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":nombre,"arguments":args}}));
    let res = &r["result"];
    (res["content"][0]["text"].as_str().unwrap_or_default().to_string(), res["isError"].as_bool().unwrap())
}

#[test]
fn habla_mcp_de_punta_a_punta() {
    let mut e = con_vault("mcp", None);
    let ruta = e.vault.as_ref().unwrap().registrado.ruta.clone();
    let ini = uno(
        &mut e,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
    );
    assert_eq!(ini["result"]["protocolVersion"], "2025-06-18");
    assert!(ini["result"]["capabilities"]["tools"].is_object());
    assert_eq!(ini["result"]["serverInfo"]["name"], "mycelium");
    let instr = ini["result"]["instructions"].as_str().unwrap();
    assert!(instr.contains(&format!("«Prueba» ({ruta})")), "{instr}");
    // Una notificación no se responde.
    assert!(procesar(&mut e, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_empty());
    let lista = uno(&mut e, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    let nombres: Vec<&str> =
        lista["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(
        nombres,
        [
            "mycelium_estado",
            "mycelium_abrir",
            "mycelium_recordatorios",
            "mycelium_recordatorio_crear",
            "mycelium_recordatorio_editar",
            "mycelium_recordatorio_completar",
            "mycelium_recordatorio_borrar",
            "mycelium_renombrar",
            "mycelium_mover",
            "mycelium_borrar",
            "mycelium_papelera",
            "mycelium_diccionario",
        ]
    );
    for t in lista["result"]["tools"].as_array().unwrap() {
        assert_eq!(t["inputSchema"]["type"], "object", "{t}");
    }
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
    let mut e = con_vault("lote", None);
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
    let mut e = Estado::nuevo(Err("VAULT_DESCONOCIDO: prueba\n  - Notas (C:\\Notas)".into()));
    let ini = uno(&mut e, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}));
    let instr = ini["result"]["instructions"].as_str().unwrap();
    assert!(instr.contains("VAULT_DESCONOCIDO") && instr.contains("Notas (C:\\Notas)"), "{instr}");
    let lista = uno(&mut e, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    assert!(lista["result"]["tools"].is_array());
    let (t, err) = llamar(&mut e, "mycelium_estado", json!({}));
    assert!(err && t.starts_with("VAULT_DESCONOCIDO"), "{t}");
    let (t, err) = llamar(&mut e, "mycelium_abrir", json!({"objetivo": "x"}));
    assert!(err && t.contains("Notas (C:\\Notas)"), "{t}");
}

// ── Sin nadie escuchando: app cerrada o control apagado ───────────────────

#[test]
fn con_el_control_apagado_abrir_dice_donde_se_enciende() {
    let mut e = con_vault("apagado", Some(false));
    let (t, err) = llamar(&mut e, "mycelium_abrir", json!({"objetivo": "Plan"}));
    assert!(err, "{t}");
    assert!(t.starts_with("MCP_DESACTIVADO"), "{t}");
    assert!(t.contains("Configuración → Vault"), "{t}");
    // Sin archivo de preferencias también: apagado por defecto.
    let mut e = con_vault("sin-prefs", None);
    assert!(llamar(&mut e, "mycelium_abrir", json!({"objetivo": "Plan"})).0.starts_with("MCP_DESACTIVADO"));
}

#[test]
fn con_el_control_encendido_y_nadie_escuchando_es_app_cerrada() {
    let mut e = con_vault("cerrada", Some(true));
    let (t, err) = llamar(&mut e, "mycelium_abrir", json!({"objetivo": "Plan"}));
    assert!(err && t.starts_with("APP_CERRADA"), "{t}");
    assert!(t.contains("mycelium_estado"), "dice qué sí se puede hacer: {t}");
}

#[test]
fn el_estado_con_la_app_cerrada_responde_igual() {
    let mut e = con_vault("estado-cerrada", Some(true));
    let (t, err) = llamar(&mut e, "mycelium_estado", json!({}));
    assert!(!err, "{t}");
    assert!(t.starts_with("app: cerrada · control: encendido"), "{t}");
    assert!(t.contains("«Prueba»"), "{t}");

    let mut e = con_vault("estado-apagado", Some(false));
    let (t, err) = llamar(&mut e, "mycelium_estado", json!({}));
    assert!(!err && t.contains("control: apagado") && t.contains("Configuración → Vault"), "{t}");
}

// ── Con la app (falsa) escuchando ──────────────────────────────────────────

/// Una app que contesta `estado` y `abrir` como la de verdad.
fn app_falsa(e: &Estado) -> crate::canal::falso::Servidor {
    let vault = e.vault.as_ref().unwrap().registrado.ruta.clone();
    levantar(e.canal.clone(), move |p| {
        assert_eq!(p["vault"], vault.as_str(), "el pedido declara su vault");
        let paneles = json!([
            {"panel": 1, "activo": true, "pestanas": [
                {"titulo": "Plan", "ruta": "docs/Plan.md", "tipo": "nota", "activa": true, "sin_guardar": true},
                {"titulo": "Grafo de conexiones", "ruta": null, "tipo": "grafo", "activa": false, "sin_guardar": false}
            ]}
        ]);
        Some(match p["op"].as_str() {
            Some("estado") => json!({"id": p["id"], "ok": true, "resultado": {"etapa": "lista", "paneles": paneles}}),
            Some("abrir") if p["args"]["objetivo"] == "Inexistente" => json!({"id": p["id"], "ok": false, "error": {
                "codigo": "NO_ENCONTRADO", "mensaje": "No hay ninguna nota «Inexistente».",
                "datos": {"candidatas": [{"titulo": "Existente", "ruta": "a/Existente.md"}]}}}),
            Some("abrir") if p["args"]["objetivo"] == "Repetida" => json!({"id": p["id"], "ok": false, "error": {
                "codigo": "AMBIGUO", "mensaje": "Hay 2 notas «Repetida».",
                "datos": {"rutas": ["a/Repetida.md", "b/Repetida.md"]}}}),
            Some("abrir") => json!({"id": p["id"], "ok": true, "resultado": {
                "abierto": {"titulo": "Plan", "ruta": "docs/Plan.md", "tipo": "nota"},
                "panel": 1, "foco": p["args"]["foco"], "ya_estaba": false,
                "salto": if p["args"]["ir_a"].is_null() { Value::Null } else { json!("Saltó al encabezado «Metas».") },
                "revelado": p["args"]["revelar"], "avisos": [], "paneles": paneles}}),
            _ => json!({"id": p["id"], "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "op desconocida", "datos": null}}),
        })
    })
}

#[test]
fn el_estado_lista_las_pestanas_por_panel() {
    let mut e = con_vault("estado-abierta", Some(true));
    let _app = app_falsa(&e);
    let (t, err) = llamar(&mut e, "mycelium_estado", json!({}));
    assert!(!err, "{t}");
    assert!(t.starts_with("app: abierta · control: encendido"), "{t}");
    assert!(t.contains("Panel 1 (activo):"), "{t}");
    assert!(t.contains("  * Plan — docs/Plan.md [nota] · SIN GUARDAR"), "{t}");
    assert!(t.contains("  - Grafo de conexiones [grafo]"), "{t}");
}

#[test]
fn abrir_dice_el_efecto() {
    let mut e = con_vault("abrir", Some(true));
    let _app = app_falsa(&e);
    let (t, err) = llamar(&mut e, "mycelium_abrir", json!({"objetivo": "Plan", "ir_a": {"encabezado": "Metas"}}));
    assert!(!err, "{t}");
    assert!(t.starts_with("Abrí «Plan — docs/Plan.md» [nota] en el panel 1, en segundo plano"), "{t}");
    assert!(t.contains("Saltó al encabezado «Metas»."), "{t}");
    assert!(t.contains("Panel 1 (activo):"), "y las pestañas que quedaron: {t}");

    let (t, _) = llamar(&mut e, "mycelium_abrir", json!({"objetivo": "Plan", "foco": true, "revelar": true}));
    assert!(t.contains("con el foco") && t.contains("explorador"), "{t}");
}

#[test]
fn los_errores_de_la_app_traen_como_corregir() {
    let mut e = con_vault("errores", Some(true));
    let _app = app_falsa(&e);
    let (t, err) = llamar(&mut e, "mycelium_abrir", json!({"objetivo": "Inexistente"}));
    assert!(err && t.starts_with("NO_ENCONTRADO"), "{t}");
    assert!(t.contains("Existente — a/Existente.md"), "las candidatas: {t}");
    let (t, err) = llamar(&mut e, "mycelium_abrir", json!({"objetivo": "Repetida"}));
    assert!(err && t.starts_with("AMBIGUO") && t.contains("b/Repetida.md"), "{t}");
}

#[test]
fn los_argumentos_invalidos_no_llegan_a_la_app() {
    let mut e = con_vault("invalidos", Some(true));
    // Sin app: si llegaran al canal, el error sería APP_CERRADA.
    for args in [
        json!({}),
        json!({"objetivo": "  "}),
        json!({"objetivo": "x", "ir_a": {"linea": 0}}),
        json!({"objetivo": "x", "ir_a": {"linea": 2, "texto": "y"}}),
        json!({"objetivo": "x", "ir_a": {"pagina": 2}}),
        json!({"objetivo": "x", "ir_a": "Metas"}),
        json!({"objetivo": "x", "foco": "si"}),
    ] {
        let (t, err) = llamar(&mut e, "mycelium_abrir", args.clone());
        assert!(err && t.starts_with("INVALIDO"), "{args} → {t}");
    }
}

#[test]
fn una_app_que_no_contesta_es_ocupada_y_no_cuelga() {
    let mut e = con_vault("muda", Some(true));
    e.espera = Some(std::time::Duration::from_millis(300));
    let _app = levantar(e.canal.clone(), |_| None);
    let (t, err) = llamar(&mut e, "mycelium_estado", json!({}));
    assert!(err && t.starts_with("OCUPADA"), "{t}");
}

#[test]
fn ocupada_con_etapa_se_redacta_entera() {
    let t = crate::herramientas::redactar_error(&json!({
        "codigo": "OCUPADA", "mensaje": "Mycelium está abriendo el vault.",
        "datos": {"etapa": "Leyendo los archivos de la carpeta", "reintentar_en_ms": 1500}
    }));
    assert_eq!(
        t,
        "OCUPADA: Mycelium está abriendo el vault.\nEtapa: Leyendo los archivos de la carpeta. Reintentá en 1.5 s."
    );
}

// ── El calendario (Parte 2) ────────────────────────────────────────────────

/// Una app que atiende el calendario como la de verdad: valida (la validación
/// es suya) y contesta con el efecto ya redactado.
fn app_calendario(e: &Estado) -> crate::canal::falso::Servidor {
    levantar(e.canal.clone(), move |p| {
        let id = p["id"].clone();
        let a = &p["args"];
        Some(match p["op"].as_str() {
            Some("recordatorios") if a["desde"] == "2026-10-01" => json!({"id": id, "ok": true, "resultado": {
                "desde": "2026-10-01", "hasta": "2026-10-07", "ocurrencias": [
                    {"id": "r1", "titulo": "Médico", "fecha": "2026-10-02", "dia": "vie 2 oct", "hora": null,
                     "color": "Coral", "repeticion": "ninguna", "completada": false, "detalle": "Llevar estudios"},
                    {"id": "r2", "titulo": "Reunión", "fecha": "2026-10-05", "dia": "lun 5 oct", "hora": "10:30",
                     "color": "Hifa", "repeticion": "semana", "completada": true, "detalle": ""}
                ]}}),
            Some("recordatorios") => json!({"id": id, "ok": true, "resultado": {"desde": a["desde"], "hasta": a["hasta"], "ocurrencias": []}}),
            Some("recordatorio_crear") if a["color"] == "Violeta" => json!({"id": id, "ok": false, "error": {
                "codigo": "INVALIDO", "mensaje": "`color`: «Violeta» no está en la paleta.", "datos": {"campo": "color"}}}),
            Some("recordatorio_crear") => json!({"id": id, "ok": true, "resultado": {
                "efecto": "Creé «Revisar conclusiones» para el viernes 3 de octubre a las 10:00, color Hifa. Va a avisar.",
                "recordatorio": {"id": "nuevo-1", "titulo": "Revisar conclusiones"}, "avisa": true}}),
            Some("recordatorio_borrar") => json!({"id": id, "ok": false, "error": {
                "codigo": "NO_ENCONTRADO", "mensaje": "No hay ningún recordatorio con id «Medico».",
                "datos": {"candidatas": [{"titulo": "Médico", "ruta": "id r1"}]}}}),
            Some("recordatorio_completar") => json!({"id": id, "ok": true, "resultado": {
                "efecto": "Marqué como completado «Médico» de mañana, todo el día.", "id": "r1"}}),
            _ => json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}}),
        })
    })
}

#[test]
fn el_calendario_se_lee_en_el_orden_de_la_app() {
    let mut e = con_vault("cal-leer", Some(true));
    let _app = app_calendario(&e);
    let (t, err) = llamar(&mut e, "mycelium_recordatorios", json!({"desde": "2026-10-01", "hasta": "2026-10-07"}));
    assert!(!err, "{t}");
    assert!(t.starts_with("2 ocurrencias entre el 2026-10-01 y el 2026-10-07"), "{t}");
    assert!(t.contains("\n- vie 2 oct 2026-10-02 · todo el día · «Médico» · Coral · id r1\n    Llevar estudios"), "{t}");
    assert!(t.contains("- lun 5 oct 2026-10-05 · 10:30 · «Reunión» · Hifa · se repite cada semana · ✓ completada · id r2"), "{t}");
    let (t, err) = llamar(&mut e, "mycelium_recordatorios", json!({"desde": "2027-01-01", "hasta": "2027-01-02"}));
    assert!(!err && t == "No hay recordatorios entre el 2027-01-01 y el 2027-01-02.", "{t}");
}

#[test]
fn escribir_el_calendario_dice_el_efecto_y_el_id() {
    let mut e = con_vault("cal-escribir", Some(true));
    let _app = app_calendario(&e);
    let (t, err) = llamar(&mut e, "mycelium_recordatorio_crear", json!({"titulo": "Revisar conclusiones", "fecha": "2026-10-03", "hora": "10:00"}));
    assert!(!err, "{t}");
    assert!(t.starts_with("Creé «Revisar conclusiones» para el viernes 3 de octubre a las 10:00"), "{t}");
    assert!(t.ends_with("\nid: nuevo-1"), "{t}");
    let (t, err) = llamar(&mut e, "mycelium_recordatorio_completar", json!({"id": "r1", "fecha": "2026-10-02"}));
    assert!(!err && t.starts_with("Marqué como completado") && !t.contains("id:"), "{t}");

    // Los errores de la app llegan con lo que sirve para corregir.
    let (t, err) = llamar(&mut e, "mycelium_recordatorio_crear", json!({"titulo": "X", "fecha": "2026-10-03", "color": "Violeta"}));
    assert!(err && t.starts_with("INVALIDO: `color`"), "{t}");
    let (t, err) = llamar(&mut e, "mycelium_recordatorio_borrar", json!({"id": "Medico"}));
    assert!(err && t.starts_with("NO_ENCONTRADO") && t.contains("Médico — id r1"), "{t}");
}

#[test]
fn el_calendario_sin_app_dice_que_no_se_escribe_a_mano() {
    let mut e = con_vault("cal-cerrada", Some(true));
    for (nombre, args) in [
        ("mycelium_recordatorios", json!({"desde": "2026-10-01", "hasta": "2026-10-07"})),
        ("mycelium_recordatorio_crear", json!({"titulo": "X", "fecha": "2026-10-03"})),
        ("mycelium_recordatorio_borrar", json!({"id": "r1"})),
    ] {
        let (t, err) = llamar(&mut e, nombre, args);
        assert!(err && t.starts_with("APP_CERRADA"), "{nombre}: {t}");
        assert!(t.contains("no escribas .mycelium/recordatorios.json") && t.contains("mycelium-calendario"), "{t}");
    }
    let mut e = con_vault("cal-apagado", Some(false));
    let (t, err) = llamar(&mut e, "mycelium_recordatorio_crear", json!({"titulo": "X", "fecha": "2026-10-03"}));
    assert!(err && t.starts_with("MCP_DESACTIVADO") && t.contains("Configuración → Vault"), "{t}");
    // Lo único que valida el servidor: que los argumentos sean un objeto.
    let (t, err) = llamar(&mut e, "mycelium_recordatorio_borrar", json!("r1"));
    assert!(err && t.starts_with("INVALIDO"), "{t}");
}
