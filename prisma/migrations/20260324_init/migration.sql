-- CreateEnum
CREATE TYPE "Deporte" AS ENUM ('futbol', 'padel');

-- CreateEnum
CREATE TYPE "TipoAccion" AS ENUM ('informativo', 'sistema_reservar', 'sistema_turnos', 'sistema_ia');

-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('pendiente', 'confirmado');

-- CreateTable
CREATE TABLE "canchas" (
  "id" SERIAL NOT NULL,
  "nombre" TEXT NOT NULL,
  "tipo" "Deporte" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canchas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_dinamico" (
  "id" SERIAL NOT NULL,
  "numero_opcion" INTEGER NOT NULL,
  "titulo" TEXT NOT NULL,
  "tipo_accion" "TipoAccion" NOT NULL,
  "texto_respuesta" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "menu_dinamico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estados_usuarios" (
  "numero_whatsapp" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'INICIO',
  "deporte_elegido" "Deporte",
  "fecha_elegida" DATE,
  "hora_elegida" TEXT,
  "cancha_elegida_id" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "estados_usuarios_pkey" PRIMARY KEY ("numero_whatsapp")
);

-- CreateTable
CREATE TABLE "media_files" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "content_base64" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
  "id" SERIAL NOT NULL,
  "numero_whatsapp" TEXT NOT NULL,
  "deporte" "Deporte" NOT NULL,
  "fecha" DATE NOT NULL,
  "hora" TEXT NOT NULL,
  "cancha_id" INTEGER NOT NULL,
  "estado" "EstadoTurno" NOT NULL DEFAULT 'pendiente',
  "comprobante_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menu_dinamico_numero_opcion_key" ON "menu_dinamico"("numero_opcion");

-- CreateIndex
CREATE INDEX "idx_estados_updated_at" ON "estados_usuarios"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_turnos_fecha_estado" ON "turnos"("fecha", "estado");

-- CreateIndex
CREATE INDEX "idx_turnos_numero" ON "turnos"("numero_whatsapp");

-- AddForeignKey
ALTER TABLE "estados_usuarios"
ADD CONSTRAINT "estados_usuarios_cancha_elegida_id_fkey"
FOREIGN KEY ("cancha_elegida_id") REFERENCES "canchas"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos"
ADD CONSTRAINT "turnos_cancha_id_fkey"
FOREIGN KEY ("cancha_id") REFERENCES "canchas"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
