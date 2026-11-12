export const etrnSteps = [
  ['created', 'Создана ЭТРН'],
  ['sender', 'Подписал грузоотправитель · погрузка'],
  ['pickupCarrier', 'Подписал перевозчик · погрузка'],
  ['recipient', 'Подписал грузополучатель · выгрузка'],
  ['deliveryCarrier', 'Подписал перевозчик · выгрузка'],
];

export function margin(customerAmount, customerTax, carrierAmount, carrierTax) {
  const incoming = parseFloat(customerAmount) || 0;
  const outgoing = parseFloat(carrierAmount) || 0;
  const net = (amount, tax) => tax === '22' ? amount / 1.22 : tax === '5' ? amount / 1.05 : amount;
  const deduct = customerTax === '22' && carrierTax !== '0';
  const netCustomer = net(incoming, customerTax);
  const netCarrier = deduct ? net(outgoing, carrierTax) : outgoing;
  const netMargin = netCustomer - netCarrier;
  const taxRate = customerTax === '22' ? 0.25 : 0.15;
  const profitTax = netMargin * taxRate;
  return {
    grossMargin: incoming - outgoing, netMargin, profitTax, taxRate,
    realProfit: netMargin - profitTax,
    vatPayable: incoming - netCustomer - (deduct ? outgoing - netCarrier : 0),
  };
}

export function etrnStatus(etrn) {
  if (etrn?.manualComplete) return 'Закрыта вручную';
  if (!etrn?.required) return 'Не требуется';
  if (etrn.number?.trim() && etrnSteps.every(([id]) => etrn[id])) return 'Подписана';
  if (etrn.created) return 'В работе';
  return 'К созданию';
}

export const blankOrder = () => ({
  number: '', date: '', customer: '', carrier: '', driver: '', vehicle: '', cargo: '',
  customerAmount: null, carrierAmount: null, customerTax: '', carrierTax: '',
  payment: {originals: null, edo: null, unit: '', conditions: ''},
  points: [], contacts: [], differences: [],
  etrn: {required: false, number: '', manualComplete: false},
});

export function upsert(orders, draft, previousNumber = null) {
  const number = draft.number.trim();
  if (!number) throw new Error('Укажите номер заявки.');
  if (orders.some(order => order.number === number && order.number !== previousNumber)) {
    throw new Error('Заявка с этим номером уже есть. Откройте её из реестра.');
  }
  const next = {...draft, number, updatedAt: new Date().toISOString()};
  return previousNumber === null ? [next, ...orders] : orders.map(order => order.number === previousNumber ? next : order);
}

export function hasMargin(order) {
  return order.customerAmount != null && order.carrierAmount != null && order.customerTax !== '' && order.carrierTax !== '';
}
