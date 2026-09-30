const { BotsManager } = require('./botsManager.cjs');
const { BotEngine, BotCancelled } = require('./bots/botEngine.cjs');
const { RECIPES, recipesList } = require('./bots/recipes.cjs');

const SESSION_PREFIX = 'persist:bot-session-';
const BOT_PREFIX     = 'persist:bot-';

function createBots(dbPath, broadcast) {
  const manager = new BotsManager(dbPath);
  const state   = {
    running:   false,
    recipe:    '',
    stepIndex: 0,
    stepTotal: 0,
    message:   'Sin procesos activos',
    log:       [],
  };
  let engine = null;

  const emit = () => {
    broadcast({
      ...state,
      log: [...state.log],
    });
  };

  const log = (text, tone) => {
    state.log = [...state.log.slice(-199), { text, tone }];
    emit();
  };

  const buildSteps = (recipe, config) => {
    const recipeDef = RECIPES[recipe];
    if (!recipeDef) throw new Error('Receta de bot no soportada.');
    return recipeDef.buildFlow(config);
  };

  const cacheFor = (recipe, config) => {
    if (config.refresh) return null;
    if (recipe === 'steam') {
      const cached = manager.steam();
      if (cached.length > 0) return cached;
      return null;
    }
    if (recipe === 'amazon') {
      const urls = Array.isArray(config.urls) ? config.urls : [];
      if (!urls.length) return null;
      const cached = manager.amazon();
      const fresh = urls.filter((url) => manager.freshUrl('bots_amazon', url));
      if (fresh.length === urls.length) {
        return cached.filter((item) => urls.includes(item.url));
      }
      return null;
    }
    return null;
  };

  const run = async (recipe, configInput = {}) => {
    if (state.running) throw new Error('Ya hay un bot en ejecución.');
    const config = configInput || {};
    const cached = cacheFor(recipe, config);
    if (cached) return { fromCache: true, data: cached };

    state.running   = true;
    state.recipe    = recipe;
    state.stepIndex = 0;
    state.stepTotal = 0;
    state.message   = 'Iniciando…';
    state.log       = [];
    emit();

    engine = new BotEngine(BOT_PREFIX + recipe);
    let results;
    try {
      results = await engine.run({
        steps: buildSteps(recipe, config).steps,
        onStep: (index, total, label) => {
          state.stepIndex = index + 1;
          state.stepTotal = total;
          state.message   = label;
        },
        onLog: (text, tone) => {
          log(text, tone);
        },
      });
    } catch (error) {
      if (error instanceof BotCancelled) {
        state.message = 'Bot cancelado.';
      } else {
        state.message = error.message || String(error);
        log(error.message || String(error), 'error');
      }
      throw error;
    } finally {
      engine = null;
      state.running   = false;
      state.stepIndex = 0;
      state.stepTotal = 0;
      emit();
    }

    if (recipe === 'steam') {
      const deals = Array.isArray(results.deals) ? results.deals : [];
      manager.saveSteam(deals);
      state.message = `${deals.length} ofertas guardadas en la tabla (vigencia 24 h).`;
    } else if (recipe === 'amazon') {
      const items = Object.values(results).map((item) => ({
        url:      item.url || '',
        title:    item.title || '',
        price:    item.price ?? null,
        currency: item.currency || '',
        image:    item.imageUrl || '',
      }));
      manager.saveAmazon(items);
      state.message = `${items.length} precio${items.length === 1 ? '' : 's'} guardado${items.length === 1 ? '' : 's'} (vigencia 24 h).`;
    } else if (recipe === 'links') {
      const links = Array.isArray(results.links) ? results.links : [];
      manager.saveDownloads(
        links.map((url) => ({ url, sourceTitle: config.title || '', sourceUrl: config.sourceUrl || '' })),
      );
      state.message = `${links.length} enlace${links.length === 1 ? '' : 's'} recogido${links.length === 1 ? '' : 's'} (vigencia 24 h).`;
    } else if (recipe === 'sessions') {
      state.message = results.authed?.ok
        ? 'Sesión iniciada correctamente.'
        : 'La página cargó, pero no se confirmó el sesión correcta.';
    }
    emit();

    if (recipe === 'steam') return { fromCache: false, data: manager.steam() };
    if (recipe === 'amazon') return { fromCache: false, data: manager.amazon() };
    if (recipe === 'links') return { fromCache: false, data: manager.downloads() };
    return { fromCache: false, data: results.authed || null };
  };

  const cancel = () => {
    if (engine) {
      engine.cancel();
      engine = null;
      return true;
    }
    return false;
  };

  const data = (preset) => {
    if (preset === 'steam') return manager.steam();
    if (preset === 'amazon') return manager.amazon();
    if (preset === 'links') return manager.downloads();
    return [];
  };

  const sessionsList = () => manager.sessions();
  const sessionSave  = (dataInput) => manager.saveSession(dataInput);
  const sessionDelete = (id) => manager.deleteSession(id);

  const sessionRun = async (id) => {
    const session = manager.sessions().find((item) => item.id === Number(id));
    if (!session) throw new Error('Sesión no encontrada.');
    if (state.running) throw new Error('Ya hay un bot en ejecución.');
    const partition = SESSION_PREFIX + session.id;
    state.running   = true;
    state.recipe    = 'sessions';
    state.stepIndex = 0;
    state.stepTotal = 0;
    state.message   = `Autenticando en ${session.portal}…`;
    state.log       = [];
    emit();

    engine = new BotEngine(partition);
    let results;
    try {
      results = await engine.run({
        steps: RECIPES.sessions.buildFlow(session).steps,
        onStep: (index, total, label) => {
          state.stepIndex = index + 1;
          state.stepTotal = total;
          state.message   = label;
        },
        onLog: (text, tone) => {
          log(text, tone);
        },
      });
      state.message = results.authed?.ok
        ? 'Sesión iniciada correctamente.'
        : 'La página cargó, pero no se pudo confirmar la sesión.';
    } catch (error) {
      if (error instanceof BotCancelled) {
        state.message = 'Bot cancelado.';
      } else {
        state.message = error.message || String(error);
        log(error.message || String(error), 'error');
      }
      throw error;
    } finally {
      engine = null;
      state.running   = false;
      state.stepIndex = 0;
      state.stepTotal = 0;
      emit();
    }
    return { authed: results.authed || { ok: false } };
  };

  const close = () => manager.close();

  return {
    state,
    recipes: recipesList,
    manager,
    run,
    cancel,
    data,
    sessionsList,
    sessionSave,
    sessionDelete,
    sessionRun,
    close,
  };
}

module.exports = { createBots };