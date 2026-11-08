window.__ModuleLoader__.load({ id: "dsh-plugin-office-markdown", factory: function (require) {
var module = { exports: {} };
var exports = module.exports;

/*!
 * dsh-plugin-office-markdown — client half (browser)
 *
 * A hand-written DSH client module in the `window.__ModuleLoader__.load({ id,
 * factory })` handshake, so no build step and no bundler are needed: the file
 * in the package is exactly what the shell evaluates. `react` stays external —
 * the web shell seeds it in the module table and the loader-provided `require`
 * resolves it inside the factory.
 *
 * Contract: `{ inject: ['slots'], apply(ctx) }`. It registers one settings page
 * into the `settings.section` slot and renders it with React.createElement.
 *
 * The page itself only talks to the host half through the package-private JSON
 * API `/office-markdown/api/*`, which is served by `lib/settings-api.js`. It
 * never installs anything by itself: the user picks an interpreter, clicks
 * 一键配置, and the host runs pip in the background while this page polls the
 * job endpoint for progress.
 *
 * Layout, top to bottom: a one-line verdict banner (green/amber/red) so the
 * user does not have to stitch three cards together to answer "does this
 * actually work here?", then the converter, the interpreters, the managed
 * environment, a试转 card that can pick a file from the last known workspace,
 * and the pip job log with a copy button.
 */

/* ------------------------------------------------------------------ *
 * 本文件结构导览（按出现顺序）
 *
 *   1. 模块包装       window.__ModuleLoader__.load({ id, factory })
 *                     —— DSH 客户端模块的固定握手格式，没有构建步骤
 *   2. 常量           API 前缀、inject 声明、COLOR 调色、S 样式表
 *   3. 网络           getJSON / postJSON —— 只跟宿主半边说话
 *   4. 纯函数         verdictOf（结论横幅）、copyTextOf、renderTest（试转结果）
 *   5. Panel 组件     页面本体：状态 → 数据加载 → 动作 → 渲染
 *   6. apply          往 settings.section 注册这一个页面
 *
 * 注意本文件是**浏览器直接执行**的：
 *   - 不能用 import/export，只能靠 window.__ModuleLoader__ 这个握手；
 *   - 不用 JSX，全部 h(...)，也没有编译步骤；
 *   - 写法保持 ES5（var / function），因为包里的这份文件就是最终产物。
 * ------------------------------------------------------------------ */
var React = require("react");
if (React && React.default) React = React.default;
var h = React.createElement;
var useState = React.useState;
var useEffect = React.useEffect;
var useCallback = React.useCallback;

/* ---------------- 常量与样式 ---------------- */

/* 宿主半边把 7 条路由挂在这个前缀下（见 lib/settings-api.js）。 */
var API = "/office-markdown/api";
var inject = ["slots"];

/* 颜色只在这里定义一次：横幅的绿/黄/红、徽章、分隔线都从这里取。
 * dim / line / fill 用 rgba(127,127,127,…) 是为了同时兼容深色与浅色主题。 */
var COLOR = {
  ok: "#22a06b",
  bad: "#e5484d",
  warn: "#d97706",
  dim: "rgba(127,127,127,0.95)",
  line: "rgba(127,127,127,0.30)",
  fill: "rgba(127,127,127,0.10)"
};

/** 把字节数变成人读的字符串（B / KB / MB / GB）。 */
function fmtBytes(n) {
  var v = Number(n) || 0;
  if (v < 1024) return v + " B";
  if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
  if (v < 1073741824) return (v / 1048576).toFixed(1) + " MB";
  return (v / 1073741824).toFixed(2) + " GB";
}

/* ---------------- 网络层 ---------------- */

/* 页面所有数据都来自宿主半边的 JSON 接口。这里不做错误重试：
 * 失败就交给调用方的 .catch，由页面决定显示什么（大多数情况是「静默降级」）。 */
function getJSON(path) {
  return fetch(API + path, { headers: { accept: "application/json" } }).then(function (r) {
    return r.json();
  });
}

function postJSON(path, body) {
  return fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body || {})
  }).then(function (r) {
    return r.json();
  });
}

function messageOf(x) {
  return String((x && x.message) || x || "未知错误");
}

var S = {
  box: { fontSize: 13, lineHeight: 1.65, color: "inherit", display: "flex", flexDirection: "column", gap: 14 },
  head: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  title: { fontSize: 15, fontWeight: 600, margin: 0 },
  dim: { color: COLOR.dim, fontSize: 12 },
  card: {
    border: "1px solid " + COLOR.line,
    borderRadius: 8,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8
  },
  cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 },
  badge: {
    border: "1px solid currentColor",
    borderRadius: 999,
    padding: "0px 8px",
    fontSize: 11,
    whiteSpace: "nowrap",
    lineHeight: "18px"
  },
  btn: {
    padding: "5px 12px",
    borderRadius: 6,
    border: "1px solid " + COLOR.line,
    background: COLOR.fill,
    color: "inherit",
    cursor: "pointer",
    fontSize: 12,
    font: "inherit"
  },
  btnOff: {
    padding: "5px 12px",
    borderRadius: 6,
    border: "1px solid " + COLOR.line,
    background: "transparent",
    color: COLOR.dim,
    cursor: "not-allowed",
    fontSize: 12,
    font: "inherit"
  },
  // 小字链接样式：用来承载「强制重探」这类低频动作，别和主按钮抢位置
  link: { color: COLOR.dim, fontSize: 12, cursor: "pointer", textDecoration: "underline" },
  log: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    maxHeight: 190,
    overflow: "auto",
    background: COLOR.fill,
    borderRadius: 6,
    padding: 8,
    margin: 0
  },
  list: { display: "flex", flexDirection: "column", gap: 6, margin: 0, padding: 0, listStyle: "none" },
  li: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }
};

/**
 * The one-line verdict at the top of the page.
 *
 * Everything below this banner is detail; users kept having to read the
 * converter badge, the interpreter list and the managed-environment card
 * together to answer "can I use this right now?". This collapses that into a
 * tone + a title + one sentence.
 *
 * Returns { tone: 'ok' | 'warn' | 'bad' | 'loading', title, detail, showInstall }.
 * `showInstall` is only true when there is an interpreter we could actually
 * install into (usable + has pip), so the banner never offers a button that is
 * guaranteed to fail.
 */
/* ---------------- 纯函数（渲染前先算好） ---------------- */

/**
 * 页面最上面那条结论横幅：把「转换器 / 解释器 / 环境记录」三张卡拼成一句话。
 *
 * 返回 { tone, title, detail, showInstall }：
 *   ok    = 已经就绪（带当前转换器与解释器）
 *   warn  = 在用内置兜底（showInstall 为真时才给「一键配置」按钮）
 *   bad   = 宿主半边没响应
 *   loading = 还在读状态
 * showInstall 只在「有解释器真能装」时为真，避免给一个注定失败的按钮。
 */
function verdictOf(status, probe, error) {
  if (!status) {
    if (error) {
      return {
        tone: "bad",
        title: "宿主半边没有响应",
        detail: "请重启 DSH 后重新打开这个页面。",
        showInstall: false
      };
    }
    return {
      tone: "loading",
      title: "正在读取状态…",
      detail: "首次打开要探测本机解释器，通常几秒钟。",
      showInstall: false
    };
  }
  var converter = status.converter || null;
  var active = (probe && probe.python && probe.python.active) || "";
  if (!converter || converter.usingFallback === true) {
    var list = (probe && probe.python && probe.python.candidates) || [];
    var installable = false;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].usable && list[i].hasPip) {
        installable = true;
        break;
      }
    }
    return {
      tone: "warn",
      title: "正在用内置兜底（保真度有限）",
      detail: installable
        ? "还没检测到装好 MarkItDown 的 Python。点「一键配置」可以装到选定的解释器里。"
        : "还没检测到装好 MarkItDown 的 Python，也没有找到能安装的解释器。",
      showInstall: installable
    };
  }
  return {
    tone: "ok",
    title: "已经就绪",
    detail: "当前转换器 " + (converter.label || "MarkItDown") + " · 保真度「高」" + (active ? " · " + active : ""),
    showInstall: false
  };
}

/** 试转失败时的纯文本版本，供「复制错误」用。 */
/** 试转失败时「复制错误」按钮要复制的纯文本。 */
function copyTextOf(r) {
  var parts = ["试转失败：" + (r.error || "未知错误")];
  if (r.sourcePath) parts.push("源文件：" + r.sourcePath);
  if (r.converterAttempts && r.converterAttempts.length) {
    parts.push("尝试过的转换器：" + r.converterAttempts.join(" · "));
  }
  if (r.notices && r.notices.length) parts.push(r.notices.join(" · "));
  return parts.join("\n");
}

/**
 * 渲染一次试转的结果（成功 / 失败 / 跳过三种形态）。
 * 失败时挂三个下一步按钮：一键配置、重新检查、复制错误。
 */
function renderTest(r, opts) {
  if (!r) return null;
  opts = opts || {};
  if (r.ok !== true) {
    return h(
      "div",
      null,
      h("div", { style: { color: COLOR.bad } }, "试转失败：" + (r.error || "未知错误")),
      r.sourcePath ? h("div", { style: S.dim }, "源文件：" + r.sourcePath) : null,
      r.converterAttempts && r.converterAttempts.length
        ? h("div", { style: S.dim }, "尝试过的转换器：" + r.converterAttempts.join(" · "))
        : null,
      r.notices && r.notices.length ? h("div", { style: S.dim }, r.notices.join(" · ")) : null,
      h(
        "div",
        { style: Object.assign({}, S.row, { marginTop: 6 }) },
        h("button", { style: S.btn, onClick: opts.onInstall }, "一键配置 MarkItDown"),
        h("button", { style: S.btn, onClick: opts.onReprobe }, "重新检查环境"),
        h(
          "button",
          {
            style: S.btn,
            onClick: function () {
              if (typeof opts.onCopy === "function") opts.onCopy(copyTextOf(r));
            }
          },
          opts.copied ? "已复制" : "复制错误"
        )
      )
    );
  }
  if (r.skipped) return h("div", { style: S.dim }, r.message || "无需转换。");
  return h(
    "div",
    null,
    h(
      "div",
      { style: S.row },
      h(
        "span",
        { style: Object.assign({}, S.badge, { color: r.fidelity === "limited" ? COLOR.warn : COLOR.ok }) },
        r.fidelity === "limited" ? "保真度有限（内置兜底）" : "保真度高（MarkItDown）"
      ),
      h("span", null, r.converterLabel || r.converter || "未知转换器"),
      h("span", { style: S.dim },
        fmtBytes(r.markdownBytes) + " · 约 " + (r.lineCount || 0) + " 行 · " +
        "约 " + (r.estimatedTokens || 0) + " tokens · " + ((r.elapsedMs || 0) / 1000).toFixed(1) + "s")
    ),
    h("div", { style: S.mono }, r.markdownPath || ""),
    r.preview ? h("pre", { style: S.log }, r.preview + (r.previewTruncated ? "\n…（预览已截断）" : "")) : null
  );
}

/* ---------------- 设置页主体 ---------------- */

/**
 * 设置页的全部内容。组件内部按顺序分四段：
 *   ① 状态（15 个 useState，顺序是固定的 —— 假 React 烟测按下标注入）
 *   ② 数据加载（refresh / refreshFiles / probeNow / testConvert / copy 五个回调，三个 effect）
 *   ③ 动作（start / askInstall / goInstall / renderConfirm）
 *   ④ 渲染（标题 → 结论横幅 → 转换器 → Python → 托管环境 → 试转 → 任务日志）
 *
 * 页面上没有任何写死的「成功」：每个结论都来自 /api/status 或 /api/probe 的返回值。
 */
function Panel() {
  /* ---- ① 状态 ---- */
  /* 顺序固定，别插队：state 的声明顺序就是 React 的 hook 顺序， */
  /* 也是测试里按下标注入假值的依据。                            */
  var stStatus = useState(null);
  var status = stStatus[0];
  var setStatus = stStatus[1];

  var stError = useState("");
  var error = stError[0];
  var setError = stError[1];

  var stJob = useState(null);
  var job = stJob[0];
  var setJob = stJob[1];

  var stProbe = useState(null);
  var probe = stProbe[0];
  var setProbe = stProbe[1];

  var stBusy = useState(false);
  var busy = stBusy[0];
  var setBusy = stBusy[1];

  var stToast = useState("");
  var toast = stToast[0];
  var setToast = stToast[1];

  var stTarget = useState("");
  var target = stTarget[0];
  var setTarget = stTarget[1];

  var stTestPath = useState("");
  var testPath = stTestPath[0];
  var setTestPath = stTestPath[1];

  var stTestResult = useState(null);
  var testResult = stTestResult[0];
  var setTestResult = stTestResult[1];

  var stTestBusy = useState(false);
  var testBusy = stTestBusy[0];
  var setTestBusy = stTestBusy[1];

  // 最近工作区里的 Office 文件（接口拿不到时保持空数组，手填路径仍然可用）
  var stFiles = useState([]);
  var files = stFiles[0];
  var setFiles = stFiles[1];

  var stFilesRoot = useState("");
  var filesRoot = stFilesRoot[0];
  var setFilesRoot = stFilesRoot[1];

  // 宿主扫描工作区时超过上限（200 个文件 / 5000 个目录项）会置 true
  var stFilesTruncated = useState(false);
  var filesTruncated = stFilesTruncated[0];
  var setFilesTruncated = stFilesTruncated[1];

  // '' | 'banner' | 'card'：一键配置要先确认，两处入口共用一个状态，
  // 这样确认条只会在被点的那一处出现，不会上下各冒一条。
  var stConfirm = useState("");
  var confirmAt = stConfirm[0];
  var setConfirmAt = stConfirm[1];

  // 复制成功的短暂回显，值是目标（'test' / 'log'），1.5 秒后清空
  var stCopied = useState("");
  var copied = stCopied[0];
  var setCopied = stCopied[1];

  /* ---- ② 数据加载 ---- */

  /* /status 很轻：当前转换器、托管环境快照、正在跑的任务。挂载时与任务结束后各调一次。 */
  var refresh = useCallback(function () {
    getJSON("/status")
      .then(function (d) {
        if (!d || d.ok !== true) {
          setError((d && d.error) || "无法读取插件状态");
          return;
        }
        setStatus(d);
        setError("");
        if (d.job) setJob(d.job);
      })
      .catch(function (x) {
        setError("无法连接插件后台（" + messageOf(x) + "）：请确认 dsh-plugin-office-markdown 的宿主半边已激活。");
      });
  }, []);

  // 工作区文件列表的拉取：挂载、点「刷新」、试转成功之后共用同一份逻辑。
  // 宿主只记得「上一次工具调用时看到的工作区」，拿不到就静默降级 —— 这一块
  // 失败绝不该打断页面。
  var refreshFiles = useCallback(function () {
    getJSON("/workspace-files")
      .then(function (d) {
        if (!d || d.ok !== true) return;
        var list = Array.isArray(d.files) ? d.files : [];
        setFiles(list);
        setFilesRoot(typeof d.root === "string" ? d.root : "");
        setFilesTruncated(d.truncated === true);
        if (list.length) {
          setTestPath(function (prev) {
            return prev ? prev : list[0].abs;
          });
        }
      })
      .catch(function () { /* 静默降级，手填仍可用 */ });
  }, []);

  // `force` re-runs the whole probe on the host; without it the host answers
  // from its cache (probeTtlMs, 10 minutes by default), because walking every
  // interpreter costs several process spawns each.
  /* /probe 很重：每个候选要起若干个子进程。force=true 才真的重扫，否则命中宿主缓存（默认 10 分钟）。 */
  var probeNow = useCallback(function (force) {
    setBusy(true);
    getJSON(force === true ? "/probe?force=1" : "/probe")
      .then(function (d) {
        if (!d || d.ok !== true) {
          setError((d && d.error) || "检查本机环境失败");
          return;
        }
        setProbe(d);
        setError("");
        var list = (d.python && d.python.candidates) || [];
        // 两级优先：先挑「已经装好 MarkItDown」的（那才是正在用的那个），
        // 没有再挑「能用且有 pip」的。否则多解释器机器上会默认选中
        // 一个没在用的运行时，一键配置就把包装错了地方。
        var best = null;
        var i;
        for (i = 0; i < list.length; i += 1) {
          if (list[i].usable && list[i].hasMarkitdown) { best = list[i]; break; }
        }
        if (!best) {
          for (i = 0; i < list.length; i += 1) {
            if (list[i].usable && list[i].hasPip) { best = list[i]; break; }
          }
        }
        if (best) setTarget(best.command);
      })
      .catch(function (x) {
        setError("检查本机环境失败：" + messageOf(x));
      })
      .then(function () {
        setBusy(false);
      });
  }, []);

  /* 试转：不接受空路径（否则会去跑一次注定失败的转换）。成功后顺手刷新文件列表。 */
  var testConvert = useCallback(function () {
    var p = String(testPath || "").trim();
    if (!p) {
      setTestResult({ ok: false, error: "请先填写要试转的文件的绝对路径。" });
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    postJSON("/convert-test", { path: p })
      .then(function (d) {
        setTestResult(d || { ok: false, error: "后台没有返回结果" });
        // 试转走的是同一条转换链：成功说明这个工作区能转，顺手把新文件拉进来
        if (d && d.ok === true) refreshFiles();
      })
      .catch(function (x) {
        setTestResult({ ok: false, error: messageOf(x) });
      })
      .then(function () {
        setTestBusy(false);
      });
  }, [testPath, refreshFiles]);

  // 剪贴板在非安全上下文里可能不可用，失败就把话说清楚，别静默吞掉
  /* 复制到剪贴板。非安全上下文（http 的某些情况）里 navigator.clipboard 可能没有，
     此时明确提示「请手动选中复制」，不静默失败。 */
  var copy = useCallback(function (where, text) {
    function fallback() {
      setToast("剪贴板不可用，请手动选中文本复制。");
    }
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        fallback();
        return;
      }
      navigator.clipboard.writeText(String(text || "")).then(function () {
        setCopied(where);
        setTimeout(function () {
          setCopied("");
        }, 1500);
      }).catch(fallback);
    } catch (x) {
      fallback();
    }
  }, []);

  /* ---- 三个 effect ---- */

  /* 挂载：读一次状态 + 探测一次解释器（走缓存，不强制重扫）。 */
  useEffect(function () {
    refresh();
    probeNow();
  }, [refresh, probeNow]);

  // 工作区文件列表是可选增强：拿不到就静默降级，这一块失败绝不该打断页面。
  useEffect(function () {
    refreshFiles();
  }, [refreshFiles]);

  // While a pip install/uninstall runs on the host, poll for its log.
  var runningJobId = job && job.state === "running" ? job.id : "";
  useEffect(function () {
    if (!runningJobId) return undefined;
    var stopped = false;
    var timer = null;
    function tick() {
      getJSON("/job")
        .then(function (d) {
          if (stopped) return;
          var j = d && d.job;
          if (j) setJob(j);
          if (j && j.state === "running") timer = setTimeout(tick, 1200);
          else {
            refresh();
            probeNow();
          }
        })
        .catch(function () {
          if (!stopped) timer = setTimeout(tick, 2500);
        });
    }
    timer = setTimeout(tick, 800);
    return function () {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runningJobId, refresh, probeNow]);

  /* ---- ③ 动作 ---- */

  /* 真正发起 pip 安装 / 卸载。进度不在这里等，交给下面的任务轮询 effect。 */
  function start(kind) {
    setToast("");
    var call = kind === "install" ? postJSON("/env/install", { target: target }) : postJSON("/env/uninstall", {});
    call
      .then(function (d) {
        if (!d || d.ok !== true) {
          setToast((d && d.error) || "启动失败");
          return;
        }
        setJob(d.job);
        setToast(kind === "install" ? "已开始安装 MarkItDown，进度见下方日志。" : "已开始卸载插件配置的环境，进度见下方日志。");
      })
      .catch(function (x) {
        setToast("启动失败：" + messageOf(x));
      });
  }

  // 一键配置要点两下：先看清单（装到哪个解释器、要不要联网），再动手。
  function askInstall(where) {
    setToast("");
    setConfirmAt(where);
  }

  function goInstall() {
    setConfirmAt("");
    start("install");
  }

  /* 确认条：一键配置点两下才真的执行 pip。
     confirmAt 是 '' | 'banner' | 'card' 三态 —— 用布尔会让上下两处入口同时冒出确认条。 */
  function renderConfirm() {
    return h(
      "div",
      { style: Object.assign({}, S.card, { background: COLOR.fill, gap: 4, padding: "8px 10px" }) },
      h("div", null, (target ? "将在 " + target + " 里安装" : "将在默认解释器里安装") + " markitdown 及其依赖。"),
      h("div", { style: S.dim }, "需要联网；装完会自动登记，卸载插件时能精确移除。"),
      h(
        "div",
        { style: S.row },
        h("button", { style: S.btn, onClick: function () { setConfirmAt(""); } }, "取消"),
        h("button", { style: S.btn, onClick: goInstall }, "开始安装")
      )
    );
  }

  var converter = (status && status.converter) || null;
  var usingFallback = !converter || converter.usingFallback;
  var jobRunning = !!(job && job.state === "running");
  var candidates = (probe && probe.python && probe.python.candidates) || [];
  var snapshot = (probe && probe.snapshot) || (status && status.snapshot) || null;

  var verdict = verdictOf(status, probe, error);
  var verdictColor =
    verdict.tone === "ok" ? COLOR.ok :
    verdict.tone === "warn" ? COLOR.warn :
    verdict.tone === "bad" ? COLOR.bad : COLOR.dim;

  // 下拉框只在下拉里确实有这一项时才显示为选中，避免手填路径时选中态错乱
  var pickedAbs = "";
  for (var fi = 0; fi < files.length; fi += 1) {
    if (files[fi].abs === testPath) {
      pickedAbs = testPath;
      break;
    }
  }

  /* ---- ④ 渲染 ---- */

  return h(
    "div",
    { style: S.box },

    h(
      "div",
      { style: S.head },
      h("h3", { style: S.title }, "Office 转换（MarkItDown）"),
      h("span", { style: S.dim }, "v" + ((status && status.plugin && status.plugin.version) || "?")),
      h("span", { style: S.dim }, "工具 " + ((status && status.plugin && status.plugin.tool) || "read_office_as_markdown"))
    ),
    h(
      "div",
      { style: S.dim },
      "把 .docx / .xlsx / .pptx / .pdf 先转成 Markdown 再读取，避免二进制内容直接塞进上下文。转换全部在本机完成，不修改原文件，不消耗 API 额度。"
    ),

    // ---- 结论横幅 ---------------------------------------------------------
    h(
      "div",
      { style: Object.assign({}, S.card, { borderLeft: "3px solid " + verdictColor, gap: 6 }) },
      h(
        "div",
        { style: S.cardHead },
        h("span", { style: { color: verdictColor, fontSize: 14, fontWeight: 600 } }, verdict.title),
        verdict.showInstall && confirmAt !== "banner"
          ? h(
              "button",
              { style: jobRunning ? S.btnOff : S.btn, disabled: jobRunning, onClick: function () { askInstall("banner"); } },
              "一键配置"
            )
          : null
      ),
      verdict.detail ? h("div", { style: S.dim }, verdict.detail) : null,
      confirmAt === "banner" ? renderConfirm() : null
    ),

    // ---- current converter ------------------------------------------------
    h(
      "div",
      { style: S.card },
      h(
        "div",
        { style: S.cardHead },
        h(
          "div",
          { style: S.row },
          h(
            "span",
            { style: Object.assign({}, S.badge, { color: usingFallback ? COLOR.warn : COLOR.ok }) },
            usingFallback ? "内置兜底" : "本机 MarkItDown"
          ),
          h("span", null, converter ? converter.summary : "正在读取状态…")
        )
      ),
      converter && converter.chain && converter.chain.length
        ? h(
            "ul",
            { style: S.list },
            converter.chain.map(function (c, i) {
              return h(
                "li",
                { key: "c" + i, style: S.li },
                h("span", { style: Object.assign({}, S.badge, { color: c.fidelity === "limited" ? COLOR.warn : COLOR.ok }) }, c.fidelity === "limited" ? "保真度有限" : "保真度高"),
                h("span", null, c.label)
              );
            })
          )
        : null,
      converter && converter.notices && converter.notices.length
        ? h("div", { style: S.dim }, converter.notices.join(" · "))
        : null
    ),

    // ---- python environments ---------------------------------------------
    h(
      "div",
      { style: S.card },
      h(
        "div",
        { style: S.cardHead },
        h("div", { style: S.row }, h("b", null, "Python 环境"), h("span", { style: S.dim }, "探测顺序 pythonPrefer: " + ((probe && probe.python && probe.python.prefer) || (converter && converter.pythonPrefer) || "auto"))),
        h(
          "div",
          { style: S.row },
          h(
            "button",
            { style: busy ? S.btnOff : S.btn, disabled: busy, onClick: function () { probeNow(false); refreshFiles(); } },
            busy ? "刷新中…" : "刷新"
          ),
          h(
            "a",
            { style: S.link, role: "button", onClick: function () { if (!busy) probeNow(true); } },
            "强制重探"
          ),
          probe && probe.cached ? h("span", { style: S.dim }, "（当前是缓存结果）") : null
        )
      ),
      h(
        "div",
        { style: S.dim },
        "插件本身不安装任何东西。列表里第一个已装 MarkItDown 的解释器就是当前使用中的那个；若一个都没有，插件改用内置兜底转换器（保真度有限）。"
      ),
      candidates.length
        ? h(
            "ul",
            { style: S.list },
            candidates.map(function (c, i) {
              var okc = c.hasMarkitdown;
              var inUse = c.command === (probe.python && probe.python.active);
              return h(
                "li",
                { key: "p" + i, style: S.li },
                h(
                  "span",
                  { style: Object.assign({}, S.badge, { color: c.pending ? COLOR.warn : okc ? COLOR.ok : COLOR.dim }) },
                  c.pending ? "⏱ 未响应" : inUse ? "✔ 使用中" : okc ? "已安装" : c.usable ? "未安装" : "不可用"
                ),
                h("span", { style: S.mono }, c.command),
                h("span", { style: S.dim }, "[" + c.sourceLabel + "]"),
                c.pythonVersion ? h("span", { style: S.dim }, c.pythonVersion) : null,
                c.hasMarkitdown ? h("span", { style: S.dim }, "markitdown " + (c.markitdownVersion || "")) : null,
                !okc && c.error ? h("span", { style: S.dim }, "— " + c.error) : null
              );
            })
          )
        : h(
            "div",
            { style: S.dim },
            busy
              ? "正在探测解释器，通常 2–5 秒…"
              : probe
                ? "没有找到任何 Python 解释器；内置兜底仍然可用，装好 Python 后再点「刷新」。"
                : "点「刷新」开始探测本机解释器。"
          ),
      candidates.length
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 6 } },
            h(
              "div",
              { style: S.row },
              h(
                "label",
                { style: S.row },
                h("span", { style: S.dim }, "安装到"),
                h(
                  "select",
                  {
                    style: Object.assign({}, S.btn, { cursor: "pointer" }),
                    value: target,
                    onChange: function (e) {
                      setTarget(e.target.value);
                    }
                  },
                  candidates
                    .filter(function (c) {
                      return c.usable;
                    })
                    .map(function (c, i) {
                      return h(
                        "option",
                        { key: "o" + i, value: c.command },
                        c.command + "  [" + c.sourceLabel + "]" + (c.hasMarkitdown ? "  已安装" : c.hasPip ? "" : "  无 pip")
                      );
                    })
                )
              ),
              h(
                "button",
                { style: jobRunning ? S.btnOff : S.btn, disabled: jobRunning, onClick: function () { askInstall("card"); } },
                "一键配置 MarkItDown 环境"
              )
            ),
            confirmAt === "card" ? renderConfirm() : null
          )
        : null,
      h("div", { style: S.dim }, "一键配置会在这个解释器里安装 markitdown，并记录下需要负责的包，供日后精确卸载。如果它已经有了 MarkItDown，会跳过安装、直接完成登记。")
    ),

    // ---- managed environment ---------------------------------------------
    h(
      "div",
      { style: S.card },
      h("div", { style: S.cardHead }, h("b", null, "插件配置的环境")),
      snapshot && snapshot.present
        ? h(
            "div",
            null,
            h(
              "div",
              { style: S.row },
              h("span", { style: Object.assign({}, S.badge, { color: snapshot.stale ? COLOR.warn : COLOR.ok }) }, snapshot.stale ? "环境已失效" : snapshot.adopted ? "已接管（原本已安装）" : "由本插件安装"),
              h("span", { style: S.mono }, snapshot.python || "")
            ),
            h("div", { style: S.dim }, snapshot.stale
              ? "记录的 Python 解释器已不存在（安装时间 " + (snapshot.installedAt || "未知") + "），原本由它负责的 " + ((snapshot.added || []).length) + " 个包已随它一起消失。"
              : (snapshot.adopted ? "登记时间 " : "安装时间 ") + (snapshot.installedAt || "未知") + " · 可卸载 " + ((snapshot.added || []).length) + " 个包"),
            snapshot.keep && snapshot.keep.length && !snapshot.stale
              ? h("div", { style: S.dim }, "另有 " + snapshot.keep.length + " 个包被 DSH 运行时或其它组件共用，不会卸载。")
              : null,
            h("div", { style: S.dim }, "记录文件：" + (snapshot.path || "~/.dsh/dsh-plugin-office-markdown.env.json")),
            h(
              "div",
              { style: S.row },
              h(
                "button",
                { style: jobRunning ? S.btnOff : S.btn, disabled: jobRunning, onClick: function () { start("uninstall"); } },
                snapshot.stale ? "清理这条失效记录" : "卸载插件配置的环境"
              )
            ),
            h("div", { style: S.dim }, snapshot.stale
              ? "解释器被删除、或 DSH 升级换了运行时路径之后，这条记录已经无法执行 pip；点上面的按钮把它清掉即可，一个 Python 包都不会动。"
              : "只会卸载记录里属于 MarkItDown 的包；DSH 运行时自带的包（python-docx / openpyxl 等）和你原有的其它 Python 包一个都不会动。"),
            snapshot.stale ? null : h("div", { style: S.dim }, "在 DSH 里卸载本插件时，这一步会自动完成。")
          )
        : h(
            "div",
            null,
            h("div", { style: S.row }, h("span", { style: Object.assign({}, S.badge, { color: COLOR.dim }) }, "未登记"), h("span", null, "MarkItDown 不是由本插件配置的")),
            h("div", { style: S.dim }, "点上面的「一键配置」可以把当前解释器登记到插件名下；登记后，在 DSH 里卸载本插件时会一并移除 MarkItDown 与它的依赖。"),
            h("div", { style: S.dim }, "未经登记的 MarkItDown 不会被卸载，你自己装的 Python 包也始终原样保留。")
          )
    ),

    // ---- test conversion --------------------------------------------------
    h(
      "div",
      { style: S.card },
      h(
        "div",
        { style: S.cardHead },
        h("b", null, "试转一个文件"),
        h("span", { style: S.dim }, "不经过模型，直接在本机跑一遍完整的转换链")
      ),
      // 第一行：从最近的工作区里挑一个（设置页没有 session，路径是工具调用时记下的）
      h(
        "div",
        { style: S.row },
        h("span", { style: S.dim }, "选择文件"),
        files.length
          ? h(
              "select",
              {
                style: Object.assign({}, S.btn, { cursor: "pointer", maxWidth: 420 }),
                value: pickedAbs,
                onChange: function (e) {
                  if (e.target.value) setTestPath(e.target.value);
                }
              },
              h("option", { value: "" }, "— 从工作区选择 —"),
              files.map(function (f) {
                return h("option", { key: f.abs, value: f.abs }, f.rel + " (" + fmtBytes(f.size) + ")");
              })
            )
          : h(
              "span",
              { style: S.dim },
              filesRoot
                ? "这个工作区里没有可转换的 Office / PDF 文件，可以直接粘贴绝对路径"
                : "还没有可用的文件列表 —— 先在对话里让我转一个文件，或直接粘贴路径"
            ),
        h("button", { style: testBusy ? S.btnOff : S.btn, disabled: testBusy, onClick: testConvert }, testBusy ? "转换中…" : "试转")
      ),
      filesRoot
        ? h(
            "div",
            { style: S.dim },
            "来自 " + filesRoot +
            (files.length ? " · 共 " + files.length + " 个可转换文件" : "") +
            (filesTruncated ? "（已截断，只列出前 200 个）" : "")
          )
        : null,
      // 第二行：也可以直接粘绝对路径
      h(
        "div",
        { style: S.row },
        h("input", {
          style: Object.assign({}, S.mono, {
            flex: "1 1 420px",
            minWidth: 240,
            padding: "5px 8px",
            borderRadius: 6,
            border: "1px solid " + COLOR.line,
            background: "transparent",
            color: "inherit",
            font: "inherit"
          }),
          placeholder: "或直接粘贴绝对路径，例如 D:\\work\\报表.xlsx",
          value: testPath,
          onChange: function (e) { setTestPath(e.target.value); },
          onKeyDown: function (e) { if (e.key === "Enter") testConvert(); }
        })
      ),
      h(
        "div",
        { style: S.dim },
        "用来确认「换了这台机器还好不好使」：走的是和工具完全相同的转换链，但不走缓存。产物固定叫 <文件名>-test.md，" +
        "放在源文件旁边（配了 tmpDir 就放那里），每次覆盖、不会堆积，也不会被工具误当成缓存结果。"
      ),
      testResult
        ? renderTest(testResult, {
            onInstall: function () { askInstall("card"); },
            onReprobe: function () { probeNow(true); },
            onCopy: function (text) { copy("test", text); },
            copied: copied === "test"
          })
        : null
    ),

    // ---- job / messages ---------------------------------------------------
    job && job.log && job.log.length
      ? h(
          "div",
          { style: S.card },
          h(
            "div",
            { style: S.cardHead },
            h("b", null, job.kind === "install" ? "安装进度" : "卸载进度"),
            h(
              "div",
              { style: S.row },
              h("span", { style: Object.assign({}, S.badge, { color: job.state === "failed" ? COLOR.bad : job.state === "done" ? COLOR.ok : COLOR.warn }) }, job.state === "running" ? "进行中" : job.state === "done" ? "已完成" : "失败"),
              h(
                "button",
                { style: S.btn, onClick: function () { copy("log", (job.log || []).join("\n")); } },
                copied === "log" ? "已复制" : "复制"
              )
            )
          ),
          h("pre", { style: S.log }, job.log.join("\n")),
          job.error ? h("div", { style: { color: COLOR.bad } }, job.error) : null
        )
      : null,

    toast ? h("div", { style: S.dim }, toast) : null,
    error ? h("div", { style: { color: COLOR.bad } }, error) : null
  );
}

/* ---------------- 注册 ---------------- */

/**
 * 往 settings.section 里注册「Office 转换」这一页。
 *
 * 只注册一个 var 级函数组件；页面自己的数据全部走 /office-markdown/api/*。
 * order=450 决定它排在其它设置页的哪个位置。
 */
function apply(ctx) {
  ctx.slots.inject("settings.section", function () {
    ctx.slots.register(
      { name: "settings.section", id: "office-markdown", order: 450, label: "Office 转换" },
      function () {
        return h(Panel);
      }
    );
  });
}

module.exports = { apply: apply, inject: inject };
return module.exports; } });