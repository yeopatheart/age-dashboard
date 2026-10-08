'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import {
  LayoutDashboard,
  Sparkles,
  Building2,
  MapPinned,
  Package,
  ClipboardList,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/orders/new', label: '주문 입력', icon: Sparkles },
  { href: '/businesses', label: '고객사 관리', icon: Building2 },
  { href: '/terminals', label: '터미널 관리', icon: MapPinned },
  { href: '/boxes', label: '박스 관리', icon: Package },
  { href: '/packing-log', label: '박스 기록', icon: ClipboardList },
];

const COLLAPSE_STORAGE_KEY = 'age-dashboard-sidebar-collapsed';

export function DashboardShell({
  displayName,
  children,
}: {
  displayName: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // 새로고침해도 접힘 상태가 유지되도록 마운트 후 복원한다. 서버 렌더는 항상 펼침 상태라
  // 접혀 있던 사용자는 아주 짧게 펼침→접힘으로 바뀌는 걸 볼 수 있지만(테마처럼 크게 눈에
  // 띄는 전환은 아니라) 감수할 만한 수준이다.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
    } catch {
      // localStorage가 막혀있으면(시크릿 모드 등) 그냥 펼친 상태로 둔다
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // 저장 실패해도 이번 세션 안에서는 토글 자체는 동작하게 둔다
      }
      return next;
    });
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  // 모바일 오버레이가 열려있을 땐 항상 펼친 모습으로 보여준다 — collapsed는 데스크톱 레일 전용
  // 상태라, 좁은 화면에서까지 아이콘만 보이면 오히려 못 쓰게 된다.
  const effectiveCollapsed = collapsed && !sidebarOpen;

  return (
    <div className="app-shell">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''} ${effectiveCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <Image src="/logo-navy.png" alt="통영아재수산" width={26} height={26} unoptimized priority />
          </div>
          {!effectiveCollapsed && (
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-name">통영아재수산</span>
              <span className="sidebar-brand-sub">주문 관리 시스템</span>
            </div>
          )}
          <button
            className="sidebar-collapse-btn"
            onClick={toggleCollapsed}
            title={effectiveCollapsed ? '펼치기' : '접기'}
          >
            {effectiveCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          <button
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {!effectiveCollapsed && <p className="sidebar-nav-label">메뉴</p>}
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`sidebar-nav-item ${active ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
                title={effectiveCollapsed ? label : undefined}
              >
                <Icon size={18} />
                {!effectiveCollapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User info at bottom */}
        <div className="sidebar-footer">
          <div className="sidebar-user" title={effectiveCollapsed ? displayName : undefined}>
            <div className="sidebar-avatar">{displayName[0]}</div>
            {!effectiveCollapsed && (
              <div className="sidebar-user-info">
                <p className="sidebar-user-name">{displayName}</p>
              </div>
            )}
          </div>
          <button className="sidebar-logout" onClick={handleLogout} title="로그아웃">
            <LogOut size={16} />
            {!effectiveCollapsed && <span>로그아웃</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-wrapper">
        {/* Top bar (mobile) */}
        <header className="topbar">
          <button
            className="topbar-menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="topbar-brand">
            <Image src="/logo-navy.png" alt="통영아재수산" width={20} height={20} unoptimized priority />
            <span>통영아재수산</span>
          </div>
          <div className="topbar-user">
            <div className="sidebar-avatar" style={{ width: 32, height: 32, fontSize: '0.8rem' }}>
              {displayName[0]}
            </div>
          </div>
        </header>

        <main className={`main-content animate-fade-in ${pathname === '/dashboard' ? 'main-content-tight' : ''}`}>
          {children}
        </main>
      </div>

      <style>{`
        .app-shell {
          display: flex;
          height: 100vh;
          overflow: hidden;
          background: var(--background);
        }

        /* ── Sidebar ── */
        .sidebar {
          width: var(--sidebar-width);
          min-width: var(--sidebar-width);
          background: var(--primary);
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          z-index: 50;
          transition: width 0.2s ease, min-width 0.2s ease, transform 0.25s ease;
        }
        .sidebar.sidebar-collapsed {
          width: var(--sidebar-width-collapsed);
          min-width: var(--sidebar-width-collapsed);
        }
        .sidebar-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 40;
        }
        .sidebar-brand {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1.375rem 1.125rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .sidebar-collapsed .sidebar-brand { justify-content: center; padding: 1.375rem 0.5rem; }
        .sidebar-logo {
          width: 38px;
          height: 38px;
          background: #ffffff;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          overflow: hidden;
        }
        .sidebar-brand-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .sidebar-brand-name {
          font-size: 0.9375rem;
          font-weight: 700;
          color: #ffffff;
          letter-spacing: -0.01em;
          line-height: 1.2;
          white-space: nowrap;
        }
        .sidebar-brand-sub {
          font-size: 0.7rem;
          color: rgba(255,255,255,0.55);
          margin-top: 1px;
        }
        .sidebar-close {
          display: none;
          background: none;
          border: none;
          color: rgba(255,255,255,0.6);
          cursor: pointer;
          padding: 0.25rem;
        }
        .sidebar-nav {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 1.25rem 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .sidebar-collapsed .sidebar-nav { padding: 1.25rem 0.625rem; align-items: center; }
        .sidebar-nav-label {
          font-size: 0.65rem;
          font-weight: 700;
          color: rgba(255,255,255,0.4);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 0 0.5rem;
          margin-bottom: 0.5rem;
        }
        .sidebar-nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.7rem 0.75rem;
          border-radius: 0.5rem;
          color: rgba(255,255,255,0.75);
          text-decoration: none;
          font-size: 0.875rem;
          font-weight: 500;
          transition: background-color 0.15s ease, color 0.15s ease;
          position: relative;
          white-space: nowrap;
          width: 100%;
        }
        .sidebar-collapsed .sidebar-nav-item {
          width: 44px;
          height: 44px;
          padding: 0;
          justify-content: center;
        }
        .sidebar-nav-item:hover {
          background: rgba(255,255,255,0.1);
          color: #ffffff;
        }
        .sidebar-nav-item.active {
          background: rgba(255,255,255,0.18);
          color: #ffffff;
          font-weight: 600;
        }
        .sidebar-nav-item.active::before {
          content: '';
          position: absolute;
          left: -0.75rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          background: #ffffff;
          border-radius: 0 3px 3px 0;
        }
        .sidebar-collapsed .sidebar-nav-item.active::before { left: -0.625rem; }
        .sidebar-collapse-btn {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          background: rgba(255,255,255,0.1);
          border: none;
          color: rgba(255,255,255,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: background-color 0.15s ease, color 0.15s ease;
        }
        .sidebar-collapse-btn:hover {
          background: rgba(255,255,255,0.2);
          color: #ffffff;
        }
        .sidebar-footer {
          padding: 0.875rem 0.75rem;
          border-top: 1px solid rgba(255,255,255,0.1);
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
        }
        .sidebar-collapsed .sidebar-footer { padding: 0.875rem 0.625rem; align-items: center; }
        .sidebar-user {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.5rem 0.5rem;
        }
        .sidebar-collapsed .sidebar-user { padding: 0.5rem 0; justify-content: center; }
        .sidebar-avatar {
          width: 36px;
          height: 36px;
          background: rgba(255,255,255,0.2);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.875rem;
          font-weight: 700;
          color: #ffffff;
          flex-shrink: 0;
          border: 1.5px solid rgba(255,255,255,0.3);
        }
        .sidebar-user-info { flex: 1; min-width: 0; }
        .sidebar-user-name {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sidebar-logout {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.6rem 0.75rem;
          border-radius: var(--radius);
          color: rgba(255,255,255,0.65);
          background: none;
          border: 1px solid rgba(255,255,255,0.15);
          cursor: pointer;
          font-size: 0.8125rem;
          font-family: var(--font-sans);
          font-weight: 500;
          width: 100%;
          transition: all 0.15s;
        }
        .sidebar-collapsed .sidebar-logout { width: 44px; height: 40px; padding: 0; }
        .sidebar-logout:hover {
          background: rgba(239,68,68,0.2);
          border-color: rgba(239,68,68,0.4);
          color: #fca5a5;
        }

        /* ── Main ── */
        .main-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }
        .topbar {
          display: none;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 1rem;
          background: #fff;
          border-bottom: 1px solid var(--border);
          box-shadow: var(--shadow-sm);
        }
        .topbar-menu {
          background: none;
          border: none;
          color: var(--primary);
          cursor: pointer;
          padding: 0.25rem;
          display: flex;
        }
        .topbar-brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 700;
          font-size: 0.9375rem;
          color: var(--primary);
          flex: 1;
        }
        .topbar-user { margin-left: auto; }
        .main-content {
          flex: 1;
          overflow-y: auto;
          /* overflow-y만 auto로 두면 overflow-x가 자동으로 auto로 계산되는 CSS 규칙 때문에
             이 레이어에도 숨은 가로 스크롤 컨테이너가 하나 더 생긴다 — 대시보드 표처럼
             안쪽에서 이미 자기 스크롤을 관리하는 화면에서 바깥쪽이 먼저 잘라버리는(클리핑)
             사고가 나므로, 명시적으로 꺼서 가로 스크롤은 항상 안쪽 컴포넌트가 책임지게 한다. */
          overflow-x: hidden;
          padding: 2.25rem 2.5rem;
        }
        /* 대시보드는 TV로 보는 표 화면이라 여백을 최소화해서 표 영역을 최대한 넓힌다. */
        .main-content-tight {
          padding: 12px 16px;
        }

        @media (max-width: 768px) {
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: var(--sidebar-width);
            min-width: var(--sidebar-width);
            transform: translateX(-100%);
          }
          .sidebar.sidebar-open {
            transform: translateX(0);
            box-shadow: var(--shadow-lg);
          }
          .sidebar-collapse-btn { display: none; }
          .sidebar-overlay { display: block; }
          .sidebar-close { display: flex; }
          .topbar { display: flex; }
          .main-content { padding: 1.25rem; }
          .main-content-tight { padding: 8px 10px; }
        }
      `}</style>
    </div>
  );
}
