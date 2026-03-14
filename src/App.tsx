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

// ✨ 修正順序：辨識、文法、測驗、問答、紀錄
type Tab = 'scan' | 'grammar' | 'quiz' | 'qa' | 'history';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

// ✨ 介面定義：完全對應資料庫欄位
interface WordAnalysis {
  id?: number;
  word: string;
  pronunciation: string;
  meaning: string;
  part_of_speech?: string; 
  partOfSpeech?: string;
  example_en?: string;    
  exampleEn?: string;
  example_tw?: string;    
  exampleTw?: string;
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
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [customGrammarTopic, setCustomGrammarTopic] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 🔄 從資料庫載入紀錄並按 ID 排序
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
        console.error("資料庫讀取失敗：", error);
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
      const chatHistory = messages.map(m => ({ 
        role: m.role === 'user' ? 'user' : 'model', 
        text: m.text 
      }));

      const response = await chatWithAI(textToSend, chatHistory); 
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response || '抱歉，我現在無法回答。', timestamp: Date.now() };
      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsTyping(false);
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

  const handleStartQuiz = async (context?: string) => {
    setIsGeneratingQuiz(true);
    setActiveTab('quiz');
    setCurrentQuiz([]);
    setQuizIndex(0);
    setUserAnswers({});
    setShowExplanation(false);
    setQuizScore(null);
    try {
      // 確保即使 history 為空也能運作
      const quizContext = context?.trim() || (history && history.length > 0 
        ? `複習以下單字：${history.map(w => w.word).join(', ')}` 
        : "隨機出 3 題基礎英文文法測驗");
      
      const quiz = await generateQuiz(quizContext);
      if (quiz && Array.isArray(quiz) && quiz.length > 0) {
        setCurrentQuiz(quiz);
      } else {
        console.error("AI 回傳題目為空或格式錯誤");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsGeneratingQuiz(false);
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
      const base64Promises = selectedFiles.map(file => new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      }));
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

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return <div className="flex flex-col items-center justify-center h-full space-y-4 p-6 text-center"><Loader2 className="w-12 h-12 text-emerald-500 animate-spin" /><h3 className="text-lg font-bold">正在為您出題...</h3></div>;
    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
        <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600"><CheckCircle2 size={48} /></div>
        <div><h2 className="text-2xl font-bold text-stone-800">測驗完成！</h2><p className="text-stone-500 mt-2">得分：<span className="text-emerald-600 font-bold text-xl">{quizScore} / {currentQuiz.length}</span></p></div>
        <button onClick={() => handleStartQuiz()} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg">再試一次</button>
        <button onClick={() => setActiveTab('history')} className="w-full py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">查看紀錄</button>
      </div>
    );

    if (currentQuiz.length === 0) {
      const presets = ["現在完成式", "過去簡單式", "被動語態", "關係代名詞", "假設語氣"];
      return (
        <div className="flex flex-col h-full p-6 overflow-y-auto">
          <div className="flex flex-col items-center text-center space-y-4 mb-8">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600"><BookOpen size={40} /></div>
            <h3 className="text-xl font-bold text-stone-800">準備好接受挑戰了嗎？</h3>
            <p className="text-stone-500 text-sm">選擇主題後 AI 將為您出題</p>
          </div>
          <div className="space-y-6">
            <button onClick={() => handleStartQuiz()} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2"><History size={18} />複習辨識過的單字</button>
            <section><h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">熱門文法主題</h4>
              <div className="grid grid-cols-2 gap-2">{presets.map(topic => <button key={topic} onClick={() => handleStartQuiz(`請出 3-5 題「${topic}」考我`)} className="py-3 px-4 bg-white border border-stone-100 text-stone-600 text-sm font-bold rounded-xl hover:bg-emerald-50">{topic}</button>)}</div>
            </section>
            <div className="relative flex items-center">
              <input type="text" value={customGrammarTopic} onChange={(e) => setCustomGrammarTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleStartQuiz(customGrammarTopic)} placeholder="輸入自訂主題..." className="w-full bg-white border border-stone-100 rounded-xl py-3.5 pl-4 pr-12 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20" />
              <button onClick={() => handleStartQuiz(customGrammarTopic)} className="absolute right-2 p-2 bg-stone-900 text-white rounded-lg"><Send size={16} /></button>
            </div>
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
          <span className="text-xs font-bold text-stone-400">問題 {quizIndex + 1} / {currentQuiz.length}</span>
          <div className="flex gap-1">{currentQuiz.map((_, i) => <div key={i} className={cn("w-2 h-2 rounded-full", i === quizIndex ? "bg-emerald-500" : i < quizIndex ? "bg-emerald-200" : "bg-stone-200")} />)}</div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-6 pb-20">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <span className="px-2 py-0.5 bg-stone-100 text-stone-500 text-[10px] font-bold rounded uppercase mb-4 block w-fit">
              {q.options && q.options.length > 0 ? '選擇題' : '填空題'}
            </span>
            <h3 className="text-lg font-bold text-stone-800 leading-relaxed">{q.question}</h3>
          </div>
          <div className="space-y-3">
            {q.options && q.options.length > 0 ? (
              q.options.map((opt, i) => (
                <button key={i} onClick={() => handleAnswer(opt)} className={cn("w-full p-4 rounded-xl border text-left flex justify-between items-center transition-all", showExplanation ? (opt === q.correct_answer ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-bold" : opt === userAnswer ? "bg-red-50 border-red-500 text-red-700" : "bg-white border-stone-100 text-stone-400") : "bg-white border-stone-100 text-stone-700 hover:bg-emerald-50")}>
                  <span>{opt}</span>
                  {showExplanation && opt === q.correct_answer && <CheckCircle2 size={18} className="text-emerald-500" />}
                </button>
              ))
            ) : !showExplanation && (
              <div className="space-y-4"><input type="text" placeholder="輸入答案後按 Enter..." className="w-full p-4 rounded-xl border border-stone-100 outline-none" onKeyDown={(e) => e.key === 'Enter' && handleAnswer((e.target as HTMLInputElement).value)} /><button onClick={() => { const input = document.querySelector('input') as HTMLInputElement; handleAnswer(input.value); }} className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold">提交答案</button></div>
            )}
            {showExplanation && (!q.options || q.options.length === 0) && (
              <div className={cn("p-4 rounded-xl border flex justify-between items-center", isCorrect ? "bg-emerald-50 border-emerald-500 text-emerald-700" : "bg-red-50 border-red-500 text-red-700")}><div><p className="text-xs font-bold uppercase opacity-50">您的答案</p><p className="font-bold">{userAnswer || '(未填寫)'}</p></div>{isCorrect ? <CheckCircle2 size={24} /> : <X size={24} />}</div>
            )}
          </div>
          <AnimatePresence>{showExplanation && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">{!isCorrect && <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200"><p className="text-xs font-bold text-emerald-600 uppercase mb-1">正確答案</p><p className="text-emerald-800 font-bold">{q.correct_answer}</p></div>}<div className="bg-stone-100 p-5 rounded-2xl"><h4 className="font-bold text-stone-800 mb-2 flex items-center gap-2"><BookOpen size={16} className="text-emerald-600" />解析</h4><p className="text-stone-600 text-sm">{q.explanation}</p></div><button onClick={nextQuestion} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-xl">{quizIndex < currentQuiz.length - 1 ? '下一題' : '查看結果'}<ChevronRight size={18} /></button></motion.div>}</AnimatePresence>
        </div>
      </div>
    );
  };

  const renderScanTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 text-center border-b border-stone-50"><h2 className="text-2xl font-bold text-stone-800 tracking-tight">跨頁單字辨識</h2></div>
      <div className="flex-1 overflow-y-auto px-6 pb-20 pt-4">
        {isAnalyzing ? <div className="flex flex-col items-center justify-center h-64"><Loader2 className="animate-spin text-emerald-500" size={32} /><p className="mt-2 text-stone-400">分析中...</p></div> : (
          <div className="space-y-4">
            {scannedWords.map((item, idx) => (
              <div key={idx} className="bg-stone-50 rounded-2xl p-5 border border-stone-100 shadow-sm">
                <div className="flex justify-between items-start mb-2"><h3 className="text-xl font-bold text-emerald-700">{item.word}</h3><button onClick={() => speak(item.word)} className="p-1.5 bg-emerald-100 rounded-full text-emerald-600"><Volume2 size={14} /></button></div>
                <p className="text-stone-800 font-medium mb-1">{item.meaning}</p>
                <div className="flex gap-2 text-[10px] text-stone-400 font-bold uppercase"><span>{item.part_of_speech || item.partOfSpeech}</span><span>{item.pronunciation}</span></div>
              </div>
            ))}
            {scannedWords.length === 0 && <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 transition-all mt-8"><Camera className="text-stone-300 mb-2" size={40} /><p className="text-stone-500 font-medium">點擊上傳照片</p></div>}
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
        <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-white sticky top-0 z-10"><h2 className="font-bold text-stone-800">{type === 'qa' ? 'AI 英文問答' : '文法學習區塊'}</h2>{messages.length > 0 && <button onClick={() => type === 'qa' ? setQaMessages([]) : setGrammarMessages([])} className="text-stone-300 hover:text-red-500"><X size={18} /></button>}</div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
          {messages.length === 0 && (<div className="flex flex-col items-center justify-center h-full text-center space-y-6"><BookOpen size={64} className="text-emerald-100" /><QuickActionBtn onClick={() => handleSendMessage(type, '我想學文法')} label="查看文法目錄" /></div>)}
          {messages.map((msg) => (<div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}><div className={cn("max-w-[85%] rounded-2xl px-4 py-2 shadow-sm", msg.role === 'user' ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-800")}><div className="markdown-body text-sm"><Markdown>{msg.text}</Markdown></div></div></div>))}
          <div ref={chatEndRef} />
        </div>
        <div className="p-4 border-t border-stone-100 fixed bottom-16 w-full max-w-md bg-white z-20"><div className="relative flex items-center"><input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(type)} placeholder="輸入問題..." className="w-full bg-stone-50 rounded-full py-3 pl-5 pr-12 text-sm outline-none focus:ring-1 focus:ring-emerald-500" /><button onClick={() => handleSendMessage(type)} className="absolute right-2 p-2 bg-emerald-600 text-white rounded-full"><Send size={18} /></button></div></div>
      </div>
    );
  };

  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-stone-100 bg-white sticky top-0 z-10"><h2 className="text-xl font-bold text-stone-800">學習足跡</h2><p className="text-xs text-stone-500">已錄入 {history.length} 個單字 (ID 排序)</p></div>
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 space-y-6">
        {history.length === 0 ? <div className="flex flex-col items-center justify-center h-64 opacity-20"><History size={48} /><p className="font-bold mt-2">尚無紀錄</p></div> : (
          history.map((item, idx) => {
            const pos = item.part_of_speech || item.partOfSpeech;
            const exEn = item.example_en || item.exampleEn;
            const exTw = item.example_tw || item.exampleTw;
            return (
              <div key={idx} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm transition-all">
                <div className="flex justify-between items-start mb-3"><div className="flex-1"><div className="flex flex-wrap items-center gap-2 mb-1"><span className="text-[10px] text-emerald-500 font-mono font-bold">#{item.id}</span><h3 className="text-xl font-bold text-stone-800">{item.word}</h3>{pos && <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-bold uppercase border border-emerald-100">{pos}</span>}</div><p className="text-[12px] text-stone-400 font-mono">{item.pronunciation}</p></div><button onClick={() => speak(item.word)} className="p-2.5 bg-stone-50 text-stone-300 rounded-full hover:text-emerald-500 transition-colors"><Volume2 size={20} /></button></div>
                <p className="text-base text-stone-700 font-medium mb-3 leading-relaxed">{item.meaning}</p>
                {item.forms && item.forms !== '無' && (<div className="flex gap-1.5 items-baseline mb-4"><span className="text-[10px] text-emerald-500 font-bold shrink-0">型態：</span><p className="text-[11px] text-stone-500 italic">{item.forms}</p></div>)}
                {exEn && (<div className="mt-3 pt-3 border-t border-stone-50 bg-emerald-50/10 p-4 rounded-2xl"><p className="text-sm text-stone-600 italic font-medium leading-relaxed mb-1.5">"{exEn}"</p><p className="text-xs text-stone-400">{exTw}</p></div>)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-stone-50 max-w-md mx-auto relative overflow-hidden shadow-2xl">
      <header className="bg-white px-6 py-4 border-b border-stone-100 z-20 flex justify-between items-center"><h1 className="font-bold text-stone-800 tracking-tight">English Tutor</h1><span className="text-[10px] text-emerald-500 font-bold tracking-widest">ONLINE</span></header>
      <main className="flex-1 overflow-hidden relative"><AnimatePresence mode="wait"><motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">{activeTab === 'scan' && renderScanTab()}{activeTab === 'grammar' && renderChatTab('grammar')}{activeTab === 'quiz' && renderQuizTab()}{activeTab === 'qa' && renderChatTab('qa')}{activeTab === 'history' && renderHistoryTab()}</motion.div></AnimatePresence></main>
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
