# Prompt para Claude Code — Deploy de Helm

Pega este prompt completo en Claude Code estando dentro de la carpeta `helm-app` después de descomprimir el zip:

---

```
Acabo de descomprimir un proyecto Next.js 15 llamado Helm en esta carpeta. 
Necesito que me ayudes a configurarlo, conectarlo a Supabase, y desplegarlo a Vercel.

PASO 1 — Verificar estructura
Lee primero el archivo SETUP.md para entender el proyecto. Luego confirma que tenemos:
- package.json
- next.config.mjs  
- middleware.ts
- /app, /lib, /components folders
- .env.example

PASO 2 — Instalar dependencias
Ejecuta: npm install

PASO 3 — Crear cuenta de Supabase
Pausa aquí y dame estas instrucciones para que las haga yo manualmente:
1. Ir a supabase.com → New project → nombre "helm-prod"
2. Esperar 2 min a que se cree
3. Copiar de Settings → API:
   - Project URL
   - anon public key
   - service_role key  
4. Copiar de Settings → Database:
   - Connection string (Transaction pooler, port 6543)

Pídeme que te pase estos 4 valores antes de continuar.

PASO 4 — Configurar GitHub OAuth
Cuando ya tenga las credenciales de Supabase:
1. Guíame para ir a Supabase → Authentication → Providers → GitHub → enable
2. Guíame para crear OAuth App en github.com/settings/developers:
   - Homepage URL: http://localhost:3000 (lo cambiamos después)
   - Callback URL: la copiamos de Supabase
3. Pídeme que te pase el GitHub Client ID y Client Secret
4. Te los doy y los configuras en Supabase

PASO 5 — Obtener Anthropic API key
Pídeme:
1. Crear cuenta en console.anthropic.com
2. Settings → API Keys → Create Key (nombre "helm-prod")
3. Settings → Billing → agregar $10 de crédito
4. Pásame la API key (empieza con sk-ant-)

PASO 6 — Generar keys de seguridad
Ejecuta tú estos comandos y guarda los outputs:
- openssl rand -hex 32   (para ENCRYPTION_KEY)
- openssl rand -base64 32   (para CRON_SECRET)

PASO 7 — Crear .env.local
Toma el .env.example y crea un .env.local con todos los valores reales que recolectamos:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- DATABASE_URL
- ANTHROPIC_API_KEY  
- ENCRYPTION_KEY
- CRON_SECRET
- NEXT_PUBLIC_APP_URL=http://localhost:3000

(Saltamos por ahora GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, VERCEL_*  
porque GitHub OAuth se maneja vía Supabase, y Vercel/Meta los pondrá cada usuario manual)

PASO 8 — Migraciones de DB
Ejecuta: npm run db:push
Esto crea todas las tablas en Supabase Postgres.

Si hay errores de schema, ayúdame a debuggearlos.

PASO 9 — Test local
Ejecuta: npm run dev
Pídeme que abra http://localhost:3000, intente login con GitHub, y reporte si:
- La landing carga
- El botón "Sign in" me lleva a GitHub
- Después de autorizar, me lleva a /onboarding
- /onboarding muestra mis repos detectados como SaaS

PASO 10 — Si todo funciona local, deploy a Vercel
1. Init git si no está: git init && git add . && git commit -m "Initial Helm app"
2. Crear repo en GitHub (pídeme el nombre, sugerencia "helm-app")
3. git remote add origin <url> && git push -u origin main
4. Ejecuta: vercel
5. Después del primer deploy, pide que copie las variables del .env.local a Vercel:
   vercel env add NEXT_PUBLIC_SUPABASE_URL production
   (y todas las demás, una por una)
6. Cambia NEXT_PUBLIC_APP_URL a la URL de producción
7. Re-deploy: vercel --prod
8. Dame la URL final

PASO 11 — Update GitHub OAuth para producción
Pídeme que:
1. Vaya a github.com/settings/developers → mi OAuth App
2. Agregue como callback URL adicional: https://[mi-dominio]/auth/callback
3. Vaya a Supabase → Auth → URL Configuration → agregar redirect URL de producción

PASO 12 — Verificación final  
Pídeme que vaya a la URL de producción, haga signup con GitHub, complete onboarding,
y vea el dashboard de Analytics. Reportar cualquier error.

PASO 13 — Configurar la integración con Vercel/Supabase Mgmt para el primer usuario
Ya en producción, guíame para:
1. Ir a /integrations en mi dashboard de Helm
2. Crear un Vercel API token en vercel.com/account/tokens
3. Pegarlo en la sección de Vercel
4. Crear un Supabase Personal Access Token en supabase.com/dashboard/account/tokens
5. Pegarlo + el project ref de uno de mis SaaS

Después de esto el cron debería empezar a sincronizar métricas cada hora.

IMPORTANTE: 
- Si en cualquier paso necesitas que yo haga algo manual, PAUSA y dame instrucciones claras
- Si encuentras errores, debuggea conmigo antes de seguir
- No avances al siguiente paso hasta confirmar que el actual funciona
```

---

## Antes de pegar el prompt

1. Descomprime `helm-app.zip` en una carpeta de tu computadora
2. Abre la terminal en esa carpeta
3. Ejecuta: `claude` (asumiendo que tienes Claude Code instalado, si no: `npm i -g @anthropic-ai/claude-code`)
4. Pega el prompt completo

## Tiempo estimado

- Crear cuentas: 15 min
- Setup local: 20 min  
- Test local: 10 min
- Deploy a Vercel: 15 min
- Conectar primera integración: 10 min

**Total: ~70 minutos** para tener Helm funcional en producción.

## Si algo se rompe

Los errores más comunes y soluciones están en `SETUP.md` sección **Common issues**.

Buena suerte 🚀
