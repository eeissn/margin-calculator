const KEY = 'logistics-workspace:v1';
export const store = {
  async list() {
    const data = localStorage.getItem(KEY);
    if (!data) return [];
    const decoded = JSON.parse(data);
    if (decoded.version !== 1 || !Array.isArray(decoded.orders)) throw new Error('Неизвестный формат сохранённых заявок.');
    return decoded.orders;
  },
  async save(orders) {
    localStorage.setItem(KEY, JSON.stringify({version: 1, orders}));
  },
};
