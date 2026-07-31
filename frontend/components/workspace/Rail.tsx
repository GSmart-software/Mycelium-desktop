"use client";

import {
  Files,
  Search,
  Settings,
  Share2,
  Tag,
  Terminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { usePanelLayoutStore, type RailSection } from "@/stores/panelLayoutStore";
import { GRAPH_TAB_ID, useTabsStore } from "@/stores/tabsStore";
import { useUiStore } from "@/stores/uiStore";
import styles from "./Rail.module.css";

const TOP_ITEMS: { section: RailSection; icon: LucideIcon; label: string }[] = [
  { section: "explorer", icon: Files, label: "Explorador" },
  { section: "search", icon: Search, label: "Búsqueda global" },
  { section: "tags", icon: Tag, label: "Tags" },
];

const BOTTOM_ITEMS: { section: RailSection; icon: LucideIcon; label: string }[] = [
  { section: "trash", icon: Trash2, label: "Papelera" },
];

/**
 * Rail de íconos persistente (HU-28): dos grupos separados por un spacer,
 * toggle del panel izquierdo, nunca colapsa.
 */
export function Rail() {
  const router = useRouter();
  const activeSection = usePanelLayoutStore((s) => s.activeSection);
  const toggleSection = usePanelLayoutStore((s) => s.toggleSection);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  // El grafo se abre como ventana en el área de panes (estilo Obsidian).
  const openGraph = () => {
    useTabsStore.getState().openNote(GRAPH_TAB_ID);
    router.push(`/workspace?note=${GRAPH_TAB_ID}`);
  };

  const renderButton = ({ section, icon: Icon, label }: (typeof TOP_ITEMS)[number]) => (
    <button
      key={section}
      type="button"
      className={styles.button}
      aria-pressed={activeSection === section}
      aria-label={label}
      title={label}
      onClick={() => toggleSection(section)}
    >
      <Icon size={20} aria-hidden />
    </button>
  );

  return (
    <nav className={styles.rail} aria-label="Navegación principal">
      <div className={styles.group}>
        {TOP_ITEMS.map(renderButton)}
        <button
          type="button"
          className={styles.button}
          aria-label="Grafo de conexiones"
          title="Grafo de conexiones"
          onClick={openGraph}
        >
          <Share2 size={20} aria-hidden />
        </button>
        {/* Panel de consolas (FUN-L-07): crear, reabrir o finalizar shells. */}
        <button
          type="button"
          className={styles.button}
          aria-pressed={activeSection === "terminal"}
          aria-label="Consolas"
          title="Consolas"
          onClick={() => toggleSection("terminal")}
        >
          <Terminal size={20} aria-hidden />
        </button>
      </div>
      <div className={styles.spacer} />
      <div className={styles.group}>
        {BOTTOM_ITEMS.map(renderButton)}
        <button
          type="button"
          className={styles.button}
          aria-label="Configuración"
          title="Configuración"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={20} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
