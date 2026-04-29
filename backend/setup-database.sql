-- Script SQL para crear las tablas de SiteSentry QA en Supabase
-- Ejecuta este script en el SQL Editor de Supabase
-- IMPORTANTE: Si ya tienes tablas anteriores, ejecuta primero el bloque DROP de abajo.

-- Eliminar tablas y tipos anteriores (descomentar si necesitas recrear)
-- DROP TABLE IF EXISTS "Issue" CASCADE;
-- DROP TABLE IF EXISTS "Page" CASCADE;
-- DROP TABLE IF EXISTS "Scan" CASCADE;
-- DROP TYPE IF EXISTS "ScanStatus";
-- DROP TYPE IF EXISTS "IssueType";
-- DROP TYPE IF EXISTS "IssueSeverity";

-- Crear enums
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "IssueType" AS ENUM ('BROKEN_RESOURCE', 'FAILED_API', 'INTERACTIVITY', 'EMPTY_CONTENT', 'LAZY_LOAD', 'FORM_MODAL');
CREATE TYPE "IssueSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- Crear tabla Scan
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- Crear tabla Issue
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "url" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- Crear foreign keys
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Crear indices
CREATE INDEX "Scan_status_idx" ON "Scan"("status");
CREATE INDEX "Scan_createdAt_idx" ON "Scan"("createdAt");
CREATE INDEX "Issue_scanId_idx" ON "Issue"("scanId");
CREATE INDEX "Issue_type_idx" ON "Issue"("type");
CREATE INDEX "Issue_severity_idx" ON "Issue"("severity");
