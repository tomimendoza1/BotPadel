require("dotenv").config();
const app = require("../api/_lib/app");

const port = Number(process.env.PORT || 5000);
app.listen(port, () => {
  console.log(`🚀 Panel y bot corriendo en http://localhost:${port}`);
});
