const express = require("express");
const { pool, withTransaction } = require("../db");

const router = express.Router();

const POSITION_TTL_MS = Number(process.env.SHIP_POSITION_TTL_MS || 60 * 1000);
const POSITION_FALLBACK_TTL_MS = Number(process.env.SHIP_POSITION_FALLBACK_TTL_MS || 30 * 60 * 1000);
const PROVIDER_TIMEOUT_MS = Number(process.env.SHIP_POSITION_PROVIDER_TIMEOUT_MS || 4000);
const PROVIDER_NAME = process.env.SHIP_POSITION_PROVIDER_NAME || "SIM_PROVIDER";
const PROVIDER_URL = process.env.SHIP_POSITION_PROVIDER_URL || "";

const positionCache = new Map();
const VIEW_ROLES = ["SUPER_ADMIN", "DISPATCHER", "ONSITE_SPECIALIST", "SALES", "FINANCE_MGMT"];
const MANAGE_ROLES = ["SUPER_ADMIN", "DISPATCHER"];
const SHIP_STATUSES = new Set(["IDLE", "IN_VOYAGE", "MAINTENANCE", "DISABLED"]);

function ensureRole(req, allowedRoles) {
  if (!allowedRoles.includes(req.user.roleCode)) {
    const err = new Error("Permission denied");
    err.status = 403;
    throw err;
  }
}

function sanitizeMmsi(mmsi) {
  return String(mmsi || "").trim();
}

function sanitizeText(value, maxLen = 255) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function normalizeShipStatus(status, fallback = null) {
  const normalized = String(status || "").trim().toUpperCase();
  if (SHIP_STATUSES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function toNullableDecimal(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function normalizeCommonPorts(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeText(item, 64))
      .filter(Boolean)
      .join(" / ")
      .slice(0, 512);
  }
  return sanitizeText(value, 512);
}

function toCommonPortsList(commonPorts) {
  const raw = sanitizeText(commonPorts, 512);
  if (!raw) return [];
  return raw.split(/[\/,，;；\s]+/).map((item) => item.trim()).filter(Boolean);
}

function toDateOrNull(value) {
  if (!value) return null;
  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) return null;
  return dateValue;
}

function sanitizeShipPayload(payload = {}, { partial = false } = {}) {
  const shipName = sanitizeText(payload.shipName ?? payload.ship_name, 128);
  const mmsi = sanitizeMmsi(payload.mmsi);
  const shipType = sanitizeText(payload.shipType ?? payload.ship_type, 64);
  const tonnage = toNullableDecimal(payload.tonnage);
  const ownerName = sanitizeText(payload.ownerName ?? payload.owner_name, 128);
  const contactPhone = sanitizeText(payload.contactPhone ?? payload.contact_phone, 32);
  const commonPorts = normalizeCommonPorts(payload.commonPorts ?? payload.common_ports);
  const status = normalizeShipStatus(payload.status, partial ? null : "IDLE");
  const remark = sanitizeText(payload.remark, 500);

  const normalized = {};
  if (!partial || shipName) normalized.shipName = shipName;
  if (!partial || mmsi) normalized.mmsi = mmsi;
  if (!partial || shipType) normalized.shipType = shipType || null;
  if (!partial || payload.tonnage !== undefined) normalized.tonnage = tonnage;
  if (!partial || ownerName) normalized.ownerName = ownerName || null;
  if (!partial || contactPhone) normalized.contactPhone = contactPhone || null;
  if (!partial || payload.commonPorts !== undefined || payload.common_ports !== undefined) {
    normalized.commonPorts = commonPorts || null;
  }
  if (!partial || status) normalized.status = status;
  if (!partial || payload.remark !== undefined) normalized.remark = remark || null;
  normalized.lastPositionTime = toDateOrNull(payload.lastPositionTime ?? payload.last_position_time);

  if (!partial) {
    if (!normalized.shipName) {
      const err = new Error("shipName is required.");
      err.status = 400;
      throw err;
    }
    if (!normalized.mmsi) {
      const err = new Error("mmsi is required.");
      err.status = 400;
      throw err;
    }
    if (!normalized.status) {
      const err = new Error("status is invalid.");
      err.status = 400;
      throw err;
    }
  }

  if (tonnage != null && tonnage <= 0) {
    const err = new Error("tonnage must be greater than 0.");
    err.status = 400;
    throw err;
  }

  if (contactPhone && !/^[0-9+\-() ]{6,32}$/.test(contactPhone)) {
    const err = new Error("contactPhone format is invalid.");
    err.status = 400;
    throw err;
  }

  return normalized;
}

function normalizeOnlineStatus(status) {
  const value = String(status || "").trim().toUpperCase();
  if (value === "ONLINE" || value === "A" || value === "ACTIVE") return "ONLINE";
  if (value === "OFFLINE" || value === "I" || value === "INACTIVE") return "OFFLINE";
  return "UNKNOWN";
}

function asNumber(...candidates) {
  for (const item of candidates) {
    const value = Number(item);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function asString(...candidates) {
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }
  return null;
}

function clampInt(value, min = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.floor(num));
}

function trimExcerpt(text, maxLength = 1000) {
  const value = typeof text === "string" ? text : JSON.stringify(text || {});
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function hashString(input) {
  let hash = 0;
  const value = String(input || "");
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function makeRequestId(mmsi) {
  const suffix = sanitizeMmsi(mmsi).slice(-6) || "MMSI";
  return `POS-${Date.now()}-${suffix}`;
}

function buildSimulatedPosition(mmsi) {
  const ports = ["黄骅港", "天津港", "曹妃甸港", "青岛港", "日照港", "舟山港"];
  const seed = hashString(mmsi);
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const baseLat = 38 + (seed % 500) / 1000;
  const baseLng = 117 + ((seed * 7) % 900) / 1000;
  const jitter = ((bucket % 11) - 5) * 0.0012;
  const isInPort = (seed + bucket) % 5 === 0;
  const onlineStatus = (seed + bucket) % 7 === 0 ? "OFFLINE" : "ONLINE";
  const portName = ports[(seed + bucket) % ports.length];
  const portStayMinutes = isInPort ? 60 + ((seed + bucket * 13) % 840) : 0;
  const speedKnots = onlineStatus === "ONLINE" ? (isInPort ? 0.3 : 6 + ((seed % 50) / 10)) : 0;
  const courseDeg = onlineStatus === "ONLINE" && !isInPort ? (seed + bucket * 17) % 360 : 0;
  const positionTime = new Date().toISOString();

  return {
    latitude: Number((baseLat + jitter).toFixed(6)),
    longitude: Number((baseLng + jitter).toFixed(6)),
    speedKnots: Number(speedKnots.toFixed(2)),
    courseDeg: Number(courseDeg.toFixed(2)),
    onlineStatus,
    positionTime,
    portName,
    isInPort,
    portStayMinutes,
    sourceProvider: PROVIDER_NAME,
    rawPayload: {
      mode: "SIMULATED",
      mmsi,
      positionTime
    }
  };
}

function normalizeProviderPayload(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const pos = root.position && typeof root.position === "object" ? root.position : {};

  const latitude = asNumber(root.latitude, root.lat, pos.latitude, pos.lat);
  const longitude = asNumber(root.longitude, root.lng, root.lon, pos.longitude, pos.lng, pos.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Provider payload missing latitude/longitude.");
  }

  const positionTimeRaw = asString(
    root.position_time,
    root.positionTime,
    root.timestamp,
    pos.position_time,
    pos.positionTime,
    pos.timestamp
  );
  const positionDate = positionTimeRaw ? new Date(positionTimeRaw) : new Date();
  const validDate = Number.isNaN(positionDate.getTime()) ? new Date() : positionDate;

  const onlineStatus = normalizeOnlineStatus(
    root.online_status || root.onlineStatus || root.online || root.status || pos.online_status || pos.status
  );
  const portStayMinutes = clampInt(root.port_stay_minutes ?? root.portStayMinutes ?? pos.port_stay_minutes, 0);
  const isInPort = Boolean(root.is_in_port ?? root.isInPort ?? pos.is_in_port ?? (portStayMinutes > 0));

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    speedKnots: asNumber(root.speed_knots, root.speed, root.sog, pos.speed_knots, pos.speed, pos.sog),
    courseDeg: asNumber(root.course_deg, root.course, root.cog, pos.course_deg, pos.course, pos.cog),
    onlineStatus,
    positionTime: validDate.toISOString(),
    portName: asString(root.port_name, root.portName, pos.port_name, pos.portName),
    isInPort,
    portStayMinutes,
    sourceProvider: asString(root.provider, root.source, pos.provider) || PROVIDER_NAME,
    rawPayload: root
  };
}

function cacheGetFresh(mmsi) {
  const entry = positionCache.get(mmsi);
  if (!entry) return null;
  if (entry.expireAt > Date.now()) return entry.data;
  return null;
}

function cacheGetFallback(mmsi) {
  const entry = positionCache.get(mmsi);
  if (!entry) return null;
  if (entry.fallbackExpireAt > Date.now()) return entry.fallbackData;
  return null;
}

function cacheSetSuccess(mmsi, data) {
  const now = Date.now();
  positionCache.set(mmsi, {
    data,
    expireAt: now + POSITION_TTL_MS,
    fallbackData: data,
    fallbackExpireAt: now + POSITION_FALLBACK_TTL_MS
  });
}

function cacheSetFallback(mmsi, fallbackData) {
  const now = Date.now();
  const old = positionCache.get(mmsi);
  positionCache.set(mmsi, {
    data: old ? old.data : fallbackData,
    expireAt: old ? old.expireAt : 0,
    fallbackData,
    fallbackExpireAt: now + POSITION_FALLBACK_TTL_MS
  });
}

function toDateOrNow(value) {
  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) return new Date();
  return dateValue;
}

async function writeAuditLog(conn, {
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  beforeData = null,
  afterData = null
}) {
  let resolvedActorUserId = actorUserId || null;
  if (resolvedActorUserId) {
    const [actorRows] = await conn.query(
      `SELECT id
         FROM users
        WHERE id = ?
          AND is_void = 0
        LIMIT 1`,
      [resolvedActorUserId]
    );
    if (!actorRows.length) {
      resolvedActorUserId = null;
    }
  }

  await conn.query(
    `INSERT INTO audit_logs
      (trace_id, actor_user_id, action, entity_type, entity_id, event_time, before_data, after_data,
       is_system, created_at, updated_at, created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, 0, NOW(), NOW(), ?, ?, 0)`,
    [
      `TRACE-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      resolvedActorUserId,
      action,
      entityType,
      entityId,
      beforeData == null ? null : JSON.stringify(beforeData),
      afterData == null ? null : JSON.stringify(afterData),
      resolvedActorUserId,
      resolvedActorUserId
    ]
  );
}

async function generateShipNo(conn) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `SHP-${y}${m}${d}-`;

  const [rows] = await conn.query(
    `SELECT ship_no
       FROM ships
      WHERE ship_no LIKE ?
      ORDER BY ship_no DESC
      LIMIT 1`,
    [`${prefix}%`]
  );
  if (!rows.length) {
    return `${prefix}0001`;
  }

  const match = String(rows[0].ship_no || "").match(/(\d+)$/);
  const seq = match ? Number(match[1]) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function insertProviderLog(conn, payload) {
  await conn.query(
    `INSERT INTO ship_position_provider_logs
      (request_id, ship_id, mmsi, provider_name, request_url, http_status, is_success,
       duration_ms, error_message, response_excerpt, called_at, created_at, updated_at,
       created_by, updated_by, is_void)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?, ?, 0)`,
    [
      payload.requestId,
      payload.shipId || null,
      payload.mmsi,
      payload.providerName || PROVIDER_NAME,
      payload.requestUrl || null,
      payload.httpStatus || null,
      payload.isSuccess ? 1 : 0,
      payload.durationMs || null,
      payload.errorMessage || null,
      trimExcerpt(payload.responseExcerpt || null),
      payload.actorUserId || null,
      payload.actorUserId || null
    ]
  );
}

async function safeInsertProviderLog(payload) {
  try {
    await pool.query(
      `INSERT INTO ship_position_provider_logs
        (request_id, ship_id, mmsi, provider_name, request_url, http_status, is_success,
         duration_ms, error_message, response_excerpt, called_at, created_at, updated_at,
         created_by, updated_by, is_void)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?, ?, 0)`,
      [
        payload.requestId,
        payload.shipId || null,
        payload.mmsi,
        payload.providerName || PROVIDER_NAME,
        payload.requestUrl || null,
        payload.httpStatus || null,
        payload.isSuccess ? 1 : 0,
        payload.durationMs || null,
        payload.errorMessage || null,
        trimExcerpt(payload.responseExcerpt || null),
        payload.actorUserId || null,
        payload.actorUserId || null
      ]
    );
  } catch (_error) {
    // Avoid breaking main flow because of log write failure.
  }
}

async function findShipByMmsi(mmsi) {
  const [rows] = await pool.query(
    `SELECT id, ship_no, ship_name, mmsi, status, last_position_time
       FROM ships
      WHERE mmsi = ? AND is_void = 0
      LIMIT 1`,
    [mmsi]
  );
  return rows[0] || null;
}

async function readDbFallback(mmsi) {
  const [rows] = await pool.query(
    `SELECT
       mmsi, latitude, longitude, speed_knots, course_deg, online_status,
       position_time, port_name, is_in_port, port_stay_minutes, source_provider
     FROM ship_position_latest
     WHERE mmsi = ? AND is_void = 0
     LIMIT 1`,
    [mmsi]
  );
  if (!rows.length) return null;

  const row = rows[0];
  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedKnots: row.speed_knots == null ? null : Number(row.speed_knots),
    courseDeg: row.course_deg == null ? null : Number(row.course_deg),
    onlineStatus: row.online_status || "UNKNOWN",
    positionTime: row.position_time,
    portName: row.port_name || null,
    isInPort: Boolean(row.is_in_port),
    portStayMinutes: Number(row.port_stay_minutes || 0),
    sourceProvider: row.source_provider || "DB_FALLBACK",
    rawPayload: null
  };
}

async function fetchPositionFromProvider(mmsi) {
  const requestId = makeRequestId(mmsi);
  const start = Date.now();

  if (!PROVIDER_URL) {
    const simulated = buildSimulatedPosition(mmsi);
    return {
      requestId,
      providerName: PROVIDER_NAME,
      requestUrl: "simulated://ship-position",
      httpStatus: 200,
      durationMs: Date.now() - start,
      isSuccess: true,
      responseExcerpt: JSON.stringify(simulated.rawPayload || simulated),
      position: simulated
    };
  }

  const url = new URL(PROVIDER_URL);
  url.searchParams.set("mmsi", mmsi);
  const requestUrl = url.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const resp = await fetch(requestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    clearTimeout(timeout);

    const bodyText = await resp.text();
    const durationMs = Date.now() - start;
    if (!resp.ok) {
      return {
        requestId,
        providerName: PROVIDER_NAME,
        requestUrl,
        httpStatus: resp.status,
        durationMs,
        isSuccess: false,
        errorMessage: `Provider HTTP ${resp.status}`,
        responseExcerpt: bodyText
      };
    }

    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (_error) {
      return {
        requestId,
        providerName: PROVIDER_NAME,
        requestUrl,
        httpStatus: resp.status,
        durationMs,
        isSuccess: false,
        errorMessage: "Provider returned invalid JSON.",
        responseExcerpt: bodyText
      };
    }

    const position = normalizeProviderPayload(payload);
    return {
      requestId,
      providerName: PROVIDER_NAME,
      requestUrl,
      httpStatus: resp.status,
      durationMs,
      isSuccess: true,
      responseExcerpt: bodyText,
      position
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      requestId,
      providerName: PROVIDER_NAME,
      requestUrl,
      httpStatus: null,
      durationMs: Date.now() - start,
      isSuccess: false,
      errorMessage:
        error.name === "AbortError"
          ? `Provider timeout (${PROVIDER_TIMEOUT_MS}ms)`
          : error.message || "Provider request failed.",
      responseExcerpt: ""
    };
  }
}

async function persistSuccessfulPosition(ship, providerResult, actorUserId) {
  const position = providerResult.position;
  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE ships
          SET last_position_time = ?,
              updated_at = NOW(),
              updated_by = ?
        WHERE id = ?`,
      [toDateOrNow(position.positionTime), actorUserId || null, ship.id]
    );

    await conn.query(
      `INSERT INTO ship_position_latest
        (ship_id, mmsi, latitude, longitude, speed_knots, course_deg, online_status, position_time,
         port_name, is_in_port, port_stay_minutes, source_provider, raw_payload, created_at, updated_at,
         created_by, updated_by, is_void)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         ship_id = VALUES(ship_id),
         latitude = VALUES(latitude),
         longitude = VALUES(longitude),
         speed_knots = VALUES(speed_knots),
         course_deg = VALUES(course_deg),
         online_status = VALUES(online_status),
         position_time = VALUES(position_time),
         port_name = VALUES(port_name),
         is_in_port = VALUES(is_in_port),
         port_stay_minutes = VALUES(port_stay_minutes),
         source_provider = VALUES(source_provider),
         raw_payload = VALUES(raw_payload),
         updated_at = NOW(),
         updated_by = VALUES(updated_by),
         is_void = 0,
         void_reason = NULL,
         void_at = NULL`,
      [
        ship.id,
        ship.mmsi,
        position.latitude,
        position.longitude,
        position.speedKnots,
        position.courseDeg,
        position.onlineStatus,
        toDateOrNow(position.positionTime),
        position.portName,
        position.isInPort ? 1 : 0,
        clampInt(position.portStayMinutes, 0),
        position.sourceProvider || PROVIDER_NAME,
        JSON.stringify(position.rawPayload || {}),
        actorUserId || null,
        actorUserId || null
      ]
    );

    if (position.portName) {
      await conn.query(
        `INSERT INTO ship_frequent_ports
          (ship_id, mmsi, port_name, visit_count, first_seen_at, last_seen_at, created_at, updated_at,
           created_by, updated_by, is_void)
         VALUES (?, ?, ?, 1, NOW(), NOW(), NOW(), NOW(), ?, ?, 0)
         ON DUPLICATE KEY UPDATE
           ship_id = VALUES(ship_id),
           visit_count = visit_count + 1,
           last_seen_at = NOW(),
           updated_at = NOW(),
           updated_by = VALUES(updated_by),
           is_void = 0,
           void_reason = NULL,
           void_at = NULL`,
        [ship.id, ship.mmsi, position.portName, actorUserId || null, actorUserId || null]
      );
    }

    await insertProviderLog(conn, {
      requestId: providerResult.requestId,
      shipId: ship.id,
      mmsi: ship.mmsi,
      providerName: providerResult.providerName,
      requestUrl: providerResult.requestUrl,
      httpStatus: providerResult.httpStatus,
      isSuccess: true,
      durationMs: providerResult.durationMs,
      responseExcerpt: providerResult.responseExcerpt,
      actorUserId
    });
  });
}

async function resolveRealtimePosition(ship, { forceRefresh = false, actorUserId = null } = {}) {
  const mmsi = ship.mmsi;

  if (!forceRefresh) {
    const fresh = cacheGetFresh(mmsi);
    if (fresh) {
      return {
        position: fresh,
        cacheMode: "HIT_TTL",
        fromFallback: false
      };
    }
  }

  const providerResult = await fetchPositionFromProvider(mmsi);
  if (providerResult.isSuccess) {
    await persistSuccessfulPosition(ship, providerResult, actorUserId);
    cacheSetSuccess(mmsi, providerResult.position);
    return {
      position: providerResult.position,
      cacheMode: "MISS_FETCHED",
      fromFallback: false
    };
  }

  await safeInsertProviderLog({
    requestId: providerResult.requestId,
    shipId: ship.id,
    mmsi: ship.mmsi,
    providerName: providerResult.providerName,
    requestUrl: providerResult.requestUrl,
    httpStatus: providerResult.httpStatus,
    isSuccess: false,
    durationMs: providerResult.durationMs,
    errorMessage: providerResult.errorMessage,
    responseExcerpt: providerResult.responseExcerpt,
    actorUserId
  });

  const fallbackFromMemory = cacheGetFallback(mmsi);
  if (fallbackFromMemory) {
    return {
      position: {
        ...fallbackFromMemory,
        fallbackReason: "MEMORY_FALLBACK"
      },
      cacheMode: "FALLBACK_MEMORY",
      fromFallback: true
    };
  }

  const fallbackFromDb = await readDbFallback(mmsi);
  if (fallbackFromDb) {
    cacheSetFallback(mmsi, fallbackFromDb);
    return {
      position: {
        ...fallbackFromDb,
        fallbackReason: "DB_FALLBACK"
      },
      cacheMode: "FALLBACK_DB",
      fromFallback: true
    };
  }

  const err = new Error(providerResult.errorMessage || "Position service unavailable.");
  err.status = 502;
  throw err;
}

router.get("/", async (req, res, next) => {
  try {
    ensureRole(req, VIEW_ROLES);

    const {
      keyword = "",
      status = "",
      onlineStatus = "",
      shipType = "",
      minTonnage = "",
      maxTonnage = ""
    } = req.query || {};
    const where = ["s.is_void = 0"];
    const params = [];

    if (keyword) {
      where.push(
        "(s.ship_name LIKE ? OR s.mmsi LIKE ? OR s.ship_no LIKE ? OR COALESCE(s.owner_name, '') LIKE ? OR COALESCE(s.contact_phone, '') LIKE ?)"
      );
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const normalizedStatus = normalizeShipStatus(status);
    if (normalizedStatus) {
      where.push("s.status = ?");
      params.push(normalizedStatus);
    }
    if (onlineStatus) {
      where.push("COALESCE(l.online_status, 'UNKNOWN') = ?");
      params.push(onlineStatus);
    }
    if (shipType) {
      where.push("s.ship_type = ?");
      params.push(shipType);
    }

    const normalizedMinTonnage = toNullableDecimal(minTonnage);
    if (normalizedMinTonnage != null) {
      where.push("COALESCE(s.tonnage, 0) >= ?");
      params.push(normalizedMinTonnage);
    }
    const normalizedMaxTonnage = toNullableDecimal(maxTonnage);
    if (normalizedMaxTonnage != null) {
      where.push("COALESCE(s.tonnage, 0) <= ?");
      params.push(normalizedMaxTonnage);
    }

    const [rows] = await pool.query(
      `SELECT
         s.id,
         s.ship_no,
         s.ship_name,
         s.mmsi,
         s.ship_type,
         s.tonnage,
         s.owner_name,
         s.contact_phone,
         s.common_ports,
         s.status,
         s.remark,
         s.last_position_time,
         l.online_status,
         l.port_name,
         l.port_stay_minutes,
         l.position_time,
         COALESCE(fp.frequent_ports, '') AS frequent_ports
       FROM ships s
       LEFT JOIN ship_position_latest l
         ON l.ship_id = s.id AND l.is_void = 0
       LEFT JOIN (
         SELECT ship_id, GROUP_CONCAT(port_name ORDER BY visit_count DESC SEPARATOR ' / ') AS frequent_ports
         FROM ship_frequent_ports
         WHERE is_void = 0
         GROUP BY ship_id
       ) fp ON fp.ship_id = s.id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(s.last_position_time, s.updated_at) DESC
       LIMIT 300`,
      params
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        shipNo: row.ship_no,
        shipName: row.ship_name,
        mmsi: row.mmsi,
        shipType: row.ship_type || "",
        tonnage: row.tonnage == null ? null : Number(row.tonnage),
        ownerName: row.owner_name || "",
        contactPhone: row.contact_phone || "",
        commonPorts: row.common_ports || "",
        commonPortsList: toCommonPortsList(row.common_ports),
        status: row.status,
        remark: row.remark || "",
        onlineStatus: row.online_status || "UNKNOWN",
        lastPositionTime: row.last_position_time || row.position_time || null,
        portName: row.port_name || "-",
        portStayMinutes: Number(row.port_stay_minutes || 0),
        frequentPorts: row.frequent_ports ? row.frequent_ports.split(" / ") : [],
        frequentPortsText: row.frequent_ports || "-"
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    ensureRole(req, MANAGE_ROLES);
    const payload = sanitizeShipPayload(req.body || {}, { partial: false });

    const result = await withTransaction(async (conn) => {
      const [dupRows] = await conn.query(
        `SELECT id
           FROM ships
          WHERE mmsi = ?
            AND is_void = 0
          LIMIT 1`,
        [payload.mmsi]
      );
      if (dupRows.length) {
        const err = new Error("MMSI already exists.");
        err.status = 409;
        throw err;
      }

      let shipNo = sanitizeText(req.body && req.body.shipNo, 64);
      if (!shipNo) {
        shipNo = await generateShipNo(conn);
      }

      const [dupShipNoRows] = await conn.query(
        `SELECT id
           FROM ships
          WHERE ship_no = ?
            AND is_void = 0
          LIMIT 1`,
        [shipNo]
      );
      if (dupShipNoRows.length) {
        const err = new Error("shipNo already exists.");
        err.status = 409;
        throw err;
      }

      const [insertResult] = await conn.query(
        `INSERT INTO ships
          (ship_no, ship_name, mmsi, ship_type, tonnage, owner_name, contact_phone, common_ports,
           status, remark, last_position_time, created_at, updated_at, created_by, updated_by, is_void)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 0)`,
        [
          shipNo,
          payload.shipName,
          payload.mmsi,
          payload.shipType,
          payload.tonnage,
          payload.ownerName,
          payload.contactPhone,
          payload.commonPorts,
          payload.status,
          payload.remark,
          payload.lastPositionTime,
          req.user.id || null,
          req.user.id || null
        ]
      );

      const shipId = Number(insertResult.insertId || 0);
      await writeAuditLog(conn, {
        actorUserId: req.user.id || null,
        action: "SHIP_CREATE",
        entityType: "SHIP",
        entityId: shipId,
        afterData: {
          shipNo,
          shipName: payload.shipName,
          mmsi: payload.mmsi,
          status: payload.status
        }
      });

      return { shipId, shipNo };
    });

    res.json({
      message: "Ship created.",
      shipId: result.shipId,
      shipNo: result.shipNo
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    ensureRole(req, MANAGE_ROLES);

    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid id." });
    }

    const payload = sanitizeShipPayload(req.body || {}, { partial: false });

    await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT *
           FROM ships
          WHERE id = ?
            AND is_void = 0
          LIMIT 1
          FOR UPDATE`,
        [id]
      );
      if (!rows.length) {
        const err = new Error("Ship not found.");
        err.status = 404;
        throw err;
      }
      const before = rows[0];

      const [dupRows] = await conn.query(
        `SELECT id
           FROM ships
          WHERE mmsi = ?
            AND id <> ?
            AND is_void = 0
          LIMIT 1`,
        [payload.mmsi, id]
      );
      if (dupRows.length) {
        const err = new Error("MMSI already exists.");
        err.status = 409;
        throw err;
      }

      await conn.query(
        `UPDATE ships
            SET ship_name = ?,
                mmsi = ?,
                ship_type = ?,
                tonnage = ?,
                owner_name = ?,
                contact_phone = ?,
                common_ports = ?,
                status = ?,
                remark = ?,
                last_position_time = COALESCE(?, last_position_time),
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [
          payload.shipName,
          payload.mmsi,
          payload.shipType,
          payload.tonnage,
          payload.ownerName,
          payload.contactPhone,
          payload.commonPorts,
          payload.status,
          payload.remark,
          payload.lastPositionTime,
          req.user.id || null,
          id
        ]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id || null,
        action: "SHIP_UPDATE",
        entityType: "SHIP",
        entityId: id,
        beforeData: {
          shipName: before.ship_name,
          mmsi: before.mmsi,
          status: before.status
        },
        afterData: {
          shipName: payload.shipName,
          mmsi: payload.mmsi,
          status: payload.status
        }
      });
    });

    res.json({ message: "Ship updated." });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    ensureRole(req, MANAGE_ROLES);

    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid id." });
    }

    const status = normalizeShipStatus((req.body || {}).status);
    if (!status) {
      return res.status(400).json({ message: "Invalid status." });
    }

    await withTransaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT id, status
           FROM ships
          WHERE id = ?
            AND is_void = 0
          LIMIT 1
          FOR UPDATE`,
        [id]
      );
      if (!rows.length) {
        const err = new Error("Ship not found.");
        err.status = 404;
        throw err;
      }
      const before = rows[0];

      await conn.query(
        `UPDATE ships
            SET status = ?,
                updated_at = NOW(),
                updated_by = ?
          WHERE id = ?`,
        [status, req.user.id || null, id]
      );

      await writeAuditLog(conn, {
        actorUserId: req.user.id || null,
        action: "SHIP_STATUS_CHANGE",
        entityType: "SHIP",
        entityId: id,
        beforeData: { status: before.status },
        afterData: { status }
      });
    });

    res.json({ message: "Ship status updated.", status });
  } catch (error) {
    next(error);
  }
});

router.get("/mmsi/:mmsi/realtime-position", async (req, res, next) => {
  try {
    ensureRole(req, VIEW_ROLES);

    const mmsi = sanitizeMmsi(req.params.mmsi);
    if (!mmsi) {
      return res.status(400).json({ message: "Invalid mmsi." });
    }

    const ship = await findShipByMmsi(mmsi);
    if (!ship) {
      return res.status(404).json({ message: "Ship not found." });
    }

    const forceRefresh = ["1", "true", "yes"].includes(String(req.query.forceRefresh || "").toLowerCase());
    const resolved = await resolveRealtimePosition(ship, {
      forceRefresh,
      actorUserId: req.user.id
    });

    res.json({
      ship: {
        id: ship.id,
        shipNo: ship.ship_no,
        shipName: ship.ship_name,
        mmsi: ship.mmsi,
        status: ship.status,
        lastPositionTime: resolved.position.positionTime || ship.last_position_time || null
      },
      position: resolved.position,
      cache: {
        mode: resolved.cacheMode,
        fromFallback: resolved.fromFallback,
        ttlMs: POSITION_TTL_MS,
        fallbackTtlMs: POSITION_FALLBACK_TTL_MS
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    ensureRole(req, VIEW_ROLES);

    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid id." });
    }

    const [rows] = await pool.query(
      `SELECT
         s.id,
         s.ship_no,
         s.ship_name,
         s.mmsi,
         s.ship_type,
         s.tonnage,
         s.owner_name,
         s.contact_phone,
         s.common_ports,
         s.status,
         s.remark,
         s.last_position_time,
         s.created_at,
         s.updated_at,
         l.latitude,
         l.longitude,
         l.speed_knots,
         l.course_deg,
         l.online_status,
         l.position_time,
         l.port_name,
         l.port_stay_minutes
       FROM ships s
       LEFT JOIN ship_position_latest l
         ON l.ship_id = s.id AND l.is_void = 0
       WHERE s.id = ? AND s.is_void = 0
       LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Ship not found." });
    }

    const [portRows] = await pool.query(
      `SELECT port_name, visit_count, last_seen_at
         FROM ship_frequent_ports
        WHERE ship_id = ? AND is_void = 0
        ORDER BY visit_count DESC, last_seen_at DESC
        LIMIT 5`,
      [id]
    );

    const row = rows[0];
    res.json({
      detail: {
        id: row.id,
        shipNo: row.ship_no,
        shipName: row.ship_name,
        mmsi: row.mmsi,
        shipType: row.ship_type || "",
        tonnage: row.tonnage == null ? null : Number(row.tonnage),
        ownerName: row.owner_name || "",
        contactPhone: row.contact_phone || "",
        commonPorts: row.common_ports || "",
        commonPortsList: toCommonPortsList(row.common_ports),
        status: row.status,
        remark: row.remark || "",
        lastPositionTime: row.last_position_time || row.position_time || null,
        onlineStatus: row.online_status || "UNKNOWN",
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        latestPosition: row.latitude == null || row.longitude == null
          ? null
          : {
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              speedKnots: row.speed_knots == null ? null : Number(row.speed_knots),
              courseDeg: row.course_deg == null ? null : Number(row.course_deg),
              positionTime: row.position_time || null,
              portName: row.port_name || null,
              portStayMinutes: Number(row.port_stay_minutes || 0)
            }
      },
      frequentPorts: portRows.map((port) => ({
        portName: port.port_name,
        visitCount: Number(port.visit_count || 0),
        lastSeenAt: port.last_seen_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
