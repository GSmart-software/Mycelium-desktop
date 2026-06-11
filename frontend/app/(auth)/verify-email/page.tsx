"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";
import styles from "../auth.module.css";

function VerifyEmail() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<"verificando" | "ok" | "error">("verificando");
  const [message, setMessage] = useState("Verificando tu email…");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Falta el token de verificación en el link.");
      return;
    }

    api<{ message: string }>("/auth/verify-email", {
      method: "POST",
      body: { token },
    })
      .then((result) => {
        setState("ok");
        setMessage(result.message);
      })
      .catch((err: Error) => {
        setState("error");
        setMessage(err.message);
      });
  }, [token]);

  return (
    <div className={styles.form}>
      <h2 className={styles.title}>Verificación de email</h2>
      <p className={state === "error" ? styles.error : styles.success}>{message}</p>
      {state !== "verificando" && (
        <div className={styles.links}>
          <Link href="/login">Ir a iniciar sesión</Link>
        </div>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
