import { db } from "./client";
import { users, sessions, referenceLaps } from "./schema";
import { eq, and, sql } from "drizzle-orm";

export async function getUserById(id: number) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export type StudentSummary = {
  id: number;
  name: string;
  email: string;
  discordUsername: string;
  discordAvatarUrl: string | null;
  sessionCount: number;
  bestLapTimeSeconds: number | null;
  lastSessionAt: Date | null;
};

// One query for the student list, one grouped query for their session
// stats, merged in JS -- avoids an N+1 query per student while staying
// simple to read.
export async function getAllStudents(): Promise<StudentSummary[]> {
  const students = await db.query.users.findMany({
    where: eq(users.role, "student"),
  });

  const stats = await db
    .select({
      userId: sessions.userId,
      sessionCount: sql<number>`count(*)`.as("session_count"),
      bestLapTimeSeconds: sql<number | null>`min(${sessions.lapTimeSeconds})`.as("best_lap"),
      lastSessionAt: sql<Date | null>`max(${sessions.createdAt})`.as("last_session"),
    })
    .from(sessions)
    .groupBy(sessions.userId);

  const statsByUserId = new Map(stats.map((s) => [s.userId, s]));

  return students.map((student) => {
    const stat = statsByUserId.get(student.id);
    return {
      id: student.id,
      name: student.name,
      email: student.email,
      discordUsername: student.discordUsername,
      discordAvatarUrl: student.discordAvatarUrl,
      sessionCount: stat?.sessionCount ?? 0,
      bestLapTimeSeconds: stat?.bestLapTimeSeconds ?? null,
      lastSessionAt: stat?.lastSessionAt ?? null,
    };
  });
}

export async function getSessionsForUser(userId: number) {
  return db.query.sessions.findMany({
    where: eq(sessions.userId, userId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
}

export async function getReferenceLapsForUser(userId: number) {
  return db.query.referenceLaps.findMany({
    where: eq(referenceLaps.ownerId, userId),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });
}

export async function getPublicReferenceLaps() {
  return db.query.referenceLaps.findMany({
    where: eq(referenceLaps.isPublic, true),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });
}

export async function getStudentDetail(studentId: number) {
  const student = await db.query.users.findFirst({
    where: and(eq(users.id, studentId), eq(users.role, "student")),
  });
  if (!student) return null;

  const studentSessions = await getSessionsForUser(studentId);
  const studentLaps = await getReferenceLapsForUser(studentId);

  return { student, sessions: studentSessions, referenceLaps: studentLaps };
}

/**
 * One session plus every other session the same user drove at the same
 * track. The detail page needs both: the lap itself is meaningless
 * without the laps around it to compare against.
 */
export async function getSessionWithTrackHistory(sessionId: number) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return null;

  const sameTrack = await db.query.sessions.findMany({
    where: and(eq(sessions.userId, session.userId), eq(sessions.track, session.track)),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });

  return { session, sameTrack };
}
