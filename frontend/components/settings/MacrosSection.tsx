"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AtajosSection } from "@/components/settings/AtajosSection";
import { ejecutarMacroPorId, alternarGrabacion, esperarCuadros } from "@/lib/comandos/comandosMacros";
import {
  MACROS_DE_FABRICA,
  TIPOS_DE_PASO,
  copiarMacro,
  idDeComandoMacro,
  idMacroDeComando,
  idParaNombre,
  igualQueDeFabrica,
  limitarEspera,
  llamadaCreaCiclo,
  moverPaso,
  nombreLibre,
  pasoNuevo,
  restaurarDeFabrica,
  validarMacro,
  ESPERA_MAXIMA_MS,
  MAX_PASOS,
  type Macro,
  type Paso,
  type TipoPaso,
} from "@/lib/comandos/macros";
import { guardarSobreescrituras, usePreferenciasAtajos } from "@/lib/comandos/preferenciasAtajos";
import { guardarMacros, olvidarGrabada, useMacros } from "@/lib/comandos/preferenciasMacros";
import { atajosDe, resolverTexto, type Comando } from "@/lib/comandos/registro";
import { useComandos } from "@/lib/comandos/useComandos";
import { textoAtajoVisible, useDistribucion } from "@/lib/comandos/distribucion";
import { listarEsporas } from "@/lib/esporasVault";
import { comandosDisponibles } from "@/lib/modoDev";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useVaultStore } from "@/stores/vaultStore";
import settings from "./Settings.module.css";
import styles from "./MacrosSection.module.css";

/** Sin tildes ni mayúsculas, para los buscadores. */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const nombreTipo = (t: TipoPaso) => TIPOS_DE_PASO.find((x) => x.tipo === t)?.nombre ?? t;

/**
 * Configuración → Macros (`FUN-XL-04`, Parte 6): las macros del usuario —las
 * mismas en todos los vaults— con un buscador. Cada una se despliega para
 * editarla: el nombre, el atajo (el mismo grabador de «Atajos de teclado», con
 * sus conflictos y reservadas), los pasos —agregar, editar, reordenar con
 * botones o con **Ctrl+↑/↓**, quitar— y «Probar». Arriba, crear, grabar y
 * restaurar las de fábrica; y, si se acaba de grabar, la grabación para
 * guardarla o descartarla.
 *
 * Todo se opera con el teclado: botones, campos y un selector de comandos con
 * buscador (flechas, Enter, Esc).
 */
export function MacrosSection() {
  const { macros, descartes, grabada, grabacion } = useMacros();
  const prefs = usePreferenciasAtajos();
  const comandos = useComandos();
  const [consulta, setConsulta] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const seccionRef = useRef<HTMLDivElement>(null);
  /** A qué elemento llevar el foco tras el próximo pintado (un selector CSS dentro de la sección). */
  const focoPendienteRef = useRef<string | null>(null);
  const setFocoPendiente = (selector: string) => {
    focoPendienteRef.current = selector;
  };

  // Tras cada pintado: si quedó un foco pendiente (lo nuevo ya está en el DOM), se pone.
  useEffect(() => {
    const selector = focoPendienteRef.current;
    if (!selector) return;
    focoPendienteRef.current = null;
    seccionRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const visibles = useMemo(() => {
    const q = normalizar(consulta.trim());
    return q ? macros.filter((m) => normalizar(m.nombre).includes(q)) : macros;
  }, [macros, consulta]);

  /** Reemplaza una macro (por id) y guarda todas. */
  const actualizar = (m: Macro) => guardarMacros(macros.map((x) => (x.id === m.id ? m : x)));

  const crear = (nombre: string, pasos: Paso[] = []) => {
    const libre = nombreLibre(nombre, macros);
    const m: Macro = { id: idParaNombre(libre, macros.map((x) => x.id)), nombre: libre, pasos };
    guardarMacros([...macros, m]);
    setAbierta(m.id);
    setConsulta("");
    setFocoPendiente(`[data-macro="${CSS.escape(m.id)}"] input[data-campo="nombre"]`);
    return m;
  };

  const duplicar = (m: Macro) => {
    const libre = nombreLibre(`${m.nombre} (copia)`, macros);
    const copia: Macro = { ...copiarMacro(m), id: idParaNombre(libre, macros.map((x) => x.id)), nombre: libre };
    const i = macros.findIndex((x) => x.id === m.id);
    guardarMacros([...macros.slice(0, i + 1), copia, ...macros.slice(i + 1)]);
    setAbierta(copia.id);
    setFocoPendiente(`[data-macro="${CSS.escape(copia.id)}"] input[data-campo="nombre"]`);
  };

  const borrar = (m: Macro) => {
    if (!window.confirm(`¿Borrar la macro «${m.nombre}»?`)) return;
    const i = macros.findIndex((x) => x.id === m.id);
    const quedan = macros.filter((x) => x.id !== m.id);
    // Los pasos de otras macros que la llamaban fallarían: se quitan.
    const limpias = quedan.map((x) => ({
      ...x,
      pasos: x.pasos.filter((p) => !(p.tipo === "comando" && p.comando === idDeComandoMacro(m.id))),
    }));
    guardarMacros(limpias);
    // Su atajo se va con ella.
    const id = idDeComandoMacro(m.id);
    if (id in prefs.atajos) {
      const resto = { ...prefs.atajos };
      delete resto[id];
      guardarSobreescrituras(resto);
    }
    setAbierta(null);
    const vecina = limpias[Math.min(i, limpias.length - 1)];
    setFocoPendiente(vecina ? `[data-macro="${CSS.escape(vecina.id)}"] button[data-campo="cabecera"]` : "button[data-campo='nueva']");
  };

  const guardarGrabada = () => {
    if (!grabada) return;
    crear("Macro grabada", [...grabada]);
    olvidarGrabada();
  };

  const deFabricaCambiadas = MACROS_DE_FABRICA.some((f) => {
    const m = macros.find((x) => x.id === f.id);
    return !m || !igualQueDeFabrica(m);
  });

  return (
    <div ref={seccionRef} className={`${styles.seccion} mic-ajustes-macros`}>
      <div className={settings.field}>
        <span className={settings.label}>Macros</span>
        <p className={settings.hint}>
          Una macro es una lista de pasos —comandos, texto para insertar, notas para abrir— que se ejecuta desde la
          paleta o con su atajo. Son tuyas: valen en todos los vaults.
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
            placeholder="Buscar una macro…"
            aria-label="Buscar una macro"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className={settings.primaryBtn} data-campo="nueva" onClick={() => crear("Macro nueva")}>
            Nueva macro
          </button>
        </div>
        <div className={settings.btnRow}>
          <button
            type="button"
            className={settings.secondaryBtn}
            onClick={() => {
              // Se graba en la app, no aquí: Configuración se cierra.
              if (!grabacion) useUiStore.getState().setSettingsOpen(false);
              alternarGrabacion();
            }}
          >
            {grabacion ? "Detener la grabación" : "Grabar una macro"}
          </button>
          <button
            type="button"
            className={settings.secondaryBtn}
            disabled={!deFabricaCambiadas}
            onClick={() => guardarMacros(restaurarDeFabrica(macros))}
            title="Vuelve a poner las macros de fábrica como venían; las tuyas no se tocan"
          >
            Restaurar las macros de fábrica
          </button>
        </div>
      </div>

      {descartes.length > 0 && (
        <div className={settings.warn} role="status">
          {descartes.map((d) => (
            <p key={d} className={styles.aviso}>
              {d}
            </p>
          ))}
        </div>
      )}

      {grabada && (
        <div className={`${styles.grabada} mic-ajustes-macros-grabada`} role="group" aria-label="Lo grabado">
          <p className={styles.aviso}>
            Grabaste {grabada.length === 1 ? "un paso" : `${grabada.length} pasos`}:
          </p>
          <ol className={styles.resumen}>
            {grabada.map((p, i) => (
              <li key={i}>{describirPaso(p, comandos, macros)}</li>
            ))}
          </ol>
          <div className={settings.btnRow}>
            <button type="button" className={settings.primaryBtn} autoFocus onClick={guardarGrabada}>
              Guardar como macro
            </button>
            <button type="button" className={settings.secondaryBtn} onClick={olvidarGrabada}>
              Descartar
            </button>
          </div>
        </div>
      )}

      {visibles.length === 0 && (
        <p className={settings.hint}>
          {consulta.trim() ? `Ninguna macro se llama así («${consulta.trim()}»).` : "No tienes macros."}
        </p>
      )}

      <ul className={styles.lista}>
        {visibles.map((m) => (
          <FilaMacro
            key={m.id}
            macro={m}
            macros={macros}
            comandos={comandos}
            abierta={abierta === m.id}
            alternar={() => setAbierta(abierta === m.id ? null : m.id)}
            actualizar={actualizar}
            duplicar={() => duplicar(m)}
            borrar={() => borrar(m)}
            enfocar={setFocoPendiente}
          />
        ))}
      </ul>
    </div>
  );
}

/** Un paso en palabras, para el resumen de lo grabado y la cabecera de cada paso. */
function describirPaso(p: Paso, comandos: readonly Comando[], macros: readonly Macro[]): string {
  switch (p.tipo) {
    case "comando": {
      const idMacro = idMacroDeComando(p.comando);
      if (idMacro !== null) return `Macro: ${macros.find((m) => m.id === idMacro)?.nombre ?? idMacro}`;
      const c = comandos.find((x) => x.id === p.comando);
      return c ? (resolverTexto(c.titulo) ?? p.comando) : p.comando || "(sin elegir)";
    }
    case "texto":
      return `Insertar «${p.texto.length > 40 ? `${p.texto.slice(0, 40)}…` : p.texto}»`;
    case "abrir":
      return `${p.crear ? "Abrir o crear" : "Abrir"} «${p.nota}»`;
    case "espora":
      return `Crear desde la Espora «${p.espora}»${p.carpeta ? ` en «${p.carpeta}»` : ""}`;
    case "esperar":
      return `Esperar ${p.ms} ms`;
  }
}

function FilaMacro({
  macro,
  macros,
  comandos,
  abierta,
  alternar,
  actualizar,
  duplicar,
  borrar,
  enfocar,
}: {
  macro: Macro;
  macros: readonly Macro[];
  comandos: readonly Comando[];
  abierta: boolean;
  alternar: () => void;
  actualizar: (m: Macro) => void;
  duplicar: () => void;
  borrar: () => void;
  enfocar: (selector: string) => void;
}) {
  const router = useRouter();
  const dev = useUpdaterStore((s) => s.estado?.dev ?? false);
  // Vuelve a pintar el atajo si cambia la distribución del teclado.
  useDistribucion();
  /** El nombre mientras se edita; `null` = el guardado. */
  const [editado, setNombre] = useState<string | null>(null);
  const nombre = editado ?? macro.nombre;
  const [tipoNuevo, setTipoNuevo] = useState<TipoPaso>("comando");
  const [aviso, setAviso] = useState<string | null>(null);
  const idCuerpo = useId();

  const sel = `[data-macro="${CSS.escape(macro.id)}"]`;
  const comando = comandos.find((c) => c.id === idDeComandoMacro(macro.id));
  const atajo = comando ? atajosDe(comando, comandos)[0] : undefined;
  const existe = (id: string) => comandosDisponibles(comandos, dev).some((c) => c.id === id);
  const problemas = validarMacro(macro, { existe, macros });
  const deFabrica = MACROS_DE_FABRICA.find((f) => f.id === macro.id);

  const renombrar = () => {
    const limpio = nombre.trim();
    setNombre(null);
    if (limpio && limpio !== macro.nombre) actualizar({ ...macro, nombre: limpio });
  };

  const fijarPasos = (pasos: Paso[]) => actualizar({ ...macro, pasos });
  const fijarPaso = (i: number, p: Paso) => fijarPasos(macro.pasos.map((x, j) => (j === i ? p : x)));
  const mover = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= macro.pasos.length) return;
    fijarPasos(moverPaso(macro.pasos, i, delta));
    enfocar(`${sel} [data-paso="${j}"]`);
  };

  const agregar = () => {
    if (macro.pasos.length >= MAX_PASOS) {
      setAviso(`Una macro tiene como máximo ${MAX_PASOS} pasos.`);
      return;
    }
    setAviso(null);
    fijarPasos([...macro.pasos, pasoNuevo(tipoNuevo)]);
    const i = macro.pasos.length;
    // El foco va al primer campo del paso nuevo (en un comando, el buscador).
    enfocar(`${sel} [data-paso="${i}"] input, ${sel} [data-paso="${i}"] textarea`);
  };

  const probar = () => {
    // Se prueba sobre la app: Configuración se cierra y la macro corre un momento después.
    useUiStore.getState().setSettingsOpen(false);
    void esperarCuadros(2).then(() =>
      ejecutarMacroPorId(macro.id, { navegar: (url) => router.replace(url), dev }),
    );
  };

  return (
    <li className={`${styles.fila} mic-ajustes-macros-fila`} data-macro={macro.id}>
      <button
        type="button"
        className={styles.cabecera}
        data-campo="cabecera"
        aria-expanded={abierta}
        aria-controls={idCuerpo}
        onClick={alternar}
      >
        {abierta ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className={styles.nombre}>{macro.nombre}</span>
        <span className={styles.detalle}>
          {macro.pasos.length === 1 ? "1 paso" : `${macro.pasos.length} pasos`}
          {atajo ? ` · ${textoAtajoVisible(atajo)}` : ""}
          {problemas.length > 0 ? " · revisar" : ""}
        </span>
      </button>

      {abierta && (
        <div id={idCuerpo} className={styles.cuerpo}>
          <label className={styles.campo}>
            <span className={styles.rotulo}>Nombre</span>
            <input
              className={settings.input}
              data-campo="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onBlur={renombrar}
              onKeyDown={(e) => {
                if (e.key === "Enter") renombrar();
                if (e.key === "Escape" && editado !== null) {
                  e.stopPropagation();
                  setNombre(null);
                }
              }}
              spellCheck={false}
            />
          </label>

          <div className={settings.btnRow}>
            <button type="button" className={settings.secondaryBtn} onClick={probar} disabled={macro.pasos.length === 0}>
              <Play size={13} aria-hidden /> Probar
            </button>
            <button type="button" className={settings.secondaryBtn} onClick={duplicar}>
              <Copy size={13} aria-hidden /> Duplicar
            </button>
            {deFabrica && !igualQueDeFabrica(macro) && (
              <button
                type="button"
                className={settings.secondaryBtn}
                onClick={() => actualizar(copiarMacro(deFabrica))}
              >
                <RotateCcw size={13} aria-hidden /> Restaurar
              </button>
            )}
            <button type="button" className={settings.secondaryBtn} onClick={borrar}>
              <Trash2 size={13} aria-hidden /> Borrar
            </button>
          </div>

          <div className={styles.campo}>
            <span className={styles.rotulo}>Atajo</span>
            <AtajosSection soloComando={idDeComandoMacro(macro.id)} />
          </div>

          {problemas.length > 0 && (
            <div className={settings.warn} role="status">
              {problemas.map((p) => (
                <p key={p} className={styles.aviso}>
                  {p}
                </p>
              ))}
            </div>
          )}

          <div className={styles.campo}>
            <span className={styles.rotulo}>Pasos</span>
            <p className={settings.hint}>
              Se ejecutan en orden; si uno falla, la macro se detiene y te avisa cuál. <strong>Ctrl+↑</strong> y{" "}
              <strong>Ctrl+↓</strong> mueven el paso donde estás. En los textos puedes usar{" "}
              <code>{"{{fecha}}"}</code>, <code>{"{{hora}}"}</code>, <code>{"{{fecha:DD/MM/AAAA}}"}</code> y{" "}
              <code>{"{{titulo}}"}</code>.
            </p>
            <ol className={styles.pasos}>
              {macro.pasos.map((p, i) => (
                <li
                  key={i}
                  className={`${styles.paso} mic-ajustes-macros-paso`}
                  data-paso={i}
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    // Ctrl+↑/↓ mueve el paso (Ctrl para moverse, como en el resto
                    // de Mycelium desde el 2026-11-06; antes era Alt+↑/↓).
                    if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    e.stopPropagation();
                    mover(i, e.key === "ArrowUp" ? -1 : 1);
                  }}
                >
                  <div className={styles.pasoCabecera}>
                    <span className={styles.numero}>{i + 1}.</span>
                    <span className={styles.pasoTipo}>{nombreTipo(p.tipo)}</span>
                    <span className={styles.acciones}>
                      <button
                        type="button"
                        className={styles.icono}
                        disabled={i === 0}
                        onClick={() => mover(i, -1)}
                        aria-label={`Subir el paso ${i + 1}`}
                        title="Subir (Ctrl+↑)"
                      >
                        <ArrowUp size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.icono}
                        disabled={i === macro.pasos.length - 1}
                        onClick={() => mover(i, 1)}
                        aria-label={`Bajar el paso ${i + 1}`}
                        title="Bajar (Ctrl+↓)"
                      >
                        <ArrowDown size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.icono}
                        onClick={() => {
                          fijarPasos(macro.pasos.filter((_, j) => j !== i));
                          const quedan = macro.pasos.length - 1;
                          enfocar(quedan > 0 ? `${sel} [data-paso="${Math.min(i, quedan - 1)}"]` : `${sel} select[data-campo="tipo"]`);
                        }}
                        aria-label={`Quitar el paso ${i + 1}`}
                        title="Quitar el paso"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </span>
                  </div>
                  <EditorPaso
                    paso={p}
                    indice={i}
                    macro={macro}
                    macros={macros}
                    comandos={comandos}
                    cambiar={(q) => fijarPaso(i, q)}
                  />
                </li>
              ))}
            </ol>
            <div className={styles.agregar}>
              <select
                className={`${settings.select} ${styles.selectTipo}`}
                data-campo="tipo"
                value={tipoNuevo}
                onChange={(e) => setTipoNuevo(e.target.value as TipoPaso)}
                aria-label="Tipo del paso nuevo"
              >
                {TIPOS_DE_PASO.map((t) => (
                  <option key={t.tipo} value={t.tipo}>
                    {t.nombre}
                  </option>
                ))}
              </select>
              <button type="button" className={settings.secondaryBtn} onClick={agregar}>
                Agregar paso
              </button>
            </div>
            {aviso && (
              <p className={settings.error} role="alert">
                {aviso}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Los campos de un paso, según su tipo. */
function EditorPaso({
  paso,
  indice,
  macro,
  macros,
  comandos,
  cambiar,
}: {
  paso: Paso;
  indice: number;
  macro: Macro;
  macros: readonly Macro[];
  comandos: readonly Comando[];
  cambiar: (p: Paso) => void;
}) {
  const notas = useVaultStore((s) => s.notas);
  const esporas = useMemo(() => listarEsporas(notas), [notas]);
  const idEsporas = useId();
  const n = indice + 1;
  switch (paso.tipo) {
    case "comando":
      return (
        <SelectorComando
          valor={paso.comando}
          macro={macro}
          macros={macros}
          comandos={comandos}
          etiqueta={`Comando del paso ${n}`}
          elegir={(id) => cambiar({ tipo: "comando", comando: id })}
        />
      );
    case "texto":
      return (
        <textarea
          className={`${settings.input} ${styles.texto}`}
          value={paso.texto}
          onChange={(e) => cambiar({ ...paso, texto: e.target.value })}
          placeholder="El texto que se escribe donde está el cursor"
          aria-label={`Texto del paso ${n}`}
          rows={3}
          spellCheck={false}
        />
      );
    case "abrir":
      return (
        <div className={styles.campos}>
          <input
            className={settings.input}
            value={paso.nota}
            onChange={(e) => cambiar({ ...paso, nota: e.target.value })}
            placeholder="Título o ruta, como en un [[enlace]]: Diario/{{fecha}}"
            aria-label={`Nota del paso ${n}`}
            spellCheck={false}
          />
          <label className={styles.casillaFila}>
            <input
              type="checkbox"
              className={styles.casilla}
              checked={!!paso.crear}
              onChange={(e) => {
                const q = { ...paso };
                if (e.target.checked) q.crear = true;
                else delete q.crear;
                cambiar(q);
              }}
            />
            Crearla si no existe
          </label>
          {paso.crear && (
            <textarea
              className={`${settings.input} ${styles.texto}`}
              value={paso.contenido ?? ""}
              onChange={(e) => {
                const q = { ...paso };
                if (e.target.value) q.contenido = e.target.value;
                else delete q.contenido;
                cambiar(q);
              }}
              placeholder="Contenido de la nota nueva (opcional): # {{titulo}}"
              aria-label={`Contenido de la nota nueva del paso ${n}`}
              rows={2}
              spellCheck={false}
            />
          )}
        </div>
      );
    case "espora":
      return (
        <div className={styles.campos}>
          <input
            className={settings.input}
            value={paso.espora}
            list={idEsporas}
            onChange={(e) => cambiar({ ...paso, espora: e.target.value })}
            placeholder="El nombre de la Espora"
            aria-label={`Espora del paso ${n}`}
            spellCheck={false}
          />
          <datalist id={idEsporas}>
            {esporas.map((e) => (
              <option key={e.id} value={e.titulo} />
            ))}
          </datalist>
          <input
            className={settings.input}
            value={paso.carpeta ?? ""}
            onChange={(e) => {
              const q = { ...paso };
              if (e.target.value) q.carpeta = e.target.value;
              else delete q.carpeta;
              cambiar(q);
            }}
            placeholder="Carpeta (vacía: la seleccionada en el explorador)"
            aria-label={`Carpeta del paso ${n}`}
            spellCheck={false}
          />
        </div>
      );
    case "esperar":
      return (
        <label className={styles.casillaFila}>
          <input
            type="number"
            className={`${settings.input} ${styles.numeroMs}`}
            min={0}
            max={ESPERA_MAXIMA_MS}
            step={100}
            value={paso.ms}
            onChange={(e) => cambiar({ ...paso, ms: limitarEspera(Number(e.target.value) || 0) })}
            aria-label={`Milisegundos del paso ${n}`}
          />
          milisegundos (hasta {ESPERA_MAXIMA_MS / 1000} segundos)
        </label>
      );
  }
}

/**
 * El selector de comando de un paso: un campo con buscador sobre el catálogo
 * —los comandos y las otras macros— y la lista debajo (patrón combobox: el
 * foco queda en el campo, ↑/↓ recorren, Enter elige, Esc vuelve al elegido).
 * Las macros que armarían un ciclo no se ofrecen.
 */
function SelectorComando({
  valor,
  macro,
  macros,
  comandos,
  etiqueta,
  elegir,
}: {
  valor: string;
  macro: Macro;
  macros: readonly Macro[];
  comandos: readonly Comando[];
  etiqueta: string;
  elegir: (id: string) => void;
}) {
  const dev = useUpdaterStore((s) => s.estado?.dev ?? false);
  const tituloDe = (id: string) => {
    const idMacro = idMacroDeComando(id);
    if (idMacro !== null) return `Macro: ${macros.find((m) => m.id === idMacro)?.nombre ?? idMacro}`;
    const c = comandos.find((x) => x.id === id);
    return c ? (resolverTexto(c.titulo) ?? id) : id;
  };
  /** Lo escrito en el buscador; `null` = el título del comando elegido. */
  const [escrito, setTexto] = useState<string | null>(null);
  const texto = escrito ?? (valor ? tituloDe(valor) : "");
  const [abierto, setAbierto] = useState(!valor);
  const [activa, setActiva] = useState(0);
  const idLista = useId();

  const opciones = useMemo(() => {
    const lista: { id: string; titulo: string }[] = [];
    for (const c of comandosDisponibles(comandos, dev)) {
      if (c.requiereArgs || c.id === "macros.grabar") continue;
      const idMacro = idMacroDeComando(c.id);
      if (idMacro !== null && llamadaCreaCiclo(macro.id, idMacro, macros)) continue;
      lista.push({ id: c.id, titulo: resolverTexto(c.titulo) ?? c.id });
    }
    const q = normalizar(texto.trim());
    if (!q || escrito === null) return lista;
    return lista.filter((o) => normalizar(o.titulo).includes(q) || o.id.includes(q));
  }, [comandos, dev, macro.id, macros, texto, escrito]);

  const confirmar = (i: number) => {
    const o = opciones[i];
    if (!o) return;
    elegir(o.id);
    setTexto(null);
    setAbierto(false);
  };

  return (
    <div className={styles.selector}>
      <input
        className={settings.input}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setActiva(0);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => {
          setAbierto(false);
          setTexto(null);
        }}
        onKeyDown={(e) => {
          if (e.ctrlKey) return; // Ctrl+↑/↓ mueve el paso.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!abierto) return setAbierto(true);
            if (!opciones.length) return;
            setActiva((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + opciones.length) % opciones.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (abierto) confirmar(activa);
            else setAbierto(true);
          } else if (e.key === "Escape" && abierto) {
            e.stopPropagation();
            setAbierto(false);
            setTexto(null);
          }
        }}
        placeholder="Busca un comando…"
        role="combobox"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={abierto && opciones.length ? `${idLista}-${activa}` : undefined}
        spellCheck={false}
        autoComplete="off"
      />
      {abierto && (
        <ul id={idLista} role="listbox" className={`${styles.opciones} mic-ajustes-macros-opciones`} aria-label="Comandos">
          {opciones.slice(0, 60).map((o, i) => (
            <li
              key={o.id}
              id={`${idLista}-${i}`}
              role="option"
              aria-selected={i === activa}
              className={i === activa ? `${styles.opcion} ${styles.opcionActiva}` : styles.opcion}
              ref={(el) => {
                if (el && i === activa) el.scrollIntoView({ block: "nearest" });
              }}
              // `mousedown` y no `click`: el campo perdería el foco antes.
              onMouseDown={(e) => {
                e.preventDefault();
                confirmar(i);
              }}
            >
              {o.titulo}
            </li>
          ))}
          {opciones.length === 0 && (
            <li className={styles.opcion} role="option" aria-selected="false" aria-disabled="true">
              Ningún comando se llama así.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
