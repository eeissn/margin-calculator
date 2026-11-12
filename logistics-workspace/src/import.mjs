import { blankOrder } from './domain.mjs';

const fold = value => value.toLocaleLowerCase('ru').replace(/[^\p{L}\d]/gu, '');
const unique = values => [...new Set(values.filter(Boolean))];
const trim = value => value?.replace(/\s+/g, ' ').trim() || '';
const phonePattern = /(?:\+7|8)[ \t(-]*\d{3}[ \t)-]*\d{3}[ \t-]*\d{2}[ \t-]*\d{2}/g;

export function phones(value = '') {
  return unique([...value.matchAll(phonePattern)].map(([phone]) => '+7' + phone.replace(/\D/g, '').slice(-10)));
}

function party(text, role) {
  const pattern = new RegExp('^' + role + ':[ \\t]*([^\\n]*)\\n(?:[ \\t]*Контактное лицо:[ \\t]*(?:Тел\\./факс:[ \\t]*)?([^\\n]*))?', 'mi');
  const match = text.match(pattern);
  return {name: trim(match?.[1]), contact: trim(match?.[2])};
}

function pointsFrom(text) {
  const route = text.split(/^\s*ИНФОРМАЦИЯ О ГРУЗЕ:/mi)[0];
  const sections = [...route.matchAll(/^[ \t]*(ПОГРУЗКА|ВЫГРУЗКА):([^\n]*)/gmi)];
  return sections.map((match, index) => {
    const body = route.slice(match.index + match[0].length, sections[index + 1]?.index);
    const address = trim(body.split(/^[ \t]*(?:Контакт:|Дата и время:|Доп\.требования:)/mi)[0]);
    return {
      kind: match[1].toUpperCase() === 'ПОГРУЗКА' ? 'Погрузка' : 'Выгрузка',
      address: [trim(match[2]), address].filter(Boolean).join(' · '),
      schedule: trim(body.match(/^[ \t]*Дата и время:[ \t]*([^\n]*)/mi)?.[1]),
      contacts: unique([...body.matchAll(/^[ \t]*Контакт:[ \t]*([^\n]*)/gmi)].map(match => trim(match[1]))),
    };
  });
}

export function parseLogistor(text) {
  const clean = text.replace(/\r/g, '').replace(/\u00a0/g, ' ');
  const heading = clean.match(/(?:Договор[-–]\s*)?Заявка\s*№\s*(\d+)\s+от\s+(\d{2}\.\d{2}\.\d{4})/i);
  const head = clean.split(/^[ \t]*(?:ПОГРУЗКА|ВЫГРУЗКА):/mi)[0];
  const paymentLine = trim(clean.match(/^[ \t]*ОПЛАТА:[ \t]*([^\n]+)/mi)?.[1]);
  const stake = paymentLine.match(/^(\d[\d ]*(?:[,.]\d+)?)\s*(?:руб|₽)/i);
  const tax = /без\s+НДС/i.test(paymentLine) ? '0' : paymentLine.match(/НДС\s*(22|5)\s*%/i)?.[1] ?? '';
  const [day, month, year] = (heading?.[2] || '').split('.');
  const fields = {
    number: heading?.[1] || '', date: heading ? `${year}-${month}-${day}` : '',
    customer: party(head, 'Заказчик'), performer: party(head, 'Исполнитель'),
    points: pointsFrom(clean),
    driver: trim(clean.match(/^[ \t]*ФИО:[ \t]*(.*?)(?:[ \t]{2,}Марка тягача:|$)/mi)?.[1]),
    driverContact: trim(clean.match(/^[ \t]*Контактный телефон:[ \t]*(.*?)(?:[ \t]{2,}Номер прицепа:|$)/mi)?.[1]),
    vehicle: [
      trim(clean.match(/Марка тягача:[ \t]*([^\n]+)/i)?.[1]),
      trim(clean.match(/Номер тягача:[ \t]*([^\n]+)/i)?.[1]),
      trim(clean.match(/Номер прицепа:[ \t]*([^\n]+)/i)?.[1]),
    ].filter(Boolean).join(' · '),
    cargo: trim(clean.match(/^[ \t]*([^\n]+\d[,.]\d+[^\n]*паллет[^\n]*)/mi)?.[1]),
    amount: stake ? Number(stake[1].replace(/ /g, '').replace(',', '.')) : null,
    tax, paymentLine, clean,
  };
  if (!fields.number || !fields.customer.name || !fields.performer.name) {
    throw new Error('Не удалось прочитать номер и стороны заявки Логистора. Нужен PDF с текстовым слоем.');
  }
  return fields;
}

function carrierPayment(doc) {
  const {paymentLine, clean} = doc;
  const days = pattern => {
    const count = paymentLine.match(pattern)?.[1];
    return count ? Number(count) : null;
  };
  const conditions = [];
  const extra = clean.match(/увеличен\s+на\s+(\d+)\s+банковских\s+дней/i);
  if (extra) conditions.push(`Без предварительных сканов срок увеличивается на ${extra[1]} банковских дней.`);
  if (/оплата перевозки производится во вторник и пятницу/i.test(clean)) {
    conditions.push('Оплата во вторник и пятницу при наличии полного комплекта документов в одном письме.');
  }
  return {
    originals: days(/по\s+оригинал(?:ам|у)\s*[-–—:]?\s*(\d+)/i),
    edo: days(/по\s+ЭДО\s*[-–—:]?\s*(\d+)/i),
    unit: /банковск/i.test(paymentLine) ? 'банковских дней' : /календарн/i.test(paymentLine) ? 'календарных дней' : '',
    conditions: conditions.join(' '),
    source: paymentLine,
  };
}

export function importPair(firstText, secondText) {
  const first = parseLogistor(firstText);
  const second = parseLogistor(secondText);
  if (first.number !== second.number) throw new Error(`Номера документов различаются: №${first.number} и №${second.number}.`);
  const isChain = (customerDoc, carrierDoc) => fold(customerDoc.performer.name) === fold(carrierDoc.customer.name)
    && fold(customerDoc.customer.name) !== fold(carrierDoc.performer.name);
  const forward = isChain(first, second);
  const reverse = isChain(second, first);
  if (forward === reverse) throw new Error('Не удалось определить пару «заказчик → экспедитор → перевозчик». Проверьте оба PDF.');
  const [customer, carrier] = forward ? [first, second] : [second, first];
  const differences = [];
  const points = [];
  for (const kind of ['Погрузка', 'Выгрузка']) {
    const a = customer.points.filter(point => point.kind === kind);
    const b = carrier.points.filter(point => point.kind === kind);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const left = a[i], right = b[i];
      const label = `${kind}${Math.max(a.length, b.length) > 1 ? ' ' + (i + 1) : ''}`;
      for (const [key, field] of [['schedule', 'даты и время'], ['address', 'адрес']]) {
        if (left?.[key] && right?.[key] && fold(left[key]) !== fold(right[key])) {
          differences.push({field: `${label} · ${field}`, customer: left[key], carrier: right[key]});
        }
      }
      points.push({
        kind, address: right?.address || left?.address || '',
        schedule: right?.schedule || left?.schedule || '',
        scheduleSource: right?.schedule ? 'Перевозчик' : left?.schedule ? 'Заказчик' : '',
        contacts: unique([...(right?.contacts || []), ...(left?.contacts || [])]),
      });
    }
  }
  if (customer.date !== carrier.date) differences.push({field: 'Дата заявки', customer: customer.date, carrier: carrier.date});
  const contactGroups = [
    ['Заказчик', customer.customer.name, customer.customer.contact],
    ['Экспедитор', customer.performer.name, customer.performer.contact, carrier.customer.contact],
    ['Перевозчик', carrier.performer.name, carrier.performer.contact],
    ['Водитель', carrier.driver || customer.driver, carrier.driverContact, customer.driverContact],
  ];
  return {
    ...blankOrder(), number: customer.number, date: carrier.date,
    customer: customer.customer.name, carrier: carrier.performer.name,
    driver: carrier.driver || customer.driver, vehicle: carrier.vehicle || customer.vehicle,
    cargo: carrier.cargo || customer.cargo,
    customerAmount: customer.amount, carrierAmount: carrier.amount,
    customerTax: customer.tax, carrierTax: carrier.tax,
    contacts: contactGroups.map(([role, name, ...values]) => ({role, name, values: unique(values)})),
    points, differences, payment: carrierPayment(carrier),
    etrn: {...blankOrder().etrn, required: /ЭТРН/i.test(carrier.clean)},
  };
}
