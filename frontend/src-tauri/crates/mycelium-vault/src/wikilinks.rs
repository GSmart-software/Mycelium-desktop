//! Cómo se parte un `[[wikilink]]` en destino y alias. Port a Rust de
//! `frontend/lib/wikilinks.ts`, con los mismos casos borde.
//!
//! > [!important] La barra del alias puede venir escapada (`DEF-045`)
//! > Dentro de una tabla la barra vertical separa celdas, así que un alias ahí se
//! > escribe `[[Destino\|alias]]`. Las dos formas son **el mismo enlace**: el
//! > separador es `\|` o `|`.
//!
//! Qué es un enlace **dentro de un documento** (y qué no, como los ejemplos en
//! código) lo decide [`crate::markdown::extraer_enlaces`], no este módulo.

/// Un `[[wikilink]]` ya partido. Se construye con lo que va ENTRE los corchetes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikilinkPartido {
    /// El destino, sin el alias y sin espacios. Conserva el ancla (`#sección`,
    /// `^bloque`) y la ruta (`Carpeta/Nota`) si las traía.
    pub destino: String,
    /// Lo que se muestra: el alias si lo hay, y si no el propio destino.
    pub etiqueta: String,
    /// Índice (en **bytes**, no en unidades UTF-16 como en TS) dentro del texto
    /// interior donde empieza la etiqueta. `0` cuando no hay alias.
    pub desde_etiqueta: usize,
    /// El alias tal cual, si lo había (y no era vacío).
    pub alias: Option<String>,
}

/// Parte `destino|alias` (o `destino\|alias`) en sus dos mitades.
///
/// Equivale a la expresión `/\\?\|/` de TS: el separador empieza en la barra
/// invertida si la hay justo antes de la primera `|`.
pub fn partir_wikilink(inner: &str) -> WikilinkPartido {
    let Some(barra) = inner.find('|') else {
        let destino = inner.trim().to_string();
        return WikilinkPartido {
            etiqueta: destino.clone(),
            destino,
            desde_etiqueta: 0,
            alias: None,
        };
    };
    let inicio_sep = if barra > 0 && inner.as_bytes()[barra - 1] == b'\\' { barra - 1 } else { barra };
    let desde_etiqueta = barra + 1;
    let destino = inner[..inicio_sep].trim().to_string();
    let alias = inner[desde_etiqueta..].trim().to_string();
    let etiqueta = if alias.is_empty() { destino.clone() } else { alias.clone() };
    WikilinkPartido {
        destino,
        etiqueta,
        desde_etiqueta,
        alias: if alias.is_empty() { None } else { Some(alias) },
    }
}

/// El destino listo para buscar por título **tal como lo hace hoy la app**
/// (`destinoDeWikilink`): sin alias y sin la ruta de carpetas. **Conserva el
/// ancla**, igual que TS.
pub fn destino_de_wikilink(inner: &str) -> String {
    let destino = partir_wikilink(inner).destino;
    match destino.rfind('/') {
        Some(i) => destino[i + 1..].trim().to_string(),
        None => destino.trim().to_string(),
    }
}

/// Separa el ancla (`Nota#Sección`, `Nota#^bloque`) del destino.
pub fn partir_ancla(destino: &str) -> (&str, Option<&str>) {
    match destino.find('#') {
        Some(i) => {
            let ancla = destino[i + 1..].trim();
            (destino[..i].trim(), if ancla.is_empty() { None } else { Some(ancla) })
        }
        None => (destino.trim(), None),
    }
}

/// El destino **normalizado** con el que el índice resuelve un enlace contra los
/// títulos: último segmento de la ruta, **sin ancla**, en minúsculas.
///
/// > [!info] Diferencia intencional con la app
/// > `destinoDeWikilink` conserva el ancla, así que en el grafo de la app
/// > `[[Nota#Sección]]` no resuelve a `Nota` y no crea arista. Acá sí.
pub fn destino_norm(destino: &str) -> String {
    let (sin_ancla, _) = partir_ancla(destino);
    let ultimo = match sin_ancla.rfind('/') {
        Some(i) => &sin_ancla[i + 1..],
        None => sin_ancla,
    };
    ultimo.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Los mismos casos que `frontend/scripts/test-wikilinks.mjs`.

    #[test]
    fn sin_alias() {
        let p = partir_wikilink("Mi nota");
        assert_eq!(p.destino, "Mi nota");
        assert_eq!(p.etiqueta, "Mi nota");
        assert_eq!(p.desde_etiqueta, 0);
        assert_eq!(p.alias, None);
    }

    #[test]
    fn alias_con_barra_normal() {
        let p = partir_wikilink("Destino|alias");
        assert_eq!((p.destino.as_str(), p.etiqueta.as_str(), p.desde_etiqueta), ("Destino", "alias", 8));
    }

    #[test]
    fn alias_con_barra_escapada_def_045() {
        let p = partir_wikilink("Destino\\|alias");
        assert_eq!(p.destino, "Destino", "el destino no debe arrastrar la barra invertida");
        assert_eq!(p.etiqueta, "alias");
        assert_eq!(p.desde_etiqueta, 9);
        assert_eq!(destino_de_wikilink("Destino\\|alias"), destino_de_wikilink("Destino|alias"));
    }

    #[test]
    fn alias_vacio_cae_al_destino() {
        let p = partir_wikilink("Destino|  ");
        assert_eq!(p.etiqueta, "Destino");
        assert_eq!(p.alias, None);
    }

    #[test]
    fn destino_quita_ruta_y_alias_pero_no_el_ancla() {
        assert_eq!(destino_de_wikilink("Carpeta/Sub/Nota|x"), "Nota");
        assert_eq!(destino_de_wikilink(" Nota "), "Nota");
        assert_eq!(destino_de_wikilink("Nota#Sección"), "Nota#Sección");
    }

    #[test]
    fn destino_norm_quita_tambien_el_ancla() {
        assert_eq!(destino_norm("Carpeta/Nota#Sección"), "nota");
        assert_eq!(destino_norm("Nota#^bloque"), "nota");
        assert_eq!(destino_norm("MCP de Mycelium - Plan"), "mcp de mycelium - plan");
        assert_eq!(partir_ancla("Nota#Sec"), ("Nota", Some("Sec")));
    }
}
