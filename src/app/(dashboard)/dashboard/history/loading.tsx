// 이력을 읽는 동안 보이는 뼈대. 화면 모양을 미리 잡아 두어 목록·표가 나타날 때 흔들리지 않게 한다.
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6" aria-busy="true" aria-label="필기 이력을 불러오는 중">
      <div className="h-10 w-56 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-200" />
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-9 w-80 animate-pulse rounded-lg bg-slate-200" />
          <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    </div>
  );
}
