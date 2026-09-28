"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { confirmar } from "@/lib/confirmar";
import { abrirEnNavegador } from "@/lib/enlacesExternos";
import * as corrector from "@/lib/ortografia/corrector";
import {
  borrarDescargado,
  cancelarDescarga,
  consultarManifiesto,
  descargar,
  DESCARGA_CANCELADA,
  escucharCambios,
  escucharCambiosDeMycelium,
  escucharProgreso,
  leerConfig,
  leerLicencia,
  listarDescargados,
  vaultActual,
  type ConfigCorrector,
  type ProgresoDescarga,
} from "@/lib/ortografia/diccionarios";
import { elegirVariante, lenguaDelSistema, localesDelSistema, regionDelSistema } from "@/lib/ortografia/idioma";
import {
  estadoIdioma,
  formatearBytes,
  lenguaDeVariante,
  type Descargado,
  type Idioma,
  type Manifiesto,
} from "@/lib/ortografia/manifiesto";
import { filtrarPalabras } from "@/lib/ortografia/palabras";
import styles from "./DiccionariosCorrector.module.css";
import ajustes from "./Settings.module.css";

/** Nombres para mostrar lo descargado cuando no se pudo leer el manifiesto. */
const NOMBRES: Record<string, string> = { es: "Español", en: "Inglés", it: "Italiano" };

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Una copia del registro sin esa clave. */
function sin<T>(registro: Record<string, T>, clave: string): Record<string, T> {
  const copia = { ...registro };
  delete copia[clave];
  return copia;
}

/**
 * Los diccionarios del corrector ortográfico (`FUN-L-12`, spec § 2.2): la lista
 * del manifiesto con el estado de cada uno, la propuesta de bajar el del idioma
 * del sistema, las licencias y los dos diccionarios personales (el del vault y
 * el de Mycelium).
 */
export function DiccionariosCorrector() {
  const [manifiesto, setManifiesto] = useState<Manifiesto | null>(null);
  const [errorManifiesto, setErrorManifiesto] = useState<string | null>(null);
  const [descargados, setDescargados] = useState<Descargado[]>([]);
  const [config, setConfig] = useState<ConfigCorrector>({ activas: [], propuestaHecha: false });
  /** Descargas en curso, por lengua. */
  const [progreso, setProgreso] = useState<Record<string, ProgresoDescarga>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [verLicencias, setVerLicencias] = useState(false);

  const region = useMemo(() => regionDelSistema(localesDelSistema()), []);
  const lenguaSistema = useMemo(() => lenguaDelSistema(localesDelSistema()), []);

  const recargarLocal = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([listarDescargados(), leerConfig()]);
      setDescargados(d);
      setConfig(c);
    } catch (e) {
      console.error("[Mycelium] corrector · no se pudo leer el estado de los diccionarios", e);
    }
  }, []);

  const recargarManifiesto = useCallback(async () => {
    setErrorManifiesto(null);
    try {
      setManifiesto(await consultarManifiesto());
    } catch (e) {
      setManifiesto(null);
      setErrorManifiesto(mensaje(e));
    }
  }, []);

  useEffect(() => {
    // Promesas encadenadas y no `await` suelto: el estado se fija cuando llega,
    // fuera del cuerpo del efecto.
    void recargarLocal();
    void recargarManifiesto();
    const bajas: (() => void)[] = [];
    let vivo = true;
    const guardarBaja = (b: () => void) => (vivo ? bajas.push(b) : b());
    void escucharProgreso((p) => {
      setProgreso((act) => ({ ...act, [lenguaDeVariante(p.id)]: p }));
    }).then(guardarBaja);
    void escucharCambios(() => void recargarLocal()).then(guardarBaja);
    return () => {
      vivo = false;
      for (const b of bajas) b();
    };
  }, [recargarLocal, recargarManifiesto]);

  const bajar = async (idioma: Idioma) => {
    const variante = elegirVariante(idioma, region);
    if (!variante) return;
    setErrores((act) => sin(act, idioma.id));
    setProgreso((act) => ({ ...act, [idioma.id]: { id: variante.id, descargado: 0, total: variante.bytes } }));
    try {
      await descargar(variante);
      // Otra variante de la misma lengua (la región del sistema cambió) sobra:
      // se usa la nueva.
      for (const d of descargados) {
        if (lenguaDeVariante(d.id) === idioma.id && d.id !== variante.id) await borrarDescargado(d.id);
      }
      await corrector.activarLengua(idioma.id, true);
    } catch (e) {
      const m = mensaje(e);
      if (m !== DESCARGA_CANCELADA) setErrores((act) => ({ ...act, [idioma.id]: m }));
    } finally {
      setProgreso((act) => sin(act, idioma.id));
      void recargarLocal();
    }
  };

  const quitar = async (lengua: string, nombre: string) => {
    if (!(await confirmar(`¿Quitar el diccionario de ${nombre}? Se borra del disco; se puede volver a descargar.`, "Quitar"))) {
      return;
    }
    try {
      for (const d of descargados) if (lenguaDeVariante(d.id) === lengua) await borrarDescargado(d.id);
      await corrector.activarLengua(lengua, false);
    } catch (e) {
      setErrores((act) => ({ ...act, [lengua]: mensaje(e) }));
    }
    void recargarLocal();
  };

  const alternarActivo = async (lengua: string, activa: boolean) => {
    setConfig((c) => ({ ...c, activas: activa ? [...c.activas, lengua] : c.activas.filter((a) => a !== lengua) }));
    try {
      await corrector.activarLengua(lengua, activa);
    } catch (e) {
      setErrores((act) => ({ ...act, [lengua]: mensaje(e) }));
      void recargarLocal();
    }
  };

  /** Una fila: el idioma del manifiesto (o, sin conexión, lo descargado). */
  const fila = (lengua: string, nombre: string, idioma: Idioma | null) => {
    const estado = idioma
      ? estadoIdioma(idioma, descargados, elegirVariante(idioma, region))
      : { variante: null, instalado: descargados.find((d) => lenguaDeVariante(d.id) === lengua) ?? null, actualizable: false };
    const enCurso = progreso[lengua];
    const error = errores[lengua];
    const activa = config.activas.includes(lengua);
    const pct = enCurso && enCurso.total > 0 ? Math.min(100, (enCurso.descargado / enCurso.total) * 100) : 0;

    let detalle: string;
    if (enCurso) detalle = `Descargando… ${formatearBytes(enCurso.descargado)} de ${formatearBytes(enCurso.total)}`;
    else if (estado.instalado) detalle = `Descargado · ${estado.instalado.id} · versión ${estado.instalado.version}`;
    else if (estado.variante) detalle = `No descargado · ${formatearBytes(estado.variante.bytes)}`;
    else detalle = "No descargado";

    return (
      <li key={lengua} className={styles.fila}>
        <span className={styles.nombre}>
          {nombre}
          <span className={styles.detalle}>{detalle}</span>
        </span>
        <span className={styles.acciones}>
          {enCurso ? (
            <button
              type="button"
              className={styles.boton}
              onClick={() => void cancelarDescarga(enCurso.id)}
            >
              Cancelar
            </button>
          ) : estado.instalado ? (
            <>
              <label className={styles.activo}>
                <input
                  type="checkbox"
                  checked={activa}
                  onChange={(e) => void alternarActivo(lengua, e.target.checked)}
                />
                Activo
              </label>
              {estado.actualizable && idioma && (
                <button type="button" className={styles.boton} onClick={() => void bajar(idioma)}>
                  Actualizar
                </button>
              )}
              <button type="button" className={styles.boton} onClick={() => void quitar(lengua, nombre)}>
                Quitar
              </button>
            </>
          ) : idioma ? (
            <button type="button" className={`${styles.boton} ${styles.botonPrimario}`} onClick={() => void bajar(idioma)}>
              {error ? "Reintentar" : "Descargar"}
            </button>
          ) : null}
        </span>
        {enCurso && (
          <span
            className={styles.progreso}
            role="progressbar"
            aria-label={`Descarga de ${nombre}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <span className={styles.progresoBarra} style={{ width: `${pct}%` }} />
          </span>
        )}
        {error && <span className={styles.error}>{error}</span>}
      </li>
    );
  };

  // Sin conexión: lo descargado, agrupado por lengua, sigue funcionando.
  const lenguasOffline = [...new Set(descargados.map((d) => lenguaDeVariante(d.id)))];
  const propuesta =
    manifiesto && descargados.length === 0 && Object.keys(progreso).length === 0
      ? (manifiesto.idiomas.find((i) => i.id === lenguaSistema) ?? manifiesto.idiomas.find((i) => i.id === "es") ?? null)
      : null;
  const variantePropuesta = propuesta ? elegirVariante(propuesta, region) : null;

  return (
    <div className={ajustes.field} style={{ maxWidth: "none" }}>
      <span className={ajustes.label}>Diccionarios</span>

      {propuesta && variantePropuesta && (
        <div className={styles.propuesta}>
          <p>
            Todavía no hay ningún diccionario, así que no se marca nada. ¿Descargar el de{" "}
            <strong>{propuesta.nombre}</strong>, el idioma de tu sistema ({formatearBytes(variantePropuesta.bytes)})?
          </p>
          <button type="button" className={`${styles.boton} ${styles.botonPrimario}`} onClick={() => void bajar(propuesta)}>
            Descargar
          </button>
        </div>
      )}

      <ul className={styles.lista}>
        {manifiesto
          ? manifiesto.idiomas.map((i) => fila(i.id, i.nombre, i))
          : lenguasOffline.map((l) => fila(l, NOMBRES[l] ?? l, null))}
      </ul>

      {errorManifiesto && (
        <p className={ajustes.warn}>
          No se pudo consultar la lista de diccionarios ({errorManifiesto}).{" "}
          {descargados.length > 0 ? "Los ya descargados siguen funcionando." : "Hace falta conexión para descargar uno."}{" "}
          <button type="button" className={styles.enlace} onClick={() => void recargarManifiesto()}>
            Reintentar
          </button>
        </p>
      )}

      <p className={ajustes.hint}>
        Una palabra está bien si lo está en alguno de los diccionarios activos. El español es
        el de la región de tu sistema{region ? ` (${region})` : ""}: con el de Argentina o
        Uruguay, el voseo no se marca. Los diccionarios se guardan en esta computadora, no en
        el vault.
      </p>

      <button type="button" className={styles.enlace} onClick={() => setVerLicencias((v) => !v)} aria-expanded={verLicencias}>
        Licencias de los diccionarios
      </button>
      {verLicencias && <Licencias manifiesto={manifiesto} descargados={descargados} />}

      <DiccionariosPersonales />
    </div>
  );
}

/** La licencia, la fuente y el autor de cada diccionario (spec § 8). */
function Licencias({ manifiesto, descargados }: { manifiesto: Manifiesto | null; descargados: Descargado[] }) {
  const [textos, setTextos] = useState<Record<string, string>>({});

  const verTexto = async (d: Descargado) => {
    try {
      const texto = await leerLicencia(d);
      setTextos((t) => ({ ...t, [d.id]: texto }));
    } catch (e) {
      setTextos((t) => ({ ...t, [d.id]: `No se pudo leer la licencia: ${mensaje(e)}` }));
    }
  };

  const enlace = (url: string, texto: string) => (
    <button type="button" className={styles.enlace} onClick={() => void abrirEnNavegador(url)}>
      {texto}
    </button>
  );

  return (
    <div className={styles.licencias}>
      {manifiesto?.idiomas.map((i) => (
        <div key={i.id}>
          <strong>{i.nombre}</strong> — {i.autor}. Licencia: {i.licencia}. {enlace(i.urlFuente, "Fuente")}
          {" · "}
          {enlace(i.urlLicencia, "Texto de la licencia")}
        </div>
      ))}
      {!manifiesto && <div>Sin conexión: se muestran las licencias de lo descargado.</div>}
      {descargados.map((d) => (
        <div key={d.id}>
          <strong>{d.id}</strong> (descargado):{" "}
          {textos[d.id] === undefined ? (
            <button type="button" className={styles.enlace} onClick={() => void verTexto(d)}>
              Ver la licencia que lo acompaña
            </button>
          ) : (
            <pre className={styles.textoLicencia}>{textos[d.id]}</pre>
          )}
        </div>
      ))}
      <div>
        <strong>Motor</strong> — spellbook, de Helix (MPL-2.0), sin modificar.{" "}
        {enlace("https://github.com/helix-editor/spellbook", "Fuente")}
      </div>
    </div>
  );
}

/** Desde cuántas palabras se ofrece el filtro de texto: con pocas, sobra. */
const PALABRAS_PARA_FILTRAR = 12;

/** Lo que cambia entre los dos diccionarios personales. */
const PERSONALES: Record<corrector.DiccionarioPersonal, { titulo: string; nombre: string; donde: ReactNode }> = {
  vault: {
    titulo: "Diccionario de este vault",
    nombre: "del vault",
    donde: (
      <>
        Se guarda dentro del vault (<code>.mycelium/diccionario.txt</code>) y viaja con él: vale solo en este
        vault.
      </>
    ),
  },
  mycelium: {
    titulo: "Diccionario de Mycelium",
    nombre: "de Mycelium",
    donde: (
      <>
        Se guarda en esta computadora (<code>diccionario-personal.txt</code>, junto a la configuración de la
        app) y vale en todos tus vaults.
      </>
    ),
  },
};

/** Los dos diccionarios personales (spec § 2.2). Sin vault abierto, el del vault no se muestra. */
function DiccionariosPersonales() {
  const hayVault = vaultActual() !== null;
  return (
    <div className={styles.personales}>
      <span className={ajustes.label}>Diccionarios personales</span>
      <p className={ajustes.hint}>
        Las palabras que agregás con el clic derecho sobre una palabra marcada. Quitar una hace que se vuelva
        a marcar.
      </p>
      {hayVault && <DiccionarioPersonal dic="vault" />}
      <DiccionarioPersonal dic="mycelium" />
    </div>
  );
}

/** Un diccionario personal: cuántas palabras tiene, verlas (con filtro) y quitar una. */
function DiccionarioPersonal({ dic }: { dic: corrector.DiccionarioPersonal }) {
  const [palabras, setPalabras] = useState<string[] | null>(null);
  const [ver, setVer] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { titulo, nombre, donde } = PERSONALES[dic];

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      corrector
        .palabrasDe(dic)
        .then((p) => vivo && setPalabras(p))
        .catch((e) => vivo && setError(mensaje(e)));
    void cargar();
    const bajas = [corrector.suscribirPersonales(() => void cargar())];
    // El de Mycelium también cambia desde otra ventana, aunque en esta el
    // corrector esté apagado.
    if (dic === "mycelium") {
      void escucharCambiosDeMycelium(() => void cargar()).then((b) => (vivo ? bajas.push(b) : b()));
    }
    return () => {
      vivo = false;
      for (const b of bajas) b();
    };
  }, [dic]);

  const quitar = async (p: string) => {
    setError(null);
    try {
      await corrector.quitarDe(dic, p);
    } catch (e) {
      setError(mensaje(e));
    }
  };

  const n = palabras?.length ?? 0;
  const visibles = palabras ? filtrarPalabras(palabras, filtro) : [];
  return (
    <div className={styles.personal}>
      <p className={styles.personalCabecera}>
        <span>
          <strong>{titulo}</strong> · {n === 1 ? "1 palabra" : `${n} palabras`}
        </span>
        {n > 0 && (
          <button type="button" className={styles.enlace} onClick={() => setVer((v) => !v)} aria-expanded={ver}>
            {ver ? "Ocultar" : "Ver y quitar"}
          </button>
        )}
      </p>
      <p className={ajustes.hint}>{donde}</p>
      {ver && palabras && n > 0 && (
        <>
          {n >= PALABRAS_PARA_FILTRAR && (
            <input
              type="search"
              className={`${ajustes.input} ${styles.filtro}`}
              placeholder="Buscar una palabra…"
              aria-label={`Buscar en el diccionario ${nombre}`}
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          )}
          {visibles.length > 0 ? (
            <ul className={styles.palabras} aria-label={`Palabras del diccionario ${nombre}`}>
              {visibles.map((p) => (
                <li key={p} className={styles.palabra}>
                  <span className={styles.palabraTexto}>{p}</span>
                  <button
                    type="button"
                    className={styles.quitarPalabra}
                    aria-label={`Quitar «${p}» del diccionario ${nombre}`}
                    title="Quitar"
                    onClick={() => void quitar(p)}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={ajustes.hint}>Ninguna palabra coincide con «{filtro.trim()}».</p>
          )}
        </>
      )}
      {error && <p className={ajustes.error}>{error}</p>}
    </div>
  );
}
