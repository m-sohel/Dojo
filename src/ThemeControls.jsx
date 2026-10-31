import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getMode, getTheme, setTheme, toggleMode, THEMES } from './theme.js';

export function ThemeControls() {
  const [theme, setCurrentTheme] = useState(getTheme);
  const [mode, setCurrentMode] = useState(getMode);

  const chooseTheme = (nextTheme) => {
    setTheme(nextTheme);
    setCurrentTheme(nextTheme);
  };

  const changeMode = () => setCurrentMode(toggleMode());

  return (
    <>
      <div className="theme-picker" role="group" aria-label="Color theme">
        {THEMES.map((option) => (
          <button
            key={option}
            className="theme-dot"
            type="button"
            data-theme-option={option}
            aria-label={`Choose ${option} theme`}
            aria-pressed={theme === option}
            title={`${option[0].toUpperCase()}${option.slice(1)} theme`}
            onClick={() => chooseTheme(option)}
          />
        ))}
      </div>
      <button
        className="icon-button mode-toggle"
        type="button"
        title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
        aria-label={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
        onClick={changeMode}
      >
        {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </>
  );
}
