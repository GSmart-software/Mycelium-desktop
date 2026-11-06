import { CapturaFlotante } from "@/components/captura/CapturaFlotante";

/**
 * La ventana flotante de la captura global (`FUN-L-33`, Parte C). La abre
 * Rust con Ctrl+Shift+Espacio cuando Mycelium no tiene el foco
 * (`src-tauri/src/captura_global.rs`); no se navega a ella desde la app.
 */
export default function CapturaPage() {
  return <CapturaFlotante />;
}
