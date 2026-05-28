(function () {
  const vscode = acquireVsCodeApi()
  const root = document.getElementById('cards')
  const empty = document.getElementById('empty')
  let cards = []

  function render() {
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

    const header = document.createElement('header')
    const quote = document.createElement('div')
    quote.className = 'quote'
    quote.textContent = c.selectedText
    header.appendChild(quote)

    const actions = document.createElement('div')
    actions.className = 'actions'
    const checkBtn = document.createElement('button')
    checkBtn.title = c.resolved ? '取消已理解' : '标记已理解'
    checkBtn.textContent = c.resolved ? '↺' : '✓'
    checkBtn.addEventListener('click', () => vscode.postMessage({ kind: 'mark-resolved', cardId: c.id, resolved: !c.resolved }))
    const delBtn = document.createElement('button')
    delBtn.title = '删除'
    delBtn.textContent = '✕'
    delBtn.addEventListener('click', () => vscode.postMessage({ kind: 'delete', cardId: c.id }))
    actions.append(checkBtn, delBtn)
    header.appendChild(actions)
    li.appendChild(header)

    const body = document.createElement('div')
    body.className = 'body'
    for (const t of c.turns) {
      const div = document.createElement('div')
      div.className = 'turn ' + t.role
      div.textContent = t.text
      body.appendChild(div)
    }
    li.appendChild(body)

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
    if (c.error) {
      const err = document.createElement('div')
      err.className = 'error'
      err.textContent = c.error
      const retry = document.createElement('button')
      retry.textContent = '重试'
      retry.addEventListener('click', () => vscode.postMessage({ kind: 'retry', cardId: c.id }))
      err.appendChild(retry)
      li.appendChild(err)
    }
    return li
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data
    if (m.kind === 'render') { cards = m.cards; render() }
    else if (m.kind === 'card-stream') {
      const li = root.querySelector(`[data-id="${CSS.escape(m.cardId)}"] .body .turn:last-child`)
      if (li) li.textContent = (li.textContent ?? '') + m.chunk
    }
    else if (m.kind === 'card-done') { /* no-op, 已经流式渲染过 */ }
    else if (m.kind === 'card-error') {
      const li = root.querySelector(`[data-id="${CSS.escape(m.cardId)}"]`)
      if (li) {
        li.querySelector('.error')?.remove()
        const err = document.createElement('div')
        err.className = 'error'
        err.textContent = m.message
        const retry = document.createElement('button')
        retry.textContent = '重试'
        retry.addEventListener('click', () => vscode.postMessage({ kind: 'retry', cardId: m.cardId }))
        err.appendChild(retry)
        li.appendChild(err)
      }
    }
  })
})()
