import { useRef, useEffect, useState } from 'react'
import './App.css'

const initialSentence = 'This is an example sentence.'
const cardsStorageKey = 'send-to-anki-cards'

type SavedCard = {
  id: string
  sentence: string
  targetWord: string
  createdAt: string
  meaning?: string
  explanation?: string
  exportedAt?: string | null
}

type TranslationResult = {
  meaning: string
  explanation: string
}

type BackupData = {
  app: string
  version: number
  createdAt: string
  cards: SavedCard[]
  duplicateDetection: {
    normalizedPairs: Array<{
      sentence: string
      targetWord: string
    }>
  }
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function getTranslationKey(targetWord: string) {
  return normalizeValue(targetWord)
}

function escapeCsvValue(value: string | number | null | undefined) {
  const textValue = String(value ?? '')

  return `"${textValue.replace(/"/g, '""')}"`
}

function highlightTargetWord(sentence: string, targetWord: string) {
  return sentence.replace(targetWord, (match) => `<b>${match}</b>`)
}

function splitTextIntoSentences(text: string) {
  const textParts = text.split('.')
  const textEndsWithPeriod = text.trim().endsWith('.')

  return textParts
    .map((part, index) => {
      const sentencePart = part.trim()
      const isLastPart = index === textParts.length - 1
      const shouldKeepPeriod = !isLastPart || textEndsWithPeriod

      if (!sentencePart) {
        return ''
      }

      return shouldKeepPeriod ? `${sentencePart}.` : sentencePart
    })
    .filter(Boolean)
}

function isValidBackupCard(card: unknown): card is SavedCard {
  if (!card || typeof card !== 'object') {
    return false
  }

  const possibleCard = card as SavedCard

  return (
    typeof possibleCard.id === 'string' &&
    typeof possibleCard.sentence === 'string' &&
    typeof possibleCard.targetWord === 'string' &&
    typeof possibleCard.createdAt === 'string'
  )
}

function App() {
  const backupInputRef = useRef<HTMLInputElement>(null)
  const [sentence, setSentence] = useState(initialSentence)
  const [sentences, setSentences] = useState<string[]>([])
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0)
  const [selectedWords, setSelectedWords] = useState<string[]>([])
  const [clipboardError, setClipboardError] = useState('')
  const [cardError, setCardError] = useState('')
  const [exportError, setExportError] = useState('')
  const [backupError, setBackupError] = useState('')
  const [translationError, setTranslationError] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [translations, setTranslations] = useState<
    Record<string, TranslationResult>
  >({})
  const [cards, setCards] = useState<SavedCard[]>([])
  const [cardsLoaded, setCardsLoaded] = useState(false)

  const words = sentence.trim().split(/\s+/).filter(Boolean)
  const isMultiSentenceFlow = sentences.length > 1
  const hasNextSentence = currentSentenceIndex < sentences.length - 1

  useEffect(() => {
    const savedCards = localStorage.getItem(cardsStorageKey)

    if (!savedCards) {
      setCardsLoaded(true)
      return
    }

    try {
      const parsedCards = JSON.parse(savedCards)

      if (Array.isArray(parsedCards)) {
        setCards(
          (parsedCards as SavedCard[]).map((card) => ({
            ...card,
            exportedAt: card.exportedAt ?? null,
          })),
        )
      }
    } catch {
      localStorage.removeItem(cardsStorageKey)
    }

    setCardsLoaded(true)
  }, [])

  useEffect(() => {
    if (!cardsLoaded) {
      return
    }

    localStorage.setItem(cardsStorageKey, JSON.stringify(cards))
  }, [cards, cardsLoaded])

  function resetSentenceWork(nextSentence: string) {
    setSentence(nextSentence)
    setSelectedWords([])
    setClipboardError('')
    setCardError('')
    setExportError('')
    setBackupError('')
    setTranslationError('')
    setTranslations({})
  }

  function updateSentence(nextSentence: string) {
    setSentences([])
    setCurrentSentenceIndex(0)
    resetSentenceWork(nextSentence)
  }

  function moveToSentence(nextIndex: number) {
    if (nextIndex >= sentences.length) {
      setSentences([])
      setCurrentSentenceIndex(0)
      return
    }

    setCurrentSentenceIndex(nextIndex)
    resetSentenceWork(sentences[nextIndex])
  }

  function stopSentenceFlow() {
    setSentences([])
    setCurrentSentenceIndex(0)
  }

  function selectWord(word: string) {
    setSelectedWords((currentWords) =>
      currentWords.includes(word)
        ? currentWords.filter((currentWord) => currentWord !== word)
        : [...currentWords, word],
    )
    setCardError('')
    setExportError('')
    setBackupError('')
    setTranslationError('')
    setTranslations({})
  }

  async function pasteFromClipboard() {
    setClipboardError('')

    try {
      const clipboardText = await navigator.clipboard.readText()
      const nextSentence = clipboardText.trim()

      if (!nextSentence) {
        setClipboardError('Die Zwischenablage ist leer.')
        return
      }

      const pastedSentences = splitTextIntoSentences(nextSentence)

      if (pastedSentences.length > 1) {
        setSentences(pastedSentences)
        setCurrentSentenceIndex(0)
        resetSentenceWork(pastedSentences[0])
        return
      }

      updateSentence(nextSentence)
    } catch {
      setClipboardError('Zwischenablage konnte nicht gelesen werden.')
    }
  }

  async function generateMeaning() {
    const cleanedSentence = sentence.trim()
    const cleanedTargetWords = selectedWords
      .map((word) => word.trim())
      .filter(Boolean)

    setTranslationError('')
    setCardError('')

    if (!cleanedSentence) {
      setTranslations({})
      setTranslationError('Der Satz darf nicht leer sein.')
      return
    }

    if (cleanedTargetWords.length === 0) {
      setTranslations({})
      setTranslationError('Bitte w\u00e4hle mindestens ein Zielwort aus.')
      return
    }

    setIsGenerating(true)

    try {
      const nextTranslations: Record<string, TranslationResult> = {
        ...translations,
      }
      const failedWords: string[] = []

      for (const targetWord of cleanedTargetWords) {
        try {
          const response = await fetch('https://kindle-to-anki-api.insafhamzu24.workers.dev/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sentence: cleanedSentence,
              targetWord,
            }),
          })

          const data = await response.json()

          if (!response.ok) {
            failedWords.push(targetWord)
            continue
          }

          nextTranslations[getTranslationKey(targetWord)] = {
            meaning: data.meaning,
            explanation: data.explanation,
          }
        } catch {
          failedWords.push(targetWord)
        }
      }

      setTranslations(nextTranslations)

      if (failedWords.length > 0) {
        setTranslationError(
          `Keine Bedeutung generiert f\u00fcr: ${failedWords.join(', ')}`,
        )
      }
    } finally {
      setIsGenerating(false)
    }
  }

  function saveCard() {
    const cleanedSentence = sentence.trim()
    const cleanedTargetWords = selectedWords
      .map((word) => word.trim())
      .filter(Boolean)

    if (!cleanedSentence) {
      setCardError('Der Satz darf nicht leer sein.')
      return
    }

    if (cleanedTargetWords.length === 0) {
      setCardError('Bitte w\u00e4hle mindestens ein Zielwort aus.')
      return
    }

    const missingTranslation = cleanedTargetWords.some((targetWord) => {
      const translation = translations[getTranslationKey(targetWord)]

      return !translation?.meaning
    })

    if (missingTranslation) {
      setCardError(
        'Bitte f\u00fcr alle ausgew\u00e4hlten W\u00f6rter zuerst eine Bedeutung generieren.',
      )
      return
    }

    const normalizedSentence = normalizeValue(cleanedSentence)
    const duplicateTargetWord = cleanedTargetWords.find((targetWord) => {
      const normalizedTargetWord = normalizeValue(targetWord)

      return cards.some((card) => {
        const existingSentence = normalizeValue(card.sentence)
        const existingTargetWord = normalizeValue(card.targetWord)

        return (
          normalizedSentence === existingSentence &&
          normalizedTargetWord === existingTargetWord
        )
      })
    })

    if (duplicateTargetWord) {
      setCardError(
        `You already saved '${duplicateTargetWord}' in this sentence.`,
      )
      return
    }

    const createdAt = new Date().toISOString()
    const newCards: SavedCard[] = cleanedTargetWords.map((targetWord, index) => ({
      id: `${Date.now()}-${index}`,
      sentence: cleanedSentence,
      targetWord,
      meaning: translations[getTranslationKey(targetWord)].meaning,
      explanation: translations[getTranslationKey(targetWord)].explanation,
      createdAt,
      exportedAt: null,
    }))

    setCards((currentCards) => [...newCards, ...currentCards])
    setCardError('')
  }

  function exportNewCardsAsCsv() {
    const newCards = cards.filter((card) => card.exportedAt === null)

    setExportError('')

    if (newCards.length === 0) {
      setExportError('Keine neuen Karten zum Exportieren.')
      return
    }

    const csvHeader = [
      'CardId',
      'Sentence',
      'Target',
      'Meaning',
      'Explanation',
      'Source',
    ]
    const csvRows = newCards.map((card) =>
      [
        card.id,
        highlightTargetWord(card.sentence, card.targetWord),
        card.targetWord,
        card.meaning || '',
        card.explanation || '',
        'Kindle',
      ]
        .map(escapeCsvValue)
        .join(','),
    )
    const csvContent = [
      csvHeader.map(escapeCsvValue).join(','),
      ...csvRows,
    ].join('\r\n')
    const today = new Date().toISOString().slice(0, 10)
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8',
    })
    const downloadUrl = URL.createObjectURL(blob)
    const downloadLink = document.createElement('a')

    downloadLink.href = downloadUrl
    downloadLink.download = `kindle-to-anki-export-${today}.csv`
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    URL.revokeObjectURL(downloadUrl)

    const exportedAt = new Date().toISOString()
    const exportedIds = new Set(newCards.map((card) => card.id))

    setCards((currentCards) =>
      currentCards.map((card) =>
        exportedIds.has(card.id) ? { ...card, exportedAt } : card,
      ),
    )
  }

  function exportBackup() {
    const today = new Date().toISOString().slice(0, 10)
    const backupData: BackupData = {
      app: 'kindle-to-anki',
      version: 1,
      createdAt: new Date().toISOString(),
      cards,
      duplicateDetection: {
        normalizedPairs: cards.map((card) => ({
          sentence: normalizeValue(card.sentence),
          targetWord: normalizeValue(card.targetWord),
        })),
      },
    }
    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const downloadUrl = URL.createObjectURL(blob)
    const downloadLink = document.createElement('a')

    downloadLink.href = downloadUrl
    downloadLink.download = `kindle-to-anki-backup-${today}.json`
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    URL.revokeObjectURL(downloadUrl)
    setBackupError('')
  }

  function openBackupImport() {
    backupInputRef.current?.click()
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const backupFile = event.target.files?.[0]

    if (!backupFile) {
      return
    }

    try {
      const backupText = await backupFile.text()
      const parsedBackup = JSON.parse(backupText)

      if (
        !parsedBackup ||
        typeof parsedBackup !== 'object' ||
        !Array.isArray(parsedBackup.cards) ||
        !parsedBackup.cards.every(isValidBackupCard)
      ) {
        throw new Error('Invalid backup')
      }

      const importedCards = parsedBackup.cards.map((card: SavedCard) => ({
        ...card,
        exportedAt: card.exportedAt ?? null,
      }))

      setCards(importedCards)
      localStorage.setItem(cardsStorageKey, JSON.stringify(importedCards))
      setCardsLoaded(true)
      setBackupError('')
    } catch {
      setBackupError('Backup konnte nicht importiert werden. Bitte w\u00e4hle eine g\u00fcltige JSON-Datei.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="app-shell">
      <section className="overlay-panel" aria-label="Send to Anki word picker">
        <header className="app-header">
          <p className="app-kicker">Kindle overlay</p>
          <h1>Send to Anki</h1>
        </header>

        <section className="sentence-card" aria-label="Sentence">
          <label className="input-label" htmlFor="sentence-input">
            Satz
          </label>
          <textarea
            className="sentence-input"
            id="sentence-input"
            value={sentence}
            onChange={(event) => updateSentence(event.target.value)}
            rows={5}
          />
          <button
            className="clipboard-button"
            type="button"
            onClick={pasteFromClipboard}
            disabled={isGenerating}
          >
            {'Aus Zwischenablage einf\u00fcgen'}
          </button>
          {clipboardError ? (
            <p className="error-message" role="alert">
              {clipboardError}
            </p>
          ) : null}
          {isMultiSentenceFlow ? (
            <>
              <p className="empty-state">
                Sentence {currentSentenceIndex + 1} of {sentences.length}
              </p>
              <button
                className="export-button"
                type="button"
                onClick={() => moveToSentence(currentSentenceIndex + 1)}
                disabled={!hasNextSentence || isGenerating}
              >
                Next sentence
              </button>
              <button
                className="export-button"
                type="button"
                onClick={() => moveToSentence(currentSentenceIndex + 1)}
                disabled={!hasNextSentence || isGenerating}
              >
                Skip sentence
              </button>
              <button
                className="save-button"
                type="button"
                onClick={stopSentenceFlow}
                disabled={isGenerating}
              >
                Stop
              </button>
            </>
          ) : null}

          <div className="word-list" aria-label="Selectable words">
            {words.map((word, index) => {
              const isSelected = selectedWords.includes(word)

              return (
                <button
                  className={`word-chip${isSelected ? ' selected' : ''}`}
                  key={`${word}-${index}`}
                  type="button"
                  onClick={() => selectWord(word)}
                  aria-pressed={isSelected}
                  disabled={isGenerating}
                >
                  {word}
                </button>
              )
            })}
          </div>
        </section>

        <section className="selected-panel" aria-label="Selected word">
          <p className="panel-label">{'Ausgew\u00e4hltes Wort'}</p>
          <p className="selected-word">
            {selectedWords.length > 0
              ? selectedWords.join(', ')
              : 'Noch kein Wort ausgew\u00e4hlt'}
          </p>
          {selectedWords.length > 0 ? (
            <button
              className="generate-button"
              type="button"
              onClick={generateMeaning}
              disabled={isGenerating}
            >
              {isGenerating
                ? 'Generating...'
                : selectedWords.length === 1
                  ? 'Generate'
                  : 'Generate all'}
            </button>
          ) : null}
          {translationError ? (
            <p className="error-message" role="alert">
              {translationError}
            </p>
          ) : null}
        </section>

        <section className="result-panel" aria-label="Translation result">
          <p className="panel-label">KI-Ergebnis</p>
          {Object.keys(translations).length > 0 ? (
            <div className="result-content">
              {selectedWords.map((targetWord) => {
                const translation = translations[getTranslationKey(targetWord)]

                if (!translation) {
                  return null
                }

                return (
                  <div key={targetWord}>
                    <p className="result-meaning">{targetWord}</p>
                    <p className="result-explanation">{translation.meaning}</p>
                    <p className="result-explanation">
                      {translation.explanation}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="empty-state">Noch keine Bedeutung generiert.</p>
          )}
        </section>

        <section className="selected-panel" aria-label="Save card">
          <p className="panel-label">Karte</p>
          <button
            className="save-button"
            type="button"
            onClick={saveCard}
            disabled={isGenerating}
          >
            Karte speichern
          </button>
          {cardError ? (
            <p className="error-message" role="alert">
              {cardError}
            </p>
          ) : null}
        </section>

        <section className="cards-panel" aria-label="Saved cards">
          <div className="cards-header">
            <p className="panel-label">Gespeicherte Karten</p>
            <span className="card-count">{cards.length}</span>
          </div>
          <button
            className="export-button"
            type="button"
            onClick={exportNewCardsAsCsv}
          >
            Neue Karten als CSV exportieren
          </button>
          <button className="export-button" type="button" onClick={exportBackup}>
            Export Backup
          </button>
          <button
            className="export-button"
            type="button"
            onClick={openBackupImport}
          >
            Import Backup
          </button>
          <input
            ref={backupInputRef}
            className="backup-input"
            type="file"
            accept="application/json,.json"
            onChange={importBackup}
          />
          {exportError ? (
            <p className="error-message" role="alert">
              {exportError}
            </p>
          ) : null}
          {backupError ? (
            <p className="error-message" role="alert">
              {backupError}
            </p>
          ) : null}
          {cards.length > 0 ? (
            <ul className="card-list">
              {cards.map((card) => (
                <li className="saved-card" key={card.id}>
                  <div className="card-title-row">
                    <p className="card-word">{card.targetWord}</p>
                    <span
                      className={`export-status${
                        card.exportedAt ? ' exported' : ''
                      }`}
                    >
                      {card.exportedAt ? 'Exportiert' : 'Neu'}
                    </span>
                  </div>
                  {card.meaning ? (
                    <p className="card-meaning">{card.meaning}</p>
                  ) : null}
                  <p className="card-sentence">{card.sentence}</p>
                  {card.explanation ? (
                    <p className="card-explanation">{card.explanation}</p>
                  ) : null}
                  <time className="card-date" dateTime={card.createdAt}>
                    {new Date(card.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Noch keine Karten gespeichert.</p>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
