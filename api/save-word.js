import { sql } from '@vercel/postgres';

export default async function handler(request, response) {
  try {
    // 1. 自動建立單字表格
    await sql`
      CREATE TABLE IF NOT EXISTS vocabulary (
        id SERIAL PRIMARY KEY,
        word VARCHAR(255) UNIQUE NOT NULL,
        pronunciation VARCHAR(255),
        part_of_speech VARCHAR(50),
        meaning TEXT,
        forms VARCHAR(255),
        example_en TEXT,
        example_tw TEXT
      );
    `;

    // 2. 接收單字資料
    const { word, pronunciation, part_of_speech, meaning, forms, example_en, example_tw } = request.body;

    // 3. 寫入資料庫 (遇到重複的單字會自動略過)
    if (word) {
       await sql`
        INSERT INTO vocabulary (word, pronunciation, part_of_speech, meaning, forms, example_en, example_tw)
        VALUES (${word}, ${pronunciation}, ${part_of_speech}, ${meaning}, ${forms}, ${example_en}, ${example_tw})
        ON CONFLICT (word) DO NOTHING;
      `;
    }

    return response.status(200).json({ message: '單字儲存成功！' });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
