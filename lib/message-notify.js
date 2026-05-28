const path = require('path');

const COUNT_ENDPOINT = '/purr-pause/v1/todos/count';
const LIST_ENDPOINT = '/purr-pause/v1/todos';
const REQUEST_TIMEOUT_MS = 5000;
const KNOWN_ID_LIMIT = 2000;
const NOTIFY_SIZE = 240;
const NOTIFY_DURATION_MS = 7000;
const NOTIFY_LABEL = '待办消息';
const SOURCE_PALETTE = ['#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#eb5757', '#00a7a7'];

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeConfig(config) {
  return {
    messageNotifyEnabled: !!config.messageNotifyEnabled,
    messageApiBaseUrl: String(config.messageApiBaseUrl || '').trim(),
    messageAuthHeaders: String(config.messageAuthHeaders || '{}').trim() || '{}',
    messagePollInterval: clampNumber(config.messagePollInterval, 10, 3600, 60),
    messageListLimit: clampNumber(config.messageListLimit, 1, 100, 50),
    messageMaxCacheItems: clampNumber(config.messageMaxCacheItems, 10, 99, 99),
    messageNotifyVideo: String(config.messageNotifyVideo || 'notify-rocket.webm').trim() || 'notify-rocket.webm',
    messageNotifyAnimation: config.messageNotifyAnimation === 'rocket-corner' ? 'rocket-corner' : 'rocket-corner'
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function isSafeTargetUrl(value) {
  return isHttpUrl(value);
}

function parseHeaders(value) {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求头必须是 JSON 对象');
  }

  const headers = Object.create(null);
  for (const [key, rawValue] of Object.entries(parsed)) {
    const name = String(key || '').trim();
    if (!name) continue;
    if (rawValue === undefined || rawValue === null) continue;
    headers[name] = String(rawValue);
  }
  return headers;
}

function hashToPaletteIndex(value) {
  let hash = 0;
  const str = String(value || 'unknown');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SOURCE_PALETTE.length;
}

function safeColor(color, sourceId) {
  const value = String(color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return SOURCE_PALETTE[hashToPaletteIndex(sourceId)];
}

function toTimestamp(item) {
  const value = Date.parse(item.updatedAt || item.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function normalizeItem(raw, order) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  if (!id || !title) return null;

  const status = raw.status ? String(raw.status).trim() : 'pending';
  if (status !== 'pending' && status !== 'processing') return null;

  const targetUrl = String(raw.targetUrl || '').trim();
  if (!isSafeTargetUrl(targetUrl)) return null;

  const source = raw.source && typeof raw.source === 'object' ? raw.source : {};
  const sourceId = String(source.id || 'unknown').trim() || 'unknown';
  const sourceName = String(source.name || '未知来源').trim() || '未知来源';

  return {
    id,
    title,
    summary: raw.summary ? String(raw.summary) : '',
    source: {
      id: sourceId,
      name: sourceName,
      color: safeColor(source.color, sourceId)
    },
    level: raw.level ? String(raw.level) : 'normal',
    status,
    createdAt: raw.createdAt ? String(raw.createdAt) : '',
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : '',
    targetUrl,
    _order: order
  };
}

function countSignature(data) {
  return [
    Number.isFinite(data.total) ? data.total : 0,
    Number.isFinite(data.unread) ? data.unread : '',
    data.latestChangedAt || '',
    data.version || ''
  ].join('|');
}

function badgeCountFromCount(data) {
  if (Number.isFinite(data.unread)) return Math.max(0, data.unread);
  return Math.max(0, Number.isFinite(data.total) ? data.total : 0);
}

function sanitizeHeadersForLog(headers) {
  if (!headers || typeof headers !== 'object') return '[]';
  return '[' + Object.keys(headers).join(',') + ']';
}

async function fetchWithDetails(url, headers) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: '当前运行环境不支持 fetch' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      return { ok: false, error: '响应不是合法 JSON', status: response.status };
    }
    if (!response.ok) {
      const detail = body && body.message ? '：' + body.message : '';
      return { ok: false, error: 'HTTP ' + response.status + detail, status: response.status };
    }
    if (!body || body.code !== 0) {
      return { ok: false, error: (body && body.message) || '第三方接口返回失败 (code=' + (body && body.code) + ')', status: response.status };
    }
    return { ok: true, data: body.data || {}, status: response.status };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, error: '请求超时（' + (REQUEST_TIMEOUT_MS / 1000) + ' 秒）' };
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function testConnection(rawConfig, logger) {
  const log = (logger && typeof logger.info === 'function') ? logger : { info: () => {}, warn: () => {} };
  const norm = normalizeConfig(rawConfig || {});

  if (!isHttpUrl(norm.messageApiBaseUrl)) {
    log.warn('[消息提醒][测试] 校验失败：服务地址不是 http/https URL');
    return { ok: false, error: '服务地址必须是 http 或 https URL' };
  }

  let headers;
  try {
    headers = parseHeaders(norm.messageAuthHeaders);
  } catch (e) {
    log.warn('[消息提醒][测试] 校验失败：请求头解析失败 ' + (e && e.message ? e.message : String(e)));
    return { ok: false, error: '请求头解析失败：' + (e && e.message ? e.message : String(e)) };
  }

  const reqHeaders = { Accept: 'application/json', ...headers };
  const countUrl = new URL(COUNT_ENDPOINT, norm.messageApiBaseUrl);
  log.info('[消息提醒][测试] 开始测试 baseUrl=' + norm.messageApiBaseUrl + ', headers=' + sanitizeHeadersForLog(headers));
  log.info('[消息提醒][测试] GET ' + countUrl.toString());
  const countResult = await fetchWithDetails(countUrl, reqHeaders);
  if (!countResult.ok) {
    log.warn('[消息提醒][测试] count 失败：' + countResult.error);
    return { ok: false, count: countResult, list: null };
  }
  log.info('[消息提醒][测试] count 成功 total=' + (countResult.data && countResult.data.total) + ', unread=' + (countResult.data && countResult.data.unread) + ', version=' + ((countResult.data && countResult.data.version) || '-'));

  const listUrl = new URL(LIST_ENDPOINT, norm.messageApiBaseUrl);
  listUrl.searchParams.set('limit', String(norm.messageMaxCacheItems));
  listUrl.searchParams.set('offset', '0');
  log.info('[消息提醒][测试] GET ' + listUrl.toString());
  const listResult = await fetchWithDetails(listUrl, reqHeaders);
  if (!listResult.ok) {
    log.warn('[消息提醒][测试] list 失败：' + listResult.error);
    return { ok: false, count: countResult, list: listResult };
  }
  const itemCount = Array.isArray(listResult.data && listResult.data.items) ? listResult.data.items.length : 0;
  log.info('[消息提醒][测试] list 成功 items=' + itemCount);

  return { ok: true, count: countResult, list: listResult };
}

function createMessageNotify(initialConfig, deps) {
  const state = {
    config: normalizeConfig(initialConfig || {}),
    timer: null,
    countInFlight: false,
    listInFlight: false,
    destroyed: false,
    lastCountSignature: null,
    lastCountData: null,
    firstSync: true,
    consecutiveFailures: 0,
    lastError: '',
    lastRefreshAt: '',
    total: 0,
    badgeCount: 0,
    snapshot: [],
    knownIds: new Set(),
    knownIdQueue: [],
    listWin: null,
    notifyWin: null,
    notifyTimer: null,
    pendingAnimationCount: 0
  };

  const logger = deps.logger;

  function logInfo(message) {
    if (logger && logger.info) logger.info(message);
  }

  function logWarn(message) {
    if (logger && logger.warn) logger.warn(message);
  }

  function logError(message) {
    if (logger && logger.error) logger.error(message);
  }

  function isEnabled() {
    return !!state.config.messageNotifyEnabled && isHttpUrl(state.config.messageApiBaseUrl);
  }

  function setBadgeCount(count) {
    const next = Math.max(0, Number.parseInt(count, 10) || 0);
    if (state.badgeCount === next) return;
    logInfo('[消息提醒] 角标变化: ' + state.badgeCount + ' -> ' + next);
    state.badgeCount = next;
    if (typeof deps.onBadgeChange === 'function') deps.onBadgeChange(next);
    sendListState();
  }

  function getEndpoint(pathname) {
    return new URL(pathname, state.config.messageApiBaseUrl);
  }

  function getRequestHeaders() {
    return {
      Accept: 'application/json',
      ...parseHeaders(state.config.messageAuthHeaders)
    };
  }

  async function fetchJson(url) {
    if (typeof fetch !== 'function') {
      throw new Error('当前运行环境不支持 fetch');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: getRequestHeaders(),
        signal: controller.signal
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (e) {
        throw new Error('响应不是合法 JSON');
      }

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      if (!body || body.code !== 0) {
        throw new Error((body && body.message) || '第三方接口返回失败');
      }
      return body.data || {};
    } finally {
      clearTimeout(timeout);
    }
  }

  function recordSuccess() {
    state.consecutiveFailures = 0;
    state.lastError = '';
  }

  function recordFailure(context, err) {
    state.consecutiveFailures += 1;
    const message = err && err.message ? err.message : String(err);
    state.lastError = context + '失败：' + message;
    logWarn('[消息提醒] ' + state.lastError + '（连续失败 ' + state.consecutiveFailures + ' 次）');
    sendListState();
  }

  function effectivePollIntervalMs() {
    const base = state.config.messagePollInterval;
    if (state.consecutiveFailures < 5) return base * 1000;
    const backedOff = Math.min(300, base * Math.pow(2, state.consecutiveFailures - 4));
    return backedOff * 1000;
  }

  function clearPollTimer() {
    if (!state.timer) return;
    clearTimeout(state.timer);
    state.timer = null;
  }

  function scheduleNextPoll(delayMs) {
    clearPollTimer();
    if (state.destroyed || !isEnabled()) return;
    state.timer = setTimeout(() => {
      pollCount().catch((err) => {
        recordFailure('轮询待办数量', err);
      });
    }, delayMs);
    if (state.timer.unref) state.timer.unref();
  }

  async function fetchCount() {
    const data = await fetchJson(getEndpoint(COUNT_ENDPOINT));
    return {
      total: Math.max(0, Number.parseInt(data.total, 10) || 0),
      unread: data.unread === undefined ? undefined : Math.max(0, Number.parseInt(data.unread, 10) || 0),
      latestChangedAt: data.latestChangedAt ? String(data.latestChangedAt) : '',
      version: data.version ? String(data.version) : ''
    };
  }

  async function fetchList() {
    const url = getEndpoint(LIST_ENDPOINT);
    url.searchParams.set('limit', String(state.config.messageMaxCacheItems));
    url.searchParams.set('offset', '0');
    const data = await fetchJson(url);
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems
      .map((item, index) => normalizeItem(item, index))
      .filter(Boolean)
      .sort((a, b) => {
        const timeDiff = toTimestamp(b) - toTimestamp(a);
        return timeDiff || a._order - b._order;
      })
      .slice(0, state.config.messageMaxCacheItems)
      .map((item) => {
        const normalized = { ...item };
        delete normalized._order;
        return normalized;
      });

    return {
      total: Math.max(0, Number.parseInt(data.total, 10) || items.length),
      items
    };
  }

  function rememberKnownIds(items) {
    for (const item of items) {
      if (state.knownIds.has(item.id)) continue;
      state.knownIds.add(item.id);
      state.knownIdQueue.push(item.id);
    }

    while (state.knownIdQueue.length > KNOWN_ID_LIMIT) {
      const oldId = state.knownIdQueue.shift();
      state.knownIds.delete(oldId);
    }
  }

  function getPublicState() {
    const limit = state.config.messageListLimit;
    const shownItems = state.snapshot.slice(0, limit);
    const total = Math.max(state.total, state.snapshot.length);
    return {
      enabled: !!state.config.messageNotifyEnabled,
      configured: isHttpUrl(state.config.messageApiBaseUrl),
      total,
      badgeCount: state.badgeCount,
      items: shownItems,
      itemCount: state.snapshot.length,
      hiddenCount: Math.max(0, total - shownItems.length),
      maxCacheItems: state.config.messageMaxCacheItems,
      listLimit: limit,
      pollInterval: state.config.messagePollInterval,
      lastRefreshAt: state.lastRefreshAt,
      lastError: state.lastError,
      loading: state.countInFlight || state.listInFlight,
      backoff: state.consecutiveFailures >= 5
    };
  }

  function sendListState() {
    if (!state.listWin || state.listWin.isDestroyed()) return;
    state.listWin.webContents.send('messages-state', getPublicState());
  }

  async function refreshList(options = {}) {
    if (!isEnabled()) {
      state.lastError = state.config.messageNotifyEnabled ? '服务地址无效' : '';
      sendListState();
      return { newCount: 0, items: state.snapshot };
    }
    if (state.listInFlight) return { newCount: 0, items: state.snapshot };

    state.listInFlight = true;
    sendListState();
    try {
      const data = await fetchList();
      const newItems = data.items.filter((item) => !state.knownIds.has(item.id));
      state.snapshot = data.items;
      state.total = data.total;
      state.lastRefreshAt = new Date().toISOString();
      rememberKnownIds(data.items);
      recordSuccess();
      logInfo('[消息提醒] 列表刷新成功: total=' + data.total + ', items=' + data.items.length + ', 新增=' + newItems.length + (options.suppressNotification ? '（静默）' : ''));

      if (state.lastCountData) {
        setBadgeCount(badgeCountFromCount(state.lastCountData));
      } else {
        setBadgeCount(data.total);
      }

      return {
        newCount: options.suppressNotification ? 0 : newItems.length,
        items: data.items
      };
    } catch (err) {
      recordFailure(options.manual ? '刷新待办列表' : '拉取待办列表', err);
      throw err;
    } finally {
      state.listInFlight = false;
      sendListState();
    }
  }

  function clearSnapshot() {
    state.snapshot = [];
    state.total = 0;
    state.lastRefreshAt = new Date().toISOString();
    sendListState();
  }

  async function handleCountData(data) {
    const signature = countSignature(data);
    const changed = state.lastCountSignature !== null && state.lastCountSignature !== signature;
    state.lastCountSignature = signature;
    state.lastCountData = data;
    state.total = data.total;
    setBadgeCount(badgeCountFromCount(data));

    if (data.total === 0) {
      logInfo('[消息提醒] count.total=0, 清空快照');
      clearSnapshot();
      return;
    }

    if (state.firstSync) {
      state.firstSync = false;
      logInfo('[消息提醒] 首次同步, 建立基线（不播放动画）');
      try {
        await refreshList({ suppressNotification: true });
      } catch (e) {}
      return;
    }

    if (!changed) {
      logInfo('[消息提醒] count signature 未变化, 不刷新列表');
      return;
    }

    logInfo('[消息提醒] count signature 变化, 刷新列表');
    try {
      const result = await refreshList({ suppressNotification: false });
      if (result.newCount > 0) {
        playNotification(result.newCount);
      } else {
        logInfo('[消息提醒] 列表已刷新但无新增, 不播放动画');
      }
    } catch (e) {}
  }

  async function pollCount() {
    if (state.destroyed || !isEnabled() || state.countInFlight) return;
    state.countInFlight = true;
    sendListState();
    const url = getEndpoint(COUNT_ENDPOINT);
    logInfo('[消息提醒] 开始轮询 GET ' + url.toString());
    try {
      const data = await fetchCount();
      logInfo('[消息提醒] count 响应: total=' + data.total + ', unread=' + (data.unread === undefined ? '-' : data.unread) + ', version=' + (data.version || '-') + ', latestChangedAt=' + (data.latestChangedAt || '-'));
      recordSuccess();
      await handleCountData(data);
    } catch (err) {
      recordFailure('轮询待办数量', err);
    } finally {
      state.countInFlight = false;
      sendListState();
      scheduleNextPoll(effectivePollIntervalMs());
    }
  }

  function closeNotification() {
    if (state.notifyTimer) {
      clearTimeout(state.notifyTimer);
      state.notifyTimer = null;
    }
    if (state.notifyWin && !state.notifyWin.isDestroyed()) {
      const win = state.notifyWin;
      state.notifyWin = null;
      win.hide();
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.destroy();
      }, 30);
      return;
    }
    state.notifyWin = null;
  }

  function maybeReplayPendingNotification() {
    if (state.pendingAnimationCount <= 0) return;
    if (typeof deps.isRestOverlayShowing === 'function' && deps.isRestOverlayShowing()) return;
    const count = state.pendingAnimationCount;
    state.pendingAnimationCount = 0;
    playNotification(count);
  }

  function playNotification(count) {
    if (!isEnabled() || count <= 0) return;
    if (typeof deps.isRestOverlayShowing === 'function' && deps.isRestOverlayShowing()) {
      state.pendingAnimationCount += count;
      logInfo('[消息提醒] 跳过动画: 休息覆盖层显示中, 挂起 pending=' + state.pendingAnimationCount);
      return;
    }
    if (state.notifyWin && !state.notifyWin.isDestroyed()) {
      state.pendingAnimationCount += count;
      logInfo('[消息提醒] 跳过动画: 已有动画播放中, 挂起 pending=' + state.pendingAnimationCount);
      return;
    }

    logInfo('[消息提醒] 播放消息动画, count=' + count);
    const display = deps.screen.getPrimaryDisplay();
    const area = display.workArea;
    const margin = 24;
    const startX = Math.round(Math.max(area.x + margin, area.x + area.width - NOTIFY_SIZE - margin));
    const startY = Math.round(Math.max(area.y + margin, area.y + area.height - NOTIFY_SIZE - margin));
    const endY = Math.round(Math.max(area.y + margin, area.y + area.height * 0.14));
    const localStartY = Math.max(0, startY - endY);
    const pathHeight = Math.max(NOTIFY_SIZE, localStartY + NOTIFY_SIZE);
    const mediaUrl = typeof deps.getNotifyMediaUrl === 'function'
      ? deps.getNotifyMediaUrl(state.config.messageNotifyVideo)
      : '';

    state.notifyWin = new deps.BrowserWindow({
      x: startX,
      y: endY,
      width: NOTIFY_SIZE,
      height: pathHeight,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      show: false,
      paintWhenInitiallyHidden: true,
      resizable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });

    const win = state.notifyWin;
    win.setVisibleOnAllWorkspaces(true);
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setBackgroundColor('#00000000');
    win.loadFile(path.join(deps.rendererDir, 'rocket-demo.html'), {
      query: {
        label: NOTIFY_LABEL,
        count: String(Math.max(1, count)),
        mediaUrl,
        startY: String(localStartY),
        endY: '0',
        durationMs: String(NOTIFY_DURATION_MS)
      }
    });

    win.webContents.on('did-finish-load', () => {
      if (!win || win.isDestroyed()) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setBackgroundColor('#00000000');
      win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
        .catch(() => {})
        .finally(() => {
          if (!win || win.isDestroyed()) return;
          win.showInactive();
          win.moveTop();
          state.notifyTimer = setTimeout(() => {
            if (win && !win.isDestroyed()) closeNotification();
            setTimeout(maybeReplayPendingNotification, 1500);
          }, NOTIFY_DURATION_MS + 160);
        });
    });

    win.on('closed', () => {
      if (state.notifyWin === win) state.notifyWin = null;
      if (state.notifyTimer) {
        clearTimeout(state.notifyTimer);
        state.notifyTimer = null;
      }
      setTimeout(maybeReplayPendingNotification, 1500);
    });
  }

  function resetRuntimeForStart() {
    clearPollTimer();
    state.lastCountSignature = null;
    state.lastCountData = null;
    state.firstSync = true;
    state.consecutiveFailures = 0;
    state.lastError = '';
  }

  function start() {
    if (!isEnabled()) return;
    resetRuntimeForStart();
    logInfo('[消息提醒] 轮询已启动, baseUrl=' + state.config.messageApiBaseUrl + ', interval=' + state.config.messagePollInterval + 's, headers=' + sanitizeHeadersForLog(safeParseHeaders(state.config.messageAuthHeaders)));
    scheduleNextPoll(0);
    sendListState();
  }

  function stop() {
    clearPollTimer();
    closeNotification();
    state.pendingAnimationCount = 0;
    state.countInFlight = false;
    state.listInFlight = false;
    state.lastError = '';
    setBadgeCount(0);
    sendListState();
    logInfo('[消息提醒] 轮询已停止');
  }

  function configKey(config) {
    return JSON.stringify(normalizeConfig(config));
  }

  function safeParseHeaders(value) {
    try {
      return parseHeaders(value);
    } catch (e) {
      return {};
    }
  }

  function updateConfig(nextConfig) {
    const oldKey = configKey(state.config);
    state.config = normalizeConfig(nextConfig || {});
    const newKey = configKey(state.config);
    const configChanged = oldKey !== newKey;
    if (configChanged) {
      logInfo('[消息提醒] 配置更新, enabled=' + state.config.messageNotifyEnabled + ', baseUrl=' + (state.config.messageApiBaseUrl ? state.config.messageApiBaseUrl : '(空)') + ', interval=' + state.config.messagePollInterval + 's, maxCache=' + state.config.messageMaxCacheItems);
    }
    if (!isEnabled()) {
      if (state.timer || state.badgeCount > 0) stop();
      return;
    }
    if (configChanged || !state.timer) {
      start();
    } else {
      sendListState();
    }
  }

  function openMessageList() {
    if (state.listWin && !state.listWin.isDestroyed()) {
      state.listWin.focus();
      sendListState();
      if (isEnabled()) refreshList({ manual: true, suppressNotification: true }).catch(() => {});
      return;
    }

    const display = deps.screen.getPrimaryDisplay();
    const area = display.workArea;
    const width = 560;
    const height = Math.min(720, Math.round(area.height * 0.82));
    state.listWin = new deps.BrowserWindow({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
      minWidth: 460,
      minHeight: 420,
      show: false,
      frame: true,
      autoHideMenuBar: true,
      title: '待办消息',
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    const win = state.listWin;
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(deps.rendererDir, 'message-list.html'));
    win.webContents.on('did-finish-load', () => {
      sendListState();
      win.show();
      if (isEnabled()) refreshList({ manual: true, suppressNotification: true }).catch(() => {});
    });
    win.on('closed', () => {
      if (state.listWin === win) state.listWin = null;
    });
  }

  function openMessageTarget(id) {
    const item = state.snapshot.find((entry) => entry.id === id);
    if (!item) {
      logWarn('[消息提醒] 打开目标失败: 未找到消息 ' + id);
      return;
    }
    if (!isSafeTargetUrl(item.targetUrl)) {
      logWarn('[消息提醒] 打开目标失败: 非法 URL');
      return;
    }
    const result = deps.shell.openExternal(item.targetUrl);
    if (result && typeof result.catch === 'function') {
      result.catch((err) => logWarn('[消息提醒] 打开目标失败: ' + (err && err.message ? err.message : String(err))));
    }
  }

  function handleRestOverlayChanged(showing) {
    if (!showing) {
      setTimeout(maybeReplayPendingNotification, 500);
    }
  }

  function destroy() {
    state.destroyed = true;
    clearPollTimer();
    closeNotification();
    if (state.listWin && !state.listWin.isDestroyed()) state.listWin.destroy();
    state.listWin = null;
  }

  if (isEnabled()) start();

  return {
    updateConfig,
    start,
    stop,
    destroy,
    refreshList,
    openMessageList,
    openMessageTarget,
    dismissNotification: closeNotification,
    handleRestOverlayChanged,
    getBadgeCount: () => state.badgeCount,
    getState: getPublicState
  };
}

module.exports = createMessageNotify;
module.exports.testConnection = testConnection;
