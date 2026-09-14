import { Worker } from 'worker_threads'

// Generatsiya ishini worker threadda ishga tushiradi (bloklamasdan).
export function startGenerateJob({ runId, semester, maxMs, groupStartPairs }) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: { runId, semester, maxMs, groupStartPairs },
  })
  worker.on('message', (m) => console.log('[job]', JSON.stringify(m)))
  worker.on('error', (e) => console.error('[job:error]', e))
  worker.on('exit', (code) => { if (code !== 0) console.error(`[job] worker exit ${code}`) })
  worker.unref() // jarayonni faqat shu worker uchun tirik ushlab turmasin
}
