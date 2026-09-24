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

/// Una nota que enlaza a otra (un enlace **entrante** de esa otra), con lo que
/// hace falta para ordenarla y para mostrar dónde la menciona.
#[derive(Debug, Clone)]
pub struct Entrante {
    /// La nota que enlaza.
    pub origen: String,
    /// Su nombre (el del archivo sin extensión): con él se calcula su cita.
    pub titulo: String,
    /// Cuántos enlaces de `origen` apuntan a la nota.
    pub enlaces: usize,
    /// A cuántas notas distintas enlaza `origen` en total (su grado de salida).
    pub salientes_origen: usize,
    /// El primer enlace: su línea (1-based), su sección y su alias, si lo tiene.
    pub linea: usize,
    pub seccion_orden: usize,
    pub alias: Option<String>,
}

impl Entrante {
    /// Qué parte de lo que enlaza `origen` es esta nota: `enlaces /
    /// salientes_origen`. Un mapa o el BACKLOG enlazan a todo y cada enlace suyo
    /// dice poco; una nota que enlaza a tres y a esta dos veces está hablando
    /// de ella. Es la misma idea que el `idf`, del lado de quien enlaza.
    pub fn especificidad(&self) -> f64 {
        self.enlaces as f64 / self.salientes_origen.max(1) as f64
    }
}

impl Indice {
    /// Las notas que enlazan a `id` (sin contarse a sí misma), **todas**,
    /// ordenadas por pertinencia: primero las más específicas
    /// ([`Entrante::especificidad`]); a igualdad, la que enlaza más veces, la de
    /// menos salientes y, al final, la ruta, para que el orden sea estable.
    ///
    /// Se resuelven como las resuelve la app: con homónimas, un `[[Plan]]` que
    /// la app lleva a otra nota llamada igual **no** cuenta como entrante de esta
    /// (`citar::resolver_entre`).
    pub fn entrantes(&self, id: &str) -> Resultado<Vec<Entrante>> {
        let Some(titulo_norm) = self
            .conn
            .query_row("SELECT titulo_norm FROM notas WHERE id = ?", [id], |r| r.get::<_, String>(0))
            .optional()
            .map_err(e)?
        else {
            return Ok(Vec::new());
        };
        let homonimas = self.homonimas(&titulo_norm)?;
        let mut st = self
            .conn
            .prepare_cached(
                "SELECT e.origen_id, n.titulo, e.destino, e.alias, e.linea, e.seccion_orden
                   FROM enlaces e JOIN notas n ON n.id = e.origen_id
                  WHERE e.destino_norm = ? AND e.origen_id <> ?
                  ORDER BY e.origen_id, e.linea",
            )
            .map_err(e)?;
        let filas = st
            .query_map(rusqlite::params![titulo_norm, id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)? as usize,
                    r.get::<_, i64>(5)? as usize,
                ))
            })
            .map_err(e)?;
        let mut out: Vec<Entrante> = Vec::new();
        for f in filas {
            let (origen, titulo, destino, alias, linea, seccion_orden) = f.map_err(e)?;
            if homonimas.len() > 1 {
                let (sin_ancla, _) = crate::wikilinks::partir_ancla(&destino);
                if super::citar::resolver_entre(sin_ancla, &homonimas).as_deref() != Some(id) {
                    continue;
                }
            }
            match out.last_mut() {
                // Vienen ordenadas por origen y línea: la primera fila es el primer enlace.
                Some(u) if u.origen == origen => u.enlaces += 1,
                _ => out.push(Entrante { origen, titulo, enlaces: 1, salientes_origen: 0, linea, seccion_orden, alias }),
            }
        }
        let mut grado = self
            .conn
            .prepare_cached("SELECT count(DISTINCT destino_norm) FROM enlaces WHERE origen_id = ?")
            .map_err(e)?;
        for en in &mut out {
            en.salientes_origen = grado.query_row([&en.origen], |r| r.get::<_, i64>(0)).map_err(e)? as usize;
        }
        out.sort_by(|a, b| {
            b.especificidad()
                .total_cmp(&a.especificidad())
                .then(b.enlaces.cmp(&a.enlaces))
                .then(a.salientes_origen.cmp(&b.salientes_origen))
                .then(a.origen.cmp(&b.origen))
        });
        Ok(out)
    }

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
    fn los_entrantes_van_primero_los_especificos_y_sin_la_propia_nota() {
        let v = VaultDePrueba::nuevo("entrantes");
        v.escribir("X.md", "# X\nme cito: [[X]]\n");
        // Un mapa que enlaza a todo: una vez a X entre cuatro.
        v.escribir("Mapa.md", "[[X]] [[A]] [[B]] [[C]]\n");
        // Una nota que habla de X: dos enlaces, y solo a X y a otra.
        v.escribir("Decision.md", "# D\nreemplaza a [[X|la vieja]]\n\n## Por qué\nver [[X#Uso]] y [[A]]\n");
        v.escribir("A.md", "sin enlaces a X");
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        let ent = ix.entrantes("X.md").unwrap();
        let origenes: Vec<&str> = ent.iter().map(|x| x.origen.as_str()).collect();
        assert_eq!(origenes, ["Decision.md", "Mapa.md"], "la propia nota no cuenta; el ancla sí");
        assert_eq!((ent[0].enlaces, ent[0].salientes_origen, ent[0].linea), (2, 2, 2));
        assert_eq!(ent[0].alias.as_deref(), Some("la vieja"), "el alias del primer enlace");
        assert_eq!((ent[1].enlaces, ent[1].salientes_origen), (1, 4));
        assert!(ix.entrantes("Decision.md").unwrap().is_empty());
        assert!(ix.entrantes("no-existe.md").unwrap().is_empty());
    }

    #[test]
    fn con_homonimas_un_entrante_es_el_que_la_app_resuelve_a_esta_nota() {
        let v = VaultDePrueba::nuevo("entrantes-homonimas");
        v.escribir("docs/Plan.md", "a");
        v.escribir("docs/viejo/Plan.md", "b");
        v.escribir("docs/Uno.md", "[[Plan]]");
        v.escribir("docs/Dos.md", "[[viejo/Plan]]");
        let mut ix = v.abrir();
        ix.revalidar(&mut |_, _| {}).unwrap();
        let de = |id: &str| ix.entrantes(id).unwrap().into_iter().map(|x| x.origen).collect::<Vec<_>>();
        assert_eq!(de("docs/Plan.md"), ["docs/Uno.md"]);
        assert_eq!(de("docs/viejo/Plan.md"), ["docs/Dos.md"]);
    }

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
