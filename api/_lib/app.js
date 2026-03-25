const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { query } = require("./db");
const { requireAuth, setAuthCookie, clearAuthCookie, getSessionFromRequest } = require("./auth");
const { normalizeArgentinaWhatsappNumber } = require("./number");
const { sendWhatsappText, getMediaMeta, downloadMediaBuffer } = require("./whatsapp");

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

	const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
	if (!msg) return;

	await bootstrapSystemData();

	const rawNumber = String(msg.from || "").replace(/\D/g, "");
	const text = typeof msg.text?.body === "string"
		? msg.text.body.trim().toLowerCase()
		: "";
	const msgType = msg.type;

	const userResult = await query(
		"SELECT * FROM estados_usuarios WHERE numero_whatsapp = $1",
		[rawNumber]
	);
	const user = userResult.rows[0] || { estado: "INICIO" };

	const resetCommands = new Set(["hola", "menu", "menú", "salir", "0"]);
	const assistantEntryCommands = new Set(["33", "asistente", "ia", "ayuda"]);

	if (msgType === "text" && resetCommands.has(text)) {
		await upsertUserState(rawNumber, "INICIO");
		await sendMainMenu(rawNumber);
		return;
	}

	switch (user.estado) {
		case "INICIO": {
			if (msgType !== "text") {
				await sendMainMenu(rawNumber);
				return;
			}

			const optionNumber = Number(text);

			if (Number.isInteger(optionNumber) && text.length <= 2) {
				const optionResult = await query(
					"SELECT * FROM menu_dinamico WHERE numero_opcion = $1",
					[optionNumber]
				);
				const option = optionResult.rows[0];

				if (!option) {
					await sendWhatsappText(rawNumber, "Opción inválida. Elegí un número de la lista.");
					return;
				}

				if (option.tipo_accion === "sistema_reservar") {
					await upsertUserState(rawNumber, "SELECCION_DEPORTE");
					await sendWhatsappText(rawNumber, "Indicame el deporte:\n1. ⚽ Fútbol\n2. 🎾 Pádel");
					return;
				}

				if (option.tipo_accion === "sistema_turnos") {
					const upcomingResult = await query(
						`
							SELECT
								TO_CHAR(fecha, 'DD/MM') AS fecha_corta,
								hora,
								(SELECT nombre FROM canchas WHERE id = cancha_id) AS cancha
							FROM turnos
							WHERE numero_whatsapp = $1
							  AND estado = 'confirmado'
							  AND fecha >= CURRENT_DATE
							ORDER BY fecha, hora
						`,
						[rawNumber]
					);

					let message = upcomingResult.rows.length
						? "📋 *Tus turnos confirmados:*\n"
						: "No tenés turnos confirmados por ahora.";

					upcomingResult.rows.forEach((row) => {
						message += `\n📅 ${row.fecha_corta} - ${row.hora} hs (${row.cancha})`;
					});

					await sendWhatsappText(rawNumber, message);
					return;
				}

				if (option.tipo_accion === "sistema_ia") {
					await upsertUserState(rawNumber, "HABLANDO_CON_IA");
					await sendWhatsappText(
						rawNumber,
						"🤖 *Modo asistente activado*\n\nPreguntame lo que necesites sobre el complejo. Para volver al menú, escribí *menu*."
					);
					return;
				}

				await sendWhatsappText(
					rawNumber,
					option.texto_respuesta || "Sin respuesta configurada."
				);
				return;
			}

			let reply;
			try {
				reply = await askAssistant(text || "hola", "menu");
			} catch (error) {
				console.error("❌ Error con Gemini en menú:", error.message);
				reply = "Ahora mismo el asistente virtual no está disponible. Escribí *menu* para ver las opciones.";
			}

			await sendWhatsappText(rawNumber, reply);
			return;
		}

		case "HABLANDO_CON_IA": {
			if (msgType !== "text") {
				await sendWhatsappText(
					rawNumber,
					"En modo asistente solo puedo responder mensajes de texto. Escribí tu consulta o *menu* para volver."
				);
				return;
			}

			if (resetCommands.has(text)) {
				await upsertUserState(rawNumber, "INICIO");
				await sendMainMenu(rawNumber);
				return;
			}

			let reply;
			try {
				reply = await askAssistant(text || "hola", "assistant");
			} catch (error) {
				console.error("❌ Error con Gemini en asistente:", error.message);
				reply = "Ahora mismo el asistente virtual no está disponible. Escribí *menu* para volver al inicio.";
			}

			await sendWhatsappText(rawNumber, reply);
			return;
		}

		case "SELECCION_DEPORTE": {
			if (msgType !== "text") {
				await sendWhatsappText(rawNumber, "Escribí 1 para Fútbol o 2 para Pádel.");
				return;
			}

			const sport = text === "1" ? "futbol" : text === "2" ? "padel" : null;

			if (!sport) {
				await sendWhatsappText(rawNumber, "Escribí 1 para Fútbol o 2 para Pádel.");
				return;
			}

			await upsertUserState(rawNumber, "SELECCION_FECHA", {
				deporte_elegido: sport
			});
			await sendWhatsappText(rawNumber, "Elegí una fecha en formato DD/MM.");
			return;
		}

		case "SELECCION_FECHA": {
			if (msgType !== "text") {
				await sendWhatsappText(rawNumber, "Mandame la fecha en formato DD/MM, por ejemplo 25/03.");
				return;
			}

			if (!/^\d{2}\/\d{2}$/.test(text)) {
				await sendWhatsappText(rawNumber, "Formato incorrecto. Usá DD/MM, por ejemplo 25/03.");
				return;
			}

			const [day, month] = text.split("/");
			const year = new Date().getFullYear();
			const selectedDate = new Date(year, Number(month) - 1, Number(day));
			const today = new Date();
			today.setHours(0, 0, 0, 0);

			if (Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
				await sendWhatsappText(rawNumber, "❌ No podés elegir una fecha pasada.");
				return;
			}

			const isoDate = `${year}-${month}-${day}`;
			const slotList = user.deporte_elegido === "futbol"
				? ["19:00", "21:00", "22:30"]
				: ["18:00", "19:30", "21:00"];

			const courtCountResult = await query(
				"SELECT COUNT(*)::int AS total FROM canchas WHERE tipo = $1",
				[user.deporte_elegido]
			);

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

			const totalCourts = Number(courtCountResult.rows[0]?.total || 0);

			const freeSlots = slotList.filter((slot) => {
				const row = busyResult.rows.find((item) => String(item.hora).trim() === slot);
				return !row || Number(row.ocupadas) < totalCourts;
			});

			if (!freeSlots.length) {
				await sendWhatsappText(rawNumber, "❌ No hay horarios libres para esa fecha.");
				return;
			}

			await upsertUserState(rawNumber, "SELECCION_HORA", {
				deporte_elegido: user.deporte_elegido,
				fecha_elegida: isoDate
			});

			let message = "Horarios libres:\n\n";
			freeSlots.forEach((slot, index) => {
				message += `${index + 1}. ${slot} hs\n`;
			});

			await sendWhatsappText(rawNumber, message);
			return;
		}

		case "SELECCION_HORA": {
			if (msgType !== "text") {
				await sendWhatsappText(rawNumber, "Elegí un horario escribiendo el número de la lista.");
				return;
			}

			const slotList = user.deporte_elegido === "futbol"
				? ["19:00", "21:00", "22:30"]
				: ["18:00", "19:30", "21:00"];

			const selectedHour = slotList[Number(text) - 1];

			if (!selectedHour) {
				await sendWhatsappText(rawNumber, "Opción inválida. Elegí un número de horario.");
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
				await sendWhatsappText(rawNumber, "No quedaron canchas disponibles para ese horario.");
				return;
			}

			await upsertUserState(rawNumber, "SELECCION_CANCHA", {
				deporte_elegido: user.deporte_elegido,
				fecha_elegida: user.fecha_elegida,
				hora_elegida: selectedHour
			});

			let message = "Canchas disponibles:\n\n";
			freeCourtsResult.rows.forEach((court, index) => {
				message += `${index + 1}. ${court.nombre}\n`;
			});

			await sendWhatsappText(rawNumber, message);
			return;
		}

		case "SELECCION_CANCHA": {
			if (msgType !== "text") {
				await sendWhatsappText(rawNumber, "Elegí una cancha escribiendo el número de la lista.");
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
				[user.deporte_elegido, user.fecha_elegida, user.hora_elegida]
			);

			const selectedCourt = freeCourtsResult.rows[Number(text) - 1];

			if (!selectedCourt) {
				await sendWhatsappText(rawNumber, "Opción inválida. Elegí una cancha de la lista.");
				return;
			}

			await upsertUserState(rawNumber, "ESPERANDO_COMPROBANTE", {
				deporte_elegido: user.deporte_elegido,
				fecha_elegida: user.fecha_elegida,
				hora_elegida: user.hora_elegida,
				cancha_elegida_id: selectedCourt.id
			});

			await sendWhatsappText(
				rawNumber,
				`Perfecto, elegiste *${selectedCourt.nombre}*.\n\nAhora enviá una foto o PDF del comprobante, o escribí el número de operación.`
			);
			return;
		}

		case "ESPERANDO_COMPROBANTE": {
			let receiptPath = null;

			if (msgType === "text" && text) {
				receiptPath = text;
			} else if (msgType === "image" || msgType === "document") {
				try {
					const media = msgType === "image" ? msg.image : msg.document;
					receiptPath = await storeWhatsappMedia(media, msgType);
				} catch (error) {
					console.error("No se pudo guardar el comprobante:", error.message);
					await sendWhatsappText(
						rawNumber,
						"No pude guardar el comprobante. Probá de nuevo mandando una foto, PDF o número de operación."
					);
					return;
				}
			} else {
				await sendWhatsappText(
					rawNumber,
					"Mandame una foto, PDF del comprobante o escribí el número de operación."
				);
				return;
			}

			await query(
				`
					INSERT INTO turnos (
						numero_whatsapp,
						deporte,
						fecha,
						hora,
						cancha_id,
						estado,
						comprobante_url
					)
					VALUES ($1, $2, $3, $4, $5, 'pendiente', $6)
				`,
				[
					rawNumber,
					user.deporte_elegido,
					user.fecha_elegida,
					user.hora_elegida,
					user.cancha_elegida_id,
					receiptPath
				]
			);

			await upsertUserState(rawNumber, "INICIO");
			await sendWhatsappText(
				rawNumber,
				"⏳ *¡Comprobante recibido!*\n\nTu turno quedó pendiente de revisión. Apenas lo validemos, te avisamos por acá."
			);
			return;
		}

		default: {
			await upsertUserState(rawNumber, "INICIO");
			await sendMainMenu(rawNumber);
		}
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

  let messageSent = true;

  try {
    if (action === "confirmar") {
      await sendWhatsappText(
        booking.numero_whatsapp,
        "✅ *¡Tu reserva fue confirmada!*\nYa verificamos el pago. Te esperamos."
      );
    } else {
      await sendWhatsappText(
        booking.numero_whatsapp,
        "❌ *Tu reserva fue rechazada.*\nHubo un problema con el comprobante o el pago. Escribinos para revisarlo."
      );
    }
  } catch (error) {
    messageSent = false;
    console.error("No se pudo enviar el mensaje al usuario:", error.message);
  }

  res.json({ ok: true, messageSent });
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
