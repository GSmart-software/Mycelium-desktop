//! Cómo se **cita** una nota: el destino de `[[enlace]]` que la app resuelve a
//! esa nota y no a otra (`MCP de Mycelium - memoria` § 15).
//!
//! Espeja `resolveWikilink` de `frontend/lib/editor/wikilink.ts`:
//!
//! 1. El nombre es el del **archivo sin extensión** (`notas.titulo`), sin
//!    distinguir mayúsculas. **No** es el `# Título` visible: `[[Atmósferas]]` no
//!    resuelve a `atmosferas.md`.
//! 2. Si hay varias notas con ese nombre en carpetas distintas, la pista de
//!    carpeta desambigua: `[[features/atmosferas]]` se queda con las que están
//!    en una carpeta que **termina** en `features`.
//! 3. Entre las que quedan gana la **menos profunda** (la más cercana a la raíz),
//!    como Obsidian.
//!
//! > [!warning] Un empate de profundidad no se da por resuelto
//! > La app ordena por profundidad con un `sort` estable: entre dos homónimas a la
//! > misma profundidad gana la que venga primero en el árbol, que no es un orden
//! > que el índice conozca. Acá eso cuenta como **no resuelto**, y la cita pasa a
//! > llevar pista de carpeta: se prefiere una cita más larga a una que en la app
//! > podría abrir la otra nota.

use super::{e, Indice, Resultado};

/// Las carpetas (raíz → hoja) de una ruta relativa: `docs/a/x.md` → `[docs, a]`.
fn carpetas(id: &str) -> Vec<&str> {
    let mut segs: Vec<&str> = id.split('/').filter(|s| !s.is_empty()).collect();
    segs.pop();
    segs
}

/// A qué nota de `candidatas` (rutas relativas, todas con el mismo nombre)
/// resuelve el destino `[[destino]]` según la regla de la app. `None` si no
/// resuelve a una sola sin depender del orden del árbol.
pub fn resolver_entre(destino: &str, candidatas: &[String]) -> Option<String> {
    let partes: Vec<String> =
        destino.split('/').map(str::trim).filter(|s| !s.is_empty()).map(str::to_lowercase).collect();
    let (_, pista) = partes.split_last()?;
    let pool: Vec<&String> = if pista.is_empty() {
        candidatas.iter().collect()
    } else {
        let con_pista: Vec<&String> = candidatas
            .iter()
            .filter(|c| {
                let segs: Vec<String> = carpetas(c).iter().map(|s| s.to_lowercase()).collect();
                segs.len() >= pista.len() && segs[segs.len() - pista.len()..] == *pista
            })
            .collect();
        // Como la app: si la pista no casa con ninguna, se ignora.
        if con_pista.is_empty() {
            candidatas.iter().collect()
        } else {
            con_pista
        }
    };
    let min = pool.iter().map(|c| carpetas(c).len()).min()?;
    let mut menos_profundas = pool.into_iter().filter(|c| carpetas(c).len() == min);
    let primera = menos_profundas.next()?;
    match menos_profundas.next() {
        None => Some(primera.clone()),
        Some(_) => None,
    }
}

/// El destino más corto que resuelve a `id` entre sus homónimas (`id` incluida):
/// el nombre solo si alcanza, y si no el nombre con las carpetas justas delante.
/// El `bool` es `false` si ni la ruta entera resuelve (dos notas que solo se
/// distinguen por mayúsculas): entonces la cita es ambigua también en la app.
pub fn forma_citable(id: &str, titulo: &str, homonimas: &[String]) -> (String, bool) {
    let segs = carpetas(id);
    for k in 0..=segs.len() {
        let mut destino = segs[segs.len() - k..].join("/");
        if !destino.is_empty() {
            destino.push('/');
        }
        destino.push_str(titulo);
        if resolver_entre(&destino, homonimas).as_deref() == Some(id) {
            return (destino, true);
        }
    }
    let mut destino = segs.join("/");
    if !destino.is_empty() {
        destino.push('/');
    }
    destino.push_str(titulo);
    (destino, false)
}

impl Indice {
    /// Las notas con ese nombre (sin distinguir mayúsculas), en cualquier carpeta.
    pub fn homonimas(&self, titulo: &str) -> Resultado<Vec<String>> {
        let mut st = self.conn.prepare_cached("SELECT id FROM notas WHERE titulo_norm = ? ORDER BY id").map_err(e)?;
        let filas = st.query_map([titulo.to_lowercase()], |r| r.get::<_, String>(0)).map_err(e)?;
        filas.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    /// Cómo se cita la nota `id`, cuyo nombre es `titulo`: lo que va entre los
    /// corchetes de `[[…]]`. Ver [`forma_citable`].
    pub fn cita(&self, id: &str, titulo: &str) -> Resultado<(String, bool)> {
        let homonimas = self.homonimas(titulo)?;
        if homonimas.len() <= 1 {
            return Ok((titulo.to_string(), true));
        }
        Ok(forma_citable(id, titulo, &homonimas))
    }
}

#[cfg(test)]
mod tests {
    use super::super::pruebas::VaultDePrueba;
    use super::*;

    fn v(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn una_nota_comun_se_cita_por_el_nombre_del_archivo() {
        let vp = VaultDePrueba::nuevo("citar-comun");
        vp.escribir("docs/features/atmosferas.md", "# Atmósferas\n\nTexto.\n");
        let mut ix = vp.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!(ix.cita("docs/features/atmosferas.md", "atmosferas").unwrap(), ("atmosferas".into(), true));
    }

    #[test]
    fn el_nombre_conserva_acentos_y_mayusculas_del_archivo_no_del_titulo() {
        let vp = VaultDePrueba::nuevo("citar-acentos");
        vp.escribir("docs/Índice de Decisiones.md", "# Decisiones tomadas\n\nx\n");
        vp.escribir("docs/features/canvas.md", "# Canvas: notas en el espacio\n\nx\n");
        let mut ix = vp.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        let n = ix.nota("docs/Índice de Decisiones.md").unwrap().unwrap();
        assert_eq!(ix.cita(&n.id, &n.titulo).unwrap().0, "Índice de Decisiones");
        let n = ix.nota("docs/features/canvas.md").unwrap().unwrap();
        assert_eq!(ix.cita(&n.id, &n.titulo).unwrap().0, "canvas");
    }

    #[test]
    fn las_homonimas_se_citan_como_las_desambigua_la_app() {
        // La menos profunda se queda con el nombre solo; la otra lleva carpeta.
        let h = v(&["docs/Plan.md", "docs/viejo/Plan.md"]);
        assert_eq!(forma_citable("docs/Plan.md", "Plan", &h), ("Plan".into(), true));
        assert_eq!(forma_citable("docs/viejo/Plan.md", "Plan", &h), ("viejo/Plan".into(), true));
        // Misma profundidad: el nombre solo depende del orden del árbol → pista.
        let h = v(&["a/x/Plan.md", "b/y/Plan.md"]);
        assert_eq!(forma_citable("a/x/Plan.md", "Plan", &h), ("x/Plan".into(), true));
        // La última carpeta no alcanza: hacen falta dos.
        let h = v(&["a/x/Plan.md", "b/x/Plan.md"]);
        assert_eq!(forma_citable("b/x/Plan.md", "Plan", &h), ("b/x/Plan".into(), true));
        // Solo difieren en mayúsculas: ni la ruta entera las separa.
        let h = v(&["docs/Plan.md", "docs/plan.md"]);
        assert_eq!(forma_citable("docs/plan.md", "plan", &h), ("docs/plan".into(), false));
        // Y la pista resuelve sin mirar mayúsculas, como la app.
        assert_eq!(resolver_entre("VIEJO/plan", &v(&["docs/Plan.md", "docs/viejo/Plan.md"])).as_deref(), Some("docs/viejo/Plan.md"));
    }

    #[test]
    fn las_homonimas_en_el_indice() {
        let vp = VaultDePrueba::nuevo("citar-homonimas");
        vp.escribir("Plan.md", "# Plan A\n");
        vp.escribir("docs/plan.md", "# Plan B\n");
        let mut ix = vp.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!(ix.cita("Plan.md", "Plan").unwrap(), ("Plan".into(), true));
        assert_eq!(ix.cita("docs/plan.md", "plan").unwrap(), ("docs/plan".into(), true));
    }
}
