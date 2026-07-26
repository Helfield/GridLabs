import { Hono } from "hono";
import { authRoutes, requireAuth } from "./routes/auth";
import { coachRoutes } from "./routes/coach";
import { studentRoutes } from "./routes/student";
import { accountRoutes } from "./routes/account";
import { apiRoutes } from "./routes/api";
import { getUserById } from "./db/queries";
import { landingPage } from "./views/landing";
import { sessionRoutes } from "./routes/session";

export type AppVariables = { userId: number };

const DISCORD_INVITE_URL = process.env.DISCORD_INVITE_URL ?? "https://discord.gg/gTqcAhrnkU";

const app = new Hono<{ Variables: AppVariables }>();

app.route("/auth", authRoutes);
app.route("/coach", coachRoutes);
app.route("/student", studentRoutes);
app.route("/account", accountRoutes);
app.route("/api", apiRoutes);
app.route("/session", sessionRoutes);

app.get("/", (c) => {
  return c.html(landingPage(DISCORD_INVITE_URL));
});

// Sends a logged-in user to the right place for their role, so links to
// "/dashboard" (e.g. from an email, or old bookmarks) always resolve
// sensibly regardless of whether they're a coach or a student.
app.get("/dashboard", requireAuth, async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  return c.redirect(user.role === "coach" ? "/coach" : "/student");
});

app.get("/login", (c) => c.redirect("/"));

export default app;
