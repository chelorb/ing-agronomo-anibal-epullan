/* app.js - sincronización IndexedDB <-> Firebase Firestore (lista para pegar)
   - Mantiene IndexedDB (offline)
   - Usa outbox para operaciones offline
   - Sincroniza automáticamente cuando haya conexión
   - Usa Auth Anónima de Firebase para identificar clientes
*/

/* ---------------------------
   CONFIG: pegar tu firebaseConfig aquí
   (lo copiás desde Firebase console -> Project settings -> SDK config)
   --------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDnMeFztVPA0IoP2tABRgd8pD86qBqzWhg",
  authDomain: "<<< tu-authDomain >>>",
  projectId: "<<< tu-projectId >>>",
  // ... otros keys que Firebase te da
};

/* =============================
   Inicializar Firebase
   ============================= */
if (typeof firebase === "undefined") {
  console.error("Firebase SDK no cargado. Asegurate de incluir los scripts en index.html");
} else {
  firebase.initializeApp(firebaseConfig);
  // autenticación anónima para identificar clientes
  firebase.auth().signInAnonymously()
    .catch(err => console.warn("Auth anon falló:", err));
}

// referencia a Firestore (compat)
const firestore = firebase.firestore();

/* =============================
   IndexedDB: trabajos + outbox
   ============================= */
const DB_NAME = 'registroDB_v3';
const STORE_TRABAJOS = 'trabajos';
const STORE_OUTBOX = 'outbox';
let db = null;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2); // version 2: incluye outbox
    r.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORE_TRABAJOS)) {
        _db.createObjectStore(STORE_TRABAJOS, { keyPath: 'id', autoIncrement: true });
      }
      if (!_db.objectStoreNames.contains(STORE_OUTBOX)) {
        _db.createObjectStore(STORE_OUTBOX, { keyPath: 'oid', autoIncrement: true });
      }
    };
    r.onsuccess = (e) => {
      db = e.target.result;
      res(db);
    };
    r.onerror = (e) => rej(e.target.error);
  });
}

// asegura la DB abierta antes de operar
async function ensureDB() {
  if (!db) {
    db = await openDB();
  }
  try {
    // intento una transacción dummy para verificar conexión
    db.transaction(STORE_TRABAJOS, 'readonly');
  } catch (err) {
    console.warn('IndexedDB cerrada -> reabrimos', err);
    db = await openDB();
  }
  return db;
}

/* -----------------------------
   Helpers IndexedDB (trabajos)
   ----------------------------- */
async function addLocal(trabajo) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readwrite');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.add(trabajo);
    rq.onsuccess = () => res(rq.result); // id local
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function putLocal(trabajo) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readwrite');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.put(trabajo);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function deleteLocal(id) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readwrite');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.delete(id);
    rq.onsuccess = () => res();
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function getAllLocal() {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_TRABAJOS, 'readonly');
    const store = tx.objectStore(STORE_TRABAJOS);
    const rq = store.getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = (e) => rej(e.target.error);
  });
}

/* -----------------------------
   Outbox (cola de operaciones offline)
   Cada item: { oid, op: 'add'|'update'|'delete', payload: {...}, localId }
   ----------------------------- */
async function addOutbox(item) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const rq = store.add(item);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function getOutboxAll() {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const store = tx.objectStore(STORE_OUTBOX);
    const rq = store.getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function removeOutbox(oid) {
  await ensureDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const rq = store.delete(oid);
    rq.onsuccess = () => res();
    rq.onerror = (e) => rej(e.target.error);
  });
}

/* =============================
   Firestore helpers
   ============================= */
const COLLECTION = 'trabajos';

async function addRemote(trabajo) {
  // agrega en Firestore y devuelve el id remoto
  const docRef = await firestore.collection(COLLECTION).add({
    ...trabajo,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    client: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null
  });
  return docRef.id;
}

async function updateRemote(remoteId, trabajo) {
  await firestore.collection(COLLECTION).doc(remoteId).set({
    ...trabajo,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function deleteRemote(remoteId) {
  await firestore.collection(COLLECTION).doc(remoteId).delete();
}

/* =============================
   Sync: procesar outbox cuando hay conexión
   ============================= */
async function processOutbox() {
  // si no hay conexión a Firestore, salimos
  if (!navigator.onLine) return;
  try {
    const out = await getOutboxAll();
    for (const item of out) {
      try {
        if (item.op === 'add') {
          // añadir remoto y guardar remoteId en local
          const remoteId = await addRemote(item.payload);
          // actualizar registro local para guardar remoteId
          const localRec = Object.assign({}, item.payload, { remoteId });
          // si localId existe, lo ponemos con ese id; si no, guardamos nuevo
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
            // si no tiene remoteId -> crear remoto
            const newRemoteId = await addRemote(item.payload);
            item.payload.remoteId = newRemoteId;
            await putLocal(item.payload);
          }
        } else if (item.op === 'delete') {
          if (item.payload.remoteId) {
            await deleteRemote(item.payload.remoteId);
          }
          // eliminar local también
          if (item.localId) {
            await deleteLocal(item.localId);
          }
        }
        // eliminar de outbox
        await removeOutbox(item.oid);
      } catch (err) {
        console.warn('Error procesando outbox item', item, err);
        // Si falla un item, lo dejamos y continuamos con los demás
      }
    }
  } catch (err) {
    console.error('Error procesando outbox:', err);
  }
}

// procesar outbox al volver online
window.addEventListener('online', () => {
  console.log('En línea - procesando outbox');
  processOutbox();
});

// también al iniciar si hay conexión
if (navigator.onLine) processOutbox();

/* =============================
   Integración con la UI existente
   (preservamos tu flujo: guardamos local y añadimos outbox)
   ============================= */

// elementos DOM (suponiendo tu index.html ya tiene estos ids)
const insumosList = document.getElementById('insumosList');
const addInsumoBtn = document.getElementById('addInsumo');
const form = document.getElementById('workForm');
const trabajosDiv = document.getElementById('trabajos');

// helpers UI (igual que antes; escape/crear filas)
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

// agregar fila por UI
addInsumoBtn.addEventListener('click', () => createInsumoRow());

function readInsumosUI() {
  const rows = Array.from(document.querySelectorAll('#insumosList .insumoRow'));
  return rows.map(r => ({ producto: r.querySelector('.insumo-nombre').value.trim(), litros: parseFloat(r.querySelector('.insumo-litros').value || 0) })).filter(i => i.producto);
}

/* Renderizar trabajos desde local (IndexedDB) */
async function renderTrabajos() {
  const list = await getAllLocal();
  trabajosDiv.innerHTML = '';
  if (!list.length) {
    trabajosDiv.innerHTML = '<p>No hay registros aún.</p>';
    return;
  }
  list.sort((a,b) => (b.id || 0) - (a.id || 0));
  list.forEach(t => {
    const el = document.createElement('div');
    el.className = 'trabajoCard';
    el.innerHTML = `
      <div><strong>${t.fecha}</strong> - ${t.cliente}</div>
      <div><small>${t.ubicacion || ''}</small></div>
      <div>
        <button class="editBtn">Editar</button>
        <button class="delBtn">Eliminar</button>
      </div>
    `;
    el.querySelector('.editBtn').onclick = () => loadForEdit(t);
    el.querySelector('.delBtn').onclick = async () => {
      if (!confirm('¿Eliminar este trabajo?')) return;
      // eliminar local
      await deleteLocal(t.id);
      // agregar a outbox para borrar remoto
      await addOutbox({ op: 'delete', payload: { remoteId: t.remoteId || null }, localId: t.id });
      // intentar procesar outbox si estamos online
      if (navigator.onLine) await processOutbox();
      await renderTrabajos();
    };
    trabajosDiv.appendChild(el);
  });
}

/* Cargar para editar */
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

/* Guardar formulario: primero local + outbox */
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
      // actualizar local y poner en outbox 'update'
      trabajo.id = parseInt(idVal);
      await putLocal(trabajo);
      await addOutbox({ op: 'update', payload: trabajo, localId: trabajo.id });
    } else {
      // nuevo: guardar local y agregar outbox 'add' con localId
      const localId = await addLocal(trabajo);
      await addOutbox({ op: 'add', payload: trabajo, localId });
    }

    // intentar procesar la cola si hay conexión
    if (navigator.onLine) await processOutbox();

    form.reset();
    insumosList.innerHTML = '';
    createInsumoRow();
    document.getElementById('editId').value = '';
    await renderTrabajos();
  } catch (err) {
    console.error('Error guardando trabajo:', err);
    alert('Error al guardar: ' + err);
  }
});

/* Inicialización */
openDB().then(async () => {
  // crea una fila por defecto de insumo si no hay
  if (!document.querySelector('#insumosList .insumoRow')) createInsumoRow();
  // render local
  await renderTrabajos();
  // procesar outbox en el inicio si estamos online
  if (navigator.onLine) await processOutbox();

  // Opcional: escuchar cambios remotos en Firestore (si querés ver cambios en tiempo real)
  // firestore.collection(COLLECTION).onSnapshot(snapshot => {
  //   // aquí podrías aplicar merges de remote -> local si necesitás
  // });
}).catch(err => {
  console.error('No se pudo abrir DB', err);
});
