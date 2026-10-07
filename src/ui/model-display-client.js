const buttons = Array.from(document.querySelectorAll('button[data-display]'));
const status = document.getElementById('status');
const result = document.getElementById('result');
const start = document.getElementById('start');
const end = document.getElementById('end');
const missingDates = document.getElementById('missing-dates');
let busy = false;

class DateClarificationError extends Error {
  constructor(missingInputs) {
    super('Choose a start and end date');
    this.missingInputs = missingInputs;
  }
}

function clearClarification() {
  missingDates.textContent = '';
  for (const input of [start, end]) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

function missingInputs() {
  return [start, end].filter(input => input.value === '').map(input => input.id);
}

function showClarification(missing, focus = false) {
  clearClarification();
  status.setAttribute('role', 'status');
  status.textContent = 'Choose a start and end date';
  missingDates.textContent = `Missing input: ${missing.map(id => id === 'start' ? 'Start (inclusive)' : 'End (exclusive)').join(' and ')}.`;
  const inputs = [start, end].filter(input => missing.includes(input.id));
  inputs.forEach(input => {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'missing-dates');
  });
  if (focus) inputs[0]?.focus();
}

async function post(path, specification) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(specification),
  });
  const body = await response.json();
  if (!response.ok && body.outcome === 'clarification') {
    throw new DateClarificationError(body.missingInputs);
  }
  if (!response.ok) throw new Error(body.error || 'The request failed.');
  return body;
}

async function showDisplay(type) {
  if (busy) return;
  result.replaceChildren();
  clearClarification();
  const missing = missingInputs();
  if (missing.length > 0) {
    showClarification(missing, true);
    return;
  }
  busy = true;
  const dates = { start: start.value, end: end.value };
  buttons.forEach(button => { button.disabled = true; });
  start.disabled = true;
  end.disabled = true;
  result.setAttribute('aria-busy', 'true');
  status.setAttribute('role', 'status');
  status.textContent = 'Choosing display…';
  try {
    // This response arrives only after complete generation and server validation.
    const selected = await post('/api/select-display', {
      specification: { type, resultField: 'net_revenue' }, ...dates,
    });
    status.textContent = 'Running query…';
    const executed = await post('/api/run-query', {
      specification: selected.specification,
      start: selected.dateRange.start, end: selected.dateRange.end,
    });
    // The fragment is server-rendered React markup from validated data, never model HTML.
    result.innerHTML = executed.html;
    status.textContent = 'Display ready.';
  } catch (error) {
    result.replaceChildren();
    if (error instanceof DateClarificationError) {
      showClarification(error.missingInputs);
    } else {
      status.setAttribute('role', 'alert');
      status.textContent = error instanceof Error ? error.message : 'The request failed.';
    }
  } finally {
    busy = false;
    result.setAttribute('aria-busy', 'false');
    buttons.forEach(button => { button.disabled = false; });
    start.disabled = false;
    end.disabled = false;
  }
}

buttons.forEach(button => {
  button.addEventListener('click', () => { void showDisplay(button.dataset.display); });
});

for (const input of [start, end]) {
  const clearEditedResult = () => {
    result.replaceChildren();
    clearClarification();
    const missing = missingInputs();
    if (missing.length > 0) {
      showClarification(missing);
    } else {
      status.setAttribute('role', 'status');
      status.textContent = 'Choose a display.';
    }
  };
  input.addEventListener('input', clearEditedResult);
  input.addEventListener('change', clearEditedResult);
}
