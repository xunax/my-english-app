import { sql } from '@vercel/postgres';

export default async function handler(request, response) {
  try {
    // 我們在 SELECT 的時候，用 "AS" 來幫欄位改名
    // 這樣資料傳到網頁時，標籤就會變成網頁看得懂的 exampleEn 而不是 example_en
    const { rows } = await sql`
      SELECT 
        id, 
        word, 
        pronunciation, 
        meaning, 
        forms,
        part_of_speech AS "partOfSpeech", 
        example_en AS "exampleEn", 
        example_tw AS "exampleTw" 
      FROM vocabulary 
      ORDER BY id DESC;
    `;
    
    return response.status(200).json(rows);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
