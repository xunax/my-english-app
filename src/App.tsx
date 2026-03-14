import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, BookOpen, MessageSquare, History, Send, X, Volume2, Loader2, ChevronRight, CheckCircle2
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
  id: string; role: 'user' | 'model'; text: string; timestamp: number;
}

interface WordAnalysisData {
  id?: number; word: string; pronunciation: string; meaning: string;
  part_of_speech?: string; partOfSpeech?: string;
  example_en?: string; exampleEn?: string;
  example_tw?: string; exampleTw?: string;
  forms?: string;
}

function QuickActionBtn({ onClick, label, disabled }: { onClick: () => void, label: string, disabled?: boolean }) {
  return (
    <button 
      onClick={onClick} disabled={disabled}
      className={cn("w-full py-3 px-4 bg-stone-50 text-stone-600 text-sm font-medium rounded-xl border border-stone-100 transition-all text-left flex items-center justify-between mb-3", disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-emerald-50 hover:text-emerald-700")}
    >
      <span>✨ {label}</span>
      <ChevronRight size={16} className="text-stone-300" />
    </button>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scannedWords, setScannedWords] = useState<WordAnalysisData[]>([]);
  const [history, setHistory] = useState<WordAnalysisData[]>([]);
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadSavedWords = async () => {
      try {
        const response = await fetch('/api/get-words');
        if (response.ok) {
          const data = await response.json();
          setHistory(data.sort((a: any, b: any) => (a.id || 0) - (b.id || 0))); 
        }
      } catch (error) { console.error(error); }
    };
    loadSavedWords();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [qaMessages, grammarMessages, isTyping]);

   const handleSendMessage = async (type: 'qa' | 'grammar', overrideValue?: string) => {
    if (isTyping) return;
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

      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response || '請再試一次。', timestamp: Date.now() };
      
      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
      // ✨ 核心修正：攔截 Quota exceeded 並翻譯成中文
      let friendlyMessage = error.message || "連線發生錯誤";
      
      if (friendlyMessage.includes("429") || friendlyMessage.includes("quota") || friendlyMessage.includes("RESOURCE_EXHAUSTED")) {
        friendlyMessage = "老師目前太受歡迎啦！免費額度已暫時用完，請等一分鐘或明天再來找我喔！✨";
      }

      const errorMsg: ChatMessage = { 
        id: Date.now().toString(), 
        role: 'model', 
        text: `⚠️ ${friendlyMessage}`, 
        timestamp: Date.now() 
      };
      
      if (type === 'qa') setQaMessages(prev => [...prev, errorMsg]);
      else setGrammarMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsAnalyzing(true);
    try {
      const base64Promises = files.map(file => new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      }));
      const base64Images = await Promise.all(base64Promises);
      const results = await analyzeImages(base64Images) as unknown as WordAnalysisData[];
      if (results && results.length > 0) {
        setScannedWords(results); setHistory(prev => [...results, ...prev]);
      } else { alert("辨識失敗，請上傳更清晰的圖片！"); }
    } catch (error: any) { alert(`發生錯誤：${error.message}`); } 
    finally { setIsAnalyzing(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handleStartQuiz = async () => {
    if (isGeneratingQuiz) return;
    setIsGeneratingQuiz(true); setActiveTab('quiz'); setCurrentQuiz([]); setQuizIndex(0); setUserAnswers({}); setShowExplanation(false); setQuizScore(null);
    try {
      const wordList = history.length > 0 ? history.map(w => w.word).join(', ') : "基礎單字";
      const quiz = await generateQuiz(wordList);
      if (quiz && quiz.length > 0) setCurrentQuiz(quiz); 
      else alert("測驗產生失敗，請再試一次。");
    } catch (error) { alert("出題發生錯誤！"); } 
    finally { setIsGeneratingQuiz(false); }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; window.speechSynthesis.speak(utterance);
  };

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return <div className="flex flex-col items-center justify-center h-full p-6"><Loader2 className="animate-spin text-emerald-500 mb-4" size={40} /><p className="font-bold text-stone-600">準備測驗中...</p></div>;
    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6"><CheckCircle2 size={80} className="text-emerald-500" /><h2 className="text-2xl font-bold">測驗完成！</h2><div className="bg-emerald-50 px-10 py-5 rounded-3xl"><p className="text-stone-500 text-sm font-bold">最終得分</p><span className="text-emerald-600 font-bold text-5xl">{quizScore}/{currentQuiz.length}</span></div><button onClick={handleStartQuiz} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold">再挑戰一次</button></div>
    );
    if (currentQuiz.length === 0) return (
      <div className="p-6 flex flex-col justify-center h-full space-y-10"><div className="text-center space-y-4"><BookOpen size={48} className="mx-auto text-emerald-600" /><h3 className="text-2xl font-bold text-stone-800">準備好挑戰了嗎？</h3></div><button onClick={handleStartQuiz} className="w-full py-5 bg-emerald-600 text-white rounded-3xl font-bold text-lg">開始測驗</button></div>
    );
    const q = currentQuiz[quizIndex];
    if (!q) return null;
    const submitAns = (ans: string) => { if (showExplanation) return; setUserAnswers(p => ({ ...p, [q.id]: ans })); setShowExplanation(true); };

    return (
      <div className="flex flex-col h-full p-6 overflow-y-auto pb-28">
        <div className="mb-6"><span className="text-xs font-bold text-stone-500 bg-stone-100 px-3 py-1 rounded-full">QUESTION {quizIndex + 1} / {currentQuiz.length}</span></div>
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100 mb-6"><h3 className="text-lg font-bold text-stone-800">{q.question}</h3></div>
        <div className="space-y-3">
          {q.options?.map((opt, i) => (
            <button key={i} onClick={() => submitAns(opt)} className={cn("w-full p-5 rounded-2xl border text-left font-medium", showExplanation ? (opt === q.correct_answer ? "bg-emerald-50 border-emerald-500 text-emerald-800" : opt === userAnswers[q.id] ? "bg-red-50 border-red-500 text-red-800" : "bg-white text-stone-400 opacity-50") : "bg-white hover:bg-emerald-50")}>
              <div className="flex justify-between items-center"><span>{opt}</span>{showExplanation && opt === q.correct_answer && <CheckCircle2 size={20} className="text-emerald-500" />}</div>
            </button>
          ))}
        </div>
        {showExplanation && (
          <div className="mt-6 space-y-4"><div className="p-5 bg-stone-100 rounded-2xl"><h4 className="font-bold text-stone-800 mb-2 text-sm">解析</h4><p className="text-sm text-stone-600">{q.explanation}</p></div><button onClick={() => { if (quizIndex < currentQuiz.length - 1) { setQuizIndex(p => p + 1); setShowExplanation(false); } else { setQuizScore(currentQuiz.reduce((a, c) => a + (userAnswers[c.id] === c.correct_answer ? 1 : 0), 0)); } }} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold">{quizIndex < currentQuiz.length - 1 ? '下一題' : '查看結果'}</button></div>
        )}
      </div>
    );
  };

  const renderScanTab = () => (
    <div className="flex flex-col h-full bg-white"><div className="p-6 text-center border-b border-stone-50"><h2 className="text-2xl font-bold text-stone-800">跨頁單字辨識</h2></div><div className="flex-1 overflow-y-auto px-6 pb-20 pt-4">
      {isAnalyzing ? <div className="flex flex-col items-center justify-center h-64"><Loader2 className="animate-spin text-emerald-500 mb-2" size={32} /><p className="text-stone-400 font-bold">分析中...</p></div> : (
        <div className="space-y-4">{scannedWords.map((item, idx) => (<div key={idx} className="bg-stone-50 rounded-2xl p-5 border border-stone-100"><div className="flex justify-between mb-2"><h3 className="text-xl font-bold text-emerald-700">{item.word}</h3><button onClick={() => speak(item.word)} className="text-emerald-600"><Volume2 size={16} /></button></div><p className="text-stone-800 mb-1">{item.meaning}</p><div className="flex gap-2 text-[10px] text-stone-400 font-bold uppercase"><span>{item.part_of_speech || item.partOfSpeech}</span><span>{item.pronunciation}</span></div></div>))}
        {scannedWords.length === 0 && <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer mt-4"><Camera className="text-stone-300 mb-2" size={40} /><p className="text-stone-500">點擊上傳照片</p></div>}</div>
      )}</div><input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleFileChange} /></div>
  );

  const renderChatTab = (type: 'qa' | 'grammar') => {
    const messages = type === 'qa' ? qaMessages : grammarMessages;
    const isQA = type === 'qa';
    return (
      <div className="flex flex-col h-full bg-white"><div className="p-4 border-b border-stone-100 flex justify-between sticky top-0 bg-white z-10"><h2 className="font-bold text-stone-800">{isQA ? 'AI 英文問答' : '文法學習區塊'}</h2>{messages.length > 0 && <button onClick={() => isQA ? setQaMessages([]) : setGrammarMessages([])} className="text-stone-300"><X size={18} /></button>}</div><div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6"><div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center text-stone-400">{isQA ? <MessageSquare size={40} /> : <BookOpen size={40} />}</div><div><h4 className="font-bold text-stone-800 mb-2 text-lg">{isQA ? '有任何英文疑問嗎？' : '想學什麼文法？'}</h4><p className="text-stone-500 text-sm">{isQA ? '點選下方範例，或直接輸入問題。' : '請輸入你想學習的主題。'}</p></div>
            <div className="w-full px-6">{isQA ? (<><QuickActionBtn disabled={isTyping} onClick={() => handleSendMessage('qa', '如何分辨 make 和 do 的用法？')} label="分辨 make 和 do" /><QuickActionBtn disabled={isTyping} onClick={() => handleSendMessage('qa', '幫我解釋 Take it easy 是什麼意思？')} label="解釋 Take it easy" /><QuickActionBtn disabled={isTyping} onClick={() => handleSendMessage('qa', '如何寫一封正式的英文請假郵件？')} label="寫英文請假郵件" /></>) : (<QuickActionBtn disabled={isTyping} onClick={() => handleSendMessage('grammar', '我想學文法')} label="查看文法目錄" />)}</div>
          </div>
        )}
        {messages.map((msg) => (<div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}><div className={cn("max-w-[85%] rounded-2xl px-5 py-3", msg.role === 'user' ? "bg-emerald-600 text-white" : "bg-stone-50 border border-stone-100")}><div className="markdown-body text-sm"><Markdown>{msg.text}</Markdown></div></div></div>))}
        {isTyping && <div className="flex w-full justify-start"><div className="bg-stone-50 border border-stone-100 rounded-2xl px-4 py-4 flex gap-1"><div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" /><div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{animationDelay:'0.15s'}} /><div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{animationDelay:'0.3s'}} /></div></div>}
        <div ref={chatEndRef} /></div><div className="p-4 border-t border-stone-100 fixed bottom-16 w-full max-w-md bg-white z-20"><div className="relative flex items-center"><input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(type)} placeholder={isQA ? "輸入問題..." : "輸入文法主題..."} disabled={isTyping} className="w-full bg-stone-50 border rounded-full py-3.5 pl-6 pr-14 text-sm" /><button onClick={() => handleSendMessage(type)} disabled={isTyping} className="absolute right-2 p-2 bg-emerald-600 text-white rounded-full"><Send size={18} /></button></div></div></div>
    );
  };

  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white"><div className="p-6 border-b border-stone-100 sticky top-0 bg-white z-10"><h2 className="text-xl font-bold text-stone-800">學習足跡</h2><p className="text-xs text-stone-500">共錄入 {history.length} 個單字</p></div><div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 space-y-6">
      {history.length === 0 ? <div className="flex flex-col items-center justify-center h-64 opacity-20"><History size={48} /><p className="font-bold mt-2">尚無紀錄</p></div> : (
        history.map((item, idx) => {
          const pos = item.part_of_speech || item.partOfSpeech;
          const exEn = item.example_en || item.exampleEn;
          const exTw = item.example_tw || item.exampleTw;
          return (
            <div key={idx} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm"><div className="flex justify-between items-start mb-3"><div className="flex-1"><div className="flex gap-2 mb-1"><span className="text-[10px] text-emerald-500 font-bold">#{item.id}</span><h3 className="text-xl font-bold text-stone-800">{item.word}</h3>{pos && <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded font-bold uppercase">{pos}</span>}</div><p className="text-[12px] text-stone-400">{item.pronunciation}</p></div><button onClick={() => speak(item.word)} className="text-stone-300 hover:text-emerald-500"><Volume2 size={20} /></button></div><p className="text-base text-stone-700 font-medium mb-3">{item.meaning}</p>
            {item.forms && item.forms !== '無' && <div className="flex gap-1.5 mb-4"><span className="text-[10px] text-emerald-500 font-bold">型態：</span><p className="text-[11px] text-stone-500">{item.forms}</p></div>}
            {exEn && <div className="mt-3 pt-3 border-t bg-emerald-50/10 p-4 rounded-2xl"><p className="text-sm text-stone-600 italic mb-1">"{exEn}"</p><p className="text-xs text-stone-400">{exTw}</p></div>}</div>
          );
        })
      )}</div></div>
  );

  return (
    <div className="flex flex-col h-screen bg-stone-50 max-w-md mx-auto relative overflow-hidden shadow-2xl">
      <header className="bg-white px-6 py-4 border-b border-stone-100 flex justify-between items-center z-20"><h1 className="font-bold text-stone-800">English Tutor</h1><span className="text-[10px] text-emerald-500 font-bold tracking-widest">ONLINE</span></header>
      <main className="flex-1 overflow-hidden relative"><AnimatePresence mode="wait"><motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">{activeTab === 'scan' && renderScanTab()}{activeTab === 'grammar' && renderChatTab('grammar')}{activeTab === 'quiz' && renderQuizTab()}{activeTab === 'qa' && renderChatTab('qa')}{activeTab === 'history' && renderHistoryTab()}</motion.div></AnimatePresence></main>
      <nav className="bg-white border-t border-stone-100 px-6 py-3 flex justify-between fixed bottom-0 w-full max-w-md z-40">
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
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1 transition-all", active ? "text-emerald-600 scale-110" : "text-stone-400")} >
      {icon}<span className="text-[10px] font-bold uppercase">{label}</span>
    </button>
  );
}
