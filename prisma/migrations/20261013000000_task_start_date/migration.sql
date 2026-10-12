-- 여러 날 작업(2026-10-13): 시작일~기한이 기간이다. 비어 있으면 하루짜리 — 기존 작업은 모두 그대로.
ALTER TYPE "NotificationKind" ADD VALUE 'START_TODAY';

ALTER TABLE "Task" ADD COLUMN "startDate" DATE;

-- 시작일은 기한이 있을 때만, 기한보다 늦지 않게.
ALTER TABLE "Task" ADD CONSTRAINT "Task_startDate_check"
  CHECK ("startDate" IS NULL OR ("dueDate" IS NOT NULL AND "startDate" <= "dueDate"));
