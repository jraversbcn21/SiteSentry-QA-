# 🔒 Guía de Seguridad - SiteSentry QA

## Problema de Seguridad Detectado

Supabase Security Advisor ha detectado que las tablas en el schema `public` no tienen Row Level Security (RLS) habilitado. Esto significa que las tablas están expuestas públicamente a través de PostgREST sin protección.

## Solución Implementada

Este proyecto usa **Prisma** para acceder a la base de datos directamente mediante connection string. No utiliza la API REST de Supabase (PostgREST). Por lo tanto, la solución es:

1. **Habilitar RLS** en todas las tablas públicas
2. **Denegar acceso público** a través de PostgREST
3. **Mantener acceso vía Prisma** usando la connection string directa

## Pasos para Aplicar la Solución

### Opción 1: Ejecutar Script SQL en Supabase Dashboard (Recomendado)

1. **Abre el Dashboard de Supabase**
   - Ve a tu proyecto en [supabase.com](https://supabase.com)
   - Selecciona tu proyecto `sitesentry-qa`

2. **Abre el SQL Editor**
   - En el menú lateral, haz clic en **"SQL Editor"**
   - Haz clic en **"New query"**

3. **Ejecuta el Script**
   - Copia el contenido completo del archivo `enable-rls.sql`
   - Pégalo en el editor SQL
   - Haz clic en **"Run"** o presiona `Ctrl+Enter`

4. **Verifica que se aplicó correctamente**
   - Ejecuta esta consulta para verificar:
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public' 
   AND tablename IN ('Scan', 'Issue', '_prisma_migrations');
   ```
   - Todas las tablas deben mostrar `true` en la columna `rowsecurity`

### Opción 2: Ejecutar desde la Línea de Comandos

Si tienes `psql` instalado y configurado:

```bash
# Conectarte a Supabase
psql "postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres"

# Ejecutar el script
\i backend/security/enable-rls.sql

# Verificar
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('Scan', 'Page', 'Issue', '_prisma_migrations');
```

## ¿Qué hace este script?

1. **Habilita RLS** en todas las tablas:
   - `Scan`
   - `Issue`
   - `_prisma_migrations`

2. **Crea políticas de seguridad** que:
   - Deniegan TODO acceso público (`TO public`)
   - Permiten acceso solo vía Prisma (connection string directa)
   - Protegen contra acceso no autorizado a través de PostgREST

## Verificación Post-Aplicación

Después de ejecutar el script:

1. **Verifica en Supabase Security Advisor**
   - Ve a **Settings → Database → Security Advisor**
   - Los errores de RLS deberían desaparecer

2. **Verifica que la aplicación sigue funcionando**
   - Ejecuta un análisis desde la aplicación
   - Verifica que los datos se guardan correctamente
   - Verifica que los reportes se muestran correctamente

## ¿Por qué esto es seguro?

- ✅ **Prisma sigue funcionando**: El acceso vía connection string directa NO se ve afectado por RLS
- ✅ **PostgREST bloqueado**: La API REST pública de Supabase ya no puede acceder a las tablas
- ✅ **Sin cambios en el código**: No necesitas modificar tu código de aplicación
- ✅ **Cumple con estándares de seguridad**: RLS es la práctica recomendada por Supabase

## Notas Importantes

- ⚠️ **No afecta Prisma**: Este cambio NO afecta el acceso vía Prisma usando `DATABASE_URL`
- ⚠️ **Solo protege PostgREST**: Solo bloquea acceso público a través de la API REST de Supabase
- ⚠️ **Reversible**: Si necesitas revertir, puedes ejecutar:
  ```sql
  ALTER TABLE "public"."Scan" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "public"."Issue" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "public"."_prisma_migrations" DISABLE ROW LEVEL SECURITY;
  ```

## Referencias

- [Supabase RLS Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Security Advisor](https://supabase.com/docs/guides/database/database-linter)
- [Prisma + Supabase Best Practices](https://www.prisma.io/docs/guides/database/using-prisma-with-supabase)

