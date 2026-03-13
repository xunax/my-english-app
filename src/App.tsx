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

type Tab = 'scan' | 'grammar' | 'quiz' | 'qa' | 'history';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

// ✨ 介面定義：嚴格對照資料庫欄位名稱
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

// 1. 文法老師最強指令 (指令黏貼法，保證文法功能不壞掉)
const GRAMMAR_INSTRUCTION = `你是專業英文家教。請嚴格執行：
1. 若學生說「我想學文法」或「目錄」-> 列出：時態、詞性、句型、子句並引導挑選。
2. 若學生指定文法 -> 執行由淺入深三階段教學(公式、情境、易錯)。
3. **警告：每次只教一階段！** 出 1 題測驗後必須「停止輸出」等回答。
4. 答對才進下一階段。用繁體中文+表情符號。`;

const QA_INSTRUCTION = "你是一個簡潔的英文問答助手，請用繁體中文回答。";

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 🔄 讀取資料庫歷史紀錄 + 按照 ID 順序排列
  useEffect(() => {
    const loadSavedWords = async () => {
      try {
        const response = await fetch('/api/get-words');
        if (response.ok) {
          const data = await response.json();
          const sortedData = data.sort((a: any, b: any) => (a.id || 0) - (b.id || 0));
          setHistory(sortedData); 
        }
      } catch (error) {
        console.error("資料讀取失敗：", error);
      }
    };
    loadSavedWords();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [qaMessages, grammarMessages]);

  // 2. 核心發送：採用前置指令法，保證 AI 每一輪都記得規則且不噴錯
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
      const chatHistory = messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }));
      
      // 組合最終指令
      const prompt = type === 'grammar' ? GRAMMAR_INSTRUCTION : QA_INSTRUCTION;
      const finalInput = `${prompt}\n\n目前學生輸入：${textToSend}`;

      const response = await chatWithAI(finalInput, chatHistory); 
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response || '請稍後再試。', timestamp: Date.now() };

      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsTyping(false);
    }
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
      const quizContext = context || (history.length > 0 ? `複習：${history.map(w => w.word).join(', ')}` : "基礎英文測驗");
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

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return <div className="flex flex-col items-center justify-center h-full"><Loader2 className="animate-spin text-emerald-500" size={32} /><p className="mt-4 font-bold text-stone-600">正在準備測驗...</p></div>;
    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
        <CheckCircle2 size={64} className="text-emerald-500" />
        <h2 className="text-2xl font-bold text-stone-800">測驗完成！</h2>
        <p className="text-stone-500">得分：{quizScore} / {currentQuiz.length}</p>
        <button onClick={() => setActiveTab('history')} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg">查看紀錄</button>
      </div>
    );

    if (currentQuiz.length === 0) return (
      <div className="p-6 text-center flex flex-col justify-center h-full space-y-6">
        <BookOpen size={64} className="mx-auto text-emerald-100" />
        <h3 className="text-xl font-bold text-stone-800">準備好接受挑戰了嗎？</h3>
        <button onClick={() => handleStartQuiz()} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold">開始複習單字</button>
      </div>
    );

    const q = currentQuiz[quizIndex];
    return (
      <div className="flex flex-col h-full p-6 overflow-y-auto pb-28">
        <h3 className="text-lg font-bold mb-4 text-stone-800 leading-relaxed">{q.question}</h3>
        <div className="space-y-3">
          {q.options?.map((opt, i) => (
            <button key={i} onClick={() => handleAnswer(opt)} className={cn("w-full p-4 rounded-xl border text-left transition-all", showExplanation ? (opt === q.correct_answer ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-bold" : opt === userAnswers[q.id] ? "bg-red-50 border-red-500 text-red-700" : "bg-white") : "bg-white hover:bg-emerald-50")}>{opt}</button>
          ))}
        </div>
        {showExplanation && (
          <div className="mt-6 p-5 bg-stone-100 rounded-2xl">
            <h4 className="font-bold text-stone-800 mb-2">解析：</h4>
            <p className="text-sm text-stone-600 leading-relaxed">{q.explanation}</p>
            <button onClick={nextQuestion} className="w-full mt-4 py-3 bg-stone-900 text-white rounded-xl font-bold">下一題</button>
          </div>
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
              <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 transition-all mt-8">
                <Camera className="text-stone-300 mb-2" size={40} />
                <p className="text-stone-500">點擊選擇照片</p>
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
              <QuickActionBtn onClick={() => handleSendMessage(type, type === 'qa' ? '單字辨析建議' : '我想學文法')} label={type === 'qa' ? '單字辨析建議' : '查看文法目錄'} />
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2", msg.role === 'user' ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-800")}>
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

  // ✨ 關鍵修正：學習足跡 (對齊資料庫欄位 並按照 ID 排序)
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
              <p className="text-stone-700 font-medium mb-2">{item.meaning}</p>
              
              {/* ✨ 型態顯示 */}
              {item.forms && item.forms !== '無' && (
                <p className="text-[10px] text-emerald-600 font-medium mb-3 bg-emerald-50 px-2 py-0.5 rounded-full w-fit">型態: {item.forms}</p>
              )}

              {/* ✨ 補回來的例句區塊 */}
              {item.example_en && (
                <div className="mt-2 pt-2 border-t border-stone-50">
                  <p className="text-xs text-stone-600 italic leading-relaxed">"{item.example_en}"</p>
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
      <header className="bg-white px-6 py-4 border-b border-stone-100 z-20 flex justify-between items-center">
        <h1 className="font-bold text-stone-800 tracking-tight">English Tutor</h1>
        <span className="text-[10px] text-emerald-500 font-bold animate-pulse">ONLINE</span>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
            {activeTab === 'scan' && renderScanTab()}
            {activeTab === 'grammar' && renderChatTab('grammar')}
            {activeTab === 'quiz' && renderQuizTab()}
            {activeTab === 'qa' && renderChatTab('qa')}
            {activeTab === 'history' && renderHistoryTab()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ✨ 修復後的順序：辨識、文法、測驗、問答、紀錄 */}
      <nav className="bg-white border-t border-stone-100 px-6 py-3 flex justify-between fixed bottom-0 w-full max-w-md z-40">
        <NavButton active={activeTab === 'scan'} onClick={() => setActiveTab('scan')} icon={<Camera size={20} />} label="辨識" />
        <NavButton active={activeTab === 'grammar'} onClick={() => setActiveTab('grammar')} icon={<BookOpen size={20} />} label="文法" />
        <NavButton active={activeTab === 'quiz'} onClick={() => setActiveTab('quiz')} icon={<CheckCircle2 size={20} />} label="測驗" />
        <NavButton active={activeTab === 'qa'} onClick={() => setActiveTab('qa')} icon={<MessageSquare size={20} />} label="問答" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={20} />} label="紀錄" />
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
