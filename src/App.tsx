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
  CheckCircle2
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

function QuickActionBtn({ onClick, label, disabled }: { onClick: () => void, label: string, disabled?: boolean }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={cn("w-full py-3 px-4 bg-stone-50 text-stone-600 text-sm font-medium rounded-xl border border-stone-100 transition-all text-left flex items-center justify-between group mb-3", disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-emerald-50 hover:text-emerald-700")}
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
      console.error(error);
      const errorMsg: ChatMessage = { id: Date.now().toString(), role: 'model', text: `⚠️ 發生錯誤：${error.message}`, timestamp: Date.now() };
      if (type === 'qa') setQaMessages(prev => [...prev, errorMsg]);
      else setGrammarMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  // 🚀 辨識防呆升級：加入 Alert 錯誤提示
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
      
      if (results && Array.isArray(results) && results.length > 0) {
        setScannedWords(results);
        setHistory(prev => [...results, ...prev]);
      } else {
        alert("照片辨識失敗：未找到任何單字，請上傳更清晰的圖片！");
      }
    } catch (error: any) {
      console.error(error);
      alert(`連線或解析發生錯誤：${error.message || "API 額度可能暫時耗盡"}`);
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleStartQuiz = async () => {
    if (isGeneratingQuiz) return;
    setIsGeneratingQuiz(true);
    setActiveTab('quiz');
    setCurrentQuiz([]);
    setQuizIndex(0);
    setUserAnswers({});
    setShowExplanation(false);
    setQuizScore(null);
    try {
      const wordList = history.length > 0 ? history.map(w => w.word).join(', ') : "基礎常用單字";
      const quiz = await generateQuiz(wordList);
      if (quiz && Array.isArray(quiz) && quiz.length > 0) {
        setCurrentQuiz(quiz); 
      } else {
        alert("測驗產生失敗，請再試一次。");
      }
    } catch (error) {
      console.error("產生測驗失敗：", error);
      alert("網路連線或出題發生錯誤！");
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
        <p className="font-bold text-stone-600 text-lg">正在為您準備選擇題...</p>
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
          <p className="text-stone-500">系統將根據你的學習足跡，產生選擇題。</p>
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
              <h4 className="font-bold text-stone-800 mb-2 flex items-center gap-2 text-sm"><BookOpen size={18} className="text-emerald-600" /> 題目解析</h4>
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
        {isAnalyzing ? <div className="flex flex-col items-center justify-center h-64"><Loader2 className="animate-spin text-emerald-500 mb-2" size={32} /><p className="text-stone-400 font-bold">正在掃描單字中...</p></div> : (
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
                <p className="text-stone-500 text-sm px-6">{isQA ? '點選下方範例，或直接輸入你想問的問題。' :
