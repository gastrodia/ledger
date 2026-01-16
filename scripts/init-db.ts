import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

function stripSqlComments(input: string) {
  return input
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("--")) return "";
      return line;
    })
    .join("\n");
}

function splitStatements(sqlText: string) {
  // 简单分号切分（够用：本项目 SQL 无函数/触发器等复杂语法）
  return sqlText
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const raw = await readFile(new URL("./init-db.sql", import.meta.url), "utf8");
  const cleaned = stripSqlComments(raw);
  const statements = splitStatements(cleaned);

  console.log(`Found ${statements.length} SQL statements. Running...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await sql.query(stmt);
    } catch (err) {
      console.error(`Failed at statement #${i + 1}:\n${stmt}\n`);
      throw err;
    }
  }

  console.log("DB init completed.");
}

main().catch((err) => {
  console.error("DB init failed:", err);
  process.exit(1);
});

