const buttons = Array.from(document.querySelectorAll('button[data-display]'));
const status = document.getElementById('status');
const result = document.getElementById('result');
let busy = false;

async function post(path, specification) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(specification),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The request failed.');
  return body;
}

async function showDisplay(type) {
  if (busy) return;
  busy = true;
  result.replaceChildren();
  buttons.forEach(button => { button.disabled = true; });
  result.setAttribute('aria-busy', 'true');
  status.setAttribute('role', 'status');
  status.textContent = 'Choosing display…';
  try {
    // This response arrives only after complete generation and server validation.
    const selected = await post('/api/select-display', { type, resultField: 'net_revenue' });
    status.textContent = 'Running query…';
    const executed = await post('/api/run-query', selected.specification);
    // The fragment is server-rendered React markup from validated data, never model HTML.
    result.innerHTML = executed.html;
    status.textContent = 'Display ready.';
  } catch (error) {
    result.replaceChildren();
    status.setAttribute('role', 'alert');
    status.textContent = error instanceof Error ? error.message : 'The request failed.';
  } finally {
    busy = false;
    result.setAttribute('aria-busy', 'false');
    buttons.forEach(button => { button.disabled = false; });
  }
}

buttons.forEach(button => {
  button.addEventListener('click', () => { void showDisplay(button.dataset.display); });
});
