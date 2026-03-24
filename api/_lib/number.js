const PREFIJOS_TRES_DIGITOS = new Set([
  "220", "221", "223", "230", "236", "237", "249", "260", "261", "263",
  "264", "266", "280", "291", "294", "297", "298", "299", "336", "341",
  "342", "343", "345", "348", "351", "353", "358", "362", "364", "370",
  "376", "379", "380", "381", "383", "385", "387", "388"
]);

function normalizeArgentinaWhatsappNumber(rawValue = "") {
  const digits = String(rawValue).replace(/\D/g, "");
  if (!digits) return "";

  if (!digits.startsWith("54")) {
    return digits;
  }

  let body = digits.slice(2);

  if (body.startsWith("9")) {
    body = body.slice(1);
  }

  let areaCode = "";
  if (body.startsWith("11")) {
    areaCode = "11";
  } else {
    const firstThree = body.slice(0, 3);
    areaCode = PREFIJOS_TRES_DIGITOS.has(firstThree) ? firstThree : body.slice(0, 4);
  }

  let subscriber = body.slice(areaCode.length);
  if (!subscriber.startsWith("15")) {
    subscriber = `15${subscriber}`;
  }

  return `54${areaCode}${subscriber}`;
}

module.exports = { normalizeArgentinaWhatsappNumber };
