import { useEffect, useRef, useState } from 'react'
import { Bot, Send, X, Sparkles } from 'lucide-react'
import { api } from '../api/client'

// AI yordamchi — suzuvchi chat oynasi. Backend /api/assistant/chat orqali
// Claude bilan gaplashadi; ma'lumotlar tool orqali bazadan olinadi.
const SUGGESTIONS = [
  'Tizim qanday ishlaydi?',
  'Jadval tuzishga nima yetishmayapti?',
  "Dushanba 2-juftlikda bo'sh xonalar?",
]

export default function Assistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, open])

  const send = async (text) => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setError('')
    setInput('')
    const next = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setBusy(true)
    try {
      const r = await api('/assistant/chat', { method: 'POST', body: { messages: next } })
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }])
    } catch (e) {
      setError(e.message || 'Xatolik yuz berdi')
      setMessages(next.slice(0, -1))
      setInput(q)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Ochish tugmasi */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="AI yordamchi"
          className="fixed bottom-5 right-5 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-brand p-3.5 text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
        >
          <Bot size={24} />
        </button>
      )}

      {/* Chat oynasi */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[520px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#0d1526]">
          <div className="flex items-center justify-between border-b border-slate-200 bg-brand px-4 py-3 text-white dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Sparkles size={17} />
              <span className="text-sm font-semibold">AI yordamchi</span>
            </div>
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-white/20"><X size={16} /></button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-slate-500 dark:text-slate-400">
                  Salom! Men SmartJadval yordamchisiman — tizim haqida so'rang, muammoni ayting yoki jadval tuzishda yordam so'rang.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 transition hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${
                  m.role === 'user'
                    ? 'rounded-br-sm bg-brand text-white'
                    : 'rounded-bl-sm bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 dark:bg-slate-800">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                  </span>
                </div>
              </div>
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send() }}
            className="flex items-center gap-2 border-t border-slate-200 p-2.5 dark:border-slate-700"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Savolingizni yozing..."
              className="input flex-1 text-sm"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()} className="btn-primary p-2.5 disabled:opacity-50">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
