// 메뉴를 옮길 때 서버가 데이터를 읽는 동안 바로 보이는 화면. 이 파일이 없으면 이전 화면이 그대로 멈춰 있다가 한 번에 바뀐다.
// 사이드바(layout)는 그대로 두고 본문만 뼈대로 바뀐다.
export default function Loading() {
  return (
    <div className="animate-pulse" role="status" aria-label="불러오는 중" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ height: '2.5rem', width: '12rem', borderRadius: 10, background: '#e2e8f0' }} />
      <div style={{ height: '3rem', borderRadius: 12, background: '#e2e8f0', opacity: 0.7 }} />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ height: '2.75rem', borderRadius: 10, background: '#e2e8f0', opacity: 0.5 }} />
      ))}
    </div>
  );
}
