/**
 * 浏览器半边：左侧栏胶囊图标 + 中栏面板（记录 / 分类 / 三态推进 / 删除）。
 *
 * 刻意手写 DSH 的模块包裹而不是走打包器：
 * - bundle id 必须是 package.json 的 name（DSH 按 id 从 /plugins/<id>/client.js 提供并求值）
 * - 只依赖 react（不引 jsx-runtime，因此全部用 React.createElement）
 * 整个文件不抛异常：DOM 或席位缺失时只是「不出现」，不能让 Web 启动失败。
 */
(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || typeof window.__ModuleLoader__.load !== 'function') {
    return;
  }

  /** 自检回传给宿主：GET /thought-capsule/api/client-report 就能看到浏览器里发生了什么。 */
  function postReport(payload) {
    try {
      if (typeof fetch !== 'function') return;
      var res = fetch('/thought-capsule/api/client-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res && typeof res.catch === 'function') res.catch(function () {});
    } catch (ignore) {
      /* noop */
    }
  }

  window.__ModuleLoader__.load({
    id: 'dsh-thought-capsule',
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

      var react = require('react');
      var h = react.createElement;

      var PANEL_ID = 'dsh-thought-capsule';
      var PANEL_ORDER = 870;
      var BASE = '/thought-capsule';
      // 版本戳：控制台 __dshThoughtCapsuleDebug().build 能看到，用来判断拿到的是不是最新一版。
      var CLIENT_BUILD = '2026-10-19T00:15-ui18';
      var POLL_MS = 8000;
      var STYLE_ID = 'dsh-thought-capsule-style';

      var FALLBACK_CATEGORIES = [
        { id: 'tools', zh: '插件/工具', en: 'Plugins & tools' },
        { id: 'work', zh: '工作', en: 'Work' },
        { id: 'idea', zh: '灵感', en: 'Ideas' },
        { id: 'read', zh: '阅读/资料', en: 'Reading' },
        { id: 'life', zh: '生活', en: 'Life' },
        { id: 'other', zh: '其他', en: 'Other' },
      ];
      var STATUS_ORDER = ['inbox', 'todo', 'done', 'archived'];
      var STATUS_LABELS = {
        inbox: ['未整理', 'Inbox'],
        todo: ['待办', 'To do'],
        done: ['完成', 'Done'],
        archived: ['归档', 'Archived'],
      };

      /** apply(ctx) 时记下来，Panel 里的「发给 AI」「扫描」要用到宿主客户端服务。 */
      var pluginCtx = null;

      /** 取一个可选的客户端服务；拿不到就返回 undefined，不抛。 */
      function svc(name) {
        try {
          if (pluginCtx && typeof pluginCtx.get === 'function') return pluginCtx.get(name);
        } catch (err) {
          /* noop */
        }
        return undefined;
      }

      function isZh() {
        try {
          var lang = (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) || '';
          return /^zh/i.test(lang);
        } catch (err) {
          return true;
        }
      }

      function t(zh, en) {
        return isZh() ? zh : en;
      }

      function label() {
        return t('思维胶囊', 'Thought Capsule');
      }

      function msgOf(err) {
        if (!err) return 'unknown error';
        if (typeof err === 'string') return err;
        return err.message ? err.message : String(err);
      }

      function warn(message, detail) {
        try {
          console.warn('[dsh-thought-capsule] ' + message, detail === undefined ? '' : detail);
        } catch (ignore) {
          /* noop */
        }
      }

      /**
       * 请求宿主半边。非 2xx 或 ok:false 都转成 Error（带上宿主给的错误文案）。
       */
      function api(path, init) {
        var options = { method: 'GET', headers: { 'content-type': 'application/json' } };
        if (init) {
          options = {
            method: init.method || 'GET',
            headers: { 'content-type': 'application/json' },
            body: init.body,
          };
        }
        return fetch(BASE + path, options).then(function (res) {
          return res.text().then(function (text) {
            var data = null;
            if (text) {
              try {
                data = JSON.parse(text);
              } catch (err) {
                data = null;
              }
            }
            if (!res.ok || !data || data.ok === false) {
              var reason = data && data.error ? data.error : 'HTTP ' + res.status;
              throw new Error(reason);
            }
            return data;
          });
        });
      }

      /** 本地今天的 YYYY-MM-DD（不走 toISOString，免得东八区凌晨串成前一天）。 */
      function todayKey() {
        var now = new Date();
        function pad(n) {
          return (n < 10 ? '0' : '') + n;
        }
        return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
      }

      function formatTime(iso) {
        if (!iso) return '';
        var then = new Date(iso);
        if (isNaN(then.getTime())) return '';
        var diff = Date.now() - then.getTime();
        if (diff < 60000) return t('刚刚', 'just now');
        if (diff < 3600000) return Math.floor(diff / 60000) + t(' 分钟前', 'm ago');
        if (diff < 86400000) return Math.floor(diff / 3600000) + t(' 小时前', 'h ago');
        if (diff < 604800000) return Math.floor(diff / 86400000) + t(' 天前', 'd ago');
        try {
          return then.toLocaleDateString();
        } catch (err) {
          return iso.slice(0, 10);
        }
      }

      /*
       * 配色全部走 DSH 的主题 token（dsh-client-ui-theme 定义，明暗两套值）。
       * 高亮按钮统一用 button-primary-fill 作底 + label-primary-foreground 作字，
       * 这是宿主自己的对比度契约；不要拿 label-primary 当底色（它在暗色下接近白，
       * 再配一个浅色字就糊成一片）。
       */
      // 主题变量必须在每个挂载点上各自声明：面板在 .tc-root 里，悬浮球/便签挂在 shell.overlay 的
      // 独立节点（.tc-float-wrap）上，不共用的话那里 var(--tc-card) 全部未定义 → 便签变成透明底 +
      // 继承宿主的字色，深色主题下就是白底白字、什么都看不见。
      var TC_VARS = '--tc-fg:var(--dsw-alias-label-primary,#1c1c1e);--tc-fg2:var(--dsw-alias-label-secondary,#5f6368);--tc-fg3:var(--dsw-alias-label-tertiary,#8b9096);--tc-line:var(--dsw-alias-border-l1,rgba(0,0,0,.06));--tc-line2:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--tc-card:var(--dsw-alias-bg-layer-1,#fff);--tc-raise:var(--dsw-alias-button-floating-fill,#fff);--tc-track:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.06));--tc-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));--tc-accent:var(--dsw-alias-button-primary-fill,#1c1c1e);--tc-accent-fg:var(--dsw-alias-label-primary-foreground,#fff);--tc-accent-hover:var(--dsw-alias-button-primary-hover,#3a3a3c);--tc-danger:var(--dsw-alias-state-error-primary,#c62828);--tc-business:var(--dsw-alias-state-business-primary,#0a84ff);--tc-ok:var(--dsw-alias-state-success-primary,#1a9c50);--tc-warn:var(--dsw-alias-state-warn-primary,#c98a00);--tc-r-sm:var(--dsw-radius-sm,8px);--tc-r-md:var(--dsw-radius-md,12px);--tc-r-lg:var(--dsw-radius-lg,16px);';
      var CSS = [
        '.tc-root{' + TC_VARS + 'color-scheme:light;display:flex;flex-direction:column;height:100%;min-height:0;width:100%;box-sizing:border-box;color:var(--tc-fg);font-size:13px;line-height:1.5}',
        // 让原生 select/下拉跟随应用主题，而不是操作系统主题（否则暗色下选项会白底白字）。
        // 选择器不带 body：暗色属性挂在 html 还是 body 上都能命中。
        '[data-ds-dark-theme] .tc-root,[data-ds-dark-theme] .tc-float-wrap{color-scheme:dark}',
        '.tc-page{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;max-width:780px;margin:0 auto;box-sizing:border-box;padding:0 22px}',
        '.tc-head{display:flex;align-items:center;gap:9px;padding:18px 0 12px}',
        '.tc-head-icon{display:inline-flex;color:var(--tc-fg);opacity:.85}',
        '.tc-head-title{font-size:15px;font-weight:600;letter-spacing:.01em}',
        '.tc-head-badge{margin-left:auto;height:20px;padding:0 8px;border-radius:999px;background:var(--tc-track);color:var(--tc-fg2);font-size:11px;line-height:20px;font-variant-numeric:tabular-nums}',
        '.tc-composer{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--tc-line2);border-radius:var(--tc-r-lg);background:var(--tc-card);transition:border-color .15s,box-shadow .15s}',
        '.tc-composer:focus-within{border-color:var(--tc-business);box-shadow:0 0 0 3px color-mix(in srgb,var(--tc-business) 15%,transparent)}',
        '.tc-input{width:100%;box-sizing:border-box;min-height:52px;max-height:200px;resize:vertical;padding:6px;border:0;border-radius:var(--tc-r-sm);background:transparent;color:inherit;font:inherit;line-height:1.55;outline:none}',
        '.tc-input::placeholder{color:var(--dsw-alias-label-caption,#a1a6ad)}',
        '.tc-composer-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 2px 2px}',
        '.tc-grow{flex:1 1 auto}',
        '.tc-select{height:26px;max-width:160px;padding:0 8px;font-size:11.5px;border-radius:var(--tc-r-sm);border:1px solid var(--tc-line2);background:var(--tc-card);color:var(--tc-fg2);cursor:pointer}',
        '.tc-select option{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--tc-fg)}',
        '.tc-btn{height:28px;padding:0 13px;font-size:12px;font-weight:500;border-radius:var(--tc-r-sm);border:1px solid var(--tc-line2);background:transparent;color:var(--tc-fg);cursor:pointer;transition:background-color .15s,border-color .15s,opacity .15s}',
        '.tc-btn:hover:not(:disabled){background:var(--tc-hover)}',
        '.tc-btn:disabled{opacity:.4;cursor:default}',
        '.tc-btn-primary{background:var(--tc-accent);border-color:transparent;color:var(--tc-accent-fg);box-shadow:0 1px 2px rgba(0,0,0,.16)}',
        '.tc-btn-primary:hover:not(:disabled){background:var(--tc-accent-hover);color:var(--tc-accent-fg)}',
        '.tc-btn-primary:disabled{box-shadow:none}',
        '.tc-tabs{display:flex;gap:3px;margin:14px 0 10px;padding:3px;border-radius:999px;background:var(--tc-track);width:fit-content;max-width:100%;overflow-x:auto;scrollbar-width:none}',
        '.tc-tabs::-webkit-scrollbar{display:none}',
        '.tc-tab{height:28px;padding:0 11px;display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;background:transparent;color:var(--tc-fg2);font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;transition:color .15s,background-color .15s,box-shadow .15s}',
        '.tc-tab:hover{color:var(--tc-fg)}',
        '.tc-tab[data-active="1"]{background:var(--tc-raise);color:var(--tc-fg);box-shadow:0 0 0 .5px var(--tc-line2),0 1px 2px rgba(0,0,0,.06)}',
        '.tc-tab-count{font-size:11px;font-weight:400;color:var(--tc-fg3);font-variant-numeric:tabular-nums}',
        '.tc-tab[data-active="1"] .tc-tab-count{color:var(--tc-fg2)}',
        '.tc-chips{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--tc-line)}',
        '.tc-chip{height:24px;padding:0 10px;font-size:11px;border-radius:999px;border:1px solid var(--tc-line);background:transparent;color:var(--tc-fg2);cursor:pointer;transition:background-color .15s,border-color .15s,color .15s}',
        '.tc-chip:hover{background:var(--tc-hover);color:var(--tc-fg)}',
        '.tc-chip[data-active="1"]{border-color:var(--tc-line2);background:var(--tc-track);color:var(--tc-fg);font-weight:500}',
        '.tc-list{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 0 20px;display:flex;flex-direction:column;gap:9px}',
        '.tc-item{position:relative;border:1px solid var(--tc-line);border-radius:var(--tc-r-md);background:var(--tc-card);padding:11px 13px 10px;transition:border-color .15s,box-shadow .15s,opacity .15s}',
        '.tc-item:hover{border-color:var(--tc-line2);box-shadow:0 1px 3px rgba(0,0,0,.06)}',
        '.tc-item[data-done="1"]{opacity:.55}',
        '.tc-item[data-done="1"] .tc-item-text{text-decoration:line-through;text-decoration-thickness:1px}',
        '.tc-item-text{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6}',
        '.tc-item-meta{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:11px;color:var(--tc-fg3);flex-wrap:wrap}',
        '.tc-dot{width:6px;height:6px;border-radius:50%;background:var(--tc-business);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--tc-business) 18%,transparent)}',
        '.tc-dot[data-status="todo"]{background:var(--tc-warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--tc-warn) 18%,transparent)}',
        '.tc-dot[data-status="done"]{background:var(--tc-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--tc-ok) 18%,transparent)}',
        '.tc-tag{height:19px;padding:0 8px;border-radius:999px;background:var(--tc-track);color:var(--tc-fg2);font-size:10.5px;line-height:19px;white-space:nowrap}',
        '.tc-src{font-size:10.5px;color:var(--tc-fg3);border:1px dashed var(--tc-line2);border-radius:999px;padding:0 7px;line-height:17px}',
        '.tc-item-actions{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap}',
        '.tc-seg{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:var(--tc-track)}',
        '.tc-seg-btn{height:22px;padding:0 9px;border:0;border-radius:999px;background:transparent;color:var(--tc-fg2);font-size:11px;cursor:pointer;transition:background-color .15s,color .15s}',
        '.tc-seg-btn:hover:not([data-active="1"]){color:var(--tc-fg)}',
        '.tc-seg-btn[data-active="1"]{background:var(--tc-accent);color:var(--tc-accent-fg);font-weight:600}',
        '.tc-icon-btn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:var(--tc-r-sm);background:transparent;color:var(--tc-fg3);font-size:16px;line-height:1;cursor:pointer;transition:background-color .15s,color .15s}',
        '.tc-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(198,40,40,.1));color:var(--tc-danger)}',
        '.tc-empty{margin:6px 0;padding:34px 22px;border:1px dashed var(--tc-line2);border-radius:var(--tc-r-lg);text-align:center;color:var(--tc-fg3);font-size:12.5px;line-height:1.8;white-space:pre-wrap}',
        '.tc-icon-btn-ai{width:auto;padding:0 7px;font-size:10.5px;font-weight:600;letter-spacing:.02em}',
        '.tc-icon-btn-ai[aria-expanded="true"]{background:var(--tc-accent);color:var(--tc-accent-fg)}',
        '.tc-send{display:flex;flex-direction:column;gap:8px;margin:0 0 12px;padding:12px;border:1px solid var(--tc-line2);border-radius:var(--tc-r-md);background:var(--tc-raise)}',
        '.tc-send-head{display:flex;align-items:center;gap:8px}',
        '.tc-send-title{font-size:12px;font-weight:600;color:var(--tc-fg);word-break:break-word}',
        '.tc-send-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.tc-send-hint{font-size:11px;color:var(--tc-fg3)}',
        '.tc-scan{margin-top:10px;padding:10px 12px;border:1px dashed var(--tc-line2);border-radius:var(--tc-r-md)}',
        '.tc-float-toggle{gap:6px;display:inline-flex;align-items:center}',
        '.tc-scan-btn{height:24px;padding:0 10px;font-size:11px;font-weight:500;border-radius:999px;border:1px solid var(--tc-line2);background:var(--tc-card);color:var(--tc-fg2);cursor:pointer;white-space:nowrap}',
        '.tc-scan-btn:hover:not(:disabled){background:var(--tc-hover);color:var(--tc-fg)}',
        '.tc-scan-btn:disabled{opacity:.5;cursor:default}',
        '.tc-scan-hint{margin:-6px 0 10px;font-size:11px;line-height:1.5;color:var(--tc-fg3)}',
        '.tc-chip-add{border-style:dashed;color:var(--tc-fg3)}',
        '.tc-send-extra{min-height:40px;margin-top:4px;padding:8px 10px;border:1px solid var(--tc-line2);background:var(--tc-card);font-size:12px;color:var(--tc-fg)}',
        '.tc-send-extra:focus{border-color:var(--tc-business);outline:none}',
        '.tc-scan-title{font-size:11px;color:var(--tc-fg3);margin-bottom:6px}',
        '.tc-scan-item{display:block;width:100%;text-align:left;padding:4px 6px;border:0;border-radius:var(--tc-r-sm);background:transparent;color:var(--tc-fg2);font-size:12px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.tc-scan-item:hover{background:var(--tc-hover);color:var(--tc-fg)}',
        '.tc-scan-list{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}',
        '.tc-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:2px}',
        '.tc-table th{text-align:left;font-weight:600;font-size:11px;color:var(--tc-fg3);padding:4px 6px;border-bottom:1px solid var(--tc-line2);white-space:nowrap}',
        '.tc-table td{vertical-align:top;padding:6px;border-bottom:1px solid var(--tc-line);color:var(--tc-fg2);line-height:1.55}',
        '.tc-table tr:last-child td{border-bottom:0}',
        '.tc-table td:first-child{color:var(--tc-fg);font-weight:500}',
        '.tc-why{font-size:11px;color:var(--tc-fg3)}',
        '.tc-raw{margin-top:8px;font-size:11px;color:var(--tc-fg3)}',
        '.tc-raw summary{cursor:pointer}',
        '.tc-raw pre{margin:6px 0 0;padding:8px;max-height:180px;overflow:auto;border-radius:var(--tc-r-sm);background:var(--tc-track);color:var(--tc-fg2);font-size:11px;white-space:pre-wrap;word-break:break-word}',
        '.tc-note{margin-top:10px;font-size:11.5px;color:var(--tc-business);word-break:break-word}',
        '.tc-foot{flex:none;display:flex;gap:8px;justify-content:space-between;padding:9px 2px 12px;border-top:1px solid var(--tc-line);font-size:11px;color:var(--dsw-alias-label-caption,#a1a6ad)}',
        '.tc-float-ball{position:relative;display:inline-flex;align-items:center;justify-content:center;pointer-events:auto}',
        '.tc-float-gear{position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:999px;background:var(--tc-card);border:1px solid var(--tc-line2);font-size:11px;line-height:1;opacity:0;transition:opacity .12s;z-index:3;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.22)}',
        '.tc-float-ball:hover .tc-float-gear,.tc-float-gear:focus-visible,.tc-float-gear[aria-expanded="true"]{opacity:1}',
        '.tc-float-set{position:absolute;right:0;bottom:calc(100% + 12px);width:min(286px,calc(100vw - 52px));display:flex;flex-direction:column;gap:9px;padding:11px 12px;border-radius:var(--tc-r-md);border:1px solid var(--tc-line2);background:var(--tc-card);box-shadow:0 18px 44px rgba(0,0,0,.3)}',
        '.tc-float-field{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--tc-fg2)}',
        '.tc-float-field input[type=range]{width:100%;accent-color:var(--tc-accent);cursor:pointer}',
        '.tc-btn-mini{height:22px;padding:0 8px;font-size:11px;border-radius:var(--tc-r-sm)}',
        '.tc-row-act{display:flex;gap:6px;align-items:center;white-space:nowrap}',
        '.tc-set{display:flex;flex-direction:column;gap:9px;margin:2px 0 10px;padding:11px 12px;border:1px solid var(--tc-line);border-radius:var(--tc-r-md);background:var(--tc-card)}',
        '.tc-set-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:12px;color:var(--tc-fg2)}',
        '.tc-set-icons{display:flex;gap:6px;flex-wrap:wrap}',
        '.tc-set-icon{width:30px;height:30px;padding:0;border-radius:var(--tc-r-sm);border:1px solid var(--tc-line2);background:transparent;color:var(--tc-fg);font-size:15px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
        '.tc-set-icon[aria-pressed="true"]{border-color:var(--tc-accent);box-shadow:inset 0 0 0 2px var(--tc-accent)}',
        '.tc-set-hint{font-size:11.5px;color:var(--tc-fg3);line-height:1.5}',
        // shell.overlay 的容器默认 pointer-events:none，子元素必须显式打开，否则整颗胶囊既点不动也拖不动。
        '.tc-float-wrap{'+TC_VARS+'position:fixed;right:24px;bottom:24px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:auto!important}',
        '.tc-float-wrap *{pointer-events:auto}',
        '.tc-float-btn{padding:0;border:0;border-radius:999px;background:transparent;color:#fff;display:inline-flex;align-items:center;justify-content:center;line-height:1;cursor:grab;box-shadow:none;user-select:none;touch-action:none;overflow:visible;transition:transform .12s}',
        '.tc-float-btn:hover{transform:scale(1.06)}',
        '.tc-float-btn:active{cursor:grabbing}',
        '.tc-float-btn img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 3px 8px rgba(0,0,0,.35))}',
        '.tc-float-btn:active{cursor:grabbing}',
        '.tc-float-btn img{width:100%;height:100%;object-fit:cover}',
        '.tc-float-emoji{filter:drop-shadow(0 2px 6px rgba(0,0,0,.35))}',
        '.tc-float-note{position:absolute;right:0;bottom:calc(100% + 12px);width:min(300px,calc(100vw - 56px));display:flex;flex-direction:column;gap:8px;padding:11px 12px;border-radius:var(--tc-r-md);border:1px solid var(--tc-line2);background:var(--tc-card);box-shadow:0 18px 44px rgba(0,0,0,.3)}',
        '.tc-float-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tc-fg2)}',
        '.tc-float-text{min-height:64px;border:1px solid var(--tc-line2);background:var(--tc-card);color:var(--tc-fg)}',
        '.tc-float-bar{display:flex;align-items:center;gap:8px}',
        '.tc-float-msg{font-size:11.5px;color:var(--tc-fg3)}',
        '.tc-err{color:var(--tc-danger)}',
        // 批量选择 + 内联编辑
        '.tc-pick{width:14px;height:14px;margin:0;accent-color:var(--tc-accent);cursor:pointer;flex:none}',
        '.tc-batch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px;padding:8px 10px;border:1px solid var(--tc-line2);border-radius:var(--tc-r-md);background:var(--tc-raise)}',
        '.tc-batch-count{font-size:12px;color:var(--tc-fg2)}',
        '.tc-edit{display:flex;flex-direction:column;gap:6px}',
        '.tc-edit-input{min-height:64px;border:1px solid var(--tc-line2);background:var(--tc-card);color:var(--tc-fg)}',
        '.tc-edit-bar{display:flex;gap:6px}',
        // 搜索（P1.3）：只在前端过滤已加载的列表，不新增请求。
        '.tc-find{display:flex;gap:6px;align-items:center;margin:0 0 8px}',
        '.tc-find-input{flex:1;height:28px;padding:0 10px;font-size:12px;border-radius:var(--tc-r-sm);border:1px solid var(--tc-line2);background:var(--tc-card);color:var(--tc-fg)}',
        '.tc-find-input:focus{outline:2px solid var(--tc-business);outline-offset:1px}',
        '.tc-find-clear{height:28px;padding:0 9px;font-size:11px;border-radius:var(--tc-r-sm);border:1px solid var(--tc-line2);background:transparent;color:var(--tc-fg2);cursor:pointer}',
        // 本周回看（P2.7）：全本地统计。
        '.tc-review{margin:0 0 10px;padding:10px 12px;border:1px solid var(--tc-line);border-radius:var(--tc-r-md);background:var(--tc-card)}',
        '.tc-review-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--tc-fg2)}',
        '.tc-review-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:8px}',
        '.tc-review-stat{padding:6px 8px;border-radius:var(--tc-r-sm);border:1px solid var(--tc-line2)}',
        '.tc-review-num{display:block;font-size:17px;font-weight:600;color:var(--tc-fg)}',
        '.tc-review-label{font-size:11px;color:var(--tc-fg3)}',
        '.tc-review-stale{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--tc-fg2)}',
        '.tc-review-stale li{display:flex;gap:6px;align-items:baseline}',
        '.tc-review-age{color:var(--tc-fg3);font-size:11px;white-space:nowrap}',
        // 卡片元信息：标签、截止日、关联会话。
        '.tc-taglist{display:inline-flex;gap:4px;flex-wrap:wrap}',
        '.tc-tagpill{padding:0 5px;border-radius:999px;border:1px solid var(--tc-line2);font-size:10.5px;color:var(--tc-fg3)}',
        '.tc-due{font-size:11px;color:var(--tc-fg3)}',
        '.tc-due[data-overdue="1"]{color:var(--tc-danger)}',
        '.tc-route{border:0;background:transparent;padding:0;font:inherit;font-size:11px;color:var(--tc-business);cursor:pointer;text-decoration:underline dotted}',
        // 划词捕获气泡（P1.4）：挂在 shell.overlay，容器默认 pointer-events:none，这里显式打开。
        '.tc-cap{position:fixed;z-index:10000;transform:translate(-50%,-100%);display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:10px;border:1px solid var(--tc-line2);background:var(--tc-card);box-shadow:0 10px 28px rgba(0,0,0,.28);pointer-events:auto!important}',
        '.tc-cap *{pointer-events:auto}',
        '.tc-cap-btn{height:26px;padding:0 10px;font-size:12px;border-radius:8px;border:1px solid var(--tc-line2);background:transparent;color:var(--tc-fg);cursor:pointer;white-space:nowrap}',
        '.tc-cap-btn[data-primary="1"]{background:var(--tc-accent);border-color:var(--tc-accent);color:#fff}',
        '.tc-cap-hint{font-size:11px;color:var(--tc-fg3);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.tc-tab:focus-visible,.tc-chip:focus-visible,.tc-seg-btn:focus-visible,.tc-btn:focus-visible,.tc-icon-btn:focus-visible,.tc-select:focus-visible{outline:2px solid var(--tc-business);outline-offset:2px}',
        // 触屏上把点在手上的目标放到 44px（桌面鼠标点 24px 的图标没问题，手指不行）。
        '@media (pointer:coarse){.tc-btn,.tc-cap-btn,.tc-tab,.tc-chip,.tc-seg-btn{min-height:44px}.tc-icon-btn{width:44px;height:44px}.tc-select{min-height:44px}}',
      ].join('');

      function ensureStyle() {
        try {
          if (typeof document === 'undefined') return;
          if (document.getElementById(STYLE_ID)) return;
          var style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = CSS;
          (document.head || document.documentElement).appendChild(style);
        } catch (err) {
          warn('样式注入失败（面板仍可用，只是没样式）', err);
        }
      }

      function CapsuleIcon(props) {
        var size = props && typeof props.size === 'number' ? props.size : 16;
        var active = !!(props && props.active);
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: active ? 2 : 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            focusable: 'false',
          },
          h('rect', { key: 'body', x: 3.5, y: 8, width: 17, height: 8, rx: 4 }),
          h('line', { key: 'cut', x1: 12, y1: 8.4, x2: 12, y2: 15.6, strokeDasharray: '1.6 2' }),
          h('circle', { key: 'dot', cx: 7.6, cy: 12, r: 1.1, fill: 'currentColor', stroke: 'none' }),
        );
      }

      /**
       * 桌面上的悬浮胶囊：点一下开便签，再点一下收起来。
       * 只在用户从面板里打开开关时存在；图标/位置存宿主库（settings.float），换个窗口也还在。
       */
      var FLOAT_PRESETS = ['pill', '💊', '🧠', '💡', '🔖', '⭐', '📝'];

      var SETTINGS_EVENT = 'dsh-thought-capsule:settings';
      var CHANGED_EVENT = 'dsh-thought-capsule:changed';

      function announce(type, detail) {
        try {
          window.dispatchEvent(new CustomEvent(type, { detail: detail }));
        } catch (err) {
          /* noop */
        }
      }

      function FloatCapsule() {
        var settingsState = react.useState(null);
        var settings = settingsState[0];
        var setSettings = settingsState[1];

        var openState = react.useState(false);
        var open = openState[0];
        var setOpen = openState[1];

        var textState = react.useState('');
        var text = textState[0];
        var setText = textState[1];

        var noteState = react.useState('');
        var note = noteState[0];
        var setNote = noteState[1];

        var setOpenState = react.useState(false);
        var showSet = setOpenState[0];
        var setShowSet = setOpenState[1];

        var dragState = react.useState(null);
        var dragged = dragState[0];
        var setDragged = dragState[1];
        var drag = react.useRef(null);
        var wrapRef = react.useRef(null);
        var commitTimer = react.useRef(null);
        var setTick = react.useState(0)[1];

        // 窗口尺寸变了，auto 方向的判断要跟着重算。
        react.useEffect(function () {
          if (!open && !showSet) return undefined;
          function bump() {
            setTick(function (n) {
              return n + 1;
            });
          }
          window.addEventListener('resize', bump);
          return function () {
            window.removeEventListener('resize', bump);
          };
        }, [open, showSet]);

        react.useEffect(function () {
          var alive = true;
          function adopt(next) {
            if (alive && next) setSettings(next);
          }
          api('/api/settings').then(
            function (res) {
              adopt(res.settings && res.settings.float);
            },
            function () {
              /* 读不到就当关闭 */
            },
          );
          function onSettings(event) {
            adopt(event && event.detail && event.detail.float);
          }
          window.addEventListener(SETTINGS_EVENT, onSettings);
          return function () {
            alive = false;
            window.removeEventListener(SETTINGS_EVENT, onSettings);
            if (commitTimer.current) clearTimeout(commitTimer.current);
          };
        }, []);

        var size = settings && typeof settings.size === 'number' ? settings.size : 54;
        var alpha = settings && typeof settings.opacity === 'number' ? settings.opacity : 0.96;
        var noteFont = settings && typeof settings.noteFont === 'number' ? settings.noteFont : 13;

        /** 改设置：先本地生效（滑块不卡），再防抖写宿主并广播。 */
        function patch(next, immediate) {
          setSettings(Object.assign({}, settings, next));
          announce(SETTINGS_EVENT, { float: Object.assign({}, settings, next) });
          if (commitTimer.current) clearTimeout(commitTimer.current);
          var send = function () {
            api('/api/settings', { method: 'PUT', body: JSON.stringify(next) }).then(
              function (res) {
                if (res.settings && res.settings.float) setSettings(res.settings.float);
              },
              function () {
                /* 写不进去就保持本地，下一次拖动/改设置会再试 */
              },
            );
          };
          if (immediate) send();
          else commitTimer.current = setTimeout(send, 220);
        }

        react.useEffect(function () {
          function onMove(event) {
            var state = drag.current;
            if (!state) return;
            var dx = event.clientX - state.startX;
            var dy = event.clientY - state.startY;
            if (!state.moved && Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
            if (!state.moved) return;
            event.preventDefault();
            state.x = Math.min(Math.max(2, state.originX + dx), Math.max(2, window.innerWidth - size - 4));
            state.y = Math.min(Math.max(2, state.originY + dy), Math.max(2, window.innerHeight - size - 4));
            setDragged({ x: state.x, y: state.y });
          }
          function onUp() {
            var state = drag.current;
            if (!state) return;
            drag.current = null;
            if (state.moved) {
              setDragged({ x: state.x, y: state.y });
              patch({ x: Math.round(state.x), y: Math.round(state.y) }, true);
            } else {
              setOpen(!open);
              setShowSet(false);
            }
          }
          window.addEventListener('pointermove', onMove, { passive: false });
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
          return function () {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
          };
        }, [open, size, settings]);

        // Alt+C 开关悬浮球：面板关着的时候也能用，所以监听挂在这个组件上（它一直挂着，只是关掉时不渲染）。
        react.useEffect(function () {
          function onKey(event) {
            var native = event.nativeEvent || event;
            var key = String((native && native.key) || '').toLowerCase();
            if (!native || !native.altKey || native.metaKey || native.ctrlKey || key !== 'c') return;
            var target = native.target;
            var tag = target && target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
            if (typeof native.preventDefault === 'function') native.preventDefault();
            patch({ enabled: !(settings && settings.enabled) }, true);
          }
          window.addEventListener('keydown', onKey);
          return function () {
            window.removeEventListener('keydown', onKey);
          };
        }, [settings]);

        if (!settings || !settings.enabled) return null;

        var baseX = dragged ? dragged.x : settings.x;
        var baseY = dragged ? dragged.y : settings.y;
        // 记住的是「悬浮球左上角」的视口坐标；窗口变小/换屏时落回右下角，避免跑到屏幕外点不到。
        var maxX = Math.max(2, window.innerWidth - size - 6);
        var maxY = Math.max(2, window.innerHeight - size - 6);
        var placed = typeof baseX === 'number' && typeof baseY === 'number' && baseX >= 0 && baseY >= 0 && baseX <= maxX && baseY <= maxY;
        var style = {
          width: size + 'px',
          height: size + 'px',
          left: placed ? Math.round(baseX) + 'px' : 'auto',
          top: placed ? Math.round(baseY) + 'px' : 'auto',
          right: placed ? 'auto' : '24px',
          bottom: placed ? 'auto' : '24px',
        };

        function onPointerDown(event) {
          if (event.button !== undefined && event.button !== 0) return;
          var rect = (wrapRef.current || event.currentTarget).getBoundingClientRect();
          drag.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: rect.left,
            originY: rect.top,
            moved: false,
            x: rect.left,
            y: rect.top,
          };
        }

        function save() {
          var clean = text.trim();
          if (!clean) {
            setNote(t('写点什么再保存。', 'Write something first.'));
            return;
          }
          api('/api/items', { method: 'POST', body: JSON.stringify({ text: clean }) }).then(
            function () {
              setText('');
              setNote(t('已收进胶囊。', 'Saved.'));
              announce(CHANGED_EVENT);
            },
            function (err) {
              setNote(t('保存失败：', 'Save failed: ') + msgOf(err));
            },
          );
        }

        function pickIcon(file) {
          if (!file) return;
          if (file.size > 100 * 1024) {
            setNote(t('图标请小于 100 KB。', 'Keep the icon under 100 KB.'));
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            patch({ icon: String(reader.result) }, true);
          };
          reader.readAsDataURL(file);
        }

        var icon = settings.icon || 'pill';
        var isImage = icon.indexOf('data:') === 0 || icon.indexOf('http') === 0;
        var glyph = Math.round(size * (isImage || icon === 'pill' ? 0.62 : 0.5));

        /**
         * 便签/设置相对胶囊的开向：auto 时按胶囊在屏幕左半还是右半自动换边，
         * 竖直方向按上方空间是否够放挑 bottom 还是 top。
         */
        function panelStyle() {
          var pref = settings.side || 'auto';
          var viewportW = window.innerWidth || 1024;
          var viewportH = window.innerHeight || 768;
          var left = dragged ? dragged.x : typeof settings.x === 'number' ? settings.x : viewportW - 24 - size;
          var top = dragged ? dragged.y : typeof settings.y === 'number' ? settings.y : viewportH - 24 - size;
          var side = pref;
          if (pref === 'auto') side = left + size / 2 < viewportW / 2 ? 'right' : 'left';
          var style = { position: 'absolute' };
          if (side === 'above') {
            style.right = '0px';
            style.bottom = 'calc(100% + 12px)';
            return style;
          }
          if (side === 'below') {
            style.right = '0px';
            style.top = 'calc(100% + 12px)';
            return style;
          }
          if (side === 'right') style.left = 'calc(100% + 12px)';
          else style.right = 'calc(100% + 12px)';
          if (top < 300) style.top = '0px';
          else style.bottom = '0px';
          return style;
        }

        return h(
          'div',
          { className: 'tc-float-wrap', style: style, ref: wrapRef },
          showSet
            ? h(
                'div',
                { className: 'tc-float-set', role: 'dialog', 'aria-label': t('悬浮胶囊设置', 'Floating capsule settings'), style: panelStyle() },
                h(
                  'div',
                  { className: 'tc-float-head' },
                  h('span', null, t('悬浮胶囊', 'Floating capsule')),
                  h('span', { className: 'tc-grow' }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-icon-btn',
                      title: t('收起', 'Close'),
                      'aria-label': t('收起设置', 'Close settings'),
                      onClick: function () {
                        setShowSet(false);
                      },
                    },
                    '×',
                  ),
                ),
                h(
                  'label',
                  { className: 'tc-float-field' },
                  h('span', null, t('大小', 'Size') + ' · ' + size + 'px'),
                  h('input', {
                    type: 'range',
                    min: 32,
                    max: 120,
                    step: 2,
                    value: size,
                    onChange: function (event) {
                      patch({ size: Number(event.target.value) });
                    },
                  }),
                ),
                h(
                  'label',
                  { className: 'tc-float-field' },
                  h('span', null, t('便签透明度', 'Note opacity') + ' · ' + Math.round(alpha * 100) + '%'),
                  h('input', {
                    type: 'range',
                    min: 30,
                    max: 100,
                    step: 5,
                    value: Math.round(alpha * 100),
                    onChange: function (event) {
                      patch({ opacity: Number(event.target.value) / 100 });
                    },
                  }),
                ),
                h(
                  'label',
                  { className: 'tc-float-field' },
                  h('span', null, t('便签字号', 'Note text size') + ' · ' + noteFont + 'px'),
                  h('input', {
                    type: 'range',
                    min: 11,
                    max: 20,
                    step: 1,
                    value: noteFont,
                    onChange: function (event) {
                      patch({ noteFont: Number(event.target.value) });
                    },
                  }),
                ),
                h(
                  'label',
                  { className: 'tc-float-field' },
                  h('span', null, t('便签方向', 'Note side')),
                  h(
                    'select',
                    {
                      className: 'tc-select',
                      value: settings.side || 'auto',
                      onChange: function (event) {
                        patch({ side: event.target.value }, true);
                      },
                    },
                    h('option', { value: 'auto' }, t('自动：跟着屏幕位置换边', 'Auto: follow position')),
                    h('option', { value: 'right' }, t('固定在右', 'Always right')),
                    h('option', { value: 'left' }, t('固定在左', 'Always left')),
                    h('option', { value: 'above' }, t('固定在上', 'Always above')),
                    h('option', { value: 'below' }, t('固定在下', 'Always below')),
                  ),
                ),
                h(
                  'div',
                  { className: 'tc-set-row' },
                  h(
                    'div',
                    { className: 'tc-set-icons' },
                    FLOAT_PRESETS.map(function (preset) {
                      return h(
                        'button',
                        {
                          key: preset,
                          type: 'button',
                          className: 'tc-set-icon',
                          title: preset === 'pill' ? t('默认胶囊', 'Default capsule') : preset,
                          'aria-pressed': icon === preset ? 'true' : 'false',
                          onClick: function () {
                            patch({ icon: preset }, true);
                          },
                        },
                        preset === 'pill' ? h(CapsuleIcon, { size: 14, active: true }) : preset,
                      );
                    }),
                  ),
                ),
                h(
                  'div',
                  { className: 'tc-set-row' },
                  h(
                    'label',
                    { className: 'tc-btn tc-btn-mini', style: { display: 'inline-flex', alignItems: 'center', cursor: 'pointer' } },
                    t('换图…', 'Image…'),
                    h('input', {
                      type: 'file',
                      accept: 'image/*',
                      style: { display: 'none' },
                      onChange: function (event) {
                        pickIcon(event.target.files && event.target.files[0]);
                      },
                    }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-btn tc-btn-mini',
                      onClick: function () {
                        patch({ x: null, y: null }, true);
                        setDragged(null);
                      },
                    },
                    t('复位', 'Reset'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-btn tc-btn-mini',
                      onClick: function () {
                        patch({ enabled: false }, true);
                        setShowSet(false);
                        setOpen(false);
                      },
                    },
                    t('隐藏胶囊', 'Hide'),
                  ),
                ),
              )
            : null,
          open
            ? h(
                'div',
                {
                  className: 'tc-float-note',
                  role: 'dialog',
                  'aria-label': t('便签', 'Quick note'),
                  style: Object.assign({ opacity: alpha }, panelStyle()),
                },
                h(
                  'div',
                  { className: 'tc-float-head' },
                  h('span', null, t('随手记一条', 'Quick note')),
                  h('span', { className: 'tc-grow' }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-icon-btn',
                      title: t('收起', 'Close'),
                      'aria-label': t('收起便签', 'Close note'),
                      onClick: function () {
                        setOpen(false);
                        setNote('');
                      },
                    },
                    '×',
                  ),
                ),
                h('textarea', {
                  className: 'tc-input tc-float-text',
                  value: text,
                  rows: 3,
                  style: { fontSize: noteFont + 'px' },
                  placeholder: t('想到什么就写下来…（Enter 保存）', 'Jot it down… (Enter saves)'),
                  onChange: function (event) {
                    setText(event.target.value);
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent && event.nativeEvent.isComposing)) {
                      event.preventDefault();
                      save();
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'tc-float-bar' },
                  h('button', { type: 'button', className: 'tc-btn tc-btn-primary', onClick: save }, t('保存', 'Save')),
                  note ? h('span', { className: 'tc-float-msg' }, note) : null,
                ),
              )
            : null,
          h(
            'div',
            { className: 'tc-float-ball' },
            h(
              'button',
              {
                type: 'button',
                className: 'tc-icon-btn tc-float-gear',
                title: t('悬浮胶囊设置（大小/透明度/图标）', 'Capsule settings (size, opacity, icon)'),
                'aria-label': t('悬浮胶囊设置', 'Capsule settings'),
                'aria-expanded': showSet ? 'true' : 'false',
                onPointerDown: function (event) {
                  event.stopPropagation();
                },
                onClick: function (event) {
                  event.stopPropagation();
                  setShowSet(!showSet);
                },
              },
              '⚙',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'tc-float-btn',
                style: { width: size + 'px', height: size + 'px' },
                title: t('思维胶囊：点开便签，拖动可移动', 'Thought capsule: click for a note, drag to move'),
                'aria-label': t('思维胶囊', 'Thought capsule'),
                'aria-expanded': open ? 'true' : 'false',
                onPointerDown: onPointerDown,
              },
              isImage
                ? h('img', { src: icon, alt: '' })
                : icon === 'pill'
                  ? h(CapsuleIcon, { size: glyph, active: true })
                  : h('span', { className: 'tc-float-emoji', style: { fontSize: glyph + 'px' } }, icon),
            ),
          ),
        );
      }

      /**
       * 划词捕获（P1.4）：在宿主里选中一段文字后，浮出一个「记下来」小气泡，点一下就进未整理。
       *
       * 单独挂一个 shell.overlay 席位，跟悬浮胶囊的开关互不影响；
       * 开关存在 settings.float.capture（跟其它界面设置同一个包，省一条接口）。
       * 只读 selection 的文本和位置，不碰宿主 DOM。
       */
      function SelectionBubble() {
        var enabledState = react.useState(false);
        var enabled = enabledState[0];
        var setEnabled = enabledState[1];
        var boxState = react.useState(null);
        var box = boxState[0];
        var setBox = boxState[1];
        var textState = react.useState('');
        var selText = textState[0];
        var setSelText = textState[1];
        var noteState = react.useState('');
        var note = noteState[0];
        var setNote = noteState[1];
        var rootRef = react.useRef(null);

        react.useEffect(function () {
          api('/api/settings').then(
            function (res) {
              setEnabled(!!(res.settings && res.settings.float && res.settings.float.capture));
            },
            function () {
              /* 读不到设置就按关闭处理 */
            },
          );
          function onSettings(event) {
            var detail = event && event.detail;
            if (detail && detail.float && typeof detail.float.capture === 'boolean') setEnabled(detail.float.capture);
          }
          window.addEventListener(SETTINGS_EVENT, onSettings);
          return function () {
            window.removeEventListener(SETTINGS_EVENT, onSettings);
          };
        }, []);

        react.useEffect(
          function () {
            if (!enabled) {
              setBox(null);
              return undefined;
            }
            var timer = null;

            function hide() {
              setBox(null);
              setNote('');
            }

            /** 选区变了就重新量一遍位置；选中的是面板自己的输入框就无视。 */
            function sample() {
              try {
                var selection = window.getSelection ? window.getSelection() : null;
                var raw = selection ? String(selection.toString() || '') : '';
                var text = raw.replace(/\s+/g, ' ').trim();
                if (!text || text.length < 2) {
                  hide();
                  return;
                }
                var range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                var rect = range && typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
                if (!rect || (!rect.width && !rect.height)) {
                  hide();
                  return;
                }
                var root = rootRef.current;
                var node = range.commonAncestorContainer;
                var host = node && node.nodeType === 1 ? node : node && node.parentElement;
                if (root && host && (root === host || root.contains(host))) {
                  hide();
                  return;
                }
                setSelText(text.length > 500 ? text.slice(0, 500) : text);
                setBox({ left: rect.left + rect.width / 2, top: rect.top });
                setNote('');
              } catch (err) {
                hide();
              }
            }

            function schedule() {
              if (timer) clearTimeout(timer);
              timer = setTimeout(sample, 220);
            }

            function onDown(event) {
              var root = rootRef.current;
              if (root && event.target && root.contains(event.target)) return;
              hide();
            }

            document.addEventListener('selectionchange', schedule);
            document.addEventListener('mouseup', schedule);
            document.addEventListener('keyup', schedule);
            document.addEventListener('mousedown', onDown, true);
            return function () {
              if (timer) clearTimeout(timer);
              document.removeEventListener('selectionchange', schedule);
              document.removeEventListener('mouseup', schedule);
              document.removeEventListener('keyup', schedule);
              document.removeEventListener('mousedown', onDown, true);
            };
          },
          [enabled],
        );

        if (!enabled || !box) return null;

        function save() {
          var text = String(selText || '').trim();
          if (!text) return;
          api('/api/items', { method: 'POST', body: JSON.stringify({ text: text }) }).then(
            function () {
              setNote(t('已进未整理', 'Saved to Inbox'));
              announce(CHANGED_EVENT);
              try {
                if (window.getSelection) window.getSelection().removeAllRanges();
              } catch (err) {
                /* 选区已经没了 */
              }
              setTimeout(function () {
                setBox(null);
                setNote('');
              }, 900);
            },
            function (err) {
              setNote(t('存不上：', 'Failed: ') + msgOf(err));
            },
          );
        }

        var left = box.left;
        var top = box.top;
        try {
          var vw = window.innerWidth || 1200;
          left = Math.min(Math.max(left, 80), vw - 80);
        } catch (err) {
          /* 量不到视口就按原位置 */
        }
        return h(
          'div',
          {
            ref: rootRef,
            className: 'tc-cap',
            style: { left: left + 'px', top: Math.max(top - 8, 44) + 'px' },
            title: selText,
          },
          h('span', { className: 'tc-cap-hint' }, selText.length > 18 ? selText.slice(0, 18) + '…' : selText),
          h(
            'button',
            {
              type: 'button',
              className: 'tc-cap-btn',
              'data-primary': '1',
              onClick: save,
            },
            note || t('记下来', 'Capture'),
          ),
        );
      }


      function Panel() {
        var dataState = react.useState({ items: [], counts: { inbox: 0, todo: 0, done: 0, total: 0 }, categories: [] });
        var data = dataState[0];
        var setData = dataState[1];

        var errorState = react.useState('');
        var error = errorState[0];
        var setError = errorState[1];

        var draftState = react.useState('');
        var draft = draftState[0];
        var setDraft = draftState[1];

        var draftCatState = react.useState('');
        var draftCat = draftCatState[0];
        var setDraftCat = draftCatState[1];

        var filterState = react.useState('inbox');
        var filter = filterState[0];
        var setFilter = filterState[1];

        var catFilterState = react.useState('');
        var catFilter = catFilterState[0];
        var setCatFilter = catFilterState[1];

        /** 搜索框（P1.3）：纯前端过滤已加载的列表，不新增请求。 */
        var queryState = react.useState('');
        var query = queryState[0];
        var setQuery = queryState[1];

        /** 本周回看（P2.7）：{ open, busy, data }。 */
        var reviewState = react.useState({ open: false, busy: false, data: null });
        var review = reviewState[0];
        var setReview = reviewState[1];

        var busyState = react.useState(false);
        var busy = busyState[0];
        var setBusy = busyState[1];

        var stampState = react.useState('');
        var stamp = stampState[0];
        var setStamp = stampState[1];

        /** 「发给 AI」面板：null 关闭，{kind:'item', item} 或 {kind:'list', items}。 */
        var sendState = react.useState(null);
        var sendTarget = sendState[0];
        var setSendTarget = sendState[1];

        /** null=还没读；{workspaces:[{title,sessions}], loose:[]} —— 会话按未归档工作区分组。 */
        var sessionListState = react.useState(null);
        var sessionList = sessionListState[0];
        var setSessionList = sessionListState[1];

        /** 准备提交的目标：'' = 新会话；否则是已有会话 id。 */
        var pickedState = react.useState({});
        var picked = pickedState[0];
        var setPicked = pickedState[1];
        var editState = react.useState({ id: '', text: '' });
        var editing = editState[0];
        var setEditing = editState[1];
        var sendToState = react.useState('');
        var sendTo = sendToState[0];
        var setSendTo = sendToState[1];

        /** 新会话要落进哪个工作区：'' = 用宿主给的默认（最近有动静的那个）。 */
        var workState = react.useState({ list: null, pick: '' });
        var workPicker = workState[0];
        var setWorkPicker = workState[1];

        /** 发出去之前还能再补一句（比如「直接从思维胶囊里把这条打开」）。 */
        var extraState = react.useState('');
        var extra = extraState[0];
        var setExtra = extraState[1];

        var noteState = react.useState('');
        var note = noteState[0];
        var setNote = noteState[1];

        /** 挑漏掉的待办：{ busy, sessions, rows, raw } —— 面板里直接问宿主模型，不新开会话。 */
        var scanState = react.useState({ busy: false, sessions: [], rows: [], raw: '' });
        var scan = scanState[0];
        var setScan = scanState[1];

        /** 扫描结果里被点掉的行（忽视）和已存成胶囊的行。 */
        var ignoredState = react.useState({});
        var ignored = ignoredState[0];
        var setIgnored = ignoredState[1];
        var savedState = react.useState({});
        var savedRows = savedState[0];
        var setSavedRows = savedState[1];

        var floatState = react.useState(null);
        var floatSettings = floatState[0];
        var setFloatSettings = floatState[1];
        var showSettingsState = react.useState(false);
        var showSettings = showSettingsState[0];
        var setShowSettings = showSettingsState[1];

        var load = react.useCallback(function () {
          return api('/api/state')
            .then(function (next) {
              setData({
                items: Array.isArray(next.items) ? next.items : [],
                counts: next.counts || { inbox: 0, todo: 0, done: 0, total: 0 },
                categories: Array.isArray(next.categories) ? next.categories : [],
              });
              setError('');
              setStamp(new Date().toLocaleTimeString());
            })
            .catch(function (err) {
              setError(msgOf(err));
            });
        }, []);

        react.useEffect(
          function () {
            ensureStyle();
            load();
            api('/api/settings').then(
              function (res) {
                setFloatSettings(res.settings && res.settings.float);
              },
              function () {
                /* 读不到设置就先按默认（关闭） */
              },
            );
            function onChanged() {
              load();
            }
            window.addEventListener(CHANGED_EVENT, onChanged);
            var timer = setInterval(function () {
              try {
                if (document.visibilityState === 'hidden') return;
              } catch (err) {
                /* 取不到可见性就照常轮询 */
              }
              load();
            }, POLL_MS);
            return function () {
              window.removeEventListener(CHANGED_EVENT, onChanged);
              try {
                clearInterval(timer);
              } catch (err) {
                /* noop */
              }
            };
          },
          [load],
        );

        /** 改悬浮胶囊设置：写宿主，然后把新设置广播给悬浮组件。 */
        function updateFloat(patch) {
          api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }).then(
            function (res) {
              var next = res.settings && res.settings.float;
              setFloatSettings(next);
              announce(SETTINGS_EVENT, { float: next });
            },
            function (err) {
              setNote(t('设置没存上：', 'Could not save settings: ') + msgOf(err));
            },
          );
        }

        /** 把扫描出的一行存成胶囊（走同一套 POST /api/items，分类由宿主自动推断）。 */
        function saveScanRow(row, index) {
          var text = String((row && row.todo) || '').trim();
          if (!text) return;
          api('/api/items', { method: 'POST', body: JSON.stringify({ text: text }) }).then(
            function () {
              setSavedRows(function (prev) {
                var next = Object.assign({}, prev);
                next[index] = true;
                return next;
              });
              load();
            },
            function (err) {
              setNote(t('存胶囊失败：', 'Could not save: ') + msgOf(err));
            },
          );
        }

        /** 自定义图标：读成 data URL 交给宿主存起来。 */
        function pickIcon(file) {
          if (!file) return;
          if (file.size > 100 * 1024) {
            setNote(t('图标请小于 100 KB。', 'Keep the icon under 100 KB.'));
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            updateFloat({ icon: String(reader.result) });
          };
          reader.onerror = function () {
            setNote(t('读不了这张图。', 'Could not read that image.'));
          };
          reader.readAsDataURL(file);
        }

        /** 半截想法自动进草稿：输入停 700ms 存盘，刷新/重开面板自动回填。 */
        var draftLoaded = react.useRef(false);
        react.useEffect(function () {
          api('/api/draft')
            .then(function (res) {
              draftLoaded.current = true;
              var restored = res && res.draft && typeof res.draft.text === 'string' ? res.draft.text : '';
              if (!restored) return;
              setDraft(function (current) {
                return current || restored;
              });
              setNote(t('已恢复上次没写完的草稿，接着写或按回车保存。', 'Restored the draft you had not finished.'));
            })
            .catch(function () {
              draftLoaded.current = true;
            });
        }, []);

        react.useEffect(function () {
          if (!draftLoaded.current) return undefined;
          var text = String(draft || '');
          var timer = setTimeout(function () {
            api('/api/draft', { method: 'PUT', body: JSON.stringify({ text: text }) }).catch(function () {
              /* 草稿存不上不影响主流程 */
            });
          }, 700);
          return function () {
            clearTimeout(timer);
          };
        }, [draft]);

        /** 快捷键（P2.9）用的 ref：Ctrl/⌘+K 找搜索框，Ctrl/⌘+E 回输入框。 */
        var findRef = react.useRef(null);
        var composerRef = react.useRef(null);

        /** 本周回看（P2.7）：后端只做确定性统计，不调模型，所以点一下就有。 */
        function loadReview() {
          setReview(function (prev) {
            return { open: true, busy: true, data: prev.data };
          });
          api('/api/review?days=7').then(
            function (res) {
              setReview({ open: true, busy: false, data: res });
            },
            function (err) {
              setReview({ open: true, busy: false, data: null });
              setNote(t('回看统计失败：', 'Review failed: ') + msgOf(err));
            },
          );
        }

        react.useEffect(
          function () {
            function focus(el) {
              if (!el) return;
              try {
                el.focus();
              } catch (err) {
                /* 节点还没挂上就算了 */
              }
            }
            function onKey(event) {
              var native = event.nativeEvent || event;
              var key = String((native && native.key) || '');
              var meta = !!(native && (native.metaKey || native.ctrlKey)) && !(native && native.altKey);
              if (meta && (key === '/' || key.toLowerCase() === 'k')) {
                if (typeof native.preventDefault === 'function') native.preventDefault();
                focus(findRef.current);
                return;
              }
              if (meta && key.toLowerCase() === 'e') {
                if (typeof native.preventDefault === 'function') native.preventDefault();
                focus(composerRef.current);
                return;
              }
              if (key === 'Escape') {
                if (sendTarget) {
                  setSendTarget(null);
                  return;
                }
                if (review.open) {
                  setReview({ open: false, busy: false, data: review.data });
                  return;
                }
                if (query) setQuery('');
              }
            }
            window.addEventListener('keydown', onKey);
            return function () {
              window.removeEventListener('keydown', onKey);
            };
          },
          [sendTarget, review.open, review.data, query],
        );


        var submit = react.useCallback(
          function () {
            var value = String(draft || '').trim();
            if (!value || busy) return;
            setBusy(true);
            var payload = { text: value };
            if (draftCat) payload.category = draftCat;
            api('/api/items', { method: 'POST', body: JSON.stringify(payload) })
              .then(function (res) {
                setDraft('');
                api('/api/draft', { method: 'PUT', body: JSON.stringify({ text: '' }) }).catch(function () {
                  /* 清草稿失败不阻断保存 */
                });
                setError('');
                if (res && res.item) {
                  setData(function (prev) {
                    var rest = prev.items.filter(function (it) {
                      return it.id !== res.item.id;
                    });
                    return {
                      items: [res.item].concat(rest),
                      counts: res.counts || prev.counts,
                      categories: prev.categories,
                    };
                  });
                }
                return load();
              })
              .catch(function (err) {
                setError(msgOf(err));
              })
              .then(function () {
                setBusy(false);
              });
          },
          [draft, draftCat, busy, load],
        );

        var mutate = react.useCallback(
          function (id, patch) {
            api('/api/items/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) })
              .then(function () {
                setError('');
                return load();
              })
              .catch(function (err) {
                setError(msgOf(err));
              });
          },
          [load],
        );

        var remove = react.useCallback(
          function (item) {
            var confirmed = true;
            try {
              confirmed = window.confirm(t('删除这条胶囊？\n\n', 'Delete this capsule?\n\n') + item.text);
            } catch (err) {
              confirmed = true;
            }
            if (!confirmed) return;
            api('/api/items/' + encodeURIComponent(item.id), { method: 'DELETE' })
              .then(function () {
                setError('');
                return load();
              })
              .catch(function (err) {
                setError(msgOf(err));
              });
          },
          [load],
        );

        /** 内联编辑：只有内容真的变了才发请求。 */
        function saveEdit(item) {
          var text = String((editing && editing.text) || '').trim();
          setEditing({ id: '', text: '' });
          if (!text || text === String(item.text).trim()) return;
          mutate(item.id, { text: text });
        }

        /** 自己新建一个分组（分类）。 */
        function createCategory() {
          var name = window.prompt(t('新分组的名字', 'Name for the new group'));
          if (!name || !name.trim()) return;
          api('/api/categories', { method: 'POST', body: JSON.stringify({ label: name.trim() }) })
            .then(function () {
              setNote(t('已新建分组：', 'Created group: ') + name.trim());
              return load();
            })
            .catch(function (err) {
              setNote(t('新建分组失败：', 'Could not create the group: ') + msgOf(err));
            });
        }

        /**
         * 把「这条」或「选中的几条」整理成一段能直接发给 AI 的话。
         * 每条都带 id / 分类 / 状态 / 时间（有标签和截止日也带上），多条时才分得清是哪条。
         * 不附带别的胶囊：用户转什么就发什么。
         */
        function digestOf(target) {
          var list = target.kind === 'item' ? [target.item] : target.items;
          var head = t('这是我思维胶囊里的内容，接着帮我处理：', 'These are capsules I captured — help me take them forward:');
          var lines = list.map(function (it, index) {
            return (
              index + 1 + '. ' + String(it.text).replace(/\r?\n/g, ' ') +
              (it.id ? '（id: ' + it.id + '）' : '') +
              '（' + categoryName(it.category) + ' · ' + STATUS_LABELS[it.status][0] + ' · ' + formatTime(it.createdAt) +
              (Array.isArray(it.tags) && it.tags.length ? ' · #' + it.tags.join(' #') : '') +
              (it.dueDate ? ' · ' + t('截止 ', 'due ') + it.dueDate : '') +
              '）'
            );
          });
          return head + '\n\n' + lines.join('\n');
        }

        function describeTarget(target) {
          if (!target) return '';
          if (target.kind === 'item') return t('这条胶囊', 'this capsule');
          return t(target.items.length + ' 条', target.items.length + ' items');
        }

        function toggleSend(target) {
          if (sendTarget && sendTarget.kind === target.kind && (target.kind === 'list' || sendTarget.item.id === target.item.id)) {
            setSendTarget(null);
            return;
          }
          setNote('');
          setExtra('');
          setSendTo('');
          setSendTarget(target);
          if (workPicker.list === null) {
            api('/api/workspaces')
              .then(function (res) {
                setWorkPicker({
                  list: Array.isArray(res.workspaces) ? res.workspaces : [],
                  pick: workPicker.pick || '',
                });
              })
              .catch(function () {
                setWorkPicker({ list: [], pick: workPicker.pick || '' });
              });
          }
          if (sessionList === null) {
            api('/api/sessions?limit=12')
              .then(function (res) {
                setSessionList({
                  workspaces: Array.isArray(res.workspaces) ? res.workspaces : [],
                  loose: Array.isArray(res.loose) ? res.loose : [],
                  defaultWorkspaceId: res.defaultWorkspaceId ? String(res.defaultWorkspaceId) : '',
                });
              })
              .catch(function (err) {
                setSessionList({ workspaces: [], loose: [], defaultWorkspaceId: '' });
                setNote(t('读不到会话列表：', 'Could not list sessions: ') + msgOf(err));
              });
          }
        }

        /** 发给 AI 的正文 = 胶囊摘要 + 用户补的那一句。 */
        function composeText(target) {
          var text = digestOf(target);
          var tail = String(extra || '').trim();
          return tail ? text + '\n\n补充：' + tail : text;
        }

        /** 在分组列表里找一条会话（返回会话本身和工作区名，给提示语用）。 */
        function findSession(id) {
          var groups = (sessionList && sessionList.workspaces) || [];
          for (var i = 0; i < groups.length; i += 1) {
            var sessions = groups[i].sessions || [];
            for (var j = 0; j < sessions.length; j += 1) {
              if (sessions[j].id === id) return { session: sessions[j], group: groups[i].title };
            }
          }
          var loose = (sessionList && sessionList.loose) || [];
          for (var k = 0; k < loose.length; k += 1) {
            if (loose[k].id === id) return { session: loose[k], group: '' };
          }
          return null;
        }

        /**
         * 把正文放进会话输入框，**不发送**：占住会话 → 拿到 binding → 请求草稿初始化。
         * 会话刚建好时输入口可能还没挂上（blocked），重试几次再放弃。
         */
        function draftInto(sessionId, text, onDone) {
          var sessions = svc('sessions');
          var conversation = svc('conversation');
          if (!sessions || typeof sessions.retain !== 'function') {
            setNote(t('当前界面取不到会话服务。', 'The sessions service is unavailable here.'));
            return;
          }
          if (!conversation || !conversation.input || typeof conversation.input.requestDraftInitialization !== 'function') {
            setNote(t('当前界面没有会话输入口，内容没法放进草稿。', 'The conversation input is unavailable here, so the text cannot be drafted.'));
            return;
          }
          var tries = 0;
          var schedule = function () {
            setTimeout(attempt, 300);
          };
          var attempt = function () {
            tries += 1;
            var reference;
            try {
              reference = sessions.retain(sessionId, { source: 'controllerOperation' });
            } catch (err) {
              setNote(t('打不开这个会话：', 'Could not open that session: ') + msgOf(err));
              return;
            }
            var release = function () {
              try {
                reference.release();
              } catch (err) {
                /* noop */
              }
            };
            Promise.resolve(reference.ready).then(
              function (readyBinding) {
                var binding =
                  (typeof sessions.binding === 'function' && sessions.binding(sessionId)) || readyBinding || reference.binding;
                if (!binding) throw new Error(t('会话还没准备好', 'the session is not ready'));
                var outcome = conversation.input.requestDraftInitialization(binding, { prompt: text });
                release();
                if (outcome === 'blocked') {
                  if (tries < 8) schedule();
                  else setNote(t('会话还没准备好，稍后再点一次。', 'The session is not ready yet — try again in a moment.'));
                  return;
                }
                if (outcome === 'preserved') {
                  setNote(t('这条会话里已经有草稿，我没有覆盖它；先清空那边的输入框再点一次。', 'That session already has a draft — clear it, then try again.'));
                  return;
                }
                onDone();
              },
            ).catch(function (err) {
              release();
              if (tries < 8) {
                schedule();
                return;
              }
              setNote(t('没能放进草稿：', 'Could not draft it: ') + msgOf(err));
            });
          };
          attempt();
        }

        /** 新会话要落进哪个工作区：会话列表里带的默认值，没有就现问一次。 */
        function resolveWorkspaceId() {
          var cached = (sessionList && sessionList.defaultWorkspaceId) || '';
          if (cached) return Promise.resolve(cached);
          return api('/api/sessions?limit=1').then(function (res) {
            return res && res.defaultWorkspaceId ? String(res.defaultWorkspaceId) : '';
          });
        }

        /**
         * 转出去之后标记这批胶囊：状态变「已完成」+ 记下转到哪个会话（面板里能点着跳回去）。
         * 单条和批量都走这里；归档的保持归档，不偷偷改回 done。
         */
        function markRouted(target, sessionId) {
          if (!target || !sessionId) return;
          var list = target.kind === 'item' ? [target.item] : target.items || [];
          for (var i = 0; i < list.length; i += 1) {
            var entry = list[i];
            if (!entry || !entry.id) continue;
            var patch = { routedSessionId: String(sessionId), routedAt: new Date().toISOString() };
            if (entry.status !== 'archived') patch.status = 'done';
            mutate(entry.id, patch);
          }
          setPicked({});
        }

        /** 「准备提交」：把内容放进目标会话的输入框，等用户自己在会话里按发送。 */
        function prepareSubmit(target) {
          var text = composeText(target);
          if (sendTo) {
            var found = findSession(sendTo);
            var label = (found && found.session.title) || String(sendTo).slice(0, 8);
            openSession(sendTo);
            draftInto(sendTo, text, function () {
              markRouted(target, sendTo);
              setSendTarget(null);
              setNote(t('已放进会话「' + label + '」的输入框，确认后按回车发送。', 'Drafted into “' + label + '” — press Enter there to send.'));
            });
            return;
          }
          var workspace = svc('uiWorkspace');
          if (!workspace || typeof workspace.connectWorkspace !== 'function') {
            setNote(t('当前界面没有「新建会话」能力。', 'Creating a session is unavailable here.'));
            return;
          }
          var chosen = workPicker.pick;
          (chosen ? Promise.resolve(chosen) : resolveWorkspaceId()).then(
            function (workspaceId) {
              if (!workspaceId) throw new Error(t('找不到可用的工作区', 'no workspace available'));
              return Promise.resolve(workspace.connectWorkspace(workspaceId));
            },
          ).then(
            function (created) {
              var sessionId = created ? String(created) : '';
              if (!sessionId) throw new Error(t('宿主没有返回会话 id', 'host returned no session id'));
              openSession(sessionId);
              draftInto(sessionId, text, function () {
                markRouted(target, sessionId);
                setSendTarget(null);
                setNote(
                  t('已放进新会话的输入框（工作区：' + workspaceLabel() + '），确认后按回车发送。',
                    'Drafted in a new session (' + workspaceLabel() + ') — press Enter there to send.'),
                );
              });
            },
          ).catch(function (err) {
            setNote(t('新建会话失败：', 'Could not start a session: ') + msgOf(err));
          });
        }

        /** 选中的工作区名字，只用于提示。 */
        function workspaceLabel() {
          var pick = workPicker.pick || (sessionList && sessionList.defaultWorkspaceId) || '';
          var list = workPicker.list || [];
          for (var i = 0; i < list.length; i += 1) {
            if (list[i].id === pick) return list[i].title || list[i].path || pick;
          }
          return pick ? String(pick).slice(0, 8) : t('默认', 'default');
        }

        function copyDigest(target) {
          var text = composeText(target);
          try {
            if (!navigator || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
              throw new Error(t('浏览器不给剪贴板权限', 'clipboard unavailable'));
            }
            navigator.clipboard.writeText(text).then(
              function () {
                setSendTarget(null);
                setNote(t('已复制到剪贴板。', 'Copied to clipboard.'));
              },
              function (err) {
                setNote(t('复制失败：', 'Copy failed: ') + msgOf(err));
              },
            );
          } catch (err) {
            setNote(t('复制失败：', 'Copy failed: ') + msgOf(err));
          }
        }

        function openSession(sessionId) {
          var workspace = svc('uiWorkspace');
          if (!workspace || typeof workspace.openSession !== 'function') {
            setNote(t('当前界面没有「打开会话」能力。', 'Opening a session is unavailable here.'));
            return;
          }
          try {
            workspace.openSession(sessionId);
          } catch (err) {
            setNote(t('跳转失败：', 'Could not open it: ') + msgOf(err));
          }
        }

        /** 「找我漏掉的待办」：在面板里直接问宿主模型，结果用表格显示，不跳会话。 */
        function doScan() {
          if (scan.busy) return;
          setNote('');
          setScan({ busy: true, sessions: scan.sessions, rows: scan.rows, raw: scan.raw });
          api('/api/find-missed', { method: 'POST', body: JSON.stringify({ limit: 6 }) }).then(
            function (res) {
              var rows = Array.isArray(res.rows) ? res.rows : [];
              setIgnored({});
              setSavedRows({});
              setScan({ busy: false, sessions: Array.isArray(res.sessions) ? res.sessions : [], rows: rows, raw: res.raw || '' });
              if (!rows.length) {
                setNote(t('没找到明确漏掉的待办；模型原始输出可以展开看。', 'No clearly missed to-dos found — you can expand the raw output below.'));
              }
            },
            function (err) {
              setScan({ busy: false, sessions: scan.sessions, rows: [], raw: '' });
              setNote(t('盘点失败：', 'Scan failed: ') + msgOf(err));
            },
          );
        }

        var categories = data.categories.length ? data.categories : FALLBACK_CATEGORIES;
        function categoryName(id) {
          for (var i = 0; i < categories.length; i += 1) {
            if (categories[i].id === id) return isZh() ? categories[i].zh : categories[i].en;
          }
          return id;
        }

        var items = data.items || [];
        var needle = String(query || '').trim().toLowerCase();
        /** 一条胶囊的可搜索文本：正文 + 标签 + 分类显示名。 */
        function haystackOf(item) {
          var tags = Array.isArray(item.tags) ? item.tags.join(' ') : '';
          return (String(item.text || '') + ' ' + tags + ' ' + categoryName(item.category)).toLowerCase();
        }
        var visible = items.filter(function (it) {
          if (filter !== 'all' && it.status !== filter) return false;
          if (catFilter && it.category !== catFilter) return false;
          if (needle && haystackOf(it).indexOf(needle) === -1) return false;
          return true;
        });

        var pickedItems = items.filter(function (it) {
          return !!picked[it.id];
        });

        var emptyText =
          filter === 'archived'
            ? t('归档是空的。做完又不想删的胶囊，点「归档」放这里。', 'Nothing archived yet. Send finished capsules here instead of deleting them.')
            : filter === 'done'
            ? t('还没有完成的事。', 'Nothing completed yet.')
            : filter === 'todo'
              ? t('待办是空的。把攒下的胶囊挪进来就开始干活。', 'No todos. Move a capsule here when you pick it up.')
              : t('这里还是空的。\n想到什么就用上面的框记一条，回车保存。', 'Nothing here yet.\nCapture something above — Enter saves.');
        if (catFilter && filter !== 'done') {
          emptyText = t('这个分类下没有内容。', 'Nothing in this category.');
        }
        if (needle) {
          emptyText = t('没有匹配「' + query.trim() + '」的胶囊。', 'Nothing matches “' + query.trim() + '”.');
        }

        function renderItem(item) {
          var statusButtons = STATUS_ORDER.map(function (status) {
            return h(
              'button',
              {
                key: 'status-' + status,
                type: 'button',
                className: 'tc-seg-btn',
                'data-active': item.status === status ? '1' : '0',
                'aria-pressed': item.status === status ? 'true' : 'false',
                title: t('改成「' + STATUS_LABELS[status][0] + '」', 'Move to ' + STATUS_LABELS[status][1]),
                onClick: function () {
                  if (item.status !== status) mutate(item.id, { status: status });
                },
              },
              t(STATUS_LABELS[status][0], STATUS_LABELS[status][1]),
            );
          });
          return h(
            'div',
            {
              key: item.id,
              className: 'tc-item',
              'data-done': item.status === 'done' ? '1' : '0',
              'data-status': item.status,
            },
            editing.id === item.id
              ? h(
                  'div',
                  { className: 'tc-edit' },
                  h('textarea', {
                    className: 'tc-input tc-edit-input',
                    value: editing.text,
                    rows: 3,
                    autoFocus: true,
                    'aria-label': t('编辑胶囊正文', 'Edit capsule text'),
                    onChange: function (event) {
                      setEditing({ id: item.id, text: event.target.value });
                    },
                    onKeyDown: function (event) {
                      var native = event.nativeEvent || event;
                      if (native && native.isComposing) return;
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditing({ id: '', text: '' });
                      }
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        saveEdit(item);
                      }
                    },
                  }),
                  h(
                    'div',
                    { className: 'tc-edit-bar' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-btn tc-btn-primary tc-btn-mini',
                        disabled: !String(editing.text || '').trim() || String(editing.text).trim() === String(item.text).trim(),
                        onClick: function () {
                          saveEdit(item);
                        },
                      },
                      t('保存', 'Save'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-btn tc-btn-mini',
                        onClick: function () {
                          setEditing({ id: '', text: '' });
                        },
                      },
                      t('取消', 'Cancel'),
                    ),
                  ),
                )
              : h('div', { className: 'tc-item-text' }, item.text),
            h(
              'div',
              { className: 'tc-item-meta' },
              h('span', { className: 'tc-dot', 'data-status': item.status, 'aria-hidden': 'true' }),
              h('span', { className: 'tc-tag' }, categoryName(item.category)),
              Array.isArray(item.tags) && item.tags.length
                ? h(
                    'span',
                    { className: 'tc-taglist' },
                    item.tags.map(function (tag) {
                      return h('span', { key: 'tag-' + tag, className: 'tc-tagpill' }, '#' + tag);
                    }),
                  )
                : null,
              item.dueDate
                ? h(
                    'span',
                    {
                      className: 'tc-due',
                      'data-overdue': item.status !== 'done' && item.dueDate < todayKey() ? '1' : '0',
                      title: t('截止日（只记录，不提醒）', 'Due date (recorded, no reminder)'),
                    },
                    t('截止 ', 'due ') + item.dueDate,
                  )
                : null,
              h('span', null, formatTime(item.createdAt)),
              item.archivedAt ? h('span', { className: 'tc-src' }, t('归档于 ', 'archived ') + formatTime(item.archivedAt)) : null,
              item.source === 'agent' ? h('span', { className: 'tc-src' }, t('agent 记的', 'from agent')) : null,
              item.routedSessionId
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-route',
                      title: t('已转给这个会话：', 'Routed to this session: ') + item.routedSessionId,
                      onClick: function () {
                        openSession(item.routedSessionId);
                      },
                    },
                    t('转给会话 ', 'to ') + String(item.routedSessionId).slice(0, 8),
                  )
                : null,
              item.sourceSessionId
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-route',
                      title: t('这条是在这个会话里记的：', 'Recorded in this session: ') + item.sourceSessionId,
                      onClick: function () {
                        openSession(item.sourceSessionId);
                      },
                    },
                    t('来自会话 ', 'from ') + String(item.sourceSessionId).slice(0, 8),
                  )
                : null,
            ),
            h(
              'div',
              { className: 'tc-item-actions' },
              h('input', {
                type: 'checkbox',
                className: 'tc-pick',
                checked: !!picked[item.id],
                title: t('选中以批量转给 AI', 'Select to send several at once'),
                'aria-label': t('选中这条胶囊', 'Select this capsule'),
                onChange: function () {
                  setPicked(function (prev) {
                    var next = Object.assign({}, prev);
                    if (next[item.id]) delete next[item.id];
                    else next[item.id] = true;
                    return next;
                  });
                },
              }),
              h('div', { className: 'tc-seg', role: 'group', 'aria-label': t('状态', 'Status') }, statusButtons),
              h(
                'select',
                {
                  className: 'tc-select',
                  value: item.category,
                  'aria-label': t('分类', 'Category'),
                  title: t('改分类', 'Change category'),
                  onChange: function (event) {
                    var next = event.target.value;
                    if (next && next !== item.category) mutate(item.id, { category: next });
                  },
                },
                categories.map(function (cat) {
                  return h('option', { key: cat.id, value: cat.id }, isZh() ? cat.zh : cat.en);
                }),
              ),
              h('span', { className: 'tc-grow' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-icon-btn tc-icon-btn-ai',
                  title: t('转给 AI：把这条胶囊发给新会话或已有会话', 'Send to AI: hand this capsule to a new or existing session'),
                  'aria-label': t('转给 AI', 'Send to AI'),
                  'aria-expanded': sendTarget && sendTarget.kind === 'item' && sendTarget.item.id === item.id ? 'true' : 'false',
                  onClick: function () {
                    toggleSend({ kind: 'item', item: item });
                  },
                },
                t('转给 AI', 'To AI'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-icon-btn',
                  title: t('编辑正文', 'Edit text'),
                  'aria-label': t('编辑这条胶囊', 'Edit this capsule'),
                  onClick: function () {
                    setEditing({ id: item.id, text: item.text });
                  },
                },
                '✎',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-icon-btn',
                  title: t('删除（需确认）', 'Delete (asks first)'),
                  'aria-label': t('删除这条胶囊', 'Delete this capsule'),
                  onClick: function () {
                    remove(item);
                  },
                },
                '×',
              ),
            ),
          );
        }

        var tabs = [
          { id: 'inbox', zh: '未整理', en: 'Inbox', count: data.counts.inbox },
          { id: 'todo', zh: '待办', en: 'To do', count: data.counts.todo },
          { id: 'done', zh: '已完成', en: 'Done', count: data.counts.done },
          { id: 'archived', zh: '归档', en: 'Archive', count: data.counts.archived },
          { id: 'all', zh: '全部', en: 'All', count: data.counts.total },
        ];

        return h(
          'div',
          { className: 'tc-root' },
          h(
            'div',
            { className: 'tc-page' },
            h(
              'div',
              { className: 'tc-head' },
              h('span', { className: 'tc-head-icon' }, h(CapsuleIcon, { size: 18, active: true })),
              h('div', { className: 'tc-head-title' }, label()),
              h(
                'span',
                { className: 'tc-head-badge', title: t('未整理的条数', 'Capsules waiting to be sorted') },
                data.counts.inbox + t(' 待整理', ' to sort'),
              ),
              h('span', { className: 'tc-grow' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-scan-btn',
                  disabled: scan.busy,
                  title: t(
                    '让 AI 读一遍你最近的会话，用表格列出可能漏掉的待办 / 话题',
                    'Have the AI read your recent sessions and list dropped to-dos as a table',
                  ),
                  onClick: doScan,
                },
                scan.busy ? t('扫描中…', 'Scanning…') : t('找漏掉的待办', 'Find missed to-dos'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-btn tc-btn-mini tc-float-toggle' + (floatSettings && floatSettings.enabled ? ' tc-btn-primary' : ''),
                  title: t('在界面上显示/隐藏那颗彩色悬浮胶囊，点它就能随手记', 'Show or hide the floating capsule that opens a quick note'),
                  'aria-pressed': floatSettings && floatSettings.enabled ? 'true' : 'false',
                  onClick: function () {
                    updateFloat({ enabled: !(floatSettings && floatSettings.enabled) });
                  },
                },
                h(CapsuleIcon, { size: 12, active: true }),
                h('span', null, floatSettings && floatSettings.enabled ? t('隐藏悬浮', 'Hide float') : t('悬浮胶囊', 'Floating capsule')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-icon-btn',
                  title: t('悬浮胶囊设置', 'Floating capsule settings'),
                  'aria-label': t('悬浮胶囊设置', 'Floating capsule settings'),
                  'aria-expanded': showSettings ? 'true' : 'false',
                  onClick: function () {
                    setShowSettings(!showSettings);
                  },
                },
                '⚙',
              ),
            ),
            h(
              'div',
              { className: 'tc-scan-hint' },
              t(
                '「找漏掉的待办」= 让 AI 读你最近的会话，检查有没有没记下来的待办或话题；结果直接列在下面，不用新开会话。',
                'Find missed to-dos: the AI reads your recent sessions and lists dropped to-dos below — no new session involved.',
              ),
            ),
            showSettings
              ? h(
                  'div',
                  { className: 'tc-set' },
                  h(
                    'label',
                    { className: 'tc-set-row' },
                    h('input', {
                      type: 'checkbox',
                      checked: !!(floatSettings && floatSettings.enabled),
                      onChange: function (event) {
                        updateFloat({ enabled: event.target.checked });
                      },
                    }),
                    h('span', null, t('在桌面上显示彩色思维胶囊', 'Show a floating capsule on the desktop')),
                  ),
                  h(
                    'div',
                    { className: 'tc-set-row' },
                    h('span', null, t('图标', 'Icon')),
                    h(
                      'div',
                      { className: 'tc-set-icons' },
                      FLOAT_PRESETS.map(function (preset) {
                        var current = (floatSettings && floatSettings.icon) || 'pill';
                        return h(
                          'button',
                          {
                            key: preset,
                            type: 'button',
                            className: 'tc-set-icon',
                            title: preset === 'pill' ? t('默认胶囊', 'Default capsule') : preset,
                            'aria-pressed': current === preset ? 'true' : 'false',
                            onClick: function () {
                              updateFloat({ icon: preset });
                            },
                          },
                          preset === 'pill' ? h(CapsuleIcon, { size: 14, active: true }) : preset,
                        );
                      }),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'tc-set-row' },
                    h(
                      'label',
                      { className: 'tc-btn', style: { display: 'inline-flex', alignItems: 'center', cursor: 'pointer' } },
                      t('自定义图片…', 'Custom image…'),
                      h('input', {
                        type: 'file',
                        accept: 'image/*',
                        style: { display: 'none' },
                        onChange: function (event) {
                          pickIcon(event.target.files && event.target.files[0]);
                        },
                      }),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-btn',
                        onClick: function () {
                          updateFloat({ x: null, y: null });
                        },
                      },
                      t('位置复位', 'Reset position'),
                    ),
                  ),
                  h(
                    'label',
                    { className: 'tc-float-field' },
                    h(
                      'span',
                      null,
                      t('大小', 'Size') + ' · ' + ((floatSettings && floatSettings.size) || 54) + 'px',
                    ),
                    h('input', {
                      type: 'range',
                      min: 32,
                      max: 120,
                      step: 2,
                      value: (floatSettings && floatSettings.size) || 54,
                      onChange: function (event) {
                        updateFloat({ size: Number(event.target.value) });
                      },
                    }),
                  ),
                  h(
                    'label',
                    { className: 'tc-float-field' },
                    h(
                      'span',
                      null,
                      t('便签透明度', 'Note opacity') + ' · ' + Math.round(((floatSettings && floatSettings.opacity) || 0.96) * 100) + '%',
                    ),
                    h('input', {
                      type: 'range',
                      min: 30,
                      max: 100,
                      step: 5,
                      value: Math.round(((floatSettings && floatSettings.opacity) || 0.96) * 100),
                      onChange: function (event) {
                        updateFloat({ opacity: Number(event.target.value) / 100 });
                      },
                    }),
                  ),
                  h(
                    'label',
                    { className: 'tc-float-field' },
                    h(
                      'span',
                      null,
                      t('便签字号', 'Note text size') + ' · ' + ((floatSettings && floatSettings.noteFont) || 13) + 'px',
                    ),
                    h('input', {
                      type: 'range',
                      min: 11,
                      max: 20,
                      step: 1,
                      value: (floatSettings && floatSettings.noteFont) || 13,
                      onChange: function (event) {
                        updateFloat({ noteFont: Number(event.target.value) });
                      },
                    }),
                  ),
                  h(
                    'label',
                    { className: 'tc-set-row' },
                    h('input', {
                      type: 'checkbox',
                      checked: !!(floatSettings && floatSettings.capture),
                      onChange: function (event) {
                        updateFloat({ capture: event.target.checked });
                      },
                    }),
                    h('span', null, t('划词时浮出「记下来」小气泡', 'Show a capture bubble when you select text')),
                  ),
                  h(
                    'div',
                    { className: 'tc-set-row' },
                    h(
                      'a',
                      {
                        className: 'tc-btn',
                        href: BASE + '/api/export',
                        download: 'thought-capsules.json',
                        title: t('把整个胶囊库原样导出成 JSON 备份', 'Export the whole capsule store as JSON'),
                      },
                      t('导出 JSON', 'Export JSON'),
                    ),
                    h('span', { className: 'tc-set-hint' }, t('一个文件带走全部胶囊，备份/换设备用。', 'One file with everything — for backups.')),
                  ),
                  h(
                    'div',
                    { className: 'tc-set-hint' },
                    t(
                      '点胶囊弹出便签，写完保存就进「未整理」；拖动胶囊可以换位置。其他桌宠插件请到它自己的设置里关掉本胶囊，只留一个。',
                      'Click the capsule for a quick note; save sends it to Inbox. Drag to move. If you use another desktop-pet plugin, turn this capsule off there.',
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'tc-composer' },
              h('textarea', {
                ref: composerRef,
                className: 'tc-input',
                value: draft,
                placeholder: t(
                  '想到什么就先丢进来，回车保存（Shift+回车换行）…',
                  'Capture it before it slips — Enter saves, Shift+Enter for a new line…',
                ),
                onChange: function (event) {
                  setDraft(event.target.value);
                },
                onKeyDown: function (event) {
                  var native = event.nativeEvent || event;
                  if (native && native.isComposing) return;
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                },
              }),
              h(
                'div',
                { className: 'tc-composer-bar' },
                h(
                  'select',
                  {
                    className: 'tc-select',
                    value: draftCat,
                    title: t('新胶囊的分类', 'Category for the new capsule'),
                    'aria-label': t('新胶囊的分类', 'Category for the new capsule'),
                    onChange: function (event) {
                      setDraftCat(event.target.value);
                    },
                  },
                  h('option', { value: '' }, t('自动分类', 'Auto classify')),
                  categories.map(function (cat) {
                    return h('option', { key: cat.id, value: cat.id }, isZh() ? cat.zh : cat.en);
                  }),
                ),
                h('span', { className: 'tc-grow' }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tc-btn tc-btn-primary',
                    disabled: busy || !String(draft || '').trim(),
                    onClick: submit,
                  },
                  busy ? t('保存中…', 'Saving…') : t('记下来', 'Capture'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'tc-find' },
              h('input', {
                ref: findRef,
                className: 'tc-find-input',
                type: 'search',
                value: query,
                placeholder: t('搜胶囊：正文、标签、分类（Ctrl/⌘+K）', 'Search capsules (Ctrl/⌘+K)'),
                'aria-label': t('搜索胶囊', 'Search capsules'),
                title: t('只搜这里已经加载的胶囊，不联网', 'Searches only the capsules already loaded here'),
                onChange: function (event) {
                  setQuery(event.target.value);
                },
                onKeyDown: function (event) {
                  var native = event.nativeEvent || event;
                  if (native && native.isComposing) return;
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setQuery('');
                  }
                },
              }),
              query
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-find-clear',
                      onClick: function () {
                        setQuery('');
                      },
                    },
                    t('清空', 'Clear'),
                  )
                : null,
            ),
            h(
              'div',
              { className: 'tc-tabs', role: 'tablist', 'aria-label': t('按状态筛选', 'Filter by status') },
              tabs.map(function (tab) {
                return h(
                  'button',
                  {
                    key: tab.id,
                    type: 'button',
                    role: 'tab',
                    className: 'tc-tab',
                    'data-active': filter === tab.id ? '1' : '0',
                    'aria-selected': filter === tab.id ? 'true' : 'false',
                    onClick: function () {
                      setFilter(tab.id);
                    },
                  },
                  t(tab.zh, tab.en),
                  h('span', { className: 'tc-tab-count' }, tab.count),
                );
              }),
            ),
            h(
              'div',
              { className: 'tc-chips' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-chip',
                  'data-active': catFilter === '' ? '1' : '0',
                  onClick: function () {
                    setCatFilter('');
                  },
                },
                t('全部分类', 'All'),
              ),
              categories.map(function (cat) {
                return h(
                  'button',
                  {
                    key: cat.id,
                    type: 'button',
                    className: 'tc-chip',
                    'data-active': catFilter === cat.id ? '1' : '0',
                    onClick: function () {
                      setCatFilter(catFilter === cat.id ? '' : cat.id);
                    },
                  },
                  isZh() ? cat.zh : cat.en,
                );
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-chip tc-chip-add',
                  title: t('新建一个自己的分组', 'Create your own group'),
                  onClick: createCategory,
                },
                '+ ' + t('分组', 'Group'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'tc-chip',
                  'data-active': review.open ? '1' : '0',
                  title: t('本周新增/完成/停着的待办，纯本地统计', 'What happened this week — counted locally'),
                  onClick: function () {
                    if (review.open) {
                      setReview({ open: false, busy: false, data: review.data });
                    } else {
                      loadReview();
                    }
                  },
                },
                t('本周回看', 'This week'),
              ),
            ),
            sendTarget
              ? h(
                  'div',
                  { className: 'tc-send' },
                  h(
                    'div',
                    { className: 'tc-send-head' },
                    h('span', { className: 'tc-send-title' }, t('发给 AI：', 'Send to AI: ') + describeTarget(sendTarget)),
                    h('span', { className: 'tc-grow' }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-icon-btn',
                        title: t('收起', 'Close'),
                        'aria-label': t('收起发送面板', 'Close send panel'),
                        onClick: function () {
                          setSendTarget(null);
                        },
                      },
                      '×',
                    ),
                  ),
                  h(
                    'div',
                    { className: 'tc-send-bar' },
                    h(
                      'select',
                      {
                        className: 'tc-select',
                        value: sendTo,
                        'aria-label': t('选一个会话，或新建会话', 'Pick a session, or create one'),
                        onChange: function (event) {
                          setSendTo(event.target.value);
                        },
                      },
                      h('option', { value: '' }, t('新会话', 'New session')),
                      sessionList === null
                        ? h('option', { value: '', disabled: true }, t('读取会话…', 'Loading sessions…'))
                        : null,
                      sessionList
                        ? sessionList.workspaces.filter(function (group) {
                            return !workPicker.pick || group.id === workPicker.pick;
                          }).map(function (group) {
                            return h(
                              'optgroup',
                              { key: 'ws-' + group.id, label: group.title || t('未命名工作区', 'Untitled workspace') },
                              (group.sessions || []).map(function (session) {
                                return h(
                                  'option',
                                  { key: session.id, value: session.id },
                                  (session.title || session.id.slice(0, 8)) + (session.live ? t('（进行中）', ' (live)') : ''),
                                );
                              }),
                            );
                          })
                        : null,
                      sessionList && !workPicker.pick && sessionList.loose.length
                        ? h(
                            'optgroup',
                            { label: t('不在工作区里的会话', 'Sessions outside a workspace') },
                            sessionList.loose.map(function (session) {
                              return h(
                                'option',
                                { key: session.id, value: session.id },
                                (session.title || session.id.slice(0, 8)) + (session.live ? t('（进行中）', ' (live)') : ''),
                              );
                            }),
                          )
                        : null,
                    ),
                    sendTo
                      ? null
                      : h(
                          'select',
                          {
                            className: 'tc-select',
                            value: workPicker.pick || (sessionList && sessionList.defaultWorkspaceId) || '',
                            'aria-label': t('新会话放在哪个工作区', 'Workspace for the new session'),
                            title: t('新会话放在哪个工作区', 'Workspace for the new session'),
                            onChange: function (event) {
                              var pick = event.target.value;
                              setWorkPicker({ list: workPicker.list, pick: pick });
                              var groups = (sessionList && sessionList.workspaces) || [];
                              var belongs = !pick || groups.some(function (group) {
                                if (group.id !== pick) return false;
                                return (group.sessions || []).some(function (session) {
                                  return session.id === sendTo;
                                });
                              });
                              if (sendTo && !belongs) setSendTo('');
                            },
                          },
                          workPicker.list === null
                            ? h('option', { value: '', disabled: true }, t('读取工作区…', 'Loading workspaces…'))
                            : null,
                          (workPicker.list || []).map(function (item) {
                            return h(
                              'option',
                              { key: item.id, value: item.id },
                              (item.title || item.path || item.id.slice(0, 8)) + (item.sessionCount ? ' · ' + item.sessionCount : ''),
                            );
                          }),
                          workPicker.list && !workPicker.list.length
                            ? h('option', { value: '', disabled: true }, t('没有可选的工作区', 'No workspaces'))
                            : null,
                        ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-btn tc-btn-primary',
                        onClick: function () {
                          prepareSubmit(sendTarget);
                        },
                      },
                      t('准备提交', 'Prepare'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-btn',
                        onClick: function () {
                          copyDigest(sendTarget);
                        },
                      },
                      t('复制', 'Copy'),
                    ),
                  ),
                  h('textarea', {
                    className: 'tc-input tc-send-extra',
                    value: extra,
                    placeholder: t(
                      '可以再补一句，比如：直接从思维胶囊里把这条打开 / 拆成三条待办',
                      'Add one line, e.g. open this capsule for me / split it into three todos',
                    ),
                    onChange: function (event) {
                      setExtra(event.target.value);
                    },
                  }),
                  h(
                    'div',
                    { className: 'tc-send-hint' },
                    t(
                      '「准备提交」只把内容放进那条会话的输入框并打开它，不会发送——你在会话里确认后再按回车。',
                      'Prepare only fills that session’s composer and opens it; nothing is sent until you press Enter there.',
                    ),
                  ),
                )
              : null,
            review.open
              ? h(
                  'div',
                  { className: 'tc-review' },
                  h(
                    'div',
                    { className: 'tc-review-top' },
                    h('span', null, t('本周回看 · 最近 7 天（本地统计，不调模型）', 'This week · last 7 days (local stats, no model call)')),
                    h('span', { className: 'tc-grow' }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-btn tc-btn-mini',
                        disabled: review.busy,
                        onClick: loadReview,
                      },
                      review.busy ? t('统计中…', 'Counting…') : t('刷新', 'Refresh'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'tc-icon-btn',
                        title: t('收起', 'Close'),
                        'aria-label': t('收起本周回看', 'Close the weekly review'),
                        onClick: function () {
                          setReview({ open: false, busy: false, data: review.data });
                        },
                      },
                      '×',
                    ),
                  ),
                  review.data
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'tc-review-grid' },
                          [
                            { label: t('新增', 'Added'), value: review.data.added },
                            { label: t('完成', 'Done'), value: review.data.done },
                            { label: t('归档', 'Archived'), value: review.data.archived },
                            { label: t('还挂着', 'Open'), value: (review.data.counts && review.data.counts.todo) || 0 },
                            { label: t('未整理', 'Inbox'), value: (review.data.counts && review.data.counts.inbox) || 0 },
                          ].map(function (stat) {
                            return h(
                              'div',
                              { key: 'rv-' + stat.label, className: 'tc-review-stat' },
                              h('span', { className: 'tc-review-num' }, String(stat.value || 0)),
                              h('span', { className: 'tc-review-label' }, stat.label),
                            );
                          }),
                        ),
                        review.data.byCategory && review.data.byCategory.length
                          ? h(
                              'div',
                              { className: 'tc-set-hint' },
                              t('新记的都进了：', 'Captured into: ') +
                                review.data.byCategory
                                  .map(function (entry) {
                                    return categoryName(entry.id) + ' ' + entry.count;
                                  })
                                  .join(' · '),
                            )
                          : null,
                        review.data.stale && review.data.stale.length
                          ? h(
                              'ul',
                              { className: 'tc-review-stale' },
                              review.data.stale.map(function (entry) {
                                return h(
                                  'li',
                                  { key: 'stale-' + entry.id },
                                  h('span', null, entry.text),
                                  h('span', { className: 'tc-review-age' }, t('停了 ' + entry.ageDays + ' 天', 'stalled ' + entry.ageDays + 'd')),
                                );
                              }),
                            )
                          : h('div', { className: 'tc-set-hint' }, t('没有停着太久的待办。', 'Nothing stalled.')),
                      )
                    : h('div', { className: 'tc-set-hint' }, review.busy ? t('统计中…', 'Counting…') : t('还没读到数据。', 'No data yet.')),
                )
              : null,
            pickedItems.length
              ? h(
                  'div',
                  { className: 'tc-batch' },
                  h('span', { className: 'tc-batch-count' }, t('已选 ' + pickedItems.length + ' 条', pickedItems.length + ' selected')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-btn tc-btn-primary tc-btn-mini',
                      onClick: function () {
                        toggleSend({ kind: 'list', items: pickedItems });
                      },
                    },
                    t('批量转给 AI', 'Send all to AI'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'tc-btn tc-btn-mini',
                      onClick: function () {
                        setPicked({});
                      },
                    },
                    t('清空选择', 'Clear'),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'tc-list' },
              visible.length ? visible.map(renderItem) : h('div', { className: 'tc-empty' }, emptyText),
            ),
            scan.rows.length || scan.sessions.length
              ? h(
                  'div',
                  { className: 'tc-scan' },
                  scan.rows.length
                    ? h(
                        'table',
                        { className: 'tc-table' },
                        h(
                          'thead',
                          null,
                          h(
                            'tr',
                            null,
                            h('th', null, t('可能漏掉的', 'Possibly missed')),
                            h('th', null, t('出自会话', 'From session')),
                            h('th', null, t('判断依据', 'Why')),
                            h('th', null, t('处理', 'Action')),
                          ),
                        ),
                        h(
                          'tbody',
                          null,
                          scan.rows.map(function (row, index) {
                            if (ignored[index]) return null;
                            var match = null;
                            for (var i = 0; i < scan.sessions.length; i += 1) {
                              var title = String(scan.sessions[i].title || '');
                              var said = String(row.session || '');
                              if (said && title && (said === title || title.indexOf(said) !== -1 || said.indexOf(title) !== -1)) {
                                match = scan.sessions[i];
                                break;
                              }
                            }
                            return h(
                              'tr',
                              { key: 'row-' + index },
                              h('td', null, row.todo),
                              h(
                                'td',
                                null,
                                match
                                  ? h(
                                      'button',
                                      {
                                        type: 'button',
                                        className: 'tc-scan-item',
                                        title: match.id,
                                        onClick: function () {
                                          openSession(match.id);
                                        },
                                      },
                                      row.session || match.title,
                                    )
                                  : row.session || '—',
                              ),
                              h('td', { className: 'tc-why' }, row.why || ''),
                              h(
                                'td',
                                { className: 'tc-row-act' },
                                savedRows[index]
                                  ? h('span', { className: 'tc-src' }, t('已存', 'Saved'))
                                  : h(
                                      'button',
                                      {
                                        type: 'button',
                                        className: 'tc-btn tc-btn-mini',
                                        title: t('存成胶囊', 'Save as a capsule'),
                                        onClick: function () {
                                          saveScanRow(row, index);
                                        },
                                      },
                                      t('存胶囊', 'Save'),
                                    ),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'tc-btn tc-btn-mini',
                                    title: t('忽视这条', 'Ignore this one'),
                                    onClick: function () {
                                      setIgnored(function (prev) {
                                        var next = Object.assign({}, prev);
                                        next[index] = true;
                                        return next;
                                      });
                                    },
                                  },
                                  t('忽视', 'Ignore'),
                                ),
                              ),
                            );
                          }),
                        ),
                      )
                    : null,
                  scan.sessions.length
                    ? h(
                        'div',
                        { className: 'tc-scan-list' },
                        h('span', { className: 'tc-scan-title' }, t('扫过的会话：', 'Sessions scanned:')),
                        scan.sessions.map(function (session) {
                          return h(
                            'button',
                            {
                              key: session.id,
                              type: 'button',
                              className: 'tc-scan-item',
                              title: session.id,
                              onClick: function () {
                                openSession(session.id);
                              },
                            },
                            session.title || session.id.slice(0, 8),
                          );
                        }),
                      )
                    : null,
                  scan.raw
                    ? h(
                        'details',
                        { className: 'tc-raw' },
                        h('summary', null, t('模型原始输出', 'Raw model output')),
                        h('pre', null, scan.raw),
                      )
                    : null,
                )
              : null,
            note ? h('div', { className: 'tc-note' }, note) : null,
            h(
              'div',
              { className: 'tc-foot' },
              error ? h('span', { className: 'tc-err' }, error) : h('span', null, stamp ? t('已同步 ', 'Synced ') + stamp : ''),
              h('span', null, CLIENT_BUILD.slice(-2)),
            ),
          ),
        );
      }

      function resolveSlots(ctx) {
        var candidates = [];
        try {
          if (ctx && typeof ctx.get === 'function') candidates.push({ label: "ctx.get('slots')", value: ctx.get('slots') });
        } catch (err) {
          /* noop */
        }
        try {
          candidates.push({ label: 'ctx.slots', value: ctx.slots });
        } catch (err) {
          /* noop */
        }
        var seen = [];
        for (var i = 0; i < candidates.length; i += 1) {
          var service = candidates[i].value;
          var shape = service === null ? 'null' : typeof service;
          var hasInject = !!(service && typeof service.inject === 'function');
          var hasRegister = !!(service && typeof service.register === 'function');
          seen.push(candidates[i].label + '=' + shape + (hasInject ? '+inject' : '') + (hasRegister ? '+register' : ''));
          if (service && hasInject && hasRegister) return { slots: service, via: candidates[i].label, seen: seen };
        }
        return { slots: undefined, via: 'none', seen: seen };
      }

      function exposeDebug(getter) {
        try {
          window.__dshThoughtCapsuleDebug = function () {
            return getter();
          };
          window.__dshThoughtCapsuleStatus = getter();
        } catch (ignore) {
          /* noop */
        }
      }

      /**
       * 设置卡（P1.5）：坐在 设置→插件→dsh-thought-capsule 这个 bundle 的页面上。
       * 刻意不另开后端：读写的是面板同一份 /api/settings，两边改完互相广播。
       */
      function SettingsCard() {
        ensureStyle();
        var state = react.useState(null);
        var settings = state[0];
        var setSettings = state[1];
        var errState = react.useState('');
        var error = errState[0];
        var setError = errState[1];

        react.useEffect(function () {
          var alive = true;
          api('/api/settings').then(
            function (res) {
              if (alive) setSettings((res.settings && res.settings.float) || {});
            },
            function (err) {
              if (alive) setError(msgOf(err));
            },
          );
          function onSettings(event) {
            var next = event && event.detail && event.detail.float;
            if (alive && next) setSettings(next);
          }
          window.addEventListener(SETTINGS_EVENT, onSettings);
          return function () {
            alive = false;
            window.removeEventListener(SETTINGS_EVENT, onSettings);
          };
        }, []);

        function put(next) {
          var merged = Object.assign({}, settings, next);
          setSettings(merged);
          announce(SETTINGS_EVENT, { float: merged });
          api('/api/settings', { method: 'PUT', body: JSON.stringify(next) }).then(
            function (res) {
              if (res.settings && res.settings.float) setSettings(res.settings.float);
            },
            function (err) {
              setError(msgOf(err));
            },
          );
        }

        if (!settings) {
          return h('div', { className: 'tc-set' }, h('div', { className: 'tc-set-hint' }, error || t('正在读设置…', 'Loading settings…')));
        }

        var size = typeof settings.size === 'number' ? settings.size : 54;
        var alpha = typeof settings.opacity === 'number' ? settings.opacity : 0.96;
        var noteFont = typeof settings.noteFont === 'number' ? settings.noteFont : 13;
        var sides = [
          ['auto', '自动', 'Auto'],
          ['left', '向左', 'Left'],
          ['right', '向右', 'Right'],
          ['above', '向上', 'Above'],
          ['below', '向下', 'Below'],
        ];

        function row(text, control, hint) {
          return h(
            'div',
            { className: 'tc-set-row' },
            h('label', { className: 'tc-set-hint' }, text),
            control,
            hint ? h('span', { className: 'tc-set-hint' }, hint) : null,
          );
        }

        function toggle(key) {
          return h('input', {
            type: 'checkbox',
            checked: settings[key] !== false,
            onChange: function (event) {
              var next = {};
              next[key] = !!event.target.checked;
              put(next);
            },
          });
        }

        return h(
          'div',
          { className: 'tc-set' },
          row(t('悬浮胶囊', 'Floating capsule'), toggle('enabled'), t('Alt+C 也能开关', 'Alt+C toggles it')),
          row(t('划词捕获', 'Selection capture'), toggle('capture'), t('选中正文时在选区旁出气泡', 'Bubble next to selected text')),
          row(
            t('大小', 'Size'),
            h('input', {
              type: 'range',
              min: 32,
              max: 160,
              step: 2,
              value: size,
              onChange: function (event) {
                put({ size: Number(event.target.value) });
              },
            }),
            size + 'px',
          ),
          row(
            t('便签字号', 'Note text size'),
            h('input', {
              type: 'range',
              min: 11,
              max: 20,
              step: 1,
              value: noteFont,
              onChange: function (event) {
                put({ noteFont: Number(event.target.value) });
              },
            }),
            noteFont + 'px',
          ),
          row(
            t('不透明度', 'Opacity'),
            h('input', {
              type: 'range',
              min: 0.2,
              max: 1,
              step: 0.02,
              value: alpha,
              onChange: function (event) {
                put({ opacity: Number(event.target.value) });
              },
            }),
            Math.round(alpha * 100) + '%',
          ),
          row(
            t('展开方向', 'Panel side'),
            h(
              'select',
              {
                className: 'tc-select',
                value: settings.side || 'auto',
                onChange: function (event) {
                  put({ side: event.target.value });
                },
              },
              sides.map(function (item) {
                return h('option', { key: item[0], value: item[0] }, t(item[1], item[2]));
              }),
            ),
          ),
          h(
            'div',
            { className: 'tc-set-row' },
            h('a', { className: 'tc-btn', href: BASE + '/api/export', download: 'capsules.json' }, t('导出 JSON', 'Export JSON')),
            h('span', { className: 'tc-set-hint' }, t('胶囊面板在左侧栏', 'The capsule panel lives in the sidebar')),
          ),
          error ? h('div', { className: 'tc-err' }, error) : null,
        );
      }

      function apply(ctx) {
        pluginCtx = ctx || null;
        var resolved = resolveSlots(ctx);
        var slots = resolved.slots;
        var shape = [];
        var registered = [];
        var failures = [];
        var ctxKeys = ctx ? Object.keys(ctx).slice(0, 20) : [];

        if (!slots) {
          var noSlots = {
            build: CLIENT_BUILD,
            slotsResolved: false,
            via: resolved.via,
            shapes: resolved.seen || [],
            panelId: PANEL_ID,
            ctxKeys: ctxKeys,
          };
          exposeDebug(function () {
            return noSlots;
          });
          warn('拿不到 slots 服务，胶囊图标与面板都未注册', noSlots);
          postReport(noSlots);
          return;
        }

        var disposers = [];

        function registerSlot(slotName, options, component) {
          try {
            var outer = slots.inject(slotName, function () {
              try {
                var handle = slots.register(options, component);
                registered.push(slotName);
                shape.push(slotName + ' register->' + (handle === undefined ? 'undefined' : typeof handle));
                return handle;
              } catch (err) {
                failures.push({ slot: slotName, stage: 'register', message: msgOf(err) });
                throw err;
              }
            });
            shape.push(slotName + ' inject->' + (outer === undefined ? 'undefined' : typeof outer));
            if (typeof outer === 'function') disposers.push(outer);
          } catch (err) {
            failures.push({ slot: slotName, stage: 'inject', message: msgOf(err) });
            warn('席位注册失败：' + slotName, err);
          }
        }

        registerSlot('shell.overlay', { name: 'shell.overlay', id: PANEL_ID + '-float', order: 900 }, FloatCapsule);
        registerSlot('shell.overlay', { name: 'shell.overlay', id: PANEL_ID + '-capture', order: 901 }, SelectionBubble);
        registerSlot('sidebar.panellist', { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: label }, CapsuleIcon);
        registerSlot(
          'main',
          {
            name: 'main',
            key: PANEL_ID,
            inject: function () {
              return { panelId: PANEL_ID };
            },
          },
          Panel,
        );
        // 设置卡：官方 keyed 席位，key 是本 bundle 的包名，落在 设置→插件 里本插件的页面上。
        // 席位不存在时 register 会抛，registerSlot 已经兜住并记进 failures，不影响其余席位。
        registerSlot('plugins.bundle.config', { name: 'plugins.bundle.config', key: 'dsh-thought-capsule' }, SettingsCard);

        function report() {
          return {
            build: CLIENT_BUILD,
            panelId: PANEL_ID,
            slotsResolved: true,
            via: resolved.via,
            shapes: shape.slice(),
            registered: registered.slice(),
            failures: failures.slice(),
            ctxKeys: ctxKeys,
          };
        }

        exposeDebug(report);
        postReport(report());
        try {
          setTimeout(function () {
            postReport(report());
          }, 1500);
        } catch (ignore) {
          /* noop */
        }

        var disposeAll = function () {
          for (var i = 0; i < disposers.length; i += 1) {
            try {
              if (typeof disposers[i] === 'function') disposers[i]();
            } catch (err) {
              /* noop */
            }
          }
          disposers.length = 0;
        };

        try {
          if (typeof ctx.effect === 'function') {
            ctx.effect(function () {
              return disposeAll;
            }, 'dsh-thought-capsule: panel');
            return;
          }
        } catch (err) {
          /* 回退到手写清理 */
        }
        return disposeAll;
      }

      // 只导出 apply：依赖关系由 package.json 的 dsh.client.inject 声明。
      exports.apply = apply;

      /**
       * 模块级自检：即使 apply 从没被调用，也能从宿主看到浏览器里发生了什么。
       * 排障三步：没有这条记录 = client.js 压根没被求值（接线/打包问题）；
       * 有 applied=false = apply 抛了；有 applied=true + slotsResolved=false = 席位名不对。
       */
      var bootReport = { build: CLIENT_BUILD, phase: 'factory', applied: false };
      postReport(bootReport);
      var userApply = apply;
      exports.apply = function (ctx) {
        bootReport.applied = true;
        bootReport.phase = 'applied';
        try {
          return userApply(ctx);
        } catch (err) {
          bootReport.phase = 'apply-threw';
          bootReport.error = String((err && err.message) || err);
          postReport(bootReport);
          throw err;
        }
      };

      return module.exports;
    },
  });
})();
