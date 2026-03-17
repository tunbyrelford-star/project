const TAB_PAGE_PATHS = new Set([
  "/pages/index/index",
  "/pages/ship/list/index",
  "/pages/onsite/tasks/index"
]);

// Routes that require query params. If missing, jump to a safe list page.
const REQUIRED_QUERY_RULES = {
  "/pages/finance/payment/index": [["orderId"]],
  "/pages/finance/confirm/index": [["orderId"]],
  "/pages/finance/weighing/index": [["orderId"]],
  "/pages/procurement/detail/index": [["id"]],
  "/pages/voyage/detail/index": [["id"]],
  "/pages/sales/detail/index": [["id"]],
  "/pages/ship/detail/index": [["id"], ["mmsi"]]
};

const FALLBACK_ROUTE_MAP = {
  "/pages/finance/payment/index": "/pages/finance/pending/index",
  "/pages/finance/confirm/index": "/pages/finance/pending/index",
  "/pages/finance/weighing/index": "/pages/finance/pending/index",
  "/pages/procurement/detail/index": "/pages/procurement/list/index",
  "/pages/voyage/detail/index": "/pages/procurement/list/index",
  "/pages/sales/detail/index": "/pages/sales/orders/index",
  "/pages/ship/detail/index": "/pages/ship/list/index"
};

function normalizeUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  return value.startsWith("/") ? value : `/${value}`;
}

function splitUrl(url) {
  const normalized = normalizeUrl(url);
  const idx = normalized.indexOf("?");
  if (idx < 0) {
    return { path: normalized, queryString: "" };
  }
  return {
    path: normalized.slice(0, idx),
    queryString: normalized.slice(idx + 1)
  };
}

function parseQueryMap(queryString) {
  const result = {};
  String(queryString || "")
    .split("&")
    .filter(Boolean)
    .forEach((pair) => {
      const [rawKey, rawValue = ""] = pair.split("=");
      const key = decodeURIComponent(rawKey || "").trim();
      if (!key) return;
      result[key] = decodeURIComponent(rawValue || "").trim();
    });
  return result;
}

function hasRequiredQuery(path, queryMap) {
  const rules = REQUIRED_QUERY_RULES[path];
  if (!rules || !rules.length) return true;
  return rules.some((requiredKeys) =>
    requiredKeys.every((key) => String(queryMap[key] || "").trim())
  );
}

function isTabPage(path) {
  return TAB_PAGE_PATHS.has(path);
}

function showMissingParamToast() {
  wx.showToast({
    title: "入口参数缺失，已跳转可用页面",
    icon: "none"
  });
}

function openRoute(url) {
  const { path } = splitUrl(url);
  if (isTabPage(path)) {
    wx.switchTab({ url: path });
    return;
  }
  wx.navigateTo({ url });
}

function navigateByUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return;
  }

  const { path, queryString } = splitUrl(normalized);
  const queryMap = parseQueryMap(queryString);

  if (!hasRequiredQuery(path, queryMap)) {
    const fallbackUrl = FALLBACK_ROUTE_MAP[path] || "/pages/index/index";
    showMissingParamToast();
    openRoute(fallbackUrl);
    return;
  }

  openRoute(normalized);
}

module.exports = {
  navigateByUrl,
  isTabPage
};
