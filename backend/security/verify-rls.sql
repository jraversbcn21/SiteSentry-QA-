-- ============================================
-- Script de Verificación: Row Level Security (RLS)
-- ============================================
-- Este script verifica que RLS está correctamente habilitado en todas las tablas.
-- Ejecuta este script después de aplicar enable-rls.sql para confirmar que todo está bien.
-- ============================================

-- Verificar estado de RLS en todas las tablas públicas
SELECT 
    tablename,
    rowsecurity as "RLS Habilitado",
    CASE 
        WHEN rowsecurity THEN '✅ Seguro'
        ELSE '❌ VULNERABLE - RLS no habilitado'
    END as "Estado"
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('Scan', 'Page', 'Issue', '_prisma_migrations')
ORDER BY tablename;

-- Verificar políticas de seguridad creadas
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('Scan', 'Page', 'Issue', '_prisma_migrations')
ORDER BY tablename, policyname;

-- ============================================
-- Resultado Esperado
-- ============================================
-- Deberías ver:
-- 1. Todas las tablas con "RLS Habilitado" = true
-- 2. Al menos una política "Deny all public access" para cada tabla
-- ============================================

