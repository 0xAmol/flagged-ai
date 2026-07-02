// api/index.js — Vercel serverless entry. All routes live in src/app.js.
import { handle } from "hono/vercel";
import { app } from "../src/app.js";

export default handle(app);
