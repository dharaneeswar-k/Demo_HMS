// Uploaded file binaries are kept in IndexedDB (not in the JSON store) and referenced by attachment id.
const DB_NAME = 'nallam_hms_files';
const STORE = 'blobs';
let dbp = null;
const urlCache = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};

export const saveBlob = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const deleteBlob = (id) => { urlCache.delete(id); return tx('readwrite', (s) => s.delete(id)); };
export const clearAllBlobs = () => { urlCache.clear(); return tx('readwrite', (s) => s.clear()); };
export async function getBlob(id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
/** Resolve a displayable URL for an attachment metadata record. */
export async function attachmentURL(att) {
  if (!att) return null;
  if (att.storage === 'static') return att.src;
  if (urlCache.has(att.id)) return urlCache.get(att.id);
  const blob = await getBlob(att.id).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(att.id, url);
  return url;
}
