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
const TOPE_NOTA_ENTERA: usize = 8 * 1024;

/// Más secciones que esto en el índice de una nota grande: se listan solo los
/// niveles altos.
const TOPE_LISTA_SECCIONES: usize = 40;

pub fn definiciones() -> Value {
    json!([
        {
            "name": "vault_buscar",
            "title": "Buscar en el vault",
            "description": "Busca en las notas del vault y devuelve PREVIEWS de secciones (no el texto): \
por resultado, una ref `ruta#sN`, las migas `Nota › H2 › H3` y un fragmento con las coincidencias \
entre «». Ranking léxico (BM25) por sección; los términos se combinan con Y y aceptan prefijo \
(«enlace» encuentra «enlaces»); \"entre comillas\" busca la frase. Si ninguna sección tiene todos \
los términos, devuelve notas que los reúnen entre varias secciones. Después, vault_leer con las refs \
que interesen.",
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
Una ruta o título de nota sin #sN devuelve la nota entera si es chica; si es grande, su índice de \
secciones y el costo de leerla entera (forzar=true para pagarlo).",
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
    Ok(formatear_busqueda(&c, &b, &frescura(a, reval), a.de_respaldo))
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

fn formatear_busqueda(c: &Consulta, b: &Busqueda, frescura: &str, de_respaldo: bool) -> String {
    let mut o = String::new();
    let unidad = if c.ambito == Ambito::Notas || b.modo == Modo::Interseccion { "notas" } else { "resultados" };
    if b.resultados.is_empty() {
        let _ = writeln!(o, "0 resultados para «{}» · {frescura}", c.texto);
        let _ = writeln!(
            o,
            "\nProbá con menos términos, con el vocabulario del vault (títulos, tags) o sin filtros. \
             Si el vault no tiene la respuesta, decilo en vez de suponer."
        );
        return o;
    }
    let _ = writeln!(o, "{} {unidad} · mostrando {} · {frescura}", b.total, b.resultados.len());
    if b.modo == Modo::Interseccion {
        let _ = writeln!(
            o,
            "Ninguna sección tiene todos los términos: notas que los reúnen entre varias secciones \
             (la mejor sección de cada término)."
        );
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
        let _ = writeln!(o, "\n[{}] {} · {m}{parte}", i + 1, r.referencia());
        let frag = una_linea(&r.fragmento, 160);
        if b.modo == Modo::Filtros {
            let _ = writeln!(o, "    {frag}");
        } else {
            let _ = writeln!(o, "    {frag} {}", senales(&r.senales));
        }
    }
    let _ = writeln!(o, "\nDetalle: vault_leer(refs=[…], hasta 10 a la vez) · Contexto: contexto=1");
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

    let mut o = String::new();
    for (i, r) in refs.iter().enumerate() {
        if i > 0 {
            o.push('\n');
        }
        match leer_una(a, r, contexto, forzar) {
            Ok(t) => o.push_str(&t),
            Err(msg) => {
                let _ = writeln!(o, "── {r}\n{msg}");
            }
        }
    }
    Ok(o)
}

fn leer_una(a: &mut Abierto, r: &str, contexto: usize, forzar: bool) -> Result<String, String> {
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
            o.push_str(aviso);
            o.push_str(&cuerpo);
            o.push('\n');
            let ordenes: Vec<usize> = tramo.iter().map(|s| s.orden).collect();
            o.push_str(&enlaces(a, &id, &ordenes)?);
            Ok(o)
        }
        None => leer_nota(a, &id, &info.titulo, info.bytes, &secciones, forzar, aviso),
    }
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
    o.push_str(aviso);
    let mut lista: Vec<&SeccionInfo> = secciones.iter().collect();
    let mut nota_lista = String::new();
    if lista.len() > TOPE_LISTA_SECCIONES {
        for max_nivel in [3u8, 2, 1] {
            let filtrada: Vec<&SeccionInfo> =
                secciones.iter().filter(|s| s.nivel <= max_nivel && !(s.parcial && s.nivel > 0 && es_continuacion(secciones, s))).collect();
            lista = filtrada;
            nota_lista = format!(" (solo hasta H{max_nivel}; las demás, por vault_buscar con carpeta o por su ref)");
            if lista.len() <= TOPE_LISTA_SECCIONES {
                break;
            }
        }
        lista.truncate(TOPE_LISTA_SECCIONES);
    }
    let _ = writeln!(o, "Secciones{nota_lista}:");
    let prefijo = format!("{titulo}{SEPARADOR_MIGAS}");
    for s in &lista {
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

/// Un trozo que no es el primero de su sección (para no listar la misma
/// sección varias veces en el índice resumido).
fn es_continuacion(secciones: &[SeccionInfo], s: &SeccionInfo) -> bool {
    secciones
        .iter()
        .any(|x| x.orden + 1 == s.orden && x.parcial && x.ruta_encabezados == s.ruta_encabezados)
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
}
