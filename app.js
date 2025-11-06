/* app.js - Sincronización realtime IndexedDB <-> Firestore
   - Offline-first: IndexedDB + outbox
   - Sincronización automática al volver online
   - Listener realtime para aplicar cambios remotos a IndexedDB
   - Evita eco de cambios usando clientId (auth anon)
*/

/* ========== 1) FIREBASE CONFIG ========== */
/*
  Reemplazá este objeto con el firebaseConfig que te da Firebase Console.
  Ejemplo:
  const firebaseConfig = {
    apiKey: "...",
    authDomain: "project-id.firebaseapp.com",
    projectId: "project-id",
    storageBucket: "project-id.appspot.com",
    messagingSenderId: "...",
    appId: "1:...:web:..."
  };
*/
const firebaseConfig = {
  // <<< PEGAR AQUÍ TU firebaseConfig >>>
};

if (typeof firebase === 'undefined') {
  console.error('Firebase SDK no cargado. Asegurate de incluir los scripts en index.html');
} else {
  firebase.initializeApp(firebaseConfig);
}

// Firestore y Auth (compat)
const firestore = firebase.firestore();
const auth = firebase.auth();

let clientId = null; // uid del cliente (auth anon)

/* Autenticación anónima */
auth.onAuthStateChanged(user => {
  if (user) {
    clientId = user.uid;
    console.log('Firebase auth OK - clientId:', clientId);
  } else {
    auth.signInAnonymously().catch(err => console.warn('Auth anon failed:', err));
  }
});

/* ========== 2) INDEXEDDB (trabajos + outbox) ========== */
const DB_NAME = 'registroDB_v3';
const STORE_TRABAJOS = 'trabajos';
const STORE_OUTBOX = 'outbox';
let db = null;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = e => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORE_TRABAJOS)) {
        _db.createObjectStore(STORE_TRABAJOS, { keyPath: 'id', autoIncrement: true });
      }
      if (!_db.objectStoreNames.contains(STORE_OUTBOX)) {
        _db.createObjectStore(STORE_OUTBOX, { keyPath: 'oid', autoIncrement: true });
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      res(db);
    };
    req.onerror = e => rej(e.target.error);
  });
}

async function ensureDB() {
  if (!db) db = await openDB();
  try {
    db.transaction(STORE_TRABAJOS, 'readonly');
  } catch (err) {
    console.warn('Reopening DB due to closed connection', err);
    db = await openDB();
  }
  return db;
}

/* ========== 3) IndexedDB helpers ========== */
async function addLocal(trabajo) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readwrite');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.add(trabajo);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = e => rej(e.target.error);
  });
}

async function putLocal(trabajo) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readwrite');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.put(trabajo);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = e => rej(e.target.error);
  });
}

async function deleteLocal(id) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readwrite');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.delete(id);
    rq.onsuccess = () => res();
    rq.onerror = e => rej(e.target.error);
  });
}

async function getAllLocal() {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readonly');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = e => rej(e.target.error);
  });
}

/* ========== 4) Outbox helpers ========== */
async function addOutbox(item) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const rq = store.add(item);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = e => rej(e.target.error);
  });
}

async function getOutboxAll() {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const store = tx.objectStore(STORE_OUTBOX);
    const rq = store.getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = e => rej(e.target.error);
  });
}

async function removeOutbox(oid) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const rq = store.delete(oid);
    rq.onsuccess = () => res();
    rq.onerror = e => rej(e.target.error);
  });
}

/* ========== 5) Firestore helpers ========== */
const COLLECTION = 'trabajos';

async function addRemote(trabajo) {
  const docRef = await firestore.collection(COLLECTION).add({
    ...trabajo,
    clientId: clientId || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return docRef.id;
}

async function updateRemote(remoteId, trabajo) {
  await firestore.collection(COLLECTION).doc(remoteId).set({
    ...trabajo,
    clientId: clientId || null,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function deleteRemote(remoteId) {
  await firestore.collection(COLLECTION).doc(remoteId).delete();
}

/* ========== 6) Process outbox (upload pending ops) ========== */
async function processOutbox() {
  if (!navigator.onLine) return;
  try {
    const out = await getOutboxAll();
    for (const item of out) {
      try {
        if (item.op === 'add') {
          // create remote and store remoteId locally
          const remoteId = await addRemote(item.payload);
          // update local record with remoteId
          const localRec = { ...item.payload, remoteId };
          if (item.localId) {
            localRec.id = item.localId;
            await putLocal(localRec);
          } else {
            const newLocalId = await addLocal(localRec);
            localRec.id = newLocalId;
          }
        } else if (item.op === 'update') {
          if (item.payload.remoteId) {
            await updateRemote(item.payload.remoteId, item.payload);
          } else {
            const newRemoteId = await addRemote(item.payload);
            item.payload.remoteId = newRemoteId;
            await putLocal(item.payload);
          }
        } else if (item.op === 'delete') {
          if (item.payload.remoteId) {
            await deleteRemote(item.payload.remoteId);
          }
          if (item.localId) {
            await deleteLocal(item.localId);
          }
        }
        // remove processed item
        await removeOutbox(item.oid);
      } catch (errItem) {
        console.warn('Error procesando item outbox', item, errItem);
        // No eliminar el item si falla; continuar con el siguiente.
      }
    }
  } catch (err) {
    console.error('Error procesando outbox', err);
  }
}

/* Re-procesar al volver online */
window.addEventListener('online', () => {
  console.log('online -> procesando outbox');
  processOutbox().then(() => console.log('outbox procesado'));
});

/* ========== 7) Realtime listener: remote -> local ========== */
/* Evitamos eco verificando clientId (si remote.clientId === clientId -> no aplicar) */

let unsubscribeRealtime = null;

function startRealtimeListener() {
  // Solo iniciar si firestore y auth están listos
  if (!firestore) return;
  // Si ya hay listener, removerlo
  if (unsubscribeRealtime) unsubscribeRealtime();

  unsubscribeRealtime = firestore.collection(COLLECTION)
    .orderBy('createdAt')
    .onSnapshot(async snapshot => {
      // procesar cada cambio
      for (const change of snapshot.docChanges()) {
        const doc = change.doc;
        const data = doc.data();
        const remoteId = doc.id;

        // si el cambio vino de este mismo cliente (mismo clientId) => no aplicar (evita echo)
        if (data && data.clientId && clientId && data.clientId === clientId) {
          continue;
        }

        if (change.type === 'added' || change.type === 'modified') {
          // mapear campos relevantes
          const mapped = {
            remoteId,
            fecha: data.fecha || '',
            cliente: data.cliente || '',
            ubicacion: data.ubicacion || '',
            superficie: data.superficie || '',
            unidad: data.unidad || '',
            insumos: data.insumos || [],
            recomendacion: data.recomendacion || '',
            observaciones: data.observaciones || '',
            createdAt: data.createdAt ? data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now() : Date.now()
          };

          // buscar si ya existe local con este remoteId
          const locals = await getAllLocal();
          const existing = locals.find(l => l.remoteId === remoteId);

          if (existing) {
            // si existe -> actualizar local
            mapped.id = existing.id;
            await putLocal(mapped);
          } else {
            // no existe -> agregar local
            await addLocal(mapped);
          }
        } else if (change.type === 'removed') {
          // si se eliminó remoto, eliminar local que tenga ese remoteId
          const locals = await getAllLocal();
          const ext = locals.find(l => l.remoteId === remoteId);
          if (ext) await deleteLocal(ext.id);
        }
      }
      // finalmente refrescar UI
      renderTrabajos();
    }, err => {
      console.warn('Realtime listener error:', err);
      // reintentar más tarde si falla
    });
}

/* Si auth cambia (clientId aparece), arrancamos listener */
auth.onAuthStateChanged(user => {
  if (user) {
    clientId = user.uid;
    startRealtimeListener();
  }
});

/* ========== 8) UI helpers (conservamos tu estructura) ========== */
const insumosList = document.getElementById('insumosList');
const addInsumoBtn = document.getElementById('addInsumo');
const form = document.getElementById('workForm');
const trabajosDiv = document.getElementById('trabajos');

function createInsumoRow(name = '', litros = '') {
  const div = document.createElement('div');
  div.className = 'insumoRow';
  div.innerHTML = `
    <input placeholder="Producto" class="insumo-nombre" value="${(name||'')}">
    <input placeholder="Litros" class="insumo-litros" type="number" step="0.01" value="${(litros||'')}">
    <button type="button" class="removeInsumo">✖</button>
  `;
  div.querySelector('.removeInsumo').onclick = () => div.remove();
  insumosList.appendChild(div);
}
addInsumoBtn.addEventListener('click', () => createInsumoRow());

function readInsumosUI() {
  const rows = Array.from(document.querySelectorAll('#insumosList .insumoRow'));
  return rows.map(r => ({ producto: r.querySelector('.insumo-nombre').value.trim(), litros: parseFloat(r.querySelector('.insumo-litros').value || 0) })).filter(i => i.producto);
}

/* Render desde IndexedDB */
async function renderTrabajos() {
  const list = await getAllLocal();
  trabajosDiv.innerHTML = '';
  if (!list.length) {
    trabajosDiv.innerHTML = '<p>No hay registros aún.</p>';
    return;
  }
  list.sort((a,b)=> (b.id || 0) - (a.id || 0));
  list.forEach(t => {
    const el = document.createElement('div');
    el.className = 'trabajoCard';
    el.innerHTML = `
      <div><strong>${escapeHtml(t.fecha)}</strong> - ${escapeHtml(t.cliente)}</div>
      <div><small>${escapeHtml(t.ubicacion || '')}</small></div>
      <div><button class="editBtn">Editar</button> <button class="delBtn">Eliminar</button></div>
    `;
    el.querySelector('.editBtn').onclick = () => loadForEdit(t);
    el.querySelector('.delBtn').onclick = async () => {
      if (!confirm('¿Eliminar este trabajo?')) return;
      // eliminar local
      await deleteLocal(t.id);
      // encolar delete remoto (si tenía remoteId)
      await addOutbox({ op: 'delete', payload: { remoteId: t.remoteId || null }, localId: t.id });
      if (navigator.onLine) await processOutbox();
      await renderTrabajos();
    };
    trabajosDiv.appendChild(el);
  });
}

/* Cargar en form para editar */
function loadForEdit(t) {
  document.getElementById('editId').value = t.id || '';
  document.getElementById('fecha').value = t.fecha || '';
  document.getElementById('cliente').value = t.cliente || '';
  document.getElementById('ubicacion').value = t.ubicacion || '';
  document.getElementById('superficie').value = t.superficie || '';
  document.getElementById('unidad').value = t.unidad || 'ha';
  document.getElementById('recomendacion').value = t.recomendacion || '';
  document.getElementById('observaciones').value = t.observaciones || '';
  insumosList.innerHTML = '';
  (t.insumos || []).forEach(i => createInsumoRow(i.producto, i.litros));
}

/* Guardar formulario -> local + outbox */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const idVal = document.getElementById('editId').value;
  const trabajo = {
    fecha: document.getElementById('fecha').value || new Date().toISOString().slice(0,10),
    cliente: document.getElementById('cliente').value.trim(),
    ubicacion: document.getElementById('ubicacion').value.trim(),
    superficie: document.getElementById('superficie').value,
    unidad: document.getElementById('unidad').value,
    insumos: readInsumosUI(),
    recomendacion: document.getElementById('recomendacion').value.trim(),
    observaciones: document.getElementById('observaciones').value.trim(),
    createdAt: Date.now()
  };

  try {
    if (idVal) {
      trabajo.id = parseInt(idVal);
      await putLocal(trabajo);
      await addOutbox({ op: 'update', payload: trabajo, localId: trabajo.id });
    } else {
      const localId = await addLocal(trabajo);
      await addOutbox({ op: 'add', payload: trabajo, localId });
    }
    if (navigator.onLine) await processOutbox();
    form.reset();
    insumosList.innerHTML = '';
    createInsumoRow();
    document.getElementById('editId').value = '';
    await renderTrabajos();
  } catch (err) {
    console.error('Save error:', err);
    alert('Error al guardar: ' + err);
  }
});

/* Inicialización */
openDB().then(async () => {
  if (!document.querySelector('#insumosList .insumoRow')) createInsumoRow();
  await renderTrabajos();
  if (navigator.onLine) await processOutbox();
}).catch(err => console.error('openDB failed', err));

/* Util */
function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
