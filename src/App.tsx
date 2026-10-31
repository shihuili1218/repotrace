import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
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
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { Dashboard, RepoSummary, Snapshot } from '../shared/types';
import { api } from './api';
import { ChangesChart, TrendChart } from './Charts';

type AuthStatus = { initialized: boolean; authenticated: boolean; setupProtected: boolean };
type Settings = { dailyHour: number; timezone: string; githubTokenConfigured: boolean };
type View = 'overview' | 'activity' | 'repositories' | 'settings';
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
    : '尚未采集';
const kindLabel = (kind: Snapshot['kind']) =>
  ({ baseline: '初始基线', daily: '每日快照', manual: '手动快照' })[kind];
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
      setAuth(await api<AuthStatus>('/auth/status'));
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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repo, setRepo] = useState('');
  const [snapshot, setSnapshot] = useState('');
  const [days, setDays] = useState(30);
  const [changeKind, setChangeKind] = useState('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'add' | RepoSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        api<Dashboard>(
          `/dashboard?${new URLSearchParams({ repo, snapshot, days: String(days), kind: changeKind, page: String(page) })}`,
        ),
        api<Settings>('/settings'),
      ]);
      if (id === requestId.current) {
        setData(d);
        setSettings(s);
        setError('');
      }
    } catch (e) {
      if (id === requestId.current) setError(errorText(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [repo, snapshot, days, changeKind, page]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const hasActive = data?.repositories.some((r) => r.active);
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      hasActive ? 5000 : 60000,
    );
    return () => clearInterval(timer);
  }, [refresh, hasActive]);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function chooseRepo(value: string) {
    setRepo(value);
    setSnapshot('');
    setPage(1);
  }
  async function action(path: string, method: string, body?: unknown, message = '已保存') {
    setBusy(true);
    try {
      await api(path, { method, body });
      setToast(message);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const repositories = data?.repositories ?? [];
  const shown = repositories.filter((r) => !repo || r.id === repo);
  const total = shown.reduce((sum, r) => sum + (r.latest?.total ?? 0), 0);
  const added = shown.reduce((sum, r) => sum + (r.latest?.added ?? 0), 0);
  const removed = shown.reduce((sum, r) => sum + (r.latest?.removed ?? 0), 0);
  const complete = shown.filter((r) => r.latest).length;
  const navs: { view: View; label: string; icon: ReactNode }[] = [
    { view: 'overview', label: '总览', icon: <LayoutDashboard size={19} /> },
    { view: 'activity', label: 'Star 动态', icon: <Activity size={19} /> },
    { view: 'repositories', label: '监控项目', icon: <FolderGit2 size={19} /> },
    { view: 'settings', label: '设置', icon: <Settings2 size={19} /> },
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
          <span className="workspace-avatar">S</span>
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
              className={`nav-item ${view === item.view ? 'active' : ''}`}
              aria-current={view === item.view ? 'page' : undefined}
              onClick={() => {
                setView(item.view);
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
          <div className="night-note">
            <span className="night-icon">
              <Moon size={18} />
            </span>
            <strong>把记录交给夜晚</strong>
            <p>
              每日 {String(settings?.dailyHour ?? 23).padStart(2, '0')}:00 自动采集
              <br />
              Asia/Shanghai · UTC+8
            </p>
            <button onClick={() => setView('settings')}>
              管理采集计划 <ArrowUpRight size={14} />
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
              title="退出登录"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/auth/logout', { method: 'POST' });
                  onLogout();
                } catch (e) {
                  setError(errorText(e));
                  setBusy(false);
                }
              }}
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
          <div className="topbar-right">
            <span className="private-badge">
              <ShieldCheck size={14} /> 私有观测站
            </span>
            <span className="topbar-divider" />
            <span className="topbar-date">
              {new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              }).format(new Date())}
            </span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {
                  {
                    overview: 'THE BIG PICTURE',
                    activity: 'PEOPLE BEHIND THE STARS',
                    repositories: 'YOUR OPEN SOURCE UNIVERSE',
                    settings: 'MAKE IT YOURS',
                  }[view]
                }
              </span>
              <h1>
                {
                  {
                    overview: '项目总览',
                    activity: '每一份关注，都有记录',
                    repositories: '我的监控项目',
                    settings: '观测站设置',
                  }[view]
                }
                {view === 'overview' && <Sparkles size={23} className="heading-spark" />}
              </h1>
              <p>
                {
                  {
                    overview: '一点一滴的星光，汇成项目成长的轨迹。',
                    activity: '了解谁新关注了你的项目，谁悄悄离开了。',
                    repositories: '把你在意的项目放在一起，让成长一目了然。',
                    settings: '安排好采集节奏，然后专注创造。',
                  }[view]
                }
              </p>
            </div>
            {view !== 'settings' && (
              <button className="button primary" onClick={() => setModal('add')}>
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
          {view !== 'settings' && (
            <div className="filterbar">
              <div className="select-wrap">
                <FolderGit2 size={16} />
                <select
                  aria-label="选择项目"
                  value={repo}
                  onChange={(e) => chooseRepo(e.target.value)}
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
              <span className="filterbar-status">
                <span className={`status-dot ${hasActive ? 'pulse' : ''}`} />
                {hasActive ? '快照采集中 · 自动更新' : '每日自动记录'}
                <button
                  className="icon-button"
                  aria-label="刷新页面数据"
                  title="刷新页面数据"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={15} className={loading ? 'spin' : ''} />
                </button>
              </span>
            </div>
          )}
          {!data && loading ? (
            <div className="panel loading-panel">
              <Spinner />
              <span>正在读取项目数据…</span>
            </div>
          ) : (
            <>
              {view === 'overview' && (
                <>
                  <section className="stats-grid" aria-label="监控统计">
                    <Stat
                      title="累计 Stars"
                      value={complete ? number(total) : '—'}
                      icon={<Star size={20} />}
                      note={`${complete} / ${shown.length} 个项目已有完整快照`}
                      tone="purple"
                    />
                    <Stat
                      title="最近快照新增"
                      value={complete ? `+${number(added)}` : '—'}
                      icon={<ArrowUpRight size={20} />}
                      note="与上一份有效快照相比"
                      tone="green"
                    />
                    <Stat
                      title="最近快照取消"
                      value={complete ? `−${number(removed)}` : '—'}
                      icon={<ArrowDownRight size={20} />}
                      note="取消关注也值得被看见"
                      tone="red"
                    />
                    <Stat
                      title="监控中的项目"
                      value={number(shown.filter((r) => r.enabled).length)}
                      icon={<FolderGit2 size={20} />}
                      note={`${shown.filter((r) => r.active).length} 个正在采集 · ${shown.filter((r) => !r.enabled).length} 个已暂停`}
                      tone="blue"
                    />
                  </section>
                  <div className="chart-grid">
                    <section className="panel trend-panel">
                      <div className="panel-header">
                        <div>
                          <h2>
                            Star 趋势 <span className="label-tag">每日</span>
                          </h2>
                          <p>每一份关注，都在这里留下痕迹</p>
                        </div>
                        <div className="range-switch">
                          {[7, 30, 90].map((d) => (
                            <button
                              key={d}
                              className={days === d ? 'selected' : ''}
                              aria-pressed={days === d}
                              onClick={() => setDays(d)}
                            >
                              {d} 天
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="chart-legend">
                        <span className="legend-dot blue" />
                        累计 Stars<span className="chart-hint">悬停数据点查看详情</span>
                      </div>
                      <TrendChart history={data?.history ?? []} />
                    </section>
                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <h2>星光的来与往</h2>
                          <p>近 14 天 · 每日快照对比</p>
                        </div>
                        <Activity size={18} className="muted" />
                      </div>
                      <div className="chart-legend">
                        <span className="legend-dot green" />
                        新增
                        <span className="legend-dot red" />
                        取消
                      </div>
                      <ChangesChart history={data?.history ?? []} />
                    </section>
                  </div>
                  <div className="section-title">
                    <h2>
                      关注的项目 <span>{shown.length}</span>
                    </h2>
                    <button className="text-button" onClick={() => setView('repositories')}>
                      管理项目 <ArrowRight size={15} />
                    </button>
                  </div>
                  {shown.length ? (
                    <div className="repo-grid">
                      {shown.map((r) => (
                        <RepoCard
                          key={r.id}
                          repository={r}
                          busy={busy}
                          onSelect={() => {
                            chooseRepo(r.id);
                            setView('activity');
                          }}
                          onSync={() =>
                            void action(
                              `/repositories/${r.id}/sync`,
                              'POST',
                              {},
                              '已加入采集队列，完成后数据会自动更新。',
                            )
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyProjects onAdd={() => setModal('add')} />
                  )}
                  <Changes
                    data={data}
                    repo={repo}
                    snapshot={snapshot}
                    kind={changeKind}
                    page={page}
                    onSnapshot={(value) => {
                      setSnapshot(value);
                      setPage(1);
                    }}
                    onKind={(value) => {
                      setChangeKind(value);
                      setPage(1);
                    }}
                    onPage={setPage}
                  />
                </>
              )}
              {view === 'activity' && (
                <>
                  <Changes
                    data={data}
                    repo={repo}
                    snapshot={snapshot}
                    kind={changeKind}
                    page={page}
                    onSnapshot={(value) => {
                      setSnapshot(value);
                      setPage(1);
                    }}
                    onKind={(value) => {
                      setChangeKind(value);
                      setPage(1);
                    }}
                    onPage={setPage}
                  />
                  <section className="panel snapshot-panel">
                    <div className="panel-header">
                      <div>
                        <h2>采集记录</h2>
                        <p>完整快照才参与比对，失败的数据不会影响统计。</p>
                      </div>
                      <Clock3 size={19} className="muted" />
                    </div>
                    {!data?.snapshots.length ? (
                      <div className="small-empty">添加项目后，这里会记录每次采集。</div>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>项目 / 快照</th>
                              <th>采集时间</th>
                              <th>Star 数</th>
                              <th>状态</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.snapshots.slice(0, 30).map((s) => (
                              <tr key={s.id}>
                                <td>
                                  <strong>{s.full_name}</strong>
                                  <small>
                                    {s.day} · {kindLabel(s.kind)}
                                  </small>
                                </td>
                                <td>
                                  {time(s.started_at)}
                                  {s.comparison_day && <small>对比 {s.comparison_day}</small>}
                                </td>
                                <td>{number(s.total)}</td>
                                <td>
                                  <span
                                    className={`pill ${s.status === 'complete' ? 'green' : s.status === 'failed' ? 'red' : 'blue'}`}
                                  >
                                    {s.status === 'complete'
                                      ? '已完成'
                                      : s.status === 'failed'
                                        ? '采集失败'
                                        : s.retry_at > Date.now() / 1000
                                          ? '等待重试'
                                          : '采集中'}
                                  </span>
                                  {s.error && <small className="snapshot-error">{s.error}</small>}
                                </td>
                                <td>
                                  {s.status === 'failed' ? (
                                    <button
                                      className="text-button"
                                      disabled={busy}
                                      onClick={() =>
                                        void action(
                                          `/snapshots/${s.id}/retry`,
                                          'POST',
                                          {},
                                          '已重新开始采集。',
                                        )
                                      }
                                    >
                                      重试
                                    </button>
                                  ) : (
                                    s.status === 'complete' && (
                                      <button
                                        className="text-button"
                                        onClick={() => {
                                          setSnapshot(s.id);
                                          setPage(1);
                                        }}
                                      >
                                        查看变化
                                      </button>
                                    )
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}
              {view === 'repositories' && (
                <>
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      aria-label="搜索项目"
                      placeholder="搜索仓库名称…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <span>{repositories.length} / 20 个项目</span>
                  </div>
                  {shown.filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase()))
                    .length ? (
                    <div className="repo-management">
                      {shown
                        .filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase()))
                        .map((r) => (
                          <section key={r.id} className="panel managed-repo">
                            <RepoCard
                              repository={r}
                              busy={busy}
                              onSelect={() => {
                                chooseRepo(r.id);
                                setView('activity');
                              }}
                              onSync={() =>
                                void action(
                                  `/repositories/${r.id}/sync`,
                                  'POST',
                                  {},
                                  '已开始采集。',
                                )
                              }
                              embedded
                            />
                            <div className="repo-actions">
                              <span className="muted">添加于 {time(r.created_at)}</span>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  void action(
                                    `/repositories/${r.id}`,
                                    'PATCH',
                                    { enabled: !r.enabled },
                                    r.enabled ? '已暂停监控。' : '已恢复监控。',
                                  )
                                }
                              >
                                {r.enabled ? <Pause size={14} /> : <Play size={14} />}
                                {r.enabled ? '暂停监控' : '恢复监控'}
                              </button>
                              <button className="text-button danger" onClick={() => setModal(r)}>
                                <Trash2 size={14} />
                                移除
                              </button>
                            </div>
                          </section>
                        ))}
                    </div>
                  ) : search ? (
                    <div className="panel small-empty">没有找到匹配的项目。</div>
                  ) : (
                    <EmptyProjects onAdd={() => setModal('add')} />
                  )}
                  <div className="info-note">
                    <HelpCircle size={17} />
                    <span>
                      添加项目后自动建立初始基线。此后的每日快照会记录新增和取消；暂停期间不采集，恢复后与上次有效快照对比。
                    </span>
                  </div>
                </>
              )}
              {view === 'settings' && settings && (
                <SettingsView
                  settings={settings}
                  busy={busy}
                  onSave={(hour) =>
                    action(
                      '/settings',
                      'PATCH',
                      { dailyHour: hour },
                      '采集时间已更新，按北京时间执行。',
                    )
                  }
                  onPassword={async (currentPassword, password) => {
                    await api('/auth/password', {
                      method: 'POST',
                      body: { currentPassword, password },
                    });
                    setToast('密码已更新，其他设备的会话已失效。');
                  }}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <span className="tiny-star">✦</span> 每一个小项目，都有自己的星空。
            </span>
            <span>
              RepoTrace v1.0 <span className="footer-separator">/</span> Made for your next big
              thing.
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal === 'add' && (
        <AddRepository
          onClose={() => setModal(null)}
          onAdded={async () => {
            setModal(null);
            setToast('项目已添加，正在建立第一份 Star 基线。');
            await refresh();
          }}
        />
      )}
      {modal && modal !== 'add' && (
        <Dialog
          title="移除这个项目？"
          subtitle={`${modal.full_name} 的全部快照和变化记录也会被删除。此操作无法撤销。`}
          onClose={() => setModal(null)}
        >
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              保留项目
            </button>
            <button
              className="button destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/repositories/${modal.id}`, { method: 'DELETE' });
                  if (repo === modal.id) chooseRepo('');
                  setModal(null);
                  setToast('项目及其历史数据已移除。');
                  if (repo !== modal.id) await refresh();
                } catch (e) {
                  setError(errorText(e));
                  setModal(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认移除
            </button>
          </div>
        </Dialog>
      )}
    </div>
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
    <article className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <p>{note}</p>
    </article>
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
        添加一个 GitHub 仓库，
        <br />
        今晚开始，为每一份关注留下记录。
      </p>
      <button className="button primary" onClick={onAdd}>
        <Plus size={17} />
        添加第一个项目
      </button>
      <small>支持公开仓库 · 私有仓库需配置 Token</small>
    </section>
  );
}
function AddRepository({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      title="让新项目加入观测"
      subtitle="输入 GitHub 仓库地址，剩下的交给 RepoTrace。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/repositories', { method: 'POST', body: { repository: value } });
            await onAdded();
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
          placeholder="owner/repository 或 https://github.com/…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          required
          maxLength={250}
        />
        <div className="dialog-tip">
          <Clock3 size={17} />
          <span>
            添加后立即建立初始基线，此后每日自动比对。
            <br />
            第一份快照不会把已有关注者计为新增。
          </span>
        </div>
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
              <Plus size={17} />
              开始监控
            </>
          )}
        </button>
      </form>
    </Dialog>
  );
}
function RepoCard({
  repository: r,
  busy,
  onSelect,
  onSync,
  embedded = false,
}: {
  repository: RepoSummary;
  busy: boolean;
  onSelect: () => void;
  onSync: () => void;
  embedded?: boolean;
}) {
  return (
    <article className={`repo-card ${embedded ? 'embedded' : ''}`}>
      <div className="repo-card-heading">
        <span className="repo-icon">
          <FolderGit2 size={21} />
        </span>
        <span className={`pill ${!r.enabled ? 'neutral' : r.lastError ? 'red' : 'green'}`}>
          <span className="status-dot" />
          {!r.enabled ? '已暂停' : r.lastError ? '需关注' : r.active ? '采集中' : '监控中'}
        </span>
      </div>
      <h3>
        <button onClick={onSelect}>{r.full_name}</button>
        <a
          href={`https://github.com/${r.full_name}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`在 GitHub 打开 ${r.full_name}`}
        >
          <ArrowUpRight size={16} />
        </a>
      </h3>
      <p className="repo-description">
        {r.description || '一个正在成长的项目，下一点星光值得期待。'}
      </p>
      <div className="repo-metrics">
        <strong>
          <Star size={17} />
          {r.latest ? number(r.latest.total) : '—'}
          <small>Stars</small>
        </strong>
        {r.latest?.comparison_id ? (
          <span className="repo-delta">
            <span className="positive">+{r.latest.added}</span>
            <span className="negative">−{r.latest.removed}</span>
          </span>
        ) : (
          <span className="muted tiny">{r.latest ? '初始基线' : '等待完整快照'}</span>
        )}
      </div>
      {r.active && (
        <div className="collection-progress">
          <progress
            value={r.active.total}
            max={Math.max(1, r.active.expected_total)}
            aria-label={`${r.full_name} 采集进度`}
          />
          <small>
            {r.active.error ||
              `已读取 ${number(r.active.total)} / ${number(r.active.expected_total)} 位关注者`}
          </small>
        </div>
      )}
      {r.lastError && (
        <p className="repo-error">
          {r.lastError}
          <button className="text-button" onClick={onSelect}>
            查看记录
          </button>
        </p>
      )}
      <div className="repo-card-footer">
        <span>
          {r.language && (
            <>
              <span className="language-dot" />
              {r.language}
              <span className="dot-separator">·</span>
            </>
          )}
          <Clock3 size={12} />
          {time(r.latest?.completed_at ?? null)}
        </span>
        <button
          className="icon-button"
          aria-label={`采集 ${r.full_name}`}
          title="手动采集完整快照"
          onClick={onSync}
          disabled={busy || !!r.active || !r.enabled}
        >
          <RefreshCw size={14} className={r.active && r.enabled ? 'spin' : ''} />
        </button>
      </div>
    </article>
  );
}

function Changes({
  data,
  repo,
  snapshot,
  kind,
  page,
  onSnapshot,
  onKind,
  onPage,
}: {
  data: Dashboard | null;
  repo: string;
  snapshot: string;
  kind: string;
  page: number;
  onSnapshot: (id: string) => void;
  onKind: (kind: string) => void;
  onPage: (page: number) => void;
}) {
  const selected = data?.snapshots.find((s) => s.id === snapshot);
  const snapshots =
    data?.snapshots.filter((s) => s.status === 'complete' && (!repo || s.repo_id === repo)) ?? [];
  return (
    <section className="panel changes-panel">
      <div className="panel-header">
        <div>
          <h2>
            Star 动态 <span className="label-tag">{data?.changeTotal ?? 0} 条</span>
          </h2>
          <p>
            {selected
              ? `${selected.day} ${kindLabel(selected.kind)} · ${selected.comparison_day ? `对比 ${selected.comparison_day} 的有效快照` : '初始基线，不计算新增与取消'}`
              : '各项目最近一份完整快照的变化'}
          </p>
        </div>
        <div className="snapshot-select">
          <select
            aria-label="选择快照"
            value={snapshot}
            onChange={(e) => onSnapshot(e.target.value)}
          >
            <option value="">最近完整快照</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.day} {kindLabel(s.kind)} · {!repo ? `${s.full_name} · ` : ''}
                {time(s.started_at)}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </div>
      <div className="change-tabs">
        {[
          { key: 'all', label: '全部变化' },
          { key: 'added', label: '新增 Star' },
          { key: 'removed', label: '取消 Star' },
        ].map((tab) => (
          <button
            key={tab.key}
            className={kind === tab.key ? 'selected' : ''}
            aria-pressed={kind === tab.key}
            onClick={() => onKind(tab.key)}
          >
            {tab.key === 'added' ? (
              <ArrowUpRight size={15} />
            ) : tab.key === 'removed' ? (
              <ArrowDownRight size={15} />
            ) : (
              <Activity size={15} />
            )}
            {tab.label}
          </button>
        ))}
      </div>
      {data?.changes.length ? (
        <>
          <div className="table-scroll">
            <table className="changes-table">
              <thead>
                <tr>
                  <th>GitHub 用户</th>
                  <th>项目</th>
                  <th>变化</th>
                  <th>
                    记录时间 <span className="tiny">UTC+8</span>
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.changes.map((c) => (
                  <tr key={`${c.snapshot_id}-${c.user_id}`}>
                    <td>
                      <a
                        className="user-cell"
                        href={`https://github.com/${c.login}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={`https://avatars.githubusercontent.com/u/${c.user_id}?s=80`}
                          alt=""
                          loading="lazy"
                          width="34"
                          height="34"
                        />
                        <span>
                          <strong>{c.login}</strong>
                          <small>GitHub 开发者</small>
                        </span>
                      </a>
                    </td>
                    <td>
                      <span className="repo-table-name">
                        <FolderGit2 size={14} />
                        {c.full_name}
                      </span>
                    </td>
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
                        className="icon-button"
                        href={`https://github.com/${c.login}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`查看 ${c.login} 的 GitHub 主页`}
                      >
                        <ArrowUpRight size={16} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              共 {number(data.changeTotal)} 条记录 · 第 {page} 页
            </span>
            <div>
              <button
                className="icon-button"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
                aria-label="上一页"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                disabled={page * 30 >= data.changeTotal}
                onClick={() => onPage(page + 1)}
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
          <strong>{snapshots.length ? '平静也是一种状态' : '第一束星光，还在路上'}</strong>
          <p>
            {snapshots.length
              ? '所选快照和筛选下暂无变化。新的关注会在下一次完整采集后出现。'
              : '建立初始基线后，后续快照会告诉你谁来了、谁离开了。'}
          </p>
        </div>
      )}
      <div className="table-note">
        <HelpCircle size={14} />
        记录时间是采集完成时间；取消 Star 的具体发生时间无法由 GitHub 获取。
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  busy,
  onSave,
  onPassword,
}: {
  settings: Settings;
  busy: boolean;
  onSave: (hour: number) => Promise<void>;
  onPassword: (current: string, password: string) => Promise<void>;
}) {
  const [hour, setHour] = useState(settings.dailyHour);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setHour(settings.dailyHour), [settings.dailyHour]);
  return (
    <div className="settings-grid">
      <div>
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="settings-icon">
              <Moon size={21} />
            </span>
            <div>
              <h2>每日采集计划</h2>
              <p>在夜晚记录项目，让白天留给创造。</p>
            </div>
          </div>
          <label htmlFor="daily-hour">每日开始时间</label>
          <div className="schedule-input">
            <select id="daily-hour" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {String(i).padStart(2, '0')}:00
                </option>
              ))}
            </select>
            <span>北京时间 · Asia/Shanghai（UTC+8）</span>
          </div>
          <p className="field-note">
            定时器每分钟检查一次并续跑未完成任务。大仓库会分批采集；仅完整快照参与每日比对。修改时间不会重复生成同一天的每日快照。
          </p>
          <button
            className="button primary"
            disabled={busy || hour === settings.dailyHour}
            onClick={() => void onSave(hour)}
          >
            <Check size={16} />
            保存计划
          </button>
        </section>
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
          <span className={`pill ${settings.githubTokenConfigured ? 'green' : 'neutral'}`}>
            <span className="status-dot" />
            {settings.githubTokenConfigured ? '已配置 GitHub Token' : '使用匿名 API'}
          </span>
          <p className="field-note">
            {settings.githubTokenConfigured
              ? '使用配置的 Token 读取仓库与关注者。若权限不足或 Token 过期，会在采集记录中显示。'
              : '匿名访问通常只有每小时 60 次请求。建议添加只读 GitHub Token，提高额度并支持私有仓库。'}
          </p>
          <div className="token-guide">
            <strong>配置方式</strong>
            <p>
              在 Cloudflare Worker 的「设置 → 变量和机密」中添加机密 <code>GITHUB_TOKEN</code>
              ，然后重新部署。Token 仅保存在服务器端。
            </p>
          </div>
        </section>
        <section className="panel settings-panel future-panel">
          <span className="eyebrow">ROOM TO GROW</span>
          <h2>不止于 Star</h2>
          <p className="field-note">第一版先专注关注度。更多维度，留给未来的项目故事。</p>
          <div className="future-metric">
            <Star size={17} />
            <span>Star 关注度</span>
            <span className="pill green">已开启</span>
          </div>
          <div className="future-metric muted">
            <GitFork size={17} />
            <span>Fork 与贡献</span>
            <span className="tiny">后续扩展</span>
          </div>
          <div className="future-metric muted">
            <Bell size={17} />
            <span>Issue 与 Release</span>
            <span className="tiny">后续扩展</span>
          </div>
        </section>
      </div>
    </div>
  );
}
