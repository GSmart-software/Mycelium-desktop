//! Frontmatter YAML de las notas (`FUN-M-04`): port a Rust de la parte **de
//! lectura** de `frontend/lib/frontmatter.ts`.
//!
//! Mismo subconjunto soportado (mapa plano de escalares y listas), mismas reglas
//! de detección y mismos motivos de «no soportado». Lo que el editor necesita
//! para reescribir el bloque (rango de líneas por propiedad, comentarios) no
//! hace falta para indexar y no se porta.
//!
//! Mientras la app siga parseando en TS, la equivalencia de los dos se prueba
//! con `frontend/scripts/equivalencia-indice.mjs` contra el vault de `docs/`.

use std::sync::OnceLock;

use regex::Regex;

/// Valor tipado de una propiedad.
#[derive(Debug, Clone, PartialEq)]
pub enum Valor {
    Texto(String),
    Numero(f64),
    Casilla(bool),
    Lista(Vec<String>),
}

/// Una propiedad del bloque. `tipo` usa los mismos nombres que TS: `texto`,
/// `numero`, `casilla`, `fecha`, `fechaHora`, `lista`.
#[derive(Debug, Clone, PartialEq)]
pub struct Propiedad {
    pub clave: String,
    pub tipo: &'static str,
    pub valor: Valor,
}

/// Resultado de separar el frontmatter.
#[derive(Debug, Clone, PartialEq)]
pub enum Frontmatter {
    /// No hay bloque (o no cierra).
    No,
    /// Bloque interpretado. `cuerpo_desde` es la primera línea (0-based) del cuerpo.
    Soportado { props: Vec<Propiedad>, cuerpo_desde: usize },
    /// Bloque presente pero fuera del subconjunto: no se interpreta.
    NoSoportado { motivo: String, cuerpo_desde: usize },
}

impl Frontmatter {
    /// Primera línea (0-based) del cuerpo: 0 si no hay bloque.
    pub fn cuerpo_desde(&self) -> usize {
        match self {
            Frontmatter::No => 0,
            Frontmatter::Soportado { cuerpo_desde, .. } | Frontmatter::NoSoportado { cuerpo_desde, .. } => {
                *cuerpo_desde
            }
        }
    }

    /// Las propiedades interpretadas (vacío si no hay bloque o no es soportado).
    pub fn props(&self) -> &[Propiedad] {
        match self {
            Frontmatter::Soportado { props, .. } => props,
            _ => &[],
        }
    }
}

fn re(celda: &'static OnceLock<Regex>, patron: &str) -> &'static Regex {
    celda.get_or_init(|| Regex::new(patron).expect("regex válida"))
}

/// `clave: valor` en una línea (la clave corta en el PRIMER `:`).
fn clave_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"^([^:#\s][^:]*?)[ \t]*:[ \t]*(.*)$")
}
/// Elemento de una lista en bloque: `- valor`.
fn item_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"^[ \t]*-(?:[ \t]+(.*))?$")
}
fn fecha_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(?-u)^\d{4}-\d{2}-\d{2}$")
}
fn fecha_hora_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(?-u)^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$")
}
fn numero_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(?-u)^-?\d+(?:\.\d+)?$")
}
fn bool_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(?i)^(?:true|false)$")
}
fn multilinea_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(?-u)^[|>][-+]?\d*$")
}
fn item_mapa_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"^[^:]+:(?:\s|$)")
}

/// Una línea sin su `\r` final.
fn sin_cr(linea: &str) -> &str {
    linea.strip_suffix('\r').unwrap_or(linea)
}

fn es_comentario(linea: &str) -> bool {
    linea.trim_start().starts_with('#')
}

fn es_entrecomillado(s: &str) -> bool {
    let mut cs = s.chars();
    let (Some(c), Some(_)) = (cs.next(), cs.next()) else { return false };
    (c == '"' || c == '\'') && s.ends_with(c)
}

fn quitar_comillas(s: &str) -> String {
    if !es_entrecomillado(s) {
        return s.to_string();
    }
    let primera = s.chars().next().unwrap();
    let cuerpo = &s[1..s.len() - 1];
    if primera == '"' {
        // `\\(["\\])` → `$1`
        let mut out = String::with_capacity(cuerpo.len());
        let mut it = cuerpo.chars().peekable();
        while let Some(c) = it.next() {
            if c == '\\' {
                if let Some(&sig) = it.peek() {
                    if sig == '"' || sig == '\\' {
                        out.push(sig);
                        it.next();
                        continue;
                    }
                }
            }
            out.push(c);
        }
        out
    } else {
        cuerpo.replace("''", "'")
    }
}

/// Separa el valor de su comentario final (`#` precedido de espacio, fuera de
/// comillas y corchetes). Devuelve solo el valor: el comentario no se indexa.
fn quitar_comentario(valor: &str) -> String {
    let mut comilla: Option<char> = None;
    let mut anidado: i32 = 0;
    let mut previo: Option<char> = None;
    for (i, c) in valor.char_indices() {
        if let Some(q) = comilla {
            if c == q {
                comilla = None;
            }
            previo = Some(c);
            continue;
        }
        if c == '"' || c == '\'' {
            comilla = Some(c);
        } else if c == '[' || c == '{' {
            anidado += 1;
        } else if c == ']' || c == '}' {
            anidado -= 1;
        } else if c == '#' && anidado == 0 && i > 0 && previo.is_some_and(char::is_whitespace) {
            return valor[..i].trim_end().to_string();
        }
        previo = Some(c);
    }
    valor.trim_end().to_string()
}

/// Elementos de una lista en línea (`[a, "b, c"]`), respetando las comillas.
fn partir_lista(interior: &str) -> Vec<String> {
    let mut crudos: Vec<String> = Vec::new();
    let mut actual = String::new();
    let mut comilla: Option<char> = None;
    for c in interior.chars() {
        if let Some(q) = comilla {
            actual.push(c);
            if c == q {
                comilla = None;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            comilla = Some(c);
        }
        if c == ',' {
            crudos.push(std::mem::take(&mut actual));
            continue;
        }
        actual.push(c);
    }
    crudos.push(actual);
    crudos
        .iter()
        .map(|s| quitar_comillas(s.trim()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Tipo de un literal, en el orden de la spec.
fn inferir(bruto: &str) -> (&'static str, Valor) {
    let s = bruto.trim();
    if es_entrecomillado(s) {
        return ("texto", Valor::Texto(quitar_comillas(s)));
    }
    if bool_re().is_match(s) {
        return ("casilla", Valor::Casilla(s.eq_ignore_ascii_case("true")));
    }
    if numero_re().is_match(s) {
        return ("numero", Valor::Numero(s.parse().unwrap_or(0.0)));
    }
    if fecha_hora_re().is_match(s) {
        return ("fechaHora", Valor::Texto(s.to_string()));
    }
    if fecha_re().is_match(s) {
        return ("fecha", Valor::Texto(s.to_string()));
    }
    if s.starts_with('[') && s.ends_with(']') && s.len() >= 2 {
        return ("lista", Valor::Lista(partir_lista(&s[1..s.len() - 1])));
    }
    ("texto", Valor::Texto(s.to_string()))
}

fn motivo_no_soportado(bruto: &str) -> Option<String> {
    let s = bruto.trim();
    if multilinea_re().is_match(s) {
        return Some("usa un escalar multilínea (`|` o `>`)".into());
    }
    if s.starts_with('&') {
        return Some("usa un ancla de YAML (`&`)".into());
    }
    if s.starts_with('*') {
        return Some("usa un alias de YAML (`*`)".into());
    }
    if s.starts_with('!') {
        return Some("usa una etiqueta de YAML (`!`)".into());
    }
    if s.starts_with('{') {
        return Some("tiene un mapa en línea (`{…}`)".into());
    }
    None
}

/// Número a texto **como lo hace JavaScript** (`String(n)`), que es como la app
/// lo guarda en el índice: `7` y no `7.0`, `0` y no `-0`.
pub fn numero_a_texto(n: f64) -> String {
    if n == 0.0 {
        return "0".into();
    }
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e21 {
        return format!("{n:.0}");
    }
    format!("{n}")
}

fn valor_a_textos(v: &Valor) -> Vec<String> {
    match v {
        Valor::Texto(s) => vec![s.clone()],
        Valor::Numero(n) => vec![numero_a_texto(*n)],
        Valor::Casilla(b) => vec![if *b { "true" } else { "false" }.into()],
        Valor::Lista(l) => l.clone(),
    }
}

/// `tags` es SIEMPRE lista de texto, y sus elementos se aceptan con o sin `#`.
fn normalizar_tags(valor: &Valor) -> Vec<String> {
    let bruta: Vec<String> = match valor {
        Valor::Lista(l) => l.clone(),
        Valor::Texto(s) if s.is_empty() => vec![],
        otro => valor_a_textos(otro),
    };
    bruta
        .iter()
        .map(|t| {
            let t = t.trim();
            t.strip_prefix('#').unwrap_or(t).to_string()
        })
        .filter(|t| !t.is_empty())
        .collect()
}

fn es_tags(clave: &str) -> bool {
    clave.eq_ignore_ascii_case("tags")
}

/// Separa el frontmatter del cuerpo. Reglas (spec § 1): el archivo EMPIEZA con
/// una línea `---`; el bloque cierra en la primera línea `---` o `...`; sin
/// cierre no hay frontmatter; el bloque vacío es válido y sin propiedades.
pub fn separar_frontmatter(texto: &str) -> Frontmatter {
    let lineas: Vec<&str> = texto.split('\n').collect();
    if lineas.len() < 2 || sin_cr(lineas[0]) != "---" {
        return Frontmatter::No;
    }
    let Some(cierre) = (1..lineas.len()).find(|&i| {
        let t = sin_cr(lineas[i]);
        t == "---" || t == "..."
    }) else {
        return Frontmatter::No;
    };
    let cuerpo_desde = cierre + 1;
    let no_soportado = |motivo: String| Frontmatter::NoSoportado { motivo, cuerpo_desde };

    let mut props: Vec<Propiedad> = Vec::new();
    let mut vistas: Vec<String> = Vec::new();
    let mut i = 1;

    while i < cierre {
        let cruda = sin_cr(lineas[i]);
        if cruda.trim().is_empty() || es_comentario(cruda) {
            i += 1;
            continue;
        }
        if cruda.starts_with(' ') || cruda.starts_with('\t') {
            return no_soportado("tiene indentación fuera de una lista".into());
        }
        if item_re().is_match(cruda) {
            return no_soportado("no es un mapa de `clave: valor`".into());
        }
        let Some(m) = clave_re().captures(cruda) else {
            return no_soportado(format!("no se entiende la línea «{}»", cruda.trim()));
        };
        let clave = quitar_comillas(m[1].trim());
        let clave_min = clave.to_lowercase();
        if vistas.contains(&clave_min) {
            return no_soportado(format!("la clave «{clave}» está repetida"));
        }
        vistas.push(clave_min);

        let bruto = quitar_comentario(m.get(2).map_or("", |g| g.as_str()));

        if bruto.is_empty() {
            let mut j = i + 1;
            while j < cierre && {
                let l = sin_cr(lineas[j]);
                l.trim().is_empty() || es_comentario(l)
            } {
                j += 1;
            }
            let sig = if j < cierre { Some(sin_cr(lineas[j])) } else { None };

            if let Some(sig_l) = sig {
                if item_re().is_match(sig_l) {
                    let mut items: Vec<String> = Vec::new();
                    let mut hasta = i;
                    while j < cierre {
                        let l = sin_cr(lineas[j]);
                        if l.trim().is_empty() {
                            break;
                        }
                        if es_comentario(l) {
                            j += 1;
                            continue;
                        }
                        let Some(mi) = item_re().captures(l) else { break };
                        let item = quitar_comentario(mi.get(1).map_or("", |g| g.as_str()));
                        let item = item.trim();
                        if item_mapa_re().is_match(item) || item.starts_with('{') {
                            return no_soportado("tiene una lista de mapas".into());
                        }
                        if let Some(motivo) = motivo_no_soportado(item) {
                            return no_soportado(motivo);
                        }
                        if !item.is_empty() {
                            items.push(quitar_comillas(item));
                        }
                        hasta = j;
                        j += 1;
                    }
                    let valor = if es_tags(&clave) {
                        Valor::Lista(normalizar_tags(&Valor::Lista(items)))
                    } else {
                        Valor::Lista(items)
                    };
                    props.push(Propiedad { clave, tipo: "lista", valor });
                    i = hasta + 1;
                    continue;
                }
                if sig_l.starts_with(' ') || sig_l.starts_with('\t') {
                    return no_soportado("tiene un mapa anidado".into());
                }
            }

            let (tipo, valor) = if es_tags(&clave) {
                ("lista", Valor::Lista(vec![]))
            } else {
                ("texto", Valor::Texto(String::new()))
            };
            props.push(Propiedad { clave, tipo, valor });
            i += 1;
            continue;
        }

        if let Some(motivo) = motivo_no_soportado(&bruto) {
            return no_soportado(motivo);
        }
        let (tipo, valor) = inferir(&bruto);
        let (tipo, valor) = if es_tags(&clave) {
            ("lista", Valor::Lista(normalizar_tags(&valor)))
        } else {
            (tipo, valor)
        };
        props.push(Propiedad { clave, tipo, valor });
        i += 1;
    }

    Frontmatter::Soportado { props, cuerpo_desde }
}

/// Filas indexables de las propiedades: `(clave, valor, tipo, orden)`, **una por
/// elemento** de lista. Es lo que `reindexarPropiedades` escribe en la app.
pub fn filas_indexables(fm: &Frontmatter) -> Vec<(String, String, &'static str, usize)> {
    let mut out = Vec::new();
    for p in fm.props() {
        for (orden, v) in valor_a_textos(&p.valor).into_iter().enumerate() {
            out.push((p.clave.clone(), v, p.tipo, orden));
        }
    }
    out
}

/// Los valores de las propiedades (sin claves), para el texto indexable: buscar
/// «activo» encuentra la nota, buscar «tags» no las devuelve todas. Espeja
/// `textoIndexable` de `lib/db/propiedades.ts`.
pub fn valores_indexables(fm: &Frontmatter) -> Vec<String> {
    fm.props()
        .iter()
        .flat_map(|p| valor_a_textos(&p.valor))
        .filter(|v| !v.is_empty())
        .collect()
}

/// Las etiquetas del frontmatter (`tags:`), ya normalizadas.
pub fn tags_del_frontmatter(fm: &Frontmatter) -> Vec<String> {
    fm.props()
        .iter()
        .find(|p| es_tags(&p.clave))
        .map(|p| match &p.valor {
            Valor::Lista(l) => l.clone(),
            _ => vec![],
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props(texto: &str) -> Vec<Propiedad> {
        match separar_frontmatter(texto) {
            Frontmatter::Soportado { props, .. } => props,
            otro => panic!("se esperaba soportado: {otro:?}"),
        }
    }

    #[test]
    fn sin_bloque_o_sin_cierre_no_hay_frontmatter() {
        assert_eq!(separar_frontmatter("# Hola\n---\n"), Frontmatter::No);
        assert_eq!(separar_frontmatter("---\nclave: v\n"), Frontmatter::No);
        assert_eq!(separar_frontmatter("---"), Frontmatter::No);
    }

    #[test]
    fn bloque_vacio_es_valido() {
        let fm = separar_frontmatter("---\n---\ncuerpo");
        assert_eq!(fm, Frontmatter::Soportado { props: vec![], cuerpo_desde: 2 });
    }

    #[test]
    fn infiere_los_tipos_en_el_orden_de_la_spec() {
        let p = props(
            "---\nt: hola\nn: 3.5\nc: TRUE\nf: 2026-09-24\nfh: 2026-09-24 10:30\nl: [a, \"b, c\"]\nq: \"1.0\"\n---\n",
        );
        let tipos: Vec<_> = p.iter().map(|x| x.tipo).collect();
        assert_eq!(tipos, ["texto", "numero", "casilla", "fecha", "fechaHora", "lista", "texto"]);
        assert_eq!(p[5].valor, Valor::Lista(vec!["a".into(), "b, c".into()]));
        assert_eq!(p[6].valor, Valor::Texto("1.0".into()));
    }

    #[test]
    fn listas_en_bloque_y_tags_sin_almohadilla() {
        let p = props("---\ntags:\n  - #idea\n  - proyecto # comentario\nalias:\n- uno\n---\n");
        assert_eq!(p[0].valor, Valor::Lista(vec!["idea".into(), "proyecto".into()]));
        assert_eq!(p[1].valor, Valor::Lista(vec!["uno".into()]));
    }

    #[test]
    fn comentario_final_y_almohadilla_literal() {
        let p = props("---\nestado: activo # nota\nurl: https://x.y/#a\ntags: #idea\n---\n");
        assert_eq!(p[0].valor, Valor::Texto("activo".into()));
        assert_eq!(p[1].valor, Valor::Texto("https://x.y/#a".into()));
        assert_eq!(p[2].valor, Valor::Lista(vec!["idea".into()]));
    }

    #[test]
    fn lo_no_soportado_no_se_interpreta() {
        for (texto, motivo) in [
            ("---\nm:\n  a: 1\n---\n", "mapa anidado"),
            ("---\nd: |\n---\n", "multilínea"),
            ("---\nx: {a: 1}\n---\n", "mapa en línea"),
            ("---\na: 1\na: 2\n---\n", "repetida"),
            ("---\nl:\n  - a: 1\n---\n", "lista de mapas"),
            ("---\n  indentado: 1\n---\n", "indentación"),
        ] {
            match separar_frontmatter(texto) {
                Frontmatter::NoSoportado { motivo: m, .. } => assert!(m.contains(motivo), "{m}"),
                otro => panic!("{texto:?} → {otro:?}"),
            }
        }
    }

    #[test]
    fn crlf_se_lee_igual() {
        let p = props("---\r\nestado: activo\r\n---\r\ncuerpo");
        assert_eq!(p[0].valor, Valor::Texto("activo".into()));
    }

    #[test]
    fn numeros_como_javascript() {
        assert_eq!(numero_a_texto(7.0), "7");
        assert_eq!(numero_a_texto(1.5), "1.5");
        assert_eq!(numero_a_texto(-0.0), "0");
        let fm = separar_frontmatter("---\nn: 007\nl: [x, y]\n---\n");
        let filas = filas_indexables(&fm);
        assert_eq!(filas[0], ("n".into(), "7".into(), "numero", 0));
        assert_eq!(filas[2], ("l".into(), "y".into(), "lista", 1));
    }
}
