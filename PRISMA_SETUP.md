# Prisma + Neon

Este proyecto ya quedó con Prisma armado para PostgreSQL/Neon.

## Archivos agregados
- `prisma/schema.prisma`
- `prisma/migrations/20260324_init/migration.sql`
- `prisma/seed.js`
- `prisma.config.ts`

## Modelos creados
- `Cancha`
- `MenuDinamico`
- `EstadoUsuario`
- `MediaFile`
- `Turno`

## Comandos
```bash
npm install
npx prisma migrate deploy
node prisma/seed.js
```

## Desarrollo local
```bash
npx prisma migrate dev --name init
node prisma/seed.js
npm run dev
```

## Nota
El backend actual sigue usando `pg` para las consultas SQL. Prisma ya quedó configurado para manejar el esquema, las migraciones y el seed sin romper el código actual.
