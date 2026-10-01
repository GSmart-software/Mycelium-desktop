//! Prueba de punta a punta **sin la app** (`FUN-L-09`, Parte 1): el binario
//! real de `mycelium-mcp`, lanzado como lo lanza Claude Code (stdio, con
//! `MYCELIUM_VAULT`), contra un servidor de canal falso que hace de ventana de
//! Mycelium en el mismo pipe que usaría la app.
//!
//! Cubre lo que no cubren los tests unitarios: la resolución del vault desde el
//! entorno contra un `vaults.json` de verdad, el nombre del canal calculado por
//! las dos puntas por separado, y el ciclo app abierta → app cerrada → control
//! apagado.

#[path = "../src/canal_falso.rs"]
mod falso;

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

struct Mcp {
    hijo: Child,
    entrada: ChildStdin,
    salida: BufReader<ChildStdout>,
    n: u64,
}

impl Mcp {
    fn lanzar(dir_app: &Path, vault: &Path) -> Self {
        let mut hijo = Command::new(env!("CARGO_BIN_EXE_mycelium-mcp"))
            .env("MYCELIUM_DIR_APP", dir_app)
            .env("MYCELIUM_VAULT", vault)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("no se pudo lanzar mycelium-mcp");
        let entrada = hijo.stdin.take().unwrap();
        let salida = BufReader::new(hijo.stdout.take().unwrap());
        Mcp { hijo, entrada, salida, n: 0 }
    }

    fn pedir(&mut self, metodo: &str, params: Value) -> Value {
        self.n += 1;
        let msg = json!({"jsonrpc": "2.0", "id": self.n, "method": metodo, "params": params});
        writeln!(self.entrada, "{msg}").unwrap();
        self.entrada.flush().unwrap();
        let mut linea = String::new();
        self.salida.read_line(&mut linea).unwrap();
        let r: Value = serde_json::from_str(&linea).unwrap_or_else(|e| panic!("{e}: {linea}"));
        assert_eq!(r["id"], self.n, "{r}");
        r
    }

    /// `(texto, es_error)` de un `tools/call`.
    fn herramienta(&mut self, nombre: &str, args: Value) -> (String, bool) {
        let r = self.pedir("tools/call", json!({"name": nombre, "arguments": args}));
        let res = &r["result"];
        (res["content"][0]["text"].as_str().unwrap().to_string(), res["isError"].as_bool().unwrap())
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.hijo.kill();
        let _ = self.hijo.wait();
    }
}

fn preparar(nombre: &str) -> (PathBuf, PathBuf, PathBuf) {
    let base = std::env::temp_dir().join(format!("mycelium-mcp-e2e-{nombre}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let dir_app = base.join("app");
    let vault = base.join("Vault de Prueba");
    std::fs::create_dir_all(&dir_app).unwrap();
    std::fs::create_dir_all(vault.join(".mycelium")).unwrap();
    std::fs::create_dir_all(vault.join("docs")).unwrap();
    let registro = json!({"vaults": [{"ruta": vault.to_string_lossy(), "nombre": "Vault de Prueba", "ultimoAcceso": 1}], "abrirUltimo": false});
    std::fs::write(dir_app.join("vaults.json"), registro.to_string()).unwrap();
    (base, dir_app, vault)
}

fn control(vault: &Path, encendido: bool) {
    std::fs::write(vault.join(".mycelium/preferencias.json"), format!(r#"{{"controlIa":{encendido}}}"#)).unwrap();
}

#[test]
fn el_servidor_real_contra_una_app_falsa() {
    let (base, dir_app, vault) = preparar("app-falsa");
    control(&vault, true);
    // El canal lo calcula cada punta por su lado: si no coincidieran, el MCP
    // nunca encontraría a la app.
    let ruta_registrada = vault.to_string_lossy().to_string();
    let canal = mycelium_vault::canal::nombre_canal(&ruta_registrada, &dir_app);

    // El MCP se lanza desde una SUBCARPETA del vault, escrita con otras barras:
    // tiene que resolver igual a la cadena registrada.
    let desde = vault.join("docs").to_string_lossy().replace('\\', "/");
    let mut mcp = Mcp::lanzar(&dir_app, Path::new(&desde));

    let ini = mcp.pedir("initialize", json!({"protocolVersion": "2025-06-18"}));
    assert!(ini["result"]["instructions"].as_str().unwrap().contains("«Vault de Prueba»"), "{ini}");
    let lista = mcp.pedir("tools/list", json!({}));
    assert_eq!(lista["result"]["tools"].as_array().unwrap().len(), 2);

    // ── App abierta ───────────────────────────────────────────────────────
    let vista = ruta_registrada.clone();
    let app = falso::levantar(canal.clone(), move |p| {
        let id = p["id"].clone();
        if p["vault"] != vista.as_str() {
            return Some(json!({"id": id, "ok": false, "error": {"codigo": "VAULT_DESCONOCIDO", "mensaje": "otro vault", "datos": null}}));
        }
        let paneles = json!([{"panel": 1, "activo": true, "pestanas": [
            {"titulo": "Plan", "ruta": "docs/Plan.md", "tipo": "nota", "activa": true, "sin_guardar": false}]}]);
        Some(match (p["op"].as_str(), p["args"]["objetivo"].as_str()) {
            (Some("estado"), _) => json!({"id": id, "ok": true, "resultado": {"etapa": "lista", "paneles": paneles}}),
            (Some("abrir"), Some("calendario")) => json!({"id": id, "ok": true, "resultado": {
                "abierto": {"titulo": "Calendario", "ruta": null, "tipo": "calendario"}, "panel": 1,
                "foco": p["args"]["foco"], "ya_estaba": false, "paneles": paneles}}),
            (Some("abrir"), _) => json!({"id": id, "ok": false, "error": {"codigo": "NO_ENCONTRADO",
                "mensaje": "No hay ninguna nota «Plam».", "datos": {"candidatas": [{"titulo": "Plan", "ruta": "docs/Plan.md"}]}}}),
            _ => json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}}),
        })
    });

    let (t, err) = mcp.herramienta("mycelium_estado", json!({}));
    assert!(!err && t.starts_with("app: abierta · control: encendido"), "{t}");
    assert!(t.contains("* Plan — docs/Plan.md [nota]"), "{t}");

    let (t, err) = mcp.herramienta("mycelium_abrir", json!({"objetivo": "calendario", "foco": true}));
    assert!(!err && t.starts_with("Abrí «Calendario» [calendario] en el panel 1, con el foco"), "{t}");

    let (t, err) = mcp.herramienta("mycelium_abrir", json!({"objetivo": "Plam"}));
    assert!(err && t.starts_with("NO_ENCONTRADO") && t.contains("Plan — docs/Plan.md"), "{t}");

    let (t, err) = mcp.herramienta("mycelium_abrir", json!({"objetivo": "Plan", "ir_a": {"linea": 0}}));
    assert!(err && t.starts_with("INVALIDO"), "{t}");

    // ── App cerrada ───────────────────────────────────────────────────────
    drop(app);
    std::thread::sleep(std::time::Duration::from_millis(100));
    let (t, err) = mcp.herramienta("mycelium_estado", json!({}));
    assert!(!err && t.starts_with("app: cerrada · control: encendido"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_abrir", json!({"objetivo": "Plan"}));
    assert!(err && t.starts_with("APP_CERRADA"), "{t}");

    // ── Control apagado (se lee del disco en cada llamada) ────────────────
    control(&vault, false);
    let (t, err) = mcp.herramienta("mycelium_abrir", json!({"objetivo": "Plan"}));
    assert!(err && t.starts_with("MCP_DESACTIVADO") && t.contains("Configuración → Vault"), "{t}");

    drop(mcp);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn un_vault_sin_registrar_es_vault_desconocido() {
    let (base, dir_app, _vault) = preparar("sin-registrar");
    let suelta = base.join("suelta");
    std::fs::create_dir_all(&suelta).unwrap();
    let mut mcp = Mcp::lanzar(&dir_app, &suelta);
    mcp.pedir("initialize", json!({}));
    let (t, err) = mcp.herramienta("mycelium_estado", json!({}));
    assert!(err && t.starts_with("VAULT_DESCONOCIDO") && t.contains("Vault de Prueba"), "{t}");
    drop(mcp);
    let _ = std::fs::remove_dir_all(base);
}
