import { useEffect, useState, memo, useCallback, useMemo, useRef, startTransition } from 'react'
import { Button, Card, Form, Input, Modal, Space, Table, Tag, message, InputNumber, Typography, Popconfirm, TimePicker, Switch, Tooltip, Progress, Select, Collapse, Divider } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { PlusOutlined, EyeOutlined, ThunderboltOutlined, ClockCircleOutlined, GlobalOutlined, EditOutlined, DeleteOutlined, ExclamationCircleOutlined, BugOutlined, MailOutlined, CheckCircleOutlined, PushpinOutlined, PushpinFilled, StopOutlined, DownOutlined, RightOutlined, SearchOutlined, FolderOutlined, AppstoreAddOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

// 添加金光闪闪动画样式和响应式样式
const shimmerStyle = document.createElement('style');
shimmerStyle.textContent = `
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (max-width: 768px) {
  .site-card-mobile { margin-bottom: 12px; }
  .site-card-mobile .ant-card-body { padding: 12px; }
  .mobile-action-btn { padding: 4px 8px; font-size: 12px; }
}
`;
document.head.appendChild(shimmerStyle);

// 自定义 Hook：检测是否为移动端
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= breakpoint);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);
  return isMobile;
}

// 优化的表格组件，避免不必要的重渲染
const TABLE_VIRTUAL_THRESHOLD = 60
const TABLE_VIRTUAL_HEIGHT = 720
const TABLE_TEXT_ELLIPSIS_STYLE = {
  display: 'block',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}
const COMPACT_ACTION_BUTTON_STYLE = {
  width: 34,
  height: 34,
  paddingInline: 0
}

const MemoTable = memo(({ dataSource, columns, loading }) => {
  const enableVirtual = dataSource.length >= TABLE_VIRTUAL_THRESHOLD
  const scrollConfig = enableVirtual
    ? { y: TABLE_VIRTUAL_HEIGHT, scrollToFirstRowOnChange: false }
    : undefined

  return (
    <Table
      rowKey="id"
      dataSource={dataSource}
      columns={columns}
      loading={loading}
      pagination={false}
      tableLayout="fixed"
      virtual={enableVirtual}
      scroll={scrollConfig}
      style={{ borderRadius: '0 0 8px 8px' }}
    />
  )
})

function sortSites(sites) {
  return [...sites].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1
    }

    const sortOrderDiff = (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    if (sortOrderDiff !== 0) {
      return sortOrderDiff
    }

    const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0
    const rightCreatedAt = right.createdAt ? new Date(right.createdAt).getTime() : 0
    return rightCreatedAt - leftCreatedAt
  })
}

function authHeaders(includeJson = false) {
  const t = localStorage.getItem('token');
  const h = { 'Authorization': `Bearer ${t}` };
  if (includeJson) h['Content-Type'] = 'application/json';
  return h;
}

function validateProxyUrl(_, value) {
  if (!value || !String(value).trim()) {
    return Promise.resolve()
  }

  try {
    const parsed = new URL(String(value).trim())
    const supportedProtocols = ['http:', 'https:', 'socks:', 'socks5:']
    if (!supportedProtocols.includes(parsed.protocol)) {
      return Promise.reject(new Error('仅支持 http、https、socks 或 socks5 代理'))
    }
    return Promise.resolve()
  } catch (error) {
    return Promise.reject(new Error('请输入有效的代理 URL'))
  }
}

function copyText(text, successMsg = '复制成功') {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      message.success(successMsg)
    }).catch(() => {
      message.error('复制失败，请手动复制')
    })
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      message.success(successMsg)
    } catch (e) {
      message.error('复制失败，请手动复制')
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

export default function Sites() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editingSite, setEditingSite] = useState(null)
  const [form] = Form.useForm()
  const [timeOpen, setTimeOpen] = useState(false)
  const [timeForm] = Form.useForm()
  const [timeSite, setTimeSite] = useState(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugData, setDebugData] = useState(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const [emailConfigOpen, setEmailConfigOpen] = useState(false)
  const [emailConfigForm] = Form.useForm()
  const [emailConfigData, setEmailConfigData] = useState(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleForm] = Form.useForm()
  const [scheduleConfig, setScheduleConfig] = useState({ enabled: false, hour: 9, minute: 0, interval: 30 })
  const [batchChecking, setBatchChecking] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentSite: '' })
  const [batchResultOpen, setBatchResultOpen] = useState(false)
  const [batchResults, setBatchResults] = useState({ changes: [], failures: [], timestamp: null, totalSites: 0 })
  const [expandedSites, setExpandedSites] = useState(new Set())
  const [hasLastResult, setHasLastResult] = useState(false)
  const [billingConfigExpanded, setBillingConfigExpanded] = useState(false)
  
  const [searchKeyword, setSearchKeyword] = useState('')
  const [categories, setCategories] = useState([])
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryForm] = Form.useForm()
  const [editingCategory, setEditingCategory] = useState(null)
  const [categoryCheckingId, setCategoryCheckingId] = useState(null)
  const isMobile = useIsMobile()
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    const saved = sessionStorage.getItem('sitesCollapsedGroups')
    if (saved) {
      try {
        return new Set(JSON.parse(saved))
      } catch (e) {
        console.error('恢复分类状态失败:', e)
      }
    }
    return new Set(['pinned', 'uncategorized'])
  })
  const listRef = useRef(list)
  const searchKeywordRef = useRef(searchKeyword)
  const collapsedGroupsRef = useRef(collapsedGroups)
  
  const nav = useNavigate()
  const location = useLocation()

  useEffect(() => {
    listRef.current = list
  }, [list])

  useEffect(() => {
    searchKeywordRef.current = searchKeyword
  }, [searchKeyword])

  // 自动保存折叠状态
  useEffect(() => {
    collapsedGroupsRef.current = collapsedGroups
    sessionStorage.setItem('sitesCollapsedGroups', JSON.stringify([...collapsedGroups]))
  }, [collapsedGroups])

  const categoryLookup = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories])

  // 单次遍历完成分组，避免每个分类都重复 filter 整个列表
  const { pinnedSites, uncategorizedSites, categorySitesMap } = useMemo(() => {
    const pinned = []
    const uncategorized = []
    const categoryMap = new Map(categories.map(category => [category.id, []]))

    for (const site of list) {
      if (site.pinned) {
        pinned.push(site)
        continue
      }

      if (site.categoryId && categoryMap.has(site.categoryId)) {
        categoryMap.get(site.categoryId).push(site)
        continue
      }

      uncategorized.push(site)
    }

    return {
      pinnedSites: pinned,
      uncategorizedSites: uncategorized,
      categorySitesMap: categoryMap
    }
  }, [list, categories])

  const hydrateSite = useCallback((site) => {
    const nextCategory = site.categoryId ? (categoryLookup.get(site.categoryId) || site.category || null) : null
    return {
      billingLimit: null,
      billingUsage: null,
      billingError: null,
      checkInSuccess: null,
      checkInMessage: null,
      checkInError: null,
      ...site,
      category: nextCategory
    }
  }, [categoryLookup])

  const upsertSiteInList = useCallback((site) => {
    const nextSite = hydrateSite(site)
    startTransition(() => {
      setList(prev => {
        const exists = prev.some(item => item.id === nextSite.id)
        const nextList = exists
          ? prev.map(item => item.id === nextSite.id ? { ...item, ...nextSite } : item)
          : [...prev, nextSite]
        return sortSites(nextList)
      })
    })
  }, [hydrateSite])

  const removeSitesFromList = useCallback((siteIds) => {
    const siteIdSet = new Set(siteIds)
    startTransition(() => {
      setList(prev => prev.filter(site => !siteIdSet.has(site.id)))
    })
  }, [])

  const shouldReloadList = useCallback(() => Boolean(searchKeywordRef.current.trim()), [])

  const handleOpenSiteDetail = useCallback((siteId) => {
    sessionStorage.setItem('sitesScrollPosition', window.scrollY.toString())
    sessionStorage.setItem('sitesCollapsedGroups', JSON.stringify([...collapsedGroupsRef.current]))
    nav(`/sites/${siteId}`)
  }, [nav])

  const load = useCallback(async (search = '') => {
    setLoading(true)
    try {
      const url = search ? `/api/sites?search=${encodeURIComponent(search)}` : '/api/sites'
      const res = await fetch(url, { headers: authHeaders() })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '加载站点列表失败')
      }
      const data = await res.json()
      startTransition(() => {
        setList(data)
      })
    } catch (e) {
      message.error(e.message || '加载站点列表失败')
    } finally { setLoading(false) }
  }, [])

  const loadCategories = async () => {
    try {
      const res = await fetch('/api/categories', { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        startTransition(() => {
          setCategories(data)
        })
        const saved = sessionStorage.getItem('sitesCollapsedGroups')
        if (!saved) {
          startTransition(() => {
            setCollapsedGroups(new Set(['pinned', 'uncategorized', ...data.map(c => c.id)]))
          })
        }
      }
    } catch (e) {
      console.error('加载分类失败:', e)
    }
  }

  const toggleGroupCollapse = useCallback((groupId) => {
    startTransition(() => {
      setCollapsedGroups(prev => {
        const newCollapsed = new Set(prev)
        if (newCollapsed.has(groupId)) {
          newCollapsed.delete(groupId)
        } else {
          newCollapsed.add(groupId)
        }
        return newCollapsed
      })
    })
  }, [])

  const loadScheduleConfig = async () => {
    try {
      const res = await fetch('/api/schedule-config', { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) setScheduleConfig(data.config)
      }
    } catch (e) {
      console.error('加载定时配置失败:', e)
    }
  }

  useEffect(() => {
    const initData = async () => {
      // 检查是否需要恢复滚动位置
      const savedScrollPos = sessionStorage.getItem('sitesScrollPosition')
      const needRestore = !!savedScrollPos
      
      // 加载数据
      await Promise.all([
        load(searchKeyword),
        loadCategories(),
        loadEmailConfig(),
        loadScheduleConfig()
      ])
      
      checkLastBatchResult()
      
      // 立即恢复滚动位置，无需延迟
      if (needRestore && savedScrollPos) {
        const scrollY = parseInt(savedScrollPos, 10)
        // 使用 requestIdleCallback 或 requestAnimationFrame 确保在下一帧执行
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => {
            window.scrollTo(0, scrollY)
            sessionStorage.removeItem('sitesScrollPosition')
          }, { timeout: 100 })
        } else {
          requestAnimationFrame(() => {
            window.scrollTo(0, scrollY)
            sessionStorage.removeItem('sitesScrollPosition')
          })
        }
      }
    }
    
    initData()
  }, [location])

  const handleSearch = (value) => {
    setSearchKeyword(value)
    load(value)
  }

  const openCategoryModal = (category = null) => {
    setEditingCategory(category)
    if (category) {
      // 编辑模式
      let cnHour = undefined, cnMinute = undefined
      if (category.scheduleCron && category.timezone === 'Asia/Shanghai') {
        const parts = String(category.scheduleCron).trim().split(/\s+/)
        if (parts.length >= 2) {
          cnMinute = Number(parts[0])
          cnHour = Number(parts[1])
        }
      }
      categoryForm.setFieldsValue({
        name: category.name,
        cnHour,
        cnMinute
      })
    } else {
      categoryForm.resetFields()
    }
    setCategoryModalOpen(true)
  }

  const saveCategoryHandler = async () => {
    try {
      const v = await categoryForm.validateFields()
      
      // 处理定时计划
      let scheduleCron = null
      let timezone = 'Asia/Shanghai'
      if (v.cnHour !== undefined && v.cnMinute !== undefined && v.cnHour !== null && v.cnMinute !== null) {
        const h = Math.max(0, Math.min(23, Number(v.cnHour)))
        const m = Math.max(0, Math.min(59, Number(v.cnMinute)))
        scheduleCron = `${m} ${h} * * *`
      }

      const data = { name: v.name, scheduleCron, timezone }

      if (editingCategory) {
        // 更新分类
        const res = await fetch(`/api/categories/${editingCategory.id}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          body: JSON.stringify(data)
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || '更新分类失败')
        }
        const updatedCategory = await res.json()
        startTransition(() => {
          setCategories(prev => prev.map(category => category.id === updatedCategory.id ? updatedCategory : category))
        })
        message.success('分类更新成功')
      } else {
        // 创建分类
        const res = await fetch('/api/categories', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(data)
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || '创建分类失败')
        }
        const createdCategory = await res.json()
        startTransition(() => {
          setCategories(prev => [...prev, createdCategory].sort((left, right) => {
            const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0
            const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0
            return leftTime - rightTime
          }))
        })
        message.success('分类创建成功')
      }

      setCategoryModalOpen(false)
      setEditingCategory(null)
      categoryForm.resetFields()
    } catch (e) {
      message.error(e.message || '保存失败')
    }
  }

  const deleteCategory = async (categoryId) => {
    try {
      const res = await fetch(`/api/categories/${categoryId}`, {
        method: 'DELETE',
        headers: authHeaders()
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '删除分类失败')
      }
      startTransition(() => {
        setCategories(prev => prev.filter(category => category.id !== categoryId))
        setList(prev => prev.map(site => site.categoryId === categoryId
          ? { ...site, categoryId: null, category: null }
          : site))
      })
      message.success('分类删除成功')
    } catch (e) {
      message.error(e.message || '删除失败')
    }
  }

  const checkCategory = async (categoryId, categoryName) => {
    if (categoryCheckingId) {
      message.warning('正在检测中，请稍候...')
      return
    }

    setCategoryCheckingId(categoryId)
    const hide = message.loading(`正在检测分类 "${categoryName}" 下的站点...`, 0)
    
    try {
      const res = await fetch(`/api/categories/${categoryId}/check?skipNotification=true`, {
        method: 'POST',
        headers: authHeaders()
      })
      const data = await res.json().catch(() => ({}))
      
      if (!res.ok) {
        throw new Error(data.error || '检测失败')
      }

      hide()
      setCategoryCheckingId(null)

      // 显示结果
      const results = data.results || { changes: [], failures: [], totalSites: 0 }
      setBatchResults({
        ...results,
        timestamp: new Date().toISOString()
      })
      setExpandedSites(new Set())
      setBatchResultOpen(true)

      await load(searchKeyword)

      if (results.changes.length === 0 && results.failures.length === 0) {
        message.success('检测完成，所有站点无变更')
      } else {
        message.success('检测完成！')
      }
    } catch (e) {
      hide()
      setCategoryCheckingId(null)
      message.error(e.message || '检测失败')
    }
  }

  // 一键检测指定分组（置顶、未分类等）
  const checkGroup = async (groupType, groupName) => {
    if (categoryCheckingId) {
      message.warning('正在检测中，请稍候...')
      return
    }

    let sitesToCheck = []
    if (groupType === 'pinned') {
      sitesToCheck = list.filter(s => s.pinned && !s.excludeFromBatch)
    } else if (groupType === 'uncategorized') {
      sitesToCheck = list.filter(s => !s.categoryId && !s.pinned && !s.excludeFromBatch)
    }

    if (sitesToCheck.length === 0) {
      message.warning(`${groupName}下没有可检测的站点`)
      return
    }

    setCategoryCheckingId(groupType)
    const hide = message.loading(`正在检测${groupName}下的 ${sitesToCheck.length} 个站点...`, 0)

    const results = {
      changes: [],
      failures: [],
      totalSites: sitesToCheck.length
    }

    try {
      // 依次检测每个站点（5秒间隔）
      for (let i = 0; i < sitesToCheck.length; i++) {
        const site = sitesToCheck[i]
        try {
          const res = await fetch(`/api/sites/${site.id}/check?skipNotification=true`, {
            method: 'POST',
            headers: authHeaders()
          })
          const data = await res.json().catch(() => ({}))
          
          if (!res.ok) {
            results.failures.push({
              siteName: site.name,
              error: data.error || '检测失败'
            })
          } else if (data.hasChanges && data.diff) {
            results.changes.push({
              siteName: site.name,
              diff: data.diff
            })
          }
        } catch (e) {
          results.failures.push({
            siteName: site.name,
            error: e.message || '网络错误'
          })
        }

        // 如果不是最后一个站点，等待5秒
        if (i < sitesToCheck.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
      }

      hide()
      setCategoryCheckingId(null)

      // 显示结果
      setBatchResults({
        ...results,
        timestamp: new Date().toISOString()
      })
      setExpandedSites(new Set())
      setBatchResultOpen(true)

      await load(searchKeyword)

      if (results.changes.length === 0 && results.failures.length === 0) {
        message.success('检测完成，所有站点无变更')
      } else {
        message.success('检测完成！')
      }
    } catch (e) {
      hide()
      setCategoryCheckingId(null)
      message.error(e.message || '检测失败')
    }
  }

  const checkLastBatchResult = () => {
    try {
      const saved = localStorage.getItem('lastBatchCheckResult')
      setHasLastResult(!!saved)
    } catch (e) {
      setHasLastResult(false)
    }
  }

  const loadLastBatchResult = () => {
    try {
      const saved = localStorage.getItem('lastBatchCheckResult')
      if (saved) {
        const results = JSON.parse(saved)
        setBatchResults(results)
        setExpandedSites(new Set())
        setBatchResultOpen(true)
      } else {
        message.info('没有历史检测结果')
      }
    } catch (e) {
      message.error('加载历史结果失败')
    }
  }

  const loadEmailConfig = async () => {
    try {
      const res = await fetch('/api/email-config', { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setEmailConfigData(data)
      }
    } catch (e) {
      console.error('Failed to load email config:', e)
    }
  }

  const openEmailConfigModal = () => {
    if (emailConfigData) {
      emailConfigForm.setFieldsValue({
        resendApiKey: '',
        notifyEmails: emailConfigData.notifyEmails || ''
      })
    }
    setEmailConfigOpen(true)
  }

  const saveEmailConfig = async () => {
    try {
      const v = await emailConfigForm.validateFields()

      const res = await fetch('/api/email-config', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          resendApiKey: v.resendApiKey,
          notifyEmails: v.notifyEmails,
          enabled: true
        })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '保存失败')
      }

      setEmailConfigOpen(false)
      emailConfigForm.resetFields()
      await loadEmailConfig()
      message.success('邮件通知配置成功')
    } catch (e) {
      message.error(e.message || '保存失败，请重试')
    }
  }

  const onAdd = async () => {
    try {
      const v = await form.validateFields()
      if (v.cnHour !== undefined && v.cnMinute !== undefined && v.cnHour !== null && v.cnMinute !== null) {
        const h = Math.max(0, Math.min(23, Number(v.cnHour)))
        const m = Math.max(0, Math.min(59, Number(v.cnMinute)))
        v.scheduleCron = `${m} ${h} * * *`
        v.timezone = 'Asia/Shanghai'
      }
      delete v.cnHour; delete v.cnMinute
      if (!v.apiType) v.apiType = 'other'
      if (v.enableCheckIn && !v.checkInMode) v.checkInMode = 'both'
      
      // 确保布尔字段总是被包含在请求中，使用实际值或默认值false
      v.pinned = v.pinned === true;
      v.excludeFromBatch = v.excludeFromBatch === true;
      v.unlimitedQuota = v.unlimitedQuota === true;
      v.enableCheckIn = v.enableCheckIn === true;
      if (v.apiType === 'voapi') {
        v.billingAuthValue = null
      } else if (typeof v.billingAuthValue === 'string') {
        v.billingAuthValue = v.billingAuthValue.trim() || null
      }
      v.proxyUrl = v.proxyUrl?.trim() || null;
      
      const res = await fetch('/api/sites', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(v) })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '创建站点失败')
      }
      const createdSite = await res.json()
      setOpen(false)
      form.resetFields()
      if (shouldReloadList()) {
        await load(searchKeywordRef.current)
      } else {
        upsertSiteInList(createdSite)
      }
      message.success('站点创建成功')
    } catch (e) {
      message.error(e.message || '创建站点失败')
    }
  }

  const openEditModal = useCallback(async (site) => {
    try {
      const res = await fetch(`/api/sites/${site.id}`, { headers: authHeaders() })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '获取站点详情失败')
      }

      const siteDetail = await res.json()
      const currentSite = { ...site, ...siteDetail }

      setEditMode(true)
      setEditingSite(currentSite)

      let cnHour = undefined, cnMinute = undefined
      if (currentSite.scheduleCron && currentSite.timezone === 'Asia/Shanghai') {
        const parts = String(currentSite.scheduleCron).trim().split(/\s+/)
        if (parts.length >= 2) {
          cnMinute = Number(parts[0])
          cnHour = Number(parts[1])
        }
      }

      form.setFieldsValue({
        name: currentSite.name,
        baseUrl: currentSite.baseUrl,
        apiKey: '',
        apiType: currentSite.apiType || 'other',
        userId: currentSite.userId || '',
        cnHour,
        cnMinute,
        pinned: currentSite.pinned !== undefined ? currentSite.pinned : false,
        excludeFromBatch: currentSite.excludeFromBatch !== undefined ? currentSite.excludeFromBatch : false,
        categoryId: currentSite.categoryId || null,
        unlimitedQuota: currentSite.unlimitedQuota !== undefined ? currentSite.unlimitedQuota : false,
        billingUrl: currentSite.billingUrl || '',
        billingAuthType: currentSite.billingAuthType || 'token',
        proxyUrl: currentSite.proxyUrl || '',
        billingLimitField: currentSite.billingLimitField || '',
        billingUsageField: currentSite.billingUsageField || '',
        enableCheckIn: currentSite.enableCheckIn !== undefined ? currentSite.enableCheckIn : false,
        checkInMode: currentSite.checkInMode || 'both',
        extralink: currentSite.extralink || '',
        remark: currentSite.remark || ''
      })
      setOpen(true)
    } catch (e) {
      message.error(e.message || '获取站点详情失败')
    }
  }, [form])

  const onEdit = async () => {
    try {
      const v = await form.validateFields()

      // 构建更新数据，包含所有字段，确保布尔值被正确处理
      const updateData = {
        name: v.name,
        baseUrl: v.baseUrl,
        apiType: v.apiType || 'other',
        userId: v.userId || null,
        // 布尔字段：使用严格的布尔转换，确保false值也被正确发送
        pinned: v.pinned === true,
        excludeFromBatch: v.excludeFromBatch === true,
        unlimitedQuota: v.unlimitedQuota === true,
        categoryId: v.categoryId || null,
        billingUrl: v.billingUrl || null,
        billingAuthType: v.billingAuthType || 'token',
        proxyUrl: v.proxyUrl?.trim() || null,
        billingLimitField: v.billingLimitField || null,
        billingUsageField: v.billingUsageField || null,
        enableCheckIn: v.enableCheckIn === true,
        extralink: v.extralink || null,
        remark: v.remark || null
      }

      if (v.apiType === 'voapi') {
        updateData.billingAuthValue = null
      } else if (typeof v.billingAuthValue === 'string' && v.billingAuthValue.trim()) {
        updateData.billingAuthValue = v.billingAuthValue.trim()
      }
      
      if (v.enableCheckIn && v.checkInMode) {
        updateData.checkInMode = v.checkInMode
      } else if (v.enableCheckIn) {
        updateData.checkInMode = 'both'
      }

      if (v.apiKey && v.apiKey.trim()) {
        updateData.apiKey = v.apiKey
      }

      if (v.cnHour !== undefined && v.cnMinute !== undefined && v.cnHour !== null && v.cnMinute !== null) {
        const h = Math.max(0, Math.min(23, Number(v.cnHour)))
        const m = Math.max(0, Math.min(59, Number(v.cnMinute)))
        updateData.scheduleCron = `${m} ${h} * * *`
        updateData.timezone = 'Asia/Shanghai'
      } else {
        updateData.scheduleCron = null
        updateData.timezone = 'UTC'
      }

      const res = await fetch(`/api/sites/${editingSite.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify(updateData)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '更新站点失败')
      }
      const updatedSite = await res.json()

      setOpen(false)
      setEditMode(false)
      setEditingSite(null)
      form.resetFields()
      if (shouldReloadList()) {
        await load(searchKeywordRef.current)
      } else {
        upsertSiteInList(updatedSite)
      }
      message.success('站点更新成功')
    } catch (e) {
      message.error(e.message || '更新站点失败，请检查输入信息')
    }
  }

  const onDelete = useCallback(async (site) => {
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'DELETE',
        headers: authHeaders()
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '删除站点失败')
      }

      if (shouldReloadList()) {
        await load(searchKeywordRef.current)
      } else {
        removeSitesFromList([site.id])
      }
      message.success(`站点"${site.name}"已删除`)
    } catch (e) {
      message.error(e.message || '删除站点失败')
    }
  }, [load, removeSitesFromList, shouldReloadList])

  const deleteUncategorizedSites = async () => {
    try {
      const uncategorizedSites = list.filter(s => !s.categoryId && !s.pinned)
      
      if (uncategorizedSites.length === 0) {
        message.info('没有未分类站点可删除')
        return
      }

      // 批量删除所有未分类站点
      const deletePromises = uncategorizedSites.map(site => 
        fetch(`/api/sites/${site.id}`, {
          method: 'DELETE',
          headers: authHeaders()
        })
      )

      const results = await Promise.allSettled(deletePromises)
      
      const successfulIds = uncategorizedSites
        .filter((_, index) => results[index]?.status === 'fulfilled')
        .map(site => site.id)
      const successCount = successfulIds.length
      const failCount = results.length - successCount

      if (successfulIds.length > 0) {
        removeSitesFromList(successfulIds)
      }
      
      if (failCount === 0) {
        message.success(`已成功删除 ${successCount} 个未分类站点`)
      } else {
        message.warning(`删除完成：成功 ${successCount} 个，失败 ${failCount} 个`)
      }
    } catch (e) {
      message.error(e.message || '批量删除失败')
    }
  }

  const handleModalOk = () => {
    if (editMode) {
      onEdit()
    } else {
      onAdd()
    }
  }

  const handleModalCancel = () => {
    setOpen(false)
    setEditMode(false)
    setEditingSite(null)
    setBillingConfigExpanded(false) // 重置billing配置展开状态
    form.resetFields()
  }

  const onCheck = useCallback(async (id) => {
    const hide = message.loading('正在检测中...', 0)
    try {
      const res = await fetch(`/api/sites/${id}/check?skipNotification=true`, { method: 'POST', headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || '检测失败')
      hide()
      
      if (data.hasChanges && data.diff) {
        const site = listRef.current.find(s => s.id === id)
        const siteName = site?.name || '未知站点'
        
        Modal.info({
          title: '🔄 检测到模型变更',
          width: 600,
          content: (
            <div style={{ marginTop: 16 }}>
              <Typography.Text strong style={{ fontSize: 16, display: 'block', marginBottom: 12 }}>
                站点：{siteName}
              </Typography.Text>
              
              {data.diff.added && data.diff.added.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text strong style={{ color: '#52c41a' }}>
                    ✅ 新增模型 ({data.diff.added.length}个)：
                  </Typography.Text>
                  <div style={{ marginTop: 4, paddingLeft: 16 }}>
                    {data.diff.added.slice(0, 10).map((model, index) => (
                      <Tag key={index} color="green" style={{ margin: '2px 4px 2px 0' }}>
                        {model.id}
                      </Tag>
                    ))}
                    {data.diff.added.length > 10 && (
                      <Typography.Text type="secondary">
                        ...还有 {data.diff.added.length - 10} 个
                      </Typography.Text>
                    )}
                  </div>
                </div>
              )}
              
              {data.diff.removed && data.diff.removed.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text strong style={{ color: '#ff4d4f' }}>
                    ❌ 移除模型 ({data.diff.removed.length}个)：
                  </Typography.Text>
                  <div style={{ marginTop: 4, paddingLeft: 16 }}>
                    {data.diff.removed.slice(0, 10).map((model, index) => (
                      <Tag key={index} color="red" style={{ margin: '2px 4px 2px 0' }}>
                        {model.id}
                      </Tag>
                    ))}
                    {data.diff.removed.length > 10 && (
                      <Typography.Text type="secondary">
                        ...还有 {data.diff.removed.length - 10} 个
                      </Typography.Text>
                    )}
                  </div>
                </div>
              )}
              
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                💡 点击"查看详情"按钮可查看完整的变更历史
              </Typography.Text>
            </div>
          ),
          okText: '知道了',
          onOk: () => {
            // 可选：自动跳转到站点详情页
            // nav(`/sites/${id}`)
          }
        })
        
        message.success('检测完成，发现模型变更！')
      } else {
        message.success('检测完成，无模型变更')
      }
      
      await load(searchKeywordRef.current)
    } catch (e) {
      hide()
      message.error(e.message || '检测失败，请检查站点配置')
    }
  }, [load])

  const onCheckAllSites = async () => {
    if (list.length === 0) {
      message.warning('没有可检测的站点')
      return
    }

    // 过滤掉excludeFromBatch=true的站点
    const sitesToCheck = list.filter(site => !site.excludeFromBatch)

    if (sitesToCheck.length === 0) {
      message.warning('没有可参与一键检测的站点，所有站点均已排除')
      return
    }

    if (sitesToCheck.length < list.length) {
      message.info(`已排除 ${list.length - sitesToCheck.length} 个站点，将检测 ${sitesToCheck.length} 个站点`)
    }

    setBatchChecking(true)
    setBatchProgress({ current: 0, total: sitesToCheck.length, currentSite: '' })

    const intervalMs = 5000 // 5秒间隔
    const sitesWithChanges = []
    const failedSites = []

    for (let i = 0; i < sitesToCheck.length; i++) {
      const site = sitesToCheck[i]
      setBatchProgress({ current: i + 1, total: list.length, currentSite: site.name })

      try {
        // 添加 skipNotification=true 参数，不发送邮件
        const res = await fetch(`/api/sites/${site.id}/check?skipNotification=true`, {
          method: 'POST',
          headers: authHeaders()
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          failedSites.push({
            siteName: site.name,
            error: data?.error || '未知错误'
          })
        } else if (data.hasChanges && data.diff) {
          // 收集有变更的站点
          sitesWithChanges.push({
            siteName: site.name,
            diff: data.diff
          })
        }
      } catch (e) {
        failedSites.push({
          siteName: site.name,
          error: e.message || '网络错误'
        })
      }

      // 如果不是最后一个站点，等待间隔时间
      if (i < sitesToCheck.length - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
    }

    setBatchChecking(false)
    setBatchProgress({ current: 0, total: 0, currentSite: '' })

    // 刷新列表
    await load(searchKeywordRef.current)

    // 保存结果到 state 和 localStorage
    const results = {
      changes: sitesWithChanges,
      failures: failedSites,
      timestamp: new Date().toISOString(),
      totalSites: sitesToCheck.length
    }
    setBatchResults(results)

    // 保存到 localStorage（只保留最近一次）
    try {
      localStorage.setItem('lastBatchCheckResult', JSON.stringify(results))
      setHasLastResult(true) // 更新按钮显示状态
    } catch (e) {
      console.error('保存检测结果失败:', e)
    }

    setExpandedSites(new Set()) // 重置展开状态
    setBatchResultOpen(true)
  }

  const openTimeModal = useCallback((r) => {
    setTimeSite(r)
    let h = undefined, m = undefined
    if (r.scheduleCron && r.timezone === 'Asia/Shanghai') {
      const parts = String(r.scheduleCron).trim().split(/\s+/)
      if (parts.length >= 2) { m = Number(parts[0]); h = Number(parts[1]) }
    }
    timeForm.setFieldsValue({ cnHour: h, cnMinute: m })
    setTimeOpen(true)
  }, [timeForm])

  const saveTime = async () => {
    try {
      const v = await timeForm.validateFields()
      if (!timeSite) return

      // 检查是否输入了时间，如果都为空/null则取消定时计划
      const hour = v.cnHour;
      const minute = v.cnMinute;

      if ((hour === undefined || hour === null) && (minute === undefined || minute === null)) {
        // 取消定时计划
        const res = await fetch(`/api/sites/${timeSite.id}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          body: JSON.stringify({ scheduleCron: null, timezone: 'UTC' })
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || '保存失败')
        }
        const updatedSite = await res.json()
        setTimeOpen(false)
        setTimeSite(null)
        upsertSiteInList(updatedSite)
        message.success('已取消定时检测')
      } else if ((hour !== undefined && hour !== null) && (minute !== undefined && minute !== null)) {
        // 设置定时计划
        const cron = hmToCron(hour, minute)
        const res = await fetch(`/api/sites/${timeSite.id}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          body: JSON.stringify({ scheduleCron: cron, timezone: 'Asia/Shanghai' })
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || '保存失败')
        }
        const updatedSite = await res.json()
        setTimeOpen(false)
        setTimeSite(null)
        upsertSiteInList(updatedSite)
        message.success('检测时间设置成功')
      } else {
        message.error('请输入完整的时间（小时和分钟）或留空取消定时检测')
      }
    } catch (e) {
      message.error(e.message || '保存失败，请重试')
    }
  }

  const openDebugModal = useCallback(async (site) => {
    setDebugOpen(true)
    setDebugLoading(true)
    setDebugData(null)

    try {
      const res = await fetch(`/api/sites/${site.id}/latest-snapshot`, { headers: authHeaders() })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '获取快照失败')
      }
      const data = await res.json()
      setDebugData({ ...data, siteName: site.name, siteUrl: site.baseUrl })
    } catch (e) {
      message.error(e.message || '获取请求详情失败')
      setDebugOpen(false)
    } finally {
      setDebugLoading(false)
    }
  }, [])

  // 更新站点排序
  const updateSortOrder = useCallback(async (siteId, newValue) => {
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ sortOrder: Number(newValue) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新失败')
      upsertSiteInList(data)
      message.success('排序已更新')
    } catch (e) {
      console.error('更新排序失败:', e)
      message.error('更新排序失败')
    }
  }, [upsertSiteInList])

  // 移动端站点卡片组件 - 使用 useCallback 优化
  const renderMobileSiteCard = useCallback((site) => {
    const { billingLimit, billingUsage, unlimitedQuota, apiType, enableCheckIn, checkInSuccess } = site;
    
    let balanceDisplay = null;
    if (unlimitedQuota) {
      balanceDisplay = <Tag color="gold" style={{ margin: 0 }}>无限额</Tag>;
    } else if (typeof billingLimit === 'number' && typeof billingUsage === 'number') {
      const remaining = billingLimit - billingUsage;
      const percentage = (billingUsage / billingLimit) * 100;
      const color = percentage > 90 ? '#ff4d4f' : percentage > 70 ? '#fa8c16' : '#52c41a';
      balanceDisplay = <span style={{ color, fontWeight: 600, fontSize: 13 }}>${remaining.toFixed(2)}</span>;
    }

    let checkInDisplay = null;
    if ((apiType === 'veloera' || apiType === 'newapi' || apiType === 'voapi') && enableCheckIn) {
      if (checkInSuccess === true) {
        checkInDisplay = <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />;
      } else if (checkInSuccess === false) {
        checkInDisplay = <span style={{ color: '#ff4d4f', fontSize: 14 }}>✖</span>;
      } else {
        checkInDisplay = <span style={{ color: '#faad14', fontSize: 14 }}>●</span>;
      }
    }

    return (
      <Card key={site.id} size="small" className="site-card-mobile" style={{ borderRadius: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <Typography.Link href={site.baseUrl} target="_blank" strong style={{ fontSize: 14, color: '#1890ff' }} ellipsis>
                {site.name}
              </Typography.Link>
              {site.pinned && <PushpinFilled style={{ color: '#fa8c16', fontSize: 11 }} />}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{site.apiType?.toUpperCase()}</Typography.Text>
          </div>
          <Space size={6}>{balanceDisplay}{checkInDisplay}</Space>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text type="secondary" style={{ fontSize: 10 }}>
            {site.lastCheckedAt ? new Date(site.lastCheckedAt).toLocaleString('zh-CN') : '未检测'}
          </Typography.Text>
          <Space size={4}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => handleOpenSiteDetail(site.id)} />
            <Button size="small" icon={<ThunderboltOutlined />} style={{ color: '#52c41a', borderColor: '#52c41a' }} onClick={() => onCheck(site.id)} />
            <Button size="small" icon={<EditOutlined />} style={{ color: '#1890ff', borderColor: '#1890ff' }} onClick={() => openEditModal(site)} />
            <Popconfirm title="确定删除？" onConfirm={() => onDelete(site)} okText="删除" cancelText="取消">
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        </div>
      </Card>
    );
  }, [handleOpenSiteDetail, onCheck, openEditModal, onDelete]);

  // 移动端站点列表（支持展开/折叠）
  const renderMobileSiteList = useCallback((sites, title, titleColor = '#1890ff', icon, groupId) => {
    if (!sites || sites.length === 0) return null;
    const isCollapsed = collapsedGroups.has(groupId);
    return (
      <div style={{ marginBottom: 16 }} key={title}>
        <div 
          style={{ 
            background: `linear-gradient(135deg, ${titleColor} 0%, ${titleColor}dd 100%)`, 
            padding: '10px 14px', 
            borderRadius: isCollapsed ? '10px' : '10px 10px 0 0', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            cursor: 'pointer'
          }}
          onClick={() => toggleGroupCollapse(groupId)}
        >
          {isCollapsed ? 
            <RightOutlined style={{ color: 'white', fontSize: 12 }} /> : 
            <DownOutlined style={{ color: 'white', fontSize: 12 }} />
          }
          {icon}
          <Typography.Text strong style={{ color: 'white', fontSize: 14 }}>{title}</Typography.Text>
          <Tag style={{ margin: 0 }}>{sites.length}</Tag>
        </div>
        {!isCollapsed && (
          <div style={{ background: '#fafafa', padding: 10, borderRadius: '0 0 10px 10px' }}>
            {sites.map(renderMobileSiteCard)}
          </div>
        )}
      </div>
    );
  }, [renderMobileSiteCard, collapsedGroups, toggleGroupCollapse]);

  const columns = useMemo(() => [
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>排序</span>,
      dataIndex: 'sortOrder',
      width: 64,
      align: 'center',
      render: (value, record) => (
        <InputNumber
          key={`sort-${record.id}-${value ?? 0}`}
          size="small"
          min={0}
          max={9999}
          defaultValue={value ?? 0}
          controls={false}
          style={{ width: 46 }}
          onBlur={(e) => {
            const newValue = parseInt(e.target.value, 10) || 0
            if (newValue !== (value ?? 0)) {
              updateSortOrder(record.id, newValue)
            }
          }}
          onPressEnter={(e) => {
            e.target.blur()
          }}
        />
      )
    },
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>名称</span>,
      dataIndex: 'name',
      width: 150,
      render: (text, record) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Tooltip title={record.baseUrl} placement="topLeft">
                <Typography.Link
                  href={record.baseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  strong
                  style={{
                    ...TABLE_TEXT_ELLIPSIS_STYLE,
                    fontSize: 15,
                    color: '#40a9ff'
                  }}
                >
                  {text}
                </Typography.Link>
              </Tooltip>
            </div>
            {record.pinned && (
              <Tooltip title="已置顶">
                <PushpinFilled style={{ color: '#fa8c16', fontSize: 13, flex: '0 0 auto' }} />
              </Tooltip>
            )}
            {record.excludeFromBatch && (
              <Tooltip title="不参与一键检测">
                <StopOutlined style={{ fontSize: 13, color: '#ff4d4f', flex: '0 0 auto' }} />
              </Tooltip>
            )}
          </div>
          {record.extralink && (
            <Tooltip title={record.extralink} placement="topLeft">
              <Typography.Link
                href={record.extralink}
                target="_blank"
                rel="noopener noreferrer"
                type="secondary"
                style={{
                  ...TABLE_TEXT_ELLIPSIS_STYLE,
                  fontSize: 11
                }}
              >
                {record.extralink}
              </Typography.Link>
            </Tooltip>
          )}
        </div>
      )
    },
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>用量</span>,
      width: 168,
      align: 'center',
      render: (_, record) => {
        const { billingLimit, billingUsage, billingError, unlimitedQuota } = record

        if (unlimitedQuota) {
          return (
            <Tooltip title="此站点标记为无限余额">
              <div style={{
                display: 'inline-block',
                padding: '4px 8px',
                borderRadius: 6,
                background: 'linear-gradient(45deg, #ffd700, #ffed4e, #ffd700, #ffed4e)',
                backgroundSize: '200% 200%',
                animation: 'shimmer 2s ease-in-out infinite',
                border: '1px solid #ffd700',
                fontSize: 11,
                fontWeight: 600,
                color: '#b8860b',
                cursor: 'help'
              }}>
                ♾️ 无限余额
              </div>
            </Tooltip>
          )
        }

        if (billingError) {
          return (
            <Tooltip title={billingError}>
              <Tag color="default" style={{ fontSize: 11, margin: 0, color: '#999', borderColor: '#d9d9d9' }}>
                无法获取
              </Tag>
            </Tooltip>
          )
        }

        if (typeof billingLimit === 'number' && typeof billingUsage === 'number') {
          const remaining = billingLimit - billingUsage
          const percentage = (billingUsage / billingLimit) * 100
          let color = '#52c41a'
          let bgColor = '#f6ffed'
          let barColor = '#52c41a'
          if (percentage > 90) {
            color = '#ff4d4f'
            bgColor = '#fff2f0'
            barColor = '#ff4d4f'
          } else if (percentage > 70) {
            color = '#fa8c16'
            bgColor = '#fff7e6'
            barColor = '#fa8c16'
          }

          return (
            <Tooltip title={`总额: $${billingLimit.toFixed(2)} | 已用: $${billingUsage.toFixed(1)} | 剩余: $${remaining.toFixed(2)} (${(100 - percentage).toFixed(1)}%)`}>
              <div style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: 6,
                backgroundColor: bgColor,
                border: `1px solid ${color}20`,
                cursor: 'help'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#666', fontWeight: 500 }}>剩余</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color }}>${remaining.toFixed(2)}</span>
                </div>
                <div style={{
                  height: 4,
                  backgroundColor: '#f0f0f0',
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginBottom: 4
                }}>
                  <div style={{
                    height: '100%',
                    width: `${100 - percentage}%`,
                    backgroundColor: barColor,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999' }}>
                  <span>已用 ${billingUsage.toFixed(1)}</span>
                  <span>总额 ${billingLimit.toFixed(2)}</span>
                </div>
              </div>
            </Tooltip>
          )
        }

        if (typeof billingLimit === 'number') {
          return (
            <Tooltip title="总额度">
              <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>💳 ${billingLimit.toFixed(2)}</Tag>
            </Tooltip>
          )
        }

        if (typeof billingUsage === 'number') {
          return (
            <Tooltip title="已使用">
              <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>📈 ${billingUsage.toFixed(1)}</Tag>
            </Tooltip>
          )
        }

        return <Typography.Text type="secondary" style={{ fontSize: 11 }}>-</Typography.Text>
      }
    },
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>签到</span>,
      width: 72,
      align: 'center',
      render: (_, record) => {
        const { apiType, enableCheckIn, checkInSuccess, checkInMessage, checkInError } = record

        if (apiType !== 'veloera' && apiType !== 'newapi' && apiType !== 'voapi') {
          return <Tooltip title="此站点类型不支持签到">
            <span style={{ fontSize: 32, color: '#d9d9d9', cursor: 'help', fontWeight: 'bold', lineHeight: 1 }}>●</span>
          </Tooltip>
        }

        if (!enableCheckIn) {
          return <Tooltip title="未启用签到">
            <span style={{ fontSize: 32, color: '#d9d9d9', cursor: 'help', fontWeight: 'bold', lineHeight: 1 }}>●</span>
          </Tooltip>
        }

        if (checkInSuccess === true) {
          return <Tooltip title={`签到成功: ${checkInMessage || '成功'}`}>
            <CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a', cursor: 'help' }} />
          </Tooltip>
        }

        if (checkInSuccess === false) {
          return <Tooltip title={`签到失败: ${checkInError || checkInMessage || '失败'}`}>
            <span style={{ fontSize: 32, color: '#ff4d4f', cursor: 'help', fontWeight: 'bold', lineHeight: 1 }}>✖</span>
          </Tooltip>
        }

        return <Tooltip title="已启用签到，暂无签到记录">
          <span style={{ fontSize: 32, color: '#faad14', cursor: 'help', fontWeight: 'bold', lineHeight: 1 }}>●</span>
        </Tooltip>
      }
    },
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>定时计划</span>,
      width: 180,
      align: 'center',
      render: (_, r) => {
        if (scheduleConfig?.enabled && scheduleConfig.overrideIndividual) {
          const h = String(scheduleConfig.hour).padStart(2, '0')
          const m = String(scheduleConfig.minute).padStart(2, '0')
          return <Tooltip title="全局配置已启用覆盖模式，此站点的单独配置被忽略，使用全局配置">
            <Tag color="orange" icon={<ClockCircleOutlined />} style={{ fontSize: 12, cursor: 'help', margin: 0, maxWidth: '100%' }}>
              全局覆盖 {h}:{m}
            </Tag>
          </Tooltip>
        }

        if (r.scheduleCron && r.scheduleCron.trim()) {
          if (r.timezone === 'Asia/Shanghai') {
            return <Tooltip title="此站点有单独的定时配置，会单独调度、单独发送邮件通知">
              <Tag color="blue" icon={<ClockCircleOutlined />} style={{ fontSize: 12, cursor: 'help', margin: 0, maxWidth: '100%' }}>
                单独 {cronToHm(r.scheduleCron)}
              </Tag>
            </Tooltip>
          }
          return <Tooltip title="此站点有单独的定时配置，会单独调度、单独发送邮件通知">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.3 }}>
              <Tag color="blue" style={{ fontSize: 12, cursor: 'help', margin: 0, alignSelf: 'center' }}>单独配置</Tag>
              <Typography.Text style={{ ...TABLE_TEXT_ELLIPSIS_STYLE, fontSize: 11, color: '#8c8c8c' }}>
                {r.scheduleCron} / {r.timezone || 'UTC'}
              </Typography.Text>
            </div>
          </Tooltip>
        }

        if (scheduleConfig?.enabled) {
          const h = String(scheduleConfig.hour).padStart(2, '0')
          const m = String(scheduleConfig.minute).padStart(2, '0')
          return <Tooltip title="此站点使用全局定时配置，会与其他站点一起检测、聚合发送邮件通知">
            <Tag color="cyan" icon={<ClockCircleOutlined />} style={{ fontSize: 12, cursor: 'help', margin: 0, maxWidth: '100%' }}>
              全局 {h}:{m}
            </Tag>
          </Tooltip>
        }

        return <Typography.Text type="secondary" style={{ fontSize: 12 }}>未配置</Typography.Text>
      }
    },
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>上次检测</span>,
      dataIndex: 'lastCheckedAt',
      width: 136,
      align: 'center',
      render: (v) => {
        if (!v) {
          return <Typography.Text type="secondary" style={{ fontSize: 12 }}>未检测</Typography.Text>
        }

        const text = new Date(v).toLocaleString('zh-CN')
        const [datePart, timePart] = text.split(' ')
        return (
          <div style={{ lineHeight: 1.35 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {datePart}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {timePart || ''}
            </Typography.Text>
          </div>
        )
      }
    },
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>备注</span>,
      dataIndex: 'remark',
      width: 120,
      render: (text) => text ? (
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, margin: 0 }}
          ellipsis={{ rows: 2, tooltip: text }}
        >
          {text}
        </Typography.Paragraph>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>-</Typography.Text>
      )
    },
    {
      title: <span style={{ fontSize: 15, fontWeight: 600 }}>操作</span>,
      key: 'actions',
      width: 126,
      align: 'center',
      render: (_, r) => (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(3, 34px)', gap: 4 }}>
            <Tooltip title="查看详情">
              <Button
                type="primary"
                className="hover-lift"
                icon={<EyeOutlined />}
                onClick={() => handleOpenSiteDetail(r.id)}
                size="small"
                style={COMPACT_ACTION_BUTTON_STYLE}
              />
            </Tooltip>
            <Tooltip title="立即检测">
              <Button
                type="default"
                className="hover-lift"
                icon={<ThunderboltOutlined />}
                onClick={() => onCheck(r.id)}
                size="small"
                style={{ ...COMPACT_ACTION_BUTTON_STYLE, color: '#52c41a', fontWeight: 600, borderColor: '#52c41a' }}
              />
            </Tooltip>
            <Tooltip title="请求详情">
              <Button
                type="default"
                icon={<BugOutlined />}
                onClick={() => openDebugModal(r)}
                size="small"
                style={{ ...COMPACT_ACTION_BUTTON_STYLE, color: '#fa8c16', borderColor: '#fa8c16' }}
              />
            </Tooltip>
            <Tooltip title="设置时间">
              <Button
                type="default"
                icon={<ClockCircleOutlined />}
                onClick={() => openTimeModal(r)}
                size="small"
                style={COMPACT_ACTION_BUTTON_STYLE}
              />
            </Tooltip>
            <Tooltip title="编辑">
              <Button
                type="default"
                icon={<EditOutlined />}
                onClick={() => openEditModal(r)}
                size="small"
                style={{ ...COMPACT_ACTION_BUTTON_STYLE, color: '#1890ff', borderColor: '#1890ff' }}
              />
            </Tooltip>
            <Popconfirm
              title="删除站点"
              description={
                <div style={{ maxWidth: 300 }}>
                  <p>确定要删除站点 <strong>{r.name}</strong> 吗？</p>
                  <p style={{ color: '#ff4d4f', marginTop: 8 }}>
                    删除后将清除所有历史检测数据，此操作不可恢复！
                  </p>
                </div>
              }
              onConfirm={() => onDelete(r)}
              okText="确定删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
            >
              <Tooltip title="删除">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  size="small"
                  style={COMPACT_ACTION_BUTTON_STYLE}
                />
              </Tooltip>
            </Popconfirm>
          </div>
        </div>
      )
    }
  ], [handleOpenSiteDetail, onCheck, openDebugModal, openTimeModal, openEditModal, onDelete, scheduleConfig, updateSortOrder])

  return (
    <Card
      title={<Typography.Title level={3} style={{ margin: 0 }}>站点管理</Typography.Title>}
      extra={
        <Space size={10} wrap>
          <Input.Search
            placeholder="搜索站点名称、链接或模型ID..."
            allowClear
            enterButton={<SearchOutlined />}
            size="large"
            onSearch={handleSearch}
            onChange={(e) => {
              if (!e.target.value) handleSearch('')
            }}
            style={{ width: 320 }}
          />
          <Button
            icon={<AppstoreAddOutlined />}
            size="large"
            onClick={() => openCategoryModal()}
            style={{
              background: 'linear-gradient(135deg, #13c2c2 0%, #08979c 100%)',
              border: 'none',
              height: 40,
              fontSize: 14,
              fontWeight: 600,
              color: 'white'
            }}
          >
            分类管理
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={() => setOpen(true)}
            className="hover-lift"
            style={{
              height: 40,
              fontSize: 14,
              fontWeight: 600
            }}
          >
            新增站点
          </Button>
          <Button
            icon={<CheckCircleOutlined />}
            size="large"
            onClick={onCheckAllSites}
            loading={batchChecking}
            disabled={batchChecking || list.length === 0}
            style={{
              background: batchChecking ? '#f0f0f0' : 'linear-gradient(135deg, #fa8c16 0%, #fa541c 100%)',
              border: 'none',
              height: 40,
              fontSize: 14,
              fontWeight: 600,
              color: batchChecking ? '#999' : 'white'
            }}
          >
            {batchChecking ? '检测中...' : '一键检测'}
          </Button>
          {hasLastResult && (
            <Button
              icon={<EyeOutlined />}
              size="large"
              onClick={loadLastBatchResult}
              disabled={batchChecking}
              style={{
                background: '#f0f0f0',
                border: '1px solid #d9d9d9',
                height: 40,
                fontSize: 14,
                fontWeight: 600,
                color: '#666'
              }}
            >
              查看结果
            </Button>
          )}
          <Button
            icon={<MailOutlined />}
            size="large"
            onClick={openEmailConfigModal}
            style={{
              background: emailConfigData?.enabled ? 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)' : '#f0f0f0',
              border: 'none',
              height: 40,
              fontSize: 14,
              fontWeight: 600,
              color: emailConfigData?.enabled ? 'white' : '#666'
            }}
          >
            邮件通知
          </Button>
          <Button
            icon={<ClockCircleOutlined />}
            size="large"
            onClick={() => {
              // 初始化表单
              if (scheduleConfig) {
                scheduleForm.setFieldsValue({
                  enabled: scheduleConfig.enabled || false,
                  time: dayjs().hour(scheduleConfig.hour || 9).minute(scheduleConfig.minute || 0),
                  interval: scheduleConfig.interval || 30,
                  overrideIndividual: scheduleConfig.overrideIndividual || false
                })
              } else {
                scheduleForm.setFieldsValue({
                  enabled: false,
                  time: dayjs().hour(9).minute(0),
                  interval: 30,
                  overrideIndividual: false
                })
              }
              setScheduleOpen(true)
            }}
            style={{
              background: scheduleConfig?.enabled ? 'linear-gradient(135deg, #1890ff 0%, #0050b3 100%)' : '#f0f0f0',
              border: 'none',
              height: 40,
              fontSize: 14,
              fontWeight: 600,
              color: scheduleConfig?.enabled ? 'white' : '#666'
            }}
          >
            定时检测
          </Button>
        </Space>
      }
      style={{
        borderRadius: 16,
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        background: '#fff'
      }}
      styles={{ body: { padding: '24px' } }}
    >

      {batchChecking && (
        <div style={{
          marginBottom: 16,
          padding: 16,
          background: '#fff7e6',
          border: '1px solid #ffd591',
          borderRadius: 8
        }}>
          <Typography.Text strong style={{ fontSize: 15, color: '#fa8c16', display: 'block', marginBottom: 12 }}>
            🔄 正在依次检测所有站点（每个站点间隔 5 秒）...
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            当前进度：{batchProgress.current} / {batchProgress.total}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            正在检测：{batchProgress.currentSite}
          </Typography.Text>
          <Progress
            percent={Math.round((batchProgress.current / batchProgress.total) * 100)}
            status="active"
            strokeColor={{
              '0%': '#fa8c16',
              '100%': '#fa541c',
            }}
          />
        </div>
      )}

      {/* 如果有搜索关键词，显示普通表格或移动端卡片 */}
      {searchKeyword ? (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            搜索结果：找到 {list.length} 个站点
          </Typography.Text>
          {isMobile ? (
            <div>{list.map(renderMobileSiteCard)}</div>
          ) : (
            <Table
              rowKey="id"
              dataSource={list}
              columns={columns}
              loading={loading}
              pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `共 ${total} 个站点` }}
              tableLayout="fixed"
              style={{ marginTop: 8 }}
            />
          )}
        </>
      ) : isMobile ? (
        /* 移动端：卡片列表 */
        <>
          {renderMobileSiteList(pinnedSites, '置顶站点', '#fa8c16', <PushpinFilled style={{ color: 'white' }} />, 'pinned')}
          {categories.map(cat => renderMobileSiteList(categorySitesMap.get(cat.id) || [], cat.name, '#1890ff', <FolderOutlined style={{ color: 'white' }} />, cat.id))}
          {renderMobileSiteList(uncategorizedSites, '未分类', '#8c8c8c', <FolderOutlined style={{ color: 'white' }} />, 'uncategorized')}
        </>
      ) : (
        /* 桌面端：按分类分组显示 */
        <>
          {/* 置顶站点 */}
          {pinnedSites.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div 
                style={{
                  background: 'linear-gradient(135deg, #fa8c16 0%, #fa541c 100%)',
                  padding: '14px 20px',
                  borderRadius: collapsedGroups.has('pinned') ? '12px' : '12px 12px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 16px rgba(250, 140, 22, 0.3)',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: '-50%',
                  right: '-10%',
                  width: '150px',
                  height: '150px',
                  background: 'radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 70%)',
                  borderRadius: '50%',
                  pointerEvents: 'none'
                }} />
                <Space onClick={() => toggleGroupCollapse('pinned')} style={{ cursor: 'pointer', flex: 1 }}>
                  {collapsedGroups.has('pinned') ? 
                    <RightOutlined style={{ color: 'white', fontSize: 12 }} /> : 
                    <DownOutlined style={{ color: 'white', fontSize: 12 }} />
                  }
                  <PushpinFilled style={{ color: 'white', fontSize: 16 }} />
                  <Typography.Text strong style={{ color: 'white', fontSize: 16 }}>
                    置顶站点
                  </Typography.Text>
                  <Tag color="orange" style={{ margin: 0 }}>
                    {pinnedSites.length} 个
                  </Tag>
                </Space>
                <Space onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={categoryCheckingId === 'pinned'}
                    disabled={categoryCheckingId !== null}
                    onClick={(e) => {
                      e.stopPropagation()
                      checkGroup('pinned', '置顶站点')
                    }}
                    style={{ 
                      background: 'rgba(255, 255, 255, 0.2)',
                      color: 'white', 
                      borderColor: 'rgba(255, 255, 255, 0.6)',
                      fontWeight: 600
                    }}
                  >
                    一键检测
                  </Button>
                </Space>
              </div>
              {!collapsedGroups.has('pinned') && (
                <MemoTable
                  dataSource={pinnedSites}
                  columns={columns}
                  loading={loading}
                />
              )}
            </div>
          )}

          {/* 各分类 */}
          {categories.map((category) => {
            const categorySites = categorySitesMap.get(category.id) || []
            if (categorySites.length === 0) return null
            const isCollapsed = collapsedGroups.has(category.id)

            return (
              <div 
                key={category.id} 
                style={{ marginBottom: 24 }}
              >
                <div style={{
                  background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
                  padding: '14px 20px',
                  borderRadius: isCollapsed ? '12px' : '12px 12px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 16px rgba(24, 144, 255, 0.3)',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                <div style={{
                  position: 'absolute',
                  top: '-50%',
                  right: '-10%',
                  width: '150px',
                  height: '150px',
                  background: 'radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 70%)',
                  borderRadius: '50%',
                  pointerEvents: 'none'
                }} />
                  <Space onClick={() => toggleGroupCollapse(category.id)} style={{ cursor: 'pointer', flex: 1 }}>
                    {isCollapsed ? 
                      <RightOutlined style={{ color: 'white', fontSize: 12 }} /> : 
                      <DownOutlined style={{ color: 'white', fontSize: 12 }} />
                    }
                    <FolderOutlined style={{ color: 'white', fontSize: 16 }} />
                    <Typography.Text strong style={{ color: 'white', fontSize: 16 }}>
                      {category.name}
                    </Typography.Text>
                    <Tag color="cyan" style={{ margin: 0 }}>
                      {categorySites.length} 个
                    </Tag>
                    {category.scheduleCron && (
                      <Tag icon={<ClockCircleOutlined />} color="blue" style={{ margin: 0 }}>
                        {cronToHm(category.scheduleCron)}
                      </Tag>
                    )}
                  </Space>
                  <Space onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={categoryCheckingId === category.id}
                      disabled={categoryCheckingId !== null}
                      onClick={(e) => {
                        e.stopPropagation()
                        checkCategory(category.id, category.name)
                      }}
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.2)',
                        color: 'white', 
                        borderColor: 'rgba(255, 255, 255, 0.6)',
                        fontWeight: 600
                      }}
                    >
                      一键检测
                    </Button>
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        openCategoryModal(category)
                      }}
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.2)',
                        color: 'white', 
                        borderColor: 'rgba(255, 255, 255, 0.6)',
                        fontWeight: 600
                      }}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确定删除该分类吗？"
                      description="该分类下的站点将变为未分类"
                      onConfirm={() => deleteCategory(category.id)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                        style={{ 
                          background: 'rgba(255, 77, 79, 0.8)',
                          color: 'white', 
                          borderColor: 'rgba(255, 255, 255, 0.6)',
                          fontWeight: 600
                        }}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
                {!isCollapsed && (
                  <MemoTable
                    dataSource={categorySites}
                    columns={columns}
                    loading={loading}
                  />
                )}
              </div>
            )
          })}

          {/* 未分类站点 */}
          {uncategorizedSites.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div 
                style={{
                  background: 'linear-gradient(135deg, #8c8c8c 0%, #595959 100%)',
                  padding: '14px 20px',
                  borderRadius: collapsedGroups.has('uncategorized') ? '12px' : '12px 12px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 16px rgba(140, 140, 140, 0.3)',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: '-50%',
                  right: '-10%',
                  width: '150px',
                  height: '150px',
                  background: 'radial-gradient(circle, rgba(255, 255, 255, 0.10) 0%, transparent 70%)',
                  borderRadius: '50%',
                  pointerEvents: 'none'
                }} />
                <Space onClick={() => toggleGroupCollapse('uncategorized')} style={{ cursor: 'pointer', flex: 1 }}>
                  {collapsedGroups.has('uncategorized') ? 
                    <RightOutlined style={{ color: 'white', fontSize: 12 }} /> : 
                    <DownOutlined style={{ color: 'white', fontSize: 12 }} />
                  }
                  <FolderOutlined style={{ color: 'white', fontSize: 16 }} />
                  <Typography.Text strong style={{ color: 'white', fontSize: 16 }}>
                    未分类
                  </Typography.Text>
                  <Tag color="default" style={{ margin: 0 }}>
                    {uncategorizedSites.length} 个
                  </Tag>
                </Space>
                <Space onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={categoryCheckingId === 'uncategorized'}
                    disabled={categoryCheckingId !== null}
                    onClick={(e) => {
                      e.stopPropagation()
                      checkGroup('uncategorized', '未分类')
                    }}
                    style={{ 
                      background: 'rgba(255, 255, 255, 0.2)',
                      color: 'white', 
                      borderColor: 'rgba(255, 255, 255, 0.6)',
                      fontWeight: 600
                    }}
                  >
                    一键检测
                  </Button>
                  <Popconfirm
                    title={<span style={{ color: '#ff4d4f', fontWeight: 600, fontSize: 16 }}>⚠️ 危险操作：删除所有未分类站点</span>}
                    description={
                      <div style={{ maxWidth: 350 }}>
                        <p style={{ marginBottom: 12 }}>
                          你即将删除 <strong style={{ color: '#ff4d4f', fontSize: 16 }}>{uncategorizedSites.length} 个</strong> 未分类站点
                        </p>
                        <div style={{ 
                          background: '#fff1f0', 
                          border: '1px solid #ffccc7', 
                          borderRadius: 6,
                          padding: 12,
                          marginBottom: 12
                        }}>
                          <p style={{ color: '#cf1322', fontWeight: 600, margin: 0, marginBottom: 8 }}>
                            🚨 重要提示：
                          </p>
                          <ul style={{ margin: 0, paddingLeft: 20, color: '#cf1322' }}>
                            <li>这将<strong>永久删除</strong>所有未分类站点</li>
                            <li>包括站点的<strong>所有历史检测数据</strong></li>
                            <li><strong>此操作不可恢复！</strong></li>
                          </ul>
                        </div>
                        <p style={{ 
                          color: '#8c8c8c', 
                          fontSize: 12,
                          margin: 0,
                          padding: 8,
                          background: '#f5f5f5',
                          borderRadius: 4
                        }}>
                          💡 注意：其他分类的"删除"是删除分类本身，站点会归入未分类。而这里是直接删除站点！
                        </p>
                      </div>
                    }
                    onConfirm={deleteUncategorizedSites}
                    okText="确认删除所有站点"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ 
                        background: 'rgba(255, 77, 79, 0.8)',
                        color: 'white', 
                        borderColor: 'rgba(255, 255, 255, 0.6)',
                        fontWeight: 600
                      }}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
              {!collapsedGroups.has('uncategorized') && (
                <MemoTable
                  dataSource={uncategorizedSites}
                  columns={columns}
                  loading={loading}
                />
              )}
            </div>
          )}
        </>
      )}

      {open && (
        <Modal
          open={open}
          onCancel={handleModalCancel}
          onOk={handleModalOk}
          title={
            <Typography.Title level={4} style={{ margin: 0 }}>
              {editMode ? '编辑站点' : '新增监控站点'}
            </Typography.Title>
          }
          okText={editMode ? '保存修改' : '创建站点'}
          cancelText="取消"
          width={560}
          destroyOnClose
          okButtonProps={{
            type: 'primary',
            style: {
              height: 40,
              fontSize: 15
            }
          }}
        >
          <Form layout="vertical" form={form} size="large" style={{ marginTop: 24 }}>
            <Form.Item
              name="name"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>站点名称</span>}
              rules={[{ required: true, message: '请输入站点名称' }]}
            >
              <Input
                placeholder="例如：我的AI中转站"
                style={{ borderRadius: 8, fontSize: 15 }}
              />
            </Form.Item>
            <Form.Item
              name="baseUrl"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>接口地址 (Base URL)</span>}
              rules={[
                { required: true, message: '请输入接口地址' },
                { type: 'url', message: '请输入有效的URL地址' }
              ]}
            >
              <Input
                prefix={<GlobalOutlined style={{ color: '#bbb' }} />}
                placeholder="https://api.yourrelay.com"
                style={{ borderRadius: 8, fontSize: 15 }}
              />
            </Form.Item>
            <Form.Item
              name="proxyUrl"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>站点代理（可选）</span>}
              rules={[{ validator: validateProxyUrl }]}
              extra="支持 http(s):// 或 socks5:// 代理；配置后该站点所有后端访问都将走这个代理"
            >
              <Input
                prefix={<GlobalOutlined style={{ color: '#bbb' }} />}
                placeholder="例如：http://127.0.0.1:7890 或 socks5://user:pass@host:1080"
                style={{ borderRadius: 8, fontSize: 15 }}
              />
            </Form.Item>
            <Form.Item
              name="apiType"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>API 类型</span>}
              rules={[{ required: true, message: '请选择API类型' }]}
              initialValue="newapi"
            >
              <Select
                placeholder="选择API类型"
                style={{ borderRadius: 8, fontSize: 15 }}
                options={[
                  { value: 'newapi', label: 'New API' },
                  { value: 'veloera', label: 'Veloera' },
                  { value: 'donehub', label: 'DoneHub' },
                  { value: 'voapi', label: 'VOAPI' },
                  { value: 'other', label: '其他 (OpenAI标准)' }
                ]}
              />
            </Form.Item>
            <Form.Item
              name="apiKey"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>API 密钥</span>}
              rules={[{ required: !editMode, message: '请输入API密钥' }]}
              extra={editMode ? '留空表示不修改密钥' : ''}
            >
              <Input.Password
                placeholder={editMode ? '留空表示不修改密钥' : '请输入 API 密钥'}
                style={{ borderRadius: 8, fontSize: 15 }}
              />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(prev, curr) => prev.apiType !== curr.apiType}
            >
              {({ getFieldValue }) => {
                const apiType = getFieldValue('apiType')
                const needsUserId = apiType === 'newapi' || apiType === 'veloera'
                
                if (needsUserId) {
                  return (
                    <Form.Item
                      name="userId"
                      label={<span style={{ fontSize: 15, fontWeight: 500 }}>用户 ID</span>}
                      rules={[{ required: true, message: '请输入用户ID' }]}
                      extra={`用于 ${apiType === 'newapi' ? 'New API' : 'Veloera'} 鉴权的用户ID`}
                    >
                      <Input
                        placeholder="例如：1"
                        style={{ borderRadius: 8, fontSize: 15 }}
                      />
                    </Form.Item>
                  )
                }
                return null
              }}
            </Form.Item>

            {/* Billing配置 - 仅对"other"类型显示 */}
            <Form.Item
              noStyle
              shouldUpdate={(prev, curr) => prev.apiType !== curr.apiType}
            >
              {({ getFieldValue }) => {
                const apiType = getFieldValue('apiType')
                const showBillingConfig = apiType === 'other'
                return showBillingConfig ? (
                  <div style={{
                    padding: 16,
                    background: '#f8f9fa',
                    borderRadius: 8,
                    border: '1px solid #e9ecef',
                    marginBottom: 16
                  }}>
                    <div 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        cursor: 'pointer', 
                        marginBottom: 12 
                      }}
                      onClick={() => setBillingConfigExpanded(!billingConfigExpanded)}
                    >
                      {billingConfigExpanded ? 
                        <DownOutlined style={{ fontSize: 12, color: '#495057', marginRight: 8 }} /> : 
                        <RightOutlined style={{ fontSize: 12, color: '#495057', marginRight: 8 }} />
                      }
                      <Typography.Text strong style={{ fontSize: 15, color: '#495057' }}>
                        自定义用量查询配置（可选）
                      </Typography.Text>
                    </div>
                    {billingConfigExpanded && (
                      <>
                        <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
                          配置自定义的用量查询接口，支持Token或Cookie认证，并可指定JSON字段映射
                        </Typography.Text>

                    <Form.Item
                      name="billingUrl"
                      label={<span style={{ fontSize: 14, fontWeight: 500 }}>用量查询URL</span>}
                      rules={[{ type: 'url', message: '请输入有效的URL地址' }]}
                      style={{ marginBottom: 12 }}
                    >
                      <Input
                        placeholder="https://api.example.com/user/info"
                        style={{ borderRadius: 6, fontSize: 14 }}
                      />
                    </Form.Item>

                    <Form.Item
                      name="billingAuthType"
                      label={<span style={{ fontSize: 14, fontWeight: 500 }}>认证方式</span>}
                      initialValue="token"
                      style={{ marginBottom: 12 }}
                    >
                      <Select
                        style={{ borderRadius: 6, fontSize: 14 }}
                        options={[
                          { value: 'token', label: 'Token 认证' },
                          { value: 'cookie', label: 'Cookie 认证' }
                        ]}
                      />
                    </Form.Item>

                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.billingAuthType !== curr.billingAuthType}
                    >
                      {({ getFieldValue }) => {
                        const authType = getFieldValue('billingAuthType')
                        return (
                          <Form.Item
                            name="billingAuthValue"
                            label={<span style={{ fontSize: 14, fontWeight: 500 }}>
                              {authType === 'token' ? 'Authentication Token' : 'Cookie Value'}
                            </span>}
                            extra={authType === 'token'
                              ? '输入Bearer token或API key，系统会自动添加Bearer前缀'
                              : '输入完整的Cookie字符串，例如：session=abc123; auth=xyz789'
                            }
                            style={{ marginBottom: 0 }}
                          >
                            <Input.Password
                              placeholder={authType === 'token'
                                ? 'sk-1234567890abcdef...'
                                : 'session=abc123; auth=xyz789'
                              }
                              style={{ borderRadius: 6, fontSize: 14 }}
                            />
                          </Form.Item>
                        )
                      }}
                    </Form.Item>
                    
                    <Typography.Text strong style={{ fontSize: 14, color: '#495057', display: 'block', marginTop: 16, marginBottom: 12 }}>
                      JSON字段映射（可选）
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                      指定响应JSON中的字段名，支持嵌套字段如 "data.balance"
                    </Typography.Text>
                    
                    <div style={{ display: 'flex', gap: 12 }}>
                      <Form.Item
                        name="billingLimitField"
                        label={<span style={{ fontSize: 13, fontWeight: 500 }}>余额字段名</span>}
                        style={{ flex: 1, marginBottom: 0 }}
                      >
                        <Input
                          placeholder="data.balance"
                          style={{ borderRadius: 6, fontSize: 13 }}
                        />
                      </Form.Item>
                      
                      <Form.Item
                        name="billingUsageField"
                        label={<span style={{ fontSize: 13, fontWeight: 500 }}>使用量字段名</span>}
                        style={{ flex: 1, marginBottom: 0 }}
                      >
                        <Input
                          placeholder="data.used"
                          style={{ borderRadius: 6, fontSize: 13 }}
                        />
                      </Form.Item>
                    </div>
                      </>
                    )}
                  </div>
                ) : null
              }}
            </Form.Item>

            <Form.Item
              name="categoryId"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>所属分类（可选）</span>}
              extra="将站点归类便于管理，置顶站点不受分类影响"
            >
              <Select
                placeholder="选择分类（不选表示无分类）"
                style={{ borderRadius: 8, fontSize: 15 }}
                allowClear
                options={[
                  ...categories.map(cat => ({ value: cat.id, label: cat.name }))
                ]}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>定时检测（可选）</span>}
              extra="设置每日自动检测的北京时间，不设置则使用系统默认计划"
            >
              <Space size={12} align="center">
                <Form.Item name="cnHour" noStyle>
                  <InputNumber
                    min={0}
                    max={23}
                    placeholder="小时 (0-23)"
                    style={{ width: 140, borderRadius: 8, fontSize: 15 }}
                  />
                </Form.Item>
                <Typography.Text strong style={{ fontSize: 18 }}>:</Typography.Text>
                <Form.Item name="cnMinute" noStyle>
                  <InputNumber
                    min={0}
                    max={59}
                    placeholder="分钟 (0-59)"
                    style={{ width: 140, borderRadius: 8, fontSize: 15 }}
                  />
                </Form.Item>
              </Space>
            </Form.Item>

            <Form.Item
              name="extralink"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>附加链接（可选）</span>}
              extra="显示在站点名称下方的附加签到站链接"
            >
              <Input
                placeholder="例如：https://extra.example.com"
                style={{ borderRadius: 8, fontSize: 15 }}
              />
            </Form.Item>

            <Form.Item
              name="remark"
              label={<span style={{ fontSize: 15, fontWeight: 500 }}>备注（可选）</span>}
              extra="显示在操作列前方的备注信息"
            >
              <Input
                placeholder="例如：测试站点"
                style={{ borderRadius: 8, fontSize: 15 }}
              />
            </Form.Item>

            <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>置顶设置</span>
                </div>
                <Form.Item
                  name="pinned"
                  valuePropName="checked"
                  style={{ marginBottom: 0 }}
                >
                  <Switch
                    checkedChildren="已置顶"
                    unCheckedChildren="未置顶"
                  />
                </Form.Item>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>一键检测</span>
                </div>
                <Form.Item
                  name="excludeFromBatch"
                  valuePropName="checked"
                  style={{ marginBottom: 0 }}
                >
                  <Switch
                    checkedChildren="排除"
                    unCheckedChildren="参与"
                  />
                </Form.Item>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>余额类型</span>
                </div>
                <Form.Item
                  name="unlimitedQuota"
                  valuePropName="checked"
                  style={{ marginBottom: 0 }}
                >
                  <Switch
                    checkedChildren="无限余额"
                    unCheckedChildren="普通余额"
                  />
                </Form.Item>
              </div>
            </div>
            
            {/* 签到配置 - Veloera、NewAPI 和 VOAPI 类型显示 */}
            <Form.Item
              noStyle
              shouldUpdate={(prev, curr) => prev.apiType !== curr.apiType}
            >
              {({ getFieldValue }) => {
                const apiType = getFieldValue('apiType')
                const showCheckIn = apiType === 'veloera' || apiType === 'newapi' || apiType === 'voapi'
                return showCheckIn ? (
                  <>
                    <Divider style={{ margin: '16px 0' }}>签到配置</Divider>
                    <Form.Item
                      name="enableCheckIn"
                      label={<span style={{ fontSize: 15, fontWeight: 500 }}>启用自动签到</span>}
                      valuePropName="checked"
                      extra="Veloera、NewAPI 和 VOAPI 类型支持自动签到功能"
                      initialValue={false}
                    >
                      <Switch
                        checkedChildren="已启用"
                        unCheckedChildren="未启用"
                      />
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.enableCheckIn !== curr.enableCheckIn}
                    >
                      {({ getFieldValue }) => {
                        const enableCheckIn = getFieldValue('enableCheckIn')
                        return enableCheckIn ? (
                          <Form.Item
                            name="checkInMode"
                            label={<span style={{ fontSize: 15, fontWeight: 500 }}>定时检测模式</span>}
                            extra="手动点击立即检测时始终同时执行签到和模型检测"
                            initialValue="both"
                          >
                            <Select
                              style={{ borderRadius: 8, fontSize: 15 }}
                              options={[
                                { value: 'both', label: '两者都检测（推荐）' },
                                { value: 'model', label: '仅检测模型' },
                                { value: 'checkin', label: '仅执行签到' }
                              ]}
                            />
                          </Form.Item>
                        ) : null
                      }}
                    </Form.Item>
                  </>
                ) : null
              }}
            </Form.Item>
          </Form>
        </Modal>
      )}

      {timeOpen && (
        <Modal
          open={timeOpen}
          onCancel={() => setTimeOpen(false)}
          onOk={saveTime}
          title={<Typography.Title level={4} style={{ margin: 0 }}>设置单独检测时间</Typography.Title>}
          okText="保存设置"
          cancelText="取消"
          width={520}
          destroyOnClose
          okButtonProps={{
            type: 'primary',
            style: {
              height: 40,
              fontSize: 15
            }
          }}
        >
          <div style={{ marginTop: 24 }}>
            <div style={{ background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 13 }}>
              <p style={{ margin: '0 0 8px 0', color: '#0050b3' }}>👉 <strong>单独配置说明：</strong></p>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#0050b3' }}>
                <li>此站点将在每天指定时间<strong>单独运行</strong>检测</li>
                <li>不受全局定时配置影响，优先级更高</li>
                <li>检测到变更后会<strong>单独发送邮件通知</strong></li>
                <li><strong>留空两个输入框</strong>可取消定时检测</li>
              </ul>
            </div>
            <Form layout="vertical" form={timeForm} size="large">
              <Space size={16} align="center" style={{ width: '100%', justifyContent: 'center' }}>
                <Form.Item
                  name="cnHour"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber
                    min={0}
                    max={23}
                    placeholder="小时（留空取消）"
                    style={{ width: 140, borderRadius: 8, fontSize: 16 }}
                    controls={false}
                    parser={(value) => value === '' ? null : parseInt(value)}
                    formatter={(value) => value === null || value === undefined ? '' : String(value)}
                  />
                </Form.Item>
                <Typography.Text strong style={{ fontSize: 24 }}>:</Typography.Text>
                <Form.Item
                  name="cnMinute"
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber
                    min={0}
                    max={59}
                    placeholder="分钟（留空取消）"
                    style={{ width: 140, borderRadius: 8, fontSize: 16 }}
                    controls={false}
                    parser={(value) => value === '' ? null : parseInt(value)}
                    formatter={(value) => value === null || value === undefined ? '' : String(value)}
                  />
                </Form.Item>
              </Space>
            </Form>
          </div>
        </Modal>
      )}

      {debugOpen && (
        <Modal
          open={debugOpen}
          onCancel={() => setDebugOpen(false)}
          footer={[
            <Button key="close" onClick={() => setDebugOpen(false)}>关闭</Button>
          ]}
          title={<Typography.Title level={4} style={{ margin: 0 }}>🐛 请求详情</Typography.Title>}
          width={800}
          destroyOnClose
        >
          {debugLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Typography.Text>加载中...</Typography.Text>
            </div>
          ) : debugData ? (
            <div style={{ marginTop: 24 }}>
              <div style={{ marginBottom: 20 }}>
                <Typography.Title level={5}>站点信息</Typography.Title>
                <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, fontSize: 13 }}>
                  <p style={{ margin: '4px 0' }}><strong>站点名称：</strong>{debugData.siteName}</p>
                  <p style={{ margin: '4px 0' }}><strong>接口地址：</strong>{debugData.siteUrl}</p>
                  <p style={{ margin: '4px 0' }}><strong>检测时间：</strong>{new Date(debugData.fetchedAt).toLocaleString('zh-CN')}</p>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <Typography.Title level={5}>请求状态</Typography.Title>
                <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, fontSize: 13 }}>
                  <p style={{ margin: '4px 0' }}>
                    <strong>HTTP 状态码：</strong>
                    {debugData.statusCode ? (
                      <Tag color={debugData.statusCode === 200 ? 'success' : 'error'}>
                        {debugData.statusCode}
                      </Tag>
                    ) : (
                      <Tag color="default">无数据</Tag>
                    )}
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong>响应时间：</strong>
                    {debugData.responseTime ? `${debugData.responseTime}ms` : '无数据'}
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong>模型数量：</strong>
                    {Array.isArray(debugData.modelsJson) ? debugData.modelsJson.length : 0}
                  </p>
                </div>
              </div>

              {/* Billing 信息 - 总是显示 */}
              <div style={{ marginBottom: 20 }}>
                <Typography.Title level={5}>💳 Billing 信息</Typography.Title>
                <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8, fontSize: 13 }}>
                  {(typeof debugData.billingLimit === 'number') && (
                    <p style={{ margin: '4px 0' }}>
                      <strong>额度上限：</strong>
                      <Tag color="blue">${debugData.billingLimit.toFixed(2)}</Tag>
                    </p>
                  )}
                  {(typeof debugData.billingUsage === 'number') && (
                    <p style={{ margin: '4px 0' }}>
                      <strong>已使用：</strong>
                      <Tag color="orange">${debugData.billingUsage.toFixed(1)}</Tag>
                    </p>
                  )}
                  {(typeof debugData.billingLimit === 'number' && typeof debugData.billingUsage === 'number') && (
                    <p style={{ margin: '4px 0' }}>
                      <strong>剩余：</strong>
                      <Tag color="green">${(debugData.billingLimit - debugData.billingUsage).toFixed(2)}</Tag>
                    </p>
                  )}
                  {debugData.billingError && (
                    <p style={{ margin: '4px 0', color: '#ff4d4f' }}>
                      <strong>错误：</strong>{debugData.billingError}
                    </p>
                  )}
                  {(typeof debugData.billingLimit !== 'number' && typeof debugData.billingUsage !== 'number' && !debugData.billingError) && (
                    <p style={{ margin: '4px 0', color: '#8c8c8c' }}>
                      未获取到 Billing 信息（可能是该站点不支持此 API）
                    </p>
                  )}
                </div>
              </div>

              {debugData.errorMessage && (
                <div style={{ marginBottom: 20 }}>
                  <Typography.Title level={5} style={{ color: '#ff4d4f' }}>
                    ❌ 错误信息
                  </Typography.Title>
                  <div style={{
                    background: '#fff2f0',
                    border: '1px solid #ffccc7',
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 13,
                    color: '#cf1322',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {debugData.errorMessage}
                  </div>
                </div>
              )}

              {debugData.modelsJson && Array.isArray(debugData.modelsJson) && debugData.modelsJson.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <Typography.Title level={5}>✅ 获取到的模型列表 ({debugData.modelsJson.length})</Typography.Title>
                  <div style={{
                    background: '#f5f5f5',
                    padding: 12,
                    borderRadius: 8,
                    maxHeight: 200,
                    overflow: 'auto'
                  }}>
                    {debugData.modelsJson.map((model, idx) => (
                      <Tag key={idx} style={{ margin: 4 }}>{model.id}</Tag>
                    ))}
                  </div>
                </div>
              )}

              {debugData.rawResponse && (
                <div style={{ marginBottom: 20 }}>
                  <Typography.Title level={5}>📄 原始响应</Typography.Title>
                  <Input.TextArea
                    value={debugData.rawResponse}
                    rows={10}
                    readOnly
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      background: '#f5f5f5'
                    }}
                  />
                  <Button
                    size="small"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      copyText(debugData.rawResponse, '已复制到剪贴板')
                    }}
                  >
                    复制原始响应
                  </Button>
                </div>
              )}

              {!debugData.errorMessage && (!debugData.modelsJson || debugData.modelsJson.length === 0) && (
                <div style={{
                  background: '#fffbe6',
                  border: '1px solid #ffe58f',
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#d48806'
                }}>
                  ⚠️ 未获取到任何模型数据，请检查 API 密钥是否正确，或查看原始响应了解详情。
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Typography.Text type="secondary">暂无数据</Typography.Text>
            </div>
          )}
        </Modal>
      )}

      {emailConfigOpen && (
        <Modal
          open={emailConfigOpen}
          onCancel={() => { setEmailConfigOpen(false); emailConfigForm.resetFields() }}
          onOk={saveEmailConfig}
          title={<Typography.Title level={4} style={{ margin: 0 }}>📧 全局邮件通知配置</Typography.Title>}
          okText="保存配置"
          cancelText="取消"
          width={600}
          destroyOnClose
          okButtonProps={{
            style: {
              background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)',
              border: 'none',
              height: 40,
              fontSize: 15
            }
          }}
        >
          <div style={{ marginTop: 24 }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 20, fontSize: 14 }}>
              配置全局邮件通知，任何站点检测到模型变更时都会自动发送邮件
            </Typography.Paragraph>

            {emailConfigData?.enabled && (
              <div style={{
                background: '#f6ffed',
                border: '1px solid #b7eb8f',
                borderRadius: 8,
                padding: 12,
                marginBottom: 20,
                fontSize: 13,
                color: '#389e0d'
              }}>
                ✅ 邮件通知已启用，当前收件人：{emailConfigData.notifyEmails}
              </div>
            )}

            <Form layout="vertical" form={emailConfigForm} size="large">
              <Form.Item
                name="resendApiKey"
                label={<span style={{ fontSize: 15, fontWeight: 500 }}>Resend API Key</span>}
                rules={[{ required: true, message: '请输入 Resend API Key' }]}
                extra="获取密钥：https://resend.com/api-keys"
              >
                <Input.Password
                  placeholder="re_xxxxxxxxx"
                  style={{ borderRadius: 8, fontSize: 15 }}
                  prefix={<MailOutlined style={{ color: '#bbb' }} />}
                />
              </Form.Item>

              <Form.Item
                name="notifyEmails"
                label={<span style={{ fontSize: 15, fontWeight: 500 }}>收件人邮箱</span>}
                rules={[
                  { required: true, message: '请输入至少一个收件人邮箱' },
                  {
                    validator: (_, value) => {
                      if (!value || !value.trim()) {
                        return Promise.reject(new Error('请输入至少一个收件人邮箱'))
                      }
                      const emails = value.split(',').map(e => e.trim()).filter(Boolean)
                      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                      for (const email of emails) {
                        if (!emailRegex.test(email)) {
                          return Promise.reject(new Error(`邮箱格式不正确：${email}`))
                        }
                      }
                      return Promise.resolve()
                    }
                  }
                ]}
                extra="多个邮箱用英文逗号分隔，例如：user1@example.com,user2@example.com"
              >
                <Input.TextArea
                  placeholder="user@example.com,admin@example.com"
                  rows={3}
                  style={{ borderRadius: 8, fontSize: 15 }}
                />
              </Form.Item>
            </Form>

            <div style={{
              background: '#f0f7ff',
              border: '1px solid #91d5ff',
              borderRadius: 8,
              padding: 16,
              marginTop: 20
            }}>
              <Typography.Title level={5} style={{ margin: 0, marginBottom: 8, color: '#0050b3' }}>
                ℹ️ 功能说明
              </Typography.Title>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#666' }}>
                <li>全局配置：所有站点共用一个邮件配置</li>
                <li>智能通知：只有当任何站点检测到模型变更时才发送</li>
                <li>详细内容：邮件包含站点名称、变更详情等信息</li>
                <li>团队协作：支持配置多个收件人邮箱</li>
              </ul>
            </div>
          </div>
        </Modal>
      )}

      {scheduleOpen && (
        <Modal
          title="一键定时检测设置"
          open={scheduleOpen}
          destroyOnClose
          onOk={async () => {
            try {
              const v = await scheduleForm.validateFields()
              const time = dayjs(v.time)
              const res = await fetch('/api/schedule-config', {
                method: 'POST',
                headers: authHeaders(true),
                body: JSON.stringify({
                  enabled: v.enabled,
                  hour: time.hour(),
                  minute: time.minute(),
                  interval: v.interval,
                  overrideIndividual: v.overrideIndividual || false
                })
              })
              const data = await res.json()
              if (data.ok) {
                message.success('定时配置已保存')
                setScheduleConfig(data.config)
                setScheduleOpen(false)
                scheduleForm.resetFields()
                // 重新加载定时配置和站点列表
                await loadScheduleConfig()
                await load()
              } else {
                message.error(data.error || '保存失败')
              }
            } catch (e) {
              message.error(e.message || '保存失败')
            }
          }}
          onCancel={() => {
            setScheduleOpen(false)
            scheduleForm.resetFields()
          }}
          okText="保存"
          cancelText="取消"
          width={500}
        >
          <Form form={scheduleForm} layout="vertical" style={{ marginTop: 24 }}>
            <Form.Item label="启用定时检测" name="enabled" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
            <Form.Item label="检测时间（北京时间）" name="time" rules={[{ required: true }]}>
              <TimePicker format="HH:mm" showSecond={false} placeholder="选择时间" />
            </Form.Item>
            <Form.Item label="站点间隔时间（秒）" name="interval" rules={[{ required: true, type: 'number', min: 5, max: 300 }]} extra="建议10秒以上以避免服务器过载">
              <InputNumber min={5} max={300} addonAfter="秒" style={{ width: '100%' }} placeholder="30" />
            </Form.Item>
            <Form.Item
              label={
                <span>
                  覆盖单独配置
                  <Tooltip title="勾选后，所有站点都使用全局配置，忽略单独设置的时间">
                    <span style={{ marginLeft: 4, color: '#999', cursor: 'help' }}>❓</span>
                  </Tooltip>
                </span>
              }
              name="overrideIndividual"
              valuePropName="checked"
              extra="勾选后，即使站点有单独定时配置也会被忽略，统一使用全局配置"
            >
              <Switch checkedChildren="覆盖" unCheckedChildren="不覆盖" />
            </Form.Item>
          </Form>
          <div style={{ marginTop: 16, padding: 12, background: '#f0f2ff', borderRadius: 4, fontSize: 12, color: '#666' }}>
            <p style={{ margin: '0 0 8px 0' }}>📋 <strong>全局定时检测说明：</strong></p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li><strong>不覆盖模式</strong>：只检测没有单独配置的站点，有单独配置的站点不受影响，会单独发送邮件</li>
              <li><strong>覆盖模式</strong>：检测所有站点，忽略单独配置，统一使用全局时间</li>
              <li>所有站点检测完毕后，会将所有变更<strong>聚合到一封邮件</strong>中发送</li>
              <li>间隔时间用于防止同时请求多个站点，建议30秒以上</li>
            </ul>
          </div>
        </Modal>
      )}

      {/* 一键检测结果展示 */}
      {batchResultOpen && (
        <Modal
          title={
            <div style={{ fontSize: 20, fontWeight: 600, color: '#333' }}>
              📊 一键检测结果
            </div>
          }
          open={batchResultOpen}
          onCancel={() => setBatchResultOpen(false)}
          maskClosable={false}
          destroyOnClose
          footer={[
            <Button key="close" type="primary" onClick={() => setBatchResultOpen(false)}>
              关闭
            </Button>
          ]}
          width={900}
          style={{ top: 20 }}
        >
          <div style={{ marginTop: 20 }}>
            {/* 汇总信息 */}
            <div style={{
              background: '#e6f7ff',
              borderLeft: '4px solid #1890ff',
              padding: 16,
              marginBottom: 20,
              borderRadius: 4
            }}>
              <p style={{ margin: 0, color: '#0050b3', fontSize: 14 }}>
                <strong>📅 检测时间：</strong>
                {batchResults.timestamp ? new Date(batchResults.timestamp).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN')}
              </p>
              <p style={{ margin: '8px 0 0 0', color: '#0050b3', fontSize: 14 }}>
                <strong>🎯 检测站点：</strong>{batchResults.totalSites || list.length} 个
              </p>
              {batchResults.changes.length > 0 && (
                <p style={{ margin: '8px 0 0 0', color: '#0050b3', fontSize: 14 }}>
                  <strong>🔄 发生变更：</strong>{batchResults.changes.length} 个站点
                </p>
              )}
              {batchResults.failures.length > 0 && (
                <p style={{ margin: '8px 0 0 0', color: '#cf1322', fontSize: 14 }}>
                  <strong>⚠️ 检测失败：</strong>{batchResults.failures.length} 个站点
                </p>
              )}
            </div>

            {/* 统计卡片 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
              <div style={{
                flex: 1,
                background: '#f6ffed',
                border: '1px solid #b7eb8f',
                padding: 16,
                borderRadius: 8,
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 32, fontWeight: 'bold', color: '#52c41a' }}>
                  {batchResults.changes.reduce((sum, s) => sum + (s.diff.added?.length || 0), 0)}
                </div>
                <div style={{ color: '#389e0d', marginTop: 8, fontSize: 14, fontWeight: 600 }}>
                  ➕ 新增模型
                </div>
              </div>
              <div style={{
                flex: 1,
                background: '#fff2f0',
                border: '1px solid #ffccc7',
                padding: 16,
                borderRadius: 8,
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 32, fontWeight: 'bold', color: '#ff4d4f' }}>
                  {batchResults.changes.reduce((sum, s) => sum + (s.diff.removed?.length || 0), 0)}
                </div>
                <div style={{ color: '#cf1322', marginTop: 8, fontSize: 14, fontWeight: 600 }}>
                  ➖ 移除模型
                </div>
              </div>
            </div>

            {/* 无变更提示 */}
            {batchResults.changes.length === 0 && batchResults.failures.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: 40,
                color: '#999',
                background: '#fafafa',
                borderRadius: 8
              }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 500 }}>所有站点均无变更</div>
              </div>
            )}

            {/* 变更详情 */}
            {batchResults.changes.map((siteChange, idx) => {
              const { siteName, diff } = siteChange
              const isExpanded = expandedSites.has(idx)
              const toggleExpand = () => {
                const newExpanded = new Set(expandedSites)
                if (isExpanded) {
                  newExpanded.delete(idx)
                } else {
                  newExpanded.add(idx)
                }
                setExpandedSites(newExpanded)
              }

              return (
                <div key={idx} style={{
                  marginBottom: 16,
                  border: '1px solid #e8e8e8',
                  borderRadius: 8,
                  overflow: 'hidden'
                }}>
                  <div
                    onClick={toggleExpand}
                    style={{
                      background: 'linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%)',
                      padding: 12,
                      fontWeight: 600,
                      fontSize: 15,
                      cursor: 'pointer',
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span>
                      <span style={{ marginRight: 8, fontSize: 14 }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      🎯 {siteName}
                    </span>
                    <span style={{
                      background: '#1890ff',
                      color: 'white',
                      padding: '2px 10px',
                      borderRadius: 10,
                      fontSize: 12,
                      fontWeight: 'normal'
                    }}>
                      {(diff.added?.length || 0) + (diff.removed?.length || 0)} 项变更
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: 16, background: '#fafafa' }}>
                      {/* 新增模型 */}
                      {diff.added && diff.added.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{
                            color: '#52c41a',
                            fontWeight: 600,
                            marginBottom: 8,
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{
                                background: '#52c41a',
                                color: 'white',
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12
                              }}>➕</span>
                              新增模型 ({diff.added.length})
                            </div>
                            <Button
                              type="text"
                              size="small"
                              style={{ fontSize: 12, color: '#52c41a', padding: '4px 8px' }}
                              onClick={() => {
                                const names = diff.added.map(m => m.id).join(',')
                                copyText(names, `已复制 ${diff.added.length} 个模型ID`)
                              }}
                            >
                              复制全部
                            </Button>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {diff.added.slice(0, 30).map((model, i) => (
                              <Tag
                                key={i}
                                color="success"
                                style={{
                                  margin: 0,
                                  fontFamily: 'monospace',
                                  fontSize: 12,
                                  cursor: 'pointer'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  copyText(model.id, `已复制: ${model.id}`)
                                }}
                              >
                                {model.id}
                              </Tag>
                            ))}
                            {diff.added.length > 30 && (
                              <span style={{ color: '#666', fontSize: 12, padding: '0 8px', alignSelf: 'center' }}>
                                ... 还有 {diff.added.length - 30} 个
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 移除模型 */}
                      {diff.removed && diff.removed.length > 0 && (
                        <div>
                          <div style={{
                            color: '#ff4d4f',
                            fontWeight: 600,
                            marginBottom: 8,
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{
                                background: '#ff4d4f',
                                color: 'white',
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12
                              }}>➖</span>
                              移除模型 ({diff.removed.length})
                            </div>
                            <Button
                              type="text"
                              size="small"
                              style={{ fontSize: 12, color: '#ff4d4f', padding: '4px 8px' }}
                              onClick={() => {
                                const names = diff.removed.map(m => m.id).join(',')
                                copyText(names, `已复制 ${diff.removed.length} 个模型ID`)
                              }}
                            >
                              复制全部
                            </Button>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {diff.removed.slice(0, 30).map((model, i) => (
                              <Tag
                                key={i}
                                color="error"
                                style={{
                                  margin: 0,
                                  fontFamily: 'monospace',
                                  fontSize: 12,
                                  cursor: 'pointer'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  copyText(model.id, `已复制: ${model.id}`)
                                }}
                              >
                                {model.id}
                              </Tag>
                            ))}
                            {diff.removed.length > 30 && (
                              <span style={{ color: '#666', fontSize: 12, padding: '0 8px', alignSelf: 'center' }}>
                                ... 还有 {diff.removed.length - 30} 个
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* 失败站点 */}
            {batchResults.failures.length > 0 && (
              <div style={{
                marginTop: 20,
                padding: 16,
                background: '#fff2f0',
                border: '2px solid #ffccc7',
                borderRadius: 8
              }}>
                <div style={{
                  color: '#cf1322',
                  fontSize: 16,
                  fontWeight: 600,
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <span style={{ fontSize: 20 }}>⚠️</span>
                  检测失败的站点 ({batchResults.failures.length})
                </div>
                {batchResults.failures.map((failed, idx) => (
                  <div key={idx} style={{
                    background: 'white',
                    borderLeft: '4px solid #ff4d4f',
                    padding: 12,
                    marginBottom: idx < batchResults.failures.length - 1 ? 12 : 0,
                    borderRadius: 4
                  }}>
                    <div style={{ fontWeight: 600, color: '#333', marginBottom: 6, fontSize: 14 }}>
                      {failed.siteName}
                    </div>
                    <div style={{
                      color: '#8c8c8c',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      background: '#f5f5f5',
                      padding: 8,
                      borderRadius: 4,
                      wordBreak: 'break-all'
                    }}>
                      {failed.error}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 分类管理Modal */}
      {categoryModalOpen && (
        <Modal
          title={
            <Typography.Title level={4} style={{ margin: 0 }}>
              {editingCategory ? '编辑分类' : '创建新分类'}
            </Typography.Title>
          }
          open={categoryModalOpen}
          onCancel={() => {
            setCategoryModalOpen(false)
            setEditingCategory(null)
            categoryForm.resetFields()
          }}
          onOk={saveCategoryHandler}
          okText={editingCategory ? '保存修改' : '创建分类'}
          cancelText="取消"
          width={600}
          destroyOnClose
          okButtonProps={{
            type: 'primary',
            style: {
              height: 40,
              fontSize: 15
            }
          }}
        >
          <div style={{ marginTop: 24 }}>
            {!editingCategory && (
              <div style={{
                background: '#e6fffb',
                border: '1px solid #87e8de',
                borderRadius: 8,
                padding: 12,
                marginBottom: 20,
                fontSize: 13
              }}>
                <p style={{ margin: '0 0 8px 0', color: '#006d75' }}>
                  💡 <strong>分类功能说明：</strong>
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#006d75' }}>
                  <li>创建分类后，可以在站点编辑页面将站点归类</li>
                  <li>同一分类可以配置统一的检测时间</li>
                  <li>支持对分类内的所有站点进行一键检测</li>
                  <li>置顶站点不参与分类，始终显示在最前面</li>
                </ul>
              </div>
            )}

            <Form layout="vertical" form={categoryForm} size="large">
              <Form.Item
                name="name"
                label={<span style={{ fontSize: 15, fontWeight: 500 }}>分类名称</span>}
                rules={[{ required: true, message: '请输入分类名称' }]}
              >
                <Input
                  placeholder="例如：生产环境、测试环境、个人站点"
                  style={{ borderRadius: 8, fontSize: 15 }}
                  prefix={<FolderOutlined style={{ color: '#bbb' }} />}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ fontSize: 15, fontWeight: 500 }}>定时检测（可选）</span>}
                extra="设置该分类下所有站点的统一检测时间（北京时间）"
              >
                <Space size={12} align="center">
                  <Form.Item name="cnHour" noStyle>
                    <InputNumber
                      min={0}
                      max={23}
                      placeholder="小时 (0-23)"
                      style={{ width: 140, borderRadius: 8, fontSize: 15 }}
                    />
                  </Form.Item>
                  <Typography.Text strong style={{ fontSize: 18 }}>:</Typography.Text>
                  <Form.Item name="cnMinute" noStyle>
                    <InputNumber
                      min={0}
                      max={59}
                      placeholder="分钟 (0-59)"
                      style={{ width: 140, borderRadius: 8, fontSize: 15 }}
                    />
                  </Form.Item>
                </Space>
              </Form.Item>
            </Form>

            {editingCategory && editingCategory.sites && editingCategory.sites.length > 0 && (
              <div style={{
                background: '#f0f7ff',
                border: '1px solid #91d5ff',
                borderRadius: 8,
                padding: 12,
                marginTop: 16
              }}>
                <Typography.Text strong style={{ color: '#0050b3', fontSize: 13 }}>
                  该分类下有 {editingCategory.sites.length} 个站点
                </Typography.Text>
              </div>
            )}
          </div>
        </Modal>
      )}
    </Card>
  )
}

function cronToHm(cron) {
  // m h * * *
  const parts = String(cron).trim().split(/\s+/)
  if (parts.length < 2) return cron
  const m = parts[0], h = parts[1]
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}`
}
function hmToCron(h, m) {
  const hh = Math.max(0, Math.min(23, Number(h)))
  const mm = Math.max(0, Math.min(59, Number(m)))
  return `${mm} ${hh} * * *`
}
