import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Editor from '@monaco-editor/react';
import {
  Check,
  ChevronDown,
  Code2,
  Download,
  Expand,
  Focus,
  Play,
  RotateCcw,
  Terminal,
  X,
} from 'lucide-react';
import { ThemeControls } from './ThemeControls.jsx';
import { runJava } from './runner.js';
import './themes.css';
import './styles.css';

const TEMPLATE = `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        // Write your solution here

    }
}`;

const CODE_KEY = 'dojo:java:code:v1';
const LAYOUT_KEY = 'dojo:layout:v1';
const FONT_SIZE_KEY = 'dojo:editor-font-size:v1';

function readStorage(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readFontSize() {
  const savedSize = Number(readStorage(FONT_SIZE_KEY, '14'));
  return Number.isFinite(savedSize) ? Math.min(28, Math.max(10, savedSize)) : 14;
}

function toMonacoColor(value) {
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) return value;

  const [red, green, blue, alpha = '1'] = rgba[1].split(',').map((part) => part.trim());
  const channels = [red, green, blue].map((channel) => (
    Number(channel).toString(16).padStart(2, '0')
  ));
  const opacity = Math.round(Number(alpha) * 255).toString(16).padStart(2, '0');
  return `#${channels.join('')}${alpha === '1' ? '' : opacity}`;
}

function syncMonacoTheme(monaco) {
  const styles = getComputedStyle(document.documentElement);
  const token = (name) => toMonacoColor(styles.getPropertyValue(name).trim());
  const colors = {
    'editor.background': token('--surface'),
    'editor.foreground': token('--text'),
    'editorGutter.background': token('--surface'),
    'editorLineNumber.foreground': token('--text-muted'),
    'editorLineNumber.activeForeground': token('--text'),
    'editor.lineHighlightBackground': token('--editor-line-highlight'),
    'editor.selectionBackground': token('--selection'),
    'editor.inactiveSelectionBackground': token('--selection'),
    'editorCursor.foreground': token('--accent'),
    'focusBorder': token('--accent'),
    'editorWidget.background': token('--surface'),
    'editorWidget.foreground': token('--text'),
    'editorWidget.border': token('--border'),
    'input.background': token('--surface-2'),
    'input.foreground': token('--text'),
    'input.border': token('--border'),
    'dropdown.background': token('--surface-2'),
    'dropdown.foreground': token('--text'),
    'list.activeSelectionBackground': token('--selection'),
    'list.activeSelectionForeground': token('--text'),
    'scrollbarSlider.background': token('--border'),
    'scrollbarSlider.hoverBackground': token('--text-muted'),
    'scrollbarSlider.activeBackground': token('--accent'),
  };
  const mode = document.documentElement.dataset.mode;

  monaco.editor.defineTheme('dojo-custom', {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: token('--text-muted').slice(1, 7) },
      { token: 'keyword', foreground: token('--accent').slice(1, 7) },
      { token: 'keyword.flow', foreground: token('--accent-hover').slice(1, 7) },
      { token: 'string', foreground: token('--success').slice(1, 7) },
      { token: 'number', foreground: token('--warning').slice(1, 7) },
      { token: 'type.identifier', foreground: token('--accent-hover').slice(1, 7) },
      { token: 'identifier', foreground: token('--text').slice(1, 7) },
      { token: 'delimiter', foreground: token('--text-muted').slice(1, 7) },
    ],
    colors,
  });
  monaco.editor.setTheme('dojo-custom');
}

function App() {
  const [code, setCode] = useState(() => readStorage(CODE_KEY, TEMPLATE));
  const [layout, setLayout] = useState(() => readStorage(LAYOUT_KEY, 'side'));
  const [stdin, setStdin] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState(readFontSize);
  const [runnerMode, setRunnerMode] = useState('checking');
  const [split, setSplit] = useState(58);
  const [saveAvailable, setSaveAvailable] = useState(true);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => (
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  ));
  const [installHint, setInstallHint] = useState('');
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const workspaceRef = useRef(null);

  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .catch((error) => console.error('Could not register the Dojo offline app shell:', error));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const checkRunner = async () => {
      try {
        const response = await fetch('/api/health');
        if (!response.ok) throw new Error(`Runner status returned HTTP ${response.status}.`);
        const health = await response.json();
        if (active) {
          setRunnerMode(
            health.runner === 'hosted'
              ? 'hosted'
              : health.runner === 'unconfigured'
                ? 'unconfigured'
                : 'local',
          );
        }
      } catch (error) {
        if (active) setRunnerMode('offline');
        console.error('Could not read Java runner status:', error);
      }
    };

    void checkRunner();
    const interval = window.setInterval(checkRunner, 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (monacoRef.current) syncMonacoTheme(monacoRef.current);
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleInstallAvailable = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstallHint('');
    };
    window.addEventListener('beforeinstallprompt', handleInstallAvailable);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallAvailable);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CODE_KEY, code);
    } catch {
      setSaveAvailable(false);
    }
  }, [code]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      setSaveAvailable(false);
    }
  }, [layout]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    } catch {
      setSaveAvailable(false);
    }
  }, [fontSize]);

  const handleRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await runJava(code, stdin));
    } catch (error) {
      const message = runnerMode === 'offline'
        ? 'The Java runner is offline. Start it with `npm run dev`, then try again.'
        : error instanceof Error ? error.message : 'Could not reach the Java runner.';
      setResult({
        status: 'request_error',
        stdout: '',
        stderr: message,
        executionTimeMs: 0,
      });
    } finally {
      setRunning(false);
    }
  }, [code, stdin, running, runnerMode]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleRun();
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
      if (event.key === 'Escape') {
        setFocusMode(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRun]);

  const dragSplit = (event) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    event.preventDefault();
    const bounds = workspace.getBoundingClientRect();
    const update = (pointerEvent) => {
      const ratio = layout === 'side'
        ? ((pointerEvent.clientX - bounds.left) / bounds.width) * 100
        : ((pointerEvent.clientY - bounds.top) / bounds.height) * 100;
      setSplit(Math.max(28, Math.min(72, ratio)));
    };
    const finish = () => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const resetCode = () => {
    setCode(TEMPLATE);
    setResult(null);
    setSettingsOpen(false);
    editorRef.current?.focus();
  };

  const downloadCode = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/x-java-source' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Main.java';
    link.click();
    URL.revokeObjectURL(url);
    setSettingsOpen(false);
  };

  const installApp = async () => {
    if (!installPrompt) {
      const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
      setInstallHint(isIos
        ? 'To install, tap Share in Safari, then choose “Add to Home Screen”.'
        : 'To install, choose “Install app” or “Add to Home screen” from your browser menu.');
      return;
    }

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (outcome === 'accepted') setInstalled(true);
  };

  const outputState = result?.status === 'success' ? 'success' : result ? 'error' : 'empty';
  const statusLabel = result?.status === 'success'
    ? 'Finished'
    : result?.status === 'compile_error'
      ? 'Compilation failed'
      : result?.status === 'timeout' || result?.status === 'compile_timeout'
        ? 'Timed out'
        : result?.status === 'runner_timeout'
          ? 'Runner timed out'
        : result?.status === 'output_limit'
          ? 'Output limit reached'
          : result
            ? 'Runtime error'
            : 'Ready when you are';

  return (
    <main className={`app-shell ${focusMode ? 'focus-mode' : ''}`} data-layout={layout}>
      {!focusMode && (
        <header className="topbar">
          <div className="brand-group">
            <div className="brand-mark"><Code2 size={17} strokeWidth={2.1} /></div>
            <span className="brand-name">dojo</span>
            <span className="brand-divider" />
            <span className="workspace-label">Java workspace</span>
          </div>

          <div className="toolbar">
            <span className={`local-indicator ${runnerMode}`}>
              <span />
              {runnerMode === 'checking'
                ? 'Connecting'
                : runnerMode === 'hosted'
                  ? 'Hosted'
                  : runnerMode === 'offline'
                    ? 'Offline'
                    : runnerMode === 'unconfigured'
                      ? 'Setup needed'
                      : 'Local'}
            </span>
            <button
              className="icon-button layout-button"
              type="button"
              title={layout === 'side' ? 'Stack panes vertically' : 'Arrange panes side by side'}
              aria-label={layout === 'side' ? 'Stack panes vertically' : 'Arrange panes side by side'}
              onClick={() => setLayout((value) => value === 'side' ? 'stack' : 'side')}
            >
              <Expand size={16} />
            </button>
            <ThemeControls />
            {!installed && (
              <button
                className="install-button"
                type="button"
                onClick={installApp}
                title="Install Dojo on this device"
              >
                <Download size={14} />
                <span>Install</span>
              </button>
            )}
            <div className="settings-wrap">
              <button
                className={`settings-button ${settingsOpen ? 'is-open' : ''}`}
                type="button"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((value) => !value)}
              >
                Settings <ChevronDown size={14} />
              </button>
              {settingsOpen && (
                <div className="settings-menu">
                  <div className="settings-heading">Editor</div>
                  <div className="font-setting">
                    <span>Font size <small>Ctrl + scroll in editor</small></span>
                    <div className="font-controls">
                      <button type="button" aria-label="Decrease font size" onClick={() => setFontSize((n) => Math.max(10, n - 1))}>−</button>
                      <span>{fontSize}</span>
                      <button type="button" aria-label="Increase font size" onClick={() => setFontSize((n) => Math.min(28, n + 1))}>+</button>
                    </div>
                  </div>
                  <button className="menu-item" type="button" onClick={downloadCode}><Download size={15} /> Download Main.java</button>
                  <button className="menu-item reset-item" type="button" onClick={resetCode}><RotateCcw size={15} /> Reset to template</button>
                </div>
              )}
            </div>
            <button
              className="run-button"
              type="button"
              onClick={handleRun}
              disabled={running}
              title="Run code (Ctrl/Cmd + Enter)"
            >
              <Play size={14} fill="currentColor" />
              {running ? 'Running…' : 'Run'}
              <span className="shortcut-hint">⌘ ↵</span>
            </button>
          </div>
        </header>
      )}

      <section
        className="workspace"
        data-layout={layout}
        ref={workspaceRef}
        style={{ '--split': `${split}%` }}
      >
        <section className="pane editor-pane">
          <div className="pane-header">
            <div className="pane-title"><span className="java-file-icon">J</span><span>Main.java</span></div>
            <span className="pane-meta">Java 17+</span>
          </div>
          <div className="editor-surface">
            <Editor
              height="100%"
              language="java"
              value={code}
              onChange={(value) => setCode(value ?? '')}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                syncMonacoTheme(monaco);
                editor.onDidChangeConfiguration((event) => {
                  if (event.hasChanged(monaco.editor.EditorOption.fontSize)) {
                    const nextFontSize = Math.min(
                      28,
                      Math.max(10, editor.getOption(monaco.editor.EditorOption.fontSize)),
                    );
                    if (nextFontSize !== editor.getOption(monaco.editor.EditorOption.fontSize)) {
                      editor.updateOptions({ fontSize: nextFontSize });
                    }
                    setFontSize(nextFontSize);
                  }
                });
              }}
              theme="dojo-custom"
              options={{
                automaticLayout: true,
                minimap: { enabled: false },
                fontFamily: 'var(--font-code)',
                fontSize,
                fontLigatures: true,
                mouseWheelZoom: true,
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                glyphMargin: false,
                folding: true,
                scrollBeyondLastLine: false,
                tabSize: 4,
                insertSpaces: true,
                autoIndent: 'full',
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                bracketPairColorization: { enabled: true },
                padding: { top: 16, bottom: 20 },
                renderLineHighlight: 'gutter',
                smoothScrolling: true,
                cursorSmoothCaretAnimation: 'on',
                wordWrap: 'off',
                contextmenu: true,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              }}
            />
          </div>
          <div className="editor-footer">
            <span><span className="save-dot" /> {saveAvailable ? 'Saved locally' : 'Local save unavailable'}</span>
            <span>UTF-8 <i /> Java</span>
          </div>
        </section>

        <button
          className="splitter"
          type="button"
          aria-label="Resize editor and panels"
          onPointerDown={dragSplit}
          title="Drag to resize"
        />

        <section className="right-pane">
          <section className="pane input-pane">
            <div className="pane-header">
              <div className="pane-title"><Terminal size={15} /><span>Input</span></div>
              <span className="pane-meta">stdin</span>
            </div>
            <textarea
              className="stdin-editor"
              value={stdin}
              onChange={(event) => setStdin(event.target.value)}
              spellCheck="false"
              aria-label="Standard input"
              placeholder={'Enter input for your program…\nEach line is passed to stdin.'}
            />
            <div className="panel-footer"><span>Standard input</span><span>{stdin.length} chars</span></div>
          </section>

          <section className={`pane output-pane ${outputState}`}>
            <div className="pane-header">
              <div className="pane-title"><Terminal size={15} /><span>Output</span></div>
              <div className="output-header-meta">
                {result && result.status !== 'request_error' && (
                  <span className={`exit-badge ${result.status === 'success' ? 'ok' : 'failed'}`}>
                    {result.status === 'success' ? <Check size={11} /> : <X size={11} />}
                    {result.status === 'success' ? 'Exit 0' : `Exit ${result.exitCode ?? '—'}`}
                  </span>
                )}
              </div>
            </div>
            <div className="output-content" aria-live="polite">
              {result ? (
                <div className="result-content">
                  {result.stdout && <pre className="stdout">{result.stdout}</pre>}
                  {result.stderr && <pre className="stderr">{result.stderr}</pre>}
                  {!result.stdout && !result.stderr && result.status === 'success' && (
                    <span className="empty-output">Program finished with no output.</span>
                  )}
                  {!result.stdout && !result.stderr && result.status !== 'success' && (
                    <span className="empty-output">The program did not produce output.</span>
                  )}
                </div>
              ) : (
                <div className="output-placeholder">
                  <div className="output-placeholder-icon"><Play size={14} /></div>
                  <span>Your output will appear here</span>
                  <span className="output-hint">Run your code to see the result</span>
                </div>
              )}
            </div>
            <div className="panel-footer">
              <span className={`run-state ${outputState}`}><span />{statusLabel}</span>
              {result && <span>{result.executionTimeMs} ms</span>}
            </div>
          </section>
        </section>
      </section>

      {focusMode && (
        <div className="focus-toolbar">
          <span className="focus-brand"><Code2 size={15} /> dojo</span>
          <button type="button" className="run-button" onClick={handleRun} disabled={running}>
            <Play size={14} fill="currentColor" />{running ? 'Running…' : 'Run'}
          </button>
          <button type="button" className="icon-button" aria-label="Exit focus mode" title="Exit focus mode (Esc)" onClick={() => setFocusMode(false)}>
            <Focus size={16} />
          </button>
        </div>
      )}
      {!focusMode && (
        <button
          className="focus-toggle"
          type="button"
          onClick={() => setFocusMode(true)}
          title="Focus mode (Ctrl/Cmd + Shift + F)"
          aria-label="Enter focus mode"
        >
          <Focus size={14} />
        </button>
      )}
      {installHint && (
        <div className="install-hint" role="status">
          <span>{installHint}</span>
          <button type="button" aria-label="Dismiss install instructions" onClick={() => setInstallHint('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {settingsOpen && <button className="menu-dismiss" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />}
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
