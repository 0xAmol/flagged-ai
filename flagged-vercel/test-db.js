import postgres from "postgres";
const sql = postgres(process.env.TEST_URL, { prepare: false, max: 1 });
try {
  const r = await sql`select 1 as ok`;
  console.log("CONNECTED", r);
} catch (e) {
  console.log("FAILED", e.message);
}
process.exit(0);
