"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { type User, useAuthStore } from "@/stores/authStore";
import styles from "./Settings.module.css";

/** Redimensiona una imagen a un cuadrado máx. 256px y devuelve un data URL. */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(256, img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      const side = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Sección Cuenta: perfil, contraseña y sesiones (HU-34). */
export function AccountSection({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const fileRef = useRef<HTMLInputElement>(null);
  const [nombre, setNombre] = useState(user?.nombre ?? "");
  const [perfilMsg, setPerfilMsg] = useState<string | null>(null);

  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const token = () => useAuthStore.getState().accessToken;

  const saveProfile = async (avatarUrl?: string | null) => {
    try {
      const updated = await api<User>("/auth/perfil", {
        method: "PATCH",
        token: token(),
        body: { nombre: nombre.trim(), avatarUrl: avatarUrl ?? user?.avatarUrl ?? null },
      });
      setUser(updated);
      setPerfilMsg("Perfil actualizado.");
      setTimeout(() => setPerfilMsg(null), 1500);
    } catch {
      setPerfilMsg("No se pudo guardar el perfil.");
    }
  };

  const onPickAvatar = async (file: File) => {
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await saveProfile(dataUrl);
    } catch {
      setPerfilMsg("No se pudo procesar la imagen.");
    }
  };

  const changePassword = async () => {
    setPwdMsg(null);
    try {
      const res = await api<{ message: string }>("/auth/cambiar-password", {
        method: "POST",
        token: token(),
        body: { actual, nueva },
      });
      setActual("");
      setNueva("");
      setPwdMsg({ ok: true, text: res.message });
    } catch (e) {
      setPwdMsg({ ok: false, text: (e as Error).message });
    }
  };

  const logoutAll = async () => {
    await api("/auth/cerrar-todo", { method: "POST", token: token() }).catch(() => undefined);
    await logout();
    onClose();
    router.replace("/login");
  };

  const inicial = (user?.nombre ?? "?").charAt(0).toUpperCase();

  return (
    <div>
      <div className={styles.avatarRow}>
        {user?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="Avatar" className={styles.avatar} />
        ) : (
          <span className={`${styles.avatar} ${styles.avatarFallback}`}>{inicial}</span>
        )}
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => fileRef.current?.click()}
        >
          Cambiar avatar
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPickAvatar(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="acc-email">Email</label>
        <input id="acc-email" className={styles.input} value={user?.email ?? ""} disabled />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="acc-nombre">Nombre visible</label>
        <input
          id="acc-nombre"
          className={styles.input}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>
      <div className={styles.btnRow}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!nombre.trim() || nombre.trim() === user?.nombre}
          onClick={() => void saveProfile()}
        >
          Guardar perfil
        </button>
      </div>
      {perfilMsg && <p className={styles.feedback}>{perfilMsg}</p>}

      <div className={styles.field} style={{ marginTop: "1rem" }}>
        <label className={styles.label} htmlFor="acc-actual">Contraseña actual</label>
        <input
          id="acc-actual"
          type="password"
          className={styles.input}
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="acc-nueva">Nueva contraseña</label>
        <input
          id="acc-nueva"
          type="password"
          className={styles.input}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div className={styles.btnRow}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!actual || nueva.length < 8}
          onClick={() => void changePassword()}
        >
          Cambiar contraseña
        </button>
      </div>
      {pwdMsg && <p className={pwdMsg.ok ? styles.feedback : styles.error}>{pwdMsg.text}</p>}

      <div className={styles.btnRow} style={{ marginTop: "1rem" }}>
        <button type="button" className={styles.secondaryBtn} onClick={() => void logoutAll()}>
          Cerrar sesión en todos los dispositivos
        </button>
      </div>
    </div>
  );
}
