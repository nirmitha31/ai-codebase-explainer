import React, { useState, useEffect, useRef } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Loader2, Github, Send, FileCode2, Info, MessageSquare, LayoutTemplate } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

type RepoData = {
  id: string;
  url: string;
  owner: string;
  name: string;
  overview: string;
  architecture: string;
  status: string;
  error?: string;
  keyFiles: { id: string; path: string; description: string }[];
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
};

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (repoId && repoData?.status === 'processing') {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/repo/${repoId}`);
          if (res.ok) {
            const data = await res.json();
            setRepoData(data);
            if (data.status !== 'processing') {
              clearInterval(interval);
            }
          }
        } catch (e) {
          console.error("Failed to poll repo status", e);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [repoId, repoData?.status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError('');
    setRepoData(null);
    setRepoId(null);
    setMessages([]);

    try {
      const res = await fetch('/api/repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process repository');
      }

      setRepoId(data.id);
      setRepoData({ id: data.id, status: data.status, url, owner: '', name: '', overview: '', architecture: '', keyFiles: [] });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !repoId) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId, message: userMsg.content }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      const aiMsg: Message = { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: data.text,
        sources: data.sources
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: `Error: ${err.message}` };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-neutral-200">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-lg tracking-tight">
            <Github className="w-6 h-6" />
            <span>Codebase Explainer</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <section className="max-w-2xl mx-auto text-center space-y-6">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-950">Understand any codebase instantly</h1>
          <p className="text-neutral-500 text-lg">Paste a GitHub repository URL below to get an AI-generated overview, architecture analysis, and an interactive chat to ask questions about the code.</p>
          
          <form onSubmit={handleSubmit} className="flex gap-2 max-w-xl mx-auto">
            <Input 
              type="url" 
              placeholder="https://github.com/owner/repo" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-white"
              required
            />
            <Button type="submit" disabled={loading || (repoData?.status === 'processing')}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analyze'}
            </Button>
          </form>
          
          {error && (
            <div className="text-red-500 text-sm bg-red-50 p-3 rounded-md border border-red-100">
              {error}
            </div>
          )}
        </section>

        <AnimatePresence mode="wait">
          {repoData && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Left Column: Analysis */}
              <div className="lg:col-span-1 space-y-6">
                {repoData.status === 'processing' ? (
                  <Card className="border-dashed border-2 bg-neutral-50/50">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-neutral-500 space-y-4">
                      <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
                      <p className="text-sm font-medium">Cloning and analyzing repository...</p>
                      <p className="text-xs text-neutral-400 text-center max-w-[200px]">This might take a minute depending on the repository size.</p>
                    </CardContent>
                  </Card>
                ) : repoData.status === 'error' ? (
                  <Card className="border-red-200 bg-red-50">
                    <CardContent className="py-6 text-red-600">
                      <p className="font-medium">Analysis failed</p>
                      <p className="text-sm mt-1">{repoData.error}</p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Info className="w-5 h-5 text-neutral-500" />
                          Overview
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-neutral-600 leading-relaxed">
                        <Markdown>{repoData.overview}</Markdown>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <LayoutTemplate className="w-5 h-5 text-neutral-500" />
                          Architecture
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-neutral-600 leading-relaxed">
                        <Markdown>{repoData.architecture}</Markdown>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <FileCode2 className="w-5 h-5 text-neutral-500" />
                          Key Files
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-4">
                          {repoData.keyFiles?.map((file, i) => (
                            <li key={i} className="text-sm">
                              <div className="font-mono text-xs font-medium text-neutral-900 bg-neutral-100 px-1.5 py-0.5 rounded inline-block mb-1">
                                {file.path}
                              </div>
                              <p className="text-neutral-600">{file.description}</p>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>

              {/* Right Column: Chat */}
              <div className="lg:col-span-2">
                <Card className="h-[600px] flex flex-col shadow-md border-neutral-200/60">
                  <CardHeader className="border-b border-neutral-100 bg-neutral-50/50 py-4">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <MessageSquare className="w-5 h-5 text-neutral-500" />
                      Ask about the codebase
                    </CardTitle>
                    <CardDescription>
                      Ask questions, request code explanations, or find where things are implemented.
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50/30">
                    {messages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-neutral-400 space-y-2">
                        <MessageSquare className="w-8 h-8 opacity-20" />
                        <p className="text-sm">No messages yet. Start asking questions!</p>
                      </div>
                    ) : (
                      messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                            msg.role === 'user' 
                              ? 'bg-neutral-900 text-white rounded-tr-sm' 
                              : 'bg-white border border-neutral-200 text-neutral-800 rounded-tl-sm shadow-sm'
                          }`}>
                            <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : ''}`}>
                              <Markdown>{msg.content}</Markdown>
                            </div>
                            {msg.sources && msg.sources.length > 0 && msg.role === 'assistant' && (
                              <div className="mt-3 pt-3 border-t border-neutral-100">
                                <p className="text-[10px] font-semibold text-neutral-400 mb-1.5 uppercase tracking-wider">Sources</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {Array.from(new Set(msg.sources)).map((src, i) => (
                                    <span key={i} className="text-[10px] font-mono bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded border border-neutral-200">
                                      {src}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white border border-neutral-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                          <span className="text-sm text-neutral-500">Thinking...</span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </CardContent>

                  <div className="p-4 bg-white border-t border-neutral-100">
                    <form onSubmit={handleChat} className="flex gap-2">
                      <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={repoData?.status === 'ready' ? "Ask a question..." : "Waiting for analysis to complete..."}
                        disabled={repoData?.status !== 'ready' || chatLoading}
                        className="flex-1"
                      />
                      <Button type="submit" disabled={!input.trim() || repoData?.status !== 'ready' || chatLoading} size="icon" className="w-10 px-0">
                        <Send className="w-4 h-4" />
                      </Button>
                    </form>
                  </div>
                </Card>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
