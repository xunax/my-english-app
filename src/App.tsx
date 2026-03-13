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

// ✨ 修正介面：確保名稱跟資料庫回傳的一模一樣
interface WordAnalysis {
  word: string;
  pronunciation: string;
  meaning: string;
  part_of_speech: string; 
  example_en: string;    
  example_tw: string;    
  forms?: string;
}

// 1. 文法模式的核心劇本 (維持三階段教學)
const FINAL_GRAMMAR_PROMPT = `你是一位專業且幽默的 AI 英文文法家教。
請依照以下兩種情境進行互動：

【情境 A：要求文法目錄】
請輸出排版整齊的「英文文法主題列表」，包含：各種時態、詞性、句型語態、子句。並引導學生挑選。

【情境 B：指定特定文法】
警告：絕對不可以一次講完！請嚴格執行「由淺入深三階段教學」：
- 第一階段（概念與公式）：解釋意義與公式，附上 2 個例句。出 1 題基礎測驗。
- 第二階段（常見情境與關鍵字）：答對後，介紹情境與關鍵字。出 1 題練習題。
- 第三階段（易錯點與大魔王比較）：過關後，抓出常犯錯誤，出 1 題挑戰題總結。

若學生答錯，請耐心解釋並再出一題類似的。請全程用繁體中文 + 表情符號 ✨。`;

function QuickActionBtn({ onClick, label }: { onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className="w-full py-2.5 px-4 bg-stone-50 text-stone-600 text-sm font-medium rounded-xl border border-stone-100 hover:bg-emerald-50 hover:text-emerald-700 transition-all text-left flex items-center justify-between group"
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 🔄 修正：自動讀取資料庫歷史紀錄
  useEffect(() => {
    const loadSavedWords = async () => {
      try {
        const response = await fetch('/api/get-words');
        if (response.ok) {
          const data = await response.json();
          setHistory(data); 
        }
      } catch (error) {
        console.error("讀取資料庫失敗：", error);
      }
    };
    loadSavedWords();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [qaMessages, grammarMessages]);

  const handleSendMessage = async (type: 'qa' | 'grammar', overrideValue?: string) => {
    const textToSend = overrideValue || inputValue;
    if (!textToSend.trim()) return;

    if (textToSend.includes('出題') || textToSend.includes('測驗') || textToSend.includes('練習')) {
      handleStartQuiz(textToSend);
      setInputValue('');
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(), role: 'user', text: textToSend, timestamp: Date.now(),
    };

    if (type === 'qa') setQaMessages(prev => [...prev, userMsg]);
    else setGrammarMessages(prev => [...prev, userMsg]);

    setInputValue('');
    setIsTyping(true);

    try {
      const messages = type === 'qa' ? qaMessages : grammarMessages;
      const systemInstruction = { 
        role: 'system', 
        text: type === 'grammar' ? FINAL_GRAMMAR_PROMPT : '你是一個簡潔的英文問答助手。' 
      };

      const chatHistory = [
        systemInstruction,
        ...messages.map(m => ({ role: m.role, text: m.text }))
      ];

      const response = await chatWithAI(textToSend, chatHistory); 
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(), role: 'model', text: response || '抱歉，請稍後再試。', timestamp: Date.now(),
      };

      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsTyping(false);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedFiles(prev => [...prev, ...files]);
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

  const renderScanTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 text-center border-b border-stone-50">
        <h2 className="text-2xl font-bold text-stone-800 mb-1">跨頁單字辨識</h2>
        <p className="text-stone-500 text-xs">上傳多張圖片，AI 將自動解析單字</p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-20">
        {isAnalyzing ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-4"><Loader2 className="animate-spin text-emerald-500" size={32} /><p className="text-stone-400 text-sm">正在分析圖片...</p></div>
        ) : scannedWords.length > 0 ? (
          <div className="space-y-4 pt-4">
            {scannedWords.map((item, idx) => (
              <div key={idx} className="bg-stone-50 rounded-2xl p-5 border border-stone-100">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2"><h3 className="text-xl font-bold text-emerald-700">{item.word}</h3><button onClick={() => speak(item.word)} className="p-1.5 bg-emerald-100 text-emerald-600 rounded-full"><Volume2 size={14} /></button></div>
                  <span className="px-2 py-1 bg-white text-stone-500 text-[10px] font-bold rounded uppercase border border-stone-100">{item.part_of_speech}</span>
                </div>
                <p className="text-stone-800 font-medium">{item.meaning}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="pt-8">
            <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50 transition-all group">
              <Camera className="text-stone-300 group-hover:text-emerald-500 mb-2" size={40} />
              <p className="text-stone-500 font-medium">點擊選擇照片</p>
            </div>
          </div>
        )}
      </div>
      <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleFileChange} />
    </div>
  );

  const renderChatTab = (type: 'qa' | 'grammar') => {
    const messages = type === 'qa' ? qaMessages : grammarMessages;
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="p-4 border-b border-stone-100 flex justify-between items-center sticky top-0 bg-white/80 backdrop-blur-md z-10">
          <h2 className="font-bold text-stone-800">{type === 'qa' ? 'AI 英文問答' : '文法學習區塊'}</h2>
          {messages.length > 0 && <button onClick={() => type === 'qa' ? setQaMessages([]) : setGrammarMessages([])} className="text-stone-300 hover:text-red-500"><X size={18} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">
                {type === 'qa' ? <MessageSquare size={32} /> : <BookOpen size={32} />}
              </div>
              <QuickActionBtn onClick={() => handleSendMessage(type, type === 'qa' ? '單字辨析建議' : '我想學文法')} label={type === 'qa' ? '單字辨析建議' : '查看文法目錄'} />
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2 shadow-sm", msg.role === 'user' ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-800")}>
                <div className="markdown-body text-sm"><Markdown>{msg.text}</Markdown></div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="p-4 border-t border-stone-100 fixed bottom-16 w-full max-w-md bg-white z-20">
          <div className="relative flex items-center">
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(type)} placeholder="輸入問題..." className="w-full bg-stone-50 rounded-full py-3 pl-5 pr-12 text-sm outline-none" />
            <button onClick={() => handleSendMessage(type)} className="absolute right-2 p-2 bg-emerald-600 text-white rounded-full"><Send size={18} /></button>
          </div>
        </div>
      </div>
    );
  };

  // 📝 修正後的歷史紀錄區塊：確保欄位對齊資料庫且可捲動
  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-stone-100 bg-white sticky top-0 z-10">
        <h2 className="text-xl font-bold text-stone-800">學習足跡</h2>
        <p className="text-xs text-stone-500">回顧您辨識過的 {history.length} 個單字</p>
      </div>
      
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-28 space-y-3">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 opacity-20"><History size={48} /><p className="text-sm font-bold mt-2">尚無紀錄</p></div>
        ) : (
          history.map((item, idx) => (
            <div key={idx} className="bg-white p-4 rounded-xl border border-stone-100 flex justify-between items-center shadow-sm">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-stone-800">{item.word}</span>
                  <span className="text-[10px] text-stone-400 uppercase font-bold">{item.part_of_speech}</span>
                </div>
                <p className="text-sm text-stone-600 mt-0.5">{item.meaning}</p>
                {item.example_en && (
                  <p className="text-[10px] text-stone-400 mt-1 italic leading-tight">"{item.example_en}"</p>
                )}
              </div>
              <button onClick={() => speak(item.word)} className="text-stone-300 hover:text-emerald-500 transition-colors ml-4"><Volume2 size={18} /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-stone-50 max-w-md mx-auto relative overflow-hidden shadow-2xl">
      <header className="bg-white px-6 py-4 border-b border-stone-100 z-20 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-black italic">AI</div>
          <h1 className="font-bold text-stone-800 tracking-tight">English Tutor</h1>
        </div>
        <span className="text-[10px] font-bold text-emerald-500 animate-pulse">ONLINE</span>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
            {activeTab === 'scan' && renderScanTab()}
            {activeTab === 'grammar' && renderChatTab('grammar')}
            {activeTab === 'qa' && renderChatTab('qa')}
            {activeTab === 'history' && renderHistoryTab()}
            {activeTab === 'quiz' && handleStartQuiz()} 
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="bg-white border-t border-stone-100 px-6 py-3 flex justify-between fixed bottom-0 w-full max-w-md z-40">
        <NavButton active={activeTab === 'scan'} onClick={() => setActiveTab('scan')} icon={<Camera size={20} />} label="辨識" />
        <NavButton active={activeTab === 'grammar'} onClick={() => setActiveTab('grammar')} icon={<BookOpen size={20} />} label="文法" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={20} />} label="紀錄" />
        <NavButton active={activeTab === 'qa'} onClick={() => setActiveTab('qa')} icon={<MessageSquare size={20} />} label="問答" />
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 transition-all", active ? "text-emerald-600 scale-105" : "text-stone-400")}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}
