# Despliegue en Railway (acceso desde internet)

Railway es una plataforma gratuita para alojar el servidor en la nube.
Con esto la app funciona desde cualquier red — datos móviles o WiFi.

## Pasos

### 1. Crear cuenta en Railway
Entra a https://railway.app y regístrate con GitHub.

### 2. Instalar Railway CLI (opcional, para despliegue desde terminal)
npm install -g @railway/cli

### 3. Subir el proyecto a GitHub primero
En la carpeta dragmoto-backend:
  git init
  git add .
  git commit -m "DragMoto backend v2"
  git branch -M main
  git remote add origin https://github.com/TU_USUARIO/dragmoto-backend.git
  git push -u origin main

### 4. Crear proyecto en Railway
- Entra a railway.app/dashboard
- Clic en "New Project"
- Selecciona "Deploy from GitHub repo"
- Elige tu repositorio dragmoto-backend

### 5. Configurar variables de entorno en Railway
En el panel de Railway → tu proyecto → Variables:
  PORT       = 3000
  MONGO_URI  = (tu URL de MongoDB Atlas)
  JWT_SECRET = dragmoto_clave_secreta_2025

### 6. Railway detecta automáticamente Node.js y ejecuta:
  npm install
  npm start

### 7. Obtener la URL pública
Railway genera una URL como:
  https://dragmoto-backend-production.up.railway.app

### 8. Actualizar RetrofitClient.kt en Android
Cambia la BASE_URL por la URL de Railway:
  private const val BASE_URL = "https://dragmoto-backend-production.up.railway.app/api/"

Ahora la app funciona desde cualquier red (datos o WiFi).
El dashboard está en: https://dragmoto-backend-production.up.railway.app

## Plan gratuito de Railway
- 500 horas/mes de ejecución (suficiente para desarrollo y clase)
- Sin tarjeta de crédito requerida
- El servidor puede dormir si no recibe tráfico en 30 min
  (se despierta automáticamente con la primera petición)
