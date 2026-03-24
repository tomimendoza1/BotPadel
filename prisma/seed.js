require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function seed() {
  await pool.query(`
    INSERT INTO canchas (nombre, tipo)
    SELECT 'Cancha Fútbol 1', 'futbol'::"Deporte"
    WHERE NOT EXISTS (SELECT 1 FROM canchas WHERE nombre = 'Cancha Fútbol 1');
  `);

  await pool.query(`
    INSERT INTO canchas (nombre, tipo)
    SELECT 'Cancha Pádel 1', 'padel'::"Deporte"
    WHERE NOT EXISTS (SELECT 1 FROM canchas WHERE nombre = 'Cancha Pádel 1');
  `);

  await pool.query(`
    INSERT INTO menu_dinamico (numero_opcion, titulo, tipo_accion, texto_respuesta)
    SELECT 1, 'Reservar cancha ⚽', 'sistema_reservar'::"TipoAccion", 'Sistema de reservas'
    WHERE NOT EXISTS (SELECT 1 FROM menu_dinamico WHERE tipo_accion = 'sistema_reservar'::"TipoAccion");
  `);

  await pool.query(`
    INSERT INTO menu_dinamico (numero_opcion, titulo, tipo_accion, texto_respuesta)
    SELECT 2, 'Ver mis turnos 📋', 'sistema_turnos'::"TipoAccion", 'Sistema de consulta de turnos'
    WHERE NOT EXISTS (SELECT 1 FROM menu_dinamico WHERE tipo_accion = 'sistema_turnos'::"TipoAccion");
  `);

  await pool.query(`
    INSERT INTO menu_dinamico (numero_opcion, titulo, tipo_accion, texto_respuesta)
    SELECT 3, 'Hablar con Asistente Virtual 🤖', 'sistema_ia'::"TipoAccion", 'Modo IA activado'
    WHERE NOT EXISTS (SELECT 1 FROM menu_dinamico WHERE tipo_accion = 'sistema_ia'::"TipoAccion");
  `);
}

seed()
  .then(async () => {
    console.log("✅ Seed completado");
    await pool.end();
  })
  .catch(async (error) => {
    console.error("❌ Error en seed:", error);
    await pool.end();
    process.exit(1);
  });
