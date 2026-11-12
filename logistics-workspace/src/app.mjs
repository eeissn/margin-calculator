import './style.css';
import { blankOrder, etrnSteps, etrnStatus, hasMargin, margin, upsert } from './domain.mjs';
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
let orders = [];
let draft;
let previousNumber;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
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
  for (const title of ['Заявка','Заказчик / перевозчик','Выгрузка','Маржа','ЭТРН']) header.append(node('span', title));
  table.append(header);
  for (const order of matches) {
    const row = node('button', null, 'row order');
    row.type = 'button';
    const label = node('span');
    label.append(node('strong', '№ ' + order.number), node('small', order.date ? order.date.split('-').reverse().join('.') : 'Дата не указана'));
    const names = node('span');
    names.append(node('strong', order.customer || 'Заказчик не указан'), node('small', order.carrier || 'Перевозчик не указан'));
    const destination = order.points.filter(point => point.kind === 'Выгрузка').map(point => point.schedule).filter(Boolean).join(' / ');
    row.append(label, names, node('span', destination || 'Окно не указано', 'destination'), node('strong', hasMargin(order) ? money(profit(order).realProfit) : '—', 'amount'), node('span', etrnStatus(order.etrn), 'pill'));
    row.addEventListener('click', () => openEditor(order, order.number));
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
  $('etrn-status').textContent = etrnStatus(readEtrn());
}

function readEtrn() {
  return {...Object.fromEntries(etrnKeys.map(key => [key, form.elements[key].checked])), number: form.elements.etrnNumber.value.trim()};
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
  for (const key of etrnKeys) form.elements[key].checked = Boolean(order.etrn[key]);
  form.elements.etrnNumber.value = order.etrn.number || '';
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
  order.etrn = readEtrn();
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

for (const [key, title] of etrnSteps) {
  const label = node('label', null, 'check');
  const input = node('input');
  input.type = 'checkbox';
  input.name = key;
  label.append(input, title);
  $('steps').append(label);
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
$('search').addEventListener('input', render);
$('filter').addEventListener('change', render);
$('add-point').addEventListener('click', () => addPoint());
$('new').addEventListener('click', () => openEditor(blankOrder()));
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
  const files = [...$('pdfs').files];
  const submit = event.submitter;
  $('import-error').textContent = '';
  if (files.length !== 2) {
    $('import-error').textContent = 'Выбери ровно два PDF.';
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Читаем PDF…';
  try {
    const { readPdf } = await import('./pdf.mjs');
    const order = importPair(...await Promise.all(files.map(readPdf)));
    const current = (await store.list()).find(item => item.number === order.number);
    if (current) {
      const {required, ...progress} = current.etrn;
      order.etrn = {...order.etrn, ...progress, required: required || order.etrn.required};
    }
    importDialog.close();
    openEditor(order, current?.number ?? null);
  } catch (error) {
    $('import-error').textContent = error.message || 'Не удалось прочитать PDF.';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Проверить и открыть заявку';
  }
});

store.list().then(saved => { orders = saved; render(); }).catch(error => { $('notice').textContent = error.message; });
