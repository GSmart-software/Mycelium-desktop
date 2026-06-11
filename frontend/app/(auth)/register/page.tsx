"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import styles from "../auth.module.css";

export default function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < 8;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return;
    setError(null);
    setBusy(true);
    try {
      const message = await register(email, password, nombre);
      setSuccess(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la cuenta.");
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
      <h2 className={styles.title}>Crear cuenta</h2>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="nombre">Nombre</label>
        <input
          id="nombre"
          className={styles.input}
          autoComplete="name"
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>

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

      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">Contraseña</label>
        <input
          id="password"
          className={styles.input}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-hint"
        />
        <p
          id="password-hint"
          className={passwordTooShort ? styles.hintError : styles.hint}
        >
          {passwordTooShort
            ? `Faltan ${8 - password.length} caracteres (mínimo 8).`
            : "Mínimo 8 caracteres."}
        </p>
      </div>

      <button className={styles.submit} type="submit" disabled={busy || passwordTooShort}>
        {busy ? "Creando cuenta…" : "Crear cuenta"}
      </button>

      <div className={styles.links}>
        <span>
          ¿Ya tenés cuenta? <Link href="/login">Iniciá sesión</Link>
        </span>
      </div>
    </form>
  );
}
