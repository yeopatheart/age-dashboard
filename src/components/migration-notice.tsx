// DB 마이그레이션이 아직 적용되지 않았을 때 화면 대신(또는 위에) 보여 주는 안내. 서버·클라이언트 어디서나 쓴다.
export function MigrationNotice({ feature, migrations }: { feature: string; migrations: string[] }) {
  return (
    <div
      role="alert"
      style={{ border: '1px solid #fdba74', background: '#fff7ed', color: '#9a3412', borderRadius: 12, padding: '0.9rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.875rem', lineHeight: 1.55 }}
    >
      <strong>{feature}: 데이터베이스 업데이트가 필요합니다.</strong>
      <span>
        아직 적용되지 않은 마이그레이션이 있습니다:{' '}
        {migrations.length > 0 ? migrations.map((m) => <code key={m} style={{ marginRight: 6 }}>supabase/migrations/{m}</code>) : '(파일 이름을 알 수 없습니다. 최근 마이그레이션을 확인하세요)'}
        . Supabase SQL 편집기에서 해당 파일의 내용을 번호 순서대로 한 번씩 실행한 뒤 이 화면을 새로고침하세요.
      </span>
    </div>
  );
}
