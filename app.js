// =======================================
//  app.js — Registro de Aplicaciones Agronómicas
//  Versión Final conectada a Firebase Firestore
// =======================================

// --- Importar Firebase ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// --- Configuración de Firebase ---
const firebaseConfig = {
  apiKey: "AIzaSyDnMeFztVPA0IoP2tABRgd8pD86qBqzWhg",
  authDomain: "ing-anibal-epullan.firebaseapp.com",
  projectId: "ing-anibal-epullan",
  storageBucket: "ing-anibal-epullan.firebasestorage.app",
  messagingSenderId: "264725993777",
  appId: "1:264725993777:web:5af48de7b1a634fe72f810",
  measurementId: "G-TE8JKYLYM9"
};

// --- Inicializar Firebase y Firestore ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Datos del Ingeniero ---
const engineerInfo = {
  nombre: "Ing. Agrónomo Aníbal Epullan",
  email: "Anibalepullan1@gmail.com",
  telefono: "298 4687873",
  logo: "logo-ae.png"
};

// --- Referencias del DOM ---
const form = document.getElementById('workForm');
const insumosList = document.getElementById('insumosList');
const addInsumoBtn = document.getElementById('addInsumo');
const trabajosDiv = document.getElementById('trabajos');
const exportPDFBtn = document.getElementById('exportPDF');
const exportExcelBtn = document.getElementById('exportExcel');

// --- Crear fila de insumo ---
function createInsumoRow(nombre = '', litros = '') {
  const div = document.createElement('div');
  div.className = 'insumoRow';
  div.innerHTML = `
    <input placeholder="Producto" class="insumo-nombre" value="${nombre}">
    <input placeholder="Litros" class="insumo-litros" type="number" step="0.01" value="${litros}">
    <button type="button" class="removeInsumo">✖</button>
  `;
  div.querySelector('.removeInsumo').onclick = () => div.remove();
  insumosList.appendChild(div);
}
addInsumoBtn.onclick = () => createInsumoRow();

// --- Leer insumos ---
function readInsumos() {
  return Array.from(document.querySelectorAll('.insumoRow')).map(row => ({
    producto: row.querySelector('.insumo-nombre').value.trim(),
    litros: parseFloat(row.querySelector('.insumo-litros').value || 0)
  })).filter(i => i.producto || i.litros > 0);
}

// --- Guardar / actualizar trabajo ---
form.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const trabajo = {
    fecha: document.getElementById('fecha').value,
    cliente: document.getElementById('cliente').value.trim(),
    ubicacion: document.getElementById('ubicacion').value.trim(),
    superficie: document.getElementById('superficie').value,
    unidad: document.getElementById('unidad').value,
    insumos: readInsumos(),
    recomendacion: document.getElementById('recomendacion').value.trim(),
    observaciones: document.getElementById('observaciones').value.trim(),
    createdAt: new Date().toISOString()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "trabajos", id), trabajo);
      alert('✅ Trabajo actualizado correctamente');
    } else {
      await addDoc(collection(db, "trabajos"), trabajo);
      alert('✅ Trabajo guardado correctamente');
    }
    form.reset();
    insumosList.innerHTML = '';
    createInsumoRow();
    document.getElementById('editId').value = '';
    renderTrabajos();
  } catch (err) {
    console.error("Error al guardar:", err);
    alert('❌ Error al guardar el trabajo');
  }
});

// --- Renderizar trabajos ---
async function renderTrabajos() {
  trabajosDiv.innerHTML = '<p>Cargando registros...</p>';
  const querySnapshot = await getDocs(collection(db, "trabajos"));
  trabajosDiv.innerHTML = '';

  if (querySnapshot.empty) {
    trabajosDiv.innerHTML = '<p>No hay registros aún.</p>';
    return;
  }

  querySnapshot.forEach(docSnap => {
    const t = { id: docSnap.id, ...docSnap.data() };
    const el = document.createElement('div');
    el.className = 'trabajoCard';
    el.innerHTML = `
      <div class="trabajoResumen">
        <strong>${t.fecha}</strong> - ${t.cliente}
        <button class="toggleBtn">▼</button>
      </div>
      <div class="trabajoDetalle" style="display:none">
        <p><strong>Ubicación:</strong> ${t.ubicacion}</p>
        <p><strong>Superficie:</strong> ${t.superficie} ${t.unidad}</p>
        <p><strong>Insumos:</strong> ${(t.insumos || []).map(i => `${i.producto}: ${i.litros} L`).join(' — ')}</p>
        <p><strong>Recomendación:</strong> ${t.recomendacion}</p>
        <p><strong>Observaciones:</strong> ${t.observaciones}</p>
        <div class="trabajoAcciones">
          <button class="editBtn">Editar</button>
          <button class="deleteBtn">Eliminar</button>
          <button class="pdfBtn">PDF</button>
          <button class="excelBtn">Excel</button>
        </div>
      </div>
    `;

    const detalle = el.querySelector('.trabajoDetalle');
    el.querySelector('.toggleBtn').onclick = () => {
      detalle.style.display = detalle.style.display === 'none' ? 'block' : 'none';
    };

    el.querySelector('.editBtn').onclick = () => loadForEdit(t);
    el.querySelector('.deleteBtn').onclick = async () => {
      if (confirm('¿Eliminar este trabajo?')) {
        await deleteDoc(doc(db, "trabajos", t.id));
        renderTrabajos();
      }
    };
    el.querySelector('.pdfBtn').onclick = () => exportTrabajoPDF(t);
    el.querySelector('.excelBtn').onclick = () => exportTrabajoExcel(t);

    trabajosDiv.appendChild(el);
  });
}

// --- Cargar trabajo para editar ---
function loadForEdit(t) {
  document.getElementById('editId').value = t.id;
  document.getElementById('fecha').value = t.fecha;
  document.getElementById('cliente').value = t.cliente;
  document.getElementById('ubicacion').value = t.ubicacion;
  document.getElementById('superficie').value = t.superficie;
  document.getElementById('unidad').value = t.unidad;
  document.getElementById('recomendacion').value = t.recomendacion;
  document.getElementById('observaciones').value = t.observaciones;
  insumosList.innerHTML = '';
  (t.insumos || []).forEach(i => createInsumoRow(i.producto, i.litros));
}

// --- Exportar PDF individual ---
async function exportTrabajoPDF(trabajo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(engineerInfo.nombre, 15, 15);
  doc.setFontSize(10);
  doc.text(`Email: ${engineerInfo.email}`, 15, 22);
  doc.text(`Teléfono: ${engineerInfo.telefono}`, 15, 27);
  doc.line(15, 30, 195, 30);

  doc.setFontSize(14);
  doc.text(`Trabajo: ${trabajo.cliente}`, 15, 40);

  const rows = [
    ["Fecha", trabajo.fecha],
    ["Ubicación", trabajo.ubicacion],
    ["Superficie", `${trabajo.superficie} ${trabajo.unidad}`],
    ["Insumos", (trabajo.insumos || []).map(i => `${i.producto}: ${i.litros} L`).join(" | ") || "-"],
    ["Recomendación", trabajo.recomendacion],
    ["Observaciones", trabajo.observaciones],
  ];

  doc.autoTable({
    startY: 50,
    head: [["Campo", "Valor"]],
    body: rows,
    theme: "grid",
  });

  doc.save(`Trabajo_${trabajo.cliente}_${trabajo.fecha}.pdf`);
}

// --- Exportar Excel individual ---
function exportTrabajoExcel(trabajo) {
  const wb = XLSX.utils.book_new();
  const data = [
    ["Campo", "Valor"],
    ["Fecha", trabajo.fecha],
    ["Cliente", trabajo.cliente],
    ["Ubicación", trabajo.ubicacion],
    ["Superficie", `${trabajo.superficie} ${trabajo.unidad}`],
    ["Insumos", (trabajo.insumos || []).map(i => `${i.producto}: ${i.litros} L`).join(" | ")],
    ["Recomendación", trabajo.recomendacion],
    ["Observaciones", trabajo.observaciones],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Trabajo");
  XLSX.writeFile(wb, `Trabajo_${trabajo.cliente}_${trabajo.fecha}.xlsx`);
}

// --- Exportar todos los trabajos (PDF/Excel global) ---
exportPDFBtn.onclick = async () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const querySnapshot = await getDocs(collection(db, "trabajos"));
  const trabajos = querySnapshot.docs.map(d => d.data());

  doc.text("Registro de Trabajos", 15, 15);
  const rows = trabajos.map(t => [
    t.fecha,
    t.cliente,
    t.ubicacion,
    `${t.superficie} ${t.unidad}`,
    (t.insumos || []).map(i => `${i.producto}:${i.litros}L`).join(" | "),
    t.recomendacion,
  ]);
  doc.autoTable({
    head: [["Fecha", "Cliente", "Ubicación", "Superficie", "Insumos", "Recomendación"]],
    body: rows,
    startY: 25
  });
  doc.save("Registro_trabajos.pdf");
};

exportExcelBtn.onclick = async () => {
  const querySnapshot = await getDocs(collection(db, "trabajos"));
  const trabajos = querySnapshot.docs.map(d => d.data());
  const ws = XLSX.utils.json_to_sheet(trabajos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Trabajos");
  XLSX.writeFile(wb, "Registro_trabajos.xlsx");
};

// --- Inicialización ---
createInsumoRow();
renderTrabajos();


(async () => {
  try {
    const testRef = await addDoc(collection(db, "testCollection"), {
      mensaje: "Conexión correcta",
      fecha: new Date().toISOString()
    });
    console.log("✅ Firestore funcionando. ID:", testRef.id);
  } catch (error) {
    console.error("❌ Error de conexión con Firestore:", error);
  }
})();
