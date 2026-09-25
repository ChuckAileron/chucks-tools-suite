import { memo, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ChuckBotAttachedFile, ChuckBotEvent, ChuckBotModel } from './types';
import type { ChuckBotOllamaStatus, ChuckBotServerStatus } from './types';

const MODELS: { id: ChuckBotModel; label: string }[] = [
  { id: 'qwen2.5:latest', label: 'Qwen 2.5 (Chat)' },
  { id: 'sqlcoder:latest', label: 'SQLCoder (SQL)' },
  { id: 'multi', label: 'Multi-Agente (Auto)' },
];

const FILE_LIMIT      = 256 * 1024;
const VSCODE_PORT_KEY = 'chucks.chuckbot.vscode-port';
// La sesión de chat vive en sessionStorage: sobrevive al navegar entre
// secciones de la suite y se descarta al cerrar el programa.
const CHAT_SESSION_KEY = 'chucks.chuckbot.chat-session';

const STEP_TITLES: Record<string, string> = {
  sql:          'SQLCoder — SQL generado',
  synthesizing: 'Qwen — Respuesta final',
  direct:       'Qwen',
};

// Renderizado mínimo de Markdown (bloques de código cercados e inline code),
// igual que la interfaz web original de ChuckBot.
function renderMarkdown(text: string): string {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html         = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || '';
    const escaped  = escapeHtml(code.trimEnd());
    return `<pre><code class="language-${language}">${escaped}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  return html;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  title?: string;
  step?: string;
  text: string;
  files?: string[];
  streaming?: boolean;
  error?: boolean;
}

interface Notice {
  tone: 'ok' | 'warn' | 'err';
  text: string;
}

interface ChuckBotToolProps {
  server: ChuckBotServerStatus;
  ollama: ChuckBotOllamaStatus;
  onServerChange: (status: ChuckBotServerStatus) => void;
  onOllamaChange: (status: ChuckBotOllamaStatus) => void;
}

function readChatSession(): { messages: ChatMessage[]; model: ChuckBotModel } | null {
  try {
    const raw = sessionStorage.getItem(CHAT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: ChatMessage[]; model?: ChuckBotModel };
    if (!Array.isArray(parsed.messages)) return null;
    const messages = parsed.messages
      .filter((message) => message && typeof message.text === 'string')
      .map((message) => ({ ...message, streaming: false, error: Boolean(message.error) }));
    const model    = MODELS.some((option) => option.id === parsed.model)
      ? parsed.model!
      : 'qwen2.5:latest';
    return { messages, model };
  } catch {
    return null;
  }
}

// Fila de mensaje memoizada: solo se vuelve a renderizar (y se reprocesa su
// Markdown) cuando cambia su texto, es decir, únicamente el mensaje en
// streaming. El resto del historial se conserva sin re-renderizar.
const ChatMessageRow = memo(function ChatMessageRow({
  message,
  modelLabel,
}: {
  message: ChatMessage;
  modelLabel: string;
}) {
  return (
    <div
      className={`chuckbot-message ${message.role}${message.step ? ` step-${message.step}` : ''}`}
    >
      <small className="chuckbot-message-label">
        {message.role === 'user' ? 'Tú' : message.title || `AI — ${modelLabel}`}
      </small>
      {message.files && message.files.length > 0 && (
        <span className="chuckbot-message-files">📎 {message.files.join(', ')}</span>
      )}
      <div
        className={`chuckbot-bubble${message.streaming ? ' streaming' : ''}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
      />
    </div>
  );
});

export default function ChuckBotTool({
  server,
  ollama,
  onServerChange,
  onOllamaChange,
}: ChuckBotToolProps) {
  const [initialSession]                  = useState(() => readChatSession());
  const [ollamaPending, setOllamaPending] = useState(false);
  const [model, setModel]                 = useState<ChuckBotModel>(initialSession?.model ?? 'qwen2.5:latest');
  const [mode, setMode]                   = useState<'chat' | 'solution'>('chat');
  const [messages, setMessages]           = useState<ChatMessage[]>(initialSession?.messages ?? []);
  const [inputValue, setInputValue]       = useState('');
  const [attached, setAttached]           = useState<ChuckBotAttachedFile[]>([]);
  const [streaming, setStreaming]         = useState(false);
  const [notice, setNotice]               = useState<Notice | null>(null);
  const [solution, setSolution]           = useState<{ name: string; content: string } | null>(null);
  const [solutionName, setSolutionName]   = useState('');
  const [savedSolution, setSavedSolution] = useState<{ path: string; name: string } | null>(null);
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [vscodePort, setVscodePort]       = useState(() => {
    try {
      const stored = localStorage.getItem(VSCODE_PORT_KEY);
      const parsed = Number(stored);
      return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : '3710';
    } catch {
      return '3710';
    }
  });
  const idRef           = useRef(0);
  const messagesRef     = useRef<ChatMessage[]>(initialSession?.messages ?? []);
  const activeStreamRef = useRef<number | null>(null);
  const chatsRef        = useRef<HTMLDivElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  // Buffer de streaming: los chunks se acumulan y se aplican una vez por frame
  // con requestAnimationFrame en lugar de re-renderizar por cada carácter.
  const pendingChunkRef = useRef('');
  const pendingFrameRef = useRef<number | null>(null);

  const allocId = () => ++idRef.current;

  const setMessagesBoth = (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessages((prev) => {
      const next          = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  };

  const appendStreamText = (text: string) => {
    if (!text) return;
    setMessagesBoth((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'ai' && last.streaming) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { id: allocId(), role: 'ai', text, streaming: true }];
    });
  };

  const flushPendingChunk = () => {
    pendingFrameRef.current = null;
    const text              = pendingChunkRef.current;
    pendingChunkRef.current = '';
    appendStreamText(text);
  };

  const queueChunk = (text: string) => {
    pendingChunkRef.current += text;
    if (pendingFrameRef.current === null) {
      pendingFrameRef.current = requestAnimationFrame(flushPendingChunk);
    }
  };

  const flushStreamNow = () => {
    if (pendingFrameRef.current !== null) {
      cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
    const text              = pendingChunkRef.current;
    pendingChunkRef.current = '';
    appendStreamText(text);
  };

  // El contador de ids arranca tras el id más alto de la sesión restaurada.
  useEffect(() => {
    const restored = initialSession?.messages;
    if (restored?.length) idRef.current = Math.max(...restored.map((message) => message.id));
  }, [initialSession]);

  // La sesión de chat se mantiene en sessionStorage mientras dura (se descarta
  // al cerrar la ventana, tal como el ciclo de vida del encendido de Ollama).
  useEffect(() => {
    try {
      sessionStorage.setItem(
        CHAT_SESSION_KEY,
        JSON.stringify({ messages: messagesRef.current, model }),
      );
    } catch {
      // sessionStorage no disponible
    }
  }, [messages, model]);

  const handleChuckBotEvent = useEffectEvent((event: ChuckBotEvent) => {
    if (activeStreamRef.current === null) activeStreamRef.current = event.streamId;
    if (event.streamId !== activeStreamRef.current) return;
    switch (event.type) {
      case 'chunk': {
        queueChunk(event.data);
        break;
      }
      case 'step': {
        const title = STEP_TITLES[event.data.step];
        if (!title) break;
        const stepMessage: ChatMessage = {
          id:        allocId(),
          role:      'ai',
          title,
          step:      event.data.step,
          text:      '',
          streaming: true,
        };
        setMessagesBoth((prev) => [...prev, stepMessage]);
        break;
      }
      case 'document': {
        setSolution(event.data);
        setSolutionName(event.data.name);
        break;
      }
      case 'error': {
        const message =
          typeof event.data?.message === 'string'
            ? event.data.message.replace(/^❌\s*/g, '')
            : 'Error de comunicación con ChuckBot.';
        setNotice({ tone: 'err', text: message });
        break;
      }
      case 'cancelled': {
        setNotice({ tone: 'warn', text: 'Respuesta cancelada.' });
        break;
      }
      default:
        break;
    }
    if (event.type === 'done' || event.type === 'error' || event.type === 'cancelled') {
      flushStreamNow();
      setMessagesBoth((prev) => {
        const last = prev[prev.length - 1];
        if (!last || !last.streaming) return prev;
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      });
      setStreaming(false);
      activeStreamRef.current = null;
      window.tools
        .chuckbotOllamaStatus()
        .then(onOllamaChange)
        .catch(() => onOllamaChange({ running: false }));
    }
  });

  useEffect(() => {
    const stopEvents = window.tools.onChuckBotEvent(handleChuckBotEvent);
    return () => {
      stopEvents();
      if (pendingFrameRef.current !== null) cancelAnimationFrame(pendingFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (chatsRef.current) chatsRef.current.scrollTop = chatsRef.current.scrollHeight;
  }, [messages, solution, streaming]);

  const onFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // eslint-disable-next-line align-assignments/align-assignments
    const files                          = Array.from(event.target.files || []);
    event.target.value = '';
    const skipped: string[]              = [];
    const loaded: ChuckBotAttachedFile[] = [];
    for (const file of files) {
      if (file.size > FILE_LIMIT) {
        skipped.push(file.name);
        continue;
      }
      try {
        loaded.push({ name: file.name, content: await file.text() });
      } catch {
        skipped.push(file.name);
      }
    }
    if (skipped.length) {
      setNotice({
        tone: 'warn',
        text: `Se omitieron archivos que superan ${Math.round(FILE_LIMIT / 1024)} KB: ${skipped.join(', ')}`,
      });
    }
    setAttached((current) => [...current, ...loaded]);
  };

  const toggleOllama = async () => {
    if (ollamaPending) return;
    setOllamaPending(true);
    try {
      const result = ollama.running
        ? await window.tools.chuckbotOllamaStop()
        : await window.tools.chuckbotOllamaStart();
      onOllamaChange(result);
      setNotice(
        result.running
          ? { tone: 'ok', text: 'Ollama encendido y listo.' }
          : { tone: 'warn', text: 'Ollama apagado.' },
      );
    } catch (error) {
      onOllamaChange({ running: false });
      setNotice({
        tone: 'err',
        text: String(error instanceof Error ? error.message : error),
      });
    } finally {
      setOllamaPending(false);
    }
  };

  const startServer = async () => {
    setNotice({ tone: 'warn', text: 'Iniciando el servidor de ChuckBot…' });
    const result = await window.tools.chuckbotStart();
    onServerChange(result);
    setNotice(
      result.running
        ? { tone: 'ok', text: 'Servidor de ChuckBot activo.' }
        : { tone: 'err', text: result.error || 'No se pudo iniciar ChuckBot.' },
    );
  };

  const send = async () => {
    const text = inputValue.trim();
    if (!text || streaming) return;
    if (!ollama.running) {
      setNotice({ tone: 'warn', text: 'Enciende Ollama primero para chatear.' });
      return;
    }
    if (mode === 'solution' && !attached.length) {
      setNotice({
        tone: 'warn',
        text: 'Adjunta los archivos del proyecto para generar el archivo solución.',
      });
      return;
    }
    const files                    = [...attached];
    const userMessage: ChatMessage = {
      id:    allocId(),
      role:  'user',
      text,
      files: files.map((file) => file.name),
    };
    const history                  = messagesRef.current.map((message) => ({
      role: (message.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content:
        message.role === 'user'
          ? message.files?.length
            ? `${message.text}\n[Archivos adjuntos: ${message.files.join(', ')}]`
            : message.text
          : message.text,
    }));
    setMessagesBoth((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttached([]);
    setSolution(null);
    setSavedSolution(null);
    setNotice(null);
    setStreaming(true);

    try {
      const { id }            = await window.tools.chuckbotChat({
        model,
        message: text,
        mode,
        files,
        history: mode === 'solution' ? [] : history,
      });
      activeStreamRef.current = id;
    } catch (error) {
      setStreaming(false);
      activeStreamRef.current = null;
      setNotice({
        tone: 'err',
        text: String(error instanceof Error ? error.message : error),
      });
    }
  };

  const saveSolutionToProject = async () => {
    if (!solution) return;
    const folder = projectFolder || (await window.tools.chuckbotSelectFolder());
    if (!folder) return;
    setProjectFolder(folder);
    try {
      const result = await window.tools.chuckbotSaveSolution({
        folder,
        name:    solutionName.trim() || 'solucion.txt',
        content: solution.content,
      });
      setSavedSolution(result);
      setNotice({ tone: 'ok', text: `Solución guardada en ${result.path}` });
    } catch (error) {
      setNotice({
        tone: 'err',
        text: String(error instanceof Error ? error.message : error),
      });
    }
  };

  const sendToVsCode = async () => {
    let filePath = savedSolution?.path || '';
    if (!filePath) {
      const folder = projectFolder || (await window.tools.chuckbotSelectFolder());
      if (!folder || !solution) return;
      setProjectFolder(folder);
      try {
        const result = await window.tools.chuckbotSaveSolution({
          folder,
          name:    solutionName.trim() || 'solucion.txt',
          content: solution.content,
        });
        setSavedSolution(result);
        filePath = result.path;
      } catch (error) {
        setNotice({
          tone: 'err',
          text: String(error instanceof Error ? error.message : error),
        });
        return;
      }
    }
    try {
      await window.tools.chuckbotPushToVsCode({ filePath, port: Number(vscodePort) });
      setNotice({ tone: 'ok', text: 'Archivo enviado a VS Code.' });
    } catch (error) {
      setNotice({
        tone: 'err',
        text: String(error instanceof Error ? error.message : error),
      });
    }
  };

  const cancel = async () => {
    await window.tools.chuckbotCancelChat();
  };

  const modelLabel = MODELS.find((m) => m.id === model)?.label || model;

  return (
    <section className="tool chuckbot-tool">
      <header>
        <span>AI</span>
        <div>
          <h1>ChuckBot</h1>
          <p>Asistente de IA local sobre Ollama</p>
        </div>
        <select
          className="chuckbot-model-select"
          value={model}
          disabled={streaming}
          aria-label="Modelo"
          onChange={(event) => setModel(event.target.value as ChuckBotModel)}
        >
          {MODELS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <b className={server.running ? 'chuckbot-server-pill on' : 'chuckbot-server-pill'}>
          {server.running ? 'Servidor activo' : 'Servidor apagado'}
        </b>
      </header>
      <div className="workspace">
        <div className="chuckbot-topbar">
          <div className="chuckbot-ollama">
            <i className={ollama.running ? 'dot on' : 'dot'} aria-hidden="true" />
            <span>{ollama.running ? 'Ollama encendido' : 'Ollama apagado'}</span>
            <button
              type="button"
              className={ollama.running ? 'chuckbot-toggle off' : 'chuckbot-toggle on'}
              onClick={() => void toggleOllama()}
              disabled={ollamaPending || !server.running}
            >
              {ollamaPending ? 'Trabajando…' : ollama.running ? 'Apagar Ollama' : 'Encender Ollama'}
            </button>
          </div>
          {!server.running && (
            <button
              type="button"
              className="chuckbot-start-server"
              onClick={() => void startServer()}
            >
              Iniciar servidor
            </button>
          )}
        </div>

        {notice && <p className={`chuckbot-notice ${notice.tone}`}>{notice.text}</p>}

        <div className="chuckbot-chat" ref={chatsRef}>
          {messages.length === 0 && (
            <div className="chuckbot-empty">
              <strong>¿En qué te ayudo?</strong>
              <span>
                Chatea con los modelos de Ollama, adjunta archivos de un proyecto y pide un «archivo
                solución» para guardarlo y abrirlo en VS Code.
              </span>
            </div>
          )}
          {messages.map((message) => (
            <ChatMessageRow
              key={message.id}
              message={message}
              modelLabel={message.role === 'user' ? '' : modelLabel}
            />
          ))}
          {streaming && (
            <div className="chuckbot-message ai">
              <small className="chuckbot-message-label">AI — generando…</small>
            </div>
          )}
        </div>

        {solution && (
          <div className="chuckbot-solution">
            <header>
              <h4>Archivo solución</h4>
              <span>{solution.content.length.toLocaleString()} caracteres</span>
            </header>
            <div className="chuckbot-solution-row">
              <label>
                <span>Nombre del archivo</span>
                <input
                  value={solutionName}
                  onChange={(event) => setSolutionName(event.target.value)}
                  placeholder="solucion.txt"
                />
              </label>
              <button
                type="button"
                className="chuckbot-btn"
                onClick={() => void saveSolutionToProject()}
              >
                Guardar en proyecto…
              </button>
              <button
                type="button"
                className="chuckbot-btn primary"
                onClick={() => void sendToVsCode()}
              >
                Enviar a VS Code
              </button>
              {savedSolution && (
                <button
                  type="button"
                  className="chuckbot-btn ghost"
                  onClick={() => void window.tools.chuckbotRevealFile(savedSolution.path)}
                >
                  Ver en carpeta
                </button>
              )}
            </div>
            {savedSolution && (
              <small className="chuckbot-solution-path">{savedSolution.path}</small>
            )}
            <pre className="chuckbot-solution-preview">{solution.content}</pre>
          </div>
        )}

        <div className="chuckbot-composer">
          {attached.length > 0 && (
            <div className="chuckbot-files">
              {attached.map((file) => (
                <span className="chuckbot-file-chip" key={file.name}>
                  {file.name}
                  <button
                    type="button"
                    aria-label={`Quitar ${file.name}`}
                    onClick={() => setAttached((current) => current.filter((f) => f !== file))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="chuckbot-composer-toolbar">
            <label className="chuckbot-attach">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => void onFiles(event)}
              />
              📎 Adjuntar archivos
            </label>
            <label className="chuckbot-solution-toggle">
              <input
                type="checkbox"
                checked={mode === 'solution'}
                onChange={(event) => setMode(event.target.checked ? 'solution' : 'chat')}
              />
              Modo solución (proyecto)
            </label>
            <label className="chuckbot-vscode-port">
              Puerto VS Code
              <input
                type="number"
                min={1}
                max={65535}
                value={vscodePort}
                onChange={(event) => {
                  setVscodePort(event.target.value);
                  try {
                    localStorage.setItem(VSCODE_PORT_KEY, event.target.value);
                  } catch {
                    // localStorage no disponible
                  }
                }}
              />
            </label>
          </div>
          <textarea
            className="chuckbot-input"
            value={inputValue}
            placeholder={
              mode === 'solution'
                ? 'Describe el problema del proyecto… (Enter para enviar)'
                : 'Escribe tu mensaje… (Enter para enviar)'
            }
            rows={2}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="chuckbot-composer-actions">
            <small>Shift+Enter para nueva línea · Ctrl+Enter también envía</small>
            {streaming ? (
              <button type="button" className="chuckbot-btn danger" onClick={() => void cancel()}>
                Detener
              </button>
            ) : (
              <button
                type="button"
                className="chuckbot-btn primary"
                onClick={() => void send()}
                disabled={!inputValue.trim() || streaming}
              >
                Enviar ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
