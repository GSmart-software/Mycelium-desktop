"use client";

import { FilePlus2, RefreshCw, TriangleAlert, CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Anillos,
  BarrasCarpetas,
  BarrasLista,
  BarrasTipos,
  ColumnasMes,
  Histograma,
  ListaComposicion,
} from "@/components/salud/graficas";
import { pedirBusqueda } from "@/lib/busquedaPendiente";
import { NOMBRE_GRUPO, type GrupoArchivo } from "@/lib/estadisticas";
import type { RevisionVault } from "@/lib/estadisticasVault";
import { cuandoSeReviso, duracionLegible, formaValida, plural, type FormaComposicion, type Medida } from "@/lib/graficas";
import { entero, gravedades, hallazgoComposicion, pesoLegible, porcentaje } from "@/lib/informeSalud";
import { tabIdDeArchivo } from "@/lib/otrosArchivos";
import { usePaletaGraficas } from "@/lib/usePaletaGraficas";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSaludStore } from "@/stores/saludStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { ListaProblemas } from "./problemas";
import styles from "./SaludVista.module.css";

/** Los tipos que el índice abre como nota; lo demás va al visor de archivos. */
const ABRE_COMO_NOTA = new Set(["md", "excalidraw", "base", "canvas", "drawio"]);

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
};

/**
 * La pestaña «Salud del vault» (`FUN-L-32`): el tablero con todo lo que dice
 * una revisión —resumen, qué hay en el vault, problemas, qué ocupa espacio,
 * la red, el crecimiento y las etiquetas—.
 *
 * Revisa al abrirse (si la última revisión de este vault tiene más de un
 * minuto: `revisarSiHaceFalta`) y con «Volver a revisar». Nunca al guardar ni
 * de fondo, y en reposo no corre nada: sin relojes, sin animaciones en bucle
 * (`DEF-174`). La revisión es la de `useSaludStore`, compartida con el panel.
 */
export function SaludVista() {
  const vaultId = useVaultStore((s) => s.vaultId);
  const revision = useSaludStore((s) => (s.revisionVaultId === vaultId ? s.revision : null));
  const revisando = useSaludStore((s) => s.revisando);
  const error = useSaludStore((s) => s.errorRevision);

  useEffect(() => {
    if (vaultId !== null) void useSaludStore.getState().revisarSiHaceFalta();
  }, [vaultId]);

  return (
    <div className={`mic-salud-vista ${styles.vista}`}>
      <div className={styles.hoja}>
        {revision ? (
          <Tablero revision={revision} revisando={revisando} error={error} />
        ) : (
          <>
            <Cabecera revision={null} revisando={revisando} />
            {error ? (
              <p className={styles.error} role="alert">
                No se pudo revisar el vault: {error}
              </p>
            ) : (
              <p className={styles.cargando} role="status">
                {revisando ? "Revisando el vault…" : "Sin revisar"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Cabecera({ revision, revisando }: { revision: RevisionVault | null; revisando: boolean }) {
  const router = useRouter();
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const vault = rutaVault ? rutaVault.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : null;
  const [generando, setGenerando] = useState(false);

  const generar = async () => {
    if (!revision || generando) return;
    setGenerando(true);
    try {
      const { generarInformeSalud } = await import("@/lib/informeSaludVault");
      await generarInformeSalud({
        revision,
        navegar: (id) => router.replace(`/workspace?note=${encodeURIComponent(id)}`),
      });
    } catch {
      // `generarInformeSalud` ya avisó.
    } finally {
      setGenerando(false);
    }
  };

  const partes = [
    vault,
    revision && `revisado ${cuandoSeReviso(revision.revisadoEn, new Date())}`,
    revision &&
      `${plural(revision.estadisticas.archivos.total.cantidad, "archivo", "archivos")} en ${duracionLegible(revision.duracionMs)}`,
  ].filter(Boolean);

  return (
    <header className={styles.cabecera}>
      <div>
        <h1 className={styles.titulo}>Salud del vault</h1>
        {partes.length > 0 && <p className={styles.subtitulo}>{partes.join(" · ")}</p>}
      </div>
      <div className={styles.acciones}>
        <button type="button" className={styles.boton} onClick={() => void generar()} disabled={!revision || generando}>
          <FilePlus2 size={15} aria-hidden />
          {generando ? "Generando…" : "Generar informe como nota"}
        </button>
        <button
          type="button"
          className={`${styles.boton} ${styles.primario}`}
          onClick={() => void useSaludStore.getState().revisar()}
          disabled={revisando}
        >
          <RefreshCw size={15} aria-hidden className={revisando ? styles.girando : undefined} />
          {revisando ? "Revisando…" : "Volver a revisar"}
        </button>
      </div>
    </header>
  );
}

function Tablero({ revision, revisando, error }: { revision: RevisionVault; revisando: boolean; error: string | null }) {
  const router = useRouter();
  const paleta = usePaletaGraficas();
  const forma: FormaComposicion = formaValida(usePreferencesStore((s) => s.prefs.formaComposicionSalud));
  const [medida, setMedida] = useState<Medida>("bytes");
  const [resaltado, setResaltado] = useState<GrupoArchivo | null>(null);

  const { informe, estadisticas: e } = revision;
  const a = e.archivos;
  const g = gravedades(informe);

  const abrir = (id: string) => {
    useTabsStore.getState().openNote(id);
    router.replace(`/workspace?note=${encodeURIComponent(id)}`);
  };
  const abrirArchivo = (ruta: string, extension: string) => abrir(ABRE_COMO_NOTA.has(extension) ? ruta : tabIdDeArchivo(ruta));
  const buscarEtiqueta = (etiqueta: string) => {
    pedirBusqueda(`tag:${etiqueta}`);
    usePanelLayoutStore.setState({ activeSection: "search", lastSection: "search" });
  };

  return (
    <>
      <Cabecera revision={revision} revisando={revisando} />
      {error && (
        <p className={styles.error} role="alert">
          No se pudo volver a revisar el vault: {error}. Se muestra la revisión anterior.
        </p>
      )}

      {/* ── Franja de resumen ── */}
      <section className={styles.franja} data-estado={g.total === 0 ? "sano" : "problemas"} aria-label="Resumen">
        <div className={styles.franjaProblemas}>
          {g.total === 0 ? (
            <CircleCheck size={22} className={styles.franjaIcono} aria-hidden />
          ) : (
            <TriangleAlert size={22} className={styles.franjaIcono} aria-hidden />
          )}
          <div>
            <span className={styles.cifra}>{entero(g.total)}</span>
            <span className={styles.cifraRotulo}>
              {g.total === 1 ? "problema" : "problemas"}
              {g.graves > 0 && ` · ${entero(g.graves)} ${g.graves === 1 ? "grave" : "graves"}`}
            </span>
          </div>
        </div>
        <Cifra valor={entero(a.total.cantidad)} rotulo={a.total.cantidad === 1 ? "archivo" : "archivos"} />
        <Cifra valor={entero(a.porGrupo.notas.cantidad)} rotulo={a.porGrupo.notas.cantidad === 1 ? "nota" : "notas"} />
        <Cifra valor={pesoLegible(a.total.bytes)} rotulo="en disco" />
        <Cifra
          valor={entero(e.enlaces.total)}
          rotulo={`enlaces · ${e.enlaces.promedioPorNota.toFixed(1).replace(".", ",")} por nota`}
        />
        <Cifra valor={entero(e.etiquetas.distintas)} rotulo="etiquetas" />
      </section>

      <div className={styles.grilla}>
        {/* ── Qué hay en el vault ── */}
        <section className={`${styles.panel} ${styles.ancho8}`} aria-labelledby="salud-composicion">
          <div className={styles.panelCabecera}>
            <h2 id="salud-composicion" className={styles.panelTitulo}>
              Qué hay en el vault
            </h2>
            <div className={styles.controles}>
              <Segmento
                etiqueta="Gráfica"
                opciones={[
                  ["anillos", "Anillos"],
                  ["barras", "Barras"],
                ]}
                valor={forma}
                onCambiar={(v) => usePreferencesStore.getState().setPref("formaComposicionSalud", v)}
              />
              <Segmento
                etiqueta="Medir por"
                opciones={[
                  ["bytes", "Peso"],
                  ["cantidad", "Cantidad"],
                ]}
                valor={medida}
                onCambiar={setMedida}
              />
            </div>
          </div>
          <div className={styles.composicion}>
            <div className={styles.composicionGrafica}>
              {forma === "anillos" ? (
                <Anillos archivos={a} red={e.red} medida={medida} resaltado={resaltado} onResaltar={setResaltado} />
              ) : (
                <BarrasTipos archivos={a} medida={medida} resaltado={resaltado} onResaltar={setResaltado} />
              )}
            </div>
            <ListaComposicion archivos={a} medida={medida} resaltado={resaltado} onResaltar={setResaltado} />
          </div>
          {a.total.cantidad > 0 && <p className={styles.pie}>{hallazgoComposicion(a)}</p>}
        </section>

        {/* ── Problemas ── */}
        <section className={`${styles.panel} ${styles.ancho4}`} aria-labelledby="salud-problemas">
          <div className={styles.panelCabecera}>
            <h2 id="salud-problemas" className={styles.panelTitulo}>
              Problemas
            </h2>
            <span className={styles.cuenta} data-gravedad={g.graves > 0 ? "grave" : g.total > 0 ? "aviso" : "cero"}>
              {entero(g.total)}
            </span>
          </div>
          <ListaProblemas informe={informe} tope={5} />
        </section>

        {/* ── Qué ocupa espacio ── */}
        <section className={`${styles.panel} ${styles.ancho6}`} aria-labelledby="salud-espacio">
          <div className={styles.panelCabecera}>
            <h2 id="salud-espacio" className={styles.panelTitulo}>
              Qué ocupa espacio
            </h2>
            <span className={styles.panelNota}>por carpeta</span>
          </div>
          <BarrasCarpetas carpetas={a.carpetas} />
          {a.masPesados.length > 0 && (
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th>Lo más pesado</th>
                  <th>Tipo</th>
                  <th className={styles.derecha}>Peso</th>
                </tr>
              </thead>
              <tbody>
                {a.masPesados.map((p) => (
                  <tr key={p.ruta}>
                    <td>
                      <button type="button" className={styles.ruta} onClick={() => abrirArchivo(p.ruta, p.extension)} title={`Abrir ${p.ruta}`}>
                        {p.ruta}
                      </button>
                    </td>
                    <td>
                      <span className={styles.chip}>
                        <i style={{ background: paleta.grupos[p.grupo] }} aria-hidden />
                        {NOMBRE_GRUPO[p.grupo]}
                      </span>
                    </td>
                    <td className={`${styles.derecha} ${styles.mono}`}>{pesoLegible(p.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── La red ── */}
        <section className={`${styles.panel} ${styles.ancho6}`} aria-labelledby="salud-red">
          <div className={styles.panelCabecera}>
            <h2 id="salud-red" className={styles.panelTitulo}>
              La red
            </h2>
            <span className={styles.panelNota}>conexiones por nota</span>
          </div>
          <div className={styles.mini}>
            <div>
              <b>{porcentaje(e.red.conectadas, e.red.notas)}</b>
              <span>notas conectadas</span>
            </div>
            <div title={e.red.componentes > 0 ? `La red principal tiene ${plural(e.red.redPrincipal, "nota", "notas")}` : undefined}>
              <b>{e.red.componentes === 0 ? "0" : e.red.islas === 0 ? "1" : `1 + ${entero(e.red.islas)}`}</b>
              <span>{e.red.islas === 0 ? "red principal" : "red principal e islas"}</span>
            </div>
            <div>
              <b>{entero(e.red.huerfanas)}</b>
              <span>huérfanas</span>
            </div>
          </div>
          <Histograma cubos={e.red.histograma} />
          <h3 className={styles.subtitulo3}>Las más conectadas</h3>
          <BarrasLista
            etiqueta="Las notas más conectadas"
            vacio="Ninguna nota tiene conexiones todavía."
            comoEnlace
            items={e.red.masConectadas.map((n) => ({
              clave: n.ruta,
              nombre: n.titulo,
              valor: n.conexiones,
              detalle: {
                titulo: n.titulo,
                valor: plural(n.conexiones, "conexión", "conexiones"),
                nota: `${entero(n.salientes)} salen · ${entero(n.entrantes)} llegan`,
              },
            }))}
            onElegir={abrir}
          />
        </section>

        {/* ── Crecimiento ── */}
        <section className={`${styles.panel} ${styles.ancho8}`} aria-labelledby="salud-crecimiento">
          <div className={styles.panelCabecera}>
            <h2 id="salud-crecimiento" className={styles.panelTitulo}>
              Crecimiento
            </h2>
            <span className={styles.panelNota}>
              notas nuevas por mes{e.crecimiento.confiable && e.crecimiento.total > 0 ? ` · ${entero(e.crecimiento.total)} en 12 meses` : ""}
            </span>
          </div>
          {e.crecimiento.confiable ? (
            <ColumnasMes meses={e.crecimiento.meses} />
          ) : (
            <p className={styles.aviso}>
              Las fechas de creación no dicen cuándo se escribió cada nota:{" "}
              {e.crecimiento.lote
                ? `${plural(e.crecimiento.lote.notas, "nota entró", "notas entraron")} al índice de una vez, el ${fechaLarga(e.crecimiento.lote.fecha)}.`
                : "muchas notas entraron al índice de una vez."}{" "}
              Las que se creen desde ahora sí van a contar.
            </p>
          )}
        </section>

        {/* ── Etiquetas ── */}
        <section className={`${styles.panel} ${styles.ancho4}`} aria-labelledby="salud-etiquetas">
          <div className={styles.panelCabecera}>
            <h2 id="salud-etiquetas" className={styles.panelTitulo}>
              Etiquetas
            </h2>
            {e.etiquetas.distintas > 0 && (
              <span className={styles.panelNota}>
                {plural(e.etiquetas.notasConEtiqueta, "nota", "notas")} con etiquetas
              </span>
            )}
          </div>
          <BarrasLista
            etiqueta="Las etiquetas más usadas. Elegir una la busca."
            vacio="Ninguna nota tiene etiquetas todavía."
            items={e.etiquetas.masUsadas.map((t) => ({
              clave: t.etiqueta,
              nombre: `#${t.etiqueta}`,
              valor: t.notas,
              detalle: { titulo: `#${t.etiqueta}`, valor: plural(t.notas, "nota", "notas"), nota: "Clic para buscar tag:" + t.etiqueta },
            }))}
            onElegir={buscarEtiqueta}
          />
        </section>
      </div>
    </>
  );
}

function Cifra({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className={styles.franjaCelda}>
      <span className={styles.cifra}>{valor}</span>
      <span className={styles.cifraRotulo}>{rotulo}</span>
    </div>
  );
}

/** Un selector de segmentos: botones con `aria-pressed` y el borde inferior en el acento. */
function Segmento<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambiar,
}: {
  etiqueta: string;
  opciones: readonly (readonly [T, string])[];
  valor: T;
  onCambiar: (v: T) => void;
}) {
  return (
    <div className={styles.segmento} role="group" aria-label={etiqueta}>
      {opciones.map(([v, texto]) => (
        <button key={v} type="button" aria-pressed={valor === v} onClick={() => onCambiar(v)}>
          {texto}
        </button>
      ))}
    </div>
  );
}
