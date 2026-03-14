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

    if (textToSend.includes('測驗') || textToSend.includes('練習')) {
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
      const chatHistory = messages.map(m => ({ role: m.role, text: m.text }));
      const response = await chatWithAI(textToSend, chatHistory); 
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response || '老師暫時休息中...', timestamp: Date.now() };
      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);
    } catch (error) { console.error(error); } finally { setIsTyping(false); }
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
      const quizContext = context || (history.length > 0 ? `複習：${history.map(w => w.word).join(', ')}` : "基礎文法題");
      const quiz = await generateQuiz(quizContext);
      if (quiz && quiz.length > 0) setCurrentQuiz(quiz);
    } catch (error) { console.error(error); } finally { setIsGeneratingQuiz(false); }
  };

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return <div className="flex flex-col items-center justify-center h-full p-6"><Loader2 className="animate-spin text-emerald-500 mb-4" size={40} /><p className="font-bold text-stone-500">正在出題...</p></div>;
    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
        <CheckCircle2 size={80} className="text-emerald-500" />
        <h2 className="text-2xl font-bold">測驗完成！</h2>
        <p className="text-stone-500">得分：<span className="text-emerald-600 font-bold text-2xl">{quizScore} / {currentQuiz.length}</span></p>
        <button onClick={() => setActiveTab('history')} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg">查看單字足跡</button>
      </div>
    );

    if (currentQuiz.length === 0) return (
      <div className="p-6 flex flex-col justify-center h-full space-y-8">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600"><CheckCircle2 size={40} /></div>
          <h3 className="text-xl font-bold">準備好挑戰了嗎？</h3>
        </div>
        <div className="space-y-3">
          <button onClick={() => handleStartQuiz()} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold">開始單字複習測驗</button>
          <button onClick={() => handleStartQuiz("基礎時態測驗")} className="w-full py-4 bg-white border border-stone-100 text-stone-600 rounded-2xl font-bold">基礎文法測驗</button>
        </div>
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
        <div className="flex justify-between items-center mb-6"><span className="text-xs font-bold text-stone-400">問題 {quizIndex + 1} / {currentQuiz.length}</span></div>
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100 mb-6">
          <h3 className="text-lg font-bold text-stone-800 leading-relaxed">{q.question}</h3>
        </div>
        <div className="space-y-3">
          {q.options?.map((opt, i) => (
            <button key={i} onClick={() => handleAnswer(opt)} className={cn("w-full p-4 rounded-xl border text-left transition-all", showExplanation ? (opt === q.correct_answer ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-bold" : opt === userAnswers[q.id] ? "bg-red-50 border-red-500 text-red-700" : "bg-white text-stone-300") : "bg-white hover:bg-emerald-50")}>{opt}</button>
          ))}
          {!q.options && !showExplanation && (
            <div className="space-y-4"><input type="text" placeholder="輸入答案..." className="w-full p-4 rounded-xl border border-stone-100 outline-none focus:ring-2 focus:ring-emerald-500/20" onKeyDown={(e) => e.key === 'Enter' && handleAnswer((e.target as HTMLInputElement).value)} /><button onClick={() => handleAnswer((document.querySelector('input') as HTMLInputElement).value)} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold">送出答案</button></div>
          )}
        </div>
        {showExplanation && (
          <div className="mt-6 p-5 bg-stone-100 rounded-2xl">
            <h4 className="font-bold text-stone-800 mb-2 flex items-center gap-2"><HelpCircle size={16} /> 解析</h4>
            <p className="text-sm text-stone-600 leading-relaxed">{q.explanation}</p>
            <button onClick={() => quizIndex < currentQuiz.length - 1 ? (setQuizIndex(prev => prev + 1), setShowExplanation(false)) : setQuizScore(currentQuiz.reduce((acc, curr) => acc + (userAnswers[curr.id] === curr.correct_answer ? 1 : 0), 0))} className="w-full mt-4 py-3 bg-stone-900 text-white rounded-xl font-bold">{quizIndex < currentQuiz.length - 1 ? '下一題' : '查看結果'}</button>
          </div>
        )}
      </div>
    );
  };

  // ✨ 關鍵修正：區分問答與文法
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
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">{isQA ? <MessageSquare size={32} /> : <BookOpen size={32} />}</div>
              <p className="text-stone-500 text-sm">{isQA ? '對英文用法有疑問嗎？儘管問我！' : '輸入文法主題，即刻開始教學！'}</p>
              <QuickActionBtn onClick={() => handleSendMessage(type, isQA ? '我想了解常見錯誤' : '我想學文法')} label={isQA ? '常用口語建議' : '查看文法目錄'} />
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
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(type)} placeholder={isQA ? "問點什麼吧..." : "輸入主題..."} className="w-full bg-stone-50 rounded-full py-3 pl-5 pr-12 text-sm outline-none focus:ring-1 focus:ring-emerald-500" />
            <button onClick={() => handleSendMessage(type)} className="absolute right-2 p-2 bg-emerald-600 text-white rounded-full"><Send size={18} /></button>
          </div>
        </div>
      </div>
    );
  };

  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-stone-100 bg-white sticky top-0 z-10"><h2 className="text-xl font-bold text-stone-800">學習足跡</h2><p className="text-xs text-stone-500">共錄入 {history.length} 個單字</p></div>
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
      <header className="bg-white px-6 py-4 border-b border-stone-100 z-20 flex justify-between items-center"><h1 className="font-bold text-stone-800 tracking-tight">English Tutor</h1><span className="text-[10px] text-emerald-500 font-bold tracking-widest">ONLINE</span></header>
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
                      {scannedWords.length === 0 && <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 transition-all mt-8"><Camera className="text-stone-300 mb-2" size={40} /><p className="text-stone-500">點擊上傳照片</p></div>}
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
