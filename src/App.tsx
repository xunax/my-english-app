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
  CheckCircle2,
  HelpCircle
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

// ✨ 資料庫欄位定義
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

function QuickActionBtn({ onClick, label }: { onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className="w-full py-2.5 px-4 bg-stone-50 text-stone-600 text-sm font-medium rounded-xl border border-stone-100 hover:bg-emerald-50 hover:text-emerald-700 transition-all text-left flex items-center justify-between group"
    >
      {label}
      <ChevronRight size={16} className="text-stone-300 group-hover:text-emerald-400" />
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
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);

  // 🔄 讀取資料庫
  useEffect(() => {
    const loadSavedWords = async () => {
      try {
        const response = await fetch('/api/get-words');
        if (response.ok) {
          const data = await response.json();
          const sortedData = data.sort((a: any, b: any) => (a.id || 0) - (b.id || 0));
          setHistory(sortedData); 
        }
      } catch (error) { console.error(error); }
    };
    loadSavedWords();
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [qaMessages, grammarMessages]);

  const handleSendMessage = async (type: 'qa' | 'grammar', overrideValue?: string) => {
    const textToSend = overrideValue || inputValue;
    if (!textToSend.trim()) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: textToSend, timestamp: Date.now() };
    if (type === 'qa') setQaMessages(prev => [...prev, userMsg]);
    else setGrammarMessages(prev => [...prev, userMsg]);

    setInputValue('');
    setIsTyping(true);

    try {
      const messages = type === 'qa' ? qaMessages : grammarMessages;
      const chatHistory = messages.map(m => ({ role: m.role, text: m.text }));
      const response = await chatWithAI(textToSend, chatHistory); 
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response || '老師暫時休息中...', timestamp: Date.now() };
      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);
    } catch (error) { console.error(error); } finally { setIsTyping(false); }
  };

  // ✨ 核心修正：強制十題選擇題的產出邏輯
  const handleStartQuiz = async () => {
    setIsGeneratingQuiz(true);
    setActiveTab('quiz');
    setCurrentQuiz([]);
    setQuizIndex(0);
    setUserAnswers({});
    setShowExplanation(false);
    setQuizScore(null);
    try {
      // 構建強力的提示詞，要求 10 題選擇題
      const wordList = history.length > 0 ? history.map(w => w.word).join(', ') : "基礎常用單字";
      const quizPrompt = `請針對以下單字範圍出題：${wordList}。
      規則：
      1. 必須出滿 10 題。
      2. 全部題型必須是「四選一選擇題」。
      3. 題目必須包含：單字意義、詞性用法或填空。
      4. 請用繁體中文提供解析。`;

      const quiz = await generateQuiz(quizPrompt);
      if (quiz && Array.isArray(quiz) && quiz.length > 0) {
        // 截取前 10 題，確保數量正確
        setCurrentQuiz(quiz.slice(0, 10));
      }
    } catch (error) { 
      console.error("產生測驗失敗：", error); 
    } finally { 
      setIsGeneratingQuiz(false); 
    }
  };

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-4">
        <Loader2 className="animate-spin text-emerald-500" size={48} />
        <p className="font-bold text-stone-600 text-lg">正在挑選 10 題精選題目...</p>
      </div>
    );

    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
        <CheckCircle2 size={80} className="text-emerald-500" />
        <h2 className="text-2xl font-bold">測驗完成！</h2>
        <div className="bg-emerald-50 px-8 py-4 rounded-3xl">
          <p className="text-stone-500 text-sm mb-1 uppercase font-bold tracking-widest">最終得分</p>
          <span className="text-emerald-600 font-bold text-4xl">{quizScore} / {currentQuiz.length}</span>
        </div>
        <div className="w-full space-y-3">
          <button onClick={handleStartQuiz} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg active:scale-95 transition-all">再挑戰一次</button>
          <button onClick={() => setActiveTab('history')} className="w-full py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">返回紀錄</button>
        </div>
      </div>
    );

    if (currentQuiz.length === 0) return (
      <div className="p-6 flex flex-col justify-center h-full space-y-10">
        <div className="text-center space-y-4">
          <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600 shadow-inner">
            <BookOpen size={48} />
          </div>
          <h3 className="text-2xl font-bold text-stone-800">準備好挑戰了嗎？</h3>
          <p className="text-stone-400">系統將根據你的學習足跡產生 10 題選擇題</p>
        </div>
        <button 
          onClick={handleStartQuiz} 
          className="w-full py-5 bg-emerald-600 text-white rounded-3xl font-bold text-lg shadow-xl shadow-emerald-100 active:scale-95 transition-all"
        >
          開始複習測驗 (10題)
        </button>
      </div>
    );

    const q = currentQuiz[quizIndex];
    const handleAnswer = (ans: string) => {
      if (showExplanation) return;
      setUserAnswers(prev => ({ ...prev, [q.id]: ans }));
      setShowExplanation(true);
    };

    return (
      <div className="flex flex-col h-full p-6 overflow-y-auto pb-28">
        <div className="flex justify-between items-center mb-6">
          <span className="text-xs font-bold text-stone-400 bg-stone-100 px-2 py-1 rounded">QUESTION {quizIndex + 1} / {currentQuiz.length}</span>
          <div className="flex gap-1">
            {currentQuiz.map((_, i) => (
              <div key={i} className={cn("w-1.5 h-1.5 rounded-full transition-all", i === quizIndex ? "bg-emerald-500 w-4" : i < quizIndex ? "bg-emerald-200" : "bg-stone-200")} />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100 mb-6">
          <h3 className="text-lg font-bold text-stone-800 leading-relaxed">{q.question}</h3>
        </div>
        <div className="space-y-3">
          {q.options?.map((opt, i) => (
            <button 
              key={i} 
              onClick={() => handleAnswer(opt)} 
              className={cn(
                "w-full p-4 rounded-xl border text-left transition-all relative overflow-hidden",
                showExplanation 
                  ? (opt === q.correct_answer 
                      ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-bold" 
                      : opt === userAnswers[q.id] 
                        ? "bg-red-50 border-red-500 text-red-700" 
                        : "bg-white text-stone-300 border-stone-100") 
                  : "bg-white border-stone-100 hover:bg-stone-50 text-stone-700"
              )}
            >
              <div className="flex justify-between items-center">
                <span>{opt}</span>
                {showExplanation && opt === q.correct_answer && <CheckCircle2 size={18} className="text-emerald-500" />}
              </div>
            </button>
          ))}
        </div>
        {showExplanation && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
            <div className="p-5 bg-stone-100 rounded-2xl border border-stone-200">
              <h4 className="font-bold text-stone-800 mb-2 flex items-center gap-2 text-sm"><HelpCircle size={16} className="text-emerald-500" /> 題目解析</h4>
              <p className="text-sm text-stone-600 leading-relaxed">{q.explanation}</p>
            </div>
            <button 
              onClick={() => {
                if (quizIndex < currentQuiz.length - 1) {
                  setQuizIndex(prev => prev + 1);
                  setShowExplanation(false);
                } else {
                  const score = currentQuiz.reduce((acc, curr) => acc + (userAnswers[curr.id] === curr.correct_answer ? 1 : 0), 0);
                  setQuizScore(score);
                }
              }} 
              className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg"
            >
              {quizIndex < currentQuiz.length - 1 ? '下一題' : '查看總結報告'}
              <ChevronRight size={18} />
            </button>
          </motion.div>
        )}
      </div>
    );
  };

  // ✨ 維持問答介面的正確性
  const renderChatTab = (type: 'qa' | 'grammar') => {
    const messages = type === 'qa' ? qaMessages : grammarMessages;
    const isQA = type === 'qa';
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="p-4 border-b border-stone-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h2 className="font-bold text-stone-800">{isQA ? 'AI 英文問答' : '文法學習區塊'}</h2>
          {messages.length > 0 && <button onClick={() => isQA ? setQaMessages([]) : setGrammarMessages([])} className="text-stone-300 hover:text-red-500"><X size={18} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 shadow-sm">{isQA ? <MessageSquare size={32} /> : <BookOpen size={32} />}</div>
              <div>
                <h4 className="font-bold text-stone-800 mb-1">{isQA ? '有任何英文問題嗎？' : '想學文法嗎？'}</h4>
                <p className="text-stone-400 text-xs px-10">{isQA ? '輸入想問的內容，我會為你詳細解答！' : '請輸入你想學習的主題，例如「現在完成式」。'}</p>
              </div>
              <div className="w-full px-8">
                <QuickActionBtn onClick={() => handleSendMessage(type, isQA ? '我想了解常見英文錯誤' : '我想從頭學文法')} label={isQA ? '看看常見錯誤分析' : '查看文法主題清單'} />
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 shadow-sm", msg.role === 'user' ? "bg-emerald-600 text-white" : "bg-stone-50 text-stone-800 border border-stone-100")}>
                <div className="markdown-body text-sm leading-relaxed"><Markdown>{msg.text}</Markdown></div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="p-4 border-t border-stone-100 fixed bottom-16 w-full max-w-md bg-white z-20">
          <div className="relative flex items-center">
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(type)} placeholder={isQA ? "請輸入您的英文問題..." : "例如：現在完成式"} className="w-full bg-stone-50 border border-stone-100 rounded-full py-3.5 pl-6 pr-14 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all" />
            <button onClick={() => handleSendMessage(type)} className="absolute right-2 p-2 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-colors"><Send size={18} /></button>
          </div>
        </div>
      </div>
    );
  };

  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-stone-100 bg-white sticky top-0 z-10">
        <h2 className="text-xl font-bold text-stone-800">學習足跡</h2>
        <p className="text-xs text-stone-500">已錄入 {history.length} 個單字，將用於產生測驗題目</p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 space-y-6">
        {history.length === 0 ? <div className="flex flex-col items-center justify-center h-64 opacity-20"><History size={48} /><p className="font-bold mt-2">尚無紀錄</p></div> : (
          history.map((item, idx) => (
            <div key={idx} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm transition-all active:scale-[0.98]">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[10px] text-emerald-500 font-mono font-bold">#{item.id}</span>
                    <h3 className="text-xl font-bold text-stone-800">{item.word}</h3>
                    {item.part_of_speech && <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-bold uppercase border border-emerald-100">{item.part_of_speech}</span>}
                  </div>
                  <p className="text-[12px] text-stone-400 font-mono">{item.pronunciation}</p>
                </div>
                <button onClick={() => {const u = new SpeechSynthesisUtterance(item.word); u.lang='en-US'; window.speechSynthesis.speak(u);}} className="p-2.5 bg-stone-50 text-stone-300 rounded-full hover:text-emerald-500 transition-colors"><Volume2 size={20} /></button>
              </div>
              <p className="text-base text-stone-700 font-medium mb-3 leading-relaxed">{item.meaning}</p>
              {item.forms && item.forms !== '無' && <div className="flex gap-1.5 items-baseline mb-4"><span className="text-[10px] text-emerald-500 font-bold shrink-0">型態：</span><p className="text-[11px] text-stone-500 italic">{item.forms}</p></div>}
              {item.example_en && (
                <div className="mt-3 pt-3 border-t border-stone-50 bg-emerald-50/10 p-4 rounded-2xl">
                  <p className="text-sm text-stone-600 italic font-medium leading-relaxed mb-1.5">"{item.example_en}"</p>
                  <p className="text-xs text-stone-400">{item.example_tw}</p>
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
      <header className="bg-white px-6 py-4 border-b border-stone-100 z-20 flex justify-between items-center shadow-sm">
        <h1 className="font-bold text-stone-800 tracking-tight">English Tutor</h1>
        <span className="text-[10px] text-emerald-500 font-bold tracking-widest flex items-center gap-1"><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />ONLINE</span>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
            {activeTab === 'scan' && (
              <div className="flex flex-col h-full bg-white">
                <div className="p-6 text-center border-b border-stone-50"><h2 className="text-2xl font-bold text-stone-800 tracking-tight">跨頁單字辨識</h2></div>
                <div className="flex-1 overflow-y-auto px-6 pb-20 pt-4">
                  {isAnalyzing ? <div className="flex flex-col items-center justify-center h-64"><Loader2 className="animate-spin text-emerald-500" size={32} /></div> : (
                    <div className="space-y-4">
                      {scannedWords.map((w, i) => (<div key={i} className="bg-stone-50 rounded-2xl p-5 border border-stone-100"><h3 className="text-xl font-bold text-emerald-700">{w.word}</h3><p className="text-stone-800">{w.meaning}</p></div>))}
                      {scannedWords.length === 0 && <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 transition-all mt-8"><Camera className="text-stone-300 mb-2" size={40} /><p className="text-stone-500 font-medium">點擊上傳照片</p></div>}
                    </div>
                  )}
                </div>
                <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={async(e)=>{
                  const files=Array.from(e.target.files||[]); if(!files.length)return;
                  setIsAnalyzing(true);
                  const base64s=await Promise.all(files.map(f=>new Promise<string>(r=>{const rd=new FileReader();rd.onloadend=()=>r((rd.result as string).split(',')[1]);rd.readAsDataURL(f);})));
                  const res=await analyzeImages(base64s); setScannedWords(res); setHistory(p=>[...res, ...p]); setIsAnalyzing(false);
                }} />
              </div>
            )}
            {activeTab === 'grammar' && renderChatTab('grammar')}
            {activeTab === 'quiz' && renderQuizTab()}
            {activeTab === 'qa' && renderChatTab('qa')}
            {activeTab === 'history' && renderHistoryTab()}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="bg-white border-t border-stone-100 px-6 py-3 flex justify-between fixed bottom-0 w-full max-w-md z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
        <NavButton active={activeTab === 'scan'} onClick={() => setActiveTab('scan')} icon={<Camera size={22} />} label="辨識" />
        <NavButton active={activeTab === 'grammar'} onClick={() => setActiveTab('grammar')} icon={<BookOpen size={22} />} label="文法" />
        <NavButton active={activeTab === 'quiz'} onClick={() => setActiveTab('quiz')} icon={<CheckCircle2 size={22} />} label="測驗" />
        <NavButton active={activeTab === 'qa'} onClick={() => setActiveTab('qa')} icon={<MessageSquare size={22} />} label="問答" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History size={22} />} label="紀錄" />
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 transition-all", active ? "text-emerald-600 scale-110" : "text-stone-300 hover:text-stone-500")}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}
