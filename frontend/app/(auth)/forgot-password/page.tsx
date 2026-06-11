"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import styles from "../auth.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setMessage(result.message);
    } catch {
      setMessage("Si el email existe, vas a recibir un link para restablecer la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.title}>Recuperar contraseña</h2>

      {message ? (
        <p className={styles.success}>{message}</p>
      ) : (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">Email</label>
          <input
            id="email"
            className={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      )}

      {!message && (
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? "Enviando…" : "Enviar link"}
        </button>
      )}

      <div className={styles.links}>
        <Link href="/login">Volver a iniciar sesión</Link>
      </div>
    </form>
  );
}
