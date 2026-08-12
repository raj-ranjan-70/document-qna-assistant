import React, { useState, useEffect, useRef } from 'react';

function App() {
  const [tenantId, setTenantId] = useState('school-1');
  const [documents, setDocuments] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  
  // Upload form state
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  
  // Chat form state
  const [question, setQuestion] = useState('');
  const [chatCategory, setChatCategory] = useState('');
  const [streaming, setStreaming] = useState(true);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState(null);
  
  // Expanded message sources
  const [expandedSources, setExpandedSources] = useState({});

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load documents and conversations when tenantId changes
  useEffect(() => {
    fetchDocuments();
    fetchConversations();
    setActiveConvId(null);
    setMessages([]);
  }, [tenantId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll documents status if any is in PROCESSING
  useEffect(() => {
    const hasProcessing = documents.some(doc => doc.status === 'PROCESSING');
    if (hasProcessing) {
      const interval = setInterval(() => {
        fetchDocuments();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [documents]);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/v1/documents?page=0&size=50', {
        headers: { 'X-Tenant-Id': tenantId }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error("Error loading documents", err);
    }
  };

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/v1/conversations', {
        headers: { 'X-Tenant-Id': tenantId }
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.error("Error loading conversations", err);
    }
  };

  const fetchConversationHistory = async (id) => {
    try {
      const res = await fetch(`/api/v1/conversations/${id}`, {
        headers: { 'X-Tenant-Id': tenantId }
      });
      if (res.ok) {
        const data = await res.json();
        setActiveConvId(data.id);
        setMessages(data.messages);
      }
    } catch (err) {
      console.error("Error loading conversation history", err);
    }
  };

  const handleCreateConversation = async () => {
    try {
      const res = await fetch('/api/v1/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({ title: 'New Chat' })
      });
      if (res.ok) {
        const data = await res.json();
        fetchConversations();
        fetchConversationHistory(data.id);
      }
    } catch (err) {
      console.error("Error creating conversation", err);
    }
  };

  const handleDeleteConversation = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      const res = await fetch(`/api/v1/conversations/${id}`, {
        method: 'DELETE',
        headers: { 'X-Tenant-Id': tenantId }
      });
      if (res.ok) {
        fetchConversations();
        if (activeConvId === id) {
          setActiveConvId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error("Error deleting conversation", err);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    if (uploadTitle) formData.append("title", uploadTitle);
    if (uploadCategory) formData.append("category", uploadCategory);

    try {
      const res = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: {
          'X-Tenant-Id': tenantId
        },
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      setUploadFile(null);
      setUploadTitle('');
      setUploadCategory('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchDocuments();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this document? All associated vector embeddings will be permanently removed.")) return;
    try {
      const res = await fetch(`/api/v1/documents/${id}`, {
        method: 'DELETE',
        headers: { 'X-Tenant-Id': tenantId }
      });
      if (res.ok) {
        fetchDocuments();
      } else {
        alert("Failed to delete document");
      }
    } catch (err) {
      console.error("Error deleting document", err);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!question.trim() || sending) return;

    setSending(true);
    setChatError(null);
    const userQuery = question;
    setQuestion('');

    // Pre-insert temporary user message locally
    const tempUserMsg = {
      id: 'temp-user-' + Date.now(),
      role: 'USER',
      content: userQuery,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    if (streaming) {
      // 1. SSE Streaming approach
      let tempAssistantMsgId = 'temp-assistant-' + Date.now();
      const tempAssistantMsg = {
        id: tempAssistantMsgId,
        role: 'ASSISTANT',
        content: '',
        sources: [],
        createdAt: new Date().toISOString(),
        isStreaming: true
      };
      setMessages(prev => [...prev, tempAssistantMsg]);

      try {
        const response = await fetch('/api/v1/chat/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Id': tenantId
          },
          body: JSON.stringify({
            question: userQuery,
            conversationId: activeConvId || undefined,
            category: chatCategory || undefined
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;

            const lines = part.split('\n');
            let eventType = '';
            let data = '';

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventType = line.replace('event:', '').trim();
              } else if (line.startsWith('data:')) {
                data = line.replace('data:', '').trim();
              }
            }

            if (eventType === 'token') {
              setMessages(prev => prev.map(msg => {
                if (msg.id === tempAssistantMsgId) {
                  return { ...msg, content: msg.content + data };
                }
                return msg;
              }));
            } else if (eventType === 'sources') {
              try {
                const sourcesList = JSON.parse(data);
                setMessages(prev => prev.map(msg => {
                  if (msg.id === tempAssistantMsgId) {
                    return { ...msg, sources: sourcesList };
                  }
                  return msg;
                }));
              } catch (e) {
                console.error("Failed to parse sources JSON", e);
              }
            } else if (eventType === 'done') {
              setMessages(prev => prev.map(msg => {
                if (msg.id === tempAssistantMsgId) {
                  return { ...msg, isStreaming: false };
                }
                return msg;
              }));
            } else if (eventType === 'error') {
              throw new Error(data);
            }
          }
        }

        fetchConversations();
        if (!activeConvId) {
          // If we started a new conversation, fetch latest conversation history to link the ID
          const res = await fetch('/api/v1/conversations', { headers: { 'X-Tenant-Id': tenantId } });
          const list = await res.json();
          if (list.length > 0) {
            fetchConversationHistory(list[0].id);
          }
        }

      } catch (err) {
        setChatError(err.message);
        // Remove the temporary assistant message if error occurred before streams
        setMessages(prev => prev.filter(msg => msg.id !== tempAssistantMsgId));
      } finally {
        setSending(false);
      }

    } else {
      // 2. Normal non-streaming chat
      try {
        const res = await fetch('/api/v1/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Id': tenantId
          },
          body: JSON.stringify({
            question: userQuery,
            conversationId: activeConvId || undefined,
            category: chatCategory || undefined
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Chat failed' }));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        
        // Add assistant response
        const assistantResponse = {
          id: 'assistant-' + Date.now(),
          role: 'ASSISTANT',
          content: data.answer,
          sources: data.sources,
          createdAt: new Date().toISOString()
        };
        
        setMessages(prev => [...prev, assistantResponse]);
        
        if (!activeConvId) {
          setActiveConvId(data.conversationId);
          fetchConversations();
        } else {
          fetchConversationHistory(activeConvId);
        }
      } catch (err) {
        setChatError(err.message);
      } finally {
        setSending(false);
      }
    }
  };

  const toggleSources = (msgId) => {
    setExpandedSources(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* SIDEBAR: Config & Document Manager */}
      <div className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col h-full">
        {/* Header Tenant Config */}
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-lg font-bold text-indigo-400 tracking-wide flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            RAG Assistant
          </h1>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Active Tenant Scoping
            </label>
            <input
              type="text"
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 font-medium text-slate-200"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="e.g. school-1"
            />
          </div>
        </div>

        {/* Tab Selection/Sections */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Document Uploader */}
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
              Ingest Document
            </h2>
            <form onSubmit={handleUpload} className="space-y-3">
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf,.docx,.txt,.md"
                  onChange={(e) => setUploadFile(e.target.files[0])}
                  className="hidden"
                  id="doc-file-upload"
                  required
                />
                <label
                  htmlFor="doc-file-upload"
                  className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 hover:border-indigo-500 rounded-lg p-4 cursor-pointer hover:bg-indigo-950/10 transition group"
                >
                  <svg className="w-8 h-8 text-slate-500 group-hover:text-indigo-400 mb-2 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                  </svg>
                  <span className="text-xs text-slate-300 font-medium group-hover:text-indigo-300">
                    {uploadFile ? uploadFile.name : "Select File"}
                  </span>
                  <span className="text-[10px] text-slate-500 mt-1">
                    PDF, DOCX, TXT, MD (Max 20MB)
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Title (Opt)"
                  className="bg-slate-950 border border-slate-850 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-500"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                />
                <select
                  className="bg-slate-950 border border-slate-850 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                >
                  <option value="">Category (Opt)</option>
                  <option value="FEES">FEES</option>
                  <option value="HR">HR</option>
                  <option value="EXAM">EXAM</option>
                  <option value="TRANSPORT">TRANSPORT</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={uploading || !uploadFile}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded py-1.5 text-xs font-semibold tracking-wide transition flex items-center justify-center gap-1.5"
              >
                {uploading ? (
                  <>
                    <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                    Ingesting...
                  </>
                ) : "Upload & Parse"}
              </button>

              {uploadError && (
                <div className="text-[10px] text-red-400 bg-red-950/20 border border-red-900/50 rounded p-2">
                  {uploadError}
                </div>
              )}
            </form>
          </div>

          {/* Document list */}
          <div className="space-y-2">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Tenant Corpus ({documents.length})
            </h2>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {documents.length === 0 ? (
                <div className="text-xs text-slate-500 italic py-2 text-center bg-slate-950/20 border border-slate-900 rounded-lg">
                  No documents uploaded
                </div>
              ) : (
                documents.map(doc => (
                  <div key={doc.id} className="bg-slate-950 border border-slate-900 hover:border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2 group transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold text-slate-200 truncate" title={doc.title}>
                          {doc.title}
                        </p>
                        {doc.category && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300">
                            {doc.category}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                        <span>{formatSize(doc.sizeBytes)}</span>
                        <span>•</span>
                        {doc.status === 'PROCESSING' && (
                          <span className="text-yellow-400 font-medium flex items-center gap-1">
                            <span className="animate-pulse w-1.5 h-1.5 bg-yellow-400 rounded-full" />
                            Ingesting
                          </span>
                        )}
                        {doc.status === 'READY' && (
                          <span className="text-emerald-400 font-medium">Ready</span>
                        )}
                        {doc.status === 'FAILED' && (
                          <span className="text-red-400 font-medium cursor-pointer" title={doc.errorMessage}>
                            Failed
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteDocument(doc.id, e)}
                      className="text-slate-500 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                      title="Delete document & chunks"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Conversations Memory */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Chats History
              </h2>
              <button
                onClick={handleCreateConversation}
                className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
              >
                + New Chat
              </button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {conversations.length === 0 ? (
                <div className="text-xs text-slate-500 italic py-2 text-center bg-slate-950/20 border border-slate-900 rounded-lg">
                  No active conversations
                </div>
              ) : (
                conversations.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => fetchConversationHistory(conv.id)}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between gap-2 group transition ${
                      activeConvId === conv.id
                        ? "bg-indigo-950/30 border-indigo-500/50 text-slate-100"
                        : "bg-slate-950 border-slate-900 text-slate-400 hover:border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <span className="truncate font-medium flex-1 pr-2" title={conv.title}>
                      {conv.title}
                    </span>
                    <button
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      className="text-slate-500 hover:text-red-400 p-0.5 opacity-0 group-hover:opacity-100 transition"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MAIN PANEL: Chat Area */}
      <div className="flex-1 flex flex-col h-full bg-slate-950 relative">
        {/* Chat Banner Info */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-950 rounded-lg border border-indigo-850">
              <svg className="w-5 h-5 text-indigo-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Grounded Document Q&A Console
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                Grounded answers strictly compiled from tenant reference context
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
              Tenant context: <strong className="text-indigo-400">{tenantId}</strong>
            </span>
          </div>
        </div>

        {/* Chat Message Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-4">
              <div className="p-4 bg-slate-900/60 rounded-full border border-slate-800">
                <svg className="w-12 h-12 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-200">Start Grounded Dialogue</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Provide circulars or policy documents in the sidebar, switch to your tenant scoping, then input your question. If evidence is lacking, the system refuses rather than hallucinates.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'USER';
              return (
                <div key={msg.id} className={`flex gap-4 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border font-bold text-xs ${
                    isUser
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-indigo-400'
                  }`}>
                    {isUser ? 'U' : 'AI'}
                  </div>
                  {/* Bubble Container */}
                  <div className="space-y-2 max-w-[85%]">
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed border ${
                      isUser
                        ? 'bg-indigo-600/10 border-indigo-500/20 text-indigo-50 font-medium'
                        : msg.content === 'not found in the available documents'
                          ? 'bg-red-950/20 border-red-900/30 text-red-200 font-medium italic'
                          : 'bg-slate-900/60 border-slate-850 text-slate-200'
                    }`}>
                      {msg.content || (
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <span className="animate-spin w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full" />
                          Streaming chunks...
                        </span>
                      )}
                    </div>
                    {/* Citations Renders (ASSISTANT only) */}
                    {!isUser && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSources(msg.id)}
                            className="text-[10px] font-bold tracking-wider uppercase text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                          >
                            <svg className={`w-3 h-3 transform transition ${expandedSources[msg.id] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/>
                            </svg>
                            Sources & Citations ({msg.sources ? msg.sources.length : 0})
                          </button>
                          {(!msg.sources || msg.sources.length === 0) && !msg.isStreaming && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-900/30">
                              Refused (No Grounding Context)
                            </span>
                          )}
                        </div>
                        {expandedSources[msg.id] && msg.sources && msg.sources.length > 0 && (
                          <div className="mt-1.5 space-y-2 bg-slate-950 border border-slate-900 rounded-xl p-3 max-w-2xl">
                            {msg.sources.map((src, sIdx) => (
                              <div key={sIdx} className="text-xs space-y-1 border-b border-slate-900/60 pb-2 last:border-0 last:pb-0">
                                <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                                  <span className="text-slate-300 font-bold truncate pr-3" title={src.title}>
                                    📄 {src.title} (Page {src.pageNumber || 1})
                                  </span>
                                  <span className="flex-shrink-0 bg-indigo-950 px-1.5 py-0.5 rounded text-indigo-300 font-bold">
                                    Score: {src.similarityScore ? (src.similarityScore * 100).toFixed(1) : "100"}%
                                  </span>
                                </div>
                                <blockquote className="text-[11px] text-slate-400 italic bg-slate-900/30 border-l border-indigo-500/40 pl-2 py-1 leading-normal truncate-3-lines">
                                  "{src.snippet}"
                                </blockquote>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input Bar */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/20 backdrop-blur-md">
          {chatError && (
            <div className="mx-auto max-w-3xl mb-3 text-xs text-red-400 bg-red-950/20 border border-red-900/50 rounded-lg p-3 flex justify-between items-center">
              <span>{chatError}</span>
              <button onClick={() => setChatError(null)} className="text-red-400 hover:text-red-300">✕</button>
            </div>
          )}
          
          <form onSubmit={handleSendChat} className="max-w-3xl mx-auto flex gap-3 items-center">
            {/* Category Filter */}
            <select
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-indigo-500 text-slate-300 font-medium"
              value={chatCategory}
              onChange={(e) => setChatCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              <option value="FEES">FEES</option>
              <option value="HR">HR</option>
              <option value="EXAM">EXAM</option>
              <option value="TRANSPORT">TRANSPORT</option>
            </select>

            {/* Input message */}
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-slate-200"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question from document context..."
                disabled={sending}
              />
            </div>

            {/* SSE toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400 select-none flex-shrink-0">
              <input
                type="checkbox"
                checked={streaming}
                onChange={(e) => setStreaming(e.target.checked)}
                className="rounded border-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-slate-900"
              />
              Stream
            </label>

            {/* Send Button */}
            <button
              type="submit"
              disabled={sending || !question.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition flex-shrink-0 flex items-center justify-center"
            >
              {sending ? (
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
                </svg>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
