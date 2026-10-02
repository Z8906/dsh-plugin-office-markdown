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
 */
var React = require("react");
if (React && React.default) React = React.default;
var h = React.createElement;
var useState = React.useState;
var useEffect = React.useEffect;
var useCallback = React.useCallback;

var API = "/office-markdown/api";
var inject = ["slots"];

var COLOR = {
  ok: "#22a06b",
  bad: "#e5484d",
  warn: "#d97706",
  dim: "rgba(127,127,127,0.95)",
  line: "rgba(127,127,127,0.30)",
  fill: "rgba(127,127,127,0.10)"
};

function fmtBytes(n) {
  var v = Number(n) || 0;
  if (v < 1024) return v + " B";
  if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
  if (v < 1073741824) return (v / 1048576).toFixed(1) + " MB";
  return (v / 1073741824).toFixed(2) + " GB";
}

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

function renderTest(r) {
  if (!r) return null;
  if (r.ok !== true) {
    return h(
      "div",
      null,
      h("div", { style: { color: COLOR.bad } }, "试转失败：" + (r.error || "未知错误")),
      r.sourcePath ? h("div", { style: S.dim }, "源文件：" + r.sourcePath) : null,
      r.converterAttempts && r.converterAttempts.length
        ? h("div", { style: S.dim }, "尝试过的转换器：" + r.converterAttempts.join(" · "))
        : null,
      r.notices && r.notices.length ? h("div", { style: S.dim }, r.notices.join(" · ")) : null
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

function Panel() {
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

  // `force` re-runs the whole probe on the host; without it the host answers
  // from its cache (probeTtlMs, 10 minutes by default), because walking every
  // interpreter costs several process spawns each.
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
        var best = null;
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].usable && list[i].hasPip) { best = list[i]; break; }
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
      })
      .catch(function (x) {
        setTestResult({ ok: false, error: messageOf(x) });
      })
      .then(function () {
        setTestBusy(false);
      });
  }, [testPath]);

  useEffect(function () {
    refresh();
    probeNow();
  }, [refresh, probeNow]);

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

  var converter = (status && status.converter) || null;
  var usingFallback = !converter || converter.usingFallback;
  var jobRunning = !!(job && job.state === "running");
  var candidates = (probe && probe.python && probe.python.candidates) || [];
  var snapshot = (probe && probe.snapshot) || (status && status.snapshot) || null;

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
        ),
        h(
          "button",
          { style: busy ? S.btnOff : S.btn, disabled: busy, onClick: refresh },
          "刷新"
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
            { style: busy ? S.btnOff : S.btn, disabled: busy, onClick: function () { probeNow(false); } },
            busy ? "检查中…" : "检查本机环境"
          ),
          h(
            "button",
            { style: busy ? S.btnOff : S.btn, disabled: busy, onClick: function () { probeNow(true); } },
            "重新检查"
          ),
          probe && probe.cached ? h("span", { style: S.dim }, "（缓存结果，点「重新检查」强制重探）") : null
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
        : h("div", { style: S.dim }, "点击「检查本机环境」开始探测。"),
      candidates.length
        ? h(
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
              { style: jobRunning ? S.btnOff : S.btn, disabled: jobRunning, onClick: function () { start("install"); } },
              "一键配置 MarkItDown 环境"
            )
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
              h("span", { style: Object.assign({}, S.badge, { color: COLOR.ok }) }, snapshot.adopted ? "已接管（原本已安装）" : "由本插件安装"),
              h("span", { style: S.mono }, snapshot.python || "")
            ),
            h("div", { style: S.dim }, (snapshot.adopted ? "登记时间 " : "安装时间 ") + (snapshot.installedAt || "未知") + " · 可卸载 " + ((snapshot.added || []).length) + " 个包"),
            snapshot.keep && snapshot.keep.length
              ? h("div", { style: S.dim }, "另有 " + snapshot.keep.length + " 个包被 DSH 运行时或其它组件共用，不会卸载。")
              : null,
            h("div", { style: S.dim }, "记录文件：" + (snapshot.path || "~/.dsh/dsh-plugin-office-markdown.env.json")),
            h(
              "div",
              { style: S.row },
              h(
                "button",
                { style: jobRunning ? S.btnOff : S.btn, disabled: jobRunning, onClick: function () { start("uninstall"); } },
                "卸载插件配置的环境"
              )
            ),
            h("div", { style: S.dim }, "只会卸载记录里属于 MarkItDown 的包；DSH 运行时自带的包（python-docx / openpyxl 等）和你原有的其它 Python 包一个都不会动。"),
            h("div", { style: S.dim }, "在 DSH 里卸载本插件时，这一步会自动完成。")
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
          placeholder: "绝对路径，例如 D:\\work\\报表.xlsx",
          value: testPath,
          onChange: function (e) { setTestPath(e.target.value); },
          onKeyDown: function (e) { if (e.key === "Enter") testConvert(); }
        }),
        h("button", { style: testBusy ? S.btnOff : S.btn, disabled: testBusy, onClick: testConvert }, testBusy ? "转换中…" : "试转")
      ),
      h(
        "div",
        { style: S.dim },
        "用来确认「换了这台机器还好不好使」：走的是和工具完全相同的转换链，但不走缓存。产物固定叫 <文件名>-test.md，" +
        "放在源文件旁边（配了 tmpDir 就放那里），每次覆盖、不会堆积，也不会被工具误当成缓存结果。"
      ),
      testResult ? renderTest(testResult) : null
    ),

    // ---- job / messages ---------------------------------------------------
    job && job.log && job.log.length
      ? h(
          "div",
          { style: S.card },
          h("div", { style: S.cardHead }, h("b", null, job.kind === "install" ? "安装进度" : "卸载进度"), h("span", { style: Object.assign({}, S.badge, { color: job.state === "failed" ? COLOR.bad : job.state === "done" ? COLOR.ok : COLOR.warn }) }, job.state === "running" ? "进行中" : job.state === "done" ? "已完成" : "失败")),
          h("pre", { style: S.log }, job.log.join("\n")),
          job.error ? h("div", { style: { color: COLOR.bad } }, job.error) : null
        )
      : null,

    toast ? h("div", { style: S.dim }, toast) : null,
    error ? h("div", { style: { color: COLOR.bad } }, error) : null
  );
}

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