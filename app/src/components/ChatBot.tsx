import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLocation } from "react-router-dom";
import { useProjectMap } from "../contexts/ProjectContext";
import { api } from "../api/client";
import type { Project, Task } from "../types";

type MsgType = "user" | "system" | "output" | "error" | "claude";

interface ChatMessage {
  id: string;
  type: MsgType;
  content: string;
  timestamp: Date;
}

interface Conversation {
  projectId: string | null;
  messages: ChatMessage[];
  hasClaudeConversation: boolean;
}

const BASE_URL = "http://127.0.0.1:18427/api";

/**
 * Build a system prompt that gives Claude full context about TodoAI and the current project.
 */
function buildSystemPrompt(project: Project | null, tasks: Task[]): string {
  let prompt = `Tu es l'assistant IA de TodoAI, un logiciel de gestion de tâches et de projets.
Tu peux aider l'utilisateur à gérer ses tâches : créer, modifier, supprimer, organiser, prioriser.

## API disponible (base: ${BASE_URL})
- GET /tasks?project_id=<id> — lister les tâches d'un projet
- POST /tasks — créer une tâche { title, project_id, notes, impact, effort, tags, parent_task_id }
- PATCH /tasks/<id> — modifier une tâche { title, status, notes, impact, effort, tags, due_at }
- DELETE /tasks/<id> — supprimer une tâche
- POST /tasks/<id>/complete — marquer comme done
- GET /projects — lister les projets
- POST /projects — créer un projet { name, color }
- PATCH /projects/<id> — modifier un projet
- DELETE /projects/<id> — supprimer un projet
`;

  if (project) {
    prompt += `\n## Projet actuel: ${project.name}
- ID: ${project.id}
- Couleur: ${project.color}`;
    if (project.local_path) {
      prompt += `\n- Chemin local: ${project.local_path}`;
    }
    if (project.notes) {
      prompt += `\n- Context:\n${project.notes}`;
    }

    if (tasks.length > 0) {
      prompt += `\n\n## Tâches du projet (${tasks.length}):\n`;
      for (const t of tasks) {
        const subtaskCount = t.subtasks?.length || 0;
        prompt += `- [${t.status}] "${t.title}" (id: ${t.id}, score: ${t.score}`;
        if (t.tags.length) prompt += `, tags: ${t.tags.join(",")}`;
        if (t.due_at) prompt += `, due: ${t.due_at}`;
        if (subtaskCount > 0) prompt += `, ${subtaskCount} subtasks`;
        prompt += `)\n`;
      }
    }
  } else {
    prompt += `\n## Aucun projet sélectionné — l'utilisateur est dans l'Inbox ou une page globale.`;
  }

  prompt += `\n---\nRéponds de façon concise et directe. Si l'utilisateur demande de créer/modifier/supprimer des tâches, fais-le via les appels API ci-dessus.`;

  return prompt;
}

export default function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [activeConvKey, setActiveConvKey] = useState<string>("inbox");
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [showSwitchBanner, setShowSwitchBanner] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // Toggle chatbot via global shortcut (Ctrl+J)
  useEffect(() => {
    const handler = () => setIsOpen((v) => !v);
    window.addEventListener("todoai:toggle-chatbot", handler);
    return () => window.removeEventListener("todoai:toggle-chatbot", handler);
  }, []);

  const location = useLocation();
  const projectMap = useProjectMap();

  // Derive current project from URL
  const currentProjectId = location.pathname.match(/^\/project\/(.+)/)?.[1] || null;
  const currentProject = currentProjectId ? projectMap[currentProjectId] || null : null;
  const convKeyForProject = currentProjectId || "inbox";

  // Get or create conversation for a key
  const getConversation = useCallback((key: string): Conversation => {
    return conversations[key] || {
      projectId: key === "inbox" ? null : key,
      messages: [],
      hasClaudeConversation: false,
    };
  }, [conversations]);

  const activeConv = getConversation(activeConvKey);
  const messages = activeConv.messages;

  // Update conversation in state
  const updateConversation = useCallback((key: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => {
      const existing = prev[key] || {
        projectId: key === "inbox" ? null : key,
        messages: [],
        hasClaudeConversation: false,
      };
      return { ...prev, [key]: updater(existing) };
    });
  }, []);

  // When navigating to a different project, handle conversation switching
  useEffect(() => {
    if (!isOpen) return;

    if (convKeyForProject === activeConvKey) {
      setShowSwitchBanner(false);
      return;
    }

    // If active conversation has messages, show switch banner
    const active = getConversation(activeConvKey);
    if (active.messages.length > 0) {
      setShowSwitchBanner(true);
      setPendingProjectId(convKeyForProject);
    } else {
      // No messages in current conv, just switch
      setActiveConvKey(convKeyForProject);
      setShowSwitchBanner(false);
    }
  }, [convKeyForProject, isOpen]);

  const switchToProject = () => {
    if (pendingProjectId) {
      setActiveConvKey(pendingProjectId);
    }
    setShowSwitchBanner(false);
    setPendingProjectId(null);
  };

  const stayOnCurrent = () => {
    setShowSwitchBanner(false);
    setPendingProjectId(null);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // On first open of a conversation, add welcome message
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const projectForConv = activeConvKey === "inbox" ? null : projectMap[activeConvKey];
      const name = projectForConv ? projectForConv.name : "Inbox";
      updateConversation(activeConvKey, (c) => ({
        ...c,
        messages: [{
          id: crypto.randomUUID(),
          type: "system" as MsgType,
          content: `Conversation: ${name}\nJe suis l'assistant TodoAI. Je connais ton projet et tes tâches.\nDemande-moi de créer, modifier, ou organiser tes tâches.`,
          timestamp: new Date(),
        }],
      }));
    }
  }, [isOpen, activeConvKey]);

  const addMessage = useCallback((type: MsgType, content: string) => {
    updateConversation(activeConvKey, (c) => ({
      ...c,
      messages: [...c.messages, { id: crypto.randomUUID(), type, content, timestamp: new Date() }],
    }));
  }, [activeConvKey, updateConversation]);

  // Determine cwd for Claude
  const getCwd = useCallback(() => {
    const projId = activeConvKey === "inbox" ? null : activeConvKey;
    const proj = projId ? projectMap[projId] : null;
    return proj?.local_path || "C:\\Users\\vmont\\todoto";
  }, [activeConvKey, projectMap]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isRunning) return;

    setInput("");
    setHistoryIdx(-1);
    setCommandHistory((prev) => [text, ...prev.slice(0, 49)]);
    addMessage("user", text);

    // Special commands
    if (text === "clear" || text === "cls") {
      updateConversation(activeConvKey, (c) => ({
        ...c,
        messages: [],
        hasClaudeConversation: false,
      }));
      return;
    }

    if (text === "new" || text === "/new") {
      updateConversation(activeConvKey, (c) => ({
        ...c,
        hasClaudeConversation: false,
      }));
      addMessage("system", "Nouvelle conversation démarrée.");
      return;
    }

    // Fetch project tasks for context
    setIsRunning(true);
    try {
      const projId = activeConvKey === "inbox" ? null : activeConvKey;
      const proj = projId ? projectMap[projId] : null;

      let tasks: Task[] = [];
      if (projId) {
        try {
          tasks = await api.listTasks({ project_id: projId });
        } catch { /* ignore */ }
      }

      const systemPrompt = buildSystemPrompt(proj || null, tasks);
      const fullPrompt = activeConv.hasClaudeConversation
        ? text
        : `${systemPrompt}\n\n---\nUser: ${text}`;

      const result = await invoke<string>("exec_claude", {
        cwd: getCwd(),
        prompt: fullPrompt,
        continueConversation: activeConv.hasClaudeConversation,
      });

      updateConversation(activeConvKey, (c) => ({
        ...c,
        hasClaudeConversation: true,
      }));
      addMessage("claude", result.trimEnd());
    } catch (err) {
      addMessage("error", String(err));
    }
    setIsRunning(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIdx = Math.min(historyIdx + 1, commandHistory.length - 1);
        setHistoryIdx(newIdx);
        setInput(commandHistory[newIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(commandHistory[newIdx]);
      } else {
        setHistoryIdx(-1);
        setInput("");
      }
    }
  };

  // Active conversation project name
  const activeProjectName = activeConvKey === "inbox"
    ? "Inbox"
    : (projectMap[activeConvKey]?.name || "Projet");

  // Count active conversations
  const convKeys = Object.keys(conversations).filter((k) => conversations[k].messages.length > 0);

  return (
    <>
      {/* Floating rocket button */}
      <button
        className={`chatbot-fab ${isOpen ? "chatbot-fab-active" : ""}`}
        onClick={() => {
          if (!isOpen) {
            setActiveConvKey(convKeyForProject);
            setShowSwitchBanner(false);
          }
          setIsOpen(!isOpen);
        }}
        title="TodoAI Assistant"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="chatbot-panel">
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-left">
              <span className="chatbot-header-title">{activeProjectName}</span>
              {activeConv.hasClaudeConversation && (
                <span className="chatbot-conv-badge">active</span>
              )}
            </div>
            <div className="chatbot-header-actions">
              {/* New conversation */}
              <button
                className="chatbot-header-btn"
                onClick={() => {
                  updateConversation(activeConvKey, (c) => ({
                    ...c,
                    messages: [],
                    hasClaudeConversation: false,
                  }));
                }}
                title="Nouvelle conversation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button
                className="chatbot-header-btn"
                onClick={() => setIsOpen(false)}
                title="Fermer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Conversation tabs if multiple */}
          {convKeys.length > 1 && (
            <div className="chatbot-tabs">
              {convKeys.map((key) => {
                const name = key === "inbox" ? "Inbox" : (projectMap[key]?.name || "Projet");
                return (
                  <button
                    key={key}
                    className={`chatbot-tab ${key === activeConvKey ? "chatbot-tab-active" : ""}`}
                    onClick={() => { setActiveConvKey(key); setShowSwitchBanner(false); }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Switch banner */}
          {showSwitchBanner && pendingProjectId && (
            <div className="chatbot-switch-banner">
              <span>
                Tu es sur {pendingProjectId === "inbox" ? "Inbox" : (projectMap[pendingProjectId]?.name || "un autre projet")}
              </span>
              <div className="chatbot-switch-actions">
                <button onClick={switchToProject}>Ouvrir</button>
                <button className="secondary" onClick={stayOnCurrent}>Rester ici</button>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="chatbot-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`chatbot-msg chatbot-msg-${msg.type}`}>
                {msg.type === "user" && (
                  <div className="chatbot-msg-prompt">
                    <span className="chatbot-prompt-icon">{"\u2192"}</span>
                    <span className="chatbot-prompt-text">{msg.content}</span>
                  </div>
                )}
                {msg.type === "system" && (
                  <div className="chatbot-msg-system">{msg.content}</div>
                )}
                {msg.type === "output" && (
                  <pre className="chatbot-msg-output">{msg.content}</pre>
                )}
                {msg.type === "claude" && (
                  <div className="chatbot-msg-claude">
                    <div className="chatbot-claude-avatar">C</div>
                    <div className="chatbot-claude-content">{msg.content}</div>
                  </div>
                )}
                {msg.type === "error" && (
                  <pre className="chatbot-msg-error">{msg.content}</pre>
                )}
              </div>
            ))}
            {isRunning && (
              <div className="chatbot-msg">
                <div className="chatbot-claude-thinking">
                  <div className="chatbot-spinner">
                    <span></span><span></span><span></span>
                  </div>
                  <span className="chatbot-thinking-text">Claude réfléchit...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="chatbot-input-bar chatbot-input-claude">
            <span className="chatbot-input-prompt">{"\u2192"}</span>
            <input
              ref={inputRef}
              className="chatbot-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Demande à Claude..."
              disabled={isRunning}
              spellCheck
              autoComplete="off"
            />
            <button
              className="chatbot-send-btn chatbot-send-claude"
              onClick={handleSubmit}
              disabled={isRunning || !input.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
