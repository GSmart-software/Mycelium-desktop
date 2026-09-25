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
//!
//! ## Cobertura, no conjunción (diagnóstico de la fase 1, causa 1)
//!
//! La fase 1 exigía **todos** los términos en la misma sección (`"a"* "b"* "c"*`):
//! una sola palabra de la consulta que la nota no usara la sacaba de la lista, y
//! 58 de 181 búsquedas de la tanda volvieron vacías. Ahora **alcanza con uno**
//! (`"a"* OR "b"* OR "c"*`) y el orden premia **cubrir más términos**:
//!
//! ```text
//! lexico = bm25(O) · cobertura²      cobertura = Σ idf(términos que tiene) / Σ idf(términos)
//! ```
//!
//! - **Por qué no un O a secas**: con O, una sección que repite un solo término
//!   común (y lo tiene en el título, que pesa 4) le gana a la que tiene casi
//!   todos. En la reproducción del diagnóstico eso bajó D01 de 8 a 3 de 10.
//! - **Por qué la cobertura va pesada por idf**: los términos que están en casi
//!   todas las secciones («no», «de», «la», y con prefijo más) no distinguen
//!   nada; contarlos como un término más haría ganar a las secciones largas que
//!   tienen todas las palabras vacías. Un término que no está en ninguna sección
//!   pesa 0 (no puede distinguir) y se le avisa al agente.
//! - **Por qué al cuadrado**: que la cobertura mande sin volver al Y. Con la
//!   mitad del peso cubierto, una sección necesita cuatro veces el BM25 de la que
//!   lo cubre todo para empatarle; entre coberturas parecidas ordena el BM25.
//!
//! El respaldo de la fase 1 —intersectar por nota cuando ninguna sección tenía
//! todos los términos— se sacó: exigía el mismo Y un nivel más arriba y, cuando
//! no volvía vacío, traía «la mejor sección de cada término», que era ruido.

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::types::Value;
use rusqlite::OptionalExtension;

use super::{ahora_ms, e, Indice, Resultado};

/// Peso de cada columna de `secciones_fts` dentro de BM25: título de la nota,
/// migas de encabezados, cuerpo. Alto / medio / base, como decide la nota;
/// los números exactos son un parámetro de calibración y quedan registrados en
/// cada búsqueda.
pub const PESO_TITULO: f64 = 4.0;
pub const PESO_ENCABEZADOS: f64 = 2.0;
pub const PESO_CUERPO: f64 = 1.0;

/// Exponente de la cobertura en el puntaje léxico (ver el encabezado del módulo).
pub const EXPONENTE_COBERTURA: f64 = 2.0;

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
    /// Secciones con **al menos un** término, ordenadas por cobertura y BM25.
    Seccion,
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
    /// `-bm25` crudo de la expresión con O (antes de normalizar).
    pub bm25: f64,
    /// Qué parte del peso (idf) de los términos tiene la sección, en `[0, 1]`.
    pub cobertura: f64,
    /// Cuántos términos de la consulta tiene la sección.
    pub cubiertos: usize,
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
    /// Términos que no aparecen en ninguna sección del vault (se le avisan al
    /// agente: es la palabra que hay que cambiar).
    pub sin_coincidencias: Vec<String>,
    /// Cuántas secciones (o notas) tienen todos los términos que sí existen.
    pub completos: usize,
    /// Cuántos términos distintos tuvo la consulta.
    pub terminos: usize,
}

impl Busqueda {
    /// Los términos de la consulta que están en alguna sección del vault.
    pub fn terminos_presentes(&self) -> usize {
        self.terminos - self.sin_coincidencias.len()
    }
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

/// Cuántas letras tiene la raíz con la que se buscan las variantes de una
/// palabra (tanda de desarrollo de la tesina, 2026-09-25).
///
/// El prefijo (`conclusiones*`) encuentra las palabras que **empiezan** con la
/// buscada, no sus variantes: la pregunta decía «conclusiones» y el encabezado
/// que la respondía, «El trabajo **concluye** consultivo». En prosa en español
/// eso pasa todo el tiempo (concluye/conclusiones, computación/computadora).
/// Truncar a una longitud fija es el lematizador más simple que hay, y a
/// propósito: no depende de un diccionario ni de un idioma, y lo que trae de más
/// lo frena [`PESO_RAIZ`]. Seis es un punto de partida, no una calibración: el
/// registro de búsquedas dirá si conviene otro.
pub const LARGO_RAIZ: usize = 6;

/// Cuánto cubre un término encontrado solo por su raíz, contra 1 por la palabra.
/// Con la cobertura al cuadrado, una sección que tiene un término solo por raíz
/// y el resto enteros queda por debajo de la que los tiene todos enteros, y por
/// encima de la que no tiene ese término de ninguna forma.
pub const PESO_RAIZ: f64 = 0.5;

/// La raíz de un término (sus primeras [`LARGO_RAIZ`] letras, en minúsculas),
/// o `None` si no hace falta o no aplica: frases, términos con algo que no sea
/// letra (`FUN-L-09`, `2029`) y palabras cortas, donde el prefijo ya alcanza.
/// Desde 8 letras: con 7, la raíz es la palabra menos una letra, y el prefijo
/// solo ya cubre casi lo mismo.
pub fn raiz(termino: &str) -> Option<String> {
    let letras: Vec<char> = termino.chars().collect();
    if letras.len() < LARGO_RAIZ + 2 || !letras.iter().all(|c| c.is_alphabetic()) {
        return None;
    }
    Some(letras[..LARGO_RAIZ].iter().collect::<String>().to_lowercase())
}

/// La expresión con **O**: alcanza con que la sección tenga un término.
pub fn expresion_fts(terminos: &[String]) -> String {
    terminos.iter().map(|t| a_fts(t)).collect::<Vec<_>>().join(" OR ")
}

/// El idf de BM25 (`ln(1 + (N − df + 0,5) / (df + 0,5))`); 0 si el término no
/// está en ninguna sección, porque entonces no distingue nada.
pub fn idf(n: usize, df: usize) -> f64 {
    if df == 0 {
        return 0.0;
    }
    let (n, df) = (n as f64, df as f64);
    (1.0 + (n - df + 0.5).max(0.0) / (df + 0.5)).ln()
}

/// El puntaje léxico de una sección: su BM25 por la cobertura al cuadrado.
pub fn lexico(bm25: f64, cobertura: f64) -> f64 {
    bm25.max(0.0) * cobertura.powf(EXPONENTE_COBERTURA)
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
    /// `secciones.id` (= rowid en `secciones_fts`).
    rowid: i64,
    /// `lexico(bm25, cobertura)`: lo que normalizado da `rel`.
    lexico: f64,
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
                 UNION SELECT id, titulo FROM notas WHERE titulo_norm = ?3
                 UNION SELECT id, titulo FROM notas WHERE titulo_norm = ?4",
            )
            .map_err(e)?;
        // Las minúsculas se calculan acá y no con `lower()`: la de SQLite solo
        // sabe de ASCII y `titulo_norm` se guardó con las de Unicode («Índice»).
        // `?3`: el título sin extensión, por si pasaron `Nota.md`.
        // `?4`: el último segmento tal cual, para la cita con pista de carpeta
        // (`viejo/v1.2.0 notas`: ahí `titulo_de_ruta` cortaría en el punto).
        let sin_ext = crate::tipos::titulo_de_ruta(t).to_lowercase();
        let ultimo = t.rsplit('/').next().unwrap_or(t).trim().to_lowercase();
        let filas = st
            .query_map(rusqlite::params![t, t.to_lowercase(), sin_ext, ultimo], |r| {
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
        // Una cita con pista de carpeta (`viejo/Plan`, como la da `cita`) se
        // resuelve como en la app. Un título solo sigue siendo ambiguo: acá se
        // prefiere avisar y listar las rutas a elegir por profundidad.
        if out.len() > 1 && t.contains('/') {
            let ids: Vec<String> = out.iter().map(|(id, _)| id.clone()).collect();
            let destino = t.strip_suffix(".md").unwrap_or(t);
            if let Some(id) = super::citar::resolver_entre(destino, &ids) {
                out.retain(|(i, _)| *i == id);
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

        // Cada término por separado: en qué secciones está. Da la cobertura de
        // cada candidata y el idf de cada término (sobre todo el vault, sin
        // filtros: el peso de una palabra no depende de dónde se busque).
        let mut vistos = HashSet::new();
        let terms: Vec<String> = terms.into_iter().filter(|t| vistos.insert(a_fts(t).to_lowercase())).collect();
        let n: i64 = self.conn.query_row("SELECT COUNT(*) FROM secciones", [], |r| r.get(0)).map_err(e)?;
        let mut por_termino: Vec<HashSet<i64>> = Vec::new();
        let mut por_raiz: Vec<HashSet<i64>> = Vec::new();
        let raices: Vec<Option<String>> = terms.iter().map(|t| raiz(t)).collect();
        for (t, r) in terms.iter().zip(&raices) {
            por_termino.push(self.filas_de(&a_fts(t))?);
            por_raiz.push(match r {
                Some(r) => self.filas_de(&a_fts(r))?,
                None => HashSet::new(),
            });
        }
        // El peso de un término es el idf de la palabra; si la palabra no está
        // en el vault pero su raíz sí (pidió «conclusiones» y la nota dice
        // «concluye»), el de la raíz.
        let pesos: Vec<f64> = por_termino
            .iter()
            .zip(&por_raiz)
            .map(|(f, r)| idf(n as usize, if f.is_empty() { r.len() } else { f.len() }))
            .collect();
        let peso_total: f64 = pesos.iter().sum();
        let ausente = |i: usize| por_termino[i].is_empty() && por_raiz[i].is_empty();
        let sin_coincidencias: Vec<String> = (0..terms.len()).filter(|&i| ausente(i)).map(|i| terms[i].clone()).collect();
        let presentes = (0..terms.len()).filter(|&i| !ausente(i)).count();

        let mut partes: Vec<String> = terms.clone();
        partes.extend(raices.iter().flatten().filter(|r| !terms.iter().any(|t| t.eq_ignore_ascii_case(r))).cloned());
        let mut vistas = HashSet::new();
        partes.retain(|p| vistas.insert(p.to_lowercase()));
        let expresion = expresion_fts(&partes);
        let (total, mut candidatos) = self.consultar(&expresion, &c.filtros, c.ambito)?;
        for cand in &mut candidatos {
            let (mut cubierto, mut cuantos) = (0.0, 0);
            for ((f, r), w) in por_termino.iter().zip(&por_raiz).zip(&pesos) {
                if f.contains(&cand.rowid) {
                    cubierto += w;
                    cuantos += 1;
                } else if r.contains(&cand.rowid) {
                    // Solo por la raíz: cubre, pero menos que la palabra.
                    cubierto += w * PESO_RAIZ;
                    cuantos += 1;
                }
            }
            cand.e.cobertura = if peso_total > 0.0 { cubierto / peso_total } else { 0.0 };
            cand.e.cubiertos = cuantos;
            cand.lexico = lexico(cand.e.bm25, cand.e.cobertura);
        }
        let completos = {
            let completas = candidatos.iter().filter(|x| presentes > 0 && x.e.cubiertos == presentes);
            match c.ambito {
                Ambito::Secciones => completas.count(),
                Ambito::Notas => completas.map(|x| x.e.nota_id.as_str()).collect::<HashSet<_>>().len(),
            }
        };

        let resultados = self.puntuar(candidatos, &expresion, cerca_de.as_deref(), c.ambito, limite)?;
        Ok(Busqueda {
            total,
            modo: Modo::Seccion,
            resultados,
            expresion,
            cerca_de,
            sin_coincidencias,
            completos,
            terminos: terms.len(),
        })
    }

    /// Las secciones (rowid) que casan con una expresión.
    fn filas_de(&self, expresion: &str) -> Resultado<HashSet<i64>> {
        let mut st = self.conn.prepare("SELECT rowid FROM secciones_fts WHERE secciones_fts MATCH ?").map_err(e)?;
        let filas = st.query_map([expresion], |r| r.get::<_, i64>(0)).map_err(e)?;
        filas.collect::<Result<HashSet<_>, _>>().map_err(e)
    }

    /// El fragmento de una sección con las coincidencias de `expresion` entre «».
    fn fragmento(&self, expresion: &str, rowid: i64) -> Resultado<String> {
        self.conn
            .query_row(
                "SELECT snippet(secciones_fts, 2, '«', '»', '…', 16) FROM secciones_fts
                  WHERE secciones_fts MATCH ?1 AND rowid = ?2",
                rusqlite::params![expresion, rowid],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map(Option::unwrap_or_default)
            .map_err(e)
    }

    /// **Todas** las filas que casan con `expresion` (con su BM25, sin el
    /// fragmento, que se pide después solo para las que se devuelven), y el total.
    /// Sin tope: el orden final no es el de BM25, así que no se puede cortar antes
    /// de calcular la cobertura. Son miles de filas como mucho, y una consulta.
    fn consultar(&self, expresion: &str, filtros: &Filtros, ambito: Ambito) -> Resultado<(usize, Vec<Candidato>)> {
        let mut params: Vec<Value> = vec![Value::Text(expresion.to_string())];
        let filtro_sql = sql_filtros(filtros, &mut params);
        let sql = format!(
            "SELECT s.nota_id, n.titulo, s.orden, s.ruta_encabezados, s.linea_ini, s.linea_fin, s.bytes,
                    s.parcial, n.mtime, n.titulo_norm,
                    -bm25(secciones_fts, {PESO_TITULO}, {PESO_ENCABEZADOS}, {PESO_CUERPO}) AS b,
                    s.id
               FROM secciones_fts
               JOIN secciones s ON s.id = secciones_fts.rowid
               JOIN notas n ON n.id = s.nota_id
              WHERE secciones_fts MATCH ?{filtro_sql}"
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
                        fragmento: String::new(),
                        bm25: r.get(10)?,
                        cobertura: 0.0,
                        cubiertos: 0,
                        senales: Senales::default(),
                        puntaje: 0.0,
                    },
                    rowid: r.get(11)?,
                    lexico: 0.0,
                    mtime: r.get(8)?,
                    titulo_norm: r.get(9)?,
                })
            })
            .map_err(e)?;
        let mut out = Vec::new();
        for f in filas {
            out.push(f.map_err(e)?);
        }
        let total = match ambito {
            Ambito::Secciones => out.len(),
            Ambito::Notas => out.iter().map(|c| c.e.nota_id.as_str()).collect::<HashSet<_>>().len(),
        };
        Ok((total, out))
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
        let mejor = cands.iter().map(|c| c.lexico).fold(0.0_f64, f64::max);
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
                rel: if mejor > 0.0 { c.lexico / mejor } else { 0.0 },
                pop: if max_bl > 0 { (bl as f64).ln_1p() / (max_bl as f64).ln_1p() } else { 0.0 },
                prox: distancias.get(&c.e.nota_id).map(|d| 0.5_f64.powi(*d as i32)).unwrap_or(0.0),
                rec: (-((ahora - c.mtime).max(0) as f64) / 86_400_000.0 / 90.0).exp(),
                anc: anclas.get(&c.titulo_norm).copied().unwrap_or(0.0),
            };
            c.e.puntaje = s.puntaje(&PESOS_V1);
            c.e.senales = s;
        }
        // A igual puntaje decide el BM25 y, después, la ruta: el orden no puede
        // depender de cómo SQLite devolvió las filas.
        cands.sort_by(|a, b| {
            b.e.puntaje
                .total_cmp(&a.e.puntaje)
                .then(b.e.bm25.total_cmp(&a.e.bm25))
                .then_with(|| (&a.e.nota_id, a.e.orden).cmp(&(&b.e.nota_id, b.e.orden)))
        });
        if ambito == Ambito::Notas {
            let mut vistas = HashSet::new();
            cands.retain(|c| vistas.insert(c.e.nota_id.clone()));
        }
        cands.truncate(limite);
        let mut out = Vec::with_capacity(cands.len());
        for mut c in cands {
            c.e.fragmento = self.fragmento(expresion, c.rowid)?;
            out.push(c.e);
        }
        Ok(out)
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
                    cobertura: 0.0,
                    cubiertos: 0,
                    senales: Senales::default(),
                    puntaje: 0.0,
                })
            })
            .map_err(e)?;
        let mut resultados = Vec::new();
        for f in filas {
            resultados.push(f.map_err(e)?);
        }
        Ok(Busqueda {
            total: total as usize,
            modo: Modo::Filtros,
            resultados,
            expresion: String::new(),
            cerca_de,
            sin_coincidencias: Vec::new(),
            completos: 0,
            terminos: 0,
        })
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
    fn alcanza_con_un_termino_y_avisa_el_que_no_esta() {
        let (_v, ix) = vault();
        // «lenguaje» está en Rust#s1 y «sqlite» en Rust#s2: con Y no había
        // ninguna sección; ahora vuelven las dos. «símbolos» no está en el vault
        // (el caso de D08): no vacía la lista, se avisa.
        let b = ix.buscar(&consulta("lenguaje sqlite símbolos")).unwrap();
        assert_eq!(b.modo, Modo::Seccion);
        let refs: Vec<_> = b.resultados.iter().map(|r| r.referencia()).collect();
        assert_eq!(refs.len(), 2, "{refs:?}");
        assert!(refs.iter().all(|r| r.starts_with("docs/Rust.md#")));
        assert_eq!(b.sin_coincidencias, ["símbolos"]);
        assert_eq!(b.completos, 0, "ninguna sección tiene los dos que existen");
        assert_eq!(b.expresion, "\"lenguaje\"* OR \"sqlite\"* OR \"símbolos\"* OR \"lengua\"* OR \"símbol\"*");
        // Todos ausentes: cero resultados, y los tres avisados.
        let b = ix.buscar(&consulta("zzz yyy")).unwrap();
        assert!(b.resultados.is_empty());
        assert_eq!(b.sin_coincidencias.len(), 2);
    }

    /// El caso de D01: un O a secas deja arriba a las secciones que repiten un
    /// solo término de la consulta —y lo tienen en el título, que pesa 4—; la
    /// cobertura pone primero a la que tiene todos.
    #[test]
    fn la_cobertura_le_gana_a_un_termino_repetido_en_el_titulo() {
        let v = VaultDePrueba::nuevo("cobertura");
        // Secciones cortas que repiten «enlaces» en el título, el encabezado y
        // el cuerpo.
        for i in 0..3 {
            v.escribir(&format!("Enlaces {i}.md"), "## Enlaces\nenlaces, enlaces y enlaces.\n");
        }
        // Relleno: «clic», «navegador» y «externo» son palabras comunes del vault.
        for i in 0..6 {
            v.escribir(&format!("Nota {i}.md"), &format!("## Uso {i}\nun clic en el navegador, un disco externo.\n"));
        }
        // La que responde: tiene los cuatro términos una vez, en una sección
        // larga (BM25 la castiga por el largo).
        let relleno = "texto de relleno para que la sección sea larga ".repeat(8);
        v.escribir(
            "Version.md",
            &format!(
                "# Version\n## Novedades\nAhora un clic en un enlace externo abre el navegador del sistema. {relleno}\n"
            ),
        );
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        let b = ix.buscar(&consulta("enlace externo navegador clic")).unwrap();
        let primero = &b.resultados[0];
        assert_eq!(primero.referencia(), "Version.md#s2", "{:?}", b.resultados.iter().map(|r| r.referencia()).collect::<Vec<_>>());
        assert_eq!((primero.cubiertos, primero.cobertura), (4, 1.0));
        assert_eq!(b.completos, 1);
        // Y el test distingue: por BM25 solo (el O a secas), la sección que
        // repite «enlaces» le ganaba.
        let max_bm25 = b.resultados.iter().map(|r| r.bm25).fold(0.0_f64, f64::max);
        assert!(primero.bm25 < max_bm25, "con O a secas ganaba otra: bm25 {} < {max_bm25}", primero.bm25);
    }

    #[test]
    fn un_termino_que_esta_en_todas_partes_casi_no_pesa() {
        // N = 10 secciones: un término en las 10 pesa ~0,05; uno en 1, ~1,9.
        assert!(idf(10, 10) < 0.1);
        assert!(idf(10, 1) > 1.5);
        assert_eq!(idf(10, 0), 0.0);
        assert_eq!(lexico(8.0, 0.5), 2.0);
        assert_eq!(lexico(-1.0, 1.0), 0.0);
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
    fn la_raiz_encuentra_la_variante_y_pesa_menos_que_la_palabra() {
        assert_eq!(raiz("conclusiones").as_deref(), Some("conclu"));
        assert_eq!(raiz("Computación").as_deref(), Some("comput"));
        assert_eq!(raiz("sistema"), None, "7 letras: alcanza el prefijo");
        assert_eq!(raiz("FUN-L-09"), None);
        assert_eq!(raiz("\"dos palabras\""), None);

        let v = VaultDePrueba::nuevo("raiz");
        // La que responde dice «concluye», no «conclusiones».
        v.escribir("Estado.md", "# Estado\n## Decisiones\n### El trabajo concluye consultivo\nsobre base descriptiva.\n");
        v.escribir("Conclusiones.md", "# Conclusiones\n## Cierre\nlas conclusiones del trabajo, de carácter general.\n");
        v.escribir("Otra.md", "# Otra\n## Nada\ntexto sin relación.\n");
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        let b = ix.buscar(&consulta("conclusiones consultivo")).unwrap();
        let refs: Vec<_> = b.resultados.iter().map(|r| r.nota_id.as_str()).collect();
        assert!(refs.contains(&"Estado.md"), "la variante entra: {refs:?}");
        let est = b.resultados.iter().find(|r| r.nota_id == "Estado.md").unwrap();
        assert_eq!(est.cubiertos, 2, "«consultivo» entero y «conclusiones» por raíz");
        assert!(est.cobertura < 1.0 && est.cobertura > 0.5, "por raíz cubre menos: {}", est.cobertura);
        assert!(b.sin_coincidencias.is_empty());
        // Una palabra que no está pero su raíz sí no se avisa como ausente.
        let b = ix.buscar(&consulta("concluyentes")).unwrap();
        assert!(b.sin_coincidencias.is_empty() && !b.resultados.is_empty());
    }

    #[test]
    fn terminos_y_expresion() {
        assert_eq!(terminos("hola \"dos palabras\" -- FUN-L-09"), ["hola", "\"dos palabras\"", "FUN-L-09"]);
        assert_eq!(expresion_fts(&terminos("a\"b FUN-L-09")), "\"a\"\"b\"* OR \"FUN-L-09\"*");
    }

    #[test]
    fn resolver_nota_por_ruta_titulo_o_mayusculas() {
        let (_v, ix) = vault();
        assert_eq!(ix.resolver_nota("docs/Rust.md").unwrap().len(), 1);
        assert_eq!(ix.resolver_nota("rust").unwrap()[0].0, "docs/Rust.md");
        assert_eq!(ix.resolver_nota("DOCS\\rust.md").unwrap()[0].0, "docs/Rust.md");
        assert!(ix.resolver_nota("no existe").unwrap().is_empty());
    }

    #[test]
    fn resolver_nota_acepta_la_cita_con_pista_de_carpeta() {
        let v = VaultDePrueba::nuevo("pista");
        v.escribir("docs/Plan.md", "a");
        v.escribir("docs/viejo/Plan.md", "b");
        v.escribir("x/v1.2.0 notas.md", "c");
        v.escribir("y/v1.2.0 notas.md", "d");
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!(ix.resolver_nota("Plan").unwrap().len(), 2, "el título solo sigue siendo ambiguo");
        assert_eq!(ix.resolver_nota("viejo/Plan").unwrap(), [("docs/viejo/Plan.md".into(), "Plan".into())]);
        assert_eq!(ix.resolver_nota("y/v1.2.0 notas").unwrap()[0].0, "y/v1.2.0 notas.md");
        assert_eq!(ix.resolver_nota("y/v1.2.0 notas").unwrap().len(), 1);
    }
}
