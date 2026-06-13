"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { setPendingMatch } from "@/lib/editor/pendingMatch";
import { firstSearchTerm, fragmentToHtml, folderPath } from "@/lib/search";
import { useAuthStore } from "@/stores/authStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import styles from "./SearchPanel.module.css";

type Resultado = {
  nota_id: string;
  titulo: string;
  carpeta_id: string | null;
  fragmento: string;
};

const DEBOUNCE_MS = 200;

/**
 * Panel de búsqueda full-text del vault (HU-21). Reemplaza el explorer en el
 * panel izquierdo, recibe el foco al abrir, busca con debounce vía FTS5 y al
 * hacer clic abre la nota posicionando el cursor en la primera coincidencia.
 */
export function SearchPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);

  const carpetas = useVaultStore((s) => s.carpetas);
  const vaultId = useVaultStore((s) => s.vaultId);

  // Foco automático al activar la búsqueda (CA2)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Búsqueda con debounce (CA3, CA6, CA7)
  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResultados([]);
      setBuscado(false);
      return;
    }
    const handle = setTimeout(async () => {
      if (!vaultId) return;
      setLoading(true);
      try {
        const data = await api<{ resultados: Resultado[] }>(
          `/vaults/${vaultId}/buscar?q=${encodeURIComponent(term)}`,
          { token: useAuthStore.getState().accessToken },
        );
        setResultados(data.resultados);
      } catch {
        setResultados([]);
      } finally {
        setLoading(false);
        setBuscado(true);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, vaultId]);

  const restoreExplorer = () => {
    usePanelLayoutStore.getState().toggleSection("explorer");
  };

  const openResult = (notaId: string) => {
    const term = firstSearchTerm(query);
    setPendingMatch(notaId, term);
    useTabsStore.getState().openNote(notaId);
    router.push(`/workspace?note=${notaId}`);
    // Si la nota ya estaba abierta, el editor montado salta a la coincidencia.
    window.dispatchEvent(
      new CustomEvent("micelio:goto-match", { detail: { notaId, term } }),
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query.length > 0) {
        setQuery("");
      } else {
        restoreExplorer(); // CA9
      }
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.field}>
        <Search size={15} aria-hidden className={styles.fieldIcon} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscar en el vault…"
          className={styles.input}
          aria-label="Buscar en el vault"
        />
        {query.length > 0 && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Limpiar búsqueda"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      <p className={styles.hint}>
        AND implícito · <code>&quot;frase exacta&quot;</code> ·{" "}
        <code>tag:nombre</code>
      </p>

      {loading && resultados.length === 0 && (
        <p className={styles.status}>Buscando…</p>
      )}

      {buscado && !loading && resultados.length === 0 && (
        <p className={styles.status}>
          Sin resultados para «{query.trim()}».
          <br />
          Probá con otros términos o una frase entre comillas.
        </p>
      )}

      <ul className={styles.results}>
        {resultados.map((r) => {
          const ruta = folderPath(r.carpeta_id, carpetas);
          return (
            <li key={r.nota_id}>
              <button
                type="button"
                className={styles.result}
                onClick={() => openResult(r.nota_id)}
              >
                <span className={styles.resultTitle}>{r.titulo}</span>
                {ruta && <span className={styles.resultPath}>{ruta}</span>}
                <span
                  className={styles.resultFragment}
                  dangerouslySetInnerHTML={{ __html: fragmentToHtml(r.fragmento) }}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
