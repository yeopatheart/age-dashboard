import { createClient } from '@/lib/supabase/server';
import { ProductsClient } from './products-client';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';

export default async function ProductsPage() {
  const accessCheck = requireMenu('products'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  // 1000개를 넘을 수 있어 페이지로 나눠 모두 읽는다. 조회 오류(예: 적용 안 된 마이그레이션)를 빈 목록으로 삼키지 않고 던진다.
  const [, products] = await Promise.all([
    accessCheck,
    fetchAll((from, to) => supabase.from('products').select('id, name, created_at, created_via, fill_color, border_color, needs_mulbong').order('name').order('id').range(from, to), '상품 조회 실패: '),
  ]);

  return <ProductsClient products={products} />;
}
