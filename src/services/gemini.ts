import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface WordAnalysis {
  word: string;
  pronunciation: string;
  part_of_speech: string;
  meaning: string;
  forms: string;
  example_en: string;
  example_tw: string;
}

export async function analyzeImages(base64Images: string[]): Promise<WordAnalysis[]> {
  const imageParts = base64Images.map(data => ({
    inlineData: {
      mimeType: "image/jpeg",
      data,
    },
  }));

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        parts: [
          ...imageParts,
          {
            text: `你是一位專業的英文老師。請辨識這幾張圖片（可能是跨頁內容）中的英文單字。
            請嚴格依照以下「三個步驟」執行，不要遺漏：

            * 步驟一（盤點與去重）：先跨頁掃描所有圖片中的英文單字，在心裡合併並去除重複的單字。
            * 步驟二（詳細解析）：針對找出的不重複單字，準備好發音(KK音標)、詞性、中文意義、單字型態變化、以及一句附帶中文翻譯的實用例句。
              【單字型態 (Forms) 規則】：
              - 若為動詞：列出動詞三態（原形-過去式-過去分詞）。特例：若三態相同（如 put-put-put），則改為提供現在分詞 (V-ing) 或第三人稱單數 (V-s)。
              - 若為名詞：列出常見複數形態。
              - 若為形容詞/副詞：列出比較級與最高級。
              - 若無特殊變化則填寫「無」。
            * 步驟三（格式化輸出）：請先在開頭說一句「**已為您解析完畢，以下是結構化資料：**」，接著將所有解析結果放入一個 Markdown 的 JSON 程式碼區塊中。

            JSON 格式範例如下，請確保格式正確無誤：
            \`\`\`json
            {
              "vocabulary_list": [
                {
                  "word": "accommodate",
                  "pronunciation": "[əˋkɑmə͵det]",
                  "part_of_speech": "v.",
                  "meaning": "容納；為...提供住宿",
                  "forms": "accommodated, accommodating",
                  "example_en": "The hotel can accommodate up to 500 guests.",
                  "example_tw": "這家飯店最多可容納 500 位客人。"
                }
              ]
            }
            \`\`\`
            只輸出上述要求的內容。`,
          },
        ],
      },
    ],
  });

  const text = response.text || "";
  try {
    // Extract JSON from markdown block
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text;
    const result = JSON.parse(jsonStr.trim());
    const words = result.vocabulary_list || [];

    // --- 呼叫警衛室存單字 (開始) ---
    for (const item of words) {
      try {
        // 把單字打包，發送 POST 請求給 Vercel 後端 API
        await fetch('/api/save-word', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
      } catch (dbError) {
        console.error("單字存檔失敗:", dbError);
      }
    }
    // --- 呼叫警衛室存單字 (結束) ---

    return words;
  } catch (e) {
    console.error("Failed to parse JSON from Gemini", e, text);
    return [];
  }
}

export interface QuizQuestion {
  id: number;
  type: "multiple_choice" | "fill_in_the_blank" | "error_correction";
  question: string;
  options?: string[];
  correct_answer: string;
  explanation: string;
}

export async function generateQuiz(context: string): Promise<QuizQuestion[]> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        parts: [
          {
            text: `你是一位「極速英文家教」。只准輸出 JSON，不准有任何其他文字。
            內容：${context}

            【極速測驗出題規則】：
            1. 固定出 10 題。
            2. 每題詳解 (exp) 必須控制在 20 個字以內。
            3. 題型全部必須是「四選一選擇題」(multiple_choice)。
            4. 嚴格輸出格式 (JSON)：
            \`\`\`json
            {
              "quiz": [
                {
                  "q": "題目內容",
                  "opt": ["選項1", "選項2", "選項3", "選項4"],
                  "ans": "正確答案",
                  "exp": "20字內詳解"
                }
              ]
            }
            \`\`\`
            `,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  try {
    const result = JSON.parse(response.text || "{}");
    const list = result.quiz || [];
    return list.map((item: any, index: number) => ({
      id: index + 1,
      type: item.opt ? "multiple_choice" : "fill_in_the_blank",
      question: item.q,
      options: item.opt,
      correct_answer: item.ans,
      explanation: item.exp
    }));
  } catch (e) {
    console.error("Failed to parse Quiz JSON", e);
    return [];
  }
}

export async function chatWithAI(message: string, history: { role: "user" | "model"; text: string }[]) {
  const chat = ai.chats.create({
    model:"gemini-2.5-flash",
    config: {
      systemInstruction: `你是一位專為台灣使用者打造的「全能 AI 英文學習助手」。你的語氣鼓勵、有耐心且專業。

      【文法學習區塊 (Interactive Grammar Learning) 規則】：
      
      情境 A：使用者要求文法目錄（例如輸入「我想學文法」或「列出所有文法」）
      - 輸出一個分類清晰、排版整齊的「英文文法主題列表」。
      - 分類必須包含：1. 各種時態 (Tenses), 2. 詞性與用法 (Parts of Speech), 3. 句型與語態 (Sentence Structures & Voices), 4. 子句 (Clauses)。
      - 引導語：「請輸入你想學習的文法主題（例如：我想學現在完成式），我們就可以開始囉！」

      情境 B：使用者指定了特定文法（例如輸入「我想學現在完成式」）
      - **絕對不可以一次把所有內容塞給使用者**！請嚴格採用「由淺入深的三階段互動教學」。
      - 每教完一個階段，必須出一道題目給使用者練習，並**「停止輸出，等待使用者回答」**。
      - 根據使用者的回答，給予溫柔的鼓勵或糾正，確認他懂了之後，才能進入下一個階段。
      
      教學流程規範：
      1. 第一階段（概念與公式）：用最白話、生活化的中文解釋該文法的「核心意義」與「基本公式」，附上 2 個簡單例句。出 1 題最基礎的「選擇題」或「填空題」讓使用者試做。（等待回答）
      2. 第二階段（常見情境與關鍵字）：使用者答對後，介紹這個文法在日常生活中的各種情境，以及常搭配的字詞（如 already, yet, since）。出 1 題「句子重組」或「簡單中翻英」。（等待回答）
      3. 第三階段（易錯點與大魔王比較）：使用者過關後，點出台灣學生最常犯的錯誤，或是拿易混淆的文法來比較（例如：現在完成式 vs. 過去簡單式）。出 1 題「進階挑戰題」作為總結。

      【通用規範】：
      - 如果使用者答錯，請耐心解釋為什麼錯，並再出一題類似的題目讓他確認自己真的學會了。
      - 所有對話請使用「繁體中文 (zh-TW)」。
      - 版面保持整潔，適當使用 Markdown 格式（粗體、條列式）。`,
    },
    history: history.map(h => ({
      role: h.role,
      parts: [{ text: h.text }]
    }))
  });

  const response = await chat.sendMessage(message);
  return response.text;
}
