-- ============================================
-- Script de Seguridad: Habilitar Row Level Security (RLS)
-- ============================================
-- Este script habilita RLS en todas las tablas públicas para prevenir
-- acceso no autorizado a través de PostgREST de Supabase.
--
-- IMPORTANTE: Este script NO afecta el acceso vía Prisma usando la connection string directa.
-- Solo protege contra acceso público a través de la API REST de Supabase.
-- ============================================

-- Habilitar RLS en la tabla Scan
ALTER TABLE "public"."Scan" ENABLE ROW LEVEL SECURITY;

-- Política: Denegar todo acceso público a Scan
-- Solo el acceso vía Prisma (connection string directa) funcionará
CREATE POLICY "Deny all public access to Scan"
ON "public"."Scan"
FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- Habilitar RLS en la tabla Page
ALTER TABLE "public"."Page" ENABLE ROW LEVEL SECURITY;

-- Política: Denegar todo acceso público a Page
CREATE POLICY "Deny all public access to Page"
ON "public"."Page"
FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- Habilitar RLS en la tabla Issue
ALTER TABLE "public"."Issue" ENABLE ROW LEVEL SECURITY;

-- Política: Denegar todo acceso público a Issue
CREATE POLICY "Deny all public access to Issue"
ON "public"."Issue"
FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- Habilitar RLS en la tabla _prisma_migrations
-- Esta tabla es interna de Prisma y no debe ser accesible públicamente
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Política: Denegar todo acceso público a _prisma_migrations
CREATE POLICY "Deny all public access to _prisma_migrations"
ON "public"."_prisma_migrations"
FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- ============================================
-- Verificación
-- ============================================
-- Ejecuta estas consultas para verificar que RLS está habilitado:
--
-- SELECT tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE schemaname = 'public' 
-- AND tablename IN ('Scan', 'Page', 'Issue', '_prisma_migrations');
--
-- Deberías ver 'true' en la columna rowsecurity para todas las tablas.
-- ============================================

