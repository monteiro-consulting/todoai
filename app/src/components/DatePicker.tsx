import { useState, useRef, useEffect } from "react";

interface Props {
  value: string; // ISO string or ""
  onChange: (value: string) => void;
  placeholder?: string;
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function startDay(year: number, month: number) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(d: Date) {
  return isSameDay(d, new Date());
}

export default function DatePicker({ value, onChange, placeholder = "No due date" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? new Date(value) : null;
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? new Date().getMonth());
  const [hours, setHours] = useState(selected ? pad(selected.getHours()) : "09");
  const [minutes, setMinutes] = useState(selected ? pad(selected.getMinutes()) : "00");

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setHours(pad(d.getHours()));
      setMinutes(pad(d.getMinutes()));
    }
  }, [value]);

  const days = daysInMonth(viewYear, viewMonth);
  const offset = startDay(viewYear, viewMonth);

  const handleSelectDay = (day: number) => {
    const h = parseInt(hours) || 9;
    const m = parseInt(minutes) || 0;
    const d = new Date(viewYear, viewMonth, day, h, m);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
    onChange(iso);
  };

  const handleTimeChange = (newH: string, newM: string) => {
    setHours(newH);
    setMinutes(newM);
    if (selected) {
      const h = parseInt(newH) || 0;
      const m = parseInt(newM) || 0;
      const d = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), h, m);
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
      onChange(iso);
    }
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const displayText = selected
    ? `${selected.getDate()} ${MONTHS[selected.getMonth()].slice(0, 3)} ${selected.getFullYear()} ${pad(selected.getHours())}:${pad(selected.getMinutes())}`
    : placeholder;

  const today = new Date();

  return (
    <div className="datepicker-wrapper" ref={ref}>
      <div className={`datepicker-trigger ${selected ? "" : "placeholder"}`} onClick={() => setOpen(!open)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span>{displayText}</span>
        {selected && (
          <span
            className="datepicker-clear"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
          >
            &times;
          </span>
        )}
      </div>

      {open && (
        <div className="datepicker-dropdown">
          <div className="datepicker-header">
            <button type="button" onClick={prevMonth}>&lsaquo;</button>
            <span className="datepicker-month-label">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth}>&rsaquo;</button>
          </div>

          <div className="datepicker-days-header">
            {DAYS.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="datepicker-grid">
            {Array.from({ length: offset }).map((_, i) => (
              <span key={`e-${i}`} />
            ))}
            {Array.from({ length: days }).map((_, i) => {
              const day = i + 1;
              const cellDate = new Date(viewYear, viewMonth, day);
              const isSelected = selected && isSameDay(cellDate, selected);
              const isTodayCell = isToday(cellDate);
              const isPast = cellDate < today && !isTodayCell;
              return (
                <span
                  key={day}
                  className={`datepicker-day ${isSelected ? "selected" : ""} ${isTodayCell ? "today" : ""} ${isPast ? "past" : ""}`}
                  onClick={() => handleSelectDay(day)}
                >
                  {day}
                </span>
              );
            })}
          </div>

          <div className="datepicker-time">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <input
              type="text"
              className="datepicker-time-input"
              value={hours}
              onChange={(e) => handleTimeChange(e.target.value.replace(/\D/g, "").slice(0, 2), minutes)}
              onBlur={() => setHours(pad(Math.min(23, Math.max(0, parseInt(hours) || 0))))}
            />
            <span className="datepicker-time-sep">:</span>
            <input
              type="text"
              className="datepicker-time-input"
              value={minutes}
              onChange={(e) => handleTimeChange(hours, e.target.value.replace(/\D/g, "").slice(0, 2))}
              onBlur={() => setMinutes(pad(Math.min(59, Math.max(0, parseInt(minutes) || 0))))}
            />
          </div>

          <div className="datepicker-shortcuts">
            <button type="button" onClick={() => { const t = new Date(); handleSelectDay(t.getDate()); setViewMonth(t.getMonth()); setViewYear(t.getFullYear()); }}>Today</button>
            <button type="button" onClick={() => { const t = new Date(); t.setDate(t.getDate() + 1); setViewMonth(t.getMonth()); setViewYear(t.getFullYear()); handleSelectDay(t.getDate()); }}>Tomorrow</button>
            <button type="button" onClick={() => { const t = new Date(); t.setDate(t.getDate() + 7); setViewMonth(t.getMonth()); setViewYear(t.getFullYear()); handleSelectDay(t.getDate()); }}>In 1 week</button>
          </div>
        </div>
      )}
    </div>
  );
}
