const path = require('path');
const { authPlugin } = require('./auth');
const { prisma } = require('./db');
const { encrypt, decrypt } = require('./crypto');
const { onSiteUpdated, onSiteDeleted, scheduleGlobalTask } = require('./scheduler');
const { checkSiteById } = require('./run');
const { normalizeProxyUrl, parseProxyUrl, siteFetch } = require('./site-http');

const SITE_LIST_ORDER = [
  { pinned: 'desc' },
  { sortOrder: 'asc' },
  { createdAt: 'desc' }
];

const SITE_LIST_SELECT = {
  id: true,
  name: true,
  baseUrl: true,
  apiType: true,
  userId: true,
  billingUrl: true,
  billingAuthType: true,
  billingLimitField: true,
  billingUsageField: true,
  unlimitedQuota: true,
  enableCheckIn: true,
  checkInMode: true,
  scheduleCron: true,
  timezone: true,
  pinned: true,
  excludeFromBatch: true,
  categoryId: true,
  extralink: true,
  remark: true,
  sortOrder: true,
  lastCheckedAt: true,
  createdAt: true,
  category: {
    select: {
      id: true,
      name: true,
      scheduleCron: true,
      timezone: true,
      createdAt: true,
      updatedAt: true
    }
  }
};

const SITE_SNAPSHOT_SELECT = {
  siteId: true,
  fetchedAt: true,
  billingLimit: true,
  billingUsage: true,
  billingError: true,
  modelsJson: true,
  checkInSuccess: true,
  checkInMessage: true,
  checkInError: true
};

function decryptOptional(value, fieldName, fastify) {
  if (!value) return null;

  try {
    return decrypt(value);
  } catch (error) {
    fastify?.log?.error({ error: error.message }, `Failed to decrypt ${fieldName}`);
    return null;
  }
}

function encryptProxyUrl(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;
  parseProxyUrl(normalized);
  return encrypt(normalized);
}

function normalizeManagedTokenKey(token) {
  if (typeof token !== 'string') return token;

  const trimmedToken = token.trim();
  if (!trimmedToken) return trimmedToken;

  return trimmedToken.startsWith('sk-') ? trimmedToken : `sk-${trimmedToken}`;
}

function serializeManagedTokenKey(token) {
  if (typeof token !== 'string') return token;

  const trimmedToken = token.trim();
  if (!trimmedToken) return trimmedToken;

  return trimmedToken.startsWith('sk-') ? trimmedToken.slice(3) : trimmedToken;
}

function normalizeManagedTokenRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  if (!('key' in record)) {
    return record;
  }

  return {
    ...record,
    key: normalizeManagedTokenKey(record.key)
  };
}

function normalizeManagedTokenResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.data)) {
    return {
      ...data,
      data: data.data.map(normalizeManagedTokenRecord)
    };
  }

  if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) {
    return data;
  }

  if (Array.isArray(data.data.items)) {
    return {
      ...data,
      data: {
        ...data.data,
        items: data.data.items.map(normalizeManagedTokenRecord)
      }
    };
  }

  if (Array.isArray(data.data.data)) {
    return {
      ...data,
      data: {
        ...data.data,
        data: data.data.data.map(normalizeManagedTokenRecord)
      }
    };
  }

  return data;
}

function serializeManagedTokenPayload(tokenData) {
  if (!tokenData || typeof tokenData !== 'object' || Array.isArray(tokenData)) {
    return tokenData;
  }

  if (!('key' in tokenData)) {
    return tokenData;
  }

  return {
    ...tokenData,
    key: serializeManagedTokenKey(tokenData.key)
  };
}

function getVoapiApiKey(site) {
  return site?.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
}

function getSiteDetailResponse(site, fastify) {
  const token = decryptOptional(site.apiKeyEnc, 'API key', fastify);
  const billingAuthValue = decryptOptional(site.billingAuthValue, 'billing auth value', fastify);
  const proxyUrl = decryptOptional(site.proxyUrlEnc, 'proxy URL', fastify);
  const { apiKeyEnc, billingAuthValue: _, proxyUrlEnc, ...rest } = site;

  return {
    ...rest,
    token,
    url: site.baseUrl,
    type: site.apiType,
    billingAuthValue,
    proxyUrl
  };
}

function stripSiteSearchModels(site) {
  const { _modelsJson, ...rest } = site;
  return rest;
}

function siteMatchesSearch(site, searchLower) {
  if (site.name.toLowerCase().includes(searchLower)) return true;
  if (site.baseUrl.toLowerCase().includes(searchLower)) return true;

  if (!site._modelsJson) {
    return false;
  }

  try {
    const models = JSON.parse(site._modelsJson);
    if (!Array.isArray(models)) {
      return false;
    }

    return models.some(model => model.id && model.id.toLowerCase().includes(searchLower));
  } catch (error) {
    return false;
  }
}

async function getLatestSuccessfulSnapshots(siteIds) {
  if (!siteIds.length) {
    return new Map();
  }

  const latestSnapshotTimes = await prisma.modelSnapshot.groupBy({
    by: ['siteId'],
    where: {
      siteId: { in: siteIds },
      errorMessage: null
    },
    _max: {
      fetchedAt: true
    }
  });

  const snapshotLookupConditions = latestSnapshotTimes
    .filter(row => row._max.fetchedAt)
    .map(row => ({
      siteId: row.siteId,
      fetchedAt: row._max.fetchedAt,
      errorMessage: null
    }));

  if (!snapshotLookupConditions.length) {
    return new Map();
  }

  const snapshots = await prisma.modelSnapshot.findMany({
    where: {
      OR: snapshotLookupConditions
    },
    select: SITE_SNAPSHOT_SELECT
  });

  const snapshotMap = new Map();
  for (const snapshot of snapshots) {
    const current = snapshotMap.get(snapshot.siteId);
    if (!current || snapshot.fetchedAt > current.fetchedAt) {
      snapshotMap.set(snapshot.siteId, snapshot);
    }
  }

  return snapshotMap;
}

function buildSiteListResponse(sites, snapshotMap) {
  return sites.map(site => {
    const latestSnapshot = snapshotMap.get(site.id);
    return {
      ...site,
      billingLimit: latestSnapshot?.billingLimit ?? null,
      billingUsage: latestSnapshot?.billingUsage ?? null,
      billingError: latestSnapshot?.billingError ?? null,
      checkInSuccess: latestSnapshot?.checkInSuccess ?? null,
      checkInMessage: latestSnapshot?.checkInMessage ?? null,
      checkInError: latestSnapshot?.checkInError ?? null,
      _modelsJson: latestSnapshot?.modelsJson || '[]'
    };
  });
}

function buildCategoryExportData(categories) {
  return categories.map(category => ({
    name: category.name,
    scheduleCron: category.scheduleCron,
    timezone: category.timezone
  }));
}

function buildSiteExportData(sites) {
  return sites.map(site => {
    const { apiKeyEnc, billingAuthValue, proxyUrlEnc, categoryId, category, ...siteData } = site;
    return {
      ...siteData,
      apiKey: apiKeyEnc ? decrypt(apiKeyEnc) : null,
      billingAuthValue: billingAuthValue ? decrypt(billingAuthValue) : null,
      proxyUrl: proxyUrlEnc ? decrypt(proxyUrlEnc) : null,
      categoryName: category ? category.name : null
    };
  });
}

async function routes(fastify) {
  await fastify.register(authPlugin);

  fastify.addHook('onRequest', async (request, reply) => {
    if (process.env.SKIP_AUTH === 'true') return;
    if (request.url.startsWith('/api/auth/')) return;
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.code(401).send({ error: '未授权访问，请重新登录' });
    }
  });

  fastify.get('/api/sites', async (request) => {
    const { search } = request.query || {};

    const sites = await prisma.site.findMany({
      orderBy: SITE_LIST_ORDER,
      select: SITE_LIST_SELECT
    });
    const snapshotMap = await getLatestSuccessfulSnapshots(sites.map(site => site.id));
    const sitesWithBilling = buildSiteListResponse(sites, snapshotMap);

    // 如果有搜索关键词，进行过滤
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      return sitesWithBilling
        .filter(site => siteMatchesSearch(site, searchLower))
        .map(stripSiteSearchModels);
    }

    return sitesWithBilling.map(stripSiteSearchModels);
  });

  // 导出站点（必须在 /api/sites/:id 之前）
  fastify.get('/api/sites/export', async (request, reply) => {
    try {
      const [sites, categories] = await Promise.all([
        prisma.site.findMany({
          orderBy: SITE_LIST_ORDER,
          include: { category: true }
        }),
        prisma.category.findMany({
          orderBy: { createdAt: 'asc' }
        })
      ]);

      return {
        version: '1.2',
        exportDate: new Date().toISOString(),
        categories: buildCategoryExportData(categories),
        sites: buildSiteExportData(sites)
      };
    } catch (e) {
      fastify.log.error(e);
      reply.code(500);
      return { error: '导出失败: ' + e.message };
    }
  });

  // 导出站点别名，避免与 /api/sites/:id 动态路由潜在冲突
  fastify.get('/api/exports/sites', async (request, reply) => {
    try {
      const [sites, categories] = await Promise.all([
        prisma.site.findMany({
          orderBy: SITE_LIST_ORDER,
          include: { category: true }
        }),
        prisma.category.findMany({
          orderBy: { createdAt: 'asc' }
        })
      ]);

      return {
        version: '1.2',
        exportDate: new Date().toISOString(),
        categories: buildCategoryExportData(categories),
        sites: buildSiteExportData(sites)
      };
    } catch (e) {
      fastify.log.error(e);
      reply.code(500);
      return { error: '导出失败: ' + e.message };
    }
  });

  // 导入站点（必须在 /api/sites/:id 之前）
  fastify.post('/api/sites/import', {
    schema: {
      body: {
        type: 'object',
        required: ['sites'],
        properties: {
          version: { type: 'string' },
          exportDate: { type: 'string' },
          categories: { type: 'array' },
          sites: { type: 'array' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { sites, categories: importedCategories = [] } = request.body;
      
      if (!Array.isArray(sites) || sites.length === 0) {
        reply.code(400);
        return { error: '无效的导入数据' };
      }
      
      let imported = 0;
      const errors = [];
      
      // 先获取所有分类，用于匹配和恢复分类
      const existingCategories = await prisma.category.findMany();
      const categoryMap = new Map(existingCategories.map(c => [c.name, c.id]));
      const importedCategoryMap = new Map(
        Array.isArray(importedCategories)
          ? importedCategories
              .filter(category => category && typeof category.name === 'string' && category.name.trim())
              .map(category => [category.name.trim(), category])
          : []
      );
      const { scheduleCategory } = require('./scheduler');

      const ensureCategory = async (categoryName) => {
        if (!categoryName || typeof categoryName !== 'string') {
          return null;
        }

        const normalizedCategoryName = categoryName.trim();
        if (!normalizedCategoryName) {
          return null;
        }

        if (categoryMap.has(normalizedCategoryName)) {
          return categoryMap.get(normalizedCategoryName);
        }

        const importedCategory = importedCategoryMap.get(normalizedCategoryName);
        const createdCategory = await prisma.category.create({
          data: {
            name: normalizedCategoryName,
            scheduleCron: importedCategory?.scheduleCron ?? null,
            timezone: importedCategory?.timezone || 'Asia/Shanghai'
          }
        });

        categoryMap.set(createdCategory.name, createdCategory.id);
        await scheduleCategory(createdCategory, fastify);
        return createdCategory.id;
      };

      for (const category of importedCategoryMap.values()) {
        await ensureCategory(category.name);
      }
      
      for (const siteData of sites) {
        try {
          const { 
            id, createdAt, updatedAt, apiKey, categoryName, category,
            name, baseUrl, apiType = 'other', userId = null,
            scheduleCron = null, timezone = 'UTC', pinned = false, excludeFromBatch = false,
            billingUrl = null, billingAuthType = 'token', billingAuthValue = null,
            proxyUrl = null,
            billingLimitField = null, billingUsageField = null, unlimitedQuota = false,
            enableCheckIn = false, checkInMode = 'both'
          } = siteData;
          
          if (!name || !baseUrl || !apiKey) {
            errors.push(`站点 ${name || '未知'} 缺少必要字段`);
            continue;
          }
          
          const resolvedCategoryName = categoryName || category?.name || null;
          const categoryId = await ensureCategory(resolvedCategoryName);
          
          // 加密敏感信息
          const apiKeyEnc = encrypt(apiKey);
          let billingAuthValueEnc = null;
          if (billingAuthValue) {
            billingAuthValueEnc = encrypt(billingAuthValue);
          }
          const proxyUrlEnc = encryptProxyUrl(proxyUrl);

          // 创建站点
          const site = await prisma.site.create({
            data: {
              name, baseUrl, apiKeyEnc, apiType, userId, scheduleCron, timezone, pinned, excludeFromBatch,
              categoryId,
              billingUrl, billingAuthType, billingAuthValue: billingAuthValueEnc,
              proxyUrlEnc,
              billingLimitField, billingUsageField, unlimitedQuota,
              enableCheckIn, checkInMode
            }
          });
          
          onSiteUpdated(site, fastify);
          imported++;
        } catch (e) {
          errors.push(`站点 ${siteData.name || '未知'} 导入失败: ${e.message}`);
        }
      }
      
      if (errors.length > 0) {
        fastify.log.warn({ errors }, 'Import completed with errors');
      }
      
      return {
        imported,
        total: sites.length,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (e) {
      fastify.log.error(e);
      reply.code(500);
      return { error: '导入失败: ' + e.message };
    }
  });

  fastify.post('/api/sites', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'baseUrl', 'apiKey'],
        properties: {
          name: { type: 'string', minLength: 1 },
          baseUrl: { type: 'string', minLength: 1 },
          apiKey: { type: 'string', minLength: 1 },
          apiType: { type: 'string', enum: ['newapi', 'veloera', 'donehub', 'voapi', 'other'] },
          userId: { type: 'string' },
          scheduleCron: { type: 'string' },
          timezone: { type: 'string' },
          pinned: { type: 'boolean' },
          excludeFromBatch: { type: 'boolean' },
          categoryId: { type: 'string' },
          billingUrl: { type: 'string' },
          billingAuthType: { type: 'string', enum: ['token', 'cookie'] },
          billingAuthValue: { type: 'string' },
          proxyUrl: { type: 'string' },
          billingLimitField: { type: 'string' },
          billingUsageField: { type: 'string' },
          unlimitedQuota: { type: 'boolean' },
          enableCheckIn: { type: 'boolean' },
          checkInMode: { type: 'string', enum: ['model', 'checkin', 'both'] },
          extralink: { type: 'string' },
          remark: { type: 'string' },
          sortOrder: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const {
        name, baseUrl, apiKey, apiType = 'other', userId = null,
        scheduleCron = null, timezone = 'UTC', pinned = false, excludeFromBatch = false,
        categoryId = null,
        billingUrl = null, billingAuthType = 'token', billingAuthValue = null,
        proxyUrl = null,
        billingLimitField = null, billingUsageField = null, unlimitedQuota = false,
        enableCheckIn = false, checkInMode = 'both',
        extralink = null, remark = null, sortOrder = 0
      } = request.body;

      const apiKeyEnc = encrypt(apiKey);
      let billingAuthValueEnc = null;
      if (billingAuthValue) {
        billingAuthValueEnc = encrypt(billingAuthValue);
      }

      const site = await prisma.site.create({
        data: {
          name, baseUrl, apiKeyEnc, apiType, userId, scheduleCron, timezone, pinned, excludeFromBatch,
          categoryId: categoryId || null,
          billingUrl, billingAuthType, billingAuthValue: billingAuthValueEnc,
          proxyUrlEnc: encryptProxyUrl(proxyUrl),
          billingLimitField, billingUsageField, unlimitedQuota,
          enableCheckIn, checkInMode,
          extralink, remark, sortOrder
        }
      });
      onSiteUpdated(site, fastify);
      const { apiKeyEnc: _, billingAuthValue: __, proxyUrlEnc, ...rest } = site;
      return rest;
    } catch (error) {
      fastify.log.error({ error, body: request.body }, 'Failed to create site');
      reply.code(error.statusCode || 500);
      return { error: error.message || '创建站点失败' };
    }
  });

  fastify.patch('/api/sites/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          baseUrl: { type: 'string' },
          apiKey: { type: 'string' },
          apiType: { type: 'string', enum: ['newapi', 'veloera', 'donehub', 'voapi', 'other'] },
          userId: { type: 'string' },
          scheduleCron: { type: 'string' },
          timezone: { type: 'string' },
          pinned: { type: 'boolean' },
          excludeFromBatch: { type: 'boolean' },
          categoryId: { type: 'string' },
          billingUrl: { type: 'string' },
          billingAuthType: { type: 'string', enum: ['token', 'cookie'] },
          billingAuthValue: { type: 'string' },
          proxyUrl: { type: 'string' },
          billingLimitField: { type: 'string' },
          billingUsageField: { type: 'string' },
          unlimitedQuota: { type: 'boolean' },
          enableCheckIn: { type: 'boolean' },
          checkInMode: { type: 'string', enum: ['model', 'checkin', 'both'] },
          extralink: { type: 'string' },
          remark: { type: 'string' },
          sortOrder: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const data = {};
    const {
      name, baseUrl, apiKey, apiType, userId, scheduleCron, timezone, pinned, excludeFromBatch,
      categoryId,
      billingUrl, billingAuthType, billingAuthValue, proxyUrl, billingLimitField, billingUsageField, unlimitedQuota,
      enableCheckIn, checkInMode,
      extralink, remark, sortOrder
    } = request.body || {};
    
    try {
      if (name) data.name = name;
      if (baseUrl) data.baseUrl = baseUrl;
      if (apiType) data.apiType = apiType;
      if (userId !== undefined) data.userId = userId;
      if (scheduleCron !== undefined) data.scheduleCron = scheduleCron;
      if (timezone) data.timezone = timezone;
      // 确保布尔字段总是被处理，即使值为false
      if ('pinned' in request.body) data.pinned = Boolean(pinned);
      if ('excludeFromBatch' in request.body) data.excludeFromBatch = Boolean(excludeFromBatch);
      if ('unlimitedQuota' in request.body) data.unlimitedQuota = Boolean(unlimitedQuota);
      if ('enableCheckIn' in request.body) data.enableCheckIn = Boolean(enableCheckIn);
      if (categoryId !== undefined) data.categoryId = categoryId || null;
      if ('sortOrder' in request.body) data.sortOrder = Number(sortOrder) || 0;
      if (billingUrl !== undefined) data.billingUrl = billingUrl;
      if (billingAuthType !== undefined) data.billingAuthType = billingAuthType;
      if (billingAuthValue !== undefined) {
        data.billingAuthValue = billingAuthValue ? encrypt(billingAuthValue) : null;
      }
      if (proxyUrl !== undefined) data.proxyUrlEnc = encryptProxyUrl(proxyUrl);
      if (billingLimitField !== undefined) data.billingLimitField = billingLimitField;
      if (billingUsageField !== undefined) data.billingUsageField = billingUsageField;
      if (checkInMode) data.checkInMode = checkInMode;
      if (apiKey) data.apiKeyEnc = encrypt(apiKey);
      if (extralink !== undefined) data.extralink = extralink;
      if (remark !== undefined) data.remark = remark;
      
      fastify.log.info({ updateData: data }, 'Updating site');
      
      const site = await prisma.site.update({ where: { id }, data });
      
      // 如果站点的分类或计划信息有变化，重新调度
      const { scheduleAll } = require('./scheduler');
      if (data.categoryId !== undefined || data.scheduleCron !== undefined) {
        await scheduleAll(fastify); // 重新调度所有任务
      } else {
        // 否则只更新当前站点的调度
        const { onSiteUpdated } = require('./scheduler');
        onSiteUpdated(site, fastify);
      }
      
      const { apiKeyEnc: _, billingAuthValue: __, proxyUrlEnc, ...rest } = site;
      return rest;
    } catch (error) {
      fastify.log.error({ error, id, body: request.body }, 'Failed to update site');
      reply.code(error.statusCode || 500);
      return { error: error.message || '更新站点失败' };
    }
  });

  fastify.delete('/api/sites/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  }, async (request) => {
    const { id } = request.params;
    await prisma.$transaction([
      prisma.modelDiff.deleteMany({ where: { siteId: id } }),
      prisma.modelSnapshot.deleteMany({ where: { siteId: id } }),
      prisma.site.delete({ where: { id } })
    ]);
    onSiteDeleted(id, fastify);
    return { ok: true };
  });

  // 批量更新站点排序
  fastify.post('/api/sites/reorder', {
    schema: {
      body: {
        type: 'object',
        required: ['orders'],
        properties: {
          orders: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'sortOrder'],
              properties: {
                id: { type: 'string' },
                sortOrder: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { orders } = request.body;
    try {
      await Promise.all(
        orders.map(({ id, sortOrder }) =>
          prisma.site.update({ where: { id }, data: { sortOrder } })
        )
      );
      return { ok: true };
    } catch (e) {
      fastify.log.error(e);
      reply.code(500);
      return { error: '更新排序失败: ' + e.message };
    }
  });

  fastify.post('/api/sites/:id/check', {
    schema: { 
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: { type: 'object', properties: { skipNotification: { type: 'string' } } }
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const skipNotification = request.query?.skipNotification === 'true';
    try {
      const result = await checkSiteById(id, fastify, { skipNotification, isManual: true });
      return { ok: true, message: '检测成功', ...result };
    } catch (e) {
      reply.code(500);
      return { ok: false, error: `检测失败：${e.message}` };
    }
  });

  fastify.get('/api/sites/:id/pricing', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { decrypt } = require('./crypto');
    
    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }

      if (site.apiType !== 'newapi' && site.apiType !== 'veloera' && site.apiType !== 'donehub' && site.apiType !== 'voapi') {
        reply.code(400);
        return { error: '此站点类型不支持pricing接口' };
      }
      
      const baseUrl = site.baseUrl.replace(/\/$/, '');
      let url, headers, token;
      
      if (site.apiType === 'donehub') {
        token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
        if (!token) {
          reply.code(400);
          return { error: '站点未配置API令牌' };
        }
        url = `${baseUrl}/api/available_model`;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };
      } else if (site.apiType === 'voapi') {
        token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
        if (!token) {
          reply.code(400);
          return { error: '站点未配置VOAPI API密钥' };
        }
        url = `${baseUrl}/api/models`;
        headers = {
          'Authorization': token,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        };
      } else {
        token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
        if (!token) {
          reply.code(400);
          return { error: '站点未配置API令牌' };
        }
        url = `${baseUrl}/api/pricing`;
        headers = {
          'Content-Type': 'application/json'
        };
        if (site.userId) {
          const userHeader = site.apiType === 'newapi' ? 'New-Api-User' : 'Veloera-User';
          headers[userHeader] = site.userId;
        }
      }
      
      const res = await siteFetch(site, url, {
        method: 'GET',
        headers
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || '获取pricing信息失败');
      }
      
      return data;
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id }, 'Error fetching pricing');
      reply.code(500);
      return { error: e.message || '获取pricing信息失败' };
    }
  });

  fastify.get('/api/sites/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    
    try {
      const site = await prisma.site.findUnique({
        where: { id },
        include: { category: true }
      });
      
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }
      
      return getSiteDetailResponse(site, fastify);
    } catch (e) {
      fastify.log.error({ error: e.message }, 'Error fetching site');
      reply.code(500);
      return { error: '获取站点信息失败' };
    }
  });

  // 代理获取站点令牌列表（避免跨域问题）
  fastify.get('/api/sites/:id/tokens', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { decrypt } = require('./crypto');
    
    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }
      
      const baseUrl = site.baseUrl.replace(/\/$/, '');
      let url, headers;
      
      if (site.apiType === 'voapi') {
        // VOAPI 使用 API key 和 /api/keys 端点
        const voapiKey = getVoapiApiKey(site);
        if (!voapiKey) {
          reply.code(400);
          return { error: 'VOAPI站点未配置API密钥' };
        }
        
        url = `${baseUrl}/api/keys`;
        headers = {
          'Authorization': voapiKey,
          'Content-Type': 'application/json'
        };
        
        const res = await siteFetch(site, url, { headers });
        const data = await res.json();
        
        if (!res.ok || data.code !== 0) {
          throw new Error(data.message || '获取令牌列表失败');
        }
        
        // 转换VOAPI数据格式为统一格式
        const records = data.data?.records || [];
        const convertedData = records.map(record => ({
          id: record.id,
          name: record.name,
          key: normalizeManagedTokenKey(record.token),
          group: record.groups && record.groups.length > 0 ? String(record.groups[0]) : '',
          expired_time: record.expireTime === 4102329600000 ? -1 : Math.floor(record.expireTime / 1000),
          unlimited_quota: record.boundlessAmount,
          remain_quota: record.boundlessAmount ? 0 : Math.floor(parseFloat(record.amount) * 500000),
          used_quota: Math.floor(parseFloat(record.used) * 500000),
          status: record.enable ? 1 : 0,
          created_time: Math.floor(record.created / 1000),
          accessed_time: Math.floor(record.updated / 1000),
          uid: record.uid
        }));
        
        return {
          success: true,
          data: convertedData
        };
      } else {
        // newapi, veloera, donehub 使用原有逻辑
        const token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
        if (!token) {
          reply.code(400);
          return { error: '站点未配置API令牌' };
        }

        url = `${baseUrl}/api/token/`;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };

        if (site.userId) {
          if (site.apiType === 'newapi') {
            headers['New-Api-User'] = site.userId;
          } else if (site.apiType === 'veloera') {
            headers['Veloera-User'] = site.userId;
          }
        }

        const res = await siteFetch(site, url, { headers });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || '获取令牌列表失败');
        }

        return normalizeManagedTokenResponse(data);
      }
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id }, 'Error fetching tokens');
      reply.code(500);
      return { error: e.message || '获取令牌列表失败' };
    }
  });

  fastify.post('/api/sites/:id/tokens/:tokenId/key', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tokenId: { type: 'string' }
        },
        required: ['id', 'tokenId']
      }
    }
  }, async (request, reply) => {
    const { id, tokenId } = request.params;

    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }

      if (site.apiType === 'voapi') {
        reply.code(400);
        return { error: '当前站点类型不需要单独获取完整令牌' };
      }

      const token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
      if (!token) {
        reply.code(400);
        return { error: '站点未配置API令牌' };
      }

      const baseUrl = site.baseUrl.replace(/\/$/, '');
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Cache-Control': 'no-store',
        'Origin': baseUrl,
        'Referer': `${baseUrl}/console/token`
      };

      if (site.userId) {
        if (site.apiType === 'newapi') {
          headers['New-Api-User'] = site.userId;
        } else if (site.apiType === 'veloera') {
          headers['Veloera-User'] = site.userId;
        }
      }

      const res = await siteFetch(site, `${baseUrl}/api/token/${tokenId}/key`, {
        method: 'POST',
        headers,
        body: ''
      });
      const data = await res.json();

      if (!res.ok || data.success === false) {
        throw new Error(`获取完整令牌失败: ${data.error || data.message || `HTTP ${res.status}`}`);
      }

      const fullKey = data?.data?.key || data?.key;
      if (!fullKey) {
        throw new Error('获取完整令牌失败');
      }

      return {
        success: true,
        data: {
          key: normalizeManagedTokenKey(fullKey)
        }
      };
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id, tokenId }, 'Error fetching token key');
      reply.code(500);
      return { error: e.message || '获取完整令牌失败' };
    }
  });
  
  // 代理获取站点分组列表
  fastify.get('/api/sites/:id/groups', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    
    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }
      
      const baseUrl = site.baseUrl.replace(/\/$/, '');
      let url = '';
      let headers;

      if (site.apiType === 'voapi') {
        const voapiKey = getVoapiApiKey(site);
        if (!voapiKey) {
          reply.code(400);
          return { error: 'VOAPI站点未配置API密钥' };
        }

        url = `${baseUrl}/api/models`;
        headers = {
          'Authorization': voapiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };
      } else {
        const token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
        if (!token) {
          reply.code(400);
          return { error: '站点未配置API令牌' };
        }

        if (site.apiType === 'donehub') {
          url = `${baseUrl}/api/user_group_map`;
        } else {
          url = `${baseUrl}/api/user/self/groups`;
        }
        
        headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };
        if (site.userId) {
          // 不同站点类型使用不同的用户ID请求头
          if (site.apiType === 'newapi') {
            headers['New-Api-User'] = site.userId;
          } else if (site.apiType === 'veloera') {
            headers['Veloera-User'] = site.userId;
          }
        }
      }
      
      const res = await siteFetch(site, url, { headers });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || '获取分组列表失败');
      }

      if (site.apiType === 'voapi') {
        if (data.code !== 0 || !data.data) {
          throw new Error(data.message || '获取分组列表失败');
        }

        const groups = data.data.groups || [];
        const normalizedGroups = {};
        for (const group of groups) {
          normalizedGroups[String(group.id)] = {
            name: group.name || `分组${group.id}`,
            desc: group.name || `分组${group.id}`
          };
        }

        return {
          success: true,
          data: normalizedGroups
        };
      }

      return data;
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id }, 'Error fetching groups');
      reply.code(500);
      return { error: e.message || '获取分组列表失败' };
    }
  });
  
  // 代理创建站点令牌
  fastify.post('/api/sites/:id/tokens', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { type: 'object' }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const tokenData = request.body;
    
    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }
      
      const token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
      if (!token) {
        reply.code(400);
        return { error: '站点未配置API令牌' };
      }
      
      const baseUrl = site.baseUrl.replace(/\/$/, '');
      let url, headers, payload;
      
      if (site.apiType === 'voapi') {
        // VOAPI 使用 API key
        const voapiKey = getVoapiApiKey(site);
        if (!voapiKey) {
          reply.code(400);
          return { error: 'VOAPI站点未配置API密钥' };
        }
        
        url = `${baseUrl}/api/keys`;
        headers = {
          'Authorization': voapiKey,
          'Content-Type': 'application/json'
        };
        
        // VOAPI的负载格式
        payload = {
          name: tokenData.name || 'key-' + Date.now(),
          amount: tokenData.remainQuota ? String(tokenData.remainQuota / 500000) : '0',
          boundlessAmount: tokenData.unlimitedQuota !== undefined ? tokenData.unlimitedQuota : false,
          enable: true,
          expireTime: tokenData.expiredTime === -1 ? 4102329600000 : (tokenData.expiredTime * 1000),
          genCount: 1,
          groups: tokenData.groups || [1]
        };
      } else if (site.apiType === 'donehub') {
        // DoneHub的负载格式
        url = `${baseUrl}/api/token/`;
        headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
        
        payload = {
          name: tokenData.name || '',
          remain_quota: tokenData.unlimitedQuota ? 0 : (tokenData.remainQuota || 0),
          unlimited_quota: tokenData.unlimitedQuota !== undefined ? tokenData.unlimitedQuota : false,
          group: tokenData.group || '',
          expired_time: tokenData.expiredTime !== undefined ? tokenData.expiredTime : -1,
          is_edit: false,
          setting: {
            heartbeat: {
              enabled: false,
              timeout_seconds: 30
            }
          }
        };
      } else {
        // newapi 和 veloera的负载格式
        url = `${baseUrl}/api/token/`;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };
        
      if (site.userId) {
        if (site.apiType === 'newapi') {
          headers['New-Api-User'] = site.userId;
        } else if (site.apiType === 'veloera') {
          headers['Veloera-User'] = site.userId;
        }
        }
        
        payload = {
          name: tokenData.name || '',
          remain_quota: tokenData.unlimitedQuota ? 0 : (tokenData.remainQuota || 0),
          unlimited_quota: tokenData.unlimitedQuota !== undefined ? tokenData.unlimitedQuota : false,
          group: tokenData.group || '',
          expired_time: tokenData.expiredTime !== undefined ? tokenData.expiredTime : -1,
          model_limits_enabled: tokenData.modelLimitsEnabled || false,
          model_limits: tokenData.modelLimits || '',
          allow_ips: tokenData.allowIps || ''
        };
      }
      
      const res = await siteFetch(site, url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || '创建令牌失败');
      }
      
      // VOAPI返回格式转换
      if (site.apiType === 'voapi') {
        if (data.code === 0) {
          return { success: true, message: '创建成功' };
        } else {
          throw new Error(data.message || '创建令牌失败');
        }
      }
      
      return data;
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id }, 'Error creating token');
      reply.code(500);
      return { error: e.message || '创建令牌失败' };
    }
  });
  
  // 代理更新站点令牌
  fastify.put('/api/sites/:id/tokens', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { type: 'object' }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const tokenData = request.body;
    
    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }
      
      const baseUrl = site.baseUrl.replace(/\/$/, '');
      let url, headers, payload;
      
      if (site.apiType === 'voapi') {
        // VOAPI 使用 API key 和 /api/keys/:id 端点
        const voapiKey = getVoapiApiKey(site);
        if (!voapiKey) {
          reply.code(400);
          return { error: 'VOAPI站点未配置API密钥' };
        }
        
        url = `${baseUrl}/api/keys/${tokenData.id}`;
        headers = {
          'Authorization': voapiKey,
          'Content-Type': 'application/json'
        };
        
        // 转换为VOAPI格式
        const groupValue = tokenData.group || '';
        payload = {
          name: tokenData.name,
          amount: tokenData.unlimited_quota ? "0" : String(tokenData.remain_quota / 500000),
          boundlessAmount: tokenData.unlimited_quota,
          enable: true,
          expireTime: tokenData.expired_time === -1 ? 4102329600000 : (tokenData.expired_time * 1000),
          groups: groupValue ? [parseInt(groupValue)] : [1],
          token: serializeManagedTokenKey(tokenData.key),
          uid: tokenData.uid || 0,
          used: tokenData.used_quota ? String(tokenData.used_quota / 500000) : "0"
        };
      } else {
        // newapi, veloera, donehub 使用原有逻辑
        const token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
        if (!token) {
          reply.code(400);
          return { error: '站点未配置API令牌' };
        }
        
        url = `${baseUrl}/api/token/`;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };
        
        if (site.userId) {
          if (site.apiType === 'newapi') {
            headers['New-Api-User'] = site.userId;
          } else if (site.apiType === 'veloera') {
            headers['Veloera-User'] = site.userId;
          }
        }
        
        payload = serializeManagedTokenPayload(tokenData);
      }
      
      const res = await siteFetch(site, url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || '更新令牌失败');
      }
      
      // VOAPI返回格式转换
      if (site.apiType === 'voapi') {
        if (data.code === 0) {
          return { success: true, message: '更新成功' };
        } else {
          throw new Error(data.message || '更新令牌失败');
        }
      }
      
      return data;
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id }, 'Error updating token');
      reply.code(500);
      return { error: e.message || '更新令牌失败' };
    }
  });
  
  // 代理删除站点令牌
  fastify.delete('/api/sites/:id/tokens/:tokenId', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' }, tokenId: { type: 'number' } }, required: ['id', 'tokenId'] }
    }
  }, async (request, reply) => {
    const { id, tokenId } = request.params;
    
    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }
      
      const baseUrl = site.baseUrl.replace(/\/$/, '');
      let url, headers;
      
      if (site.apiType === 'voapi') {
        // VOAPI 使用 API key 和 /api/keys/:id 端点
        const voapiKey = getVoapiApiKey(site);
        if (!voapiKey) {
          reply.code(400);
          return { error: 'VOAPI站点未配置API密钥' };
        }
        
        url = `${baseUrl}/api/keys/${tokenId}`;
        headers = {
          'Authorization': voapiKey,
          'Content-Type': 'application/json'
        };
      } else {
        // newapi, veloera, donehub 使用原有逻辑
        const token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
        if (!token) {
          reply.code(400);
          return { error: '站点未配置API令牌' };
        }

        url = `${baseUrl}/api/token/${tokenId}`;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };

        if (site.userId) {
          if (site.apiType === 'newapi') {
            headers['New-Api-User'] = site.userId;
          } else if (site.apiType === 'veloera') {
            headers['Veloera-User'] = site.userId;
          }
        }
      }
      
      const res = await siteFetch(site, url, {
        method: 'DELETE',
        headers
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || '删除令牌失败');
      }
      
      // VOAPI返回格式转换
      if (site.apiType === 'voapi') {
        if (data.code === 0) {
          return { success: true, message: '删除成功' };
        } else {
          throw new Error(data.message || '删除令牌失败');
        }
      }
      
      return data;
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id, tokenId }, 'Error deleting token');
      reply.code(500);
      return { error: e.message || '删除令牌失败' };
    }
  });

  // 代理兑换码请求
  fastify.post('/api/sites/:id/redeem', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const { key } = request.body;
    
    try {
      const site = await prisma.site.findUnique({ where: { id } });
      if (!site) {
        reply.code(404);
        return { error: '站点不存在' };
      }
      
      const token = site.apiKeyEnc ? decrypt(site.apiKeyEnc) : null;
      if (!token) {
        reply.code(400);
        return { error: '站点未配置API令牌' };
      }
      
      const baseUrl = site.baseUrl.replace(/\/$/, '');
      const url = `${baseUrl}/api/user/topup`;
      
      const headers = site.apiType === 'voapi'
        ? {
            'Authorization': token,
            'Content-Type': 'application/json'
          }
        : {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          };
      if (site.userId) {
        if (site.apiType === 'newapi') {
          headers['New-Api-User'] = site.userId;
        } else if (site.apiType === 'veloera') {
          headers['Veloera-User'] = site.userId;
        }
      }
      
      const res = await siteFetch(site, url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ key })
      });
      const data = await res.json();
      
      return data;
    } catch (e) {
      fastify.log.error({ error: e.message, siteId: id, key }, 'Error redeeming code');
      reply.code(500);
      return { success: false, message: e.message || '兑换请求失败' };
    }
  });

  fastify.get('/api/sites/:id/diffs', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: { type: 'object', properties: { limit: { type: 'number' } } },
    },
  }, async (request) => {
    const { id } = request.params;
    const limit = Number(request.query?.limit || 50);
    const diffs = await prisma.modelDiff.findMany({ where: { siteId: id }, orderBy: { diffAt: 'desc' }, take: limit });
    return diffs.map(d => ({
      ...d,
      addedJson: safeParse(d.addedJson, []),
      removedJson: safeParse(d.removedJson, []),
      changedJson: safeParse(d.changedJson, []),
    }));
  });

  fastify.get('/api/sites/:id/snapshots', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: { type: 'object', properties: { limit: { type: 'number' } } },
    },
  }, async (request) => {
    const { id } = request.params;
    const limit = Number(request.query?.limit || 1);
    // 只返回成功的快照（用于显示当前模型列表）
    const snaps = await prisma.modelSnapshot.findMany({ 
      where: { siteId: id, errorMessage: null }, 
      orderBy: { fetchedAt: 'desc' }, 
      take: limit 
    });
    return snaps.map(s => ({ ...s, modelsJson: safeParse(s.modelsJson, []) }));
  });

  fastify.get('/api/sites/:id/latest-snapshot', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (request) => {
    const { id } = request.params;
    const snap = await prisma.modelSnapshot.findFirst({
      where: { siteId: id },
      orderBy: { fetchedAt: 'desc' }
    });
    if (!snap) {
      return { error: '暂无快照数据' };
    }
    return {
      ...snap,
      modelsJson: safeParse(snap.modelsJson, [])
    };
  });

  // 邮件通知配置 API
  fastify.get('/api/email-config', async () => {
    const config = await prisma.emailConfig.findFirst();
    if (!config) {
      return { enabled: false, notifyEmails: '', resendApiKeyEnc: null };
    }
    // 不返回加密的 API Key，只返回配置状态
    const { resendApiKeyEnc, ...rest } = config;
    return rest;
  });

  fastify.post('/api/email-config', {
    schema: {
      body: {
        type: 'object',
        required: ['resendApiKey', 'notifyEmails'],
        properties: {
          resendApiKey: { type: 'string', minLength: 1 },
          notifyEmails: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { resendApiKey, notifyEmails, enabled = true } = request.body;
    
    // 验证邮箱格式
    const emails = notifyEmails.split(',').map(e => e.trim()).filter(Boolean);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of emails) {
      if (!emailRegex.test(email)) {
        return reply.code(400).send({ error: `邮箱格式不正确：${email}` });
      }
    }
    
    // 加密 API Key
    const resendApiKeyEnc = encrypt(resendApiKey);
    
    // 检查是否已存在配置
    const existing = await prisma.emailConfig.findFirst();
    
    let config;
    if (existing) {
      // 更新现有配置
      config = await prisma.emailConfig.update({
        where: { id: existing.id },
        data: { resendApiKeyEnc, notifyEmails, enabled }
      });
    } else {
      // 创建新配置
      config = await prisma.emailConfig.create({
        data: { resendApiKeyEnc, notifyEmails, enabled }
      });
    }
    
    const { resendApiKeyEnc: _, ...rest } = config;
    return rest;
  });

  // 定时检测配置路由
  fastify.get('/api/schedule-config', getScheduleConfigHandler);
  
  fastify.post('/api/schedule-config', {
    schema: {
      body: {
        type: 'object',
        required: ['enabled', 'hour', 'minute', 'interval'],
        properties: {
          enabled: { type: 'boolean' },
          hour: { type: 'number', minimum: 0, maximum: 23 },
          minute: { type: 'number', minimum: 0, maximum: 59 },
          interval: { type: 'number', minimum: 10, maximum: 300 },
          overrideIndividual: { type: 'boolean' }
        }
      }
    }
  }, updateScheduleConfigHandler);

  // 分类管理路由
  fastify.get('/api/categories', async () => {
    const categories = await prisma.category.findMany({ 
      orderBy: { createdAt: 'asc' },
      include: { sites: true }
    });
    return categories;
  });

  fastify.post('/api/categories', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          scheduleCron: { type: 'string' },
          timezone: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { name, scheduleCron = null, timezone = 'Asia/Shanghai' } = request.body;
    
    try {
      const category = await prisma.category.create({
        data: { name, scheduleCron, timezone }
      });
      
      // 调度新的分类定时任务
      const { scheduleCategory } = require('./scheduler');
      await scheduleCategory(category, fastify);
      
      return category;
    } catch (e) {
      if (e.code === 'P2002') {
        return reply.code(400).send({ error: '分类名称已存在' });
      }
      throw e;
    }
  });

  fastify.patch('/api/categories/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          scheduleCron: { type: 'string' },
          timezone: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const data = {};
    const { name, scheduleCron, timezone } = request.body || {};
    
    if (name) data.name = name;
    if (scheduleCron !== undefined) data.scheduleCron = scheduleCron;
    if (timezone) data.timezone = timezone;
    
    try {
      const category = await prisma.category.update({ where: { id }, data });
      
      // 更新分类的定时任务
      const { scheduleCategory } = require('./scheduler');
      await scheduleCategory(category, fastify);
      
      return category;
    } catch (e) {
      if (e.code === 'P2002') {
        return reply.code(400).send({ error: '分类名称已存在' });
      }
      if (e.code === 'P2025') {
        return reply.code(404).send({ error: '分类不存在' });
      }
      throw e;
    }
  });

  fastify.delete('/api/categories/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  }, async (request, reply) => {
    const { id } = request.params;
    
    try {
      // 停止该分类的定时任务
      const { categoryJobs } = require('./scheduler');
      const jobKey = `cat_${id}`;
      if (categoryJobs && categoryJobs.has(jobKey)) {
        categoryJobs.get(jobKey).stop();
        categoryJobs.delete(jobKey);
      }
      
      // 将该分类下的所有站点的categoryId设为null（归入未分类）
      await prisma.site.updateMany({
        where: { categoryId: id },
        data: { categoryId: null }
      });
      
      // 删除分类
      await prisma.category.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      if (e.code === 'P2025') {
        return reply.code(404).send({ error: '分类不存在' });
      }
      throw e;
    }
  });

  // 分类一键检测
  fastify.post('/api/categories/:id/check', {
    schema: { 
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: { type: 'object', properties: { skipNotification: { type: 'string' } } }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    const skipNotification = request.query?.skipNotification === 'true';
    
    // 获取该分类下的所有站点（不包括置顶和排除一键检测的站点）
    const sites = await prisma.site.findMany({
      where: { 
        categoryId: id,
        pinned: false,
        excludeFromBatch: false
      }
    });
    
    if (sites.length === 0) {
      return reply.code(400).send({ error: '该分类下没有可检测的站点' });
    }
    
    const results = {
      changes: [],
      failures: [],
      totalSites: sites.length
    };
    
    // 依次检测每个站点（5秒间隔）
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      try {
        const result = await checkSiteById(site.id, fastify, { skipNotification, isManual: true });
        if (result.hasChanges && result.diff) {
          results.changes.push({
            siteName: site.name,
            diff: result.diff
          });
        }
      } catch (e) {
        results.failures.push({
          siteName: site.name,
          error: e.message || '检测失败'
        });
      }
      
      // 如果不是最后一个站点，等待5秒
      if (i < sites.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    return { ok: true, results };
  });
}

module.exports = { routes };

// 定时配置处理器
async function getScheduleConfigHandler(request, reply) {
  try {
    let config = await prisma.scheduleConfig.findFirst();
    if (!config) {
      // 创建默认配置
      config = await prisma.scheduleConfig.create({
        data: {
          enabled: false,
          hour: 9,
          minute: 0,
          timezone: 'Asia/Shanghai',
          interval: 30
        }
      });
    }
    return { ok: true, config };
  } catch (error) {
    reply.log.error(error);
    return reply.status(500).send({ ok: false, error: '获取定时配置失败' });
  }
}

async function updateScheduleConfigHandler(request, reply) {
  try {
    const { enabled, hour, minute, interval, overrideIndividual } = request.body;
    
    // 验证参数
    if (typeof enabled !== 'boolean' || 
        typeof hour !== 'number' || hour < 0 || hour > 23 ||
        typeof minute !== 'number' || minute < 0 || minute > 59 ||
        typeof interval !== 'number' || interval < 5 || interval > 300) {
      return reply.status(400).send({ 
        ok: false, 
        error: '参数无效：hour(0-23), minute(0-59), interval(5-300秒)' 
      });
    }

    // 查找现有配置
    let config = await prisma.scheduleConfig.findFirst();
    
    const updateData = { 
      enabled, 
      hour, 
      minute, 
      interval, 
      overrideIndividual: overrideIndividual === true,
      updatedAt: new Date() 
    };
    
    if (config) {
      // 更新现有配置
      config = await prisma.scheduleConfig.update({
        where: { id: config.id },
        data: updateData
      });
    } else {
      // 创建新配置
      config = await prisma.scheduleConfig.create({
        data: { ...updateData, timezone: 'Asia/Shanghai' }
      });
    }

    // 重新配置定时任务
    await scheduleGlobalTask(config, reply.server);

    return { ok: true, config };
  } catch (error) {
    reply.log.error(error);
    return reply.status(500).send({ ok: false, error: '更新定时配置失败' });
  }
}

function safeParse(s, def) {
  try { return JSON.parse(s) } catch (_) { return def }
}
