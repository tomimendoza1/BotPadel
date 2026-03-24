CREATE TABLE IF NOT EXISTS canchas (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('futbol', 'padel')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_dinamico (
  id SERIAL PRIMARY KEY,
  numero_opcion INTEGER NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  tipo_accion TEXT NOT NULL CHECK (tipo_accion IN ('informativo', 'sistema_reservar', 'sistema_turnos', 'sistema_ia')),
  texto_respuesta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estados_usuarios (
  numero_whatsapp TEXT PRIMARY KEY,
  estado TEXT NOT NULL DEFAULT 'INICIO',
  deporte_elegido TEXT CHECK (deporte_elegido IN ('futbol', 'padel')),
  fecha_elegida DATE,
  hora_elegida TEXT,
  cancha_elegida_id INTEGER REFERENCES canchas(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS turnos (
  id SERIAL PRIMARY KEY,
  numero_whatsapp TEXT NOT NULL,
  deporte TEXT NOT NULL CHECK (deporte IN ('futbol', 'padel')),
  fecha DATE NOT NULL,
  hora TEXT NOT NULL,
  cancha_id INTEGER NOT NULL REFERENCES canchas(id) ON DELETE RESTRICT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmado')),
  comprobante_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_turnos_fecha_estado ON turnos (fecha, estado);
CREATE INDEX IF NOT EXISTS idx_turnos_numero ON turnos (numero_whatsapp);
CREATE INDEX IF NOT EXISTS idx_estados_updated_at ON estados_usuarios (updated_at DESC);

INSERT INTO canchas (nombre, tipo)
SELECT 'Cancha Fútbol 1', 'futbol'
WHERE NOT EXISTS (SELECT 1 FROM canchas WHERE nombre = 'Cancha Fútbol 1');

INSERT INTO canchas (nombre, tipo)
SELECT 'Cancha Pádel 1', 'padel'
WHERE NOT EXISTS (SELECT 1 FROM canchas WHERE nombre = 'Cancha Pádel 1');
