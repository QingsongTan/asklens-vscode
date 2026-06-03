(function () {
  const vscode = acquireVsCodeApi()
  const root = document.getElementById('cards')
  const empty = document.getElementById('empty')
  const status = document.getElementById('status')
  let cards = []
  let currentSessionId = ''

  function shortSid(sid) {
    if (!sid || sid === '__none__') return '无会话'
    return sid.length > 12 ? sid.slice(0, 8) + '…' : sid
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function renderMarkdown(text) {
    let result = ''
    const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
    let last = 0
    let m
    while ((m = codeBlockRe.exec(text)) !== null) {
      result += renderInline(text.slice(last, m.index))
      result += `<pre><code>${escapeHtml(m[2].replace(/\n$/, ''))}</code></pre>`
      last = m.index + m[0].length
    }
    result += renderInline(text.slice(last))
    return result
  }

  function renderInline(text) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')
  }

  function makeTurnEl(role, text) {
    const div = document.createElement('div')
    div.className = 'turn ' + role

    const label = document.createElement('div')
    label.className = 'turn-label'
    label.textContent = role === 'user' ? '你' : 'AI'

    const bubble = document.createElement('div')
    bubble.className = 'turn-bubble'
    if (role === 'assistant') {
      bubble.innerHTML = text ? renderMarkdown(text) : ''
    } else {
      bubble.textContent = text
    }

    div.append(label, bubble)
    return div
  }

  function makeErrorEl(cardId, msg) {
    const err = document.createElement('div')
    err.className = 'error'
    const txt = document.createTextNode(msg + ' ')
    const retry = document.createElement('button')
    retry.textContent = '重试'
    retry.addEventListener('click', () => vscode.postMessage({ kind: 'retry', cardId }))
    err.append(txt, retry)
    return err
  }

  function render() {
    status.textContent = `当前会话: ${shortSid(currentSessionId)} · ${cards.length} 张卡片`
    if (cards.length === 0) {
      empty.style.display = 'block'
      root.innerHTML = ''
      return
    }
    empty.style.display = 'none'
    root.innerHTML = ''
    for (const c of cards) root.appendChild(renderCard(c))
  }

  function renderCard(c) {
    const li = document.createElement('li')
    li.className = 'card' + (c.resolved ? ' resolved' : '')
    li.dataset.id = c.id

    // Header
    const header = document.createElement('header')

    const quoteWrap = document.createElement('div')
    quoteWrap.className = 'quote-wrap'
    const quoteToggle = document.createElement('button')
    quoteToggle.className = 'quote-toggle'
    const arrow = document.createElement('span')
    arrow.textContent = '▶'
    const preview = document.createElement('span')
    preview.textContent = c.selectedText.length > 60
      ? c.selectedText.slice(0, 60) + '…'
      : c.selectedText
    quoteToggle.append(arrow, preview)
    const quote = document.createElement('div')
    quote.className = 'quote'
    quote.textContent = c.selectedText
    quoteToggle.addEventListener('click', () => {
      quote.classList.toggle('expanded')
      arrow.textContent = quote.classList.contains('expanded') ? '▼' : '▶'
    })
    quoteWrap.append(quoteToggle, quote)

    const headerRight = document.createElement('div')
    headerRight.className = 'header-right'
    const actions = document.createElement('div')
    actions.className = 'actions'
    const checkBtn = document.createElement('button')
    checkBtn.title = c.resolved ? '取消已理解' : '标记已理解'
    checkBtn.textContent = c.resolved ? '↺' : '✓'
    checkBtn.addEventListener('click', () =>
      vscode.postMessage({ kind: 'mark-resolved', cardId: c.id, resolved: !c.resolved }))
    const delBtn = document.createElement('button')
    delBtn.title = '删除'
    delBtn.textContent = '✕'
    delBtn.addEventListener('click', () =>
      vscode.postMessage({ kind: 'delete', cardId: c.id }))
    actions.append(checkBtn, delBtn)
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = shortSid(c.sessionId)
    badge.title = c.sessionId
    headerRight.append(actions, badge)

    header.append(quoteWrap, headerRight)
    li.appendChild(header)

    // Body
    const body = document.createElement('div')
    body.className = 'body'
    for (const t of c.turns) {
      body.appendChild(makeTurnEl(t.role, t.text))
    }
    li.appendChild(body)

    // Follow-up
    const fu = document.createElement('div')
    fu.className = 'followup'
    const input = document.createElement('input')
    input.placeholder = '追问…'
    const send = document.createElement('button')
    send.textContent = '发送'
    function submit() {
      if (!input.value.trim()) return
      vscode.postMessage({ kind: 'follow-up', cardId: c.id, text: input.value })
      input.value = ''
    }
    send.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    fu.append(input, send)
    li.appendChild(fu)

    if (c.error) li.appendChild(makeErrorEl(c.id, c.error))

    return li
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data
    if (m.kind === 'render') {
      cards = m.cards
      currentSessionId = m.currentSessionId ?? ''
      render()
    } else if (m.kind === 'card-stream') {
      const cardEl = root.querySelector(`[data-id="${CSS.escape(m.cardId)}"]`)
      if (!cardEl) return
      const body = cardEl.querySelector('.body')
      const allTurns = body.querySelectorAll('.turn')
      let lastTurn = allTurns[allTurns.length - 1]
      if (!lastTurn || !lastTurn.classList.contains('assistant')) {
        const newTurn = makeTurnEl('assistant', '')
        newTurn.dataset.raw = ''
        body.appendChild(newTurn)
        lastTurn = newTurn
      }
      const bubble = lastTurn.querySelector('.turn-bubble')
      if (bubble) {
        bubble.querySelector('.cursor')?.remove()
        lastTurn.dataset.raw = (lastTurn.dataset.raw ?? '') + m.chunk
        bubble.textContent = lastTurn.dataset.raw
        const cursor = document.createElement('span')
        cursor.className = 'cursor'
        cursor.textContent = '▌'
        bubble.appendChild(cursor)
      }
    } else if (m.kind === 'card-done') {
      const cardEl = root.querySelector(`[data-id="${CSS.escape(m.cardId)}"]`)
      if (!cardEl) return
      const body = cardEl.querySelector('.body')
      const assistantTurns = body.querySelectorAll('.turn.assistant')
      const lastTurn = assistantTurns[assistantTurns.length - 1]
      if (lastTurn?.dataset.raw !== undefined) {
        const bubble = lastTurn.querySelector('.turn-bubble')
        if (bubble) bubble.innerHTML = renderMarkdown(lastTurn.dataset.raw)
      }
    } else if (m.kind === 'card-error') {
      const cardEl = root.querySelector(`[data-id="${CSS.escape(m.cardId)}"]`)
      if (!cardEl) return
      cardEl.querySelector('.error')?.remove()
      const body = cardEl.querySelector('.body')
      const assistantTurns = body.querySelectorAll('.turn.assistant')
      const lastTurn = assistantTurns[assistantTurns.length - 1]
      if (lastTurn) {
        lastTurn.querySelector('.cursor')?.remove()
        if (lastTurn.dataset.raw !== undefined) {
          const bubble = lastTurn.querySelector('.turn-bubble')
          if (bubble) bubble.innerHTML = renderMarkdown(lastTurn.dataset.raw)
        }
      }
      cardEl.appendChild(makeErrorEl(m.cardId, m.message))
    }
  })
})()
