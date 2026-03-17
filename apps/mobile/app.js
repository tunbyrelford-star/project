const { hasLoginSession } = require("./utils/auth");

const IGNORED_RUNTIME_ERROR_PATTERNS = [
  /saaa_config\.json/i,
  /path:\s*\/saaa_config\.json/i,
  /not node js file system!path:\s*\/saaa_config\.json/i,
  /recoverTuoguanOptimizeAd/i,
  /operateWXData:fail invalid scope/i,
  /wxfile:\/\/\/?usr\/miniprogramLog\/Log2/i,
  /wxfile:\/\/\/?usr\/miniprogramLog\/log2/i,
  /wxfile:\/\/\/?usr\/miniprogramLog\/Log3/i,
  /wxfile:\/\/\/?usr\/miniprogramLog\/log3/i,
  /miniprogramLog\/Log2/i,
  /miniprogramLog\/log2/i,
  /miniprogramLog\/Log3/i,
  /miniprogramLog\/log3/i,
  /no such file or directory,\s*access\s*'wxfile:\/\/\/?usr\/miniprogramLog\/log\d+'/i
];

const rawConsoleError = console.error.bind(console);

function normalizeErrorText(payload) {
  if (payload === null || payload === undefined) {
    return "";
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeErrorText(item)).join(" ");
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch (_error) {
    return String(payload);
  }
}

function shouldIgnoreRuntimeError(payload) {
  const text = normalizeErrorText(payload);
  return IGNORED_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

console.error = (...args) => {
  if (shouldIgnoreRuntimeError(args)) {
    return;
  }
  rawConsoleError(...args);
};

function safeNoop() {}

function normalizeCompatPath(filePath) {
  if (typeof filePath !== "string") {
    return filePath;
  }
  const raw = filePath.trim();
  const userDataPath = String(wx.env.USER_DATA_PATH || "").replace(/\/+$/, "");
  if (!userDataPath) {
    return raw;
  }

  if (/^\/saaa_config\.json$/i.test(raw)) {
    return `${userDataPath}/saaa_config.json`;
  }

  const logMatch = raw.match(
    /^wxfile:\/\/\/?usr\/miniprogramLog\/(log[23])$/i
  ) || raw.match(/^\/miniprogramLog\/(log[23])$/i);
  if (logMatch) {
    return `${userDataPath}/miniprogramLog/${logMatch[1]}`;
  }

  return raw;
}

function patchFileSystemCompat() {
  try {
    const fs = wx.getFileSystemManager();
    if (!fs || fs.__compatPatched) {
      return;
    }

    const patchAsyncMethod = (method) => {
      if (typeof fs[method] !== "function") {
        return;
      }
      const origin = fs[method].bind(fs);
      fs[method] = (options = {}) => {
        if (options && typeof options === "object" && typeof options.filePath === "string") {
          const patchedOptions = Object.assign({}, options, {
            filePath: normalizeCompatPath(options.filePath)
          });
          return origin(patchedOptions);
        }
        return origin(options);
      };
    };

    const patchSyncMethod = (method) => {
      if (typeof fs[method] !== "function") {
        return;
      }
      const origin = fs[method].bind(fs);
      fs[method] = (filePath, ...restArgs) => {
        if (typeof filePath === "string") {
          return origin(normalizeCompatPath(filePath), ...restArgs);
        }
        return origin(filePath, ...restArgs);
      };
    };

    ["readFile", "open", "access", "stat"].forEach(patchAsyncMethod);
    ["readFileSync", "openSync", "accessSync", "statSync"].forEach(patchSyncMethod);

    fs.__compatPatched = true;
  } catch (_error) {
    // Ignore fs compatibility patch errors.
  }
}

function ensureRuntimeCompatFiles() {
  try {
    const fs = wx.getFileSystemManager();
    const userDataPath = String(wx.env.USER_DATA_PATH || "").replace(/\/+$/, "");
    if (!userDataPath) {
      return;
    }

    const logDir = `${userDataPath}/miniprogramLog`;
    const runtimeSaaaConfig = `${userDataPath}/saaa_config.json`;
    const emptyConfig = "{}";

    fs.mkdir({
      dirPath: logDir,
      recursive: true,
      fail: safeNoop
    });

    ["Log2", "log2", "Log3", "log3"].forEach((name) => {
      fs.writeFile({
        filePath: `${logDir}/${name}`,
        data: "",
        encoding: "utf8",
        fail: safeNoop
      });
    });

    fs.writeFile({
      filePath: runtimeSaaaConfig,
      data: emptyConfig,
      encoding: "utf8",
      fail: safeNoop
    });
  } catch (_error) {
    // Ignore runtime compatibility file creation errors.
  }
}

App({
  globalData: {
    token: ""
  },
  onLaunch() {
    const logs = wx.getStorageSync("logs") || [];
    logs.unshift(Date.now());
    wx.setStorageSync("logs", logs);
    patchFileSystemCompat();
    ensureRuntimeCompatFiles();

    wx.onError((message) => {
      if (shouldIgnoreRuntimeError(message)) {
        return;
      }
      rawConsoleError("[wx.onError]", message);
    });

    wx.onUnhandledRejection((event) => {
      if (shouldIgnoreRuntimeError(event)) {
        return;
      }
      rawConsoleError("[wx.onUnhandledRejection]", normalizeErrorText(event));
    });
  },
  onError(message) {
    if (shouldIgnoreRuntimeError(message)) {
      return;
    }
    rawConsoleError("[App.onError]", message);
  },
  onShow() {
    const pages = getCurrentPages();
    const currentRoute = pages.length ? `/${pages[pages.length - 1].route}` : "";
    const loginRoute = "/pages/auth/login/index";
    if (!hasLoginSession() && currentRoute !== loginRoute) {
      wx.reLaunch({ url: loginRoute });
    }
  }
});
