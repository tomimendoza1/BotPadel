const axios = require("axios");

const creds = getWhatsappCredentials();
console.log(`[WA BOOT][PID ${process.pid}] phoneNumberId=${creds.phoneNumberId} token=*${String(creds.token || "").slice(-8)}`);

function getWhatsappCredentials() {
  return {
    token: process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID
  };
}

async function sendWhatsappTemplate(to, templateName, bodyParameters = [], languageCode = "es_AR") {
	const { token, phoneNumberId } = getWhatsappCredentials();
  const suffix = String(token || "").slice(-8);
  console.log(`[WA TEMPLATE][PID ${process.pid}] to=${to} phoneNumberId=${phoneNumberId} token=*${suffix} template=${templateName}`);
	if (!token || !phoneNumberId) {
		throw new Error("Faltan WA_ACCESS_TOKEN o WA_PHONE_NUMBER_ID");
	}

	const components = bodyParameters.length
		? [
				{
					type: "body",
					parameters: bodyParameters.map((value) => ({
						type: "text",
						text: String(value ?? "")
					}))
				}
		  ]
		: [];

	console.log("📤 Enviando template WhatsApp a:", to);
	console.log("🧩 Template:", templateName, bodyParameters);

	const response = await axios.post(
		`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
		{
			messaging_product: "whatsapp",
			to,
			type: "template",
			template: {
				name: templateName,
				language: { code: languageCode },
				components
			}
		},
		{
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json"
			},
			timeout: 15000
		}
	);

	return response.data;
}


async function sendWhatsappText(to, body) {
  const { token, phoneNumberId } = getWhatsappCredentials();
  const suffix = String(token || "").slice(-8);
  console.log(`[WA TEXT][PID ${process.pid}] to=${to} phoneNumberId=${phoneNumberId} token=*${suffix}`);
  if (!token || !phoneNumberId) {
    console.warn("⚠️ Faltan WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID");
    return { skipped: true };
  }

  try {
    console.log("📤 Enviando WhatsApp a:", to);
    console.log("📝 Texto:", body);
    
    const response = await axios.post(
      `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    console.log("✅ WhatsApp enviado:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Error enviando WhatsApp");
    console.error("Status:", error.response?.status);
    console.error("Data:", JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
}

async function getMediaMeta(mediaId) {
  const { token } = getWhatsappCredentials();
  if (!token) throw new Error("Falta WA_ACCESS_TOKEN");

  const response = await axios.get(`https://graph.facebook.com/v25.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000
  });

  return response.data;
}

async function downloadMediaBuffer(url) {
  const { token } = getWhatsappCredentials();
  if (!token) throw new Error("Falta WA_ACCESS_TOKEN");

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000
  });

  return Buffer.from(response.data);
}

module.exports = {
	sendWhatsappText,
	sendWhatsappTemplate,
	getMediaMeta,
	downloadMediaBuffer
};