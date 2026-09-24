//! Las dos herramientas de la fase 1 y su formato de respuesta
//! (`MCP de Mycelium - memoria` § 7).
//!
//! Tres decisiones del formato, todas para gastar menos contexto:
//!
//! 1. **Texto compacto, no JSON**: diez objetos JSON repiten las claves diez
//!    veces; la `ref` está igual de a mano para copiar.
//! 2. **Las migas van siempre**: `BACKLOG › Grandes › FUN-L-09` dice qué es sin
//!    abrir nada.
//! 3. **La última línea enseña el próximo paso**, en vez de confiar en que el
//!    agente recuerde la descripción de la herramienta.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::sync::atomic::Ordering;
use std::time::Instant;

use mycelium_vault::indice::buscar::{Ambito, Busqueda, Consulta, Filtros, Modo, Senales};
use mycelium_vault::indice::leer::SeccionInfo;
use mycelium_vault::indice::{EstadoNota, Revalidacion};
use mycelium_vault::markdown::SEPARADOR_MIGAS;
use serde_json::{json, Value};

use crate::bitacora;
use crate::protocolo::texto;
use crate::servidor::{Abierto, Estado};

/// Una nota más grande que esto, pedida entera, devuelve su índice de
/// secciones en vez del texto (§ 7: «dice lo que cuesta antes de cobrarlo»).
///
/// **20 KB ≈ 5.000 tokens** (diagnóstico de la fase 1, causa 3). Era 8 KB, y la
/// base ganó justamente leyendo notas enteras (mediana de 27.500 caracteres por
/// corrida). La cota sale del costo, no de una nota: 5.000 tokens es lo que el
/// MCP metió en contexto en una corrida **entera** (mediana 5.533), así que una
/// lectura de nota completa puede como mucho duplicar esa mediana y sigue lejos
/// de los 14.809 de la base. Lo que se pierde: una nota de 8–20 KB (24 de las
/// 115 del corpus) pedida sin `#sN` cuesta 2.000–5.000 tokens en vez del índice
/// (~300); es parte de la ventaja de costo (`K = 0,53`) que se entrega a cambio
/// de no perder el dato que vive en otra sección. Las grandes de verdad
/// (BACKLOG, bugs-progreso, el catálogo de defectos) siguen detrás del índice.
pub const TOPE_NOTA_ENTERA: usize = 20 * 1024;

/// Cuántas notas que enlazan a la leída se listan al final de la lectura
/// (`MCP de Mycelium - memoria` § 16).
///
/// **10 es el percentil 75** de entrantes por nota en el corpus (115 notas `.md`:
/// mediana 7, p75 10, p90 21, máximo 67 en el mapa y 61 en el BACKLOG): tres de
/// cada cuatro notas salen con la lista **completa**, que es lo que pide una
/// enumeración. Medido sobre las 115: ~26 tokens por línea, la lista entera
/// cuesta ≈183 tokens de mediana y ≈342 como máximo —un 20 % de la lectura
/// mediana (≈1.659) y un 6 % de la corrida mediana del MCP (≈5.717)—: un hub no
/// convierte la lectura en cien líneas. Lo que queda afuera se cuenta, y la
/// cabecera dice cómo pedirlo con `grep`.
pub const TOPE_CONEXIONES: usize = 10;

/// Caracteres de texto alrededor del enlace en cada línea de conexión: lo que
/// la nota que enlaza **dice** de la leída («reemplaza a …», «DEF-099 · …»).
/// Con la cita y la flecha, una línea queda en ~26 tokens (medido).
///
/// Por qué el texto y no el encabezado de la sección donde está el enlace: un
/// 34 % de los enlaces del corpus viven bajo `## Relacionadas`, que no dice
/// nada; y el `# Título` de la nota que enlaza casi siempre repite su nombre,
/// que ya va en la cita. El texto dice la **relación** («reemplaza a», «el CA7
/// de», «DEF-099 · …»), que es lo que decide si vale la pena abrirla.
const ANCHO_FRAGMENTO: usize = 80;

/// Un fragmento más corto que esto («Ver [[…]].») no dice nada por sí solo:
/// se le antepone el encabezado de la sección donde está el enlace.
const MINIMO_FRAGMENTO: usize = 25;

pub fn definiciones() -> Value {
    json!([
        {
            "name": "vault_buscar",
            "title": "Buscar en el vault",
            "description": "Busca en las notas .md del vault y devuelve PREVIEWS de secciones (no el \
texto): por resultado, una ref `ruta#sN`, las migas `Nota › H2 › H3` y un fragmento con las \
coincidencias entre «». Alcanza con que una sección tenga UNO de los términos; primero salen las que \
tienen más (y los más raros), después ordena BM25. Prefijo: «enlace» encuentra «enlaces»; \
\"entre comillas\" busca la frase. Consultas CORTAS: 2 o 3 términos distintivos, no la pregunta \
entera; si no aparece lo que buscás, cambiá o sacá términos en vez de agregar. Después, vault_leer \
con las refs que interesen.\n\
CITAS: cada resultado trae `cita [[nombre]]`. Citá cada nota EXACTAMENTE así: es el nombre del \
archivo, lo único que resuelve como [[enlace]]; el # título visible (p. ej. «Atmósferas» para \
atmosferas.md) NO resuelve.\n\
IMPORTANTE: el índice tiene SOLO las notas .md. El código, la configuración y los otros tipos de \
archivo (.ts, .rs, .json, .toml, .canvas, .base…) NO están: buscalos con grep/Grep y leelos con \
Read. Y la documentación puede ir por detrás del código: si la pregunta es cómo funciona algo HOY, \
confirmalo en el código antes de afirmarlo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "consulta": { "type": "string", "description": "Palabras o \"frases\" a buscar. Puede ir vacía si hay filtros." },
                    "filtros": {
                        "type": "object",
                        "properties": {
                            "propiedades": { "type": "object", "additionalProperties": { "type": "string" }, "description": "clave: valor del frontmatter (sin distinguir mayúsculas)" },
                            "tags": { "type": "array", "items": { "type": "string" }, "description": "Etiquetas que la nota tiene que tener todas" },
                            "carpeta": { "type": "string", "description": "Solo notas bajo esta carpeta (ruta relativa al vault)" },
                            "tipo": { "type": "string", "enum": ["markdown", "canvas", "base", "excalidraw", "drawio"] }
                        }
                    },
                    "cerca_de": { "type": "string", "description": "Nota (ruta o título) en la que estás trabajando: calcula la señal de proximidad en el grafo" },
                    "ambito": { "type": "string", "enum": ["secciones", "notas"], "description": "secciones (defecto) o notas: una fila por nota, su mejor sección" },
                    "limite": { "type": "integer", "minimum": 1, "maximum": 50, "description": "Cuántos resultados (10 por defecto)" }
                },
                "required": ["consulta"]
            },
            "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "vault_leer",
            "title": "Leer del vault",
            "description": "Lee del disco, al día, las secciones o notas pedidas. Una ref `ruta#sN` \
(la que da vault_buscar) devuelve esa sección con sus migas, su rango de líneas y a qué notas enlaza. \
Una ruta o título de nota sin #sN devuelve la nota ENTERA si pesa hasta 20 KB (≈5.000 tokens); si \
es más grande, el índice COMPLETO de sus secciones (todas, con su ref y su tamaño) y el costo de \
leerla entera (forzar=true para pagarlo). Si una sección no alcanza —el porqué, el costo real o una \
enumeración suelen estar en otra sección de la misma nota—, pedí la nota o las secciones vecinas \
(contexto=1). Solo .md: el código se lee con Read. Cada lectura empieza con `cita [[nombre]]`: \
citá la nota así, no por el # título que viene después.\n\
CONEXIONES: cada lectura TERMINA con `← conexiones`: cuántas notas enlazan a la leída y, de las que \
más hablan de ella (hasta 10), su cita y el texto alrededor del enlace, que dice QUÉ dice esa nota de \
esta. `↔` = la leída también la enlaza. Es lo que grep no encuentra: quién menciona esta nota. \
Seguila (vault_leer con esa cita) cuando el texto sugiere que la corrige, la reemplaza o la \
actualiza —una decisión posterior, un defecto, una versión—, o cuando la pregunta pide TODO lo que \
toca un tema. Si no, no hace falta abrirlas.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "refs": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 10, "description": "Refs `ruta#sN`, rutas o títulos de nota" },
                    "contexto": { "type": "integer", "enum": [0, 1, 2], "description": "Cuántas secciones vecinas sumar a cada lado (0 por defecto)" },
                    "forzar": { "type": "boolean", "description": "Devolver la nota entera aunque sea grande" }
                },
                "required": ["refs"]
            },
            "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false }
        }
    ])
}

/// Ejecuta una herramienta. `None` si no existe.
pub fn llamar(estado: &mut Estado, nombre: &str, args: &Value) -> Option<Value> {
    if nombre != "vault_buscar" && nombre != "vault_leer" {
        return None;
    }
    let v = match &estado.vault {
        Ok(v) => v.clone(),
        Err(msg) => return Some(texto(msg.clone(), true)),
    };
    let mut guarda = match estado.celda.lock() {
        Ok(g) => g,
        Err(_) => return Some(texto("INDICE_NO_DISPONIBLE: el índice quedó inconsistente; reiniciá el servidor.".into(), true)),
    };
    let abierto = match guarda.as_mut() {
        None => {
            let hechas = estado.progreso.hechas.load(Ordering::Relaxed);
            let total = estado.progreso.total.load(Ordering::Relaxed);
            let avance = if total > 0 { format!(" ({hechas}/{total} notas)") } else { String::new() };
            return Some(texto(
                format!(
                    "INDEXANDO: primera indexación del vault «{}» en curso{avance}. Probá de nuevo en unos \
                     segundos; mientras tanto, grep.",
                    v.registrado.nombre
                ),
                true,
            ));
        }
        Some(Err(msg)) => return Some(texto(msg.clone(), true)),
        Some(Ok(a)) => a,
    };

    // Revalidación perezosa antes de cada consulta (§ 9): lo que se responde
    // refleja el disco de este instante.
    let reval = match abierto.indice.revalidar_si_hace_falta() {
        Ok(r) => r,
        Err(err) => {
            return Some(texto(
                format!("INDICE_NO_DISPONIBLE: no se pudo revalidar el índice ({err}). Usá grep."),
                true,
            ))
        }
    };

    let r = if nombre == "vault_buscar" {
        buscar(abierto, &v.registrado.ruta, args, reval.as_ref())
    } else {
        leer(abierto, args)
    };
    Some(match r {
        Ok(t) => texto(t, false),
        Err(msg) => texto(msg, true),
    })
}

// ── vault_buscar ────────────────────────────────────────────────────────────

fn consulta_de(args: &Value) -> Result<Consulta, String> {
    let texto = args.get("consulta").and_then(Value::as_str).unwrap_or("").to_string();
    let mut filtros = Filtros::default();
    if let Some(f) = args.get("filtros").filter(|f| f.is_object()) {
        if let Some(p) = f.get("propiedades").and_then(Value::as_object) {
            for (k, val) in p {
                let val = match val {
                    Value::String(s) => s.clone(),
                    otro => otro.to_string(),
                };
                filtros.propiedades.push((k.clone(), val));
            }
        }
        if let Some(t) = f.get("tags").and_then(Value::as_array) {
            filtros.tags = t.iter().filter_map(Value::as_str).map(str::to_string).collect();
        }
        filtros.carpeta = f.get("carpeta").and_then(Value::as_str).map(str::to_string);
        filtros.tipo = f.get("tipo").and_then(Value::as_str).map(str::to_string);
    }
    let ambito = match args.get("ambito").and_then(Value::as_str) {
        None | Some("secciones") => Ambito::Secciones,
        Some("notas") => Ambito::Notas,
        Some(otro) => return Err(format!("ambito inválido: «{otro}» (secciones | notas)")),
    };
    let limite = args.get("limite").and_then(Value::as_u64).unwrap_or(10).clamp(1, 50) as usize;
    Ok(Consulta {
        texto,
        filtros,
        cerca_de: args.get("cerca_de").and_then(Value::as_str).map(str::to_string),
        ambito,
        limite,
    })
}

fn buscar(a: &mut Abierto, vault: &str, args: &Value, reval: Option<&Revalidacion>) -> Result<String, String> {
    let c = consulta_de(args)?;
    let t0 = Instant::now();
    let b = a.indice.buscar(&c)?;
    let ms = t0.elapsed().as_millis();
    bitacora::registrar(&a.bitacora, vault, &c, &b, ms);
    let mut citas = HashMap::new();
    for r in &b.resultados {
        if !citas.contains_key(&r.nota_id) {
            citas.insert(r.nota_id.clone(), cita(&a.indice.cita(&r.nota_id, &r.titulo)?));
        }
    }
    Ok(formatear_busqueda(&c, &b, &citas, &frescura(a, reval), a.de_respaldo))
}

/// `cita [[atmosferas]]`: el destino de `[[enlace]]` que la app resuelve a esa
/// nota (evaluación § 13). Es el **nombre del archivo**, no el `# Título`:
/// citar «Atmósferas» deja un enlace que no lleva a ningún lado. Con homónimas
/// lleva la carpeta justa (`viejo/Plan`), como las desambigua la app; si ni la
/// ruta entera alcanza, lo dice.
fn cita((destino, resuelve): &(String, bool)) -> String {
    if *resuelve {
        format!("cita [[{destino}]]")
    } else {
        format!("cita [[{destino}]] (ambigua: otra nota solo difiere en mayúsculas)")
    }
}

/// «índice al día (…)»: cuándo se comprobó el disco por última vez.
fn frescura(a: &Abierto, reval: Option<&Revalidacion>) -> String {
    match reval {
        Some(r) if r.reindexadas + r.borradas > 0 => format!(
            "índice al día (revalidado ahora: {} reindexada{}, {} borrada{})",
            r.reindexadas,
            if r.reindexadas == 1 { "" } else { "s" },
            r.borradas,
            if r.borradas == 1 { "" } else { "s" }
        ),
        Some(_) => "índice al día (revalidado ahora)".into(),
        None => {
            let s = a.indice.desde_ultima_comprobacion().map(|d| d.as_secs()).unwrap_or(0);
            format!("índice al día (revalidado hace {s} s)")
        }
    }
}

/// `0.92` → `.92`; `1` → `1`; `0` → `0`.
fn corto(x: f64) -> String {
    if x >= 0.995 {
        return "1".into();
    }
    if x < 0.005 {
        return "0".into();
    }
    format!("{x:.2}").trim_start_matches('0').to_string()
}

/// Las cinco señales en orden fijo (`rel pop prox rec anc`), sin nombres: la
/// leyenda va una sola vez en la cabecera. Diez veces los nombres son ~80
/// tokens que no le sirven al agente; los valores sí quedan, para quien
/// calibre, y completos en el registro de búsquedas.
fn senales(s: &Senales) -> String {
    format!("[{} {} {} {} {}]", corto(s.rel), corto(s.pop), corto(s.prox), corto(s.rec), corto(s.anc))
}

/// Las migas con `›`, que se lee mejor y cuesta lo mismo.
fn migas(ruta: &str) -> String {
    ruta.replace(SEPARADOR_MIGAS, " › ")
}

/// Las migas de un preview **sin el título de la nota**: ya está en la ref
/// (`docs/BACKLOG.md#s58`), repetirlo son tokens sin información.
fn migas_sin_titulo(ruta: &str, titulo: &str) -> String {
    let prefijo = format!("{titulo}{SEPARADOR_MIGAS}");
    match ruta.strip_prefix(&prefijo) {
        Some(resto) => migas(resto),
        None => migas(ruta),
    }
}

/// Colapsa espacios y saltos, quita el énfasis y los acentos graves (el
/// preview no los necesita), y corta a `max` caracteres.
fn una_linea(s: &str, max: usize) -> String {
    let s = s.replace("**", "").replace('`', "");
    let limpio = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if limpio.chars().count() <= max {
        return limpio;
    }
    let mut out: String = limpio.chars().take(max).collect();
    out.push('…');
    out
}

fn formatear_busqueda(
    c: &Consulta,
    b: &Busqueda,
    citas: &HashMap<String, String>,
    frescura: &str,
    de_respaldo: bool,
) -> String {
    let mut o = String::new();
    let unidad = if c.ambito == Ambito::Notas { "notas" } else { "resultados" };
    let ausentes = || b.sin_coincidencias.iter().map(|t| format!("«{t}»")).collect::<Vec<_>>().join(", ");
    if b.resultados.is_empty() {
        let _ = writeln!(o, "0 resultados para «{}» · {frescura}", c.texto);
        let _ = writeln!(
            o,
            "\nNinguna sección del vault tiene esos términos{}. Probá con otras palabras (las del vault: \
             títulos, tags) o sin filtros. Si es código o configuración, no está en el índice: grep. Si el \
             vault no tiene la respuesta, decilo en vez de suponer.",
            if c.filtros.vacio() { "" } else { " (con esos filtros)" }
        );
        return o;
    }
    let completos = if b.modo == Modo::Filtros || b.terminos_presentes() < 2 {
        String::new()
    } else {
        format!(" ({} con todos los términos)", b.completos)
    };
    let _ = writeln!(o, "{} {unidad}{completos} · mostrando {} · {frescura}", b.total, b.resultados.len());
    if !b.sin_coincidencias.is_empty() {
        let _ = writeln!(o, "Sin coincidencias en el vault: {} (probá otra palabra para eso).", ausentes());
    }
    if de_respaldo {
        let _ = writeln!(o, "(índice en el directorio temporal: el app-data no se pudo escribir)");
    }
    if b.modo != Modo::Filtros {
        let _ = writeln!(o, "[señales: rel pop prox rec anc — solo rel ordena]");
    }
    for (i, r) in b.resultados.iter().enumerate() {
        let parte = if r.parcial { " (parte)" } else { "" };
        let m = migas_sin_titulo(&r.ruta_encabezados, &r.titulo);
        let ct = citas.get(&r.nota_id).map(String::as_str).unwrap_or("");
        let _ = writeln!(o, "\n[{}] {} · {ct} · {m}{parte}", i + 1, r.referencia());
        let frag = una_linea(&r.fragmento, 160);
        if b.modo == Modo::Filtros {
            let _ = writeln!(o, "    {frag}");
        } else {
            let _ = writeln!(o, "    {frag} {}", senales(&r.senales));
        }
    }
    let _ = writeln!(
        o,
        "\nDetalle: vault_leer(refs=[…], hasta 10 a la vez) · Contexto: contexto=1 · Al citar: la cita [[…]] de cada \
         resultado, no el # título"
    );
    o
}

// ── vault_leer ──────────────────────────────────────────────────────────────

/// `31600` → `31.600`.
fn miles(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(ch);
    }
    out
}

/// Tokens estimados como en la nota: 4 bytes por token (un piso en español).
fn tokens(bytes: usize) -> String {
    format!("≈{} tokens", miles(bytes.div_ceil(4)))
}

fn kb(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0).replace('.', ",")
    }
}

/// Una `ref` partida: la nota y, si la trae, el orden de la sección.
fn partir_ref(r: &str) -> (&str, Option<usize>) {
    if let Some(i) = r.rfind("#s") {
        if let Ok(n) = r[i + 2..].parse::<usize>() {
            return (&r[..i], Some(n));
        }
    }
    (r, None)
}

fn leer(a: &mut Abierto, args: &Value) -> Result<String, String> {
    let refs: Vec<String> = match args.get("refs") {
        Some(Value::Array(l)) => l.iter().filter_map(Value::as_str).map(str::to_string).collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => vec![],
    };
    if refs.is_empty() {
        return Err("Pasá al menos una ref en `refs` (`ruta#sN`, ruta o título).".into());
    }
    if refs.len() > 10 {
        return Err(format!("Hasta 10 refs por llamada (pasaste {}).", refs.len()));
    }
    let contexto = args.get("contexto").and_then(Value::as_u64).unwrap_or(0).min(2) as usize;
    let forzar = args.get("forzar").and_then(Value::as_bool).unwrap_or(false);

    // Cada bloque con la nota que leyó (ninguna si fue un error).
    let mut bloques: Vec<(Option<String>, String)> = Vec::new();
    for r in &refs {
        match leer_una(a, r, contexto, forzar) {
            Ok((id, t)) => bloques.push((Some(id), t)),
            Err(msg) => bloques.push((None, format!("── {r}\n{msg}\n"))),
        }
    }
    // Las conexiones de una nota van UNA vez por llamada —pedir tres secciones
    // de la misma nota no repite la lista tres veces— y al final de su ÚLTIMO
    // bloque: siempre después de todo el contenido que se leyó de ella.
    let mut o = String::new();
    for (i, (id, t)) in bloques.iter().enumerate() {
        if i > 0 {
            o.push('\n');
        }
        o.push_str(t);
        if let Some(id) = id {
            if !bloques[i + 1..].iter().any(|(otro, _)| otro.as_ref() == Some(id)) {
                o.push_str(&conexiones(a, id)?);
            }
        }
    }
    Ok(o)
}

fn leer_una(
    a: &mut Abierto,
    r: &str,
    contexto: usize,
    forzar: bool,
) -> Result<(String, String), String> {
    let (nota, orden) = partir_ref(r);
    let candidatas = a.indice.resolver_nota(nota)?;
    let id = match candidatas.as_slice() {
        [] => return Err(format!("No hay ninguna nota «{nota}» en el vault. Buscala con vault_buscar.")),
        [(id, _)] => id.clone(),
        varias => {
            let lista: Vec<String> = varias.iter().map(|(id, _)| format!("  - {id}")).collect();
            return Err(format!(
                "«{nota}» es ambiguo: hay {} notas con ese título (los títulos deberían ser únicos). \
                 Pedí una por su ruta:\n{}",
                varias.len(),
                lista.join("\n")
            ));
        }
    };

    // Antes de resolver la ref contra el índice, la nota se revalida sola: si
    // cambió en disco desde la búsqueda, las líneas indexadas ya no son las de
    // esa sección (revisión crítica § 2.5).
    let estado = a.indice.revalidar_nota(&id)?;
    if estado == EstadoNota::Borrada {
        return Err(format!("{id} ya no existe en disco (se borró o se movió)."));
    }
    let aviso = if estado == EstadoNota::Reindexada {
        "(la nota cambió en disco desde la última indexación: se reindexó y lo de abajo es lo de ahora)\n"
    } else {
        ""
    };
    let info = a.indice.nota(&id)?.ok_or_else(|| format!("{id} no está en el índice."))?;
    let secciones = a.indice.secciones_de(&id)?;

    match orden {
        Some(n) => {
            let Some(pos) = secciones.iter().position(|s| s.orden == n) else {
                let cuantas = match secciones.len() {
                    1 => "1 sección".to_string(),
                    k => format!("{k} secciones"),
                };
                return Err(format!(
                    "{id}#s{n}: esa sección no existe (la nota tiene {cuantas}). Pedí {id} sin #sN para ver \
                     su índice."
                ));
            };
            let desde = pos.saturating_sub(contexto);
            let hasta = (pos + contexto).min(secciones.len() - 1);
            let tramo = &secciones[desde..=hasta];
            let ini = tramo[0].linea_ini;
            let fin = tramo[tramo.len() - 1].linea_fin;
            let cuerpo = a.indice.leer_lineas(&id, ini, fin)?;
            let s = &secciones[pos];
            let mut o = String::new();
            let extra = if tramo.len() > 1 {
                format!(" (+ contexto: #s{}–#s{})", tramo[0].orden, tramo[tramo.len() - 1].orden)
            } else {
                String::new()
            };
            let _ = writeln!(
                o,
                "── {id}#s{n} · {}{extra} · L{ini}–{fin} · {}",
                migas_sin_titulo(&s.ruta_encabezados, &info.titulo),
                tokens(cuerpo.len())
            );
            o.push_str(&linea_cita(a, &id, &info.titulo, &secciones)?);
            o.push_str(aviso);
            o.push_str(&cuerpo);
            o.push('\n');
            let ordenes: Vec<usize> = tramo.iter().map(|s| s.orden).collect();
            o.push_str(&enlaces(a, &id, &ordenes)?);
            o.push_str(&pista_nota_entera(&id, info.bytes, secciones.len(), tramo.len()));
            Ok((id, o))
        }
        None => {
            let o = leer_nota(a, &id, &info.titulo, info.bytes, &secciones, forzar, aviso)?;
            Ok((id, o))
        }
    }
}

/// Quién enlaza a esta nota (`MCP de Mycelium - memoria` § 16): cuántas notas en
/// total y, de las [`TOPE_CONEXIONES`] más específicas, cómo se citan y qué
/// dicen de ella.
///
/// **Solo los entrantes.** Los salientes ya están en el texto que se acaba de
/// leer y en la línea `→ enlaza a:`; los entrantes son lo que `grep` no da
/// barato (y da mal: `grep "\[\[Título"` pierde `[[Carpeta/Título]]` y el alias
/// escapado en tablas). Si la nota leída **también** enlaza a la que la cita, la
/// línea va con `↔` en vez de `←`: es una arista que el agente ya vio de un
/// lado.
fn conexiones(a: &Abierto, id: &str) -> Result<String, String> {
    let Some(info) = a.indice.nota(id)? else {
        return Ok(String::new());
    };
    let titulo = info.titulo.as_str();
    let secciones = a.indice.secciones_de(id)?;
    let entrantes = a.indice.entrantes(id)?;
    if entrantes.is_empty() {
        return Ok("← conexiones: ninguna nota la enlaza\n".into());
    }
    let todas: Vec<usize> = secciones.iter().map(|s| s.orden).collect();
    let sale_a: HashSet<String> =
        a.indice.salientes(id, &todas)?.into_iter().flat_map(|s| s.resuelve_a).collect();
    let (destino, _) = a.indice.cita(id, titulo)?;
    let total = entrantes.len();
    let mut o = String::new();
    if total <= TOPE_CONEXIONES {
        let _ = writeln!(o, "← conexiones: la enlaza{} {total} nota{}:", if total == 1 { "" } else { "n" }, if total == 1 { "" } else { "s" });
    } else {
        let _ = writeln!(
            o,
            "← conexiones: la enlazan {total} notas; las {TOPE_CONEXIONES} que más hablan de ella (el resto: grep -rlF \"[[{destino}\" --include=*.md):"
        );
    }
    let titulo_norm = titulo.to_lowercase();
    for en in entrantes.iter().take(TOPE_CONEXIONES) {
        let flecha = if sale_a.contains(&en.origen) { "↔" } else { "←" };
        let ct = cita(&a.indice.cita(&en.origen, &en.titulo)?);
        let ct = ct.strip_prefix("cita ").unwrap_or(&ct);
        let ini = en.linea.saturating_sub(1).max(1);
        let lineas = a.indice.leer_lineas(&en.origen, ini, en.linea + 1).unwrap_or_default();
        let lineas: Vec<&str> = lineas.split('\n').collect();
        // Las migas de la sección donde está el enlace: solo cuando el texto no
        // alcanza (un «Ver [[…]].» suelto) o el archivo cambió desde que se
        // indexó y el enlace ya no está en esa línea.
        let migas_del_enlace = || {
            a.indice
                .secciones_de(&en.origen)
                .ok()?
                .into_iter()
                .find(|s| s.orden == en.seccion_orden && s.nivel > 0)
                .map(|s| migas_sin_titulo(&s.ruta_encabezados, &en.titulo))
        };
        let frag = match fragmento(&lineas, en.linea - ini, &titulo_norm, en.alias.as_deref(), ANCHO_FRAGMENTO) {
            Some(f) if f.chars().count() >= MINIMO_FRAGMENTO => f,
            Some(f) => match migas_del_enlace() {
                Some(m) => format!("{m}: {f}"),
                None => f,
            },
            None => migas_del_enlace().unwrap_or_default(),
        };
        let _ = writeln!(o, "  {flecha} {ct} {frag}");
    }
    Ok(o)
}

/// ¿La línea es parte de un párrafo de prosa (que puede seguir en la de al
/// lado) y no un ítem, una fila, un encabezado o un bloque de código?
fn es_prosa(l: &str) -> bool {
    let t = l.trim_start_matches(|c: char| c == '>' || c.is_whitespace());
    !(t.is_empty()
        || t.starts_with('#')
        || t.starts_with('|')
        || t.starts_with("```")
        || t.starts_with("- ")
        || t.starts_with("* ")
        || t.starts_with("+ ")
        || t.starts_with("[!")
        || t.split_once(". ").is_some_and(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())))
}

/// Limpia un trozo para una sola línea: sin marcas de lista, cita, encabezado ni
/// énfasis, y las celdas de una tabla separadas por `·`.
fn limpiar(s: &str) -> String {
    let s = s.replace("**", "").replace('`', "");
    let t = s.trim_start_matches(|c: char| c == '>' || c == '#' || c.is_whitespace());
    let t = ["- ", "* ", "+ "].iter().find_map(|m| t.strip_prefix(m)).unwrap_or(t);
    // Lo que queda antes de un enlace que abre el ítem es la marca sola.
    let t = if matches!(t.trim(), "-" | "*" | "+") { "" } else { t };
    let t = t.trim_matches(|c: char| c == '|' || c.is_whitespace());
    t.replace(" | ", " · ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// El texto alrededor del enlace a la nota leída: `ancho` caracteres repartidos
/// antes y después, cortando en palabra, con el enlace como `[[…]]` (la nota ya
/// se sabe cuál es) o `[[…|alias]]` si la llaman de otra forma. `lineas` son la
/// del enlace (`i`) y sus vecinas, que se suman solo si es prosa partida en
/// renglones. `None` si el enlace ya no está en esa línea.
fn fragmento(lineas: &[&str], i: usize, titulo_norm: &str, alias: Option<&str>, ancho: usize) -> Option<String> {
    let actual = *lineas.get(i)?;
    let (pos, fin) = buscar_enlace(actual, titulo_norm)?;
    let mut antes = actual[..pos].trim_start_matches(|c: char| c == '>' || c.is_whitespace()).to_string();
    let mut despues = actual[fin..].to_string();
    if es_prosa(actual) {
        // Un renglón vecino de una cita (`> …`) entra sin su `>`.
        let sin_cita = |l: &str| l.trim_start_matches(|c: char| c == '>' || c.is_whitespace()).to_string();
        if let Some(p) = i.checked_sub(1).and_then(|k| lineas.get(k)).filter(|l| es_prosa(l)) {
            antes = format!("{} {antes}", sin_cita(p));
        }
        if let Some(n) = lineas.get(i + 1).filter(|l| es_prosa(l)) {
            despues = format!("{despues} {}", sin_cita(n));
        }
    }
    let antes = limpiar(&antes);
    let despues = limpiar(&despues);
    let (na, nd) = (antes.chars().count(), despues.chars().count());
    // A cada lado la mitad; lo que un lado no usa, lo usa el otro.
    let mitad = ancho / 2;
    let cupo_a = if nd < mitad { ancho - nd } else { mitad };
    let cupo_d = if na < mitad { ancho - na } else { ancho - mitad };
    let antes = cola(&antes, cupo_a);
    let despues = cabeza(&despues, cupo_d);
    let enlace = match alias {
        Some(al) => format!("[[…|{}]]", una_linea(al, 40)),
        None => "[[…]]".to_string(),
    };
    let mut out = String::new();
    if !antes.is_empty() {
        out.push_str(&antes);
        if !antes.ends_with(['(', '[', '«', '"']) {
            out.push(' ');
        }
    }
    out.push_str(&enlace);
    if !despues.is_empty() {
        if !despues.starts_with([',', '.', ';', ':', ')']) {
            out.push(' ');
        }
        out.push_str(&despues);
    }
    Some(out)
}

/// Dónde está, en la línea, el primer `[[…]]` que apunta a la nota (por su
/// nombre normalizado, como los resuelve el índice): `(inicio, fin)` en bytes,
/// con el `!` de un embed incluido.
fn buscar_enlace(linea: &str, titulo_norm: &str) -> Option<(usize, usize)> {
    let mut desde = 0;
    while let Some(k) = linea[desde..].find("[[") {
        let ini = desde + k;
        let cierre = ini + 2 + linea[ini + 2..].find("]]")?;
        let partido = mycelium_vault::wikilinks::partir_wikilink(&linea[ini + 2..cierre]);
        if mycelium_vault::wikilinks::destino_norm(&partido.destino) == titulo_norm {
            let ini = if linea[..ini].ends_with('!') { ini - 1 } else { ini };
            return Some((ini, cierre + 2));
        }
        desde = cierre + 2;
    }
    None
}

/// Los últimos `n` caracteres, empezando en palabra, con `…` si se cortó.
fn cola(s: &str, n: usize) -> String {
    let total = s.chars().count();
    if total <= n {
        return s.to_string();
    }
    let resto: String = s.chars().skip(total - n).collect();
    let resto = match resto.find(' ') {
        Some(k) if k + 1 < resto.len() => &resto[k + 1..],
        _ => resto.as_str(),
    };
    format!("…{resto}")
}

/// Los primeros `n` caracteres, terminando en palabra, con `…` si se cortó.
fn cabeza(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    let corte: String = s.chars().take(n).collect();
    let corte = match corte.rfind(' ') {
        Some(k) if k > 0 => &corte[..k],
        _ => corte.as_str(),
    };
    format!("{}…", corte.trim_end_matches([',', ';', ':', ' ']))
}

fn leer_nota(
    a: &mut Abierto,
    id: &str,
    titulo: &str,
    bytes: usize,
    secciones: &[SeccionInfo],
    forzar: bool,
    aviso: &str,
) -> Result<String, String> {
    let mut o = String::new();
    if bytes <= TOPE_NOTA_ENTERA || forzar || secciones.is_empty() {
        let texto = a.indice.leer_nota(id)?;
        let _ = writeln!(o, "── {id} · nota completa · {} líneas · {}", texto.lines().count(), tokens(texto.len()));
        o.push_str(&linea_cita(a, id, titulo, secciones)?);
        o.push_str(aviso);
        o.push_str(texto.trim_end());
        o.push('\n');
        let ordenes: Vec<usize> = secciones.iter().map(|s| s.orden).collect();
        o.push_str(&enlaces(a, id, &ordenes)?);
        return Ok(o);
    }

    // Grande: el índice de secciones y la primera, y el precio de la entera.
    let _ = writeln!(
        o,
        "── {id} · {} bytes · {} · {} secciones — no se devuelve entera",
        miles(bytes),
        tokens(bytes),
        secciones.len()
    );
    o.push_str(&linea_cita(a, id, titulo, secciones)?);
    o.push_str(aviso);
    // El índice va COMPLETO (diagnóstico de la fase 1, causa 3): se cortaba en 40
    // filas y en D11 dejó afuera, justo después de `DEF-059`, todos los defectos
    // que la pregunta enumeraba. Una fila son ~30 bytes: las 85 secciones del
    // catálogo de defectos son ~2.500 bytes contra los 37.000 de la nota.
    let _ = writeln!(o, "Secciones:");
    let prefijo = format!("{titulo}{SEPARADOR_MIGAS}");
    for s in secciones {
        let nombre = if s.nivel == 0 {
            "(preámbulo)".to_string()
        } else {
            migas(s.ruta_encabezados.strip_prefix(&prefijo).unwrap_or(&s.ruta_encabezados))
        };
        let parte = if s.parcial { " (parte)" } else { "" };
        let _ = writeln!(o, "  #s{:<3} {nombre}{parte} · {}", s.orden, kb(s.bytes));
    }
    let primera = &secciones[0];
    let cuerpo = a.indice.leer_lineas(id, primera.linea_ini, primera.linea_fin)?;
    let _ = writeln!(
        o,
        "\n── {id}#s{} · {} · L{}–{}",
        primera.orden,
        migas_sin_titulo(&primera.ruta_encabezados, titulo),
        primera.linea_ini,
        primera.linea_fin
    );
    o.push_str(&cuerpo);
    o.push('\n');
    let _ = writeln!(
        o,
        "\nPara una sección: vault_leer(refs=[\"{id}#sN\"]) · Para el texto completo: forzar=true ({})",
        tokens(bytes)
    );
    Ok(o)
}

/// La línea que va justo debajo de la cabecera de cada lectura, **antes** del
/// texto: lo primero que el agente ve después es el `# Título`, y con la nota
/// entera citaba eso (fase 1b: 13 citas de notas reales por su título visible).
/// Si el H1 dice otra cosa que el nombre, se lo nombra para descartarlo.
fn linea_cita(a: &Abierto, id: &str, titulo: &str, secciones: &[SeccionInfo]) -> Result<String, String> {
    let mut o = cita(&a.indice.cita(id, titulo)?);
    let h1 = secciones.iter().find(|s| s.nivel == 1).map(|s| una_linea(&s.encabezado, 80));
    if let Some(h1) = h1.filter(|h| !h.is_empty() && h.to_lowercase() != titulo.to_lowercase()) {
        let _ = write!(o, " (no «{h1}»: el # título no es enlace)");
    }
    o.push('\n');
    Ok(o)
}

/// Al leer una sección de una nota que se devuelve entera por su tamaño, una
/// línea con lo que cuesta pedirla toda: el dato puede estar en otra sección de
/// la misma nota (D03: el objetivo en `#s9`, el costo real en `#s19`).
fn pista_nota_entera(id: &str, bytes: usize, secciones: usize, leidas: usize) -> String {
    if secciones <= leidas || bytes > TOPE_NOTA_ENTERA {
        return String::new();
    }
    format!("(la nota tiene {secciones} secciones; entera: vault_leer(refs=[\"{id}\"]), {})\n", tokens(bytes))
}

/// «→ enlaza a: …» con los enlaces de esas secciones, resueltos ahora.
fn enlaces(a: &Abierto, id: &str, ordenes: &[usize]) -> Result<String, String> {
    let sal = a.indice.salientes(id, ordenes)?;
    if sal.is_empty() {
        return Ok(String::new());
    }
    let mut ok = Vec::new();
    let mut rotos = Vec::new();
    for s in sal {
        match s.resuelve_a.len() {
            0 => rotos.push(format!("[[{}]]", s.destino)),
            1 => ok.push(format!("[[{}]]", s.destino)),
            n => ok.push(format!("[[{}]] (ambiguo: {n} notas)", s.destino)),
        }
    }
    let mut o = String::new();
    if !ok.is_empty() {
        let _ = write!(o, "→ enlaza a: {}", ok.join(" · "));
    }
    if !rotos.is_empty() {
        if !o.is_empty() {
            o.push_str(" · ");
        } else {
            o.push_str("→ ");
        }
        let _ = write!(o, "rotos: {}", rotos.join(" · "));
    }
    o.push('\n');
    Ok(o)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatos_cortos() {
        assert_eq!(corto(0.923), ".92");
        assert_eq!(corto(1.0), "1");
        assert_eq!(corto(0.0), "0");
        assert_eq!(miles(31600), "31.600");
        assert_eq!(miles(175), "175");
        assert_eq!(tokens(698), "≈175 tokens");
        assert_eq!(partir_ref("docs/BACKLOG.md#s412"), ("docs/BACKLOG.md", Some(412)));
        assert_eq!(partir_ref("Nota#sección"), ("Nota#sección", None));
        assert_eq!(una_linea("a\n  b   c", 10), "a b c");
    }

    #[test]
    fn la_pista_de_la_nota_entera_solo_si_se_devolveria_entera() {
        assert_eq!(
            pista_nota_entera("docs/drawio.md", 17_890, 20, 1),
            "(la nota tiene 20 secciones; entera: vault_leer(refs=[\"docs/drawio.md\"]), ≈4.473 tokens)\n"
        );
        assert_eq!(pista_nota_entera("docs/BACKLOG.md", 127_917, 99, 1), "", "grande: no se ofrece");
        assert_eq!(pista_nota_entera("a.md", 500, 2, 2), "", "ya se leyó todo");
    }

    #[test]
    fn el_fragmento_dice_que_dice_la_otra_nota_de_esta() {
        // Una fila de tabla: celdas con `·`, el enlace como [[…]].
        let f = fragmento(&["| Las consolas no pertenecían al vault | `DEF-099` | desktop · [[terminal-integrada]] |"], 0, "terminal-integrada", None, 80);
        assert_eq!(f.as_deref(), Some("Las consolas no pertenecían al vault · DEF-099 · desktop · [[…]]"));
        // Un ítem de «Relacionadas»: lo de después, sin la marca de lista.
        let f = fragmento(&["- [[terminal-integrada]] — dónde corre el asistente."], 0, "terminal-integrada", None, 80);
        assert_eq!(f.as_deref(), Some("[[…]] — dónde corre el asistente."));
        // Prosa partida en renglones: suma los vecinos, corta en palabra y con alias.
        let lineas = [
            "La decisión de 2026-09 **revierte** lo anterior: el índice",
            "ya no vive en la app, y [[Decision vieja|la de agosto]] queda como registro",
            "de por qué se probó primero ahí, con todas sus mediciones y sus números.",
        ];
        let f = fragmento(&lineas, 1, "decision vieja", Some("la de agosto"), 80).unwrap();
        assert!(f.starts_with('…') && f.ends_with('…'), "{f}");
        assert!(f.contains("ya no vive en la app, y [[…|la de agosto]] queda como registro"), "{f}");
        assert!(f.chars().count() <= 80 + 20, "{f}");
        // El embed y el ancla también son el enlace; otro enlace de la línea, no.
        let f = fragmento(&["ver [[Otra]] y ![[X#Uso]]"], 0, "x", None, 80);
        assert_eq!(f.as_deref(), Some("ver [[Otra]] y [[…]]"));
        // Dentro de una cita (`> …`) los renglones se juntan sin los `>`.
        let f = fragmento(&["> que ignorar al indexar) y la", "> [[X]] (no hay shell). Ver"], 1, "x", None, 80);
        assert_eq!(f.as_deref(), Some("que ignorar al indexar) y la [[…]] (no hay shell). Ver"));
        let f = fragmento(&["repara ([[X]], `FUN-M-08`)"], 0, "x", None, 80);
        assert_eq!(f.as_deref(), Some("repara ([[…]], FUN-M-08)"));
        // Si el enlace ya no está en la línea (el archivo cambió), no inventa.
        assert_eq!(fragmento(&["otra cosa"], 0, "x", None, 80), None);
    }
}
