"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";
import styles from "../auth.module.css";

function ResetPassword() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8 || password !== confirm) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      setSuccess(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restablecer la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className={styles.form}>
        <p className={styles.success}>{success}</p>
        <div className={styles.links}>
          <Link href="/login">Ir a iniciar sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.title}>Nueva contraseña</h2>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">Contraseña nueva</label>
        <input
          id="password"
          className={styles.input}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {passwordTooShort && (
          <p className={styles.hintError}>Mínimo 8 caracteres.</p>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="confirm">Repetir contraseña</label>
        <input
          id="confirm"
          className={styles.input}
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p className={styles.hintError}>Las contraseñas no coinciden.</p>}
      </div>

      <button
        className={styles.submit}
        type="submit"
        disabled={busy || passwordTooShort || mismatch}
      >
        {busy ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
