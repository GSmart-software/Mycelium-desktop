"use client";

import {
  Files,
  Search,
  Settings,
  Share2,
  Tag,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { usePanelLayoutStore, type RailSection } from "@/stores/panelLayoutStore";
import { useUiStore } from "@/stores/uiStore";
import styles from "./Rail.module.css";

const TOP_ITEMS: { section: RailSection; icon: LucideIcon; label: string }[] = [
  { section: "explorer", icon: Files, label: "Explorador" },
  { section: "search", icon: Search, label: "Búsqueda global" },
  { section: "graph", icon: Share2, label: "Grafo global" },
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
  const activeSection = usePanelLayoutStore((s) => s.activeSection);
  const toggleSection = usePanelLayoutStore((s) => s.toggleSection);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

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
      <div className={styles.group}>{TOP_ITEMS.map(renderButton)}</div>
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
