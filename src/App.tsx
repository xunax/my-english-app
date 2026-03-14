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
      className="w-full py-3 px-4 bg-stone-50 text-stone-600 text-sm font-medium rounded-xl border border-stone-100 hover:bg-emerald-50 hover:text-emerald-700 transition-all text-left flex items-center justify-between group mb-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity text-base">✨</span>
        {label}
      </div>
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
  }, [qaMessages, grammarMessages, isTyping]);

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
      
      const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response || '連線有點問題，請再試一次。', timestamp: Date.now() };
      if (type === 'qa') setQaMessages(prev => [...prev, aiMsg]);
      else setGrammarMessages(prev => [...prev, aiMsg]);

    } catch (error: any) {
      // ✨ 關鍵防護：如果 gemini.ts 報錯，會直接顯示在畫面上，不再白屏死機！
      console.error(error);
      const errorMsg: ChatMessage = { id: Date.now().toString(), role: 'model', text: `⚠️ 老師發生錯誤：${error.message} \n\n請檢查 gemini.ts 的設定！`, timestamp: Date.now() };
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
      const base64Promises = files.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
      });
      const base64Images = await Promise.all(base64Promises);
      const results = await analyzeImages(base64Images);
      if (results && Array.isArray(results)) {
        setScannedWords(results);
        setHistory(prev => [...results, ...prev]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleStartQuiz = async () => {
    setIsGeneratingQuiz(true);
    setActiveTab('quiz');
    setCurrentQuiz([]);
    setQuizIndex(0);
    setUserAnswers({});
    setShowExplanation(false);
    setQuizScore(null);
    try {
      // ✨ 單純傳遞單字給 gemini.ts，由 gemini.ts 決定要出 10 題選擇題
      const wordList = history.length > 0 ? history.map(w => w.word).join(', ') : "基礎常用單字";
      const quiz = await generateQuiz(wordList);
      
      if (quiz && Array.isArray(quiz) && quiz.length > 0) {
        setCurrentQuiz(quiz); 
      } else {
        alert("測驗產生失敗，請檢查 gemini.ts 回傳的 JSON 格式是否有誤。");
      }
    } catch (error) {
      console.error("產生測驗失敗：", error);
      alert("網路連線或出題過程發生錯誤！");
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-4">
        <Loader2 className="animate-spin text-emerald-500" size={48} />
        <p className="font-bold text-stone-600 text-lg">正在為您準備選擇題測驗...</p>
      </div>
    );

    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
        <CheckCircle2 size={80} className="text-emerald-500" />
        <h2 className="text-2xl font-bold">測驗完成！</h2>
        <div className="bg-emerald-50 px-10 py-5 rounded-3xl shadow-inner">
          <p className="text-stone-500 text-sm mb-1 uppercase font-bold tracking-widest">最終得分</p>
          <span className="text-emerald-600 font-bold text-5xl">{quizScore} <span className="text-2xl text-emerald-400">/ {currentQuiz.length}</span></span>
        </div>
        <div className="w-full space-y-3 pt-4">
          <button onClick={handleStartQuiz} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg">再挑戰一次</button>
          <button onClick={() => setActiveTab('history')} className="w-full py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold">查看單字紀錄</button>
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
          <p className="text-stone-500">系統將根據學習足跡為您出題。</p>
        </div>
        <button onClick={handleStartQuiz} className="w-full py-5 bg-emerald-600 text-white rounded-3xl font-bold text-lg shadow-xl shadow-emerald-100 transition-all active:scale-95">
          開始複習測驗
        </button>
      </div>
    );

    const q = currentQuiz[quizIndex];
    if (!q) return null;

    const handleAnswer = (ans: string) => {
      if (showExplanation) return;
      setUserAnswers(prev => ({ ...prev, [q.id]: ans }));
      setShowExplanation(true);
    };

    return (
      <div className="flex flex-col h-full p-6 overflow-y-auto pb-28">
        <div className="flex justify-between items-center mb-6">
          <span className="text-xs font-bold text-stone-500 bg-stone-100 px-3 py-1 rounded-full tracking-wider">QUESTION {quizIndex + 1} / {currentQuiz.length}</span>
          <div className="flex gap-1.5">
            {currentQuiz.map((_, i) => (
              <div key={i} className={cn("w-1.5 h-1.5 rounded-full transition-all", i === quizIndex ? "bg-emerald-500 w-4" : i < quizIndex ? "bg-emerald-200" : "bg-stone-200")} />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-100 mb-6">
          <h3 className="text-lg font-bold text-stone-800 leading-relaxed">{q.question}</h3>
        </div>
        <div className="space-y-3">
          {q.options?.map((opt, i) => (
            <button 
              key={i} 
              onClick={() => handleAnswer(opt)} 
              className={cn(
                "w-full p-5 rounded-2xl border text-left transition-all relative overflow-hidden font-medium",
                showExplanation 
                  ? (opt === q.correct_answer 
                      ? "bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm" 
                      : opt === userAnswers[q.id] 
                        ? "bg-red-50 border-red-500 text-red-800" 
                        : "bg-white text-stone-400 border-stone-100 opacity-50") 
                  : "bg-white border-stone-200 hover:border-emerald-300 hover:bg-emerald-50 text-stone-700 shadow-sm"
              )}
            >
              <div className="flex justify-between items-center">
                <span>{opt}</span>
                {showExplanation && opt === q.correct_answer && <CheckCircle2 size={20} className="text-emerald-500" />}
              </div>
            </button>
          ))}
        </div>
        {showExplanation && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
            <div className="p-5 bg-stone-100 rounded-2xl border border-stone-200">
              <h4 className="font-bold text-stone-800 mb-2 flex items-center gap-2 text-sm"><HelpCircle size={18} className="text-emerald-600" /> 題目解析</h4>
              <p className="text-sm text-stone-600 leading-relaxed">{q.explanation}</p>
            </div>
            <button 
              onClick={() => {
                if (quizIndex < currentQuiz.length - 1) {
                  setQuizIndex(prev => prev + 1);
                  setShowExplanation(false);
                } else {
                  setQuizScore(currentQuiz.reduce((acc, curr) => acc + (userAnswers[curr.id] === curr.correct_answer ? 1 : 0), 0));
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

  const renderScanTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 text-center border-b border-stone-50"><h2 className="text-2xl font-bold text-stone-800 tracking-tight">跨頁單字辨識</h2></div>
      <div className="flex-1 overflow-y-auto px-6 pb-20 pt-4">
        {isAnalyzing ? <div className="flex flex-col items-center justify-center h-64"><Loader2 className="animate-spin text-emerald-500 mb-2" size={32} /><p className="text-stone-400 font-bold">分析中...</p></div> : (
          <div className="space-y-4">
            {scannedWords.map((item, idx) => (
              <div key={idx} className="bg-stone-50 rounded-2xl p-5 border border-stone-100 shadow-sm">
                <div className="flex justify-between items-start mb-2"><h3 className="text-xl font-bold text-emerald-700">{item.word}</h3><button onClick={() => speak(item.word)} className="p-1.5 bg-emerald-100 rounded-full text-emerald-600"><Volume2 size={14} /></button></div>
                <p className="text-stone-800 font-medium mb-1">{item.meaning}</p>
                <div className="flex gap-2 text-[10px] text-stone-400 font-bold uppercase"><span>{item.part_of_speech || item.partOfSpeech}</span><span>{item.pronunciation}</span></div>
              </div>
            ))}
            {scannedWords.length === 0 && (
              <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/50 transition-all">
                <Camera className="text-stone-300 mb-2" size={40} />
                <p className="text-stone-500 font-medium">點擊上傳照片</p>
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
    const isQA = type === 'qa';
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="p-4 border-b border-stone-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h2 className="font-bold text-stone-800">{isQA ? 'AI 英文問答' : '文法學習區塊'}</h2>
          {messages.length > 0 && <button onClick={() => isQA ? setQaMessages([]) : setGrammarMessages([])} className="text-stone-300 hover:text-red-500"><X size={18} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-8">
              <div className={cn("w-20 h-20 rounded-full flex items-center justify-center shadow-inner", isQA ? "bg-blue-50 text-blue-500" : "bg-emerald-50 text-emerald-500")}>
                {isQA ? <MessageSquare size={40} /> : <BookOpen size={40} />}
              </div>
              <div>
                <h4 className="font-bold text-stone-800 mb-2 text-lg">{isQA ? '有任何英文疑問嗎？' : '想學什麼文法？'}</h4>
                <p className="text-stone-500 text-sm px-6">{isQA ? '點選下方範例，或直接輸入你想問的問題。' : '請輸入你想學習的主題，例如「現在完成式」。'}</p>
              </div>
              
              <div className="w-full px-6">
                {isQA ? (
                  <>
                    <QuickActionBtn onClick={() => handleSendMessage('qa', '如何分辨 make 和 do 的用法？')} label="分辨 make 和 do 的用法" />
                    <QuickActionBtn onClick={() => handleSendMessage('qa', '幫我解釋「Take it easy」是什麼意思？')} label="解釋 Take it easy" />
                    <QuickActionBtn onClick={() => handleSendMessage('qa', '如何寫一封正式的英文請假郵件？')} label="寫英文請假郵件" />
                  </>
                ) : (
                  <QuickActionBtn onClick={() => handleSendMessage('grammar', '我想學文法')} label="查看文法主題清單" />
                )}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-5 py-3 shadow-sm", msg.role === 'user' ? "bg-emerald-600 text-white" : "bg-stone-50 text-stone-800 border border-stone-100")}>
                <div className="markdown-body text-sm leading-relaxed"><Markdown>{msg.text}</Markdown></div>
              </div>
            </div>
          ))}
          {/* ✨ AI 思考中動畫 */}
          {isTyping && (
            <div className="flex w-full justify-start">
              <div className="bg-stone-50 border border-stone-100 rounded-2xl px-4 py-4 shadow-sm flex gap-1.5 items-center">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div className="p-4 border-t border-stone-100 fixed bottom-16 w-full max-w-md bg-white z-20">
          <div className="relative flex items-center">
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(type)} placeholder={isQA ? "輸入您的英文問題..." : "輸入主題，如：關係代名詞"} className="w-full bg-stone-50 border border-stone-200 rounded-full py-3.5 pl-6 pr-14 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all shadow-inner" />
            <button onClick={() => handleSendMessage(type)} className="absolute right-2 p-2 bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-colors shadow-md"><Send size={18} /></button>
          </div>
        </div>
      </div>
    );
  };

  const renderHistoryTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-stone-100 bg-white sticky top-0 z-10">
        <h2 className="text-xl font-bold text-stone-800">學習足跡</h2>
        <p className="text-xs text-stone-500">共錄入 {history.length} 個單字</p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 space-y-6">
        {history.length === 0 ? <div className="flex flex-col items-center justify-center h-64 opacity-20"><History size={48} /><p className="font-bold mt-2">尚無紀錄</p></div> : (
          history.map((item, idx) => {
            const pos = item.part_of_speech || item.partOfSpeech;
            const exEn = item.example_en || item.exampleEn;
            const exTw = item.example_tw || item.exampleTw;

            return (
              <div key={idx} className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[10px] text-emerald-500 font-mono font-bold">#{item.id}</span>
                      <h3 className="text-xl font-bold text-stone-800">{item.word}</h3>
                      {pos && <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md font-bold uppercase border border-emerald-100">{pos}</span>}
                    </div>
                    <p className="text-[12px] text-stone-400 font-mono">{item.pronunciation}</p>
                  </div>
                  <button onClick={() => speak(item.word)} className="p-2.5 bg-stone-50 text-stone-300 rounded-full hover:text-emerald-500 transition-colors"><Volume2 size={20} /></button>
                </div>
                <p className="text-base text-stone-700 font-medium mb-3 leading-relaxed">{item.meaning}</p>
                {item.forms && item.forms !== '無' && <div className="flex gap-1.5 items-baseline mb-4"><span className="text-[10px] text-emerald-500 font-bold shrink-0">型態：</span><p className="text-[11px] text-stone-500 italic">{item.forms}</p></div>}
                {exEn && (
                  <div className="mt-3 pt-3 border-t border-stone-50 bg-emerald-50/10 p-4 rounded-2xl">
                    <p className="text-sm text-stone-600 italic font-medium leading-relaxed mb-1.5">"{exEn}"</p>
                    <p className="text-xs text-stone-400">{exTw}</p>
                  </div>
                )}
              </div>
            );
          })
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
            {activeTab === 'scan' && renderScanTab()}
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
    <button onClick={onClick} className={cn("flex flex-col items-center gap-1.5 transition-all", active ? "text-emerald-600 scale-110" : "text-stone-300 hover:text-stone-500")}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}
