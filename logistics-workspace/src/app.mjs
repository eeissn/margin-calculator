import '@fontsource-variable/inter';
import './style.css';
import { blankOrder, etrnProgress, etrnSteps, etrnStatus, hasMargin, margin, markTrip, mergeImport, tripSteps, upsert } from './domain.mjs';
import { importPair, phones } from './import.mjs';
import { store } from './storage.mjs';

const $ = id => document.getElementById(id);
const currency = new Intl.NumberFormat('ru', {style:'currency', currency:'RUB', maximumFractionDigits:0});
const money = value => currency.format(value);
const fieldNames = ['number','date','customer','carrier','driver','vehicle','cargo','customerAmount','carrierAmount','customerTax','carrierTax'];
const paymentNames = ['originals','edo','unit','conditions'];
const contactRoles = ['Заказчик','Экспедитор','Перевозчик','Водитель'];
const etrnKeys = ['required','manualComplete', ...etrnSteps.map(([key])=>key)];
const pending = order => ['К созданию','В работе'].includes(etrnStatus(order.etrn));
const splitLines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
const editor = $('editor');
const form = $('editor-form');
const importDialog = $('import-dialog');
const etrnDialog = $('etrn-dialog');
const etrnForm = $('etrn-form');
let orders = [];
let draft;
let previousNumber;
let etrnOrderNumber;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function action(text, onClick, className) {
  const button = node('button', text, className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

async function updateOrder(number, update) {
  const current = await store.list();
  const order = current.find(item => item.number === number);
  if (!order) throw new Error('Заявка больше не найдена в реестре.');
  const saved = upsert(current, update(order), number);
  await store.save(saved);
  orders = saved;
}

function tripControls(order) {
  const group = node('div', null, 'trip');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Этапы рейса № ' + order.number);
  for (const [key, title, short] of tripSteps) {
    const label = node('label', null, 'trip-mark');
    const input = node('input');
    input.type = 'checkbox';
    input.checked = Boolean(order.trip?.[key]);
    input.setAttribute('aria-label', title);
    label.append(input, node('span', short));
    input.addEventListener('change', async () => {
      const checked = input.checked;
      try {
        await updateOrder(order.number, current => markTrip(current, key, checked));
        $('notice').textContent = 'Этап рейса сохранён.';
      } catch (error) {
        input.checked = !checked;
        $('notice').textContent = error.message;
      }
    });
    group.append(label);
  }
  return group;
}

function render() {
  $('total').textContent = orders.length;
  $('pending').textContent = orders.filter(pending).length;
  const calculated = orders.filter(hasMargin);
  $('profit').textContent = calculated.length ? money(calculated.reduce((total, order) => total + profit(order).realProfit, 0)) : '—';
  const query = $('search').value.trim().toLocaleLowerCase('ru');
  const filter = $('filter').value;
  const matches = orders.filter(order => {
    const matchesText = [order.number, order.customer, order.carrier, order.driver, order.etrn?.number, ...order.points.map(point=>point.address)]
      .join(' ').toLocaleLowerCase('ru').includes(query);
    return matchesText && (!filter || (filter === 'pending' ? pending(order) : etrnStatus(order.etrn) === filter));
  });
  const table = $('table');
  table.replaceChildren();
  if (!matches.length) {
    const empty = node('div', null, 'empty');
    empty.append(node('h2', orders.length ? 'Заявки не найдены' : 'Заявок пока нет'),
      node('p', orders.length ? 'Измени поиск или фильтр.' : 'Импортируй два PDF Логистора или создай заявку вручную.'));
    table.append(empty);
    return;
  }
  const header = node('div', null, 'row table-head');
  for (const title of ['Заявка','Заказчик / перевозчик','Окно выгрузки','Этапы рейса','Маржа','ЭТРН']) header.append(node('span', title));
  table.append(header);
  for (const order of matches) {
    const row = node('div', null, 'row order');
    const label = node('span');
    const open = () => {
      const current = orders.find(item => item.number === order.number) ?? order;
      openEditor(current, current.number);
    };
    label.append(action('№ ' + order.number, open, 'order-link'),
      node('small', order.date ? order.date.split('-').reverse().join('.') : 'Дата не указана'));
    const names = node('span', null, 'names');
    names.append(action(order.customer || 'Заказчик не указан', open, 'name-link'), node('small', order.carrier || 'Перевозчик не указан'));
    const destination = order.points.filter(point => point.kind === 'Выгрузка').map(point => point.schedule).filter(Boolean).join(' / ');
    const etrn = action(etrnProgress(order.etrn), () => openEtrn(order.number), 'etrn-link');
    etrn.dataset.state = pending(order) ? 'pending' : 'regular';
    etrn.setAttribute('aria-label', 'ЭТРН заявки № ' + order.number + ': ' + etrnProgress(order.etrn));
    row.append(label, names, node('span', destination || 'Окно не указано', 'destination'),
      tripControls(order), node('strong', hasMargin(order) ? money(profit(order).realProfit) : '—', 'amount'), etrn);
    table.append(row);
  }
}

function profit(order) {
  return margin(order.customerAmount, order.customerTax, order.carrierAmount, order.carrierTax);
}

function editorPreview() {
  const values = Object.fromEntries(fieldNames.map(name => [name, form.elements[name].value]));
  const canCalculate = ['customerAmount','carrierAmount','customerTax','carrierTax'].every(key => values[key] !== '');
  const detail = $('margin-detail');
  detail.replaceChildren();
  if (canCalculate) {
    const result = profit(values);
    for (const [label, value] of [['После налога',result.realProfit],['Разница ставок',result.grossMargin],['НДС к уплате',result.vatPayable],['Налог на прибыль',result.profitTax]]) {
      const metric = node('div');
      metric.append(node('small', label), node('strong', money(value)));
      detail.append(metric);
    }
  } else detail.append(node('small','Укажи обе ставки и ставки НДС для расчёта.'));
  $('editor-etrn').textContent = etrnProgress(draft.etrn) + ' ↗';
}

function readEtrn() {
  return {...Object.fromEntries(etrnKeys.map(key => [key, etrnForm.elements[key].checked])),
    number: etrnForm.elements.etrnNumber.value.trim()};
}

function refreshEtrn() {
  const etrn = readEtrn();
  $('etrn-progress').textContent = etrnProgress(etrn);
  $('etrn-fields').hidden = !etrn.required;
  for (const group of $('steps').children) {
    const inputs = [...group.querySelectorAll('input')];
    const marked = inputs.every(input => input.checked);
    group.querySelector('button').textContent = marked ? 'Снять обе' : 'Отметить обе';
  }
}

function openEtrn(number = null) {
  const order = number === null ? draft : orders.find(item => item.number === number);
  if (!order) return;
  etrnOrderNumber = number;
  $('etrn-title').textContent = order.number ? 'ЭТРН · заявка № ' + order.number : 'ЭТРН';
  $('etrn-error').textContent = '';
  $('etrn-save').textContent = number === null ? 'Применить' : 'Сохранить';
  for (const key of etrnKeys) etrnForm.elements[key].checked = Boolean(order.etrn?.[key]);
  etrnForm.elements.etrnNumber.value = order.etrn?.number || '';
  refreshEtrn();
  etrnDialog.showModal();
}

function labelInput(label, value, multiline = false) {
  const wrapper = node('label', label);
  const input = node(multiline ? 'textarea' : 'input');
  input.value = value ?? '';
  if (multiline) input.rows = 2;
  wrapper.append(input);
  return [wrapper, input];
}

function phoneLinks(value) {
  const list = node('div', null, 'phones');
  for (const phone of phones(value)) {
    const link = node('a', phone);
    link.href = 'tel:' + phone;
    list.append(link);
  }
  return list;
}

function addPoint(point = {kind:'Погрузка'}) {
  const panel = node('div', null, 'point fields');
  panel.dataset.source = point.scheduleSource || '';
  panel.dataset.schedule = point.schedule || '';
  const kind = node('label','Тип точки');
  const select = node('select');
  for (const option of ['Погрузка','Выгрузка']) select.append(node('option',option));
  select.value = point.kind;
  select.dataset.field = 'kind';
  kind.append(select);
  const remove = node('button','Убрать точку','point-remove');
  remove.type = 'button';
  remove.addEventListener('click', () => panel.remove());
  panel.append(kind, remove);
  for (const [field, label, value] of [['address','Адрес',point.address],['schedule','Даты и время',point.schedule],['contacts','Контакты',point.contacts?.join('\n')]]) {
    const [wrapper, input] = labelInput(label, value, field === 'contacts');
    wrapper.className = 'wide';
    input.dataset.field = field;
    if (field === 'schedule' && point.scheduleSource) wrapper.append(node('small', 'Источник: ' + point.scheduleSource));
    if (field === 'contacts') wrapper.append(phoneLinks(value));
    panel.append(wrapper);
  }
  $('points').append(panel);
}

function openEditor(order, original = null) {
  draft = structuredClone(order);
  previousNumber = original;
  form.reset();
  $('editor-error').textContent = '';
  $('editor-title').textContent = order.number ? 'Заявка № ' + order.number : 'Новая заявка';
  for (const key of fieldNames) form.elements[key].value = order[key] ?? '';
  for (const key of paymentNames) form.elements[key].value = order.payment[key] ?? '';
  $('payment-source').textContent = order.payment.source ? 'Из PDF перевозчика: ' + order.payment.source : '';
  $('points').replaceChildren();
  order.points.forEach(addPoint);
  $('contacts').replaceChildren();
  for (const role of contactRoles) {
    const contact = order.contacts.find(item => item.role === role);
    const [wrapper, input] = labelInput(role, contact?.values.join('\n'), true);
    input.dataset.role = role;
    wrapper.append(phoneLinks(input.value));
    $('contacts').append(wrapper);
  }
  $('differences').hidden = !order.differences.length;
  $('difference-list').replaceChildren();
  for (const change of order.differences) {
    const box = node('div', null, 'difference');
    box.append(node('strong', change.field), node('p','Заказчик: ' + change.customer), node('p','Перевозчик: ' + change.carrier));
    $('difference-list').append(box);
  }
  editorPreview();
  editor.showModal();
}

function readDraft() {
  const order = {...draft};
  for (const key of fieldNames) {
    const input = form.elements[key];
    order[key] = input.type === 'number' ? (input.value === '' ? null : input.valueAsNumber) : input.value.trim();
  }
  for (const key of paymentNames) {
    const input = form.elements[key];
    order.payment[key] = input.type === 'number' ? (input.value === '' ? null : input.valueAsNumber) : input.value.trim();
  }
  order.points = [...$('points').children].map(panel => {
    const values = Object.fromEntries([...panel.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el.value.trim()]));
    return {...values, contacts:splitLines(values.contacts), scheduleSource:values.schedule === panel.dataset.schedule ? panel.dataset.source : 'Вручную'};
  });
  order.contacts = [...$('contacts').querySelectorAll('[data-role]')].map(input => ({
    role: input.dataset.role,
    name: draft.contacts.find(contact => contact.role === input.dataset.role)?.name || '',
    values: splitLines(input.value),
  }));
  return order;
}

for (const [phase, entries] of [['Погрузка', etrnSteps.slice(1,3)], ['Выгрузка', etrnSteps.slice(3)]]) {
  const group = node('fieldset', null, 'etrn-group');
  const inputs = [];
  group.append(node('legend', phase));
  for (const [key, title] of entries) {
    const label = node('label', null, 'check');
    const input = node('input');
    input.type = 'checkbox';
    input.name = key;
    input.setAttribute('aria-label', title);
    inputs.push(input);
    label.append(input, {sender:'Грузоотправитель', recipient:'Грузополучатель'}[key] || 'Перевозчик');
    group.append(label);
  }
  const quick = action('Отметить обе', () => {
    const checked = !inputs.every(input => input.checked);
    for (const input of inputs) input.checked = checked;
    refreshEtrn();
  }, 'quick');
  quick.setAttribute('aria-label', 'Переключить обе подписи: ' + phase.toLowerCase());
  group.append(quick);
  $('steps').append(group);
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
$('search').addEventListener('input', render);
$('filter').addEventListener('change', render);
$('add-point').addEventListener('click', () => addPoint());
$('new').addEventListener('click', () => openEditor(blankOrder()));
$('editor-etrn').addEventListener('click', () => openEtrn());
etrnForm.addEventListener('input', refreshEtrn);
etrnForm.addEventListener('submit', async event => {
  event.preventDefault();
  const etrn = readEtrn();
  try {
    if (etrnOrderNumber === null) {
      draft.etrn = etrn;
      editorPreview();
    } else {
      await updateOrder(etrnOrderNumber, order => ({...order, etrn}));
      render();
      $('notice').textContent = 'Статус ЭТРН сохранён.';
    }
    etrnDialog.close();
  } catch (error) { $('etrn-error').textContent = error.message; }
});
$('import').addEventListener('click', () => {
  $('import-form').reset();
  $('import-error').textContent = '';
  importDialog.showModal();
});
form.addEventListener('input', editorPreview);
form.addEventListener('submit', async event => {
  event.preventDefault();
  $('editor-error').textContent = '';
  try {
    const saved = upsert(await store.list(), readDraft(), previousNumber);
    await store.save(saved);
    orders = saved;
    editor.close();
    render();
    $('notice').textContent = 'Заявка сохранена на этом устройстве.';
  } catch (error) { $('editor-error').textContent = error.message; }
});
$('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  const files = [$('customer-pdf').files[0], $('carrier-pdf').files[0]];
  const submit = event.submitter;
  $('import-error').textContent = '';
  if (files.some(file => !file)) {
    $('import-error').textContent = 'Выбери ровно два PDF.';
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Читаем PDF…';
  try {
    const { readPdf } = await import('./pdf.mjs');
    const imported = importPair(...await Promise.all(files.map(readPdf)));
    const current = (await store.list()).find(item => item.number === imported.number);
    importDialog.close();
    openEditor(mergeImport(imported, current), current?.number ?? null);
  } catch (error) {
    $('import-error').textContent = error.message || 'Не удалось прочитать PDF.';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Проверить и открыть заявку';
  }
});

store.list().then(saved => { orders = saved; render(); }).catch(error => { $('notice').textContent = error.message; });
