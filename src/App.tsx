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

// ✨ 介面定義：與資料庫欄位完全對齊
interface WordAnalysis {
  id?: number;
  word: string;
  pronunciation: string;
  meaning: string;
  part_of_speech: string; 
  example_en: string;    
  example_tw: string;    
  forms?: string;
}

// 1. 文法老師靈魂劇本
const FINAL_GRAMMAR_PROMPT = `你是一位專業且幽默的 AI 英文文法家教。
請依照以下兩種情境進行互動：

【情境 A：要求文法目錄】
請輸出排版整齊的「英文文法主題列表」，包含：各種時態、詞性、句型語態、子句。並引導學生挑選。

【情境 B：指定特定文法】
警告：絕對不可以一次講完！請嚴格執行「由淺入深三階段教學」：
- 第一階段（概念與公式）：解釋意義與公式，附上 2 個例句。出 1 題基礎測驗。(等待回答)
- 第二階段（常見情境與關鍵字）：答對後，介紹情境與關鍵字。出 1 題練習題。(等待回答)
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

  // 🔄 讀取資料庫歷史紀錄，並按照 ID 順序排列
  useEffect(() => {
    const loadSavedWords = async () => {
      try {
        const response = await fetch('/api/get-words');
        if (response.ok) {
          const data = await response.json();
          // ✨ 按照 ID 順序排列
          const sortedData = data.sort((a: any, b: any) => (a.id || 0) - (b.id || 0));
          setHistory(sortedData); 
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

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: textToSend, timestamp: Date.now() };
    if (type === 'qa') setQaMessages(prev => [...prev, userMsg]);
    else setGrammarMessages(prev => [...prev, userMsg]);

    setInputValue('');
    setIsTyping(true);

    try {
      const messages = type === 'qa' ? qaMessages : grammarMessages;
      const systemInstruction = { 
        role: 'system', 
        text: type === 'grammar' ? FINAL_GRAMMAR_PROMPT : '你是一個簡潔助教。' 
      };
      const chatHistory = [systemInstruction, ...messages.map(m => ({ role: m.role, text: m.text }))];
      const response = await chatWithAI(textToSend, chatHistory); 
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response || '請稍後再試。', timestamp: Date.now() };

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
      const quizContext = context || (history.length > 0 ? `複習：${history.map(w => w.word).join(', ')}` : "英文文法測驗");
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

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return <div className="flex flex-col items-center justify-center h-full"><Loader2 className="animate-spin text-emerald-500" size={32} /><p className="mt-4 font-bold text-stone-600">正在準備測驗...</p></div>;
    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
        <CheckCircle2 size={64} className="text-emerald-500" />
        <h2 className="text-2xl font-bold">測驗完成！</h2>
        <p className="text-stone-500">得分：{quizScore} / {currentQuiz.length}</p>
        <button onClick={() => setActiveTab('history')} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100">查看學習紀錄</button>
      </div>
    );

    if (currentQuiz.length === 0) return (
      <div className="p-6 text-center space-y-6 flex flex-col justify-center h-full">
        <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600"><BookOpen size={40} /></div>
        <h3 className="text-xl font-bold text-stone-800">準備好接受挑戰了嗎？</h3>
        <button onClick={() => handleStartQuiz()} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 active:scale-95 transition-all">開始複習單字</button>
      </div>
    );

    const q = currentQuiz[quizIndex];
    return (
      <div className="flex flex-col h-full p-6 overflow-y-auto pb-28">
        <div className="flex justify-between items-center mb-6">
          <span className="text-xs font-bold text-stone-400">問題 {quizIndex + 1} / {currentQuiz.length}</span>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100 mb-6">
          <h3 className="text-lg font-bold text-stone-800 leading-relaxed">{q.question}</h3>
        </div>
        <div className="space-y-3">
          {q.options?.map((opt, i) => (
            <button key={i} onClick={() => handleAnswer(opt)} className={cn("w-full p-4 rounded-xl border text-left transition-all", showExplanation ? (opt === q.correct_answer ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-bold" : opt === userAnswers[q.id] ? "bg-red-50 border-red-500 text-red-700" : "bg-white") : "bg-white hover:bg-emerald-50")}>{opt}</button>
          ))}
        </div>
        {showExplanation && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 p-5 bg-stone-100 rounded-2xl">
            <h4 className="font-bold text-stone-800 mb-2">解析：</h4>
            <p className="text-sm text-stone-600 leading-relaxed">{q.explanation}</p>
            <button onClick={nextQuestion} className="w-full mt-4 py-3 bg-stone-900 text-white rounded-xl font-bold">下一題</button>
          </motion.div>
        )}
      </div>
    );
  };

  const renderScanTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 text-center border-b border-stone-50"><h2 className="text-2xl font-bold text-stone-800 tracking-tight">跨頁單字辨識</h2></div>
      <div className="flex-1 overflow-y-auto px-6 pb-20">
        {isAnalyzing ? <div className="flex flex-col items-center justify-center h-64"><Loader2 className="animate-spin text-emerald-500" size={32} /></div> : (
          <div className="space-y-4 pt-4">
            {scannedWords.map((item, idx) => (
              <div key={idx} className="bg-stone-50 rounded-2xl p-5 border border-stone-100 shadow-sm">
                <div className="flex justify-between items-start mb-2"><h3 className="text-xl font-bold text-emerald-700">{item.word}</h3><button onClick={() => speak(item.word)} className="p-1.5 bg-emerald-100 rounded-full text-emerald-600"><Volume2 size={14} /></button></div>
                <p className="text-stone-800 font-medium mb-1">{item.meaning}</p>
                <div className="flex gap-2 text-[10px] text-stone-400 font-bold uppercase"><span>{item.part_of_speech}</span><span>{item.pronunciation}</span></div>
              </div>
            ))}
            {scannedWords.length === 0 && (
              <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 transition-all group mt-8">
                <Camera className="text-stone-300 group-hover:text-emerald-500 mb-2" size={40} />
                <p className="text-stone-500 font-medium">點擊選擇照片</p>
              </div>
            )}
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
        <div className="p-4 border-b border-stone-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h2 className="font-bold text-stone-800">{type === 'qa' ? 'AI 英文問答' : '文法學習區塊'}</h2>
          {messages.length > 0 && <button onClick={() => type === 'qa' ? setQaMessages([]) : setGrammarMessages([])} className="text-stone-300 hover:text-red-500"><X size={18} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">{type === 'qa' ? <MessageSquare size={32} /> : <BookOpen size={32} />}</div>
              <QuickActionBtn onClick={() => handleSendMessage(type, type === 'qa' ? '常見錯誤' : '我想學文法')} label={type === 'qa' ? '單字辨析建議' : '查看文法目錄'} />
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2", msg.role === 'user' ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-800")}>
                <Markdown className="markdown-body text-sm">{msg.text}</Markdown>
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

  // ✨ 關鍵修正：修復後的學習足跡（按照 ID 排序 + 顯示例句與詞性）
  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-stone-100 bg-white sticky top-0 z-10">
        <h2 className="text-xl font-bold text-stone-800">學習足跡</h2>
        <p className="text-xs text-stone-500">已錄入 {history.length} 個單字 (依 ID 排序)</p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-28 space-y-4">
        {history.length === 0 ? <div className="flex flex-col items-center justify-center h-64 opacity-20"><History size={48} /><p className="font-bold mt-2">尚無紀錄</p></div> : (
          history.map((item, idx) => (
            <div key={idx} className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-emerald-500 font-mono font-bold">#{item.id}</span>
                    <h3 className="text-lg font-bold text-stone-800">{item.word}</h3>
                    <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded font-bold uppercase">{item.part_of_speech}</span>
                  </div>
                  <p className="text-[11px] text-stone-400 font-mono">{item.pronunciation}</p>
                </div>
                <button onClick={() => speak(item.word)} className="p-2 text-stone-300 hover:text-emerald-500 transition-colors"><Volume2 size={18} /></button>
              </div>
              <p className="text-stone-700 font-medium mb-3">{item.meaning}</p>
              
              {/* ✨ 補回來的例句區塊 */}
              {item.example_en && (
                <div className="mt-2 pt-2 border-t border-stone-50">
                  <p className="text-xs text-stone-500 italic leading-relaxed">"{item.example_en}"</p>
                  <p className="text-[10px] text-stone-400 mt-1">{item.example_tw}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-stone-50 max-w-md mx-auto relative overflow-hidden shadow-2xl">
      <header className="bg-white px-6 py-4 border-b border-stone-100 z-20 flex justify-between">
        <h1 className="font-bold text-stone-800">English Tutor</h1>
        <span className="text-[10px] text-emerald-500 font-bold">ONLINE</span>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} className="h-full">
            {activeTab === 'scan' && renderScanTab()}
            {activeTab === 'grammar' && renderChatTab('grammar')}
            {activeTab === 'history' && renderHistoryTab()}
            {activeTab === 'qa' && renderChatTab('qa')}
            {activeTab === 'quiz' && renderQuizTab()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ✨ 對調後的導覽列：辨識、文法、紀錄、問答、測驗 */}
      <nav className="bg-white border-t border-stone-100 px-6 py-3 flex justify-between fixed bottom-0 w-full max-w-md z-40">
        <NavButton active={activeTab === 'scan'} onClick={() => setActiveTab('scan')} icon={<Camera size={20} />} label="辨識" />
        <NavButton active={activeTab === 'grammar'} onClick={() => setActiveTab('grammar')} icon={<BookOpen size={20} />} label="文法" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={20} />} label="紀錄" />
        <NavButton active={activeTab === 'qa'} onClick={() => setActiveTab('qa')} icon={<MessageSquare size={20} />} label="問答" />
        <NavButton active={activeTab === 'quiz'} onClick={() => setActiveTab('quiz')} icon={<CheckCircle2 size={20} />} label="測驗" />
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 transition-all", active ? "text-emerald-600 scale-105" : "text-stone-400 hover:text-stone-600")}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}
