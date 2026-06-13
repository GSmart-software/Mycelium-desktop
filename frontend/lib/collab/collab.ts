import type { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

type CollabInfo = {
  habilitada: boolean;
  room?: string;
  url?: string | null;
  rol?: string;
  usuario?: { id: string; nombre: string; color: string };
};

export type CollabHandle = { destroy: () => void; readOnly: boolean };

/**
 * Activa la edición colaborativa en tiempo real para una nota (HU-05/06/37).
 * Consulta al backend si hay relay disponible; en modo local viene
 * deshabilitado y devuelve null (la edición sigue por turnos vía HU-04). En
 * modo cloudflare conecta el CRDT Yjs al Durable Object por WebSocket, persiste
 * en IndexedDB y enlaza cursores de presencia con y-codemirror.
 *
 * Las dependencias Yjs se importan dinámicamente: solo se cargan cuando la
 * colaboración está realmente habilitada, sin penalizar el modo local.
 */
export async function startCollab(
  notaId: string,
  view: EditorView,
  compartment: Compartment,
  initialContent: string,
): Promise<CollabHandle | null> {
  let info: CollabInfo;
  try {
    info = await api<CollabInfo>(`/notas/${notaId}/colaboracion`, {
      token: useAuthStore.getState().accessToken,
    });
  } catch {
    return null;
  }
  if (!info.habilitada || !info.url || !info.room) return null;

  const [Y, { WebsocketProvider }, { IndexeddbPersistence }, { yCollab }] =
    await Promise.all([
      import("yjs"),
      import("y-websocket"),
      import("y-indexeddb"),
      import("y-codemirror.next"),
    ]);

  const ydoc = new Y.Doc();
  // Persistencia local del CRDT (HU-05 CA6) + relay del Durable Object (CA3)
  const persistence = new IndexeddbPersistence(`micelio-collab-${notaId}`, ydoc);
  const provider = new WebsocketProvider(info.url, info.room, ydoc);
  const ytext = ydoc.getText("contenido");

  const readOnly = info.rol === "lector"; // HU-37 CA5: lector ve cambios, no edita
  if (info.usuario) {
    provider.awareness.setLocalStateField("user", {
      name: info.usuario.nombre,
      color: info.usuario.color, // color estable por id (HU-06 CA1/CA3)
    });
  }

  // Primera sesión: sembrar el documento con el contenido actual de la nota.
  void persistence.whenSynced.then(() => {
    if (ytext.length === 0 && initialContent.length > 0) {
      ytext.insert(0, initialContent);
    }
  });

  const extension = readOnly
    ? [yCollab(ytext, provider.awareness), EditorView.editable.of(false)]
    : yCollab(ytext, provider.awareness);
  view.dispatch({ effects: compartment.reconfigure(extension) });

  return {
    readOnly,
    destroy: () => {
      try {
        view.dispatch({ effects: compartment.reconfigure([]) });
      } catch {
        // la vista ya pudo destruirse
      }
      provider.destroy();
      void persistence.destroy();
      ydoc.destroy();
    },
  };
}
