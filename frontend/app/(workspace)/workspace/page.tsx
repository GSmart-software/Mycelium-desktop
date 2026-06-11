"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

/**
 * Placeholder del workspace: guard de sesión + datos básicos.
 * El shell completo (AppTopbar, rail, paneles) se construye en la Fase 2
 * (HU-38, HU-28, HU-29, HU-20).
 */
export default function WorkspacePage() {
  const router = useRouter();
  const { user, vaults, initialized, restore, logout } = useAuthStore();

  useEffect(() => {
    if (!initialized) {
      void restore().then((ok) => {
        if (!ok) router.replace("/login");
      });
    } else if (!user) {
      router.replace("/login");
    }
  }, [initialized, user, restore, router]);

  if (!user) {
    return (
      <main style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <p style={{ color: "var(--mic-text-muted)" }}>Cargando…</p>
      </main>
    );
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center", display: "grid", gap: "0.75rem" }}>
        <h1 style={{ color: "var(--mic-accent)" }}>Hola, {user.nombre}</h1>
        <p style={{ color: "var(--mic-text-muted)" }}>
          {vaults.length > 0
            ? `Vault: ${vaults[0].nombre} (${vaults[0].rol})`
            : "Sin vaults"}
        </p>
        <button
          onClick={() => void logout().then(() => router.replace("/login"))}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "var(--mic-radius-md)",
            background: "var(--mic-accent)",
            color: "var(--mic-bg-surface)",
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}
