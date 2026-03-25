const axios = require("axios");

function getWhatsappCredentials() {
  return {
    token: process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID
  };
}

async function sendWhatsappText(to, body) {
  const { token, phoneNumberId } = getWhatsappCredentials();

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
  getMediaMeta,
  downloadMediaBuffer
};