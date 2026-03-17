const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const ROLE_CODES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  DISPATCHER: "DISPATCHER",
  ONSITE_SPECIALIST: "ONSITE_SPECIALIST",
  SALES: "SALES",
  FINANCE_MGMT: "FINANCE_MGMT"
};

const ROLE_CODE_ALIASES = {
  PROCUREMENT_DISPATCHER: ROLE_CODES.DISPATCHER,
  DISPATCH: ROLE_CODES.DISPATCHER,
  ONSITE: ROLE_CODES.ONSITE_SPECIALIST,
  SITE: ROLE_CODES.ONSITE_SPECIALIST,
  SALES_MANAGER: ROLE_CODES.SALES,
  SALESMAN: ROLE_CODES.SALES,
  FINANCE: ROLE_CODES.FINANCE_MGMT,
  MANAGEMENT: ROLE_CODES.FINANCE_MGMT,
  ADMIN: ROLE_CODES.SUPER_ADMIN
};

const VALID_ROLE_CODES = new Set(Object.values(ROLE_CODES));

const DEMO_USERS = [
  {
    id: 900001,
    username: "admin",
    password: "admin123",
    displayName: "超级管理员",
    roleCodes: [ROLE_CODES.SUPER_ADMIN]
  },
  {
    id: 900002,
    username: "dispatcher",
    password: "123456",
    displayName: "采购/调度员",
    roleCodes: [ROLE_CODES.DISPATCHER]
  },
  {
    id: 900003,
    username: "onsite",
    password: "123456",
    displayName: "现场/过驳专员",
    roleCodes: [ROLE_CODES.ONSITE_SPECIALIST]
  },
  {
    id: 900004,
    username: "sales",
    password: "123456",
    displayName: "销售经理/销售员",
    roleCodes: [ROLE_CODES.SALES]
  },
  {
    id: 900005,
    username: "finance",
    password: "123456",
    displayName: "财务/管理层",
    roleCodes: [ROLE_CODES.FINANCE_MGMT]
  }
];

function normalizeRoleCode(roleCode) {
  const raw = String(roleCode || "").trim().toUpperCase();
  if (!raw) {
    return "";
  }
  return ROLE_CODE_ALIASES[raw] || raw;
}

function normalizeRoleCodes(roleCodes) {
  const normalized = (roleCodes || [])
    .map((code) => normalizeRoleCode(code))
    .filter((code) => VALID_ROLE_CODES.has(code));
  return [...new Set(normalized)];
}

function resolveLoginRole(roleCodes, preferredRoleCode) {
  const normalized = normalizeRoleCodes(roleCodes);
  if (!normalized.length) {
    return ROLE_CODES.DISPATCHER;
  }
  if (normalized.includes(ROLE_CODES.SUPER_ADMIN)) {
    return ROLE_CODES.SUPER_ADMIN;
  }

  const preferred = normalizeRoleCode(preferredRoleCode);
  if (preferred && normalized.includes(preferred)) {
    return preferred;
  }

  return normalized[0];
}

function issueToken(userId, roleCode) {
  const payload = Buffer.from(`${userId}:${roleCode}:${Date.now()}`).toString("base64");
  return `sl.${payload}`;
}

function isRecoverableDbError(error) {
  const codes = new Set([
    "ER_NO_SUCH_TABLE",
    "ER_BAD_FIELD_ERROR",
    "ER_BAD_DB_ERROR",
    "ECONNREFUSED",
    "PROTOCOL_CONNECTION_LOST"
  ]);
  return Boolean(error && codes.has(error.code));
}

async function ensureDemoUserMaterialized(demoUser) {
  const roleCodes = normalizeRoleCodes(demoUser.roleCodes || []);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO users
        (id, username, phone, password_hash, display_name, status, last_login_at,
         created_at, updated_at, created_by, updated_by, is_void, void_reason, void_at)
       VALUES (?, ?, NULL, ?, ?, 'ACTIVE', NOW(), NOW(), NOW(), NULL, NULL, 0, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         password_hash = VALUES(password_hash),
         display_name = VALUES(display_name),
         status = 'ACTIVE',
         last_login_at = NOW(),
         updated_at = NOW(),
         is_void = 0,
         void_reason = NULL,
         void_at = NULL`,
      [
        Number(demoUser.id),
        String(demoUser.username || ""),
        String(demoUser.password || ""),
        String(demoUser.displayName || demoUser.username || "")
      ]
    );

    if (roleCodes.length) {
      const placeholders = roleCodes.map(() => "?").join(",");
      const [roleRows] = await conn.query(
        `SELECT id, role_code
           FROM roles
          WHERE role_code IN (${placeholders})
            AND status = 'ACTIVE'
            AND is_void = 0`,
        roleCodes
      );

      for (const role of roleRows) {
        await conn.query(
          `INSERT INTO user_roles
            (user_id, role_id, status, created_at, updated_at, created_by, updated_by, is_void, void_reason, void_at)
           VALUES (?, ?, 'ACTIVE', NOW(), NOW(), ?, ?, 0, NULL, NULL)
           ON DUPLICATE KEY UPDATE
             status = 'ACTIVE',
             updated_at = NOW(),
             updated_by = VALUES(updated_by),
             is_void = 0,
             void_reason = NULL,
             void_at = NULL`,
          [Number(demoUser.id), Number(role.id), Number(demoUser.id), Number(demoUser.id)]
        );
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function findUserFromDatabase(username) {
  const [rows] = await pool.query(
    `SELECT id, username, password_hash, display_name, status
       FROM users
      WHERE username = ?
        AND is_void = 0
      LIMIT 1`,
    [username]
  );

  if (!rows.length) {
    return null;
  }

  const user = rows[0];
  if (user.status !== "ACTIVE") {
    const err = new Error("用户状态不可登录。");
    err.status = 403;
    throw err;
  }

  const [roleRows] = await pool.query(
    `SELECT r.role_code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
        AND ur.status = 'ACTIVE'
        AND ur.is_void = 0
        AND r.status = 'ACTIVE'
        AND r.is_void = 0`,
    [user.id]
  );

  const roleCodes = normalizeRoleCodes(roleRows.map((x) => String(x.role_code)));

  return {
    source: "DB",
    id: Number(user.id),
    username: String(user.username),
    passwordHash: String(user.password_hash || ""),
    displayName: String(user.display_name || user.username),
    roleCodes
  };
}

function findDemoUser(username) {
  const user = DEMO_USERS.find((x) => x.username === username);
  if (!user) {
    return null;
  }

  return {
    source: "DEMO",
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    password: user.password,
    roleCodes: normalizeRoleCodes(user.roleCodes)
  };
}

router.post("/login", async (req, res, next) => {
  try {
    const username = String((req.body || {}).username || "").trim();
    const password = String((req.body || {}).password || "").trim();
    const preferredRoleCode = normalizeRoleCode((req.body || {}).roleCode || "");

    if (!username || !password) {
      return res.status(400).json({ message: "username 和 password 必填。" });
    }
    if (preferredRoleCode && !VALID_ROLE_CODES.has(preferredRoleCode)) {
      return res.status(400).json({ message: "roleCode 非法。" });
    }

    let user = null;
    let dbError = null;
    try {
      user = await findUserFromDatabase(username);
    } catch (error) {
      dbError = error;
      if (!isRecoverableDbError(error)) {
        throw error;
      }
    }

    if (user) {
      // Development mode password check: plain text compare with password_hash.
      // Production should use bcrypt/scrypt.
      if (password !== user.passwordHash) {
        return res.status(401).json({ message: "账号或密码错误。" });
      }
      if (!user.roleCodes.length) {
        return res.status(403).json({ message: "用户未分配有效角色。" });
      }

      const loginRoleCode = resolveLoginRole(user.roleCodes, preferredRoleCode);
      const token = issueToken(user.id, loginRoleCode);

      try {
        await pool.query(
          `UPDATE users
              SET last_login_at = NOW(),
                  updated_at = NOW(),
                  updated_by = ?
            WHERE id = ?`,
          [user.id, user.id]
        );
      } catch (_error) {
        // Ignore non-critical login timestamp failures.
      }

      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          roleCode: loginRoleCode,
          roleCodes: user.roleCodes,
          isSuperAdmin: user.roleCodes.includes(ROLE_CODES.SUPER_ADMIN)
        }
      });
    }

    const demoUser = findDemoUser(username);
    if (!demoUser || demoUser.password !== password) {
      const extra = dbError && isRecoverableDbError(dbError)
        ? "（数据库未就绪，仅支持演示账号登录）"
        : "";
      return res.status(401).json({ message: `账号或密码错误。${extra}` });
    }

    const loginRoleCode = resolveLoginRole(demoUser.roleCodes, preferredRoleCode);
    const token = issueToken(demoUser.id, loginRoleCode);

    // Keep demo users materialized in DB so FK-linked writes won't fail.
    try {
      await ensureDemoUserMaterialized(demoUser);
    } catch (_error) {
      // Non-blocking: keep demo mode available even if DB sync fails.
    }

    return res.json({
      token,
      user: {
        id: demoUser.id,
        username: demoUser.username,
        displayName: demoUser.displayName,
        roleCode: loginRoleCode,
        roleCodes: demoUser.roleCodes,
        isSuperAdmin: demoUser.roleCodes.includes(ROLE_CODES.SUPER_ADMIN)
      },
      mode: "DEMO"
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
