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
//! Desde `FUN-M-45` y `FUN-L-30`, las consultas al índice y la salud del vault:
//! el servidor pasa los argumentos y redacta lo que la app calcula.

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
    assert_eq!(lista["result"]["tools"].as_array().unwrap().len(), 20);

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

/// Las consultas al índice (`FUN-M-45`): el servidor pasa los argumentos tal
/// cual a la app (que es quien tiene el índice) y redacta lo que vuelve. Una
/// vista que no existe vuelve como `NO_ENCONTRADO` con las vistas; sin la app,
/// `APP_CERRADA` dice que el índice vive en su ventana.
#[test]
fn las_consultas_de_punta_a_punta() {
    let (base, dir_app, vault) = preparar("consultas");
    control(&vault, true);
    let ruta_registrada = vault.to_string_lossy().to_string();
    let canal = mycelium_vault::canal::nombre_canal(&ruta_registrada, &dir_app);
    let mut mcp = Mcp::lanzar(&dir_app, &vault);
    mcp.pedir("initialize", json!({}));

    let app = falso::levantar(canal, move |p| {
        let id = p["id"].clone();
        let a = p["args"].clone();
        let ok = |r: Value| json!({"id": id, "ok": true, "resultado": r});
        Some(match p["op"].as_str().unwrap_or_default() {
            "buscar" => ok(json!({
                "consulta": a["consulta"], "campo": a["campo"].as_str().unwrap_or("ambos"),
                "desde": a["desde"].as_u64().unwrap_or(0), "hay_mas": true, "siguiente": 1,
                "resultados": [{"ruta": "docs/Plan.md", "titulo": "Plan", "tipo": "markdown", "fragmento": "el «plan»"}]
            })),
            "enlaces" => ok(json!({
                "nota": {"ruta": "docs/Plan.md", "titulo": "Plan", "tipo": "markdown"},
                "total_salientes": 1, "rotos": 1,
                "salientes": [{"texto": "Nada", "tipo": "enlace", "n": 1, "estado": "roto", "destino": null, "lineas": [4]}],
                "total_backlinks": 0, "backlinks": []
            })),
            "base" if a["vista"] == "Otra" => json!({"id": id, "ok": false, "error": {"codigo": "NO_ENCONTRADO",
                "mensaje": "La base no tiene una vista «Otra». Sus vistas: «Tabla».", "datos": {"vistas": ["Tabla"]}}}),
            "base" => ok(json!({
                "base": {"ruta": "P.base", "titulo": "P"}, "vista": "Tabla", "vistas": ["Tabla"],
                "columnas": ["Nombre"], "total": 1, "recortadas_por_vista": 0, "recortadas_por_tope": 0, "avisos": [],
                "filas": [{"ruta": "docs/Plan.md", "celdas": ["Plan"]}]
            })),
            "salud" => ok(json!({
                "alcance": if a["alcance"].is_string() { json!({"tipo": "carpeta", "ruta": a["alcance"]}) } else { json!({"tipo": "vault"}) },
                "notas": 3, "tope": 100,
                "conteos": {"rotos": 1, "embedsRotos": 0, "duplicados": 0, "huerfanas": 1, "sinSalientes": 0, "total": 2},
                "rotos": [{"desde": "docs/Plan.md", "texto": "Nada", "tipo": "enlace", "n": 1, "lineas": [4]}],
                "embeds_rotos": [], "duplicados": [], "sin_salientes": [],
                "huerfanas": [{"ruta": "Suelta.md", "titulo": "Suelta"}]
            })),
            "validar_nota" => ok(json!({
                "nota": {"ruta": "docs/Plan.md", "titulo": "Plan"}, "ok": true,
                "chequeos": [{"id": "titulo_unico", "ok": true, "titulo": "Título único", "detalle": []}]
            })),
            _ => json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}}),
        })
    });

    let (t, err) = mcp.herramienta("mycelium_salud", json!({}));
    assert!(!err && t.starts_with("Salud del vault: 3 notas y 2 problemas."), "{t}");
    assert!(t.contains("docs/Plan.md · línea 4 · [[Nada]]") && t.contains("Suelta — Suelta.md"), "{t}");
    let (t, _) = mcp.herramienta("mycelium_salud", json!({"alcance": "docs"}));
    assert!(t.starts_with("Salud de la carpeta docs/"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_validar_nota", json!({"ruta": "Plan"}));
    assert!(!err && t == "«Plan» (docs/Plan.md): pasa todos los chequeos.\n✓ Título único", "{t}");

    let (t, err) = mcp.herramienta("mycelium_buscar", json!({"consulta": "plan tag:proyecto", "limite": 1}));
    assert!(!err && t.starts_with("1 resultado para «plan tag:proyecto»"), "{t}");
    assert!(t.contains("1. Plan — docs/Plan.md\n   el «plan»") && t.ends_with("`desde: 1`."), "{t}");
    let (t, err) = mcp.herramienta("mycelium_enlaces", json!({"nota": "Plan"}));
    assert!(!err && t.contains("Salientes: 1 (1 roto)") && t.contains("[[Nada]] → ROTO") && t.contains("línea 4"), "{t}");
    assert!(t.contains("(ninguno: nadie la enlaza)"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_base", json!({"ruta": "P"}));
    assert!(!err && t.contains("| Nombre | (archivo) |\n|---|---|\n| Plan | docs/Plan.md |"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_base", json!({"ruta": "P", "vista": "Otra"}));
    assert!(err && t.starts_with("NO_ENCONTRADO: La base no tiene una vista «Otra»"), "{t}");
    let (t, err) = mcp.herramienta("mycelium_buscar", json!("no es un objeto"));
    assert!(err && t.starts_with("INVALIDO"), "{t}");

    drop(app);
    let (t, err) = mcp.herramienta("mycelium_buscar", json!({"consulta": "plan"}));
    assert!(err && t.starts_with("APP_CERRADA") && t.contains("El índice vive en la ventana de Mycelium"), "{t}");
    control(&vault, false);
    let (t, err) = mcp.herramienta("mycelium_enlaces", json!({"nota": "Plan"}));
    assert!(err && t.starts_with("MCP_DESACTIVADO"), "{t}");

    drop(mcp);
    let _ = std::fs::remove_dir_all(base);
}

/// `FUN-L-31`: dos servidores (dos sesiones de Claude Code) contra la misma app
/// falsa. Cada uno se anuncia por su conexión de presencia y manda su sesión en
/// cada pedido; la app falsa lleva el registro como la de verdad (`control.rs`
/// + `lib/sesionesIa.ts`, reducido a lo justo): cada uno ve al otro, con su
/// tarea y su reserva, y al morir uno el otro deja de verlo.
#[test]
fn dos_sesiones_se_ven_entre_si() {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct App {
        /// id de sesión → (conexión de presencia, tarea).
        sesiones: HashMap<String, (u64, Option<String>)>,
        /// (ruta, sesión, motivo).
        reservas: Vec<(String, String, String)>,
    }

    let (base, dir_app, vault) = preparar("sesiones");
    control(&vault, true);
    let canal = mycelium_vault::canal::nombre_canal(&vault.to_string_lossy(), &dir_app);
    let estado = Arc::new(Mutex::new(App::default()));

    // Lo que la app le cuenta a `propia` de las demás.
    fn texto(app: &App, propia: &str) -> String {
        let mut t = format!("Sesiones: {}.", app.sesiones.len());
        let mut otras: Vec<_> = app.sesiones.iter().filter(|(id, _)| id.as_str() != propia).collect();
        otras.sort_by_key(|(id, _)| id.as_str());
        for (id, (_, tarea)) in otras {
            t.push_str(&format!("\nOtra: {id} «{}»", tarea.as_deref().unwrap_or("sin tarea")));
        }
        for (ruta, s, motivo) in app.reservas.iter().filter(|r| r.1 != propia) {
            t.push_str(&format!("\nReservado: {ruta} por {s} («{motivo}»)"));
        }
        t
    }

    let (e1, e2) = (estado.clone(), estado.clone());
    let _app = falso::levantar_con_cierre(
        canal,
        move |p| {
            let id = p["id"].clone();
            let sid = p["sesion"]["id"].as_str().unwrap_or("").to_string();
            let mut app = e1.lock().unwrap();
            let ok = |r: Value| Some(json!({"id": id, "ok": true, "resultado": r}));
            match p["op"].as_str() {
                Some("sesion_abrir") => {
                    let conexion = p["_conexion"].as_u64().unwrap();
                    app.sesiones.insert(sid.clone(), (conexion, None));
                    ok(json!({"sesion": sid}))
                }
                Some("estado") => ok(json!({"etapa": "lista", "paneles": [], "coordinacion": {"texto": texto(&app, &sid)}})),
                Some("sesion") => {
                    let tarea = p["args"]["tarea"].as_str().unwrap().to_string();
                    app.sesiones.get_mut(&sid).expect("la sesión se anunció antes de pedir").1 = Some(tarea.clone());
                    ok(json!({"efecto": format!("Tarea declarada: «{tarea}»."), "coordinacion": {"texto": texto(&app, &sid)}}))
                }
                Some("reservar") => {
                    let ruta = p["args"]["objetivo"].as_str().unwrap().to_string();
                    let motivo = p["args"]["motivo"].as_str().unwrap().to_string();
                    let ajena = app.reservas.iter().find(|r| r.0 == ruta && r.1 != sid).cloned();
                    app.reservas.push((ruta.clone(), sid.clone(), motivo));
                    let efecto = match ajena {
                        Some((_, quien, por)) => format!("Reservé {ruta}. Ojo: ya lo tiene {quien} («{por}»)."),
                        None => format!("Reservé {ruta}."),
                    };
                    ok(json!({"efecto": efecto, "coordinacion": {"texto": texto(&app, &sid)}}))
                }
                _ => Some(json!({"id": id, "ok": false, "error": {"codigo": "INVALIDO", "mensaje": "?", "datos": null}})),
            }
        },
        move |conexion| {
            // Se cortó una conexión: si sostenía una sesión, murió (con sus reservas).
            let mut app = e2.lock().unwrap();
            let muertas: Vec<String> =
                app.sesiones.iter().filter(|(_, (c, _))| *c == conexion).map(|(id, _)| id.clone()).collect();
            for id in &muertas {
                app.sesiones.remove(id);
                app.reservas.retain(|r| &r.1 != id);
            }
        },
    );

    let mut uno = Mcp::lanzar(&dir_app, &vault);
    let mut dos = Mcp::lanzar(&dir_app, &vault);
    uno.pedir("initialize", json!({"protocolVersion": "2025-06-18", "clientInfo": {"name": "claude-code", "version": "2.1"}}));
    dos.pedir("initialize", json!({"protocolVersion": "2025-06-18", "clientInfo": {"name": "claude-code", "version": "2.1"}}));

    // Las presencias se abren en un hilo de cada servidor: un instante.
    let limite = Instant::now() + Duration::from_secs(5);
    while estado.lock().unwrap().sesiones.len() < 2 {
        assert!(Instant::now() < limite, "las dos sesiones no se anunciaron");
        std::thread::sleep(Duration::from_millis(20));
    }
    let ids: Vec<String> = {
        let app = estado.lock().unwrap();
        let mut v: Vec<String> = app.sesiones.keys().cloned().collect();
        v.sort();
        v
    };
    assert_ne!(ids[0], ids[1], "cada proceso es una sesión distinta");

    let (t, err) = uno.herramienta("mycelium_sesion", json!({"tarea": "Reorganizar docs"}));
    assert!(!err && t.starts_with("Tarea declarada: «Reorganizar docs».") && t.contains("Sesiones: 2."), "{t}");
    let (t, err) = uno.herramienta("mycelium_reservar", json!({"objetivo": "docs/Plan.md", "motivo": "reescribirla"}));
    assert!(!err && t.starts_with("Reservé docs/Plan.md."), "{t}");

    // La otra sesión ve a la primera, con su tarea y su reserva.
    let (t, err) = dos.herramienta("mycelium_estado", json!({}));
    assert!(!err && t.starts_with("app: abierta"), "{t}");
    assert!(t.contains("«Reorganizar docs»") && t.contains("Reservado: docs/Plan.md") && t.contains("«reescribirla»"), "{t}");
    // Y reservar lo mismo se concede, avisando quién lo tiene.
    let (t, err) = dos.herramienta("mycelium_reservar", json!({"objetivo": "docs/Plan.md", "motivo": "corregir"}));
    assert!(!err && t.contains("Ojo: ya lo tiene") && t.contains("«reescribirla»"), "{t}");
    // La primera ve a la segunda (sin tarea) y su reserva.
    let (t, _) = uno.herramienta("mycelium_estado", json!({}));
    assert!(t.contains("«sin tarea»") && t.contains("«corregir»"), "{t}");

    // Muere la primera: su presencia se corta y la otra deja de verla.
    drop(uno);
    let limite = Instant::now() + Duration::from_secs(5);
    while estado.lock().unwrap().sesiones.len() > 1 {
        assert!(Instant::now() < limite, "la sesión muerta no se dio de baja");
        std::thread::sleep(Duration::from_millis(20));
    }
    let (t, _) = dos.herramienta("mycelium_estado", json!({}));
    assert!(t.contains("Sesiones: 1.") && !t.contains("Reorganizar docs") && !t.contains("reescribirla"), "{t}");

    drop(dos);
    let _ = std::fs::remove_dir_all(base);
}
