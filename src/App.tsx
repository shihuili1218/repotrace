import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Tag,
  MessageCircle,
  GitPullRequest,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  FolderGit2,
  GitFork,
  Github,
  HelpCircle,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { Dashboard, RepoSummary, WebhookConfig } from '../shared/types';
import { api } from './api';
import { ChangesChart, TrendChart } from './Charts';
import { ActivityFeed } from './Monitoring';
import { ProjectData } from './ProjectData';
import { webhookEvents } from '../shared/monitors';

type AuthStatus = { initialized: boolean; authenticated: boolean; setupProtected: boolean };
type View = 'overview' | 'activity' | 'data' | 'repositories' | 'settings';
const number = (n: number) => n.toLocaleString('zh-CN');
const time = (seconds: number | null, full = false) =>
  seconds
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...(full ? { year: 'numeric' } : {}),
      }).format(new Date(seconds * 1000))
    : '尚未收到';
const errorText = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试。');

function Logo({ large = false }: { large?: boolean }) {
  return (
    <div className={`logo ${large ? 'large' : ''}`}>
      <span className="logo-mark">
        <Star size={large ? 26 : 22} fill="currentColor" />
      </span>
      <span>
        RepoTrace<span className="logo-dot">.</span>
      </span>
    </div>
  );
}
function Spinner() {
  return <LoaderCircle className="spin" size={17} aria-label="加载中" />;
}
function Dialog({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <button className="icon-button close-dialog" onClick={onClose} aria-label="关闭">
        <X size={20} />
      </button>
      <div className="dialog-icon">
        <FolderGit2 size={26} />
      </div>
      <h2 id="dialog-title">{title}</h2>
      {subtitle && <p className="muted">{subtitle}</p>}
      {children}
    </dialog>
  );
}

function Auth({ status, onSuccess }: { status: AuthStatus; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setup = !status.initialized;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (setup && password !== confirm) {
      setError('两次输入的密码不一致。');
      return;
    }
    setBusy(true);
    try {
      await api(`/auth/${setup ? 'setup' : 'login'}`, {
        method: 'POST',
        body: { password, setupToken },
      });
      onSuccess();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <div className="auth-story">
        <Logo large />
        <span className="eyebrow">YOUR PROJECTS, IN PERSPECTIVE</span>
        <h1>
          每一份关注，
          <br />
          都有迹可循<span>。</span>
        </h1>
        <p>
          看见项目的成长，也看见背后的人。
          <br />
          你的 GitHub 项目，值得一个专属观测站。
        </p>
        <div className="orbit-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">
            <Star size={58} fill="currentColor" />
          </div>
          <span className="orbit-spark one">
            <Star size={20} fill="currentColor" />
          </span>
          <span className="orbit-spark two">
            <Star size={14} fill="currentColor" />
          </span>
          <span className="orbit-label">
            <span className="status-dot" /> A little more starlight, every day.
          </span>
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={16} /> 私有空间 · 数据由你掌握
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-mobile-logo">
          <Logo />
        </div>
        <div className="auth-card">
          <span className="auth-lock">
            <LockKeyhole size={23} />
          </span>
          <div className="eyebrow">{setup ? 'WELCOME TO REPOTRACE' : 'WELCOME BACK'}</div>
          <h2>{setup ? '开启你的项目观测站' : '欢迎回到你的观测站'}</h2>
          <p className="muted">
            {setup
              ? '先设置管理员密码，为你的数据留一把钥匙。'
              : '输入管理员密码，继续关注项目的每一步成长。'}
          </p>
          <form onSubmit={submit}>
            <label htmlFor="password">{setup ? '设置管理员密码' : '管理员密码'}</label>
            <div className="password-input">
              <input
                id="password"
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={setup ? 12 : 1}
                maxLength={256}
                autoComplete={setup ? 'new-password' : 'current-password'}
                required
                placeholder={setup ? '至少 12 个字符' : '输入你的密码'}
              />
              <button
                type="button"
                aria-label={visible ? '隐藏密码' : '显示密码'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {setup && (
              <>
                <label htmlFor="confirm">确认密码</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  placeholder="再次输入管理员密码"
                />
                {status.setupProtected && (
                  <>
                    <label htmlFor="setup-token">初始化口令</label>
                    <input
                      id="setup-token"
                      type="password"
                      value={setupToken}
                      onChange={(e) => setSetupToken(e.target.value)}
                      required
                      autoComplete="off"
                      placeholder="部署时配置的 SETUP_TOKEN"
                    />
                  </>
                )}
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {setup ? '创建我的观测站' : '进入观测站'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <div className="auth-note">
            <ShieldCheck size={15} />
            <span>
              {setup ? '密码加密保存，仅管理员可访问。请妥善保管。' : '安全会话 · 7 天内保持登录'}
            </span>
          </div>
        </div>
        <span className="auth-bottom">
          为独立开发者而造 <span>✦</span> Built on Cloudflare
        </span>
      </div>
    </main>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [bootError, setBootError] = useState('');
  const checkAuth = useCallback(async () => {
    setBootError('');
    try {
      const status = await api<AuthStatus>('/auth/status');
      if (
        !status ||
        typeof status.initialized !== 'boolean' ||
        typeof status.authenticated !== 'boolean' ||
        typeof status.setupProtected !== 'boolean'
      )
        throw new Error('无法确认观测站登录状态，请刷新页面后重试。');
      setAuth(status);
    } catch (e) {
      setBootError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void checkAuth();
    const expired = () => setAuth((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [checkAuth]);
  if (bootError)
    return (
      <div className="boot">
        <Logo />
        <p role="alert">{bootError}</p>
        <button className="button primary" onClick={checkAuth}>
          重新连接
        </button>
      </div>
    );
  if (!auth)
    return (
      <div className="boot">
        <Logo />
        <Spinner />
        <p className="muted">正在打开你的观测站…</p>
      </div>
    );
  if (!auth.authenticated) return <Auth status={auth} onSuccess={() => void checkAuth()} />;
  return <Workspace onLogout={() => setAuth({ ...auth, authenticated: false })} />;
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<View>('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [repo, setRepo] = useState('');
  const [projectRepo, setProjectRepo] = useState('');
  const [summary, setSummary] = useState('');
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState('all');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [hook, setHook] = useState<WebhookConfig | null>(null);
  const [deleting, setDeleting] = useState<RepoSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await api<Dashboard>(
        `/dashboard?${new URLSearchParams({ repo, summary, days: String(days), kind, category, page: String(page) })}`,
      );
      if (id === requestId.current) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (id === requestId.current) setError(errorText(e));
    }
  }, [repo, summary, days, kind, category, page]);
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), hook ? 5000 : 15000);
    return () => {
      window.clearInterval(interval);
      requestId.current++;
    };
  }, [refresh, !!hook]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setToast(message);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function configure(project: RepoSummary) {
    try {
      setHook(await api<WebhookConfig>(`/repositories/${project.id}/webhook`));
    } catch (e) {
      setError(errorText(e));
    }
  }
  const repositories = data?.repositories ?? [];
  const shown = repositories.filter((r) => !repo || r.id === repo);
  const known = shown.filter((r) => r.current_total !== null);
  const total = known.reduce((n, r) => n + r.current_total!, 0);
  const knownForks = shown.filter((r) => r.current_forks !== null);
  const forkTotal = knownForks.reduce((n, r) => n + r.current_forks!, 0);
  const knownOpenItems = shown.filter((r) => r.current_open_items != null);
  const openItemsTotal = knownOpenItems.reduce((n, r) => n + r.current_open_items!, 0);
  const pending = repositories.filter((r) => !r.webhookConfigured || !r.last_received_at).length;
  const navs = [
    { view: 'overview' as const, label: '项目总览', icon: <LayoutDashboard size={19} /> },
    { view: 'activity' as const, label: '项目动态', icon: <Activity size={19} /> },
    { view: 'data' as const, label: '项目数据', icon: <GitFork size={19} /> },
    { view: 'repositories' as const, label: '监控项目', icon: <FolderGit2 size={19} /> },
    { view: 'settings' as const, label: '设置', icon: <Settings2 size={19} /> },
  ];
  return (
    <div className="workspace">
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <Logo />
        <div className="workspace-badge">
          <span className="workspace-avatar">R</span>
          <span>
            <strong>我的观测站</strong>
            <small>Personal workspace</small>
          </span>
          <LockKeyhole size={14} />
        </div>
        <span className="nav-caption">工作空间</span>
        <nav>
          {navs.map((item) => (
            <button
              key={item.view}
              aria-label={item.label}
              className={`nav-item ${view === item.view ? 'active' : ''}`}
              aria-current={view === item.view ? 'page' : undefined}
              onClick={() => {
                if (item.view === 'data' && !projectRepo && repo) setProjectRepo(repo);
                setView(item.view);
                setPage(1);
                setMobileNav(false);
              }}
            >
              {item.icon}
              {item.label}
              {item.view === 'repositories' && (
                <span className="nav-count">{repositories.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="event-note">
            <span className="event-icon">
              <Activity size={18} />
            </span>
            <strong>事件到了，就有记录</strong>
            <p>
              Star · Fork · Issue · PR · Release
              <br />
              北京时间自然日 · 实时统计
            </p>
            <button onClick={() => setView('repositories')}>
              管理 Webhook <ArrowUpRight size={14} />
            </button>
          </div>
          <a
            className="sidebar-github"
            href="https://github.com/shihuili1218/repotrace"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} /> RepoTrace on GitHub <ExternalLink size={13} />
          </a>
          <div className="admin-row">
            <span className="admin-avatar">S</span>
            <span>
              <strong>管理员</strong>
              <small>你的私有空间</small>
            </span>
            <button
              className="icon-button"
              aria-label="退出登录"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api('/auth/logout', { method: 'POST' });
                  onLogout();
                }, '已退出')
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              工作空间 <ChevronRight size={13} />
              <strong>{navs.find((n) => n.view === view)?.label}</strong>
            </span>
          </div>
          <span className="private-badge">
            <ShieldCheck size={14} /> 私有观测站
          </span>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR PROJECTS, IN PERSPECTIVE</span>
              <h1>
                {
                  {
                    overview: '项目总览',
                    activity: '项目的每一步，都有记录',
                    data: '看见项目的更多维度',
                    repositories: '我的监控项目',
                    settings: '观测站设置',
                  }[view]
                }
                {view === 'overview' && <Sparkles size={23} className="heading-spark" />}
              </h1>
              <p>
                {
                  {
                    overview: '让每一次关注，汇成项目成长的轨迹。',
                    activity: '关注、反馈、贡献与发布，汇在同一条时间线。',
                    data: '了解 Fork 增长、Issue 反馈、PR 进度与版本发布。',
                    repositories: '连接 GitHub Webhook，开始记录你的项目。',
                    settings: '管理 Webhook 连接与管理员密码。',
                  }[view]
                }
              </p>
            </div>
            {view !== 'settings' && (
              <button className="button primary" onClick={() => setAdding(true)}>
                <Plus size={17} />
                添加项目
              </button>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => void refresh()}>重试</button>
              <button
                className="icon-button"
                aria-label="关闭错误提示"
                onClick={() => setError('')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {!!pending && view !== 'settings' && (
            <div className="info-note webhook-banner" role="status">
              <Github size={21} />
              <span>
                <strong>{pending} 个项目等待连接 Webhook</strong>
                <small>配置后 GitHub 会发送 Ping；收到签名事件后显示连接成功。</small>
              </span>
              <button className="button secondary" onClick={() => setView('repositories')}>
                管理项目 <ArrowRight size={15} />
              </button>
            </div>
          )}
          {view !== 'settings' && view !== 'data' && (
            <div className="filterbar">
              <div className="filterbar-controls">
                <div className="select-wrap">
                  <FolderGit2 size={16} />
                  <select
                    aria-label="选择项目"
                    value={repo}
                    onChange={(e) => {
                      setRepo(e.target.value);
                      setSummary('');
                      setPage(1);
                    }}
                  >
                    <option value="">全部项目</option>
                    {repositories.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <div className="select-wrap">
                  <select
                    aria-label="统计范围"
                    value={days}
                    onChange={(e) => {
                      setDays(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    {[7, 30, 90].map((n) => (
                      <option key={n} value={n}>
                        近 {n} 天
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <span className="filterbar-status">
                Webhook 实时记录
                <button
                  className="icon-button"
                  aria-label="刷新页面数据"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={15} />
                </button>
              </span>
            </div>
          )}
          {!data ? (
            <div className="panel loading-panel">
              <Spinner />
              正在读取项目数据…
            </div>
          ) : (
            <>
              {view === 'overview' && (
                <>
                  <section className="stats-grid" aria-label="监控统计">
                    <Stat
                      title="Stars(总数 / 新增 / 取消)"
                      value={`${known.length ? number(total) : '—'}/${number(data.eventCounts.added)}/${number(data.eventCounts.removed)}`}
                      icon={<Star size={20} />}
                      note={`${known.length} / ${shown.length} 个项目有总数 · 增减为近 ${days} 天`}
                      tone="purple"
                    />
                    <Stat
                      title="Issues(未关闭 / 新增 / 关闭)"
                      value={`${knownOpenItems.length ? number(openItemsTotal) : '—'}/${number(data.metrics.issuesOpened)}/${number(data.metrics.issuesClosed)}`}
                      icon={<MessageCircle size={20} />}
                      note={`未关闭含 PR · ${knownOpenItems.length} / ${shown.length} 个项目有总数 · 新增 / 关闭为近 ${days} 天 Issue`}
                      tone="green"
                    />
                    <Stat
                      title="PRs(新增 / 合并 / 关闭)"
                      value={`${number(data.metrics.prsOpened)}/${number(data.metrics.prsMerged)}/${number(data.metrics.prsClosed)}`}
                      icon={<GitPullRequest size={20} />}
                      note={`近 ${days} 天 · 关闭不含已合并`}
                      tone="blue"
                    />
                    <Stat
                      title="Forks(总数 / 新增)"
                      value={`${knownForks.length ? number(forkTotal) : '—'}/${number(data.metrics.forks)}`}
                      icon={<GitFork size={20} />}
                      note={`${knownForks.length} / ${shown.length} 个项目有总数 · 新增为近 ${days} 天`}
                      tone="purple"
                    />
                    <Stat
                      title={`近 ${days} 天事件`}
                      value={number(data.eventTotal)}
                      icon={<Activity size={20} />}
                      note="Star、Fork、Issue、PR、Release 全部事件"
                      tone="green"
                    />
                    <Stat
                      title="已连接项目(已连接 / 全部)"
                      value={`${shown.filter((r) => r.enabled && r.last_received_at).length}/${shown.length}`}
                      icon={<FolderGit2 size={20} />}
                      note="已启用且收到过签名事件"
                      tone="blue"
                    />
                  </section>
                  <div className="chart-grid">
                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <h2>Star 总量趋势</h2>
                          <p>每日最近上报值 · 今日随事件实时更新</p>
                        </div>
                        <div className="range-switch">
                          {[7, 30, 90].map((n) => (
                            <button
                              key={n}
                              className={days === n ? 'active' : ''}
                              onClick={() => {
                                setDays(n);
                                setPage(1);
                              }}
                            >
                              {n} 天
                            </button>
                          ))}
                        </div>
                      </div>
                      <TrendChart history={data.history} />
                    </section>
                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <h2>每日净变化</h2>
                          <p>北京时间自然日 · 同一用户反向操作相互抵消</p>
                        </div>
                      </div>
                      <ChangesChart history={data.history} />
                      <div className="chart-legend">
                        <span>
                          <i className="legend-dot green" />
                          新增
                        </span>
                        <span>
                          <i className="legend-dot red" />
                          取消
                        </span>
                      </div>
                    </section>
                  </div>
                  {!repositories.length ? (
                    <EmptyProjects onAdd={() => setAdding(true)} />
                  ) : (
                    <>
                      <div className="section-heading">
                        <h2>监控项目</h2>
                        <button className="text-button" onClick={() => setView('repositories')}>
                          管理项目 <ArrowRight size={15} />
                        </button>
                      </div>
                      <div className="repo-grid">
                        {shown.map((r) => (
                          <RepoCard
                            key={r.id}
                            project={r}
                            onConfigure={() => void configure(r)}
                            onView={() => {
                              setProjectRepo(r.id);
                              setView('data');
                            }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {view === 'repositories' &&
                (!repositories.length ? (
                  <EmptyProjects onAdd={() => setAdding(true)} />
                ) : (
                  <>
                    <div className="repo-management">
                      {shown.map((r) => (
                        <div className="panel" key={r.id}>
                          <RepoCard
                            project={r}
                            onConfigure={() => void configure(r)}
                            onView={() => {
                              setProjectRepo(r.id);
                              setView('data');
                            }}
                          />
                          <div className="repo-actions">
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void action(
                                  () =>
                                    api(`/repositories/${r.id}`, {
                                      method: 'PATCH',
                                      body: { enabled: !r.enabled },
                                    }),
                                  r.enabled ? '已暂停记录' : '已恢复记录',
                                )
                              }
                            >
                              {r.enabled ? <Pause size={14} /> : <Play size={14} />}
                              {r.enabled ? '暂停记录' : '恢复记录'}
                            </button>
                            <button className="text-button danger" onClick={() => setDeleting(r)}>
                              <Trash2 size={14} />
                              移除项目
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="info-note">
                      <HelpCircle size={16} />
                      暂停期间所有监控维度都停止记录，恢复后只记录之后送达的变化。
                    </p>
                  </>
                ))}
              {view === 'data' && (
                <ProjectData
                  repositories={repositories}
                  projectId={projectRepo}
                  onProjectChange={setProjectRepo}
                />
              )}
              {view === 'activity' && (
                <ActivityFeed
                  data={data}
                  category={category}
                  onCategory={(value) => {
                    setCategory(value);
                    setPage(1);
                  }}
                  onPage={setPage}
                />
              )}
              {view === 'overview' && (
                <ActivityFeed
                  data={data}
                  category="all"
                  onCategory={setCategory}
                  onPage={setPage}
                  preview
                  onViewAll={() => {
                    setSummary('');
                    setCategory('all');
                    setPage(1);
                    setView('activity');
                  }}
                />
              )}
              {view === 'activity' && !!summary && (
                <Changes
                  data={data}
                  summary={summary}
                  onSummary={(id) => {
                    setSummary(id);
                    setPage(1);
                  }}
                  kind={kind}
                  onKind={(value) => {
                    setKind(value);
                    setPage(1);
                  }}
                  onPage={setPage}
                  days={days}
                />
              )}
              {view === 'activity' && (
                <section className="panel snapshot-panel">
                  <div className="panel-header">
                    <div>
                      <h2>历史快照与旧汇总</h2>
                      <p>仅保留升级前的记录 · 新事件直接参与实时统计</p>
                    </div>
                  </div>
                  {data.summaries.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>日期 / 项目</th>
                            <th>来源</th>
                            <th>最近上报总量</th>
                            <th>新增 / 取消</th>
                            <th>名单</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.summaries.map((s) => (
                            <tr key={s.id}>
                              <td>
                                {s.day}
                                <small className="cell-subtitle">{s.full_name}</small>
                              </td>
                              <td>
                                {s.source === 'legacy'
                                  ? '历史快照'
                                  : s.kind === 'baseline'
                                    ? '连接基线'
                                    : '每日汇总'}
                              </td>
                              <td>{s.total === null ? '—' : number(s.total)}</td>
                              <td>
                                <span className="text-green">+{s.added}</span> /{' '}
                                <span className="text-red">−{s.removed}</span>
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    setSummary(s.id);
                                    setPage(1);
                                  }}
                                >
                                  查看名单
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="small-empty">
                      暂无旧快照。当前图表直接从事件计算，无需等待夜间汇总。
                    </p>
                  )}
                </section>
              )}
              {view === 'settings' && (
                <SettingsView
                  onManageProjects={() => setView('repositories')}
                  onPassword={async (currentPassword, password) => {
                    await api('/auth/password', {
                      method: 'POST',
                      body: { currentPassword, password },
                    });
                    setToast('管理员密码已更新');
                  }}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>RepoTrace · 每一份关注都有迹可循</span>
            <span>Powered by Cloudflare · Webhooks</span>
          </footer>
        </main>
      </div>
      {adding && (
        <AddRepository
          onClose={() => setAdding(false)}
          onAdded={async (config) => {
            setAdding(false);
            setHook(config);
            await refresh();
          }}
        />
      )}
      {hook && (
        <WebhookDialog
          config={hook}
          project={repositories.find((r) => r.id === hook.id)}
          onClose={() => setHook(null)}
          onChange={setHook}
          onRefresh={refresh}
        />
      )}
      {deleting && (
        <Dialog
          title="移除项目？"
          subtitle={`将删除 ${deleting.full_name} 的全部记录；请同时在 GitHub 移除对应 Webhook。`}
          onClose={() => setDeleting(null)}
        >
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api(`/repositories/${deleting.id}`, { method: 'DELETE' });
                  if (repo === deleting.id) setRepo('');
                  setSummary('');
                  setPage(1);
                  setDeleting(null);
                }, '项目已移除')
              }
            >
              确认移除
            </button>
          </div>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button className="icon-button" aria-label="关闭通知" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyProjects({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="panel empty-projects">
      <div className="empty-illustration">
        <FolderGit2 size={32} />
        <span>✦</span>
      </div>
      <h2>从第一个项目开始</h2>
      <p>
        添加仓库并连接 GitHub Webhook，
        <br />
        为每一份关注留下记录。
      </p>
      <button className="button primary" onClick={onAdd}>
        <Plus size={17} />
        添加第一个项目
      </button>
      <small>需要仓库管理员权限 · 支持公开与私有仓库</small>
    </section>
  );
}
function AddRepository({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (config: WebhookConfig) => Promise<void>;
}) {
  const [repository, setRepository] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title="添加监控项目" subtitle="填写仓库，下一步连接 GitHub Webhook。" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const config = await api<WebhookConfig>('/repositories', {
              method: 'POST',
              body: { repository },
            });
            await onAdded(config);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="repository">GitHub 仓库</label>
        <input
          id="repository"
          value={repository}
          onChange={(e) => setRepository(e.target.value)}
          required
          placeholder="owner/repo 或 GitHub 仓库地址"
          autoComplete="off"
          maxLength={200}
        />
        <div className="dialog-tip">
          <ShieldCheck size={17} />
          <span>
            请确认你有该仓库 Settings → Webhooks 的管理权限。仓库身份会在首次收到签名事件时确认。
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                生成 Webhook 配置 <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function WebhookDialog({
  config,
  project,
  onClose,
  onChange,
  onRefresh,
}: {
  config: WebhookConfig;
  project?: RepoSummary;
  onClose: () => void;
  onChange: (config: WebhookConfig) => void;
  onRefresh: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setError('复制未完成，请选中输入框内容手动复制。');
    }
  }
  return (
    <Dialog title="连接 GitHub Webhook" subtitle={config.full_name} onClose={onClose}>
      <div
        className={`connection-state ${project?.last_received_at ? 'connected' : ''}`}
        role="status"
      >
        <span className="status-dot" />
        <span>
          {project?.last_received_at
            ? `已收到签名事件 · ${time(project.last_received_at)}`
            : '等待 GitHub 发送签名 Ping'}
        </span>
      </div>
      <label htmlFor="hook-url">Payload URL</label>
      <div className="copy-field">
        <input id="hook-url" value={config.url} readOnly onFocus={(e) => e.target.select()} />
        <button className="button secondary" onClick={() => void copy(config.url, 'URL')}>
          {copied === 'URL' ? '已复制' : '复制'}
        </button>
      </div>
      <label htmlFor="hook-secret">Secret（签名密钥）</label>
      {config.secret ? (
        <>
          <div className="copy-field">
            <input
              id="hook-secret"
              value={config.secret}
              readOnly
              onFocus={(e) => e.target.select()}
              autoComplete="off"
            />
            <button
              className="button secondary"
              onClick={() => void copy(config.secret!, 'Secret')}
            >
              {copied === 'Secret' ? '已复制' : '复制'}
            </button>
          </div>
          <p className="field-note secret-note">
            此密钥仅本次显示。关闭后无法查看；忘记时可重新生成，并同步更新 GitHub 配置。
          </p>
        </>
      ) : (
        <p className="field-note">
          已保存的密钥不会回显。
          {project?.webhookConfigured
            ? 'GitHub 中已配置的密钥可继续使用。'
            : '首次连接请先生成签名密钥。'}
        </p>
      )}
      <ol className="webhook-steps">
        <li>
          打开{' '}
          <a href={config.settingsUrl} target="_blank" rel="noreferrer">
            仓库 Settings → Webhooks <ExternalLink size={12} />
          </a>
          ，新增或编辑现有 Webhook。已有地址和 Secret 可继续使用。
        </li>
        <li>
          粘贴上方 <strong>Payload URL</strong> 与 <strong>Secret</strong>；Content type 选择{' '}
          <strong>application/json</strong>，保持 <strong>Enable SSL verification</strong>。
        </li>
        <li>
          选择 <strong>Let me select individual events</strong>，勾选下面需要的事件，再勾选{' '}
          <strong>Active</strong> 并保存。
        </li>
        <li>
          等待此处显示已收到签名事件。若未连接，查看 GitHub 的 <strong>Recent Deliveries</strong>
          ；修改 Secret 后可重新投递 Ping。
        </li>
      </ol>
      <div className="webhook-event-list" aria-label="支持的 Webhook 事件">
        {webhookEvents.map((item) => (
          <div key={item.event}>
            <span>
              <strong>{item.label}</strong>
              <small>{item.feature}</small>
            </span>
            <span
              className={`pill ${project?.receivedEvents?.includes(item.event) ? 'green' : 'neutral'}`}
            >
              {project?.receivedEvents?.includes(item.event) ? '已收到' : '待事件'}
            </span>
          </div>
        ))}
      </div>
      <p className="field-note">
        Releases
        只用于记录发版动态。版本目录和汇总下载量在每次采集成功一小时后再次采集，失败会自动重试；查看单个版本的产物下载量时，返回缓存并请求后台刷新。
      </p>
      <div className="dialog-tip">
        <HelpCircle size={16} />
        <span>
          只记录启用后收到的事件。总量取最近上报值；Issue / PR
          列表只包含收到过事件的条目。每日图表按北京时间实时计算。
        </span>
      </div>
      {confirm ? (
        <div className="rotate-confirm">
          <p>重新生成后，旧密钥立即失效。请同步替换 GitHub Webhook 的 Secret，再重新投递 Ping。</p>
          <button className="button secondary" onClick={() => setConfirm(false)}>
            取消更换
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                onChange(
                  await api<WebhookConfig>(`/repositories/${config.id}/webhook`, {
                    method: 'POST',
                  }),
                );
                setConfirm(false);
                setCopied('');
                await onRefresh();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            确认生成新密钥
          </button>
        </div>
      ) : (
        <button className="text-button rotate-button" onClick={() => setConfirm(true)}>
          {project?.webhookConfigured ? '重新生成 Secret' : '生成签名密钥'}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button secondary" onClick={() => void onRefresh()}>
          检查连接
        </button>
        <button className="button primary" onClick={onClose}>
          完成
        </button>
      </div>
    </Dialog>
  );
}
function RepoCard({
  project: r,
  onConfigure,
  onView,
}: {
  project: RepoSummary;
  onConfigure: () => void;
  onView: () => void;
}) {
  const state = !r.enabled ? '已暂停' : r.last_received_at ? '已连接' : '待连接';
  return (
    <article className="repo-card panel">
      <div className="repo-card-heading">
        <span className="repo-icon">
          <FolderGit2 size={20} />
        </span>
        <span className={`pill ${!r.enabled ? 'neutral' : r.last_received_at ? 'green' : 'blue'}`}>
          {state}
        </span>
      </div>
      <h3>
        <a href={`https://github.com/${r.full_name}`} target="_blank" rel="noreferrer">
          {r.full_name}
          <ArrowUpRight size={14} />
        </a>
      </h3>
      <p className="repo-description">
        {r.description || '连接 Webhook，开始记录项目的每一次关注。'}
      </p>
      <div className="repo-metrics">
        <div>
          <span>最近上报 Stars</span>
          <strong>
            <Star size={16} />
            {r.current_total === null ? '—' : number(r.current_total)}
          </strong>
        </div>
        <div>
          <span>最近上报 Forks</span>
          <strong>
            <GitFork size={16} />
            {r.current_forks === null ? '—' : number(r.current_forks)}
          </strong>
        </div>
      </div>
      <p className="hook-timestamp">
        总量上报：{time(r.total_reported_at)}
        <br />
        已记录 {number(r.event_count)} 条事件 · 最近收到 {time(r.last_received_at)}
      </p>
      <div className="repo-card-footer">
        <span>
          <span className="status-dot" />
          {r.webhookConfigured ? '签名密钥已生成' : '等待配置 Webhook'}
        </span>
        <button className="text-button" onClick={onView}>
          查看数据
        </button>
        <button className="text-button" onClick={onConfigure}>
          配置 Webhook <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}
function Changes({
  data,
  summary,
  onSummary,
  kind,
  onKind,
  onPage,
  days,
}: {
  data: Dashboard;
  summary: string;
  onSummary: (id: string) => void;
  kind: string;
  onKind: (kind: string) => void;
  onPage: (page: number) => void;
  days: number;
}) {
  return (
    <section className="panel changes-panel">
      <div className="panel-header">
        <div>
          <h2>{summary ? '历史名单' : 'Star 事件记录'}</h2>
          <p>
            {summary
              ? '保留原快照或汇总时的统计口径'
              : `最近 ${days} 天收到的事件 · 同一用户可有多次操作`}
          </p>
        </div>
        <div className="select-wrap snapshot-select">
          <select
            aria-label="选择历史记录"
            value={summary}
            onChange={(e) => onSummary(e.target.value)}
          >
            <option value="">实时事件记录</option>
            {data.summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.day} · {s.full_name} ·{' '}
                {s.source === 'legacy'
                  ? '历史快照'
                  : s.kind === 'baseline'
                    ? '初始基线'
                    : '每日汇总'}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="change-tabs">
        {[
          ['all', '全部变化'],
          ['added', '新增 Star'],
          ['removed', '取消 Star'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={kind === value ? 'active' : ''}
            onClick={() => onKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {data.changes.length ? (
        <>
          <div className="table-scroll">
            <table className="changes-table">
              <thead>
                <tr>
                  <th>GitHub 用户</th>
                  <th>项目</th>
                  <th>变化</th>
                  <th>收到时间 · 北京时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.changes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a
                        className="user-cell"
                        href={`https://github.com/${c.login}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={`https://avatars.githubusercontent.com/u/${c.user_id}?s=64`}
                          alt=""
                          width="30"
                          height="30"
                          loading="lazy"
                        />
                        <strong>{c.login}</strong>
                      </a>
                    </td>
                    <td>{c.full_name}</td>
                    <td>
                      <span className={`pill ${c.kind === 'added' ? 'green' : 'red'}`}>
                        {c.kind === 'added' ? (
                          <ArrowUpRight size={13} />
                        ) : (
                          <ArrowDownRight size={13} />
                        )}
                        {c.kind === 'added' ? '新增 Star' : '取消 Star'}
                      </span>
                    </td>
                    <td>{time(c.observed_at)}</td>
                    <td>
                      <a
                        href={`https://github.com/${c.login}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`查看 ${c.login} 的 GitHub 主页`}
                      >
                        <ArrowUpRight size={15} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              共 {number(data.changeTotal)} 条记录 · 第 {data.page} 页
            </span>
            <div>
              <button
                className="icon-button"
                disabled={data.page <= 1}
                onClick={() => onPage(data.page - 1)}
                aria-label="上一页"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                disabled={data.page * 30 >= data.changeTotal}
                onClick={() => onPage(data.page + 1)}
                aria-label="下一页"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="changes-empty">
          <span className="empty-star">
            <Star size={25} />
          </span>
          <h3>暂无变化记录</h3>
          <p>
            {summary
              ? '这份历史记录没有名单变化。初始基线只保存总量。'
              : '连接 Webhook 后，新增或取消 Star 的事件会出现在这里。'}
          </p>
        </div>
      )}
      <div className="table-note">
        <HelpCircle size={14} />
        <span>
          时间按事件收到时记录。漏投递的事件需要在 GitHub 重新投递；重复 Delivery ID 只处理一次。
        </span>
      </div>
    </section>
  );
}
function Stat({
  title,
  value,
  icon,
  note,
  tone,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  note: string;
  tone: string;
}) {
  return (
    <article className={`stat-card ${tone}`} aria-label={title}>
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <p>{note}</p>
    </article>
  );
}
function SettingsView({
  onManageProjects,
  onPassword,
}: {
  onManageProjects: () => void;
  onPassword: (current: string, password: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="settings-grid">
      <div>
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="settings-icon">
              <LockKeyhole size={21} />
            </span>
            <div>
              <h2>管理员密码</h2>
              <p>修改密码后，其他设备将需要重新登录。</p>
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              if (password !== confirm) {
                setError('两次输入的新密码不一致。');
                return;
              }
              setChanging(true);
              try {
                await onPassword(current, password);
                setCurrent('');
                setPassword('');
                setConfirm('');
              } catch (e) {
                setError(errorText(e));
              } finally {
                setChanging(false);
              }
            }}
          >
            <label htmlFor="current-password">当前密码</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              maxLength={256}
            />
            <div className="password-fields">
              <div>
                <label htmlFor="new-password">新密码</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 12 个字符"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={12}
                  maxLength={256}
                  required
                />
              </div>
              <div>
                <label htmlFor="confirm-new-password">确认新密码</label>
                <input
                  id="confirm-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={12}
                  maxLength={256}
                  required
                />
              </div>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button secondary" disabled={changing}>
              {changing ? <Spinner /> : <LockKeyhole size={16} />}更新密码
            </button>
          </form>
        </section>
      </div>
      <div>
        <section className="panel settings-panel">
          <div className="settings-title">
            <Github size={24} />
            <h2>GitHub 连接</h2>
          </div>
          <p className="field-note">
            每个仓库配置一次 Webhook。需要该仓库的管理员权限；公开和私有仓库均可使用。
          </p>
          <div className="webhook-guide">
            <strong>收到事件，立即记录</strong>
            <p>
              添加项目后复制 Payload URL 和 Secret 到 GitHub → 仓库 Settings → Webhooks。选择
              application/json，勾选所需事件及 Active，保留 SSL 验证。
            </p>
            <button className="button secondary" onClick={onManageProjects}>
              管理项目 Webhook
            </button>
          </div>
          <p className="field-note">
            只记录启用后送达的事件，无法补回历史名单或停用期间的变化。GitHub 投递失败时，可在 Recent
            Deliveries 中手动 Redeliver；重复投递不会重复计数。
          </p>
        </section>
        <section className="panel settings-panel">
          <div className="settings-title">
            <Activity size={23} />
            <h2>事件驱动，实时统计</h2>
          </div>
          <p className="field-note">
            收到 Webhook 后立即保存并更新统计。每日图表按北京时间 00:00—24:00
            分组，同一用户当天新增后又取消 Star 会相互抵消。没有夜间任务，也无需设置汇总时间。
          </p>
          <p className="field-note">
            Fork 只记录新增；Issue / PR 待办仅覆盖已收到的条目。新模块请在 GitHub 编辑现有
            Webhook，增加勾选 Forks、Issues、Issue comments、Pull requests、Pull request
            reviews、Releases。Release
            事件只记录动态；版本目录和汇总下载量在每次采集成功一小时后再次采集，失败会自动重试。单个版本的产物下载量在读取缓存后后台更新。
          </p>
        </section>
      </div>
    </div>
  );
}
