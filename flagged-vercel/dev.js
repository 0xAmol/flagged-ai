// dev.js — run the same app locally: DATABASE_URL=... node dev.js
import { serve } from "@hono/node-server";
import { app } from "./src/app.js";
serve({ fetch: app.fetch, port: 8787 }, () => console.log("flagged.ai ledger (postgres) on :8787"));
