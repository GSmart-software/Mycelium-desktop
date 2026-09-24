//! Estructura de un documento Markdown del vault: qué es código, qué es un
//! enlace, qué es una etiqueta y dónde empieza cada sección.
//!
//! > [!important] El código no es estructura (plan del MCP § 3.1)
//! > Los bloques cercados (tres acentos graves o tres virgulillas) y el código en
//! > línea **nunca** producen enlaces, etiquetas ni cortes de sección. Es la
//! > convención del vault para **mostrar** cómo se escribe algo: `[[destino]]`
//! > entre acentos graves es un ejemplo de sintaxis, no una arista. El escáner de
//! > la app (`lib/db/grafo.ts`) busca `[[…]]` sobre el texto crudo y ensucia el
//! > grafo con esas aristas fantasma; este no.
//! >
//! > El código **sí** es texto buscable: un identificador entre acentos graves
//! > (`vault_buscar`, `FUN-L-09`) es justo lo que un agente busca.
//!
//! Todo se hace sobre una **máscara** del texto: una copia del mismo largo en
//! bytes donde cada byte de código se reemplazó por un acento grave. Los
//! desplazamientos y números de línea valen igual en los dos, y el carácter de
//! relleno no puede crear un enlace ni una etiqueta ni alargar una existente.

use std::sync::OnceLock;

use regex::Regex;

use crate::frontmatter::{self, Frontmatter};
use crate::wikilinks;

/// Tope de una unidad indexada: una sección más grande se parte en trozos por
/// límite de párrafo (`MCP de Mycelium - memoria` § 4).
pub const TOPE_SECCION: usize = 4096;

// ── Código ──────────────────────────────────────────────────────────────────

/// Apertura de una cerca: el carácter y cuántos lleva.
fn apertura_de_cerca(linea: &str) -> Option<(u8, usize)> {
    let t = linea.trim_start();
    let b = t.as_bytes();
    let c = *b.first()?;
    if c != b'`' && c != b'~' {
        return None;
    }
    let n = b.iter().take_while(|&&x| x == c).count();
    if n < 3 {
        return None;
    }
    // CommonMark: la «info string» de una cerca con acentos graves no puede
    // llevar otro acento grave (`` ```a``` `` al principio de línea es código
    // en línea, no una cerca).
    if c == b'`' && t[n..].contains('`') {
        return None;
    }
    Some((c, n))
}

/// ¿Esta línea cierra la cerca abierta con `(c, n)`?
fn cierra_cerca(linea: &str, (c, n): (u8, usize)) -> bool {
    let t = linea.trim();
    let b = t.as_bytes();
    let m = b.iter().take_while(|&&x| x == c).count();
    m >= n && m == b.len()
}

/// Para cada línea, si pertenece a un bloque cercado (incluidas las líneas de
/// la cerca). Una cerca sin cerrar llega hasta el final del documento.
pub fn lineas_de_codigo(lineas: &[&str]) -> Vec<bool> {
    let mut out = Vec::with_capacity(lineas.len());
    let mut abierta: Option<(u8, usize)> = None;
    for l in lineas {
        match abierta {
            Some(cerca) => {
                out.push(true);
                if cierra_cerca(l, cerca) {
                    abierta = None;
                }
            }
            None => {
                if let Some(cerca) = apertura_de_cerca(l) {
                    abierta = Some(cerca);
                    out.push(true);
                } else {
                    out.push(false);
                }
            }
        }
    }
    out
}

/// Marca con acentos graves los rangos de código en línea de un párrafo
/// (`bytes` es el párrafo dentro de la máscara). Un tramo de N acentos graves
/// abre y lo cierra el siguiente tramo de **exactamente** N; si no hay cierre,
/// los acentos son literales.
fn enmascarar_codigo_en_linea(texto: &[u8], mascara: &mut [u8], desde: usize, hasta: usize) {
    let mut i = desde;
    while i < hasta {
        if texto[i] != b'`' {
            i += 1;
            continue;
        }
        // Un acento grave escapado no abre (`\``).
        if i > desde && texto[i - 1] == b'\\' {
            i += 1;
            continue;
        }
        let n = texto[i..hasta].iter().take_while(|&&c| c == b'`').count();
        let mut j = i + n;
        let mut cierre = None;
        while j < hasta {
            if texto[j] == b'`' {
                let m = texto[j..hasta].iter().take_while(|&&c| c == b'`').count();
                if m == n {
                    cierre = Some(j + m);
                    break;
                }
                j += m;
            } else {
                j += 1;
            }
        }
        match cierre {
            Some(fin) => {
                mascara[i..fin].fill(b'`');
                i = fin;
            }
            None => i += n,
        }
    }
}

/// La máscara del documento: mismo largo en bytes, con cada byte de código
/// (bloques cercados y código en línea) reemplazado por un acento grave. Los
/// saltos de línea se conservan.
pub fn enmascarar_codigo(texto: &str) -> String {
    let lineas: Vec<&str> = texto.split('\n').collect();
    let codigo = lineas_de_codigo(&lineas);
    let bytes = texto.as_bytes();
    let mut mascara = bytes.to_vec();

    // Offsets de inicio de cada línea.
    let mut inicio = Vec::with_capacity(lineas.len());
    let mut off = 0;
    for l in &lineas {
        inicio.push(off);
        off += l.len() + 1;
    }

    let mut parrafo_desde: Option<usize> = None;
    let cerrar = |desde: Option<usize>, hasta: usize, mascara: &mut Vec<u8>| {
        if let Some(d) = desde {
            enmascarar_codigo_en_linea(bytes, mascara, d, hasta);
        }
    };
    for (k, l) in lineas.iter().enumerate() {
        let ini = inicio[k];
        let fin = ini + l.len();
        if codigo[k] {
            cerrar(parrafo_desde.take(), ini, &mut mascara);
            for b in &mut mascara[ini..fin] {
                if *b != b'\r' {
                    *b = b'`';
                }
            }
        } else if l.trim().is_empty() {
            // El código en línea no cruza una línea en blanco.
            cerrar(parrafo_desde.take(), ini, &mut mascara);
        } else if parrafo_desde.is_none() {
            parrafo_desde = Some(ini);
        }
    }
    cerrar(parrafo_desde.take(), bytes.len(), &mut mascara);

    // Solo se reemplazaron bytes completos de caracteres (los acentos graves y
    // los límites de línea son ASCII), así que sigue siendo UTF-8 válido.
    String::from_utf8(mascara).expect("la máscara conserva UTF-8")
}

// ── Enlaces ─────────────────────────────────────────────────────────────────

fn wikilink_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // La misma expresión que `WIKILINK_RE` de `lib/db/grafo.ts`.
    R.get_or_init(|| Regex::new(r"\[\[([^\[\]]+)\]\]").expect("regex válida"))
}

/// Un `[[enlace]]` encontrado en un documento.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enlace {
    /// Lo escrito entre los corchetes, tal cual.
    pub bruto: String,
    /// El destino sin alias (conserva ruta y ancla).
    pub destino: String,
    /// Último segmento, sin ancla, en minúsculas: con esto se resuelve.
    pub destino_norm: String,
    pub alias: Option<String>,
    pub ancla: Option<String>,
    /// Lleva `!` delante: es un embed.
    pub embed: bool,
    /// Línea (1-based) donde empieza.
    pub linea: usize,
    /// Desplazamiento en bytes dentro del documento.
    pub offset: usize,
}

fn enlace_en(texto: &str, inicio: usize, inner: &str, linea: usize) -> Enlace {
    let partido = wikilinks::partir_wikilink(inner);
    let (_, ancla) = wikilinks::partir_ancla(&partido.destino);
    Enlace {
        bruto: inner.to_string(),
        destino_norm: wikilinks::destino_norm(&partido.destino),
        ancla: ancla.map(str::to_string),
        destino: partido.destino,
        alias: partido.alias,
        embed: inicio > 0 && texto.as_bytes()[inicio - 1] == b'!',
        linea,
        offset: inicio,
    }
}

fn numero_de_linea(texto: &str, offset: usize) -> usize {
    texto.as_bytes()[..offset].iter().filter(|&&b| b == b'\n').count() + 1
}

/// Los enlaces del documento, **fuera del código**. Incluye los del frontmatter
/// (un `[[enlace]]` en una propiedad es un enlace saliente, como en la app).
///
/// El texto del enlace se toma del original, no de la máscara: la máscara solo
/// decide **dónde** hay enlaces.
pub fn extraer_enlaces(texto: &str) -> Vec<Enlace> {
    let mascara = enmascarar_codigo(texto);
    wikilink_re()
        .captures_iter(&mascara)
        .map(|c| {
            let todo = c.get(0).unwrap();
            let g = c.get(1).unwrap();
            let inner = &texto[g.start()..g.end()];
            enlace_en(texto, todo.start(), inner, numero_de_linea(texto, todo.start()))
        })
        .filter(|e| !e.destino_norm.is_empty())
        .collect()
}

/// Los `[[…]]` que la app contaría como enlace y este extractor descarta por
/// estar dentro de código. Existe para la prueba de equivalencia: esas
/// diferencias son **intencionales** y hay que poder listarlas.
pub fn enlaces_en_codigo(texto: &str) -> Vec<Enlace> {
    let fuera: std::collections::HashSet<usize> =
        extraer_enlaces(texto).iter().map(|e| e.offset).collect();
    wikilink_re()
        .captures_iter(texto)
        .filter(|c| !fuera.contains(&c.get(0).unwrap().start()))
        .map(|c| {
            let todo = c.get(0).unwrap();
            enlace_en(texto, todo.start(), &c[1], numero_de_linea(texto, todo.start()))
        })
        .collect()
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

fn tag_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // `TAG_RE` de `lib/frontmatter.ts`. Sin la bandera `m`, `^` es el principio
    // del texto, igual que en JS.
    R.get_or_init(|| Regex::new(r"(?:^|[\s(])#([\p{L}\p{N}_/-]+)").expect("regex válida"))
}

/// Agrega sin repetir (sin distinguir mayúsculas), conservando la primera forma.
fn push_unico(out: &mut Vec<String>, t: &str) {
    if !t.is_empty() && !out.iter().any(|x| x.to_lowercase() == t.to_lowercase()) {
        out.push(t.to_string());
    }
}

fn cuerpo_de<'a>(texto: &'a str, fm: &Frontmatter) -> &'a str {
    let desde = fm.cuerpo_desde();
    if desde == 0 {
        return texto;
    }
    let mut off = 0;
    for (i, l) in texto.split('\n').enumerate() {
        if i == desde {
            return &texto[off..];
        }
        off += l.len() + 1;
    }
    ""
}

/// Etiquetas de la nota: las de `tags:` más los `#tag` del cuerpo **fuera del
/// código**. Espeja `etiquetasDe` de `lib/frontmatter.ts`, salvo el código.
pub fn etiquetas(texto: &str, fm: &Frontmatter) -> Vec<(String, &'static str)> {
    let mut vistas: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for t in frontmatter::tags_del_frontmatter(fm) {
        if !vistas.iter().any(|x| x.to_lowercase() == t.to_lowercase()) {
            push_unico(&mut vistas, &t);
            out.push((t, "frontmatter"));
        }
    }
    let cuerpo = enmascarar_codigo(cuerpo_de(texto, fm));
    for c in tag_re().captures_iter(&cuerpo) {
        let t = &c[1];
        if !vistas.iter().any(|x| x.to_lowercase() == t.to_lowercase()) {
            push_unico(&mut vistas, t);
            out.push((t.to_string(), "cuerpo"));
        }
    }
    out
}

/// Las etiquetas del cuerpo que la app vería y este extractor descarta por estar
/// en código (para la prueba de equivalencia).
pub fn etiquetas_en_codigo(texto: &str, fm: &Frontmatter) -> Vec<String> {
    let propias: Vec<String> = etiquetas(texto, fm).into_iter().map(|(t, _)| t.to_lowercase()).collect();
    let mut out = Vec::new();
    for c in tag_re().captures_iter(cuerpo_de(texto, fm)) {
        let t = &c[1];
        if !propias.contains(&t.to_lowercase()) {
            push_unico(&mut out, t);
        }
    }
    out
}

// ── Secciones ───────────────────────────────────────────────────────────────

/// Una unidad de recuperación: lo que hay entre un encabezado y el siguiente de
/// **cualquier** nivel (no anidado), o un trozo de eso si pasa del tope.
#[derive(Debug, Clone, PartialEq)]
pub struct Seccion {
    /// `0` es el preámbulo (lo anterior al primer encabezado), y solo existe si
    /// tiene contenido. Los demás, en orden de aparición desde 1.
    pub orden: usize,
    /// 1 a 6; 0 en el preámbulo.
    pub nivel: u8,
    pub encabezado: String,
    /// Las migas: `Nota > H2 > H3`.
    pub ruta_encabezados: String,
    /// Primera y última línea, 1-based e inclusivas.
    pub linea_ini: usize,
    pub linea_fin: usize,
    pub bytes: usize,
    /// Es un trozo de una sección más grande que el tope.
    pub parcial: bool,
    /// Texto para el índice: sin la línea del encabezado (que va en su propia
    /// columna) y, en el preámbulo, con los **valores** del frontmatter en vez
    /// del YAML.
    pub texto_indexable: String,
}

/// Separador de las migas.
pub const SEPARADOR_MIGAS: &str = " > ";

/// `# Título` con 0 a 3 espacios delante. Devuelve nivel y texto.
fn encabezado_atx(linea: &str) -> Option<(u8, String)> {
    let sin = linea.strip_suffix('\r').unwrap_or(linea);
    let espacios = sin.bytes().take_while(|&b| b == b' ').count();
    if espacios > 3 {
        return None;
    }
    let t = &sin[espacios..];
    let n = t.bytes().take_while(|&b| b == b'#').count();
    if n == 0 || n > 6 {
        return None;
    }
    let resto = &t[n..];
    if !(resto.is_empty() || resto.starts_with(' ') || resto.starts_with('\t')) {
        return None;
    }
    // Secuencia de cierre opcional: `## Título ##`.
    let mut texto = resto.trim();
    let sin_cierre = texto.trim_end_matches('#');
    if sin_cierre.len() < texto.len() && (sin_cierre.is_empty() || sin_cierre.ends_with(' ')) {
        texto = sin_cierre.trim_end();
    }
    Some((n as u8, texto.to_string()))
}

/// Una sección antes de aplicar el tope.
struct Cruda {
    nivel: u8,
    encabezado: String,
    ruta: String,
    /// 0-based, inclusivas.
    ini: usize,
    fin: usize,
}

/// Parte el documento en secciones. `titulo` es el de la nota: encabeza las
/// migas de todas.
pub fn secciones(titulo: &str, texto: &str, fm: &Frontmatter) -> Vec<Seccion> {
    let lineas: Vec<&str> = texto.split('\n').collect();
    // Un archivo que termina en `\n` no tiene una línea vacía «de más».
    let total = if lineas.len() > 1 && lineas.last() == Some(&"") { lineas.len() - 1 } else { lineas.len() };
    let codigo = lineas_de_codigo(&lineas);
    let desde_cuerpo = fm.cuerpo_desde();

    let mut crudas: Vec<Cruda> = Vec::new();
    let mut pila: Vec<(u8, String)> = Vec::new();
    let mut actual = Cruda { nivel: 0, encabezado: String::new(), ruta: titulo.to_string(), ini: 0, fin: 0 };
    let mut hay_actual = true; // el preámbulo, que se descarta si queda vacío

    for i in 0..total {
        let es_encabezado = if i >= desde_cuerpo && !codigo[i] { encabezado_atx(lineas[i]) } else { None };
        if let Some((nivel, enc)) = es_encabezado {
            // Al encontrar un encabezado se cierra lo anterior. Si está en la
            // línea 0 no hay nada antes: no hay preámbulo.
            if hay_actual && i > 0 {
                actual.fin = i - 1;
                crudas.push(actual);
            }
            while pila.last().is_some_and(|(n, _)| *n >= nivel) {
                pila.pop();
            }
            pila.push((nivel, enc.clone()));
            let mut ruta = titulo.to_string();
            for (k, (_, e)) in pila.iter().enumerate() {
                // El H1 que repite el título de la nota no aporta nada a las
                // migas: `BACKLOG > Grandes`, no `BACKLOG > BACKLOG > Grandes`.
                if k == 0 && e.to_lowercase() == titulo.to_lowercase() {
                    continue;
                }
                ruta.push_str(SEPARADOR_MIGAS);
                ruta.push_str(e);
            }
            actual = Cruda { nivel, encabezado: enc, ruta, ini: i, fin: i };
            hay_actual = true;
        }
    }
    if hay_actual && total > 0 {
        actual.fin = total - 1;
        crudas.push(actual);
    }

    // El preámbulo solo cuenta si tiene algo (frontmatter incluido).
    if let Some(p) = crudas.first() {
        if p.nivel == 0 && lineas[p.ini..=p.fin].iter().all(|l| l.trim().is_empty()) {
            crudas.remove(0);
        }
    }

    let valores_fm = frontmatter::valores_indexables(fm).join(" ");
    let mut out: Vec<Seccion> = Vec::new();
    for c in crudas {
        let trozos = trocear(&lineas, &codigo, c.ini, c.fin);
        let parcial = trozos.len() > 1;
        for (k, (ini, fin)) in trozos.into_iter().enumerate() {
            let bytes: usize = lineas[ini..=fin].iter().map(|l| l.len() + 1).sum();
            // Texto indexable: sin la línea del encabezado, y sin el YAML.
            let mut desde = ini;
            if k == 0 && c.nivel > 0 {
                desde = ini + 1;
            }
            let mut texto_indexable = String::new();
            if c.nivel == 0 && k == 0 && desde_cuerpo > 0 {
                texto_indexable.push_str(&valores_fm);
                texto_indexable.push('\n');
                desde = desde.max(desde_cuerpo);
            }
            if desde <= fin {
                texto_indexable.push_str(&lineas[desde..=fin].join("\n"));
            }
            out.push(Seccion {
                orden: 0, // se numera abajo
                nivel: c.nivel,
                encabezado: c.encabezado.clone(),
                ruta_encabezados: c.ruta.clone(),
                linea_ini: ini + 1,
                linea_fin: fin + 1,
                bytes,
                parcial,
                texto_indexable,
            });
        }
    }
    renumerar(&mut out);

    // Una nota vacía sigue siendo encontrable por su título: una sección vacía.
    if out.is_empty() {
        out.push(Seccion {
            orden: 0,
            nivel: 0,
            encabezado: String::new(),
            ruta_encabezados: titulo.to_string(),
            linea_ini: 1,
            linea_fin: total.max(1),
            bytes: texto.len(),
            parcial: false,
            texto_indexable: valores_fm,
        });
    }
    out
}

/// Deja el preámbulo (su primer trozo, si lo partió el tope) en 0 y el resto
/// 1, 2, 3… en orden de aparición. El orden es lo que identifica a una sección
/// dentro de su nota: la `ref` `nota.md#s3` es el orden 3.
fn renumerar(secs: &mut [Seccion]) {
    let mut n = 1;
    for (i, s) in secs.iter_mut().enumerate() {
        if i == 0 && s.nivel == 0 {
            s.orden = 0;
        } else {
            s.orden = n;
            n += 1;
        }
    }
}

/// Parte `[ini, fin]` en trozos de hasta [`TOPE_SECCION`] bytes, cortando en
/// líneas en blanco fuera de código; si un párrafo solo ya pasa el tope, corta
/// en un límite de línea.
fn trocear(lineas: &[&str], codigo: &[bool], ini: usize, fin: usize) -> Vec<(usize, usize)> {
    let total: usize = lineas[ini..=fin].iter().map(|l| l.len() + 1).sum();
    if total <= TOPE_SECCION {
        return vec![(ini, fin)];
    }
    let mut out = Vec::new();
    let mut desde = ini;
    let mut acumulado = 0usize;
    let mut ultimo_corte: Option<usize> = None; // línea en blanco dentro del trozo
    let mut i = ini;
    while i <= fin {
        let largo = lineas[i].len() + 1;
        if acumulado + largo > TOPE_SECCION && i > desde {
            let corte = match ultimo_corte {
                Some(c) if c >= desde && c < i => c,
                _ => i - 1,
            };
            out.push((desde, corte));
            desde = corte + 1;
            acumulado = lineas[desde..i].iter().map(|l| l.len() + 1).sum();
            ultimo_corte = None;
            continue;
        }
        acumulado += largo;
        if lineas[i].trim().is_empty() && !codigo[i] && i > desde {
            ultimo_corte = Some(i);
        }
        i += 1;
    }
    if desde <= fin {
        out.push((desde, fin));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn destinos(texto: &str) -> Vec<String> {
        extraer_enlaces(texto).into_iter().map(|e| e.destino_norm).collect()
    }

    #[test]
    fn el_codigo_no_produce_enlaces() {
        let t = "Ver [[Uno]] y `[[Ejemplo]]`.\n\n```md\n[[Dentro del bloque]]\n```\n\n~~~\n[[Otro]]\n~~~\n[[Dos|alias]]";
        assert_eq!(destinos(t), ["uno", "dos"]);
        let descartados: Vec<_> = enlaces_en_codigo(t).into_iter().map(|e| e.destino_norm).collect();
        assert_eq!(descartados, ["ejemplo", "dentro del bloque", "otro"]);
    }

    #[test]
    fn codigo_en_linea_con_varios_acentos_y_sin_cierre() {
        // Doble acento grave que contiene uno simple.
        assert_eq!(destinos("``a ` [[No]]`` [[Si]]"), ["si"]);
        // Un acento sin cierre es literal: no esconde nada.
        assert_eq!(destinos("un ` suelto [[Si]]"), ["si"]);
        // El código en línea no cruza un párrafo.
        assert_eq!(destinos("`abre\n\n[[Si]] cierra`"), ["si"]);
    }

    #[test]
    fn barra_escapada_en_tabla_def_045() {
        let t = "| a | b |\n|---|---|\n| [[Destino\\|alias]] | x |";
        let e = extraer_enlaces(t);
        assert_eq!(e[0].destino_norm, "destino");
        assert_eq!(e[0].alias.as_deref(), Some("alias"));
        assert_eq!(e[0].linea, 3);
    }

    #[test]
    fn embeds_anclas_y_rutas() {
        let e = extraer_enlaces("![[Carpeta/Imagen.png]] [[Nota#Sección|ver]]");
        assert!(e[0].embed);
        assert_eq!(e[0].destino_norm, "imagen.png");
        assert_eq!(e[1].destino_norm, "nota");
        assert_eq!(e[1].ancla.as_deref(), Some("Sección"));
        assert!(!e[1].embed);
    }

    #[test]
    fn etiquetas_fuera_del_codigo() {
        let t = "---\ntags: [idea]\n---\n#proyecto y `ver #no` \n```\n#include\n```\n(#otra) a#nada #Idea";
        let fm = crate::frontmatter::separar_frontmatter(t);
        let tags: Vec<_> = etiquetas(t, &fm).into_iter().map(|(t, _)| t).collect();
        assert_eq!(tags, ["idea", "proyecto", "otra"]);
        assert_eq!(etiquetas_en_codigo(t, &fm), ["no", "include"]);
    }

    #[test]
    fn la_mascara_no_alarga_una_etiqueta() {
        let t = "#tag`code`";
        let fm = crate::frontmatter::separar_frontmatter(t);
        let tags: Vec<_> = etiquetas(t, &fm).into_iter().map(|(t, _)| t).collect();
        assert_eq!(tags, ["tag"]);
    }

    fn resumen(secs: &[Seccion]) -> Vec<(usize, u8, &str, usize, usize)> {
        secs.iter()
            .map(|s| (s.orden, s.nivel, s.ruta_encabezados.as_str(), s.linea_ini, s.linea_fin))
            .collect()
    }

    #[test]
    fn secciones_con_migas_y_preambulo() {
        let t = "intro\n# A\ntexto\n## B\nb\n### C\nc\n## D\nd\n";
        let fm = crate::frontmatter::separar_frontmatter(t);
        let s = secciones("Nota", t, &fm);
        assert_eq!(
            resumen(&s),
            [
                (0, 0, "Nota", 1, 1),
                (1, 1, "Nota > A", 2, 3),
                (2, 2, "Nota > A > B", 4, 5),
                (3, 3, "Nota > A > B > C", 6, 7),
                (4, 2, "Nota > A > D", 8, 9),
            ]
        );
        // La línea del encabezado no va al cuerpo: ya está en las migas.
        assert_eq!(s[1].texto_indexable, "texto");
    }

    #[test]
    fn el_h1_que_repite_el_titulo_no_se_repite_en_las_migas() {
        let s = secciones("BACKLOG", "# BACKLOG
x
## Grandes
y", &Frontmatter::No);
        assert_eq!(s[0].ruta_encabezados, "BACKLOG");
        assert_eq!(s[1].ruta_encabezados, "BACKLOG > Grandes");
    }

    #[test]
    fn sin_preambulo_el_primer_encabezado_es_1() {
        let fm = Frontmatter::No;
        let s = secciones("N", "# A\na\n# B\nb", &fm);
        assert_eq!(resumen(&s), [(1, 1, "N > A", 1, 2), (2, 1, "N > B", 3, 4)]);
    }

    #[test]
    fn los_encabezados_dentro_de_un_bloque_no_cortan() {
        let t = "# Real\n```md\n# No es encabezado\n## Tampoco\n```\nfin";
        let s = secciones("N", t, &Frontmatter::No);
        assert_eq!(s.len(), 1);
        assert_eq!((s[0].linea_ini, s[0].linea_fin), (1, 6));
    }

    #[test]
    fn frontmatter_en_el_preambulo_con_valores_y_sin_yaml() {
        let t = "---\nestado: activo\ntags: [x]\n---\n# A\na";
        let fm = crate::frontmatter::separar_frontmatter(t);
        let s = secciones("N", t, &fm);
        assert_eq!(s[0].orden, 0);
        assert_eq!((s[0].linea_ini, s[0].linea_fin), (1, 4));
        assert!(s[0].texto_indexable.contains("activo"));
        assert!(!s[0].texto_indexable.contains("estado:"));
        // Una línea `# …` dentro del frontmatter no es un encabezado.
        let t2 = "---\n# comentario: 1\n---\ncuerpo";
        let s2 = secciones("N", t2, &crate::frontmatter::separar_frontmatter(t2));
        assert_eq!(s2.len(), 1);
    }

    #[test]
    fn nota_vacia_tiene_una_seccion() {
        let s = secciones("Vacía", "", &Frontmatter::No);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].ruta_encabezados, "Vacía");
    }

    #[test]
    fn una_seccion_grande_se_parte_por_parrafos() {
        let parrafo = "palabra ".repeat(100); // ~800 bytes
        let mut t = String::from("# Grande\n");
        for _ in 0..12 {
            t.push_str(&parrafo);
            t.push_str("\n\n");
        }
        t.push_str("# Chica\nfin\n");
        let s = secciones("N", &t, &Frontmatter::No);
        let grandes: Vec<_> = s.iter().filter(|x| x.encabezado == "Grande").collect();
        assert!(grandes.len() >= 3, "{}", grandes.len());
        assert!(grandes.iter().all(|x| x.parcial && x.bytes <= TOPE_SECCION));
        // Los trozos se tocan sin huecos ni solape, y cortan en líneas en blanco.
        for par in grandes.windows(2) {
            assert_eq!(par[0].linea_fin + 1, par[1].linea_ini);
        }
        let ordenes: Vec<_> = s.iter().map(|x| x.orden).collect();
        let esperados: Vec<_> = (1..=s.len()).collect();
        assert_eq!(ordenes, esperados);
        assert!(!s.last().unwrap().parcial);
    }

    #[test]
    fn cierre_de_encabezado_y_encabezados_invalidos() {
        assert_eq!(encabezado_atx("## Título ##"), Some((2, "Título".into())));
        assert_eq!(encabezado_atx("#sin-espacio"), None);
        assert_eq!(encabezado_atx("    # indentado"), None);
        assert_eq!(encabezado_atx("####### siete"), None);
        assert_eq!(encabezado_atx("# C#"), Some((1, "C#".into())));
    }
}
