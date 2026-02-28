"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ============================================================
   TYPES
   ============================================================ */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  code: string | null;
  intent?: string;
  insertMode?: string;
  usedMock?: boolean;
  isStreaming?: boolean;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessage[];
  projectRoot?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  preview: string; // First message preview
}

const STORAGE_KEY = "senorita_conversations";
const ACTIVE_KEY = "senorita_active_conversation";

/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */
function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateTitle(messages: ConversationMessage[]): string {
  if (messages.length === 0) return "New Conversation";
  
  // Use first user message as title
  const firstUserMsg = messages.find(m => m.role === "user");
  if (firstUserMsg) {
    const text = firstUserMsg.text.trim();
    if (text.length <= 40) return text;
    return text.substring(0, 37) + "...";
  }
  
  return "New Conversation";
}

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const parsed = JSON.parse(stored);
    // Convert date strings back to Date objects
    return parsed.map((conv: Conversation) => ({
      ...conv,
      createdAt: new Date(conv.createdAt),
      updatedAt: new Date(conv.updatedAt),
      messages: conv.messages.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      })),
    }));
  } catch (e) {
    console.error("[useConversations] Failed to load:", e);
    return [];
  }
}

function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (e) {
    console.error("[useConversations] Failed to save:", e);
  }
}

function loadActiveId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

function saveActiveId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

/* ============================================================
   HOOK
   ============================================================ */
export function useConversations() {
  // Track if this is the first render (to avoid saving on initial load)
  const isFirstRender = useRef(true);
  
  // Initialize state from localStorage using lazy initializer
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const loaded = loadConversations();
    const storedActiveId = loadActiveId();
    
    if (storedActiveId && loaded.some(c => c.id === storedActiveId)) {
      return storedActiveId;
    } else if (loaded.length > 0) {
      const sorted = [...loaded].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return sorted[0].id;
    }
    return null;
  });

  // Save to localStorage when conversations change (skip first render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveConversations(conversations);
  }, [conversations]);

  // Save active ID when it changes (also skip first render)
  const isFirstActiveIdRender = useRef(true);
  useEffect(() => {
    if (isFirstActiveIdRender.current) {
      isFirstActiveIdRender.current = false;
      return;
    }
    saveActiveId(activeId);
  }, [activeId]);

  // Get active conversation
  const activeConversation = conversations.find(c => c.id === activeId) || null;

  // Get conversation summaries for the list
  const conversationList: ConversationSummary[] = conversations
    .map(conv => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
      preview: conv.messages[0]?.text.substring(0, 60) || "",
    }))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  // Create new conversation
  const createConversation = useCallback((projectRoot?: string): Conversation => {
    const newConv: Conversation = {
      id: generateId(),
      title: "New Conversation",
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
      projectRoot,
    };
    
    setConversations(prev => [newConv, ...prev]);
    setActiveId(newConv.id);
    
    return newConv;
  }, []);

  // Switch to a conversation
  const switchConversation = useCallback((id: string) => {
    if (conversations.some(c => c.id === id)) {
      setActiveId(id);
    }
  }, [conversations]);

  // Delete a conversation
  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      
      // If we deleted the active one, switch to another
      if (activeId === id) {
        const next = filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        setActiveId(next?.id || null);
      }
      
      return filtered;
    });
  }, [activeId]);

  // Update messages in active conversation
  const setMessages = useCallback((messages: ConversationMessage[] | ((prev: ConversationMessage[]) => ConversationMessage[])) => {
    if (!activeId) {
      // Auto-create a conversation if none exists
      const newConv = createConversation();
      setConversations(prev => prev.map(c => 
        c.id === newConv.id 
          ? { 
              ...c, 
              messages: typeof messages === "function" ? messages([]) : messages,
              updatedAt: new Date(),
              title: generateTitle(typeof messages === "function" ? messages([]) : messages),
            }
          : c
      ));
      return;
    }
    
    setConversations(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      
      const newMessages = typeof messages === "function" ? messages(c.messages) : messages;
      return {
        ...c,
        messages: newMessages,
        updatedAt: new Date(),
        title: c.messages.length === 0 ? generateTitle(newMessages) : c.title,
      };
    }));
  }, [activeId, createConversation]);

  // Get messages from active conversation
  const messages = activeConversation?.messages || [];

  // Rename a conversation
  const renameConversation = useCallback((id: string, title: string) => {
    setConversations(prev => prev.map(c => 
      c.id === id ? { ...c, title, updatedAt: new Date() } : c
    ));
  }, []);

  // Clear all conversations
  const clearAll = useCallback(() => {
    setConversations([]);
    setActiveId(null);
  }, []);

  return {
    // State
    conversations: conversationList,
    activeConversation,
    activeId,
    messages,
    
    // Actions
    createConversation,
    switchConversation,
    deleteConversation,
    setMessages,
    renameConversation,
    clearAll,
  };
}
