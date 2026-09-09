# Basic OEE v2

Versión simplificada de BIOEE para registrar y analizar exclusivamente detenciones no planificadas por lote, orden de trabajo y equipo.

## Alcance funcional

- El operario selecciona una OT y registra causa, duración, comentario y ticket de mantenimiento cuando corresponde.
- El supervisor conserva Dashboard, Órdenes OT, Validaciones, Administración y Asistente IA.
- El Dashboard mide tiempo de operación, minutos detenidos, disponibilidad e incidencias.
- Incluye Pareto de causas, pérdida por equipo y resumen por OT.

## Ejecutar localmente

Requiere Node.js 20 o superior.

```bash
npm install
npm run dev
```

Luego abre la dirección mostrada por Vite, normalmente `http://localhost:5173`.

## Configurar Supabase

El repositorio incluye el esquema inicial versionado en `supabase/migrations`.

1. Vincula este repositorio al proyecto Supabase y usa `.` como Working directory.
2. Aplica la migración `202609030001_initial_bioee_schema.sql`.
3. Copia `.env.example` como `.env.local` y completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Añade las mismas variables en Vercel para Production y Preview.
5. Crea los usuarios desde Supabase Authentication. El disparador crea su perfil como operario.
6. Para convertir al primer usuario en supervisor, ejecuta en SQL Editor:

```sql
update public.profiles
set role = 'supervisor'
where id = (select id from auth.users where email = 'correo@biomont.com.pe');
```

El acceso inicial permite seleccionar directamente Operario o Supervisor. Si se configura Supabase, debe usarse un proyecto independiente del utilizado por BIOEE para no mezclar datos.

## Editar en línea

Una vez creado el repositorio, podrá editarse desde `https://github.dev/Mao1216/basic_oee_v2`.
