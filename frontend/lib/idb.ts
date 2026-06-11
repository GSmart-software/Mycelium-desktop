/**
 * Cache local de contenido de notas en IndexedDB (HU-04 / HU-19).
 * Clave: ID de la nota. Valor: markdown crudo + metadatos de sync.
 */

export type CachedNote = {
  notaId: string;
  content: string;
  /** Momento del último guardado local (ms epoch). */
  savedAt: number;
  /** true si hay cambios sin sincronizar con el backend. */
  dirty: boolean;
  /** actualizado_en del backend en el último sync exitoso (ISO). */
  remoteUpdatedAt: string | null;
};

const DB_NAME = "micelio";
const STORE = "notas";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "notaId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function getCachedNote(notaId: string): Promise<CachedNote | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(notaId);
    request.onsuccess = () => resolve((request.result as CachedNote) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function putCachedNote(note: CachedNote): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteCachedNote(notaId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(notaId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
