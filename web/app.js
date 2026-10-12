const state = { endpointId: null, token: null, requests: [], lastEventId: 0, streamAbort: null };
const $ = (selector) => document.querySelector(selector);
function textElement(tag, text, classes = '') { const el = document.createElement(tag); el.className = classes; el.textContent = text; return el; }
function copy(value) { navigator.clipboard.writeText(value).catch(() => window.prompt('Copy this value:', value)); }
function rawBytes(request) { return Uint8Array.from(atob(request.rawBodyBase64 || ''), (char) => char.charCodeAt(0)); }
async function createEndpoint() {
  const response = await fetch('/api/endpoints', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Could not create endpoint');
  state.endpointId = data.endpointId; state.token = data.viewingToken; $('#capture-url').textContent = data.captureUrl; $('#viewing-token').textContent = data.viewingToken;
  $('#empty-state').classList.add('hidden'); $('#endpoint-panel').classList.remove('hidden'); await refresh();
}
function addSignaturePanel(detail, request) {
  const panel = document.createElement('div'); panel.className = 'mt-6 border-t border-slate-800 pt-5'; panel.append(textElement('h3', 'Signature verification', 'font-semibold text-slate-200'));
  const format = document.createElement('select'); format.className = 'mt-3 rounded bg-slate-950 p-2 text-sm'; format.append(new Option('Stripe-style: t=,v1=', 'stripe'), new Option('Generic: sha256=', 'sha256'));
  const headerName = document.createElement('input'); headerName.className = 'mt-2 block w-full rounded bg-slate-950 p-2 text-sm'; headerName.value = 'stripe-signature'; headerName.placeholder = 'Signature header name';
  format.onchange = () => { headerName.value = format.value === 'stripe' ? 'stripe-signature' : 'x-hub-signature-256'; };
  const secret = document.createElement('input'); secret.type = 'password'; secret.autocomplete = 'off'; secret.className = 'mt-2 block w-full rounded bg-slate-950 p-2 text-sm'; secret.placeholder = 'Signing secret (never leaves this browser)';
  const result = textElement('p', '', 'mt-3 text-sm'); const button = textElement('button', 'Verify signature', 'mt-3 rounded bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950');
  button.onclick = async () => { const input = { header: request.headers[String(headerName.value).toLowerCase()], secret: secret.value, rawBody: rawBytes(request) }; const verdict = format.value === 'stripe' ? await HookScopeSignature.verifyStripeSignature(input) : await HookScopeSignature.verifySha256Signature(input); result.textContent = verdict.valid ? 'Valid signature' : `Verification failed: ${verdict.reason}`; result.className = `mt-3 text-sm ${verdict.valid ? 'text-emerald-300' : 'text-rose-300'}`; secret.value = ''; };
  panel.append(format, headerName, secret, button, result); detail.append(panel);
}
function addReplayPanel(detail, request) {
  const panel = document.createElement('div'); panel.className = 'mt-6 border-t border-slate-800 pt-5'; panel.append(textElement('h3', 'Local replay', 'font-semibold text-slate-200'));
  const result = textElement('p', 'A connected HookScope CLI is required.', 'mt-2 text-sm text-slate-400'); const button = textElement('button', 'Replay to localhost', 'mt-3 rounded bg-violet-400 px-3 py-2 text-sm font-semibold text-slate-950');
  button.onclick = async () => { button.disabled = true; try { const response = await fetch(`/api/endpoints/${encodeURIComponent(state.endpointId)}/requests/${encodeURIComponent(request.requestId)}/replay`, { method: 'POST', headers: { authorization: `Bearer ${state.token}` } }); const data = await response.json(); result.textContent = response.ok ? `Local response: ${data.status} in ${data.durationMs}ms — ${data.bodyPreview}` : `Replay failed: ${data.error?.message || 'Unavailable'}`; } finally { button.disabled = false; } };
  panel.append(button, result); detail.append(panel);
}
async function addRetryPanel(detail) {
  const panel = document.createElement('div'); panel.className = 'mt-6 border-t border-slate-800 pt-5'; panel.append(textElement('h3', 'Retry analysis', 'font-semibold text-slate-200'));
  try { const response = await fetch(`/api/endpoints/${encodeURIComponent(state.endpointId)}/retries`, { headers: { authorization: `Bearer ${state.token}` } }); const groups = (await response.json()).groups || []; groups.forEach((group) => { const line = group.attempts.map((attempt) => `#${attempt.attempt} ${attempt.response.status} ${attempt.sincePreviousMs === null ? '' : `(+${attempt.sincePreviousMs}ms)`}`).join(' → '); panel.append(textElement('p', line, 'mt-2 text-xs text-slate-300')); }); } catch (_) { panel.append(textElement('p', 'Retry data unavailable.', 'mt-2 text-sm text-slate-400')); } detail.append(panel);
}
function showDetail(request) {
  const detail = $('#detail'); detail.replaceChildren(); const metadata = document.createElement('div'); metadata.className = 'grid gap-2 text-sm';
  [['Method', request.method], ['Path', request.path], ['Received', new Date(request.receivedAt).toLocaleString()], ['Size', `${request.bodySize} bytes`]].forEach(([label, value]) => { const row = document.createElement('p'); row.append(textElement('span', `${label}: `, 'font-medium text-slate-300'), document.createTextNode(value)); metadata.append(row); });
  detail.append(metadata, textElement('h3', 'Headers', 'mt-6 font-semibold text-slate-200'), textElement('pre', JSON.stringify(request.headers, null, 2), 'mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-300'));
  const body = new TextDecoder().decode(rawBytes(request)); let display = body; try { display = JSON.stringify(JSON.parse(body), null, 2); } catch (_) { /* retain raw text */ }
  detail.append(textElement('h3', 'Body', 'mt-6 font-semibold text-slate-200'), textElement('pre', display || '(empty body)', 'mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-4 text-xs text-slate-300')); addSignaturePanel(detail, request); addReplayPanel(detail, request); addRetryPanel(detail);
}
function renderList() { const list = $('#request-list'); list.replaceChildren(); if (!state.requests.length) return list.append(textElement('p', 'No requests yet.', 'p-4 text-sm text-slate-400')); state.requests.forEach((request) => { const button = document.createElement('button'); button.className = 'block w-full p-4 text-left hover:bg-slate-800/70'; button.append(textElement('span', request.method, 'mr-2 rounded bg-cyan-400/15 px-2 py-1 text-xs font-bold text-cyan-300'), textElement('span', request.path, 'text-sm'), textElement('span', new Date(request.receivedAt).toLocaleTimeString(), 'mt-2 block text-xs text-slate-400')); button.onclick = () => showDetail(request); list.append(button); }); }
async function refresh() { if (!state.endpointId) return; const response = await fetch(`/api/endpoints/${encodeURIComponent(state.endpointId)}/requests`, { headers: { authorization: `Bearer ${state.token}` } }); if (!response.ok) return; state.requests = (await response.json()).requests; state.lastEventId = Math.max(state.lastEventId, ...state.requests.map((item) => item.sequence || 0)); renderList(); }
async function stream() {
  if (!state.endpointId || state.streamAbort) return; state.streamAbort = new AbortController();
  try { const response = await fetch(`/api/endpoints/${encodeURIComponent(state.endpointId)}/stream`, { headers: { authorization: `Bearer ${state.token}`, 'last-event-id': String(state.lastEventId) }, signal: state.streamAbort.signal }); if (!response.ok || !response.body) throw new Error('Live stream unavailable'); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop(); frames.forEach((frame) => { const id = /^id: (\d+)$/m.exec(frame)?.[1]; const data = /^data: (.*)$/m.exec(frame)?.[1]; if (!id || !data) return; const item = JSON.parse(data); if (item.sequence <= state.lastEventId) return; state.lastEventId = item.sequence; state.requests = [item, ...state.requests.filter((entry) => entry.sequence !== item.sequence)]; renderList(); }); } } catch (_) { /* reconnect quietly; no secrets are logged */ } finally { state.streamAbort = null; if (state.endpointId) setTimeout(stream, 1000); }
}
$('#create-endpoint').onclick = () => createEndpoint().then(stream).catch((error) => alert(error.message));
document.querySelectorAll('[data-copy]').forEach((button) => button.onclick = () => copy($(`#${button.dataset.copy}`).textContent));
