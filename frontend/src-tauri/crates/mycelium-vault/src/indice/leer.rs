//! Lectura: el índice dice **qué** leer; el texto sale **del archivo en disco**
//! en el momento de la llamada (§ 8 de la nota). Un índice viejo puede ordenar
//! mal, pero no puede devolver contenido que ya no existe — y para que tampoco
//! devuelva las líneas de otra versión del archivo, quien lee revalida antes la
//! nota (`Indice::revalidar_nota`, revisión crítica § 2.5).

use rusqlite::OptionalExtension;

use super::{e, Indice, Resultado};

/// Una nota del índice.
#[derive(Debug, Clone)]
pub struct NotaInfo {
    pub id: String,
    pub titulo: String,
    pub tipo: String,
    pub bytes: usize,
    pub secciones: usize,
}

/// Una sección del índice (sin texto).
#[derive(Debug, Clone)]
pub struct SeccionInfo {
    pub orden: usize,
    pub nivel: u8,
    pub encabezado: String,
    pub ruta_encabezados: String,
    pub linea_ini: usize,
    pub linea_fin: usize,
    pub bytes: usize,
    pub parcial: bool,
}

/// Un enlace saliente de una sección, resuelto contra los títulos del vault.
#[derive(Debug, Clone)]
pub struct Saliente {
    /// Como está escrito, sin alias.
    pub destino: String,
    /// Las notas a las que resuelve: vacío = roto; más de una = ambiguo.
    pub resuelve_a: Vec<String>,
    pub embed: bool,
}

impl Indice {
    pub fn nota(&self, id: &str) -> Resultado<Option<NotaInfo>> {
        self.conn
            .query_row(
                "SELECT id, titulo, tipo, bytes, secciones FROM notas WHERE id = ?",
                [id],
                |r| {
                    Ok(NotaInfo {
                        id: r.get(0)?,
                        titulo: r.get(1)?,
                        tipo: r.get(2)?,
                        bytes: r.get::<_, i64>(3)? as usize,
                        secciones: r.get::<_, i64>(4)? as usize,
                    })
                },
            )
            .optional()
            .map_err(e)
    }

    /// Las secciones de una nota, en orden.
    pub fn secciones_de(&self, id: &str) -> Resultado<Vec<SeccionInfo>> {
        let mut st = self
            .conn
            .prepare(
                "SELECT orden, nivel, encabezado, ruta_encabezados, linea_ini, linea_fin, bytes, parcial
                   FROM secciones WHERE nota_id = ? ORDER BY orden",
            )
            .map_err(e)?;
        let filas = st
            .query_map([id], |r| {
                Ok(SeccionInfo {
                    orden: r.get::<_, i64>(0)? as usize,
                    nivel: r.get::<_, i64>(1)? as u8,
                    encabezado: r.get(2)?,
                    ruta_encabezados: r.get(3)?,
                    linea_ini: r.get::<_, i64>(4)? as usize,
                    linea_fin: r.get::<_, i64>(5)? as usize,
                    bytes: r.get::<_, i64>(6)? as usize,
                    parcial: r.get::<_, i64>(7)? != 0,
                })
            })
            .map_err(e)?;
        filas.collect::<Result<Vec<_>, _>>().map_err(e)
    }

    /// Los enlaces que salen de esas secciones, resueltos **ahora** por join.
    pub fn salientes(&self, id: &str, ordenes: &[usize]) -> Resultado<Vec<Saliente>> {
        let mut st = self
            .conn
            .prepare(
                "SELECT e.destino, e.embed,
                        (SELECT group_concat(n.id, char(10)) FROM notas n WHERE n.titulo_norm = e.destino_norm)
                   FROM enlaces e
                  WHERE e.origen_id = ? AND e.seccion_orden = ?
                  ORDER BY e.linea",
            )
            .map_err(e)?;
        let mut out: Vec<Saliente> = Vec::new();
        for o in ordenes {
            let filas = st
                .query_map(rusqlite::params![id, *o as i64], |r| {
                    let resuelve: Option<String> = r.get(2)?;
                    Ok(Saliente {
                        destino: r.get(0)?,
                        embed: r.get::<_, i64>(1)? != 0,
                        resuelve_a: resuelve
                            .map(|s| s.split('\n').map(str::to_string).collect())
                            .unwrap_or_default(),
                    })
                })
                .map_err(e)?;
            for f in filas {
                let f = f.map_err(e)?;
                if !out.iter().any(|x| x.destino == f.destino) {
                    out.push(f);
                }
            }
        }
        Ok(out)
    }

    /// Las líneas `[ini, fin]` (1-based, inclusivas) del archivo, leídas ahora.
    pub fn leer_lineas(&self, id: &str, ini: usize, fin: usize) -> Resultado<String> {
        let texto = self.leer_nota(id)?;
        let lineas: Vec<&str> = texto.split('\n').collect();
        let ini = ini.max(1);
        let fin = fin.min(lineas.len());
        if ini > fin {
            return Ok(String::new());
        }
        Ok(lineas[ini - 1..fin]
            .iter()
            .map(|l| l.strip_suffix('\r').unwrap_or(l))
            .collect::<Vec<_>>()
            .join("\n"))
    }

    /// El archivo entero, leído ahora.
    pub fn leer_nota(&self, id: &str) -> Resultado<String> {
        let bytes = std::fs::read(self.raiz.join(id)).map_err(|err| format!("No se pudo leer {id}: {err}"))?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::super::pruebas::{tocar, VaultDePrueba};
    use super::super::EstadoNota;

    #[test]
    fn lee_del_disco_y_resuelve_salientes_ahora() {
        let v = VaultDePrueba::nuevo("leer");
        v.escribir("a.md", "# A\nver [[B]] y [[Falta]]\n# C\nfin\r\n");
        v.escribir("B.md", "b");
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        let secs = ix.secciones_de("a.md").unwrap();
        assert_eq!(secs.len(), 2);
        assert_eq!(ix.leer_lineas("a.md", secs[1].linea_ini, secs[1].linea_fin).unwrap(), "# C\nfin");
        let sal = ix.salientes("a.md", &[1]).unwrap();
        assert_eq!(sal[0].resuelve_a, ["B.md"]);
        assert!(sal[1].resuelve_a.is_empty(), "roto");

        // Crear la nota que faltaba repara el enlace sin reindexar `a.md`.
        v.escribir("Falta.md", "ya está");
        ix.revalidar(&mut |_, _| {}).unwrap();
        assert_eq!(ix.salientes("a.md", &[1]).unwrap()[1].resuelve_a, ["Falta.md"]);

        // Si el archivo cambió desde la indexación, leer primero revalida.
        tocar(&v, "a.md", "nuevo arriba\n\n# A\nver [[B]]\n# C\nfin");
        assert_eq!(ix.revalidar_nota("a.md").unwrap(), EstadoNota::Reindexada);
        let secs = ix.secciones_de("a.md").unwrap();
        let c = secs.iter().find(|s| s.encabezado == "C").unwrap();
        assert_eq!(ix.leer_lineas("a.md", c.linea_ini, c.linea_fin).unwrap(), "# C\nfin");
    }
}
