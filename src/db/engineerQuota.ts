// DRAFT destination: src/db/engineerQuota.ts. No database imports or side effects.
export interface QuotaClaim { remaining: number; limit: number }
export type ClaimQuota = (userId: number, limit: number) => Promise<QuotaClaim | null>;
export type ReleaseQuota = (userId: number) => Promise<void>;
export type QuotaExecutor = (strings: TemplateStringsArray, ...values: number[]) => Promise<unknown>;
export interface EngineerQuota { claim: ClaimQuota; release: ReleaseQuota }

export const TRIAL_QUESTIONS_DEFAULT = 2;
export const TRIAL_QUESTIONS_MAX = 200;

// The trial allowance is questions per account for the life of the account, not
// per day. Zero is valid and means the trial is switched off.
export function engineerTrialAllowance(configured: string | undefined): number {
  if (!configured || !/^[+-]?\d+$/.test(configured.trim())) return TRIAL_QUESTIONS_DEFAULT;
  const value = Number(configured);
  return Number.isSafeInteger(value) ? Math.min(TRIAL_QUESTIONS_MAX, Math.max(0, value)) : TRIAL_QUESTIONS_DEFAULT;
}

function toRows(result: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(result) ? result :
    result !== null && typeof result === "object" && "rows" in result ? (result as { rows: unknown }).rows : null;
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("Invalid quota result");
  return rows as Record<string, unknown>[];
}

// One statement per question, so the guard is part of the write and two requests
// from one account can't both take the last free question. Never SELECT then
// UPDATE, never interpolate user input, never keep a process-local count.
export function createEngineerQuota(execute: QuotaExecutor): EngineerQuota {
  const claim: ClaimQuota = async (userId, limit) => {
    if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isInteger(limit) || limit < 0 || limit > TRIAL_QUESTIONS_MAX) {
      throw new Error("Invalid quota input");
    }
    // An allowance of zero switches the trial off. No row is written, so an
    // account can't be charged before the trial is turned back on.
    if (limit === 0) return null;
    const result = await execute`INSERT INTO "engineer_usage" AS current_usage ("user_id", "questions")
VALUES (${userId}, 1)
ON CONFLICT ("user_id") DO UPDATE SET "questions" = current_usage."questions" + 1
WHERE current_usage."questions" < ${limit}
RETURNING "questions"`;
    const rows = toRows(result);
    if (rows.length === 0) return null;
    const questions: unknown = rows[0].questions;
    if (typeof questions !== "number" || !Number.isInteger(questions) || questions < 1 || questions > limit) {
      throw new Error("Invalid quota result");
    }
    return { remaining: limit - questions, limit };
  };

  // Only ever called after a claim, and only when no answer reached the driver.
  // The floor keeps a double release from going negative.
  const release: ReleaseQuota = async (userId) => {
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("Invalid quota input");
    await execute`UPDATE "engineer_usage" SET "questions" = "questions" - 1
WHERE "user_id" = ${userId} AND "questions" > 0`;
  };

  return { claim, release };
}
