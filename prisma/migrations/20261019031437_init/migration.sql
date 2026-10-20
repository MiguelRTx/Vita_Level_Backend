-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "AchievementRule" AS ENUM ('COMPLETION_COUNT', 'STREAK_DAYS', 'LEVEL_REACHED', 'CATEGORY_COUNT');

-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('PROFILE_TITLE', 'PROFILE_FRAME');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'America/La_Paz',
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "frequency" "Frequency" NOT NULL,
    "startDate" DATE NOT NULL,
    "scheduleTimeZone" VARCHAR(64) NOT NULL,
    "materializedThrough" DATE,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityRevision" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "categoryId" UUID NOT NULL,
    "targetQuantity" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(40) NOT NULL,
    "targetCount" INTEGER NOT NULL DEFAULT 1,
    "endDate" DATE,
    "xpPerCompletion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodStartDate" DATE NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccurrenceUnit" (
    "id" UUID NOT NULL,
    "occurrenceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "progressQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "OccurrenceUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "occurrenceUnitId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "amount" DECIMAL(12,3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localDate" DATE NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "responseBody" JSONB NOT NULL,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Completion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "occurrenceUnitId" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localDate" DATE NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,

    CONSTRAINT "Completion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpMovement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "completionId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveDay" (
    "userId" UUID NOT NULL,
    "localDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveDay_pkey" PRIMARY KEY ("userId","localDate")
);

-- CreateTable
CREATE TABLE "Level" (
    "number" INTEGER NOT NULL,
    "minTotalXp" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "rule" "AchievementRule" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "iconKey" VARCHAR(60) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "userId" UUID NOT NULL,
    "badgeId" UUID NOT NULL,
    "earnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("userId","badgeId")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "kind" "RewardKind" NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "rule" "AchievementRule" NOT NULL,
    "threshold" INTEGER NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReward" (
    "userId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "unlockedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserReward_pkey" PRIMARY KEY ("userId","rewardId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Project_userId_archivedAt_createdAt_idx" ON "Project"("userId", "archivedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_userId_key" ON "Project"("id", "userId");

-- CreateIndex
CREATE INDEX "Activity_userId_archivedAt_createdAt_idx" ON "Activity"("userId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_projectId_userId_idx" ON "Activity"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_id_userId_key" ON "Activity"("id", "userId");

-- CreateIndex
CREATE INDEX "ActivityRevision_activityId_effectiveFrom_idx" ON "ActivityRevision"("activityId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ActivityRevision_categoryId_idx" ON "ActivityRevision"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRevision_activityId_version_key" ON "ActivityRevision"("activityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRevision_id_activityId_userId_key" ON "ActivityRevision"("id", "activityId", "userId");

-- CreateIndex
CREATE INDEX "Occurrence_revisionId_activityId_userId_idx" ON "Occurrence"("revisionId", "activityId", "userId");

-- CreateIndex
CREATE INDEX "Occurrence_userId_scheduledDate_idx" ON "Occurrence"("userId", "scheduledDate");

-- CreateIndex
CREATE INDEX "Occurrence_userId_completedAt_idx" ON "Occurrence"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "Occurrence_userId_endsAt_idx" ON "Occurrence"("userId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Occurrence_activityId_periodStartDate_key" ON "Occurrence"("activityId", "periodStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "Occurrence_id_userId_key" ON "Occurrence"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OccurrenceUnit_occurrenceId_position_key" ON "OccurrenceUnit"("occurrenceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "OccurrenceUnit_id_userId_key" ON "OccurrenceUnit"("id", "userId");

-- CreateIndex
CREATE INDEX "ProgressEntry_occurrenceUnitId_userId_recordedAt_idx" ON "ProgressEntry"("occurrenceUnitId", "userId", "recordedAt");

-- CreateIndex
CREATE INDEX "ProgressEntry_userId_recordedAt_id_idx" ON "ProgressEntry"("userId", "recordedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressEntry_userId_idempotencyKey_key" ON "ProgressEntry"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Completion_occurrenceUnitId_key" ON "Completion"("occurrenceUnitId");

-- CreateIndex
CREATE INDEX "Completion_userId_completedAt_id_idx" ON "Completion"("userId", "completedAt", "id");

-- CreateIndex
CREATE INDEX "Completion_userId_localDate_idx" ON "Completion"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "Completion_id_userId_key" ON "Completion"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Completion_occurrenceUnitId_userId_key" ON "Completion"("occurrenceUnitId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "XpMovement_completionId_key" ON "XpMovement"("completionId");

-- CreateIndex
CREATE INDEX "XpMovement_userId_createdAt_id_idx" ON "XpMovement"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "XpMovement_completionId_userId_key" ON "XpMovement"("completionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Level_minTotalXp_key" ON "Level"("minTotalXp");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_code_key" ON "Badge"("code");

-- CreateIndex
CREATE INDEX "UserBadge_badgeId_idx" ON "UserBadge"("badgeId");

-- CreateIndex
CREATE INDEX "UserBadge_userId_earnedAt_idx" ON "UserBadge"("userId", "earnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_code_key" ON "Reward"("code");

-- CreateIndex
CREATE INDEX "UserReward_rewardId_idx" ON "UserReward"("rewardId");

-- CreateIndex
CREATE INDEX "UserReward_userId_unlockedAt_idx" ON "UserReward"("userId", "unlockedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_userId_fkey" FOREIGN KEY ("projectId", "userId") REFERENCES "Project"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRevision" ADD CONSTRAINT "ActivityRevision_activityId_userId_fkey" FOREIGN KEY ("activityId", "userId") REFERENCES "Activity"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRevision" ADD CONSTRAINT "ActivityRevision_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_activityId_userId_fkey" FOREIGN KEY ("activityId", "userId") REFERENCES "Activity"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_revisionId_activityId_userId_fkey" FOREIGN KEY ("revisionId", "activityId", "userId") REFERENCES "ActivityRevision"("id", "activityId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceUnit" ADD CONSTRAINT "OccurrenceUnit_occurrenceId_userId_fkey" FOREIGN KEY ("occurrenceId", "userId") REFERENCES "Occurrence"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_occurrenceUnitId_userId_fkey" FOREIGN KEY ("occurrenceUnitId", "userId") REFERENCES "OccurrenceUnit"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Completion" ADD CONSTRAINT "Completion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Completion" ADD CONSTRAINT "Completion_occurrenceUnitId_userId_fkey" FOREIGN KEY ("occurrenceUnitId", "userId") REFERENCES "OccurrenceUnit"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpMovement" ADD CONSTRAINT "XpMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpMovement" ADD CONSTRAINT "XpMovement_completionId_userId_fkey" FOREIGN KEY ("completionId", "userId") REFERENCES "Completion"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveDay" ADD CONSTRAINT "ActiveDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReward" ADD CONSTRAINT "UserReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReward" ADD CONSTRAINT "UserReward_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom CHECK constraints not expressible in Prisma 7 schema syntax.
-- Keep these in the migration history; do not create a parallel schema.sql.
ALTER TABLE "User"
  ADD CONSTRAINT "User_totalXp_nonnegative" CHECK ("totalXp" >= 0),
  ADD CONSTRAINT "User_email_canonical" CHECK ("email" = lower(btrim("email")) AND length("email") > 0),
  ADD CONSTRAINT "User_displayName_nonempty" CHECK (length(btrim("displayName")) > 0);

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_expiration_valid" CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "Session_revocation_valid" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt");

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_dates_valid" CHECK ("endDate" IS NULL OR "endDate" >= "startDate"),
  ADD CONSTRAINT "Project_title_nonempty" CHECK (length(btrim("title")) > 0);

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_project_task_once" CHECK ("projectId" IS NULL OR "frequency" = 'ONCE');

ALTER TABLE "ActivityRevision"
  ADD CONSTRAINT "ActivityRevision_positive_values" CHECK (
    "version" > 0 AND "targetQuantity" > 0 AND "targetCount" BETWEEN 1 AND 20 AND "xpPerCompletion" BETWEEN 1 AND 1000
  ),
  ADD CONSTRAINT "ActivityRevision_dates_valid" CHECK ("endDate" IS NULL OR "endDate" >= "effectiveFrom"),
  ADD CONSTRAINT "ActivityRevision_text_nonempty" CHECK (length(btrim("title")) > 0 AND length(btrim("unit")) > 0);

ALTER TABLE "Occurrence"
  ADD CONSTRAINT "Occurrence_dates_valid" CHECK ("endsAt" > "startsAt" AND "scheduledDate" >= "periodStartDate"),
  ADD CONSTRAINT "Occurrence_completion_in_period" CHECK (
    "completedAt" IS NULL OR ("completedAt" >= "startsAt" AND "completedAt" < "endsAt")
  );

ALTER TABLE "OccurrenceUnit"
  ADD CONSTRAINT "OccurrenceUnit_values_valid" CHECK ("position" BETWEEN 1 AND 20 AND "progressQuantity" >= 0);

ALTER TABLE "ProgressEntry"
  ADD CONSTRAINT "ProgressEntry_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "ProgressEntry_hash_valid" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ProgressEntry_response_object" CHECK (jsonb_typeof("responseBody") = 'object');

ALTER TABLE "XpMovement"
  ADD CONSTRAINT "XpMovement_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "Level"
  ADD CONSTRAINT "Level_values_valid" CHECK (
    ("number" = 1 AND "minTotalXp" = 0) OR ("number" > 1 AND "minTotalXp" > 0)
  );

ALTER TABLE "Badge" ADD CONSTRAINT "Badge_threshold_positive" CHECK ("threshold" > 0);
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_threshold_positive" CHECK ("threshold" > 0);
