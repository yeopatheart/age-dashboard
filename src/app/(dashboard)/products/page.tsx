import { createClient } from '@/lib/supabase/server';
import { ProductsClient } from './products-client';

export default async function ProductsPage() {
  const supabase = await createClient();
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, created_at, created_via, fill_color, border_color')
    .order('name');

  // 조회 오류(예: 적용 안 된 마이그레이션)를 빈 목록으로 삼키지 않는다.
  if (error) throw new Error(`상품 조회 실패: ${error.message}`);

  return <ProductsClient products={products ?? []} />;
}
