import { mockCall } from './mock.js';

export class ApiError extends Error {
  constructor({ code, message, data }) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/** Ошибки связи: в них можно работать из кэша и черновиков. */
export const isOffline = e => e && (e.code === 'OFFLINE' || e.code === 'TIMEOUT');

/**
 * Вызов Apps Script. Тело уходит как text/plain — это «простой» запрос без CORS-preflight,
 * который Apps Script принимает.
 */
export function createApi(getCfg) {
  /**
   * Изредка Google теряет тело запроса на перенаправлении, и ответ приходит как на пустой GET
   * (NO_ACTION) или не JSON. Такой запрос до скрипта не дошёл — его можно спокойно повторить один раз.
   */
  return async function call(action, params = {}) {
    try {
      return await once(action, params);
    } catch (e) {
      if (e.code !== 'NO_ACTION' && e.code !== 'BAD_RESPONSE') throw e;
      await new Promise(r => setTimeout(r, 800));
      return once(action, params);
    }
  };

  async function once(action, params) {
    const { url, key } = getCfg();
    if (!url) throw new ApiError({ code: 'NO_CONFIG', message: 'Не настроено подключение к таблице' });
    if (url === 'demo') return mockCall(action, params);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ ...params, action, key }),
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ApiError(e.name === 'AbortError'
        ? { code: 'TIMEOUT', message: 'Таблица долго не отвечает' }
        : { code: 'OFFLINE', message: 'Нет связи с таблицей' });
    } finally {
      clearTimeout(timer);
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new ApiError({
        code: 'BAD_RESPONSE',
        message: 'Ответ не похож на API. Проверьте URL (/exec) и доступ «Все» в развертывании',
      });
    }
    if (!json.ok) throw new ApiError(json.error);
    return json.data;
  }
}
