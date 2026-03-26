const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { query } = require("./db");
const { requireAuth, setAuthCookie, clearAuthCookie, getSessionFromRequest } = require("./auth");
const { normalizeArgentinaWhatsappNumber } = require("./number");
const { sendWhatsappText, sendWhatsappTemplate, getMediaMeta, downloadMediaBuffer } = require("./whatsapp");

const app = express();
const publicDir = path.join(process.cwd(), "public");

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
let bootstrapPromise;

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

async function bootstrapSystemData() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await query(`
        INSERT INTO menu_dinamico (numero_opcion, titulo, tipo_accion, texto_respuesta)
        SELECT 1, 'Reservar cancha ⚽', 'sistema_reservar', 'Sistema de reservas'
        WHERE NOT EXISTS (SELECT 1 FROM menu_dinamico WHERE tipo_accion = 'sistema_reservar')
      `);

      await query(`
        INSERT INTO menu_dinamico (numero_opcion, titulo, tipo_accion, texto_respuesta)
        SELECT 2, 'Ver mis turnos 📋', 'sistema_turnos', 'Sistema de consulta de turnos'
        WHERE NOT EXISTS (SELECT 1 FROM menu_dinamico WHERE tipo_accion = 'sistema_turnos')
      `);

      const maxOptionResult = await query(`SELECT COALESCE(MAX(numero_opcion), 2) AS max_option FROM menu_dinamico`);
      const nextOption = Number(maxOptionResult.rows[0]?.max_option || 2) + 1;

      await query(
        `
          INSERT INTO menu_dinamico (numero_opcion, titulo, tipo_accion, texto_respuesta)
          SELECT $1, 'Hablar con Asistente Virtual 🤖', 'sistema_ia', 'Modo IA activado'
          WHERE NOT EXISTS (SELECT 1 FROM menu_dinamico WHERE tipo_accion = 'sistema_ia')
        `,
        [nextOption]
      );
    })().catch((error) => {
      bootstrapPromise = null;
      console.error("Error inicializando datos del sistema:", error.message);
      throw error;
    });
  }

  return bootstrapPromise;
}

async function askAssistant(prompt) {
	try {
		if (!process.env.GEMINI_API_KEY) {
			return "Ahora mismo no tengo disponible la respuesta automática. Escribinos y te ayudamos con la reserva.";
		}

		const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
		const result = await model.generateContent(prompt);
		const response = await result.response;
		const text = response.text();

		return text?.trim() || "Ahora mismo no pude generar una respuesta automática. Escribinos y te ayudamos con la reserva.";
	} catch (error) {
		console.error("❌ Error con Gemini:", error.message);

		if (error?.status === 429) {
			return "Ahora mismo estamos con mucha demanda y la respuesta automática está temporalmente no disponible. Escribinos igual y te ayudamos con tu reserva.";
		}

		if (error?.status === 403) {
			return "La asistencia automática no está disponible en este momento. Escribinos y te ayudamos con tu reserva.";
		}

		return "Ahora mismo no tengo disponible la respuesta automática. Escribinos y te ayudamos con tu reserva.";
	}
}

async function storeWhatsappMedia(media, mediaType) {
  const meta = await getMediaMeta(media.id);
  const buffer = await downloadMediaBuffer(meta.url);
  const mimeType = media.mime_type || (mediaType === "image" ? "image/jpeg" : "application/octet-stream");
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType.startsWith("image/") ? mimeType.split("/")[1].replace("jpeg", "jpg") : "bin";
  const mediaId = crypto.randomUUID();
  const filename = `comp_${Date.now()}.${extension}`;

  await query(
    `INSERT INTO media_files (id, filename, mime_type, content_base64)
     VALUES ($1, $2, $3, $4)`,
    [mediaId, filename, mimeType, buffer.toString("base64")]
  );

  return `/api/media/${mediaId}`;
}

async function sendMainMenu(to) {
  const menuResult = await query("SELECT numero_opcion, titulo FROM menu_dinamico ORDER BY numero_opcion");
  let welcomeMessage = "🏟️ *Bienvenido al Complejo*\n\n";
  menuResult.rows.forEach((item) => {
    welcomeMessage += `${item.numero_opcion}. ${item.titulo}\n`;
  });
  await sendWhatsappText(to, welcomeMessage);
}

async function upsertUserState(number, nextState, extraFields = {}) {
  const defaults = {
    deporte_elegido: null,
    fecha_elegida: null,
    hora_elegida: null,
    cancha_elegida_id: null,
    ...extraFields
  };

  await query(
    `
      INSERT INTO estados_usuarios (numero_whatsapp, estado, deporte_elegido, fecha_elegida, hora_elegida, cancha_elegida_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (numero_whatsapp)
      DO UPDATE SET
        estado = EXCLUDED.estado,
        deporte_elegido = EXCLUDED.deporte_elegido,
        fecha_elegida = EXCLUDED.fecha_elegida,
        hora_elegida = EXCLUDED.hora_elegida,
        cancha_elegida_id = EXCLUDED.cancha_elegida_id,
        updated_at = NOW()
    `,
    [
      number,
      nextState,
      defaults.deporte_elegido,
      defaults.fecha_elegida,
      defaults.hora_elegida,
      defaults.cancha_elegida_id
    ]
  );
}

async function handleIncomingWhatsappMessage(req, res) {
  res.sendStatus(200);

  await bootstrapSystemData();

  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  const text = msg.text?.body?.trim().toLowerCase() || "";
  const msgType = msg.type;
  const normalizedNumber = normalizeArgentinaWhatsappNumber(msg.from);

  const userResult = await query("SELECT * FROM estados_usuarios WHERE numero_whatsapp = $1", [normalizedNumber]);
  const user = userResult.rows[0] || { estado: "INICIO" };

  if (["hola", "menu", "salir"].includes(text)) {
    await upsertUserState(normalizedNumber, "INICIO");
    await sendMainMenu(normalizedNumber);
    return;
  }

  switch (user.estado) {
    case "INICIO": {
      const optionNumber = Number(text);
      if (Number.isInteger(optionNumber) && text.length <= 2) {
        const optionResult = await query("SELECT * FROM menu_dinamico WHERE numero_opcion = $1", [optionNumber]);
        const option = optionResult.rows[0];

        if (!option) {
          await sendWhatsappText(normalizedNumber, "Opción inválida. Elegí un número de la lista.");
          return;
        }

        if (option.tipo_accion === "sistema_reservar") {
          await upsertUserState(normalizedNumber, "SELECCION_DEPORTE");
          await sendWhatsappText(normalizedNumber, "Indicame el deporte:\n1. ⚽ Fútbol\n2. 🎾 Pádel");
          return;
        }

        if (option.tipo_accion === "sistema_turnos") {
          const upcomingResult = await query(
            `
              SELECT TO_CHAR(fecha, 'DD/MM') AS fecha_corta, hora,
                     (SELECT nombre FROM canchas WHERE id = cancha_id) AS cancha
              FROM turnos
              WHERE numero_whatsapp = $1
                AND estado = 'confirmado'
                AND fecha >= CURRENT_DATE
              ORDER BY fecha, hora
            `,
            [normalizedNumber]
          );

          let message = upcomingResult.rows.length
            ? "📋 *Tus turnos confirmados:*\n"
            : "No tenés turnos confirmados por ahora.";

          upcomingResult.rows.forEach((row) => {
            message += `\n📅 ${row.fecha_corta} - ${row.hora} hs (${row.cancha})`;
          });

          await sendWhatsappText(normalizedNumber, message);
          return;
        }

        if (option.tipo_accion === "sistema_ia") {
          await upsertUserState(normalizedNumber, "HABLANDO_CON_IA");
          await sendWhatsappText(normalizedNumber, "🤖 *Modo asistente activado*\n\nPreguntame lo que necesites sobre el complejo. Para volver al menú, escribí *salir* o *menu*.");
          return;
        }

        await sendWhatsappText(normalizedNumber, option.texto_respuesta || "Sin respuesta configurada.");
        return;
      }

      const reply = await askAssistant(text || "hola", "menu");
      await sendWhatsappText(normalizedNumber, reply);
      return;
    }

    case "HABLANDO_CON_IA": {
      const reply = await askAssistant(text || "hola", "assistant");
      await sendWhatsappText(normalizedNumber, reply);
      return;
    }

    case "SELECCION_DEPORTE": {
      const sport = text === "1" ? "futbol" : text === "2" ? "padel" : null;
      if (!sport) {
        await sendWhatsappText(normalizedNumber, "Escribí 1 para Fútbol o 2 para Pádel.");
        return;
      }

      await upsertUserState(normalizedNumber, "SELECCION_FECHA", { deporte_elegido: sport });
      await sendWhatsappText(normalizedNumber, "Elegí una fecha en formato DD/MM.");
      return;
    }

    case "SELECCION_FECHA": {
      if (!/^\d{2}\/\d{2}$/.test(text)) {
        await sendWhatsappText(normalizedNumber, "Formato incorrecto. Usá DD/MM, por ejemplo 25/03.");
        return;
      }

      const [day, month] = text.split("/");
      const year = new Date().getFullYear();
      const selectedDate = new Date(year, Number(month) - 1, Number(day));
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
        await sendWhatsappText(normalizedNumber, "❌ No podés elegir una fecha pasada.");
        return;
      }

      const isoDate = `${year}-${month}-${day}`;
      const slotList = user.deporte_elegido === "futbol"
        ? ["19:00", "21:00", "22:30"]
        : ["18:00", "19:30", "21:00"];

      const courtCountResult = await query("SELECT COUNT(*)::int AS total FROM canchas WHERE tipo = $1", [user.deporte_elegido]);
      const busyResult = await query(
        `
          SELECT hora, COUNT(*)::int AS ocupadas
          FROM turnos
          WHERE deporte = $1
            AND fecha = $2
            AND estado IN ('confirmado', 'pendiente')
          GROUP BY hora
        `,
        [user.deporte_elegido, isoDate]
      );

      const freeSlots = slotList.filter((slot) => {
        const row = busyResult.rows.find((item) => item.hora.trim() === slot);
        return !row || row.ocupadas < courtCountResult.rows[0].total;
      });

      if (!freeSlots.length) {
        await sendWhatsappText(normalizedNumber, "❌ No hay horarios libres para esa fecha.");
        return;
      }

      await upsertUserState(normalizedNumber, "SELECCION_HORA", {
        deporte_elegido: user.deporte_elegido,
        fecha_elegida: isoDate
      });

      let message = "Horarios libres:\n\n";
      freeSlots.forEach((slot, index) => {
        message += `${index + 1}. ${slot} hs\n`;
      });
      await sendWhatsappText(normalizedNumber, message);
      return;
    }

    case "SELECCION_HORA": {
      const slotList = user.deporte_elegido === "futbol"
        ? ["19:00", "21:00", "22:30"]
        : ["18:00", "19:30", "21:00"];
      const selectedHour = slotList[Number(text) - 1];

      if (!selectedHour) {
        await sendWhatsappText(normalizedNumber, "Opción inválida. Elegí un número de horario.");
        return;
      }

      const freeCourtsResult = await query(
        `
          SELECT id, nombre
          FROM canchas
          WHERE tipo = $1
            AND id NOT IN (
              SELECT cancha_id
              FROM turnos
              WHERE fecha = $2
                AND hora = $3
                AND estado IN ('confirmado', 'pendiente')
            )
          ORDER BY nombre
        `,
        [user.deporte_elegido, user.fecha_elegida, selectedHour]
      );

      if (!freeCourtsResult.rows.length) {
        await sendWhatsappText(normalizedNumber, "No quedaron canchas disponibles para ese horario.");
        return;
      }

      await upsertUserState(normalizedNumber, "SELECCION_CANCHA", {
        deporte_elegido: user.deporte_elegido,
        fecha_elegida: user.fecha_elegida,
        hora_elegida: selectedHour
      });

      let message = "Canchas disponibles:\n\n";
      freeCourtsResult.rows.forEach((court, index) => {
        message += `${index + 1}. ${court.nombre}\n`;
      });
      await sendWhatsappText(normalizedNumber, message);
      return;
    }

    case "SELECCION_CANCHA": {
      const freeCourtsResult = await query(
        `
          SELECT id, nombre
          FROM canchas
          WHERE tipo = $1
            AND id NOT IN (
              SELECT cancha_id
              FROM turnos
              WHERE fecha = $2
                AND hora = $3
                AND estado IN ('confirmado', 'pendiente')
            )
          ORDER BY nombre
        `,
        [user.deporte_elegido, user.fecha_elegida, user.hora_elegida]
      );

      const selectedCourt = freeCourtsResult.rows[Number(text) - 1];
      if (!selectedCourt) {
        await sendWhatsappText(normalizedNumber, "Opción inválida. Elegí una cancha de la lista.");
        return;
      }

      await upsertUserState(normalizedNumber, "ESPERANDO_COMPROBANTE", {
        deporte_elegido: user.deporte_elegido,
        fecha_elegida: user.fecha_elegida,
        hora_elegida: user.hora_elegida,
        cancha_elegida_id: selectedCourt.id
      });

      await sendWhatsappText(
        normalizedNumber,
        `Perfecto, elegiste *${selectedCourt.nombre}*.\n\nAhora enviá una foto o PDF del comprobante, o escribí el número de operación.`
      );
      return;
    }

    case "ESPERANDO_COMPROBANTE": {
      let receiptPath = text || "Comprobante informado por texto";

      if (msgType === "image" || msgType === "document") {
        try {
          const media = msgType === "image" ? msg.image : msg.document;
          receiptPath = await storeWhatsappMedia(media, msgType);
        } catch (error) {
          console.error("No se pudo guardar el comprobante:", error.message);
          receiptPath = "Error al guardar comprobante";
        }
      }

      await query(
        `
          INSERT INTO turnos (numero_whatsapp, deporte, fecha, hora, cancha_id, estado, comprobante_url)
          VALUES ($1, $2, $3, $4, $5, 'pendiente', $6)
        `,
        [
          normalizedNumber,
          user.deporte_elegido,
          user.fecha_elegida,
          user.hora_elegida,
          user.cancha_elegida_id,
          receiptPath
        ]
      );

      await upsertUserState(normalizedNumber, "INICIO");
      await sendWhatsappText(
        normalizedNumber,
        "⏳ *¡Comprobante recibido!*\n\nTu turno quedó pendiente de revisión. Apenas lo validemos, te avisamos por acá."
      );
      return;
    }

    default:
      await upsertUserState(normalizedNumber, "INICIO");
      await sendMainMenu(normalizedNumber);
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.post("/api/login", asyncHandler(async (req, res) => {
  const password = String(req.body?.password || "");
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "ADMIN_PASSWORD no configurado" });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Contraseña incorrecta" });
  }

  setAuthCookie(res, req);
  res.json({ ok: true });
}));

app.get("/api/session", (req, res) => {
  res.json({ authenticated: getSessionFromRequest(req) });
});

app.post("/api/logout", (req, res) => {
  clearAuthCookie(res, req);
  res.json({ ok: true });
});

app.get("/api/dashboard/summary", requireAuth, asyncHandler(async (req, res) => {
  const summaryResult = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM canchas) AS canchas,
      (SELECT COUNT(*)::int FROM menu_dinamico) AS menu_items,
      (SELECT COUNT(*)::int FROM turnos WHERE estado = 'pendiente') AS pendientes,
      (SELECT COUNT(*)::int FROM turnos WHERE estado = 'confirmado' AND fecha >= CURRENT_DATE) AS confirmados_futuros,
      (SELECT COUNT(*)::int FROM estados_usuarios WHERE updated_at >= NOW() - INTERVAL '24 hours') AS conversaciones_24h
  `);

  res.json(summaryResult.rows[0]);
}));

app.get("/api/canchas", requireAuth, asyncHandler(async (req, res) => {
  const result = await query("SELECT * FROM canchas ORDER BY id ASC");
  res.json(result.rows);
}));

app.post("/api/canchas", requireAuth, asyncHandler(async (req, res) => {
  const { id, nombre, tipo } = req.body;
  if (!nombre || !tipo) {
    return res.status(400).json({ error: "Nombre y tipo son obligatorios" });
  }

  if (id) {
    await query("UPDATE canchas SET nombre = $1, tipo = $2 WHERE id = $3", [nombre, tipo, id]);
  } else {
    await query("INSERT INTO canchas (nombre, tipo) VALUES ($1, $2)", [nombre, tipo]);
  }

  res.json({ ok: true });
}));

app.get("/api/menu", requireAuth, asyncHandler(async (req, res) => {
  await bootstrapSystemData();
  const result = await query("SELECT * FROM menu_dinamico ORDER BY numero_opcion ASC, id ASC");
  res.json(result.rows);
}));

app.post("/api/menu", requireAuth, asyncHandler(async (req, res) => {
  const { id, numero_opcion, titulo, texto_respuesta } = req.body;
  if (!numero_opcion || !titulo) {
    return res.status(400).json({ error: "Número y título son obligatorios" });
  }

  if (id) {
    await query(
      "UPDATE menu_dinamico SET numero_opcion = $1, titulo = $2, texto_respuesta = $3 WHERE id = $4",
      [numero_opcion, titulo, texto_respuesta || "", id]
    );
  } else {
    await query(
      "INSERT INTO menu_dinamico (numero_opcion, titulo, tipo_accion, texto_respuesta) VALUES ($1, $2, 'informativo', $3)",
      [numero_opcion, titulo, texto_respuesta || ""]
    );
  }

  res.json({ ok: true });
}));

app.delete("/api/menu/:id", requireAuth, asyncHandler(async (req, res) => {
  await query("DELETE FROM menu_dinamico WHERE id = $1 AND tipo_accion = 'informativo'", [req.params.id]);
  res.json({ ok: true });
}));

app.get("/api/reservas", requireAuth, asyncHandler(async (req, res) => {
  const { fecha } = req.query;
  const params = [];
  let sql = `
    SELECT
      t.id,
      t.numero_whatsapp,
      t.deporte,
      TO_CHAR(t.fecha, 'YYYY-MM-DD') AS fecha_iso,
      TO_CHAR(t.fecha, 'DD/MM/YYYY') AS fecha,
      t.hora,
      t.estado,
      t.comprobante_url,
      c.nombre AS cancha
    FROM turnos t
    JOIN canchas c ON c.id = t.cancha_id
  `;

  if (fecha) {
    sql += " WHERE t.fecha = $1";
    params.push(fecha);
  }

  sql += " ORDER BY CASE WHEN t.estado = 'pendiente' THEN 0 ELSE 1 END, t.fecha DESC, t.hora DESC";
  const result = await query(sql, params);
  res.json(result.rows);
}));

app.post("/api/reservas/:id/estado", requireAuth, asyncHandler(async (req, res) => {
  const bookingId = Number(req.params.id);
  const action = req.body?.accion;

  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: "ID inválido" });
  }

  let booking;

  if (action === "confirmar") {
    const result = await query(
      "UPDATE turnos SET estado = 'confirmado' WHERE id = $1 RETURNING *",
      [bookingId]
    );
    booking = result.rows[0];
  } else if (action === "rechazar") {
    const result = await query(
      "DELETE FROM turnos WHERE id = $1 RETURNING *",
      [bookingId]
    );
    booking = result.rows[0];
  } else {
    return res.status(400).json({ error: "Acción inválida" });
  }

  if (!booking) {
    return res.status(404).json({ error: "Reserva no encontrada" });
  }

let whatsapp = {
  sent: false,
  error: null,
  mode: null
};

try {
  if (action === "confirmar") {
    await sendWhatsappText(
      booking.numero_whatsapp,
      "✅ ¡Tu reserva fue confirmada!\nYa verificamos el pago. Te esperamos."
    );
  } else {
    await sendWhatsappText(
      booking.numero_whatsapp,
      "❌ Tu reserva fue rechazada.\nHubo un problema con el comprobante o el pago. Escribinos para revisarlo."
    );
  }

  whatsapp = {
    sent: true,
    error: null,
    mode: "text"
  };
} catch (error) {
  const metaError = error.response?.data?.error;
  whatsapp = {
    sent: false,
    error: metaError?.message || error.message || "Error desconocido",
    mode: null
  };

  console.error("No se pudo enviar el mensaje al usuario:");
  console.error("Status:", error.response?.status);
  console.error("Meta error:", JSON.stringify(metaError, null, 2));
}

res.json({ ok: true, whatsapp });
}));

app.get("/api/media/:id", requireAuth, asyncHandler(async (req, res) => {
  const result = await query("SELECT * FROM media_files WHERE id = $1", [req.params.id]);
  const media = result.rows[0];

  if (!media) {
    return res.status(404).send("Archivo no encontrado");
  }

  res.setHeader("Content-Type", media.mime_type);
  res.setHeader("Content-Disposition", `inline; filename=\"${media.filename}\"`);
  res.send(Buffer.from(media.content_base64, "base64"));
}));

app.get(["/webhook", "/api/webhook"], (req, res) => {
  const verifyToken = process.env.VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post(["/webhook", "/api/webhook"], asyncHandler(handleIncomingWhatsappMessage));

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Ruta no encontrada" });
  }
  return res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);

  const isApi = req.path.startsWith("/api") || req.path === "/webhook";
  const message = error.code === "23505"
    ? "Ya existe un registro con ese número de opción."
    : (error.message || "Error interno del servidor");

  if (isApi) {
    return res.status(500).json({ error: message });
  }

  return res.status(500).send(message);
});

module.exports = app;
