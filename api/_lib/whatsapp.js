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
    console.warn("⚠️ Faltan WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID. No se envió el mensaje.");
    return { skipped: true };
  }

  return axios.post(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
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
}

async function getMediaMeta(mediaId) {
  const { token } = getWhatsappCredentials();
  if (!token) throw new Error("Falta WA_ACCESS_TOKEN");
  const response = await axios.get(`https://graph.facebook.com/v22.0/${mediaId}`, {
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
