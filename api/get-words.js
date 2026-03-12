import { sql } from '@vercel/postgres';

export default async function handler(request, response) {
  try {
    // 從資料庫抓取最新的 50 個單字
    const { rows } = await sql`SELECT * FROM vocabulary ORDER BY id DESC LIMIT 50;`;
    return response.status(200).json(rows);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
