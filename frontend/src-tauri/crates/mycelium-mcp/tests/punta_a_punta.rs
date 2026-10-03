//! Prueba de punta a punta **sin la app** (`FUN-L-09`, partes 1 y 2): el binario
//! real de `mycelium-mcp`, lanzado como lo lanza Claude Code (stdio, con
//! `MYCELIUM_VAULT`), contra un servidor de canal falso que hace de ventana de
//! Mycelium en el mismo pipe que usaría la app.
//!
//! Cubre lo que no cubren los tests unitarios: la resolución del vault desde el
//! entorno contra un `vaults.json` de verdad, el nombre del canal calculado por
//! las dos puntas por separado, y el ciclo app abierta → app cerrada → control
//! apagado. Desde la Parte 2, también el calendario: una app falsa con
//! recordatorios en memoria a la que el agente le crea, lista, completa y borra.
//! Desde la Parte 3, los archivos: renombrar, borrar y restaurar contra un vault
//! en memoria, y una confirmación que el «usuario» acepta y otra que rechaza.
//! Desde la Parte 4, el diccionario del vault: una app falsa con las palabras en
//! memoria a la que se le agrega, lista, quita y rechaza, y el ciclo sin app.

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
    assert_eq!(lista["result"]["tools"].as_array().unwrap().len(), 12);

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

/// Una app falsa con un calendario en memoria: lo justo para ver que lo que
/// escribe una herramienta lo lee la siguiente, por el pipe de verdad.
#[test]
fn el_calendario_de_punta_a_punta() {
    use std::sync::{Arc, Mutex};

    let (base, dir_app, vault) = preparar("calendario");
    control(&vault, true);
    let ruta_registrada = vault.to_string_lossy().to_string();
    let canal = mycelium_vault::canal::nombre_canal(&ruta_registrada, &dir_app);
    let mut mcp = Mcp::lanzar(&dir_app, &vault);
    mcp.pedir("initialize", json!({}));

    let calendario: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let cal = calendario.clone();
    let _app = falso::levantar(canal, move |p| {
        let id = p["id"].clone();
        let a = p["args"].clone();
        let mut cal = cal.lock().unwrap();
        let ok = |r: Value| json!({"id": id, "ok": true, "resultado": r});
        Some(match p["op"].as_str().unwrap_or_default() {
            "recordatorio_crear" => {
                if a["fecha"] == "2026-02-30" {
                    return Some(json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO",
                        "mensaje": "`fecha`: «2026-02-30» no existe en el calendario.", "datos": {"campo": "fecha"}}}));
                }
                let rid = format!("r{}", cal.len() + 1);
                cal.push(json!({"id": rid, "titulo": a["titulo"], "fecha": a["fecha"], "hora": a["hora"], "completada": false}));
                ok(json!({"efecto": format!("Creé «{}».", a["titulo"].as_str().unwrap()), "recordatorio": {"id": rid}}))
            }
            "recordatorios" => {
                let ocurrencias: Vec<Value> = cal
                    .iter()
                    .filter(|r| r["fecha"].as_str() >= a["desde"].as_str() && r["fecha"].as_str() <= a["hasta"].as_str())
                    .map(|r| json!({"id": r["id"], "titulo": r["titulo"], "fecha": r["fecha"], "dia": "vie 2 oct",
                        "hora": r["hora"], "color": "Hifa", "repeticion": "ninguna", "completada": r["completada"], "detalle": ""}))
                    .collect();
                ok(json!({"desde": a["desde"], "hasta": a["hasta"], "ocurrencias": ocurrencias}))
            }
            "recordatorio_completar" => match cal.iter_mut().find(|r| r["id"] == a["id"]) {
                Some(r) => {
                    r["completada"] = json!(true);
                    ok(json!({"efecto": "Marqué como completado.", "id": a["id"]}))
                }
                None => json!({"id": id, "ok": false, "error": {"codigo": "NO_ENCONTRADO", "mensaje": "no existe", "datos": null}}),
            },
            "recordatorio_borrar" => {
                let antes = cal.len();
                cal.retain(|r| r["id"] != a["id"]);
                if cal.len() == antes {
                    json!({"id": id, "ok": false, "error": {"codigo": "NO_ENCONTRADO", "mensaje": "no existe", "datos": null}})
                } else {
                    ok(json!({"efecto": "Borré el recordatorio.", "id": a["id"]}))
                }
            }
            _ => json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}}),
        })
    });

    let (t, err) = mcp.herramienta("mycelium_recordatorio_crear", json!({"titulo": "Médico", "fecha": "2026-10-02", "hora": "09:00"}));
    assert!(!err && t.starts_with("Creé «Médico».") && t.ends_with("id: r1"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_recordatorio_crear", json!({"titulo": "X", "fecha": "2026-02-30"}));
    assert!(err && t.starts_with("INVALIDO: `fecha`"), "{t}");

    let rango = json!({"desde": "2026-10-01", "hasta": "2026-10-07"});
    let (t, err) = mcp.herramienta("mycelium_recordatorios", rango.clone());
    assert!(!err && t.contains("09:00 · «Médico» · Hifa · id r1") && !t.contains("completada"), "{t}");

    let (_, err) = mcp.herramienta("mycelium_recordatorio_completar", json!({"id": "r1", "fecha": "2026-10-02"}));
    assert!(!err);
    let (t, _) = mcp.herramienta("mycelium_recordatorios", rango.clone());
    assert!(t.contains("✓ completada"), "lo completado se lee de vuelta: {t}");

    let (_, err) = mcp.herramienta("mycelium_recordatorio_borrar", json!({"id": "r1"}));
    assert!(!err);
    let (t, _) = mcp.herramienta("mycelium_recordatorios", rango);
    assert!(t.starts_with("No hay recordatorios"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_recordatorio_borrar", json!({"id": "r1"}));
    assert!(err && t.starts_with("NO_ENCONTRADO"), "{t}");
    assert!(calendario.lock().unwrap().is_empty());

    drop(mcp);
    let _ = std::fs::remove_dir_all(base);
}

/// Una app falsa con un vault en memoria (ruta → títulos a los que enlaza) y una
/// papelera: renombrar reescribe los enlaces de las que apuntaban; más de cinco
/// pide confirmación —el «usuario» acepta la primera y rechaza la segunda—, y
/// lo borrado vuelve de la papelera.
#[test]
fn los_archivos_de_punta_a_punta() {
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};

    struct App {
        notas: BTreeMap<String, Vec<String>>,
        papelera: Vec<String>,
        /// Confirmaciones pendientes: id → (el usuario acepta, el pedido).
        pendientes: BTreeMap<String, (bool, Value)>,
        n: usize,
    }

    fn renombrar(app: &mut App, objetivo: &str, nombre: &str) -> Value {
        let enlaces = app.notas.remove(&format!("{objetivo}.md")).unwrap();
        let nuevo = format!("{nombre}.md");
        app.notas.insert(nuevo.clone(), enlaces);
        let mut reescritas = vec![];
        for (ruta, e) in app.notas.iter_mut() {
            if e.iter().any(|t| t == objetivo) {
                e.iter_mut().filter(|t| *t == objetivo).for_each(|t| *t = nombre.to_string());
                reescritas.push(ruta.clone());
            }
        }
        json!({"efecto": format!("Renombré «{objetivo}» a «{nombre}». Reparé los enlaces en {} notas.", reescritas.len()),
               "ruta": nuevo, "reescritas": {"total": reescritas.len(), "notas": reescritas}})
    }

    let (base, dir_app, vault) = preparar("archivos");
    control(&vault, true);
    let ruta_registrada = vault.to_string_lossy().to_string();
    let canal = mycelium_vault::canal::nombre_canal(&ruta_registrada, &dir_app);
    let mut mcp = Mcp::lanzar(&dir_app, &vault);
    mcp.pedir("initialize", json!({}));

    let mut notas = BTreeMap::new();
    notas.insert("Plan.md".to_string(), vec![]);
    notas.insert("Hub.md".to_string(), vec![]);
    for i in 0..2 {
        notas.insert(format!("a{i}.md"), vec!["Plan".to_string()]);
    }
    for i in 0..7 {
        notas.insert(format!("h{i}.md"), vec!["Hub".to_string()]);
    }
    let app = Arc::new(Mutex::new(App { notas, papelera: vec![], pendientes: BTreeMap::new(), n: 0 }));
    let a2 = app.clone();
    let _app = falso::levantar(canal, move |p| {
        let id = p["id"].clone();
        let a = p["args"].clone();
        let mut app = a2.lock().unwrap();
        let ok = |r: Value| json!({"id": id, "ok": true, "resultado": r});
        let err = |c: &str, m: &str| json!({"id": id, "ok": false, "error": {"codigo": c, "mensaje": m, "datos": null}});
        let s = |k: &str| a[k].as_str().unwrap_or_default().to_string();
        Some(match p["op"].as_str().unwrap_or_default() {
            "renombrar" => {
                let (objetivo, nombre) = (s("objetivo"), s("nombre"));
                if nombre.contains(':') {
                    return Some(err("INVALIDO", "`nombre`: Un nombre de archivo no puede llevar :"));
                }
                if !app.notas.contains_key(&format!("{objetivo}.md")) {
                    return Some(err("NO_ENCONTRADO", "no existe"));
                }
                let alcance = app.notas.values().filter(|e| e.iter().any(|t| *t == objetivo)).count();
                if alcance > 5 {
                    app.n += 1;
                    let cid = format!("c{}", app.n);
                    let acepta = app.n == 1;
                    app.pendientes.insert(cid.clone(), (acepta, a.clone()));
                    return Some(ok(json!({"esperando_confirmacion": {"id": cid, "pregunta": "¿Renombrar?"}})));
                }
                ok(renombrar(&mut app, &objetivo, &nombre))
            }
            "confirmacion" => match app.pendientes.remove(&s("id")) {
                Some((true, pedido)) => {
                    let (o, n) = (pedido["objetivo"].as_str().unwrap().to_string(), pedido["nombre"].as_str().unwrap().to_string());
                    ok(renombrar(&mut app, &o, &n))
                }
                Some((false, _)) => err(
                    "RECHAZADO",
                    "El usuario dijo que no a renombrar «Centro»: no se hizo nada. Es una respuesta, no un error para reintentar.",
                ),
                None => err("NO_ENCONTRADO", "no hay"),
            },
            "borrar" => {
                let ruta = format!("{}.md", s("objetivo"));
                if app.notas.remove(&ruta).is_none() {
                    return Some(err("NO_ENCONTRADO", "no existe"));
                }
                app.papelera.push(ruta.clone());
                ok(json!({"efecto": format!("Mandé «{ruta}» a la papelera de Mycelium."), "entrada": ruta}))
            }
            "papelera" if a["accion"] == "restaurar" => {
                let ruta = s("id");
                if !app.papelera.contains(&ruta) {
                    return Some(err("NO_ENCONTRADO", "no está en la papelera"));
                }
                app.papelera.retain(|r| *r != ruta);
                app.notas.insert(ruta.clone(), vec![]);
                ok(json!({"efecto": format!("Restauré «{ruta}»."), "rutas": [ruta]}))
            }
            "papelera" => {
                let entradas: Vec<Value> = app
                    .papelera
                    .iter()
                    .map(|r| json!({"id": r, "titulo": r.trim_end_matches(".md"), "carpeta": "", "eliminada": "2026-10-01T10:00:00Z"}))
                    .collect();
                ok(json!({ "entradas": entradas }))
            }
            _ => err("INVALIDO", "?"),
        })
    });

    // Pocos enlaces: no pregunta.
    let (t, err) = mcp.herramienta("mycelium_renombrar", json!({"objetivo": "Plan", "nombre": "Plan 2026"}));
    assert!(!err && t.contains("Reparé los enlaces en 2 notas") && t.ends_with("ruta: Plan 2026.md"), "{t}");
    assert!(app.lock().unwrap().notas["a0.md"].contains(&"Plan 2026".to_string()), "el enlace se reescribió");

    let (t, err) = mcp.herramienta("mycelium_renombrar", json!({"objetivo": "Plan 2026", "nombre": "a:b"}));
    assert!(err && t.starts_with("INVALIDO"), "{t}");

    // Muchos enlaces: espera la confirmación, y el usuario acepta.
    let (t, err) = mcp.herramienta("mycelium_renombrar", json!({"objetivo": "Hub", "nombre": "Centro"}));
    assert!(!err && t.contains("Reparé los enlaces en 7 notas"), "{t}");
    // Otra vez; ahora el usuario dice que no.
    let (t, err) = mcp.herramienta("mycelium_renombrar", json!({"objetivo": "Centro", "nombre": "Nodo"}));
    assert!(err && t.starts_with("RECHAZADO") && t.contains("no un error para reintentar"), "{t}");
    assert!(app.lock().unwrap().notas.contains_key("Centro.md"), "lo rechazado no se hizo");

    // Borrar y restaurar.
    let (t, err) = mcp.herramienta("mycelium_borrar", json!({"objetivo": "Plan 2026"}));
    assert!(!err && t.contains("papelera"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_papelera", json!({}));
    assert!(!err && t.starts_with("1 entrada en la papelera") && t.contains("id Plan 2026.md"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_papelera", json!({"accion": "restaurar", "id": "Plan 2026.md"}));
    assert!(!err && t.starts_with("Restauré"), "{t}");
    let (t, _) = mcp.herramienta("mycelium_papelera", json!({"accion": "listar"}));
    assert_eq!(t, "La papelera de Mycelium está vacía.");

    drop(mcp);
    let _ = std::fs::remove_dir_all(base);
}

/// Una app falsa con el diccionario del vault en memoria: agregar cuenta las
/// nuevas y rechaza lo que no es una palabra; quitar dice cuáles no estaban;
/// listar las devuelve. Con la app cerrada, la herramienta recuerda que el
/// archivo no se escribe a mano, y no lo crea.
#[test]
fn el_diccionario_de_punta_a_punta() {
    use std::collections::BTreeSet;
    use std::sync::{Arc, Mutex};

    let (base, dir_app, vault) = preparar("diccionario");
    control(&vault, true);
    let ruta_registrada = vault.to_string_lossy().to_string();
    let canal = mycelium_vault::canal::nombre_canal(&ruta_registrada, &dir_app);
    let mut mcp = Mcp::lanzar(&dir_app, &vault);
    mcp.pedir("initialize", json!({}));

    let palabras: Arc<Mutex<BTreeSet<String>>> = Arc::new(Mutex::new(BTreeSet::new()));
    let pal = palabras.clone();
    let app = falso::levantar(canal, move |p| {
        let id = p["id"].clone();
        let a = p["args"].clone();
        let mut pal = pal.lock().unwrap();
        let ok = |r: Value| json!({"id": id, "ok": true, "resultado": r});
        if p["op"] != "diccionario" {
            return Some(json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}}));
        }
        let pedidas: Vec<String> =
            a["palabras"].as_array().map(|l| l.iter().map(|x| x.as_str().unwrap().to_string()).collect()).unwrap_or_default();
        Some(match a["accion"].as_str().unwrap_or("listar") {
            "listar" => ok(json!({"palabras": pal.iter().collect::<Vec<_>>(), "total": pal.len(), "recortado": false})),
            "agregar" => {
                let (mut agregadas, mut ya, mut rechazadas) = (vec![], vec![], vec![]);
                for w in pedidas {
                    if w.contains(' ') {
                        rechazadas.push(json!({"palabra": w, "motivo": "lleva espacios"}));
                    } else if pal.insert(w.clone()) {
                        agregadas.push(w);
                    } else {
                        ya.push(w);
                    }
                }
                ok(json!({"efecto": format!("Agregué {} al diccionario del vault.", agregadas.len()),
                    "agregadas": agregadas, "ya_estaban": ya, "rechazadas": rechazadas, "total": pal.len()}))
            }
            "quitar" => {
                let (mut quitadas, mut no) = (vec![], vec![]);
                for w in pedidas {
                    if pal.remove(&w) {
                        quitadas.push(w);
                    } else {
                        no.push(json!({"palabra": w, "parecida": null}));
                    }
                }
                ok(json!({"efecto": format!("Quité {} del diccionario del vault.", quitadas.len()),
                    "quitadas": quitadas, "no_estaban": no, "rechazadas": [], "total": pal.len()}))
            }
            _ => json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO",
                "mensaje": "`accion`: no es una acción.", "datos": {"campo": "accion"}}}),
        })
    });

    let (t, err) = mcp.herramienta("mycelium_diccionario", json!({}));
    assert!(!err && t == "El diccionario del vault está vacío.", "{t}");
    let (t, err) =
        mcp.herramienta("mycelium_diccionario", json!({"accion": "agregar", "palabras": ["Mycelium", "rizoma", "dos palabras"]}));
    assert!(!err && t.starts_with("Agregué 2") && t.contains("«dos palabras»: lleva espacios"), "{t}");
    let (t, _) = mcp.herramienta("mycelium_diccionario", json!({"accion": "listar"}));
    assert_eq!(t, "El diccionario del vault tiene 2 palabras:\nMycelium, rizoma");
    let (t, err) = mcp.herramienta("mycelium_diccionario", json!({"accion": "quitar", "palabras": ["rizoma", "otra"]}));
    assert!(!err && t.starts_with("Quité 1"), "{t}");
    assert_eq!(palabras.lock().unwrap().iter().cloned().collect::<Vec<_>>(), ["Mycelium"]);
    let (t, err) = mcp.herramienta("mycelium_diccionario", json!({"accion": "borrar"}));
    assert!(err && t.starts_with("INVALIDO: `accion`"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_diccionario", json!(["no", "es", "objeto"]));
    assert!(err && t.starts_with("INVALIDO"), "{t}");

    // Sin la app: APP_CERRADA, y que no escriba el archivo a mano.
    drop(app);
    let (t, err) = mcp.herramienta("mycelium_diccionario", json!({"accion": "agregar", "palabras": ["hifa"]}));
    assert!(err && t.starts_with("APP_CERRADA") && t.contains("no escribas .mycelium/diccionario.txt"), "{t}");
    assert!(!vault.join(".mycelium/diccionario.txt").exists());
    // Con el control apagado: MCP_DESACTIVADO.
    control(&vault, false);
    let (t, err) = mcp.herramienta("mycelium_diccionario", json!({}));
    assert!(err && t.starts_with("MCP_DESACTIVADO"), "{t}");

    drop(mcp);
    let _ = std::fs::remove_dir_all(base);
}
