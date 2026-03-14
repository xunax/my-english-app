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

// ✨ 嚴格設定順序：辨識、文法、測驗、問答、紀錄
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
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 🔄 讀取資料庫紀錄並排序
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
      // 構建純淨歷史紀錄，gemini.ts 已包含系統指令
      const chatHistory = messages.map(m => ({ 
        role: m.role === 'user' ? 'user' : 'model', 
        text: m.text 
      }));

      const response = await chatWithAI(textToSend, chatHistory); 
      const aiMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        text: response || '抱歉，請再試一次。', 
        timestamp: Date.now() 
      };

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
      const quizContext = context || (history.length > 0 ? `複習：${history.map(w => w.word).join(', ')}` : "基礎測驗");
      const quiz = await generateQuiz(quizContext);
      setCurrentQuiz(quiz);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const renderQuizTab = () => {
    if (isGeneratingQuiz) return <div className="flex flex-col items-center justify-center h-full p-6"><Loader2 className="animate-spin text-emerald-500" size={32} /></div>;
    if (quizScore !== null) return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center space-y-6">
        <CheckCircle2 size={64} className="text-emerald-500" />
        <h2 className="text-2xl font-bold">測驗完成！</h2>
        <p className="text-stone-500">得分：{quizScore} / {currentQuiz.length}</p>
        <button onClick={() => setActiveTab('history')} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg">查看學習足跡</button>
      </div>
    );

    if (currentQuiz.length === 0) return (
      <div className="p-6 text-center flex flex-col justify-center h-full space-y-6">
        <BookOpen size={64} className="mx-auto text-emerald-100" />
        <h3 className="text-xl font-bold text-stone-800">準備挑戰？</h3>
        <button onClick={() => handleStartQuiz()} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg">開始複習單字</button>
      </div>
    );

    const q = currentQuiz[quizIndex];
    return (
      <div className="flex flex-col h-full p-6 overflow-y-auto pb-28">
        <h3 className="text-lg font-bold mb-4">{q.question}</h3>
        <div className="space-y-3">
          {q.options?.map((opt, i) => (
            <button key={i} onClick={() => handleAnswer(opt)} className={cn("w-full p-4 rounded-xl border text-left transition-all", showExplanation ? (opt === q.correct_answer ? "bg-emerald-50 border-emerald-500 text-emerald-700 font-bold" : opt === userAnswers[q.id] ? "bg-red-50 border-red-500 text-red-700" : "bg-white") : "bg-white hover:bg-emerald-50")}>{opt}</button>
          ))}
        </div>
        {showExplanation && (
          <div className="mt-6 p-5 bg-stone-100 rounded-2xl">
            <h4 className="font-bold text-stone-800 mb-2">解析：</h4>
            <p className="text-sm text-stone-600">{q.explanation}</p>
            <button onClick={nextQuestion} className="w-full mt-4 py-3 bg-stone-900 text-white rounded-xl font-bold">下一題</button>
          </div>
        )}
      </div>
    );
  };

  const renderScanTab = () => (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 text-center border-b border-stone-50"><h2 className="text-2xl font-bold text-stone-800 tracking-tight">跨頁單字辨識</h2></div>
      <div className="flex-1 overflow-y-auto px-6 pb-20 pt-4">
        {isAnalyzing ? <div className="flex flex-col items-center justify-center h-64"><Loader2 className="animate-spin text-emerald-500" size={32} /></div> : (
          <div className="space-y-4">
            {scannedWords.map((item, idx) => (
              <div key={idx} className="bg-stone-50 rounded-2xl p-5 border border-stone-100 shadow-sm">
                <div className="flex justify-between items-start mb-2"><h3 className="text-xl font-bold text-emerald-700">{item.word}</h3><button onClick={() => speak(item.word)} className="p-1.5 bg-emerald-100 rounded-full text-emerald-600"><Volume2 size={14} /></button></div>
                <p className="text-stone-800 font-medium mb-1">{item.meaning}</p>
                <div className="flex gap-2 text-[10px] text-stone-400 font-bold uppercase"><span>{item.part_of_speech}</span><span>{item.pronunciation}</span></div>
              </div>
            ))}
            {scannedWords.length === 0 && (
              <div onClick={() => fileInputRef.current?.click()} className="h-48 border-2 border-dashed border-stone-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-300 transition-all">
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
    const title = type === 'qa' ? 'AI 英文問答' : '文法學習區塊';
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <h2 className="font-bold text-stone-800">{title}</h2>
          {messages.length > 0 && <button onClick={() => type === 'qa' ? setQaMessages([]) : setGrammarMessages([])} className="text-stone-300 hover:text-red-500"><X size={18} /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
              <BookOpen size={64} className="text-emerald-100" />
              <QuickActionBtn onClick={() => handleSendMessage(type, '我想學文法')} label="查看文法目錄" />
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("
