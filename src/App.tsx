import { useRef, useEffect, useState } from 'react'
import './App.css'

const initialSentence = 'This is an example sentence.'
const cardsStorageKey = 'send-to-anki-cards'
const lastBackupStorageKey = 'send-to-anki-last-backup-at'
const translationApiUrl = 'https://kindle-to-anki-api.insafhamzu24.workers.dev/'
const backupReminderCardCount = 50
const recentBackupDays = 7
const phraseSuggestionPatterns = [
  /\blook(?:s|ed|ing)?\s+forward\s+to\b/gi,
  /\bgive(?:s|n|ing)?\s+up\b|\bgave\s+up\b/gi,
  /\bturn(?:s|ed|ing)?\s+out\b/gi,
  /\brun(?:s|ning)?\s+into\b|\bran\s+into\b/gi,
  /\bcome(?:s|ing)?\s+across\b|\bcame\s+across\b/gi,
  /\bfind(?:s|ing)?\s+out\b|\bfound\s+out\b/gi,
  /\btake(?:s|n|ing)?\s+off\b|\btook\s+off\b/gi,
  /\bput(?:s|ting)?\s+up\s+with\b/gi,
  /\bget(?:s|ting)?\s+along\b|\bgot\s+along\b/gi,
  /\blook(?:s|ed|ing)?\s+after\b/gi,
  /\bin\s+order\s+to\b/gi,
  /\bas\s+soon\s+as\b/gi,
  /\beven\s+though\b/gi,
]
const allowedLanguageStyles = [
  'simple',
  'everyday',
  'formal',
  'informal',
  'slang',
  'business',
  'academic',
  'literary',
  'advanced',
]

type SavedCard = {
  id: string
  sentence: string
  targetWord: string
  createdAt: string
  meaning?: string
  explanation?: string
  source?: string
  tags?: string
  languageStyle?: string
  quality?: CardQuality
  exportedAt?: string | null
}

type TranslationResult = {
  meaning: string
  explanation: string
  languageStyle?: string
}

type CardStatusFilter = 'all' | 'new' | 'exported'
type CardSearchMode = 'target' | 'everywhere'
type CsvExportMode = 'new' | 'all' | 'selected'
type CardQuality = 'good' | 'needs edit' | 'hard' | 'important'

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

function normalizeTags(value: string) {
  return value.trim().replace(/[,\s]+/g, ' ')
}

function escapeCsvValue(value: string | number | null | undefined) {
  const textValue = String(value ?? '')

  return `"${textValue.replace(/"/g, '""')}"`
}

function highlightTargetWord(sentence: string, targetWord: string) {
  return sentence.replace(targetWord, (match) => `<b>${match}</b>`)
}

function highlightSearchText(value: string, searchText: string) {
  const cleanedSearch = searchText.trim()

  if (!cleanedSearch) {
    return value
  }

  const lowerValue = value.toLowerCase()
  const lowerSearch = cleanedSearch.toLowerCase()
  const parts = []
  let currentIndex = 0
  let matchIndex = lowerValue.indexOf(lowerSearch)

  while (matchIndex !== -1) {
    if (matchIndex > currentIndex) {
      parts.push(value.slice(currentIndex, matchIndex))
    }

    parts.push(
      <mark className="search-highlight" key={`${matchIndex}-${parts.length}`}>
        {value.slice(matchIndex, matchIndex + cleanedSearch.length)}
      </mark>,
    )

    currentIndex = matchIndex + cleanedSearch.length
    matchIndex = lowerValue.indexOf(lowerSearch, currentIndex)
  }

  if (currentIndex < value.length) {
    parts.push(value.slice(currentIndex))
  }

  return parts
}

function splitTextIntoSentences(text: string) {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [])
    .map((sentencePart) => sentencePart.trim())
    .filter(Boolean)
}

function findLocalPhraseSuggestions(sentence: string) {
  const foundPhrases = phraseSuggestionPatterns.flatMap((pattern) => {
    const matches = sentence.match(pattern) || []

    return matches.map((match) => match.trim())
  })

  return Array.from(new Set(foundPhrases))
}

function inferLanguageStyle(targetWord: string, sentence: string) {
  const normalizedText = normalizeValue(`${targetWord} ${sentence}`)

  if (/\b(kinda|gonna|wanna|ain't|dude|yep|nah)\b/.test(normalizedText)) {
    return 'slang'
  }

  if (/\b(cool|okay|ok|pretty much|hang out)\b/.test(normalizedText)) {
    return 'informal'
  }

  if (/\b(revenue|profit|market|company|growth|strategy|customer|sustainable growth)\b/.test(normalizedText)) {
    return 'business'
  }

  if (/\b(research|theory|analysis|hypothesis|method|evidence|emphasized|significant)\b/.test(normalizedText)) {
    return 'academic'
  }

  if (/\b(thou|whilst|upon|beneath|amid|overcame|gazed|whispered)\b/.test(normalizedText)) {
    return 'literary'
  }

  if (/\b(hence|therefore|moreover|subsequently|nevertheless|emphasized)\b/.test(normalizedText)) {
    return 'formal'
  }

  if (targetWord.length > 9 || targetWord.split(/\s+/).length > 2) {
    return 'advanced'
  }

  return 'everyday'
}

function cleanLanguageStyle(
  value: string | undefined,
  targetWord: string,
  sentence: string,
) {
  const normalizedStyle = normalizeValue(value || '')

  if (
    normalizedStyle &&
    normalizedStyle !== 'simple' &&
    allowedLanguageStyles.includes(normalizedStyle)
  ) {
    return normalizedStyle
  }

  return inferLanguageStyle(targetWord, sentence)
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
  const lastClipboardPromptRef = useRef('')
  const [sentence, setSentence] = useState(initialSentence)
  const [sessionSource, setSessionSource] = useState('Kindle')
  const [sessionTags, setSessionTags] = useState('')
  const [sessionQuality, setSessionQuality] = useState<CardQuality>('good')
  const [sentences, setSentences] = useState<string[]>([])
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0)
  const [selectedWords, setSelectedWords] = useState<string[]>([])
  const [phraseSuggestions, setPhraseSuggestions] = useState<string[]>([])
  const [isSuggestingPhrases, setIsSuggestingPhrases] = useState(false)
  const [clipboardError, setClipboardError] = useState('')
  const [cardError, setCardError] = useState('')
  const [exportError, setExportError] = useState('')
  const [backupError, setBackupError] = useState('')
  const [translationError, setTranslationError] = useState('')
  const [speechError, setSpeechError] = useState('')
  const [offlineWarning, setOfflineWarning] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [translations, setTranslations] = useState<
    Record<string, TranslationResult>
  >({})
  const [cards, setCards] = useState<SavedCard[]>([])
  const [cardsLoaded, setCardsLoaded] = useState(false)
  const [isCardsExpanded, setIsCardsExpanded] = useState(false)
  const [cardSearch, setCardSearch] = useState('')
  const [cardSearchMode, setCardSearchMode] =
    useState<CardSearchMode>('target')
  const [cardStatusFilter, setCardStatusFilter] =
    useState<CardStatusFilter>('all')
  const [editingCardId, setEditingCardId] = useState('')
  const [editDraft, setEditDraft] = useState<SavedCard | null>(null)
  const [lastDeletedCard, setLastDeletedCard] = useState<SavedCard | null>(null)
  const [lastBackupExportAt, setLastBackupExportAt] = useState('')
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [savedCardsError, setSavedCardsError] = useState('')

  const words = sentence.trim().split(/\s+/).filter(Boolean)
  const isMultiSentenceFlow = sentences.length > 1
  const hasNextSentence = currentSentenceIndex < sentences.length - 1
  const normalizedCardSearch = normalizeValue(cardSearch)
  const filteredCards = cards
    .filter((card) => {
      const searchableValues =
        cardSearchMode === 'target'
          ? [card.targetWord]
          : [
              card.sentence,
              card.targetWord,
              card.meaning || '',
              card.explanation || '',
              card.source || '',
              card.tags || '',
              card.languageStyle || '',
              card.quality || '',
            ]
      const matchesSearch =
        !normalizedCardSearch ||
        searchableValues.some((value) =>
          normalizeValue(value).includes(normalizedCardSearch),
        )
      const matchesStatus =
        cardStatusFilter === 'all' ||
        (cardStatusFilter === 'new' && !card.exportedAt) ||
        (cardStatusFilter === 'exported' && Boolean(card.exportedAt))

      return matchesSearch && matchesStatus
    })
    .sort((firstCard, secondCard) => {
      if (!normalizedCardSearch) {
        return 0
      }

      const firstTargetMatches = normalizeValue(firstCard.targetWord).includes(
        normalizedCardSearch,
      )
      const secondTargetMatches = normalizeValue(secondCard.targetWord).includes(
        normalizedCardSearch,
      )

      return Number(secondTargetMatches) - Number(firstTargetMatches)
    })
  const backupIsRecent =
    Boolean(lastBackupExportAt) &&
    Date.now() - new Date(lastBackupExportAt).getTime() <
      recentBackupDays * 24 * 60 * 60 * 1000
  const shouldShowBackupReminder =
    cards.length >= backupReminderCardCount ||
    (Boolean(lastBackupExportAt) && !backupIsRecent)

  useEffect(() => {
    const savedCards = localStorage.getItem(cardsStorageKey)
    const savedLastBackupExportAt = localStorage.getItem(lastBackupStorageKey)

    if (savedLastBackupExportAt) {
      setLastBackupExportAt(savedLastBackupExportAt)
    }

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
            quality: card.quality || 'good',
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

  useEffect(() => {
    function updateConnectionStatus() {
      if ('onLine' in navigator && !navigator.onLine) {
        setOfflineWarning('You appear to be offline. AI features may not work.')
        return
      }

      setOfflineWarning('')
    }

    updateConnectionStatus()
    window.addEventListener('online', updateConnectionStatus)
    window.addEventListener('offline', updateConnectionStatus)

    return () => {
      window.removeEventListener('online', updateConnectionStatus)
      window.removeEventListener('offline', updateConnectionStatus)
    }
  }, [])

  function resetSentenceWork(nextSentence: string) {
    setSentence(nextSentence)
    setSelectedWords([])
    setClipboardError('')
    setCardError('')
    setExportError('')
    setBackupError('')
    setTranslationError('')
    setPhraseSuggestions([])
    setTranslations({})
  }

  function updateSentence(nextSentence: string) {
    setSentences([])
    setCurrentSentenceIndex(0)
    resetSentenceWork(nextSentence)
  }

  function applyPastedText(nextSentence: string) {
    const pastedSentences = splitTextIntoSentences(nextSentence)

    lastClipboardPromptRef.current = nextSentence

    if (pastedSentences.length > 1) {
      setSentences(pastedSentences)
      setCurrentSentenceIndex(0)
      resetSentenceWork(pastedSentences[0])
      return
    }

    updateSentence(nextSentence)
  }

  useEffect(() => {
    async function detectClipboardText() {
      if (!navigator.clipboard?.readText) {
        return
      }

      try {
        const clipboardText = (await navigator.clipboard.readText()).trim()
        const currentSentence = sentence.trim()

        if (
          clipboardText &&
          clipboardText !== currentSentence &&
          clipboardText !== lastClipboardPromptRef.current
        ) {
          applyPastedText(clipboardText)
        }
      } catch {
        // Some browsers only allow clipboard reads after user interaction.
      }
    }

    detectClipboardText()

    function handleAppActive() {
      if (document.visibilityState === 'visible') {
        detectClipboardText()
      }
    }

    document.addEventListener('visibilitychange', handleAppActive)
    window.addEventListener('focus', detectClipboardText)

    return () => {
      document.removeEventListener('visibilitychange', handleAppActive)
      window.removeEventListener('focus', detectClipboardText)
    }
  }, [sentence])

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
    setSpeechError('')
    setPhraseSuggestions([])
    setTranslations({})
  }

  function addSuggestedPhrase(phrase: string) {
    setSelectedWords((currentWords) =>
      currentWords.includes(phrase) ? currentWords : [...currentWords, phrase],
    )
    setCardError('')
    setTranslationError('')
    setTranslations({})
  }

  async function suggestPhrases() {
    const cleanedSentence = sentence.trim()

    setTranslationError('')
    setCardError('')

    if (!cleanedSentence) {
      setTranslationError('Der Satz darf nicht leer sein.')
      return
    }

    setIsSuggestingPhrases(true)

    try {
      let suggestions: string[] = []

      if (!('onLine' in navigator) || navigator.onLine) {
        try {
          const response = await fetch(translationApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'suggestPhrases',
              sentence: cleanedSentence,
            }),
          })
          const data = await response.json()

          if (response.ok && Array.isArray(data.phrases)) {
            suggestions = data.phrases
              .filter((phrase: unknown) => typeof phrase === 'string')
              .map((phrase: string) => phrase.trim())
              .filter(Boolean)
          }
        } catch {
          suggestions = []
        }
      }

      if (suggestions.length === 0) {
        suggestions = findLocalPhraseSuggestions(cleanedSentence)
      }

      setPhraseSuggestions(suggestions)

      if (suggestions.length === 0) {
        setTranslationError('No useful phrases found.')
      }
    } finally {
      setIsSuggestingPhrases(false)
    }
  }

  function speakText(text: string) {
    const cleanedText = text.trim()

    if (!cleanedText) {
      return
    }

    if (
      !('speechSynthesis' in window) ||
      !('SpeechSynthesisUtterance' in window)
    ) {
      setSpeechError('Speech not supported on this device/browser.')
      return
    }

    const utterance = new SpeechSynthesisUtterance(cleanedText)
    const englishVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang === 'en-US' || voice.lang.startsWith('en'))

    window.speechSynthesis.cancel()
    utterance.lang = englishVoice?.lang || 'en-US'

    if (englishVoice) {
      utterance.voice = englishVoice
    }

    setSpeechError('')
    window.speechSynthesis.speak(utterance)
  }

  function createPhrase() {
    const selectedIndexes = selectedWords
      .map((selectedWord) => words.findIndex((word) => word === selectedWord))
      .filter((index) => index !== -1)
      .sort((firstIndex, secondIndex) => firstIndex - secondIndex)

    const hasAdjacentWords = selectedIndexes.every((index, arrayIndex) => {
      if (arrayIndex === 0) {
        return true
      }

      return index === selectedIndexes[arrayIndex - 1] + 1
    })

    if (!hasAdjacentWords || selectedIndexes.length !== selectedWords.length) {
      setCardError('Phrase words must be next to each other.')
      return
    }

    const phrase = selectedIndexes.map((index) => words[index]).join(' ')

    setSelectedWords([phrase])
    setCardError('')
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

      applyPastedText(nextSentence)
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

    if ('onLine' in navigator && !navigator.onLine) {
      setTranslations({})
      setTranslationError(
        'AI service could not be reached. Check your connection and try again.',
      )
      return
    }

    setIsGenerating(true)

    try {
      const nextTranslations: Record<string, TranslationResult> = {
        ...translations,
      }
      const failedWords: string[] = []
      let serviceCouldNotBeReached = false

      for (const targetWord of cleanedTargetWords) {
        try {
          const response = await fetch(translationApiUrl, {
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
            languageStyle: cleanLanguageStyle(
              data.languageStyle,
              targetWord,
              cleanedSentence,
            ),
          }
        } catch {
          serviceCouldNotBeReached = true
          failedWords.push(targetWord)
        }
      }

      setTranslations(nextTranslations)

      if (serviceCouldNotBeReached) {
        setTranslationError(
          'AI service could not be reached. Check your connection and try again.',
        )
      } else if (failedWords.length > 0) {
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

    const existingTargetWord = cleanedTargetWords.find((targetWord) => {
      const normalizedTargetWord = normalizeValue(targetWord)

      return cards.some(
        (card) =>
          normalizeValue(card.targetWord) === normalizedTargetWord &&
          normalizeValue(card.sentence) !== normalizedSentence,
      )
    })

    if (existingTargetWord) {
      const shouldSave = window.confirm(
        `The target word '${existingTargetWord}' already exists in another card. Add it anyway?`,
      )

      if (!shouldSave) {
        return
      }
    }

    const createdAt = new Date().toISOString()
    const cleanedSource = sessionSource.trim() || 'Kindle'
    const cleanedTags = normalizeTags(sessionTags)
    const newCards: SavedCard[] = cleanedTargetWords.map((targetWord, index) => ({
      id: `${Date.now()}-${index}`,
      sentence: cleanedSentence,
      targetWord,
      meaning: translations[getTranslationKey(targetWord)].meaning,
      explanation: translations[getTranslationKey(targetWord)].explanation,
      languageStyle:
        translations[getTranslationKey(targetWord)].languageStyle || 'simple',
      source: cleanedSource,
      tags: cleanedTags,
      quality: sessionQuality,
      createdAt,
      exportedAt: null,
    }))

    setCards((currentCards) => [...newCards, ...currentCards])
    setCardError('')
  }

  function exportCardsAsCsv(exportMode: CsvExportMode) {
    const cardsToExport =
      exportMode === 'new'
        ? cards.filter((card) => card.exportedAt === null)
        : exportMode === 'selected'
          ? cards.filter((card) => selectedCardIds.includes(card.id))
        : cards

    setExportError('')

    if (cardsToExport.length === 0) {
      setExportError(
        exportMode === 'new'
          ? 'Keine neuen Karten zum Exportieren.'
          : exportMode === 'selected'
            ? 'Please select at least one card to export.'
          : 'Keine Karten zum Exportieren.',
      )
      return
    }

    const csvHeader = [
      'CardId',
      'Sentence',
      'Target',
      'Meaning',
      'Explanation',
      'Source',
      'Tags',
      'LanguageStyle',
      'Quality',
    ]
    const csvRows = cardsToExport.map((card) =>
      [
        card.id,
        highlightTargetWord(card.sentence, card.targetWord),
        card.targetWord,
        card.meaning || '',
        card.explanation || '',
        card.source || 'Kindle',
        card.tags || '',
        card.languageStyle || '',
        card.quality || 'good',
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
    const exportedIds = new Set(cardsToExport.map((card) => card.id))

    setCards((currentCards) =>
      currentCards.map((card) =>
        exportedIds.has(card.id) && !card.exportedAt
          ? { ...card, exportedAt }
          : card,
      ),
    )
  }

  function toggleSelectedCard(cardId: string) {
    setSelectedCardIds((currentIds) =>
      currentIds.includes(cardId)
        ? currentIds.filter((currentId) => currentId !== cardId)
        : [...currentIds, cardId],
    )
    setExportError('')
  }

  function deleteCard(cardId: string) {
    const shouldDelete = window.confirm('Delete this card?')

    if (!shouldDelete) {
      return
    }

    const cardToDelete = cards.find((card) => card.id === cardId)

    if (!cardToDelete) {
      return
    }

    setLastDeletedCard(cardToDelete)
    setEditingCardId('')
    setEditDraft(null)
    setSavedCardsError('')
    setSelectedCardIds((currentIds) =>
      currentIds.filter((currentId) => currentId !== cardId),
    )
    setCards((currentCards) => currentCards.filter((card) => card.id !== cardId))
  }

  function undoLastDelete() {
    if (!lastDeletedCard) {
      return
    }

    setCards((currentCards) => [lastDeletedCard, ...currentCards])
    setLastDeletedCard(null)
    setSavedCardsError('')
  }

  function startEditingCard(card: SavedCard) {
    setEditingCardId(card.id)
    setEditDraft({ ...card })
    setSavedCardsError('')
  }

  function cancelEditingCard() {
    setEditingCardId('')
    setEditDraft(null)
    setSavedCardsError('')
  }

  function updateEditDraft(field: keyof SavedCard, value: string) {
    setEditDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }

      return {
        ...currentDraft,
        [field]: value,
      }
    })
  }

  function saveEditedCard() {
    if (!editDraft) {
      return
    }

    const cleanedSentence = editDraft.sentence.trim()
    const cleanedTargetWord = editDraft.targetWord.trim()

    if (!cleanedSentence || !cleanedTargetWord) {
      setSavedCardsError('Sentence and target word cannot be empty.')
      return
    }

    const normalizedSentence = normalizeValue(cleanedSentence)
    const normalizedTargetWord = normalizeValue(cleanedTargetWord)
    const duplicateCard = cards.find(
      (card) =>
        card.id !== editDraft.id &&
        normalizeValue(card.sentence) === normalizedSentence &&
        normalizeValue(card.targetWord) === normalizedTargetWord,
    )

    if (duplicateCard) {
      setSavedCardsError(
        `You already saved '${cleanedTargetWord}' in this sentence.`,
      )
      return
    }

    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === editDraft.id
          ? {
              ...editDraft,
              sentence: cleanedSentence,
              targetWord: cleanedTargetWord,
              meaning: editDraft.meaning?.trim() || '',
              explanation: editDraft.explanation?.trim() || '',
              source: editDraft.source?.trim() || editDraft.source,
              tags: normalizeTags(editDraft.tags || ''),
              languageStyle: editDraft.languageStyle?.trim() || '',
              quality: editDraft.quality || 'good',
            }
          : card,
      ),
    )
    setEditingCardId('')
    setEditDraft(null)
    setSavedCardsError('')
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
    const exportedAt = new Date().toISOString()

    localStorage.setItem(lastBackupStorageKey, exportedAt)
    setLastBackupExportAt(exportedAt)
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
        quality: card.quality || 'good',
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
        {offlineWarning ? (
          <p className="backup-reminder" role="status">
            {offlineWarning}
          </p>
        ) : null}

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
          <button
            className="export-button"
            type="button"
            onClick={suggestPhrases}
            disabled={isSuggestingPhrases || isGenerating}
          >
            {isSuggestingPhrases ? 'Suggesting...' : 'Suggest phrases'}
          </button>
          {phraseSuggestions.length > 0 ? (
            <div className="suggestion-list" aria-label="Suggested phrases">
              {phraseSuggestions.map((phrase) => (
                <button
                  className={`suggestion-chip${
                    selectedWords.includes(phrase) ? ' selected' : ''
                  }`}
                  key={phrase}
                  type="button"
                  onClick={() => addSuggestedPhrase(phrase)}
                  disabled={isGenerating}
                >
                  {phrase}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="selected-panel" aria-label="Selected word">
          <p className="panel-label">{'Ausgew\u00e4hltes Wort'}</p>
          <p className="selected-word">
            {selectedWords.length > 0
              ? selectedWords.join(', ')
              : 'Noch kein Wort ausgew\u00e4hlt'}
          </p>
          {selectedWords.length > 0 ? (
            <div className="audio-button-row">
              <button
                className="audio-button"
                type="button"
                onClick={() => speakText(selectedWords.join(', '))}
              >
                🔊 Word
              </button>
              <button
                className="audio-button"
                type="button"
                onClick={() => speakText(sentence)}
              >
                🔊 Sentence
              </button>
            </div>
          ) : null}
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
          {selectedWords.length >= 2 ? (
            <button
              className="export-button"
              type="button"
              onClick={createPhrase}
              disabled={isGenerating}
            >
              Create phrase
            </button>
          ) : null}
          {translationError ? (
            <p className="error-message" role="alert">
              {translationError}
            </p>
          ) : null}
          {speechError ? (
            <p className="error-message" role="alert">
              {speechError}
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
                    {translation.languageStyle ? (
                      <p className="result-style">
                        Style: {translation.languageStyle}
                      </p>
                    ) : null}
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
          <label className="metadata-label" htmlFor="source-input">
            Source / Book
            <input
              id="source-input"
              value={sessionSource}
              onChange={(event) => setSessionSource(event.target.value)}
              placeholder="Kindle"
            />
          </label>
          <label className="metadata-label" htmlFor="tags-input">
            Tags
            <input
              id="tags-input"
              value={sessionTags}
              onChange={(event) => setSessionTags(event.target.value)}
              placeholder="optional, e.g. fiction verbs"
            />
          </label>
          <label className="metadata-label" htmlFor="quality-input">
            Quality
            <select
              id="quality-input"
              value={sessionQuality}
              onChange={(event) =>
                setSessionQuality(event.target.value as CardQuality)
              }
            >
              <option value="good">good</option>
              <option value="needs edit">needs edit</option>
              <option value="hard">hard</option>
              <option value="important">important</option>
            </select>
          </label>
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
          <button
            className="cards-toggle"
            type="button"
            onClick={() => setIsCardsExpanded((isExpanded) => !isExpanded)}
            aria-expanded={isCardsExpanded}
          >
            <span>Saved cards ({cards.length})</span>
            <span>{isCardsExpanded ? 'Close' : 'Open'}</span>
          </button>
          {isCardsExpanded ? (
            <>
              {selectedCardIds.length === 0 ? (
                <>
                  <button
                    className="export-button"
                    type="button"
                    onClick={() => exportCardsAsCsv('new')}
                  >
                    Neue Karten als CSV exportieren
                  </button>
                  <button
                    className="export-button"
                    type="button"
                    onClick={() => exportCardsAsCsv('all')}
                  >
                    Alle Karten als CSV exportieren
                  </button>
                </>
              ) : (
                <button
                  className="export-button"
                  type="button"
                  onClick={() => exportCardsAsCsv('selected')}
                >
                  Selected cards als CSV exportieren ({selectedCardIds.length})
                </button>
              )}
              <button
                className="export-button"
                type="button"
                onClick={exportBackup}
              >
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
              {shouldShowBackupReminder ? (
                <p className="backup-reminder">
                  You have many saved cards. Consider exporting a backup.
                </p>
              ) : null}
              <input
                className="card-search-input"
                type="search"
                value={cardSearch}
                onChange={(event) => setCardSearch(event.target.value)}
                placeholder="Search saved cards"
              />
              <div className="card-search-mode" aria-label="Search mode">
                {(['target', 'everywhere'] as CardSearchMode[]).map(
                  (searchMode) => (
                    <button
                      className={`card-filter-button${
                        cardSearchMode === searchMode ? ' active' : ''
                      }`}
                      key={searchMode}
                      type="button"
                      onClick={() => setCardSearchMode(searchMode)}
                    >
                      {searchMode === 'target' ? 'Target only' : 'Everywhere'}
                    </button>
                  ),
                )}
              </div>
              <div className="card-filter-group" aria-label="Filter saved cards">
                {(['all', 'new', 'exported'] as CardStatusFilter[]).map(
                  (filterValue) => (
                    <button
                      className={`card-filter-button${
                        cardStatusFilter === filterValue ? ' active' : ''
                      }`}
                      key={filterValue}
                      type="button"
                      onClick={() => setCardStatusFilter(filterValue)}
                    >
                      {filterValue === 'all'
                        ? 'All'
                        : filterValue === 'new'
                          ? 'New'
                          : 'Exported'}
                    </button>
                  ),
                )}
              </div>
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
              {savedCardsError ? (
                <p className="error-message" role="alert">
                  {savedCardsError}
                </p>
              ) : null}
              {speechError ? (
                <p className="error-message" role="alert">
                  {speechError}
                </p>
              ) : null}
              {lastDeletedCard ? (
                <div className="undo-delete">
                  <p>Deleted "{lastDeletedCard.targetWord}".</p>
                  <button type="button" onClick={undoLastDelete}>
                    Undo delete
                  </button>
                </div>
              ) : null}
              {filteredCards.length > 0 ? (
                <ul className="card-list">
                  {filteredCards.map((card) => (
                    <li className="saved-card" key={card.id}>
                      {editingCardId === card.id && editDraft ? (
                        <div className="edit-card-form">
                          <label>
                            Sentence
                            <textarea
                              value={editDraft.sentence}
                              onChange={(event) =>
                                updateEditDraft('sentence', event.target.value)
                              }
                              rows={3}
                            />
                          </label>
                          <label>
                            Target word
                            <input
                              value={editDraft.targetWord}
                              onChange={(event) =>
                                updateEditDraft('targetWord', event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Meaning
                            <input
                              value={editDraft.meaning || ''}
                              onChange={(event) =>
                                updateEditDraft('meaning', event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Explanation
                            <textarea
                              value={editDraft.explanation || ''}
                              onChange={(event) =>
                                updateEditDraft(
                                  'explanation',
                                  event.target.value,
                                )
                              }
                              rows={3}
                            />
                          </label>
                          {editDraft.source !== undefined ? (
                            <label>
                              Source
                              <input
                                value={editDraft.source || ''}
                                onChange={(event) =>
                                  updateEditDraft('source', event.target.value)
                                }
                              />
                            </label>
                          ) : null}
                          <label>
                            Tags
                            <input
                              value={editDraft.tags || ''}
                              onChange={(event) =>
                                updateEditDraft('tags', event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Language style
                            <input
                              value={editDraft.languageStyle || ''}
                              onChange={(event) =>
                                updateEditDraft(
                                  'languageStyle',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Quality
                            <select
                              value={editDraft.quality || 'good'}
                              onChange={(event) =>
                                updateEditDraft('quality', event.target.value)
                              }
                            >
                              <option value="good">good</option>
                              <option value="needs edit">needs edit</option>
                              <option value="hard">hard</option>
                              <option value="important">important</option>
                            </select>
                          </label>
                          <div className="card-action-row">
                            <button
                              className="save-edit-button"
                              type="button"
                              onClick={saveEditedCard}
                            >
                              Save edits
                            </button>
                            <button
                              className="delete-card-button"
                              type="button"
                              onClick={cancelEditingCard}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <label className="card-select-label">
                            <input
                              type="checkbox"
                              checked={selectedCardIds.includes(card.id)}
                              onChange={() => toggleSelectedCard(card.id)}
                            />
                            Select for export
                          </label>
                          <div className="card-title-row">
                            <p className="card-word">
                              {highlightSearchText(card.targetWord, cardSearch)}
                            </p>
                            <span
                              className={`export-status${
                                card.exportedAt ? ' exported' : ''
                              }`}
                            >
                              {card.exportedAt ? 'Exportiert' : 'Neu'}
                            </span>
                          </div>
                          {card.meaning ? (
                            <p className="card-meaning">
                              {highlightSearchText(card.meaning, cardSearch)}
                            </p>
                          ) : null}
                          <p className="card-sentence">
                            {highlightSearchText(card.sentence, cardSearch)}
                          </p>
                          {card.explanation ? (
                            <p className="card-explanation">
                              {highlightSearchText(
                                card.explanation,
                                cardSearch,
                              )}
                            </p>
                          ) : null}
                          {card.source ? (
                            <p className="card-source">
                              {highlightSearchText(card.source, cardSearch)}
                            </p>
                          ) : null}
                          {card.tags ? (
                            <p className="card-tags">
                              {highlightSearchText(card.tags, cardSearch)}
                            </p>
                          ) : null}
                          {card.languageStyle ? (
                            <p className="card-tags">
                              Style:{' '}
                              {highlightSearchText(
                                card.languageStyle,
                                cardSearch,
                              )}
                            </p>
                          ) : null}
                          <p className="card-quality">
                            Quality: {card.quality || 'good'}
                          </p>
                          <time className="card-date" dateTime={card.createdAt}>
                            {new Date(card.createdAt).toLocaleString()}
                          </time>
                          <div className="audio-button-row">
                            <button
                              className="audio-button"
                              type="button"
                              onClick={() => speakText(card.targetWord)}
                            >
                              🔊 Word
                            </button>
                            <button
                              className="audio-button"
                              type="button"
                              onClick={() => speakText(card.sentence)}
                            >
                              🔊 Sentence
                            </button>
                          </div>
                          <div className="card-action-row">
                            <button
                              className="edit-card-button"
                              type="button"
                              onClick={() => startEditingCard(card)}
                            >
                              Edit
                            </button>
                            <button
                              className="delete-card-button"
                              type="button"
                              onClick={() => deleteCard(card.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">
                  {cards.length > 0
                    ? 'No saved cards match this search.'
                    : 'Noch keine Karten gespeichert.'}
                </p>
              )}
            </>
          ) : null}
        </section>
      </section>
    </main>
  )
}

export default App
