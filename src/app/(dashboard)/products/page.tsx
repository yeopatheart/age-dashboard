import { createClient } from '@/lib/supabase/server';
import { ProductsClient } from './products-client';

export default async function ProductsPage() {
  const supabase = await createClient();
  const { data: products } = await supabase
    .from('products')
    .select('id, name, created_at, created_via, fill_color, border_color')
    .order('name');

  return <ProductsClient products={products ?? []} />;
}
