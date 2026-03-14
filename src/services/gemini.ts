import { GoogleGenAI } from "@google/genai";

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [
        {
          parts: [
            ...imageParts,
            {
              text: `你是一位專業的英文老師。請辨識這幾張圖片（可能是跨頁內容）中的英文單字。
              請嚴格依照以下步驟執行：

              1. 盤點與去重：合併所有圖片中的英文單字，去除重複。
              2. 詳細解析：針對找出的單字，給出發音(KK音標)、詞性、中文意義、型態變化、以及一句實用例句(附中文)。
                 - 動詞：三態 (若相同則給V-ing/V-s)
                 - 名詞：複數
                 - 形容詞/副詞：比較級/最高級
                 - 無特殊變化填「無」

              【絕對嚴格限制】：
              1. 絕對不准輸出 Markdown 標記 (如 \`\`\`json)。
              2. 絕對不准說「已為您解析完畢」等任何廢話。
              3. 只能輸出純 JSON 格式。

              請確保格式如下：
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
              }`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      }
    });

    let rawText = response.text || "{}";
    rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    
    const result = JSON.parse(rawText);
    const words = result.vocabulary_list || [];

    for (const item of words) {
      try {
        await fetch('/api/save-word', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
      } catch (dbError) {
        console.error("單字存檔失敗:", dbError);
      }
    }

    return words;
  } catch (error: any) {
    console.error("解析圖片單字 JSON 失敗:", error);
    const errMsg = error.message || String(error);
    // 💡 溫柔翻譯機：影像辨識額度用光時的提示
    if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("掃描功能目前太熱門啦！API 免費額度已暫時用完，請稍等幾分鐘或明天再試喔！");
    }
    throw new Error("單字解析失敗，請確認圖片清晰度或再試一次。");
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
  const promptText = `你是一位「極速英文家教」。請嚴格根據以下內容出 10 題選擇題。
  內容：${context}

  【極速測驗出題規則】：
  1. 必須出滿 10 題。
  2. 每題詳解必須控制在 20 個字以內。
  3. 題型全部必須是「四選一選擇題」。
  4. 絕對不能輸出 Markdown 標記 (不要有 \`\`\`json)，請直接輸出純 JSON 陣列。
  
  嚴格格式範例：
  [
    {
      "q": "題目內容",
      "opt": ["選項1", "選項2", "選項3", "選項4"],
      "ans": "正確答案",
      "exp": "20字內詳解"
    }
  ]`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: promptText,
      config: {
        responseMimeType: "application/json",
      },
    });

    let rawText = response.text || "[]";
    rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const result = JSON.parse(rawText);
    const list = Array.isArray(result) ? result : (result.quiz || []);

    return list.map((item: any, index: number) => ({
      id: index + 1,
      type: "multiple_choice",
      question: item.q || item.question,
      options: item.opt || item.options,
      correct_answer: item.ans || item.answer || item.correct_answer,
      explanation: item.exp || item.explanation
    }));
  } catch (error: any) {
    console.error("Quiz JSON 解析失敗:", error);
    const errMsg = error.message || String(error);
    // 💡 溫柔翻譯機：出題額度用光時的提示
    if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("老師目前太忙碌啦！免費出題額度已暫時用盡，請稍後再試！");
    }
    throw new Error("測驗產生失敗，請再試一次。");
  }
}

export async function chatWithAI(message: string, history: { role: "user" | "model"; text: string }[]) {
  try {
    const transcript = history
      .filter(h => h && typeof h.text === 'string' && h.text.trim() !== '')
      .map(h => `${h.role === 'user' ? '學生' : '老師'}：${h.text}`)
      .join('\n\n');

    const finalPrompt = transcript.length > 0 
      ? `【歷史對話紀錄】\n${transcript}\n\n【最新問題】\n學生：${message}\n\n請根據上述紀錄與最新問題，給出老師的回覆（直接回答，不需在開頭加上「老師：」）：`
      : String(message);

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: finalPrompt,
      config: {
        systemInstruction: `你是一位專為台灣使用者打造的「全能 AI 英文學習助手」。你的語氣鼓勵、有耐心且專業。

      【文法學習區塊 (Interactive Grammar Learning) 規則】：
      
      情境 A：使用者要求文法目錄
      - 輸出一個分類清晰、排版整齊的「英文文法主題列表」。
      - 分類必須包含：1. 各種時態, 2. 詞性與用法, 3. 句型與語態, 4. 子句。
      - 引導語：「請輸入你想學習的文法主題，我們就可以開始囉！」

      情境 B：使用者指定了特定文法
      - **絕對不可以一次把所有內容塞給使用者**！請嚴格採用「由淺入深的三階段互動教學」。
      - 每教完一個階段，必須出一道題目給使用者練習，並**「停止輸出，等待使用者回答」**。
      
      教學流程規範：
      1. 第一階段（概念與公式）：用最白話的中文解釋「核心意義」與「基本公式」，附 2 個例句。出 1 題最基礎的選擇題。（等待回答）
      2. 第二階段（常見情境與關鍵字）：介紹常搭配的字詞。出 1 題簡單中翻英。（等待回答）
      3. 第三階段（易錯點）：點出台灣學生最常犯的錯誤。出 1 題進階挑戰題作為總結。

      【通用規範】：
      - 如果使用者答錯，請耐心解釋為什麼錯，並再出一題。
      - 所有對話請使用「繁體中文 (zh-TW)」。
      - 版面保持整潔，適當使用 Markdown 格式。`
      }
    });

    return response.text;
  } catch (error: any) {
    console.error("Chat API 崩潰:", error);
    const errMsg = error.message || String(error);
    // 💡 溫柔翻譯機：聊天額度用光時的提示
    if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("老師目前被問爆啦！API 免費額度已暫時用盡，請稍等幾分鐘或明天再來找我喔！");
    }
    throw new Error("連線發生了一點小問題，請再試一次。");
  }
}
