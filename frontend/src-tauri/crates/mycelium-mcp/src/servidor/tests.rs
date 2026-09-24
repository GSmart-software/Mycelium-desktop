//! El servidor de punta a punta, sin stdio: los mismos mensajes que manda un
//! cliente MCP, procesados por `procesar`.

use super::*;
use crate::herramientas::TOPE_CONEXIONES;
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
    assert!(t.contains("[1] docs/Plan.md#s2 · cita [[Plan]] · Índice propio"), "{t}");
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
        std::fs::create_dir_all(v.raiz.join(rel).parent().unwrap()).unwrap();
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

fn buscar(e: &mut Estado, consulta: &str) -> String {
    let r = uno(
        e,
        json!({"jsonrpc":"2.0","id":8,"method":"tools/call",
               "params":{"name":"vault_buscar","arguments":{"consulta":consulta}}}),
    );
    texto_de(&r).to_string()
}

#[test]
fn cada_resultado_y_cada_lectura_dicen_como_se_cita() {
    // Como `atmosferas.md` en la fase 1b: el H1 dice otra cosa que el nombre.
    let at = "# Atmósferas\n\nIntro de las atmósferas.\n\n## Uso\n\nSe elige una atmósfera.\n".to_string();
    let (mut e, base) = estado_con("citas", &[("docs/atmosferas.md", at)]);
    let t = buscar(&mut e, "atmósfera");
    assert!(t.contains("docs/atmosferas.md#s1 · cita [[atmosferas]] · Atmósferas"), "{t}");
    assert!(t.contains("Al citar: la cita [[…]]"), "{t}");

    // La cita va ANTES del contenido: lo primero después es el `# Atmósferas`.
    for refs in [json!(["atmosferas"]), json!(["docs/atmosferas.md#s2"])] {
        let t = leer(&mut e, refs);
        let cita = t.find("cita [[atmosferas]] (no «Atmósferas»: el # título no es enlace)\n").expect(&t);
        let cuerpo = t.find("Se elige una atmósfera").expect(&t);
        assert!(t.starts_with("── docs/atmosferas.md") && cita < cuerpo, "{t}");
        assert_eq!(t.lines().nth(1).unwrap_or(""), "cita [[atmosferas]] (no «Atmósferas»: el # título no es enlace)");
    }
    // Si el H1 coincide con el nombre, no hay nada que descartar.
    let t = leer(&mut e, json!(["docs/Plan.md"]));
    assert_eq!(t.lines().nth(1), Some("cita [[Plan]]"), "{t}");
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn las_homonimas_se_citan_con_la_carpeta_que_las_distingue() {
    let (mut e, base) = estado_con("homonimas", &[("docs/viejo/Plan.md", "# Plan viejo\nel plan de antes\n".into())]);
    let t = buscar(&mut e, "plan");
    assert!(t.contains("docs/Plan.md#s1 · cita [[Plan]] ·"), "{t}");
    assert!(t.contains("docs/viejo/Plan.md#s1 · cita [[viejo/Plan]] ·"), "{t}");
    // Y la cita con carpeta se puede leer: resuelve como en la app.
    let t = leer(&mut e, json!(["viejo/Plan"]));
    assert!(t.starts_with("── docs/viejo/Plan.md · nota completa") && t.contains("el plan de antes"), "{t}");
    assert!(t.contains("cita [[viejo/Plan]] (no «Plan viejo»"), "{t}");
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn una_nota_sin_entrantes_lo_dice_en_una_linea() {
    let (mut e, base) = estado_con("sin-entrantes", &[]);
    // `Otra` enlaza a `Plan`, y a `Otra` no la enlaza nadie.
    let t = leer(&mut e, json!(["docs/Otra.md"]));
    assert!(t.ends_with("← conexiones: ninguna nota la enlaza\n"), "{t}");
    let t = leer(&mut e, json!(["docs/Plan.md#s2"]));
    assert!(t.ends_with("← conexiones: la enlaza 1 nota:\n  ← [[Otra]] Ver [[…]] y [[Ejemplo]].\n"), "{t}");
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn las_conexiones_van_despues_del_contenido_y_una_vez_por_nota() {
    let (mut e, base) = estado_con(
        "conexiones-orden",
        &[("docs/Nueva.md", "# Nueva\n\nEsta decisión reemplaza a [[Plan]] desde hoy.\n".into())],
    );
    let t = leer(&mut e, json!(["docs/Plan.md#s1", "docs/Plan.md#s2"]));
    let cuerpo = t.find("el MCP tiene su índice").expect(&t);
    let con = t.find("← conexiones: la enlazan 2 notas:").expect(&t);
    assert!(con > cuerpo, "la lista va después del contenido:\n{t}");
    assert_eq!(t.matches("← conexiones").count(), 1, "una sola vez por llamada:\n{t}");
    // Nueva enlaza solo a Plan (específica: 1/1) y va antes que Otra (1/2).
    let nueva = t.find("  ← [[Nueva]] Esta decisión reemplaza a [[…]] desde hoy.").expect(&t);
    let otra = t.find("  ← [[Otra]]").expect(&t);
    assert!(nueva < otra, "{t}");
    // Si la leída también enlaza a la que la cita, la flecha es ↔.
    let t = leer(&mut e, json!(["docs/Otra.md"]));
    assert!(!t.contains("↔"), "{t}");
    let plan = e.vault.as_ref().unwrap().raiz.join("docs/Plan.md");
    std::fs::write(&plan, "# Plan\nver [[Nueva]]\n").unwrap();
    // Un mtime distinto sin esperar al reloj del sistema de archivos.
    let f = std::fs::File::options().write(true).open(&plan).unwrap();
    f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(5)).unwrap();
    drop(f);
    let t = leer(&mut e, json!(["Plan"]));
    assert!(t.contains("  ↔ [[Nueva]] "), "{t}");
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn una_nota_con_mas_entrantes_que_el_tope_lista_solo_las_mas_especificas() {
    // Un hub: 15 notas que solo lo enlazan a él, y un mapa que enlaza a todo.
    let mut archivos: Vec<(String, String)> =
        (0..15).map(|i| (format!("docs/n{i:02}.md"), format!("Nota {i} sobre el [[Hub]].\n"))).collect();
    archivos.push(("docs/Hub.md".into(), "# Hub\ncentro\n".into()));
    let todas: String = (0..15).map(|i| format!("[[n{i:02}]] ")).collect();
    archivos.push(("docs/Mapa.md".into(), format!("{todas}[[Hub]]\n")));
    let refs: Vec<(&str, String)> = archivos.iter().map(|(a, b)| (a.as_str(), b.clone())).collect();
    let (mut e, base) = estado_con("conexiones-tope", &refs);
    let t = leer(&mut e, json!(["Hub"]));
    let desde = t.find("← conexiones").expect(&t);
    let lista = &t[desde..];
    assert!(
        lista.starts_with(&format!(
            "← conexiones: la enlazan 16 notas; las {TOPE_CONEXIONES} que más hablan de ella (el resto: grep -rlF \"[[Hub\" --include=*.md):\n"
        )),
        "{lista}"
    );
    assert_eq!(lista.lines().count(), 1 + TOPE_CONEXIONES, "{lista}");
    assert!(!lista.contains("[[Mapa]]"), "el mapa enlaza a todo: es el menos específico\n{lista}");
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn las_citas_de_las_conexiones_resuelven_a_la_nota_que_enlaza() {
    // Dos homónimas que enlazan a X: cada una tiene que salir con la cita que
    // la app resuelve a ella, no a la otra.
    let (mut e, base) = estado_con(
        "conexiones-citas",
        &[
            ("docs/X.md", "# X\nx\n".into()),
            ("docs/Notas.md", "sobre [[X]]\n".into()),
            ("docs/viejo/Notas.md", "antes, [[X]]\n".into()),
            ("docs/features/atmosferas.md", "# Atmósferas\nusa [[X]]\n".into()),
        ],
    );
    let t = leer(&mut e, json!(["docs/X.md"]));
    let lista = &t[t.find("← conexiones").expect(&t)..];
    let citas: Vec<&str> = lista
        .lines()
        .skip(1)
        .map(|l| {
            let ini = l.find("[[").unwrap() + 2;
            &l[ini..ini + l[ini..].find("]]").unwrap()]
        })
        .collect();
    assert_eq!(citas.len(), 3, "{lista}");
    let a = e.celda.lock().unwrap();
    let ix = &a.as_ref().unwrap().as_ref().unwrap().indice;
    let mut resueltas = Vec::new();
    for c in &citas {
        let (_, titulo) = c.rsplit_once('/').unwrap_or(("", c));
        let homonimas = ix.homonimas(titulo).unwrap();
        let id = if homonimas.len() == 1 {
            homonimas[0].clone()
        } else {
            mycelium_vault::indice::citar::resolver_entre(c, &homonimas).expect(c)
        };
        resueltas.push(id);
    }
    resueltas.sort();
    assert_eq!(resueltas, ["docs/Notas.md", "docs/features/atmosferas.md", "docs/viejo/Notas.md"], "{lista}");
    assert!(citas.contains(&"viejo/Notas") && citas.contains(&"atmosferas"), "{lista}");
    drop(a);
    drop(e);
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn las_descripciones_mandan_a_grep_para_lo_que_no_es_md() {
    let (mut e, base) = estado("descripciones", false);
    let lista = uno(&mut e, json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}));
    let buscar = lista["result"]["tools"][0]["description"].as_str().unwrap();
    assert!(buscar.contains("SOLO las notas .md") && buscar.contains("grep"), "{buscar}");
    assert!(buscar.contains("por detrás del código"), "{buscar}");
    assert!(buscar.contains("CORTAS"), "{buscar}");
    // Cómo se cita: solo lo ve el brazo MCP (el CLAUDE.md es el control).
    assert!(buscar.contains("cita [[nombre]]") && buscar.contains("NO resuelve"), "{buscar}");
    let leer = lista["result"]["tools"][1]["description"].as_str().unwrap();
    assert!(leer.contains("cita [[nombre]]"), "{leer}");
    // La lista de conexiones: qué es y cuándo seguirla.
    assert!(leer.contains("← conexiones") && leer.contains("quién menciona esta nota"), "{leer}");
    let ini = uno(&mut e, json!({"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}));
    let instr = ini["result"]["instructions"].as_str().unwrap();
    assert!(!instr.contains("preferí esto a grep") && instr.contains("grep/Grep"), "{instr}");
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
