import { Hono } from "hono";
import { handle } from "hono/vercel";
import { app } from "../src/app.js";

const root = new Hono();
root.route("/", app);
root.route("/api", app);

export default handle(root);
