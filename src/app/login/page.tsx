'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { logLoginEvent } from './actions';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (signInError) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      return;
    }

    await logLoginEvent();
    router.push('/dashboard');
  };

  return (
    <div className="login-root">
      <div className="login-card">
        {/* Logo / Brand */}
        <div className="login-brand">
          <div className="login-logo">
            <Image src="/logo-navy.png" alt="통영아재수산" width={38} height={38} unoptimized priority />
          </div>
          <h1 className="login-title">통영아재수산</h1>
          <p className="login-subtitle">관리자 로그인</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="email" className="login-label">이메일</label>
            <input
              id="email"
              type="email"
              className="input-field"
              placeholder="이메일을 입력하세요"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="password" className="login-label">비밀번호</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: '2.75rem' }}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary login-btn"
            disabled={loading || !email || !password}
          >
            {loading ? (
              <span className="login-loading">
                <span className="spinner" />
                로그인 중...
              </span>
            ) : '로그인'}
          </button>
        </form>
      </div>

      <style>{`
        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #001d38 0%, #003057 50%, #004a80 100%);
          padding: 1.5rem;
        }
        .login-card {
          width: 100%;
          max-width: 420px;
          background: #ffffff;
          border-radius: 1.25rem;
          box-shadow: 0 20px 50px rgba(0,20,40,0.28), 0 2px 8px rgba(0,20,40,0.12);
          overflow: hidden;
          animation: fadeIn 0.45s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .login-brand {
          background: var(--primary);
          padding: 2.5rem 2rem 2rem;
          text-align: center;
        }
        .login-logo {
          width: 56px;
          height: 56px;
          background: #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
          overflow: hidden;
        }
        .login-title {
          font-size: 1.75rem;
          font-weight: 800;
          color: #ffffff;
          letter-spacing: -0.02em;
          margin-bottom: 0.25rem;
        }
        .login-subtitle {
          font-size: 0.9rem;
          color: rgba(255,255,255,0.7);
          font-weight: 400;
        }
        .login-form {
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .login-field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .login-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--primary);
        }
        .password-toggle {
          position: absolute;
          right: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #94a3b8;
          display: flex;
          align-items: center;
          padding: 0;
          transition: color 0.15s;
        }
        .password-toggle:hover { color: var(--primary); }
        .login-error {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          background: var(--danger-bg);
          border: 1px solid #fecaca;
          border-radius: var(--radius);
          color: var(--danger);
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .login-btn {
          width: 100%;
          height: 2.75rem;
          font-size: 1rem;
          border-radius: var(--radius);
          margin-top: 0.25rem;
        }
        .login-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
