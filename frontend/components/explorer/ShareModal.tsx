"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import styles from "./ShareModal.module.css";

type Miembro = {
  usuario_id: string;
  email: string;
  nombre: string;
  rol: string;
  creado_en: string;
};

const ROLES = ["lector", "editor", "propietario"] as const;

/**
 * Modal de compartición y gestión de miembros de una carpeta (HU-35/36):
 * agregar por email con rol, listar miembros, cambiar rol y revocar.
 */
export function ShareModal() {
  const target = useUiStore((s) => s.shareTarget);
  const close = useUiStore((s) => s.setShareTarget);

  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<string>("editor");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const token = () => useAuthStore.getState().accessToken;

  const load = useCallback(async () => {
    if (!target) return;
    try {
      const data = await api<{ miembros: Miembro[] }>(`/carpetas/${target.id}/miembros`, {
        token: token(),
      });
      setMiembros(data.miembros);
    } catch {
      setMiembros([]);
    }
  }, [target]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!target) return null;

  const compartir = async () => {
    setMsg(null);
    try {
      await api(`/carpetas/${target.id}/compartir`, {
        method: "POST",
        token: token(),
        body: { email: email.trim(), rol },
      });
      setEmail("");
      setMsg({ ok: true, text: "Acceso concedido." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const cambiarRol = async (m: Miembro, nuevoRol: string) => {
    setMsg(null);
    try {
      await api(`/carpetas/${target.id}/miembros/${m.usuario_id}`, {
        method: "PATCH",
        token: token(),
        body: { rol: nuevoRol },
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const revocar = async (m: Miembro) => {
    setMsg(null);
    try {
      await api(`/carpetas/${target.id}/miembros/${m.usuario_id}`, {
        method: "DELETE",
        token: token(),
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className={styles.overlay} onClick={() => close(null)}>
      <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h3 className={styles.title}>Compartir «{target.nombre}»</h3>
          <button type="button" className={styles.close} aria-label="Cerrar" onClick={() => close(null)}>
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className={styles.addRow}>
          <input
            type="email"
            className={styles.input}
            placeholder="email@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void compartir()}
          />
          <select className={styles.select} value={rol} onChange={(e) => setRol(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button type="button" className={styles.primaryBtn} disabled={!email.trim()} onClick={() => void compartir()}>
            Compartir
          </button>
        </div>
        {msg && <p className={msg.ok ? styles.ok : styles.error}>{msg.text}</p>}

        <h4 className={styles.subtitle}>Miembros</h4>
        <ul className={styles.members}>
          {miembros.length === 0 && <li className={styles.empty}>Todavía no compartiste esta carpeta.</li>}
          {miembros.map((m) => (
            <li key={m.usuario_id} className={styles.member}>
              <div className={styles.memberInfo}>
                <span className={styles.memberName}>{m.nombre}</span>
                <span className={styles.memberEmail}>{m.email}</span>
              </div>
              <select
                className={styles.select}
                value={m.rol}
                onChange={(e) => void cambiarRol(m, e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button type="button" className={styles.revoke} onClick={() => void revocar(m)}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
