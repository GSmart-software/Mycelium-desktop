"use client";

import { AlertTriangle, Check, Link2, Search, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmar } from "@/lib/confirmar";
import {
  candidatasDe,
  compilarFormas,
  conDescartes,
  conFormas,
  diagnosticar,
  type Candidata,
  type Lexico,
} from "@/lib/enlaces";
import {
  aplicar,
  deshacer,
  guardarLexico,
  inventario,
  recordarUltimo,
  respaldos,
  type Inventario,
  type Manifiesto,
  type ResultadoAplicacion,
} from "@/lib/db/enlaces";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import styles from "./RelinkView.module.css";

/**
 * Pantalla de auditoría y re-enlazado del vault (`FUN-L-17`), sobre el núcleo de
 * `FUN-M-17`. Existe para quien nunca usa la IA y hoy no tiene ninguna salida:
 * abre un vault que viene de otro proyecto, mira el grafo y no hay ni una
 * conexión — aunque sus documentos se referencien entre sí desde siempre.
 *
 * > [!danger] Las dos mitades están separadas también en la pantalla
 * > Arriba se **audita**: se lee el corpus y se decide qué cadenas son
 * > referencias. Eso no modifica ni un byte de ningún documento; lo único que se
 * > escribe es el léxico, que vive fuera del vault visible.
 * > Abajo se **convierte**, que sí reescribe documentos — y por eso lleva
 * > simulacro, respaldo y deshacer.
 *
 * Es la misma separación que en los comandos de la IA (`/vault-huerfanas` y
 * `/vault-referencias`) y por el mismo motivo: nadie debería poder pedir un
 * diagnóstico y encontrarse el corpus reescrito.
 */
export function RelinkView() {
  const vaultId = useAuthStore((s) => s.vaults[0]?.id) ?? null;
  const [inv, setInv] = useState<Inventario | null>(null);
  const [lexico, setLexico] = useState<Lexico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  /** Decisión por forma: destino elegido, o `false` = descartada. */
  const [decisiones, setDecisiones] = useState<Record<string, string | false>>({});
  const [resultado, setResultado] = useState<ResultadoAplicacion | null>(null);
  const [simulado, setSimulado] = useState<ResultadoAplicacion | null>(null);
  const [ultimo, setUltimo] = useState<Manifiesto | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  /** Por defecto solo lo accionable: ver § "el orden" en `candidatasDe`. */
  const [verSinDestino, setVerSinDestino] = useState(false);

  const cargar = useCallback(async () => {
    if (vaultId === null) return;
    setOcupado("Leyendo el vault…");
    setError(null);
    try {
      const datos = await inventario(vaultId);
      setInv(datos);
      setLexico(datos.lexico);
      setDecisiones({});
      setSimulado(null);
      setUltimo((await respaldos())[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }, [vaultId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const candidatas = useMemo(
    () => (inv && lexico ? candidatasDe(inv.docs, inv.notas, lexico) : []),
    [inv, lexico],
  );
  const diag = useMemo(
    () => (inv ? diagnosticar(inv.docs, candidatas) : null),
    [inv, candidatas],
  );
  const formasEnLexico = useMemo(() => (lexico ? compilarFormas(lexico) : []), [lexico]);

  // Las que apuntan a una nota que existe son las que se pueden decidir de un
  // vistazo; el resto es sobre todo backtick de código, y esconderlas por defecto
  // es la diferencia entre revisar 20 filas y revisar 1500.
  const conDestino = useMemo(() => candidatas.filter((c) => c.destino !== null), [candidatas]);
  const visibles = verSinDestino ? candidatas : conDestino;

  const decididas = Object.entries(decisiones);
  const aceptadas = decididas.filter(([, v]) => v !== false).length;
  const descartadas = decididas.filter(([, v]) => v === false).length;

  // ── Auditoría: guarda SOLO el léxico ───────────────────────────────────────
  const guardarDecisiones = async () => {
    if (lexico === null || inv === null) return;
    setOcupado("Guardando el léxico…");
    setError(null);
    try {
      const altas = candidatas
        .filter((c) => {
          const d = decisiones[c.forma];
          return typeof d === "string" && d !== "";
        })
        .map((c) => {
          const destino = decisiones[c.forma] as string;
          return {
            forma: c.forma,
            destino,
            titulo: inv.notas.find((n) => n.id === destino)?.titulo ?? destino,
          };
        });
      const bajas = candidatas
        .filter((c) => decisiones[c.forma] === false)
        .map((c) => ({ forma: c.forma, motivo: "descartada en la auditoría" }));

      const nuevo = conDescartes(conFormas(lexico, altas), bajas);
      await guardarLexico(nuevo);
      setLexico(nuevo);
      setDecisiones({});
      setMensaje(
        `Léxico guardado: ${altas.length} forma(s) registrada(s) y ${bajas.length} descartada(s). No se modificó ningún documento.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  // ── Conversión: SÍ reescribe ───────────────────────────────────────────────
  const correr = async (simulacro: boolean) => {
    if (vaultId === null) return;
    setOcupado(simulacro ? "Simulando…" : "Convirtiendo…");
    setError(null);
    setMensaje(null);
    try {
      const r = await aplicar(vaultId, { simulacro });
      if (simulacro) {
        setSimulado(r);
      } else {
        setResultado(r);
        setSimulado(null);
        if (r.timestamp !== null) {
          const manifiesto: Manifiesto = {
            version: 1,
            timestamp: r.timestamp,
            archivos: r.archivos,
          };
          await recordarUltimo(manifiesto);
          setUltimo(manifiesto);
        }
        // El contenido cambió: el grafo que estaba en caché ya no vale.
        useGraphStore.getState().markStale();
        await cargar();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  const correrDeshacer = async () => {
    if (ultimo === null) return;
    const ok = await confirmar(
      `Se van a devolver ${ultimo.archivos.length} archivo(s) a como estaban antes de la conversión.\n\n` +
        "Los que hayas editado después NO se tocan.\n\n¿Continuar?",
    );
    if (!ok) return;
    setOcupado("Deshaciendo…");
    setError(null);
    try {
      const r = await deshacer(ultimo);
      useGraphStore.getState().markStale();
      setResultado(null);
      setMensaje(
        `Restaurados ${r.restaurados.length} archivo(s).` +
          (r.omitidos.length > 0
            ? ` ${r.omitidos.length} se dejaron como estaban: ${r.omitidos
                .map((o) => `${o.id} (${o.motivo})`)
                .join(", ")}.`
            : ""),
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  if (vaultId === null) {
    return <p className={styles.aviso}>No hay ningún vault abierto.</p>;
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.cabecera}>
        <Link2 size={16} aria-hidden />
        <h1 className={styles.titulo}>Referencias del vault</h1>
        {ocupado !== null && <span className={styles.ocupado}>{ocupado}</span>}
      </header>

      <div className={styles.scroll}>
        {error !== null && (
          <p className={styles.error} role="alert">
            <AlertTriangle size={14} aria-hidden /> {error}
          </p>
        )}
        {mensaje !== null && (
          <p className={styles.ok} role="status">
            <Check size={14} aria-hidden /> {mensaje}
          </p>
        )}

        {/* ── 1 · Auditoría (no modifica documentos) ──────────────────────── */}
        <section className={styles.seccion}>
          <h2 className={styles.h2}>
            <Search size={14} aria-hidden /> Auditoría
          </h2>
          <p className={styles.nota}>
            Lee el vault y propone qué cadenas parecen referencias a otras notas.{" "}
            <strong>No modifica ningún documento</strong>: lo único que se guarda es el
            léxico, en <code>.claude/</code>.
          </p>

          {diag !== null && (
            <div className={styles.diagnostico}>
              <Dato n={diag.documentos} etiqueta="documentos" />
              <Dato n={diag.sinEnlaces} etiqueta="sin ningún enlace" />
              <Dato n={diag.wikilinks} etiqueta="wikilinks ya escritos" />
              <Dato n={diag.candidatas} etiqueta="formas candidatas" />
              <Dato n={diag.apariciones} etiqueta="apariciones sin enlazar" />
            </div>
          )}

          {diag !== null && diag.candidatas === 0 && (
            <p className={styles.nota}>
              No queda ninguna forma por decidir. Si el vault tiene referencias que
              Mycelium no ve, revisá el léxico: quizá se descartaron antes.
            </p>
          )}

          {candidatas.length > 0 && conDestino.length < candidatas.length && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={verSinDestino}
                onChange={(e) => setVerSinDestino(e.target.checked)}
              />
              Mostrar también las {candidatas.length - conDestino.length} formas que{" "}
              <strong>no apuntan a ninguna nota</strong> — casi siempre son código entre
              backticks, no referencias
            </label>
          )}

          {visibles.length > 0 && inv !== null && (
            <>
              <table className={styles.tabla}>
                <thead>
                  <tr>
                    <th scope="col">Forma</th>
                    <th scope="col">Usos</th>
                    <th scope="col">Apunta a</th>
                    <th scope="col">Ejemplo</th>
                    <th scope="col">Decisión</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.slice(0, 300).map((c) => (
                    <Fila
                      key={c.forma}
                      candidata={c}
                      notas={inv.notas}
                      decision={decisiones[c.forma]}
                      onDecidir={(d) => setDecisiones((s) => ({ ...s, [c.forma]: d }))}
                      onOlvidar={() =>
                        setDecisiones((s) => {
                          const { [c.forma]: _, ...resto } = s;
                          return resto;
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
              {visibles.length > 300 && (
                <p className={styles.nota}>
                  Se muestran las 300 formas más usadas de {visibles.length}. Al guardar
                  estas, las siguientes suben a la lista.
                </p>
              )}

              <div className={styles.acciones}>
                <button
                  type="button"
                  className={styles.primario}
                  disabled={ocupado !== null || decididas.length === 0}
                  onClick={() => void guardarDecisiones()}
                >
                  Guardar {aceptadas} forma(s) y descartar {descartadas}
                </button>
                <span className={styles.nota}>Escribe solo el léxico.</span>
              </div>
            </>
          )}
        </section>

        {/* ── 2 · Conversión (reescribe documentos) ───────────────────────── */}
        <section className={styles.seccion}>
          <h2 className={styles.h2}>
            <Link2 size={14} aria-hidden /> Convertir en enlaces
          </h2>
          <p className={styles.nota}>
            Aplica el léxico a todo el vault: <code>`HU-009`</code> pasa a{" "}
            <code>[[HU-009]]</code>. <strong>Esto sí reescribe documentos</strong>, con
            respaldo en <code>.mycelium/</code> antes de tocar nada. Solo se toca lo que
            está en el léxico: el resto queda intacto, esté entre backticks o no.
          </p>
          <p className={styles.nota}>
            El léxico tiene <strong>{formasEnLexico.length}</strong> forma(s) registrada(s).
          </p>

          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              disabled={ocupado !== null || formasEnLexico.length === 0}
              onClick={() => void correr(true)}
            >
              Simulacro
            </button>
            <button
              type="button"
              className={styles.primario}
              disabled={ocupado !== null || formasEnLexico.length === 0}
              onClick={() => void correr(false)}
            >
              Convertir
            </button>
            {ultimo !== null && (
              <button
                type="button"
                className={styles.secundario}
                disabled={ocupado !== null}
                onClick={() => void correrDeshacer()}
              >
                <Undo2 size={13} aria-hidden /> Deshacer la última conversión
              </button>
            )}
          </div>

          {simulado !== null && (
            <Informe titulo="Simulacro — no se escribió nada" r={simulado} />
          )}
          {resultado !== null && (
            <Informe titulo="Conversión aplicada" r={resultado} />
          )}
        </section>
      </div>
    </div>
  );
}

function Dato({ n, etiqueta }: { n: number; etiqueta: string }) {
  return (
    <div className={styles.dato}>
      <strong className={styles.datoN}>{n}</strong>
      <span>{etiqueta}</span>
    </div>
  );
}

function Informe({ titulo, r }: { titulo: string; r: ResultadoAplicacion }) {
  return (
    <div className={styles.informe}>
      <p className={styles.informeTitulo}>
        {titulo}: {r.reemplazos} reemplazo(s) en {r.archivos.length} archivo(s).
      </p>
      <ul className={styles.informeLista}>
        {r.archivos.slice(0, 40).map((a) => (
          <li key={a.id}>
            <code>{a.id}</code> · {a.reemplazos.length}
          </li>
        ))}
      </ul>
      {r.archivos.length > 40 && (
        <p className={styles.nota}>…y {r.archivos.length - 40} archivo(s) más.</p>
      )}
    </div>
  );
}

/** Una candidata con su decisión. El destino se puede corregir a mano. */
function Fila({
  candidata,
  notas,
  decision,
  onDecidir,
  onOlvidar,
}: {
  candidata: Candidata;
  notas: { id: string; titulo: string }[];
  decision: string | false | undefined;
  onDecidir: (d: string | false) => void;
  onOlvidar: () => void;
}) {
  const destino = typeof decision === "string" ? decision : (candidata.destino ?? "");
  return (
    <tr className={decision === false ? styles.filaDescartada : undefined}>
      <td>
        <code className={styles.forma}>{candidata.forma}</code>
        <span className={styles.origen}>{candidata.origen}</span>
      </td>
      <td className={styles.numero}>
        {candidata.apariciones}
        <span className={styles.origen}>en {candidata.documentos} doc.</span>
      </td>
      <td>
        <select
          className={styles.select}
          value={destino}
          onChange={(e) => onDecidir(e.target.value === "" ? false : e.target.value)}
        >
          <option value="">— sin destino —</option>
          {notas.map((n) => (
            <option key={n.id} value={n.id}>
              {n.titulo}
            </option>
          ))}
        </select>
      </td>
      <td className={styles.ejemplo}>{candidata.ejemplo}</td>
      <td className={styles.decision}>
        {decision === undefined ? (
          <>
            <button
              type="button"
              className={styles.si}
              // Sin destino no se puede registrar: un wikilink a la nada no sirve.
              disabled={destino === ""}
              title={destino === "" ? "Elegí primero a qué nota apunta" : "Es una referencia"}
              onClick={() => onDecidir(destino)}
            >
              <Check size={13} aria-hidden /> Sí
            </button>
            <button
              type="button"
              className={styles.no}
              title="No es una referencia; no volver a proponerla"
              onClick={() => onDecidir(false)}
            >
              <X size={13} aria-hidden /> No
            </button>
          </>
        ) : (
          <button type="button" className={styles.deshacerFila} onClick={onOlvidar}>
            {decision === false ? "Descartada" : "Aceptada"} · deshacer
          </button>
        )}
      </td>
    </tr>
  );
}
