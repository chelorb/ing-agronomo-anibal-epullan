// app.js - funcionalidad principal (versión mejorada para Safari/iPhone)
// --------------------------------------------

// ---- Datos del ingeniero ----
const engineerInfo = {
  nombre: "Ing. Agrónomo Anibal Epullan",
  email: "Anibalepullan1@gmail.com",
  telefono: "298 4687873",
  logo: "logo-192.png"
};

// ---- IndexedDB helpers ----
const DB_NAME = "registroDB_v3";
const STORE = "trabajos";
let db;

// Abrir la base de datos
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORE)) {
        _db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    r.onsuccess = (e) => {
      db = e.target.result;
      db.onclose = () => {
        console.warn("IndexedDB cerrada, se reabrirá automáticamente.");
      };
      res(db);
    };
    r.onerror = (e) => rej(e.target.error);
  });
}

// Verificar o reabrir la base antes de cada operación
async function ensureDB() {
  if (!db) {
    db = await openDB();
  }
  try {
    db.transaction(STORE, "readonly");
  } catch (e) {
    console.warn("Reabriendo conexión IndexedDB...", e);
    db = await openDB();
  }
  return db;
}

async function addTrabajo(trabajo) {
  const _db = await ensureDB();
  return new Promise((res, rej) => {
    const tx = _db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rq = store.add(trabajo);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function updateTrabajo(trabajo) {
  const _db = await ensureDB();
  return new Promise((res, rej) => {
    const tx = _db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rq = store.put(trabajo);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function deleteTrabajo(id) {
  const _db = await ensureDB();
  return new Promise((res, rej) => {
    const tx = _db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rq = store.delete(id);
    rq.onsuccess = () => res();
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function getAllTrabajos() {
  const _db = await ensureDB();
  return new Promise((res, rej) => {
    const tx = _db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const rq = store.getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = (e) => rej(e.target.error);
  });
}

async function clearAll() {
  const _db = await ensureDB();
  return new Promise((res, rej) => {
    const tx = _db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rq = store.clear();
    rq.onsuccess = () => res();
    rq.onerror = (e) => rej(e.target.error);
  });
}

// ---- UI helpers ----
const insumosList = document.getElementById("insumosList");
const addInsumoBtn = document.getElementById("addInsumo");
const form = document.getElementById("workForm");
const trabajosDiv = document.getElementById("trabajos");

function createInsumoRow(name = "", litros = "") {
  const div = document.createElement("div");
  div.className = "insumoRow";
  div.innerHTML = `
    <input placeholder="Producto" class="insumo-nombre" value="${name}">
    <input placeholder="Litros" class="insumo-litros" type="number" step="0.01" value="${litros}">
    <button type="button" class="removeInsumo">✖</button>
  `;
  div.querySelector(".removeInsumo").onclick = () => div.remove();
  insumosList.appendChild(div);
}

addInsumoBtn.addEventListener("click", () => createInsumoRow());

function readInsumos() {
  const rows = Array.from(document.querySelectorAll("#insumosList .insumoRow"));
  return rows
    .map((r) => ({
      producto: r.querySelector(".insumo-nombre").value || "",
      litros: parseFloat(r.querySelector(".insumo-litros").value || 0),
    }))
    .filter((i) => i.producto || i.litros > 0);
}

async function renderTrabajos() {
  const list = await getAllTrabajos();
  trabajosDiv.innerHTML = "";
  if (!list.length) {
    trabajosDiv.innerHTML = "<p>No hay registros aún.</p>";
    return;
  }
  list.sort((a, b) => b.id - a.id);
  list.forEach((t) => {
    const el = document.createElement("div");
    el.className = "trabajoCard";
    el.innerHTML = `
      <div class="trabajoResumen">
        <strong>${t.fecha}</strong> - ${t.cliente}
        <button class="toggleBtn">▼</button>
      </div>
      <div class="trabajoDetalle" style="display:none">
        <p><strong>Ubicación:</strong> ${t.ubicacion || "-"}</p>
        <p><strong>Superficie:</strong> ${t.superficie || "-"} ${t.unidad || ""}</p>
        <p><strong>Insumos:</strong> ${(t.insumos || [])
          .map((i) => i.producto + ": " + i.litros + " L")
          .join(" — ") || "-"}</p>
        <p><strong>Recomendación:</strong> ${t.recomendacion || "-"}</p>
        <p><strong>Observaciones:</strong> ${t.observaciones || "-"}</p>
        <div class="trabajoAcciones">
          <button class="editBtn">Editar</button>
          <button class="deleteBtn">Eliminar</button>
          <button class="pdfBtn">PDF</button>
        </div>
      </div>
    `;
    const detalle = el.querySelector(".trabajoDetalle");
    el.querySelector(".toggleBtn").onclick = () => {
      detalle.style.display = detalle.style.display === "none" ? "block" : "none";
    };
    el.querySelector(".editBtn").onclick = () => loadForEdit(t);
    el.querySelector(".deleteBtn").onclick = async () => {
      if (confirm("¿Eliminar este trabajo?")) {
        await deleteTrabajo(t.id);
        renderTrabajos();
      }
    };
    el.querySelector(".pdfBtn").onclick = () => exportTrabajoPDF(t);
    trabajosDiv.appendChild(el);
  });
}

function loadForEdit(t) {
  document.getElementById("editId").value = t.id;
  document.getElementById("fecha").value = t.fecha;
  document.getElementById("cliente").value = t.cliente;
  document.getElementById("ubicacion").value = t.ubicacion;
  document.getElementById("superficie").value = t.superficie;
  document.getElementById("unidad").value = t.unidad;
  document.getElementById("recomendacion").value = t.recomendacion;
  document.getElementById("observaciones").value = t.observaciones;
  insumosList.innerHTML = "";
  (t.insumos || []).forEach((i) => createInsumoRow(i.producto, i.litros));
}

// ---- guardar formulario ----
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("editId").value;
  const trabajo = {
    id: id ? parseInt(id) : undefined,
    fecha: document.getElementById("fecha").value || new Date().toISOString().slice(0, 10),
    cliente: document.getElementById("cliente").value.trim(),
    ubicacion: document.getElementById("ubicacion").value.trim(),
    superficie: document.getElementById("superficie").value,
    unidad: document.getElementById("unidad").value,
    insumos: readInsumos(),
    recomendacion: document.getElementById("recomendacion").value.trim(),
    observaciones: document.getElementById("observaciones").value.trim(),
    createdAt: Date.now(),
  };
  try {
    if (id) {
      await updateTrabajo(trabajo);
      alert("✅ Trabajo actualizado");
    } else {
      await addTrabajo(trabajo);
      alert("✅ Trabajo guardado");
    }
    form.reset();
    insumosList.innerHTML = "";
    createInsumoRow();
    document.getElementById("editId").value = "";
    renderTrabajos();
  } catch (err) {
    console.error(err);
    alert("❌ Error al guardar: " + err);
  }
});

// ---- Inicialización ----
openDB().then(() => {
  createInsumoRow();
  renderTrabajos();
});

document.getElementById("borrarTodo").addEventListener("click", async () => {
  if (confirm("¿Seguro que quieres borrar todos los trabajos?")) {
    await clearAll();
    renderTrabajos();
  }
});

// ---- Reconexion automática en iPhone ----
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    openDB().then(() => console.log("Reconexion IndexedDB OK"));
  }
});
