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
    model: "gemini-3-flash-preview",
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
    return result.vocabulary_list || [];
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
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            text: `你是一位「極速英文家教」。只准輸出 JSON，不准有任何其他文字。
            內容：${context}

            【極速測驗出題規則】：
            1. 固定只出 3 題。
            2. 每題詳解 (exp) 必須控制在 20 個字以內。
            3. 題型隨機混合：選擇題、填空題、除錯題。
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
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `你是一位「極速英文家教」。最高原則：精簡、快速、零廢話。
      絕對禁止輸出任何客套話、前言或結語。直接輸出核心資訊。

      【極速文法教學 (Turbo Grammar)】：
      當詢問特定文法時，嚴格遵守「4 行公式」，超過字數即失敗：
      1. 核心概念：（1 句話白話文解釋）
      2. 公式結構：（如 S + have/has + Vp.p.）
      3. 秒懂例句：（1 句英文 + 1 句中文翻譯）
      4. 隨堂一測：（出 1 題最簡單的單選或填空題，並等待回答）

      【通用規範】：
      - 使用「繁體中文 (zh-TW)」。
      - 零廢話，不准說「好的」、「這就為您...」。`,
    },
    history: history.map(h => ({
      role: h.role,
      parts: [{ text: h.text }]
    }))
  });

  const response = await chat.sendMessage({ message });
  return response.text;
}
