/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  BookOpen, 
  MessageSquare, 
  History, 
  Send, 
  X, 
  Volume2, 
  Loader2, 
  ChevronRight,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeImages, chatWithAI, generateQuiz, WordAnalysis, QuizQuestion } from './services/gemini';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tab = 'scan' | 'grammar' | 'qa' | 'history' | 'quiz';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

// 1. 在這裡定義文法老師的「最強靈魂劇本」
const FINAL_GRAMMAR_PROMPT = `你是一位超級溫柔且幽默的 AI 英文家教。請不要像課本一樣死板，用像在跟我聊天的方式教學！

情境 A：要求目錄時 -> 列出時態、詞性、句型、子句，多用 emoji 排版。
情境 B：指定主題時 -> 執行由淺入深三階段教學：
1. 第一階段：白話解釋核心概念與公式，附上 2 個生活例句，出一題測驗。
2. 第二階段：介紹該文法常用情境與關鍵字，出一題練習。
3. 第三階段：抓出台灣人最愛犯的錯或相似文法比較，出一題挑戰題。

重要規則：每次只講一個階段，出一題後必須「停止輸出」等回答。答對才進下一關。請用繁體中文。`;

const QA_PROMPT = "你是一個簡潔且準確的英文問答助手，請用繁體中文回答問題。";

function QuickActionBtn({ onClick, label }: { onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className="w-full py-2.5 px-4 bg-stone-50 text-stone-600 text-sm font-medium rounded-xl border border-stone-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-100 transition-all text-left flex items-center justify-between group"
    >
      {label}
      <ChevronRight size={16} className="text-stone-300 group-hover:text-emerald-400 transition-colors" />
    </button>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scannedWords, setScannedWords] = useState<WordAnalysis[]>([]);
  const [history, setHistory] = useState<WordAnalysis[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  
  const [qaMessages, setQaMessages] = useState<ChatMessage[]>([]);
  const [grammarMessages, setGrammarMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [currentQuiz, setCurrentQuiz] = useState<QuizQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [customGrammarTopic, setCustomGrammarTopic] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [qaMessages, grammarMessages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedFiles(prev => [...prev, ...files]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const startAnalysis = async () => {
    if (selectedFiles.length === 0) return;
    setIsAnalyzing(true);
    try {
      const base64Promises = selectedFiles.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
      });
      const base64Images = await Promise.all(base64Promises);
      const results = await analyzeImages(base64Images);
      setScannedWords(results);
      setHistory(prev => [...results, ...prev]);
      setSelectedFiles([]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStartQuiz = async (context?: string) => {
    setIsGeneratingQuiz(true);
    setActiveTab('quiz');
    setCurrentQuiz([]);
    setQuizIndex(0);
    setUserAnswers({});
    setShowExplanation(false);
    setQuizScore(null);
    try {
      const quizContext = context || (history.length > 0 
        ? `複習以下單字：${history.map(w => w.word).join(', ')}` 
        : "請隨機出 3 題基礎英文文法測驗");
      const quiz = await generateQuiz(quizContext);
      setCurrentQuiz(quiz);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleAnswer = (answer: string) => {
    if (showExplanation) return;
    setUserAnswers(prev => ({ ...prev, [currentQuiz[quizIndex].id]: answer }));
    setShowExplanation(true);
  };

  const nextQuestion = () => {
    if (quizIndex < currentQuiz.length - 1) {
      setQuizIndex(prev => prev + 1);
      setShowExplanation(false);
    } else {
      const score = currentQuiz.reduce((acc, q) => acc + (userAnswers[q.id] === q.correct_answer ? 1 : 0), 0);
      setQuizScore(score);
    }
  };

  // 2. 核心發送邏輯：使用「指令前置法」，避開 API 報錯
  const handleSendMessage = async (type: 'qa' | 'grammar', overrideValue?: string) => {
    const textToSend = overrideValue || inputValue;
    if (!textToSend.trim()) return;

    if (textToSend.includes('出題') || textToSend.includes('測驗') || textToSend.includes('練習')) {
      handleStartQuiz(textToSend);
      setInputValue('');
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: textToSend,
      timestamp: Date.now(),
    };

    if (type === 'qa') setQaMessages(prev => [...prev, userMsg]);
    else setGrammarMessages(prev => [...prev, userMsg]);

    setInputValue('');
    setIsTyping(true);

    try {
      const messages = type === 'qa' ? qaMessages : grammarMessages;
      
      // 構建純淨歷史紀錄 (只准有 user 和 model)
      const chatHistory = messages.map(m => ({ 
        role: m.role === 'user' ? 'user' : 'model', 
        text: m.text 
      }));

      // 【核心關鍵】：將劇本黏在發送文字的最前面
      const instruction = type === 'grammar' ? FINAL_GRAMMAR_PROMPT : QA_PROMPT;
      const finalInputForAI = `${instruction}\n\n目前學生輸入：${textToSend}`;

      const response = await chatWithAI(finalInputForAI, chatHistory); 
      
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: response || '抱歉，我現在遇到一點問題，請再試一次。',
        timestamp: Date.now(),
      };

      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error("發送失敗:", error);
    } finally {
      setIsTyping(false);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const renderQuizTab = () => {
    if (isGeneratingQuiz) {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 p-6 text-center">
          <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
          <h3 className="text-lg font-bold text-stone-800">正在為您出題...</h3>
          <p className="text-stone-500 text-sm">AI 正在根據您的學習進度產出專屬測驗</p>
        </div>
      );
    }

    if (quizScore !== null) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
          <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-2">
            <CheckCircle2 size={48} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-stone-800">測驗完成！</h2>
            <p className="text-stone-500 mt-2">您的得分是：<span className="text-emerald-600 font-bold text-xl">{quizScore} / {currentQuiz.length}</span></p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button onClick={() => handleStartQuiz()} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold">再試一次</button>
            <button onClick={() => setActiveTab('history')} className="w-full py-3 bg-stone-100 text-stone-600 rounded-xl font-bold">返回學習足跡</button>
          </div>
        </div>
      );
    }

    if (currentQuiz.length === 0) {
      const presets = ["現在完成式", "過去簡單式", "被動語態", "關係代名詞", "假設語氣"];
      return (
        <div className="flex flex-col h-full p-6 overflow-y-auto">
          <div className="flex flex-col items-center text-center space-y-4 mb-8">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600"><BookOpen size={40} /></div>
            <div>
              <h3 className="text-xl font-bold text-stone-800">準備好接受挑戰了嗎？</h3>
              <p className="text-stone-500 text-sm mt-1">選擇一個主題或輸入您想練習的文法組合</p>
            </div>
          </div>
          <div className="space-y-6 pb-20">
            <section>
              <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">單字複習</h4>
              <button onClick={() => handleStartQuiz()} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 transition-all"><History size={18} />複習辨識過的單字</button>
            </section>
            <section>
              <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">熱門文法主題</h4>
              <div className="grid grid-cols-2 gap-2">
                {presets.map(topic => (
                  <button key={topic} onClick={() => handleStartQuiz(`請出 3-5 題「${topic}」考我`)} className="py-3 px-4 bg-white border border-stone-100 text-stone-600 text-sm font-bold rounded-xl hover:border-emerald-200 transition-all">{topic}</button>
                ))}
              </div>
            </section>
          </div>
        </div>
      );
    }

    const q = currentQuiz[quizIndex];
    const userAnswer = userAnswers[q.id];
    const isCorrect = userAnswer === q.correct_answer;

    return (
      <div className="flex flex-col h-full p-6">
        <div className="flex justify-between items-center mb-6">
          <span className="text-xs font-bold text-stone-400 uppercase">問題 {quizIndex + 1} / {currentQuiz.length}</span>
          <div className="flex gap-1">
            {currentQuiz.map((_, i) => (
              <div key={i} className={cn("w-2 h-2 rounded-full", i === quizIndex ? "bg-emerald-500" : i < quizIndex ? "bg-emerald-200" : "bg-stone-200")} />
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-6 pb-20">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <h3 className="text-lg font-bold text-stone-800 leading-relaxed">{q.question}</h3>
          </div>
          <div className="space-y-3">
            {q.type === 'multiple_choice' && q.options?.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleAnswer(opt)}
                disabled={showExplanation}
                className={cn(
                  "w-full p-4 rounded-xl border text-left transition-all flex items-center justify-between",
                  showExplanation 
                    ? opt === q.correct_answer ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-bold" : opt === userAnswer ? "bg-red-50 border-red-500 text-red-700" : "bg-white border-stone-100 text-stone-400"
                    : "bg-white border-stone-100 text-stone-700 hover:bg-emerald-50"
                )}
              >
                <span>{opt}</span>
                {showExplanation && opt === q.correct_answer && <CheckCircle2 size={18} className="text-emerald-500" />}
              </button>
            ))}
          </div>
          <AnimatePresence>
            {showExplanation && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="bg-stone-100 p-5 rounded-2xl">
                  <h4 className="font-bold text-stone-800 mb-2 flex items-center gap-2"><BookOpen size={16} className="text-emerald-600" />解析</h4>
                  <p className="text-stone-600 text-sm leading-relaxed">{q.explanation}</p>
                </div>
                <button onClick={nextQuestion} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-xl">
                  {quizIndex < currentQuiz.length - 1 ? '下一題' : '查看結果'}<ChevronRight size={18} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  };

  const renderScanTab = () => (
    <div className="flex flex-col h-full">
      <div className="p-6 text-center">
        <h2 className="text-2xl font-bold text-stone-800 mb-2">跨頁單字辨識</h2>
        <p className="text-stone-500 text-sm">上傳多張圖片，AI 將自動解析所有單字</p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-20">
        {isAnalyzing ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-4"><Loader2 className="w-12 h-12 text-emerald-500 animate-spin" /><p className="text-stone-600 font-medium">AI 正在分析中...</p></div>
        ) : scannedWords.length > 0 ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-stone-400 uppercase">辨識結果 ({scannedWords.length})</span>
              <button onClick={() => setScannedWords([])} className="text-xs text-emerald-600 font-bold">重新上傳</button>
            </div>
            {scannedWords.map((item, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2"><h3 className="text-xl font-bold text-emerald-700">{item.word}</h3><button onClick={() => speak(item.word)} className="p-1.5 rounded-full bg-emerald-50 text-emerald-600"><Volume2 size={16} /></button></div>
                  <span className="px-2 py-1 bg-stone-100 text-stone-600 text-[10px] font-bold rounded uppercase">{item.part_of_speech}</span>
                </div>
                <p className="text-stone-800 font-medium mb-3">{item.meaning}</p>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 transition-all group">
              <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mb-3 group-hover:scale-110"><Camera size={24} /></div>
              <p className="text-stone-500 font-medium">點擊選擇照片</p>
            </div>
            {selectedFiles.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {selectedFiles.map((file, idx) => (
                    <div key={idx} className="relative aspect-square bg-stone-200 rounded-xl overflow-hidden group">
                      <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                      <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full"><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <button onClick={startAnalysis} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg">開始跨頁辨識</button>
              </div>
            )}
          </div>
        )}
      </div>
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileChange} />
    </div>
  );

  const renderChatTab = (type: 'qa' | 'grammar') => {
    const messages = type === 'qa' ? qaMessages : grammarMessages;
    const title = type === 'qa' ? 'AI 英文問答' : '文法學習區塊';
    const subtitle = type === 'qa' ? '隨時解答您的英文疑惑' : '淺顯易懂的文法教學';
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="p-4 border-b border-stone-100 bg-white/80 backdrop-blur-md sticky top-0 z-10 flex justify-between items-center">
          <div><h2 className="text-lg font-bold text-stone-800">{title}</h2><p className="text-xs text-stone-500">{subtitle}</p></div>
          {messages.length > 0 && <button onClick={() => type === 'qa' ? setQaMessages([]) : setGrammarMessages([])} className="p-2 text-stone-400 hover:text-red-500"><X size={18} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-6 px-4">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">
                {type === 'qa' ? <MessageSquare size={40} /> : <BookOpen size={40} />}
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-800 mb-2">{type === 'qa' ? '有什麼英文難題嗎？' : '準備好提升文法力了嗎？'}</h3>
                <p className="text-sm text-stone-500">{type === 'qa' ? '我可以幫您辨析單字、翻譯句子。' : '我會帶您由淺入深掌握文法重點。'}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
                {type === 'qa' ? (
                  <><QuickActionBtn onClick={() => handleSendMessage('qa', '「A」和「B」單字差在哪？')} label="單字辨析" /><QuickActionBtn onClick={() => handleSendMessage('qa', '這句話怎麼翻譯比較自然？')} label="翻譯建議" /></>
                ) : (
                  <><QuickActionBtn onClick={() => handleSendMessage('grammar', '我想學文法')} label="查看文法目錄" /><QuickActionBtn onClick={() => handleSendMessage('grammar', '我想學現在完成式')} label="直接學習：現在完成式" /></>
                )}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2 shadow-sm", msg.role === 'user' ? "bg-emerald-600 text-white rounded-tr-none" : "bg-stone-100 text-stone-800 rounded-tl-none")}>
                <div className="markdown-body"><Markdown>{msg.text}</Markdown></div>
                <div className="text-[10px] mt-1 opacity-50">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-stone-100 rounded-2xl px-4 py-3 flex gap-1">
                <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-4 border-t border-stone-100 bg-white fixed bottom-16 w-full max-w-md z-30">
          <div className="relative flex items-center">
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(type)} placeholder="輸入您的問題..." className="w-full bg-stone-50 border-none rounded-full py-3 pl-5 pr-12 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20" />
            <button onClick={() => handleSendMessage(type)} disabled={!inputValue.trim() || isTyping} className="absolute right-2 p-2 bg-emerald-600 text-white rounded-full"><Send size={18} /></button>
          </div>
        </div>
      </div>
    );
  };

  // 3. 修復後的歷史紀錄 Tab：包含標題、修正捲動
  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-stone-100 bg-white/80 backdrop-blur-md sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-stone-800">學習足跡</h2>
          <p className="text-xs text-stone-500">回顧您曾經辨識過的單字</p>
        </div>
        {history.length > 0 && (
          <button onClick={() => handleStartQuiz()} className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-full shadow-md flex items-center gap-2">
            <CheckCircle2 size={14} /> 單字測驗
          </button>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-28 space-y-3">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 opacity-30">
            <History size={48} className="mb-2" />
            <p>尚無歷史紀錄</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {history.map((item, idx) => (
              <div key={idx} className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 flex justify-between items-center group">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-stone-800">{item.word}</span>
                    <span className="text-[10px] text-stone-400 uppercase font-bold">{item.part_of_speech}</span>
                  </div>
                  <p className="text-sm text-stone-600 mt-0.5">{item.meaning}</p>
                </div>
                <button onClick={() => speak(item.word)} className="p-2 text-stone-300 hover:text-emerald-500 transition-colors"><Volume2 size={18} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-stone-50 max-w-md mx-auto relative overflow-hidden shadow-2xl">
      <header className="bg-white px-6 py-4 flex items-center justify-between border-b border-stone-100 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-black italic">AI</div>
          <h1 className="font-bold text-stone-800 tracking-tight">English Tutor</h1>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Online</span>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }} className="h-full">
            {activeTab === 'scan' && renderScanTab()}
            {activeTab === 'grammar' && renderChatTab('grammar')}
            {activeTab === 'qa' && renderChatTab('qa')}
            {activeTab === 'history' && renderHistoryTab()}
            {activeTab === 'quiz' && renderQuizTab()}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="bg-white/80 backdrop-blur-lg border-t border-stone-100 px-6 py-3 flex justify-between items-center z-40 fixed bottom-0 w-full max-w-md">
        <NavButton active={activeTab === 'scan'} onClick={() => setActiveTab('scan')} icon={<Camera size={20} />} label="辨識" />
        <NavButton active={activeTab === 'grammar'} onClick={() => setActiveTab('grammar')} icon={<BookOpen size={20} />} label="文法" />
        <NavButton active={activeTab === 'quiz'} onClick={() => setActiveTab('quiz')} icon={<CheckCircle2 size={20} />} label="測驗" />
        <NavButton active={activeTab === 'qa'} onClick={() => setActiveTab('qa')} icon={<MessageSquare size={20} />} label="問答" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={20} />} label="紀錄" />
      </nav>

      {activeTab === 'scan' && !isAnalyzing && scannedWords.length === 0 && (
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} onClick={() => fileInputRef.current?.click()} className="absolute bottom-24 right-6 w-14 h-14 bg-emerald-600 text-white rounded-full shadow-lg z-30">
          <ImageIcon size={24} className="mx-auto" />
        </motion.button>
      )}
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 transition-all", active ? "text-emerald-600 scale-110" : "text-stone-400 hover:text-stone-600")}>
      <div className={cn("p-1 rounded-xl", active ? "bg-emerald-50" : "bg-transparent")}>{icon}</div>
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}
