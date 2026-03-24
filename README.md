# WhatsApp Bot + Panel Admin

Proyecto adaptado para trabajar con **Neon** como base de datos y **Vercel** como hosting.

## Qué cambió

- Panel `index.html` reconstruido con una interfaz más moderna.
- `styles.css` y `app.js` separados para mantener ordenado el frontend.
- Login por cookie firmada, compatible con entorno serverless.
- Backend modularizado.
- Webhook de WhatsApp mantenido.
- Comprobantes guardados en la base de datos en vez de disco local.
- Preparado para deploy en Vercel con `vercel.json`.

## Estructura

- `public/` → interfaz admin.
- `api/` → función serverless para Vercel.
- `src/server.js` → arranque local.
- `sql/schema.sql` → estructura inicial de Neon.
- `.env.example` → variables necesarias.

## Desarrollo local

```bash
npm install
npm run dev
```

Abrir en:

```bash
http://localhost:5000
```

## Deploy

1. Crear proyecto en Neon.
2. Ejecutar `sql/schema.sql` en el SQL Editor de Neon.
3. Crear proyecto en Vercel y conectar el repo.
4. Cargar variables de entorno usando `.env.example` como guía.
5. Configurar el webhook de Meta apuntando a:

```text
https://tu-dominio.vercel.app/webhook
```
