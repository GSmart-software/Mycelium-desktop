"use client";

import { Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { atajoDeEvento, esModificador, textoAtajo, type Atajo } from "@/lib/comandos/atajos";
import { aprenderTecla, useDistribucion } from "@/lib/comandos/distribucion";
import { fijarGrabandoAtajo } from "@/lib/comandos/grabacion";
import {
  asignarAtajo,
  choqueDe,
  esPersonalizable,
  estaPersonalizado,
  quitarAtajo,
  restaurarAtajo,
} from "@/lib/comandos/personalizar";
import {
  guardarPrefsConsola,
  guardarSobreescrituras,
  usePreferenciasAtajos,
} from "@/lib/comandos/preferenciasAtajos";
import { efectivosDe, gruposDeAtajos, resolverTexto, type Comando } from "@/lib/comandos/registro";
import { filasConsola } from "@/lib/comandos/teclasConsola";
import { useComandos } from "@/lib/comandos/useComandos";
import { comandosDisponibles } from "@/lib/modoDev";
import { useUpdaterStore } from "@/stores/updaterStore";
import { TeclasAtajo } from "@/components/workspace/TeclasAtajo";
import settings from "./Settings.module.css";
import styles from "./AtajosSection.module.css";

/** Sin tildes ni mayúsculas, para el buscador. */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Qué atajo se está grabando: el comando y el lugar en su lista (`null` = uno nuevo). */
type Grabando = { id: string; indice: number | null };

/** Una combinación que ya es de otro comando: se pregunta antes de quitársela. */
type Pendiente = { id: string; indice: number | null; atajo: Atajo; otro: string };

/**
 * Configuración → Atajos de teclado (`FUN-XL-04`, Parte 3). Todos los comandos
 * del registro agrupados por categoría, con un buscador; cada uno con sus
 * atajos, que se cambian **grabando** la combinación: se pulsa el atajo, se
 * pulsa la combinación nueva; **Esc** cancela; **Retroceso** o **Supr** lo
 * quita. Avisa los conflictos con otro comando (y ofrece reemplazar), bloquea
 * las teclas reservadas y las que escribirían en un documento.
 *
 * Abajo, la lista de los atajos que salen de una consola.
 *
 * Los atajos son del usuario: los mismos en todos los vaults
 * (`preferenciasAtajos.ts`).
 *
 * Con `soloComando`, muestra solo la fila de ese comando, con el mismo
 * grabador, conflictos y reservadas: es como Configuración → Macros le da un
 * atajo a una macro (`FUN-XL-04`, Parte 6).
 */
export function AtajosSection({ soloComando }: { soloComando?: string } = {}) {
  const comandos = useComandos();
  const prefs = usePreferenciasAtajos();
  const dev = useUpdaterStore((s) => s.estado?.dev ?? false);
  const distribucion = useDistribucion();
  const [consulta, setConsulta] = useState("");
  const [grabando, setGrabando] = useState<Grabando | null>(null);
  const [parcial, setParcial] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ id: string; texto: string } | null>(null);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const grabadorRef = useRef<HTMLButtonElement>(null);
  const seccionRef = useRef<HTMLDivElement>(null);
  /** El comando del último atajo grabado: al terminar, el foco vuelve a su fila. */
  const ultimoRef = useRef<string | null>(null);

  const efectivos = useMemo(() => efectivosDe(comandos, prefs.atajos), [comandos, prefs.atajos]);
  /** Los que el usuario puede ver: sin los de desarrollador con el modo apagado. */
  const visibles = useMemo(() => comandosDisponibles(comandos, dev), [comandos, dev]);
  const tituloDe = (id: string) => {
    const c = comandos.find((x) => x.id === id);
    return c ? (resolverTexto(c.titulo) ?? id) : id;
  };

  const grupos = useMemo(() => {
    const q = normalizar(consulta.trim());
    return gruposDeAtajos(comandos, dev, { sobre: prefs.atajos })
      .map((g) => ({
        ...g,
        comandos: g.comandos.filter(
          (c) =>
            !q ||
            normalizar(c.titulo).includes(q) ||
            normalizar(g.nombre).includes(q) ||
            c.atajos.some((a) => normalizar(textoAtajo(a, distribucion)).includes(q)),
        ),
      }))
      .filter((g) => g.comandos.length > 0);
  }, [comandos, dev, prefs.atajos, consulta, distribucion]);

  const desplazados = efectivos.desplazados.filter(
    (d) => visibles.some((c) => c.id === d.id) && visibles.some((c) => c.id === d.por),
  );

  // Mientras se graba, el despachador, F1 y la captura rápida no actúan.
  useEffect(() => {
    fijarGrabandoAtajo(grabando !== null);
    if (grabando) {
      ultimoRef.current = grabando.id;
      requestAnimationFrame(() => grabadorRef.current?.focus());
    } else if (ultimoRef.current && !seccionRef.current?.contains(document.activeElement)) {
      // El botón que se grababa ya no existe: el foco no puede quedar en `body`.
      const fila = seccionRef.current?.querySelector<HTMLElement>(
        `[data-comando="${CSS.escape(ultimoRef.current)}"] button`,
      );
      fila?.focus();
    }
    return () => fijarGrabandoAtajo(false);
  }, [grabando]);

  const empezar = (id: string, indice: number | null) => {
    setPendiente(null);
    setMensaje(null);
    setParcial(null);
    setGrabando({ id, indice });
  };

  const terminar = () => {
    setGrabando(null);
    setParcial(null);
  };

  const asignar = (id: string, indice: number | null, atajo: Atajo) => {
    guardarSobreescrituras(asignarAtajo(prefs.atajos, comandos, id, indice, atajo));
  };

  /** La tecla mientras se graba. Nadie más la recibe. */
  const alPulsar = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!grabando) return;
    e.preventDefault();
    e.stopPropagation();
    const { id, indice } = grabando;
    const sinModificadores = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    if (e.code === "Escape" && sinModificadores) {
      terminar();
      return;
    }
    if ((e.code === "Backspace" || e.code === "Delete") && sinModificadores) {
      if (indice !== null) guardarSobreescrituras(quitarAtajo(prefs.atajos, comandos, id, indice));
      terminar();
      return;
    }
    aprenderTecla(e);
    if (esModificador(e.code)) {
      setParcial([(e.ctrlKey || e.metaKey) && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean).join("+"));
      return;
    }
    const atajo = atajoDeEvento(e);
    if (!atajo) {
      setMensaje({ id, texto: "Esa tecla no se puede usar en un atajo." });
      return;
    }
    const choque = choqueDe(atajo, id, visibles, efectivos);
    if (!choque) {
      asignar(id, indice, atajo);
      setMensaje(null);
      terminar();
      return;
    }
    if (choque.tipo === "otro") {
      setPendiente({ id, indice, atajo, otro: choque.id });
      terminar();
      return;
    }
    // Inválida, reservada o de un comando fijo: se sigue grabando.
    setParcial(null);
    setMensaje({
      id,
      texto:
        choque.tipo === "fijo"
          ? `${textoAtajo(atajo, distribucion)} es de «${tituloDe(choque.id)}», que no se puede cambiar. Prueba otra combinación.`
          : choque.motivo,
    });
  };

  const personalizados = Object.keys(prefs.atajos).length;

  const conflicto = pendiente && (
    <div className={`${styles.conflicto} mic-ajustes-atajos-conflicto`} role="alertdialog" aria-live="assertive">
      <p className={styles.aviso}>
        {textoAtajo(pendiente.atajo, distribucion)} ya es de «{tituloDe(pendiente.otro)}». ¿Se lo das a «
        {tituloDe(pendiente.id)}»?
      </p>
      <div className={settings.btnRow}>
        <button
          type="button"
          className={settings.primaryBtn}
          autoFocus
          onClick={() => {
            asignar(pendiente.id, pendiente.indice, pendiente.atajo);
            setPendiente(null);
          }}
        >
          Reemplazar
        </button>
        <button type="button" className={settings.secondaryBtn} onClick={() => setPendiente(null)}>
          Cancelar
        </button>
      </div>
    </div>
  );

  const fila = (comando: Comando, titulo: string, atajos: readonly Atajo[]) => (
    <FilaComando
      key={comando.id}
      comando={comando}
      titulo={titulo}
      atajos={atajos}
      personalizado={estaPersonalizado(comando.id, prefs.atajos)}
      grabando={grabando?.id === comando.id ? grabando : null}
      parcial={parcial}
      mensaje={mensaje?.id === comando.id ? mensaje.texto : null}
      grabadorRef={grabadorRef}
      alPulsar={alPulsar}
      empezar={empezar}
      cancelar={terminar}
      restaurar={() => {
        setMensaje(null);
        guardarSobreescrituras(restaurarAtajo(prefs.atajos, comandos, comando.id));
      }}
    />
  );

  if (soloComando) {
    const comando = comandos.find((c) => c.id === soloComando);
    return (
      <div ref={seccionRef} className={`${styles.seccion} mic-ajustes-atajos`}>
        {conflicto}
        {comando ? (
          <ul className={styles.lista}>
            {fila(comando, resolverTexto(comando.titulo) ?? comando.id, efectivos.porId.get(comando.id) ?? [])}
          </ul>
        ) : (
          <p className={settings.hint}>Este comando todavía no está registrado.</p>
        )}
      </div>
    );
  }

  return (
    <div ref={seccionRef} className={`${styles.seccion} mic-ajustes-atajos`}>
      <div className={settings.field}>
        <span className={settings.label}>Atajos de teclado</span>
        <p className={settings.hint}>
          Pulsa un atajo para cambiarlo y luego la combinación nueva. <strong>Esc</strong> cancela;{" "}
          <strong>Retroceso</strong> lo quita. Son tuyos: valen en todos los vaults.
        </p>
        <div className={styles.barra}>
          <input
            className={settings.input}
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && consulta) {
                e.stopPropagation();
                setConsulta("");
              }
            }}
            placeholder="Buscar un comando o una tecla…"
            aria-label="Buscar un atajo"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className={settings.secondaryBtn}
            disabled={personalizados === 0}
            onClick={() => {
              setPendiente(null);
              setMensaje(null);
              guardarSobreescrituras({});
            }}
          >
            Restaurar todos
          </button>
        </div>
      </div>

      {desplazados.length > 0 && (
        <div className={settings.warn} role="status">
          {desplazados.map((d) => (
            <p key={`${d.id}-${d.por}`} className={styles.aviso}>
              «{tituloDe(d.id)}» venía con {textoAtajo(d.atajo, distribucion)}, pero esa tecla se la diste a «
              {tituloDe(d.por)}»: quedó sin ese atajo.
            </p>
          ))}
        </div>
      )}

      {conflicto}

      {grupos.length === 0 && <p className={settings.hint}>Ningún comando coincide con «{consulta.trim()}».</p>}

      {grupos.map((g) => (
        <section key={g.categoria} className={styles.grupo} aria-labelledby={`atajos-${g.categoria}`}>
          <h4 id={`atajos-${g.categoria}`} className={styles.grupoTitulo}>
            {g.nombre}
          </h4>
          <ul className={styles.lista}>
            {g.comandos.map(({ comando, titulo, atajos }) => fila(comando, titulo, atajos))}
          </ul>
        </section>
      ))}

      <ConsolaAtajos comandos={visibles} />
    </div>
  );
}

function FilaComando({
  comando,
  titulo,
  atajos,
  personalizado,
  grabando,
  parcial,
  mensaje,
  grabadorRef,
  alPulsar,
  empezar,
  cancelar,
  restaurar,
}: {
  comando: Comando;
  titulo: string;
  atajos: readonly Atajo[];
  personalizado: boolean;
  grabando: Grabando | null;
  parcial: string | null;
  mensaje: string | null;
  grabadorRef: React.RefObject<HTMLButtonElement | null>;
  alPulsar: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  empezar: (id: string, indice: number | null) => void;
  cancelar: () => void;
  restaurar: () => void;
}) {
  const fijo = !esPersonalizable(comando);
  const distribucion = useDistribucion();
  const grabador = (indice: number | null) => (
    <button
      ref={grabadorRef}
      type="button"
      className={`${styles.chip} ${styles.grabando}`}
      onKeyDown={alPulsar}
      onBlur={cancelar}
      aria-label={`Pulsa la combinación nueva para «${titulo}». Esc cancela${indice !== null ? "; Retroceso quita el atajo" : ""}.`}
      data-grabando=""
    >
      {parcial ? `${parcial}+…` : "Pulsa la combinación…"}
    </button>
  );
  return (
    <li className={`${styles.fila} mic-ajustes-atajos-fila`} data-comando={comando.id}>
      <div className={styles.cabeceraFila}>
        <span className={styles.nombre}>
          {titulo}
          {personalizado && <span className={styles.marca}> · cambiado</span>}
        </span>
        <div className={styles.atajos}>
          {atajos.length === 0 && !grabando && <span className={styles.sinAtajo}>Sin atajo</span>}
          {atajos.map((a, i) =>
            grabando?.indice === i ? (
              <span key={i}>{grabador(i)}</span>
            ) : fijo ? (
              <span key={i} className={styles.fijo} title="Este atajo no se puede cambiar">
                <TeclasAtajo atajo={a} />
              </span>
            ) : (
              <button
                key={i}
                type="button"
                className={styles.chip}
                onClick={() => empezar(comando.id, i)}
                aria-label={`Cambiar ${textoAtajo(a, distribucion)} de «${titulo}»`}
              >
                <TeclasAtajo atajo={a} />
              </button>
            ),
          )}
          {grabando?.indice === null && grabador(null)}
          {!fijo && !grabando && (
            <button
              type="button"
              className={styles.icono}
              onClick={() => empezar(comando.id, null)}
              aria-label={`Agregar un atajo a «${titulo}»`}
              title="Agregar un atajo"
            >
              <Plus size={14} aria-hidden />
            </button>
          )}
          {!fijo && personalizado && (
            <button
              type="button"
              className={styles.icono}
              onClick={restaurar}
              aria-label={`Restaurar el atajo de fábrica de «${titulo}»`}
              title="Restaurar el de fábrica"
            >
              <RotateCcw size={14} aria-hidden />
            </button>
          )}
          {fijo && <span className={styles.sinAtajo}>Fijo</span>}
        </div>
      </div>
      {mensaje && (
        <p className={`${settings.error} ${styles.mensaje}`} role="alert">
          {mensaje}
        </p>
      )}
    </li>
  );
}

/**
 * Las teclas que salen de una consola: con el foco en una terminal, la shell
 * recibe casi todo; estos atajos llegan a Mycelium. F6, Shift+F6 y las
 * pistas (F10) no se pueden apagar: se atienden antes que la consola.
 */
function ConsolaAtajos({ comandos }: { comandos: readonly Comando[] }) {
  const prefs = usePreferenciasAtajos();
  const filas = useMemo(
    () => filasConsola(comandos, efectivosDe(comandos, prefs.atajos).porId, prefs.consola),
    [comandos, prefs.atajos, prefs.consola],
  );
  const titulo = (id: string) => {
    const c = comandos.find((x) => x.id === id);
    return c ? (resolverTexto(c.titulo) ?? id) : id;
  };
  return (
    <section className={styles.grupo} aria-labelledby="atajos-consola">
      <h4 id="atajos-consola" className={styles.grupoTitulo}>
        Teclas que salen de una consola
      </h4>
      <p className={settings.hint}>
        Con el foco en una consola, la shell recibe casi todas las teclas. Las marcadas llegan a Mycelium y la shell
        ya no las recibe (por ejemplo, Ctrl+P es «comando anterior» en bash). F6 y las pistas (F10) siempre salen.
      </p>
      <ul className={styles.lista}>
        {filas.map((f) => (
          <li key={f.clave} className={`${styles.fila} mic-ajustes-atajos-consola`} data-clave={f.clave}>
            <label className={styles.cabeceraFila}>
              <span className={styles.nombre}>{titulo(f.id)}</span>
              <span className={styles.atajos}>
                <TeclasAtajo atajo={f.atajo} />
                <input
                  type="checkbox"
                  className={styles.casilla}
                  checked={f.sale}
                  disabled={f.fija}
                  aria-label={`${textoAtajo(f.atajo)} sale de la consola: ${titulo(f.id)}`}
                  onChange={(e) => {
                    const siguiente = { ...prefs.consola };
                    if (e.target.checked === f.porDefecto) delete siguiente[f.clave];
                    else siguiente[f.clave] = e.target.checked;
                    guardarPrefsConsola(siguiente);
                  }}
                />
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
