//! Búsqueda por sección con BM25, y las señales del ranking
//! (`MCP de Mycelium - memoria` § 6, plan § 4.1).
//!
//! > [!danger] Solo `rel` ordena
//! > Se calculan cinco señales y se devuelven todas, pero los pesos de la v1 son
//! > `rel = 1` y **todo lo demás 0**: los pesos se calibran *offline* sobre el
//! > registro de búsquedas, no se inventan.
//!
//! | Señal | Qué es |
//! |---|---|
//! | `rel` | `-bm25` de la sección, dividido por el mejor del conjunto |
//! | `pop` | `log1p(backlinks) / log1p(max_backlinks_del_vault)` |
//! | `prox` | `0.5^d`, `d` = saltos hasta la nota `cerca_de` (hasta 2); 0 sin ella |
//! | `rec` | `exp(-días_desde_mtime / 90)` |
//! | `anc` | texto de los enlaces **entrantes** que casa con la consulta (señal de nota) |

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::types::Value;

use super::{ahora_ms, e, Indice, Resultado};

/// Peso de cada columna de `secciones_fts` dentro de BM25: título de la nota,
/// migas de encabezados, cuerpo. Alto / medio / base, como decide la nota;
/// los números exactos son un parámetro de calibración y quedan registrados en
/// cada búsqueda.
pub const PESO_TITULO: f64 = 4.0;
pub const PESO_ENCABEZADOS: f64 = 2.0;
pub const PESO_CUERPO: f64 = 1.0;

/// Pesos del puntaje final. **v1: solo `rel`.**
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Pesos {
    pub rel: f64,
    pub pop: f64,
    pub prox: f64,
    pub rec: f64,
    pub anc: f64,
}

pub const PESOS_V1: Pesos = Pesos { rel: 1.0, pop: 0.0, prox: 0.0, rec: 0.0, anc: 0.0 };

/// Las cinco señales de un resultado, todas en `[0, 1]`.
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct Senales {
    pub rel: f64,
    pub pop: f64,
    pub prox: f64,
    pub rec: f64,
    pub anc: f64,
}

impl Senales {
    pub fn puntaje(&self, w: &Pesos) -> f64 {
        w.rel * self.rel + w.pop * self.pop + w.prox * self.prox + w.rec * self.rec + w.anc * self.anc
    }
}

/// Dónde se busca.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ambito {
    /// Una fila por sección (por defecto).
    Secciones,
    /// Una fila por nota: su mejor sección.
    Notas,
}

/// Filtros que restringen la búsqueda.
#[derive(Debug, Clone, Default)]
pub struct Filtros {
    /// `clave = valor` en el frontmatter (sin distinguir mayúsculas).
    pub propiedades: Vec<(String, String)>,
    /// Todas estas etiquetas (con o sin `#`).
    pub tags: Vec<String>,
    /// Solo notas bajo esta carpeta (ruta relativa).
    pub carpeta: Option<String>,
    /// Solo notas de este tipo (`markdown`, `canvas`…).
    pub tipo: Option<String>,
}

impl Filtros {
    pub fn vacio(&self) -> bool {
        self.propiedades.is_empty() && self.tags.is_empty() && self.carpeta.is_none() && self.tipo.is_none()
    }
}

#[derive(Debug, Clone)]
pub struct Consulta {
    pub texto: String,
    pub filtros: Filtros,
    /// Nota (ruta o título) que activa la señal `prox`.
    pub cerca_de: Option<String>,
    pub ambito: Ambito,
    pub limite: usize,
}

/// Cómo se llegó a los resultados.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Modo {
    /// Todos los términos en una misma sección.
    Seccion,
    /// Ninguna sección los tenía todos: notas que los tienen **entre varias**
    /// secciones, con la mejor sección de cada término (§ 4 de la nota).
    Interseccion,
    /// Solo filtros, sin texto.
    Filtros,
}

/// Un resultado: una sección, con lo necesario para el preview.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Encontrado {
    pub nota_id: String,
    pub titulo: String,
    pub orden: usize,
    pub ruta_encabezados: String,
    pub linea_ini: usize,
    pub linea_fin: usize,
    pub bytes: usize,
    pub parcial: bool,
    /// Fragmento con las coincidencias entre «».
    pub fragmento: String,
    /// `-bm25` crudo (antes de normalizar).
    pub bm25: f64,
    pub senales: Senales,
    pub puntaje: f64,
}

impl Encontrado {
    /// La referencia que entiende `vault_leer`: `ruta#s<orden>`.
    pub fn referencia(&self) -> String {
        format!("{}#s{}", self.nota_id, self.orden)
    }
}

#[derive(Debug, Clone)]
pub struct Busqueda {
    /// Cuántas secciones (o notas, según el ámbito) casan en total.
    pub total: usize,
    pub modo: Modo,
    pub resultados: Vec<Encontrado>,
    /// La expresión FTS5 que se ejecutó (para el registro).
    pub expresion: String,
    /// La nota `cerca_de` resuelta, si se pasó y existe.
    pub cerca_de: Option<String>,
}

/// Parte la consulta en términos: frases entre comillas o palabras sueltas.
/// Lo que no tiene ni una letra ni un número no es un término (FTS5 fallaría).
pub fn terminos(texto: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut resto = texto.trim();
    while !resto.is_empty() {
        let (t, sig) = if let Some(r) = resto.strip_prefix('"') {
            match r.find('"') {
                Some(i) => (format!("\"{}\"", &r[..i]), &r[i + 1..]),
                None => (r.to_string(), ""),
            }
        } else {
            let fin = resto.find(char::is_whitespace).unwrap_or(resto.len());
            (resto[..fin].to_string(), &resto[fin..])
        };
        if t.chars().any(char::is_alphanumeric) {
            out.push(t);
        }
        resto = sig.trim_start();
    }
    out
}

/// Un término a su forma FTS5: entre comillas (neutraliza los operadores) y,
/// si no es una frase, con `*` de prefijo para que «enlace» encuentre
/// «enlaces».
fn a_fts(termino: &str) -> String {
    if termino.len() > 2 && termino.starts_with('"') && termino.ends_with('"') {
        let dentro = &termino[1..termino.len() - 1];
        return format!("\"{}\"", dentro.replace('"', "\"\""));
    }
    let limpio = termino.replace('"', "\"\"");
    let prefijo = if limpio.chars().last().is_some_and(char::is_alphanumeric) { "*" } else { "" };
    format!("\"{limpio}\"{prefijo}")
}

pub fn expresion_fts(terminos: &[String]) -> String {
    terminos.iter().map(|t| a_fts(t)).collect::<Vec<_>>().join(" ")
}

/// Condiciones SQL de los filtros (sobre `n` = notas).
fn sql_filtros(f: &Filtros, params: &mut Vec<Value>) -> String {
    let mut sql = String::new();
    if let Some(c) = &f.carpeta {
        let c = c.replace('\\', "/").trim_matches('/').to_string();
        if !c.is_empty() {
            sql.push_str(" AND (n.id LIKE ? ESCAPE '\\' )");
            let esc = c.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            params.push(Value::Text(format!("{esc}/%")));
        }
    }
    if let Some(t) = &f.tipo {
        sql.push_str(" AND n.tipo = ?");
        params.push(Value::Text(t.to_lowercase()));
    }
    for t in &f.tags {
        let t = t.trim().trim_start_matches('#');
        sql.push_str(" AND EXISTS (SELECT 1 FROM tags t WHERE t.nota_id = n.id AND t.tag = ? COLLATE NOCASE)");
        params.push(Value::Text(t.to_string()));
    }
    for (clave, valor) in &f.propiedades {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM propiedades p WHERE p.nota_id = n.id
                 AND p.clave = ? COLLATE NOCASE AND p.valor = ? COLLATE NOCASE)",
        );
        params.push(Value::Text(clave.clone()));
        params.push(Value::Text(valor.clone()));
    }
    sql
}

/// Una fila candidata antes de calcular las señales de grafo.
struct Candidato {
    e: Encontrado,
    mtime: i64,
    titulo_norm: String,
}

impl Indice {
    /// Resuelve una nota por ruta relativa (exacta o sin distinguir mayúsculas)
    /// o por título. Devuelve todas las que casan: más de una es ambigüedad.
    pub fn resolver_nota(&self, texto: &str) -> Resultado<Vec<(String, String)>> {
        let t = texto.trim().replace('\\', "/");
        let t = t.trim_start_matches("./");
        let mut st = self
            .conn
            .prepare(
                "SELECT id, titulo FROM notas WHERE id = ?1
                 UNION SELECT id, titulo FROM notas WHERE id = ?1 COLLATE NOCASE
                 UNION SELECT id, titulo FROM notas WHERE titulo_norm = ?2
                 UNION SELECT id, titulo FROM notas WHERE titulo_norm = ?3",
            )
            .map_err(e)?;
        // Las minúsculas se calculan acá y no con `lower()`: la de SQLite solo
        // sabe de ASCII y `titulo_norm` se guardó con las de Unicode («Índice»).
        // `?3`: el título sin extensión, por si pasaron `Nota.md`.
        let sin_ext = crate::tipos::titulo_de_ruta(t).to_lowercase();
        let filas = st
            .query_map(rusqlite::params![t, t.to_lowercase(), sin_ext], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(e)?;
        let mut out: Vec<(String, String)> = Vec::new();
        for f in filas {
            let f = f.map_err(e)?;
            // La ruta exacta gana a todo lo demás.
            if f.0 == t {
                return Ok(vec![f]);
            }
            if !out.contains(&f) {
                out.push(f);
            }
        }
        Ok(out)
    }

    /// Ejecuta una consulta. **No revalida**: eso lo decide quien llama (el MCP
    /// revalida antes de cada herramienta).
    pub fn buscar(&self, c: &Consulta) -> Resultado<Busqueda> {
        let limite = c.limite.clamp(1, 50);
        let terms = terminos(&c.texto);
        let cerca_de = match &c.cerca_de {
            Some(n) => self.resolver_nota(n)?.into_iter().next().map(|(id, _)| id),
            None => None,
        };

        if terms.is_empty() {
            if c.filtros.vacio() {
                return Err("La consulta está vacía: pasá texto, filtros o las dos cosas.".into());
            }
            return self.solo_filtros(c, limite, cerca_de);
        }

        let expresion = expresion_fts(&terms);
        let tope = match c.ambito {
            Ambito::Secciones => (limite * 3).max(30),
            Ambito::Notas => 300,
        };
        let (mut total, mut candidatos) = self.consultar(&expresion, &c.filtros, tope, c.ambito)?;
        let mut modo = Modo::Seccion;

        if total == 0 && terms.len() > 1 {
            let (t, cands) = self.interseccion(&terms, &c.filtros)?;
            total = t;
            candidatos = cands;
            modo = Modo::Interseccion;
        }

        let resultados = self.puntuar(candidatos, &expresion, cerca_de.as_deref(), c.ambito, limite)?;
        Ok(Busqueda { total, modo, resultados, expresion, cerca_de })
    }

    /// Filas que casan con `expresion`, en orden de BM25, y el total.
    fn consultar(
        &self,
        expresion: &str,
        filtros: &Filtros,
        tope: usize,
        ambito: Ambito,
    ) -> Resultado<(usize, Vec<Candidato>)> {
        let mut params: Vec<Value> = vec![Value::Text(expresion.to_string())];
        let filtro_sql = sql_filtros(filtros, &mut params);
        let desde = format!(
            "FROM secciones_fts
             JOIN secciones s ON s.id = secciones_fts.rowid
             JOIN notas n ON n.id = s.nota_id
             WHERE secciones_fts MATCH ?{filtro_sql}"
        );
        let contar = match ambito {
            Ambito::Secciones => format!("SELECT COUNT(*) {desde}"),
            Ambito::Notas => format!("SELECT COUNT(DISTINCT s.nota_id) {desde}"),
        };
        let total: i64 = self
            .conn
            .query_row(&contar, rusqlite::params_from_iter(params.iter()), |r| r.get(0))
            .map_err(e)?;

        let sql = format!(
            "SELECT s.nota_id, n.titulo, s.orden, s.ruta_encabezados, s.linea_ini, s.linea_fin, s.bytes,
                    s.parcial, n.mtime, n.titulo_norm,
                    -bm25(secciones_fts, {PESO_TITULO}, {PESO_ENCABEZADOS}, {PESO_CUERPO}) AS b,
                    snippet(secciones_fts, 2, '«', '»', '…', 16) AS frag
             {desde}
             ORDER BY b DESC
             LIMIT {tope}"
        );
        let mut st = self.conn.prepare(&sql).map_err(e)?;
        let filas = st
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok(Candidato {
                    e: Encontrado {
                        nota_id: r.get(0)?,
                        titulo: r.get(1)?,
                        orden: r.get::<_, i64>(2)? as usize,
                        ruta_encabezados: r.get(3)?,
                        linea_ini: r.get::<_, i64>(4)? as usize,
                        linea_fin: r.get::<_, i64>(5)? as usize,
                        bytes: r.get::<_, i64>(6)? as usize,
                        parcial: r.get::<_, i64>(7)? != 0,
                        fragmento: r.get(11)?,
                        bm25: r.get(10)?,
                        senales: Senales::default(),
                        puntaje: 0.0,
                    },
                    mtime: r.get(8)?,
                    titulo_norm: r.get(9)?,
                })
            })
            .map_err(e)?;
        let mut out = Vec::new();
        for f in filas {
            out.push(f.map_err(e)?);
        }
        Ok((total as usize, out))
    }

    /// Ningún par de términos comparte sección: una subconsulta por término,
    /// intersección por nota, y la mejor sección de cada término.
    fn interseccion(&self, terms: &[String], filtros: &Filtros) -> Resultado<(usize, Vec<Candidato>)> {
        let mut por_termino: Vec<Vec<Candidato>> = Vec::new();
        for t in terms {
            let (_, cands) = self.consultar(&a_fts(t), filtros, 200, Ambito::Secciones)?;
            por_termino.push(cands);
        }
        let mut comunes: Option<HashSet<String>> = None;
        for cands in &por_termino {
            let notas: HashSet<String> = cands.iter().map(|c| c.e.nota_id.clone()).collect();
            comunes = Some(match comunes {
                None => notas,
                Some(prev) => prev.intersection(&notas).cloned().collect(),
            });
        }
        let comunes = comunes.unwrap_or_default();
        // BM25 de términos distintos no es comparable: se normaliza cada término
        // contra su mejor sección antes de mezclarlos.
        let mut out: Vec<Candidato> = Vec::new();
        let mut vistas: HashSet<(String, usize)> = HashSet::new();
        for cands in por_termino {
            let mejor = cands.first().map(|c| c.e.bm25).unwrap_or(1.0).max(f64::EPSILON);
            let mut ya: HashSet<String> = HashSet::new();
            for mut c in cands {
                if !comunes.contains(&c.e.nota_id) || !ya.insert(c.e.nota_id.clone()) {
                    continue;
                }
                if vistas.insert((c.e.nota_id.clone(), c.e.orden)) {
                    c.e.bm25 /= mejor;
                    out.push(c);
                }
            }
        }
        out.sort_by(|a, b| b.e.bm25.total_cmp(&a.e.bm25));
        Ok((comunes.len(), out))
    }

    /// Calcula las señales, ordena por puntaje y corta.
    fn puntuar(
        &self,
        mut cands: Vec<Candidato>,
        expresion: &str,
        cerca_de: Option<&str>,
        ambito: Ambito,
        limite: usize,
    ) -> Resultado<Vec<Encontrado>> {
        if ambito == Ambito::Notas {
            let mut vistas = HashSet::new();
            cands.retain(|c| vistas.insert(c.e.nota_id.clone()));
        }
        let mejor = cands.iter().map(|c| c.e.bm25).fold(0.0_f64, f64::max);
        let backlinks = self.backlinks()?;
        let max_bl = backlinks.values().copied().max().unwrap_or(0);
        let distancias = match cerca_de {
            Some(id) => self.distancias_desde(id, 2)?,
            None => HashMap::new(),
        };
        let anclas = self.senal_anclas(expresion)?;
        let ahora = ahora_ms();

        for c in &mut cands {
            let bl = backlinks.get(&c.e.nota_id).copied().unwrap_or(0);
            let s = Senales {
                rel: if mejor > 0.0 { c.e.bm25 / mejor } else { 0.0 },
                pop: if max_bl > 0 { (bl as f64).ln_1p() / (max_bl as f64).ln_1p() } else { 0.0 },
                prox: distancias.get(&c.e.nota_id).map(|d| 0.5_f64.powi(*d as i32)).unwrap_or(0.0),
                rec: (-((ahora - c.mtime).max(0) as f64) / 86_400_000.0 / 90.0).exp(),
                anc: anclas.get(&c.titulo_norm).copied().unwrap_or(0.0),
            };
            c.e.puntaje = s.puntaje(&PESOS_V1);
            c.e.senales = s;
        }
        // Orden estable: a igual puntaje queda el orden de BM25.
        cands.sort_by(|a, b| b.e.puntaje.total_cmp(&a.e.puntaje));
        Ok(cands.into_iter().take(limite).map(|c| c.e).collect())
    }

    /// Backlinks por nota: cuántas **otras** notas la enlazan (resuelto por join
    /// contra `titulo_norm`, § 5 de la nota).
    fn backlinks(&self) -> Resultado<HashMap<String, usize>> {
        let mut st = self
            .conn
            .prepare(
                "SELECT n.id, COUNT(DISTINCT e.origen_id)
                   FROM enlaces e JOIN notas n ON n.titulo_norm = e.destino_norm
                  WHERE e.origen_id <> n.id
                  GROUP BY n.id",
            )
            .map_err(e)?;
        let filas = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize))).map_err(e)?;
        let mut out = HashMap::new();
        for f in filas {
            let (id, n) = f.map_err(e)?;
            out.insert(id, n);
        }
        Ok(out)
    }

    /// Distancia en saltos (sin dirección) desde `origen`, hasta `max`.
    fn distancias_desde(&self, origen: &str, max: usize) -> Resultado<HashMap<String, usize>> {
        let mut st = self
            .conn
            .prepare(
                "SELECT DISTINCT e.origen_id, n.id
                   FROM enlaces e JOIN notas n ON n.titulo_norm = e.destino_norm
                  WHERE e.origen_id <> n.id",
            )
            .map_err(e)?;
        let filas = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(e)?;
        let mut vecinos: HashMap<String, Vec<String>> = HashMap::new();
        for f in filas {
            let (a, b) = f.map_err(e)?;
            vecinos.entry(a.clone()).or_default().push(b.clone());
            vecinos.entry(b).or_default().push(a);
        }
        let mut dist = HashMap::from([(origen.to_string(), 0usize)]);
        let mut cola = VecDeque::from([origen.to_string()]);
        while let Some(n) = cola.pop_front() {
            let d = dist[&n];
            if d >= max {
                continue;
            }
            for v in vecinos.get(&n).into_iter().flatten() {
                if !dist.contains_key(v) {
                    dist.insert(v.clone(), d + 1);
                    cola.push_back(v.clone());
                }
            }
        }
        Ok(dist)
    }

    /// Quinta señal (plan § 4.1): cuánto casa la consulta con el texto de los
    /// enlaces **entrantes** de cada nota, por `destino_norm`, normalizado a [0,1].
    /// Es una señal **de nota**: todas sus secciones reciben el mismo valor (la
    /// regla de fusión con un ranking por sección queda para la calibración).
    fn senal_anclas(&self, expresion: &str) -> Resultado<HashMap<String, f64>> {
        let mut st = self
            .conn
            .prepare("SELECT destino_norm, -bm25(enlaces_fts) FROM enlaces_fts WHERE enlaces_fts MATCH ? LIMIT 1000")
            .map_err(e)?;
        let filas = st.query_map([expresion], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))).map_err(e)?;
        let mut suma: HashMap<String, f64> = HashMap::new();
        for f in filas {
            let (d, b) = f.map_err(e)?;
            *suma.entry(d).or_default() += b.max(0.0);
        }
        let max = suma.values().copied().fold(0.0_f64, f64::max);
        if max > 0.0 {
            for v in suma.values_mut() {
                *v /= max;
            }
        }
        Ok(suma)
    }

    /// Sin texto: las notas que cumplen los filtros, con su primera sección.
    fn solo_filtros(&self, c: &Consulta, limite: usize, cerca_de: Option<String>) -> Resultado<Busqueda> {
        let mut params: Vec<Value> = Vec::new();
        let filtro_sql = sql_filtros(&c.filtros, &mut params);
        let desde = format!("FROM notas n WHERE 1 = 1{filtro_sql}");
        let total: i64 = self
            .conn
            .query_row(&format!("SELECT COUNT(*) {desde}"), rusqlite::params_from_iter(params.iter()), |r| r.get(0))
            .map_err(e)?;
        let sql = format!(
            "SELECT n.id, n.titulo, s.orden, s.ruta_encabezados, s.linea_ini, s.linea_fin, s.bytes, s.parcial,
                    n.mtime, n.titulo_norm, substr(f.cuerpo, 1, 160)
               FROM notas n
               LEFT JOIN secciones s ON s.nota_id = n.id
                     AND s.orden = (SELECT MIN(orden) FROM secciones WHERE nota_id = n.id)
               LEFT JOIN secciones_fts f ON f.rowid = s.id
              WHERE 1 = 1{filtro_sql}
              ORDER BY n.titulo
              LIMIT {limite}"
        );
        let mut st = self.conn.prepare(&sql).map_err(e)?;
        let filas = st
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok(Encontrado {
                    nota_id: r.get(0)?,
                    titulo: r.get(1)?,
                    orden: r.get::<_, Option<i64>>(2)?.unwrap_or(0) as usize,
                    ruta_encabezados: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    linea_ini: r.get::<_, Option<i64>>(4)?.unwrap_or(1) as usize,
                    linea_fin: r.get::<_, Option<i64>>(5)?.unwrap_or(1) as usize,
                    bytes: r.get::<_, Option<i64>>(6)?.unwrap_or(0) as usize,
                    parcial: r.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
                    fragmento: r.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    bm25: 0.0,
                    senales: Senales::default(),
                    puntaje: 0.0,
                })
            })
            .map_err(e)?;
        let mut resultados = Vec::new();
        for f in filas {
            resultados.push(f.map_err(e)?);
        }
        Ok(Busqueda { total: total as usize, modo: Modo::Filtros, resultados, expresion: String::new(), cerca_de })
    }
}

#[cfg(test)]
mod tests {
    use super::super::pruebas::VaultDePrueba;
    use super::*;

    fn consulta(texto: &str) -> Consulta {
        Consulta {
            texto: texto.into(),
            filtros: Filtros::default(),
            cerca_de: None,
            ambito: Ambito::Secciones,
            limite: 10,
        }
    }

    fn vault() -> (VaultDePrueba, Indice) {
        let v = VaultDePrueba::nuevo("buscar");
        v.escribir(
            "BACKLOG.md",
            "# BACKLOG\nintro\n## Grandes\n### FUN-L-09\nel servidor MCP de memoria\n### FUN-L-10\nindexado en Rust\n",
        );
        v.escribir("docs/Índice.md", "---\nestado: activo\ntags: [mapa]\n---\nVer [[BACKLOG|la lista]] y [[Rust]].\n");
        v.escribir("docs/Rust.md", "# Rust\nun lenguaje. Ejemplo: `[[BACKLOG]]` no cuenta.\n## Tauri\nsqlite y tauri\n");
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        (v, ix)
    }

    #[test]
    fn busca_por_seccion_con_migas_completas() {
        let (_v, ix) = vault();
        let b = ix.buscar(&consulta("servidor memoria")).unwrap();
        assert_eq!(b.modo, Modo::Seccion);
        assert_eq!(b.total, 1);
        let r = &b.resultados[0];
        assert_eq!(r.referencia(), "BACKLOG.md#s3");
        assert_eq!(r.ruta_encabezados, "BACKLOG > Grandes > FUN-L-09");
        assert!(r.fragmento.contains("«servidor»"), "{}", r.fragmento);
        assert_eq!(r.senales.rel, 1.0);
    }

    #[test]
    fn las_migas_se_indexan_y_los_acentos_no_importan() {
        let (_v, ix) = vault();
        // «Grandes» solo aparece como encabezado ancestro de FUN-L-09 y FUN-L-10.
        let b = ix.buscar(&consulta("grandes")).unwrap();
        let refs: Vec<_> = b.resultados.iter().map(|r| r.referencia()).collect();
        assert!(refs.contains(&"BACKLOG.md#s3".to_string()), "{refs:?}");
        // «indice» encuentra «Índice» (remove_diacritics).
        let b = ix.buscar(&consulta("indice")).unwrap();
        assert_eq!(b.resultados[0].nota_id, "docs/Índice.md");
        // Prefijo: «index» encuentra «indexado».
        assert!(ix.buscar(&consulta("index")).unwrap().resultados.iter().any(|r| r.nota_id == "BACKLOG.md"));
    }

    #[test]
    fn sin_seccion_comun_cae_a_interseccion_por_nota() {
        let (_v, ix) = vault();
        let b = ix.buscar(&consulta("lenguaje sqlite")).unwrap();
        assert_eq!(b.modo, Modo::Interseccion);
        assert_eq!(b.total, 1);
        let refs: Vec<_> = b.resultados.iter().map(|r| r.referencia()).collect();
        assert_eq!(refs.len(), 2);
        assert!(refs.iter().all(|r| r.starts_with("docs/Rust.md#")));
    }

    #[test]
    fn filtros_por_propiedad_tag_carpeta() {
        let (_v, ix) = vault();
        let mut c = consulta("");
        c.filtros.propiedades.push(("Estado".into(), "ACTIVO".into()));
        let b = ix.buscar(&c).unwrap();
        assert_eq!((b.modo, b.total), (Modo::Filtros, 1));
        let mut c = consulta("");
        c.filtros.tags.push("#mapa".into());
        assert_eq!(ix.buscar(&c).unwrap().resultados[0].nota_id, "docs/Índice.md");
        let mut c = consulta("rust");
        c.filtros.carpeta = Some("docs".into());
        assert!(ix.buscar(&c).unwrap().resultados.iter().all(|r| r.nota_id.starts_with("docs/")));
    }

    #[test]
    fn senales_de_grafo_y_anclas() {
        let (_v, ix) = vault();
        // BACKLOG tiene un backlink real (Índice); el de Rust está en código.
        let bl = ix.backlinks().unwrap();
        assert_eq!(bl.get("BACKLOG.md"), Some(&1));
        let mut c = consulta("lista");
        c.cerca_de = Some("Índice".into());
        let b = ix.buscar(&c).unwrap();
        // «la lista» es el alias con que Índice nombra al BACKLOG: señal `anc`.
        let r = b.resultados.iter().find(|r| r.nota_id == "BACKLOG.md");
        assert!(r.is_none(), "el cuerpo del BACKLOG no dice «lista»");
        let anc = ix.senal_anclas("\"lista\"*").unwrap();
        assert_eq!(anc.get("backlog"), Some(&1.0));
        // Proximidad: Rust está a un salto de Índice.
        let d = ix.distancias_desde("docs/Índice.md", 2).unwrap();
        assert_eq!(d.get("docs/Rust.md"), Some(&1));
        assert_eq!(b.cerca_de.as_deref(), Some("docs/Índice.md"));
    }

    #[test]
    fn terminos_y_expresion() {
        assert_eq!(terminos("hola \"dos palabras\" -- FUN-L-09"), ["hola", "\"dos palabras\"", "FUN-L-09"]);
        assert_eq!(expresion_fts(&terminos("a\"b FUN-L-09")), "\"a\"\"b\"* \"FUN-L-09\"*");
    }

    #[test]
    fn resolver_nota_por_ruta_titulo_o_mayusculas() {
        let (_v, ix) = vault();
        assert_eq!(ix.resolver_nota("docs/Rust.md").unwrap().len(), 1);
        assert_eq!(ix.resolver_nota("rust").unwrap()[0].0, "docs/Rust.md");
        assert_eq!(ix.resolver_nota("DOCS\\rust.md").unwrap()[0].0, "docs/Rust.md");
        assert!(ix.resolver_nota("no existe").unwrap().is_empty());
    }
}
