const state = {
  canchas: [],
  menu: [],
  reservas: [],
  summary: null
};

const sectionTitles = {
  overview: "Resumen general",
  reservations: "Reservas y comprobantes",
  courts: "Gestión de canchas",
  menu: "Menú dinámico del bot",
  manual: "Alta manual de reservas"
};

function $(selector) {
  return document.querySelector(selector);
}

function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2800);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "same-origin",
    ...options
  });

  if (response.status === 401) {
    $("#app-shell").classList.add("hidden");
    $("#login-screen").classList.remove("hidden");
    throw new Error("Sesión vencida");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = payload?.error || payload || "Ocurrió un error";
    throw new Error(message);
  }

  return payload;
}

function setActiveSection(sectionName) {
  document.querySelectorAll(".section").forEach((section) => section.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.remove("active"));

  $(`#section-${sectionName}`).classList.add("active");
  document.querySelector(`.nav-link[data-section="${sectionName}"]`)?.classList.add("active");
  $("#section-title").textContent = sectionTitles[sectionName] || "Panel";
}

function renderSummary() {
  const summary = state.summary || {};
  const cards = [
    { label: "Canchas", value: summary.canchas ?? 0, helper: "Configuradas en la base" },
    { label: "Opciones del menú", value: summary.menu_items ?? 0, helper: "Respuestas activas del bot" },
    { label: "Pendientes", value: summary.pendientes ?? 0, helper: "Requieren revisión" },
    { label: "Confirmados", value: summary.confirmados_futuros ?? 0, helper: "Turnos futuros" },
    { label: "Conversaciones 24h", value: summary.conversaciones_24h ?? 0, helper: "Usuarios activos recientes" }
  ];

  $("#stats-grid").innerHTML = cards.map((card) => `
    <article class="stat-card">
      <p class="stat-card__label">${card.label}</p>
      <p class="stat-card__value">${card.value}</p>
      <p class="stat-card__helper">${card.helper}</p>
    </article>
  `).join("");
}

function renderReservations() {
  const body = $("#reservations-body");
  if (!state.reservas.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted">No hay reservas para mostrar.</td></tr>`;
    return;
  }

  body.innerHTML = state.reservas.map((booking) => {
    const statusBadge = booking.estado === "pendiente"
      ? `<span class="badge badge--pending">Pendiente</span>`
      : `<span class="badge badge--confirmed">Confirmado</span>`;

    let receiptHtml = `<span class="muted">Sin comprobante</span>`;
    if (booking.comprobante_url) {
      if (booking.comprobante_url.endsWith(".pdf") || booking.comprobante_url.includes("/api/media/")) {
        receiptHtml = `<a class="link-btn" href="${booking.comprobante_url}" target="_blank" rel="noopener noreferrer">Ver archivo</a>`;
      }
      if (/\.(png|jpg|jpeg|webp)$/i.test(booking.comprobante_url)) {
        receiptHtml = `<a class="preview-box" href="${booking.comprobante_url}" target="_blank" rel="noopener noreferrer"><img src="${booking.comprobante_url}" alt="Comprobante" /></a>`;
      }
      if (booking.comprobante_url.includes("/api/media/")) {
        receiptHtml = `<a class="link-btn" href="${booking.comprobante_url}" target="_blank" rel="noopener noreferrer">Abrir comprobante</a>`;
      }
    }

    const actions = booking.estado === "pendiente"
      ? `
        <div class="inline-actions">
          <button class="primary-btn" data-approve="${booking.id}">Aprobar</button>
          <button class="danger-btn" data-reject="${booking.id}">Rechazar</button>
        </div>
      `
      : statusBadge;

    return `
      <tr>
        <td>${booking.fecha}</td>
        <td>${booking.hora}</td>
        <td>${booking.cancha}</td>
        <td>${booking.deporte}</td>
        <td>${booking.numero_whatsapp}</td>
        <td>${receiptHtml}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.approve, "confirmar"));
  });
  body.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(button.dataset.reject, "rechazar"));
  });
}

function renderCourts() {
  const body = $("#courts-body");
  if (!state.canchas.length) {
    body.innerHTML = `<tr><td colspan="3" class="muted">Todavía no hay canchas cargadas.</td></tr>`;
    return;
  }

  body.innerHTML = state.canchas.map((court) => `
    <tr>
      <td><input type="text" value="${court.nombre}" data-court-name="${court.id}" /></td>
      <td>
        <select data-court-type="${court.id}">
          <option value="futbol" ${court.tipo === "futbol" ? "selected" : ""}>Fútbol</option>
          <option value="padel" ${court.tipo === "padel" ? "selected" : ""}>Pádel</option>
        </select>
      </td>
      <td><button class="secondary-btn" data-save-court="${court.id}">Guardar</button></td>
    </tr>
  `).join("");

  body.querySelectorAll("[data-save-court]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const id = button.dataset.saveCourt;
        const nombre = document.querySelector(`[data-court-name="${id}"]`).value.trim();
        const tipo = document.querySelector(`[data-court-type="${id}"]`).value;
        await api("/api/canchas", {
          method: "POST",
          body: JSON.stringify({ id, nombre, tipo })
        });
        showToast("Cancha actualizada.");
        await loadCourts();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

function renderMenu() {
  const body = $("#menu-body");
  if (!state.menu.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No hay opciones cargadas.</td></tr>`;
    return;
  }

  body.innerHTML = state.menu.map((item) => {
    const readOnly = item.tipo_accion !== "informativo";
    return `
      <tr>
        <td><input type="number" value="${item.numero_opcion}" data-menu-number="${item.id}" ${readOnly ? "disabled" : ""} /></td>
        <td><input type="text" value="${escapeHtml(item.titulo)}" data-menu-title="${item.id}" ${readOnly ? "disabled" : ""} /></td>
        <td>
          ${readOnly
            ? `<span class="badge badge--system">Sistema: ${item.tipo_accion}</span>`
            : `<textarea rows="4" data-menu-response="${item.id}">${escapeHtml(item.texto_respuesta || "")}</textarea>`
          }
        </td>
        <td>
          <div class="table-actions">
            ${readOnly
              ? `<span class="muted">Bloqueado</span>`
              : `<button class="secondary-btn" data-save-menu="${item.id}">Guardar</button>
                 <button class="danger-btn" data-delete-menu="${item.id}">Borrar</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll("[data-save-menu]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const id = button.dataset.saveMenu;
        const numero_opcion = Number(document.querySelector(`[data-menu-number="${id}"]`).value);
        const titulo = document.querySelector(`[data-menu-title="${id}"]`).value.trim();
        const texto_respuesta = document.querySelector(`[data-menu-response="${id}"]`).value.trim();
        await api("/api/menu", {
          method: "POST",
          body: JSON.stringify({ id, numero_opcion, titulo, texto_respuesta })
        });
        showToast("Opción actualizada.");
        await loadMenu();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  body.querySelectorAll("[data-delete-menu]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("¿Seguro que querés borrar esta opción?")) return;
      try {
        await api(`/api/menu/${button.dataset.deleteMenu}`, { method: "DELETE" });
        showToast("Opción eliminada.");
        await loadMenu();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function refreshManualCourtOptions() {
  const sport = $("#manual-sport").value;
  const available = state.canchas.filter((court) => court.tipo === sport);
  $("#manual-court").innerHTML = available.map((court) => `<option value="${court.id}">${court.nombre}</option>`).join("");
}

async function loadSummary() {
  state.summary = await api("/api/dashboard/summary");
  renderSummary();
}

async function loadCourts() {
  state.canchas = await api("/api/canchas");
  renderCourts();
  refreshManualCourtOptions();
}

async function loadMenu() {
  state.menu = await api("/api/menu");
  renderMenu();
}

async function loadReservations() {
  const date = $("#filter-date").value;
  const url = date ? `/api/reservas?fecha=${date}` : "/api/reservas";
  state.reservas = await api(url);
  renderReservations();
}

async function loadEverything() {
  await Promise.all([loadSummary(), loadCourts(), loadMenu(), loadReservations()]);
}

async function updateBookingStatus(id, accion) {
	const bookingId = Number(id);
	const label = accion === "confirmar" ? "aprobar" : "rechazar";

	if (!Number.isInteger(bookingId) || bookingId <= 0) {
		showToast("ID de reserva inválido.", "error");
		return;
	}

	if (!confirm(`¿Seguro que querés ${label} esta reserva?`)) return;

	try {
const result = await api(`/api/reservas/${bookingId}/estado`, {
  method: "POST",
  body: JSON.stringify({ accion })
});

const accionTexto = label === "aprobar" ? "aprobada" : "rechazada";

if (result?.whatsapp?.sent) {
  showToast(`Reserva ${accionTexto}. WhatsApp enviado.`);
} else {
  showToast(
    `Reserva ${accionTexto}, pero WhatsApp no se envió. ${result?.whatsapp?.error || ""}`,
    "error"
  );
}
		await Promise.all([loadReservations(), loadSummary()]);
	} catch (error) {
		showToast(error.message, "error");
	}
}

async function verifySession() {
  const result = await api("/api/session", { headers: {} });
  const authenticated = !!result.authenticated;
  $("#login-screen").classList.toggle("hidden", authenticated);
  $("#app-shell").classList.toggle("hidden", !authenticated);

  if (authenticated) {
    await loadEverything();
  }
}

function bindEvents() {
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => setActiveSection(button.dataset.section));
  });

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => setActiveSection(button.dataset.go));
  });

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password: $("#password-input").value })
      });
      $("#password-input").value = "";
      showToast("Sesión iniciada.");
      await verifySession();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
      showToast("Sesión cerrada.");
      await verifySession();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#refresh-all").addEventListener("click", async () => {
    try {
      await loadEverything();
      showToast("Datos actualizados.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#reload-reservations").addEventListener("click", async () => {
    try {
      await loadReservations();
      showToast("Reservas recargadas.");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#clear-filter").addEventListener("click", async () => {
    $("#filter-date").value = "";
    await loadReservations();
  });

  $("#court-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/canchas", {
        method: "POST",
        body: JSON.stringify({
          nombre: $("#court-name").value.trim(),
          tipo: $("#court-type").value
        })
      });
      event.target.reset();
      showToast("Cancha creada.");
      await Promise.all([loadCourts(), loadSummary()]);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#menu-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/menu", {
        method: "POST",
        body: JSON.stringify({
          numero_opcion: Number($("#menu-number").value),
          titulo: $("#menu-title-input").value.trim(),
          texto_respuesta: $("#menu-response").value.trim()
        })
      });
      event.target.reset();
      showToast("Opción creada.");
      await Promise.all([loadMenu(), loadSummary()]);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#manual-sport").addEventListener("change", refreshManualCourtOptions);

  $("#manual-booking-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/reservas", {
        method: "POST",
        body: JSON.stringify({
          numero_whatsapp: $("#manual-phone").value.trim(),
          deporte: $("#manual-sport").value,
          fecha: $("#manual-date").value,
          hora: $("#manual-time").value,
          cancha_id: Number($("#manual-court").value)
        })
      });
      event.target.reset();
      refreshManualCourtOptions();
      showToast("Reserva creada y confirmada.");
      await Promise.all([loadReservations(), loadSummary()]);
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  setActiveSection("overview");
  try {
    await verifySession();
  } catch {
    // si no hay sesión, se queda en login
  }
});
