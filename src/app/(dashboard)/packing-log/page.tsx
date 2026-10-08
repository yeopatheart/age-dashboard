import { createClient } from '@/lib/supabase/server';
import { PackingLogClient } from './packing-log-client';

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

export default async function PackingLogPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const orderDate = date ?? todayKST();
  const supabase = await createClient();

  const { data: dailies } = await supabase
    .from('daily_businesses')
    .select('id, business_id, business_number')
    .eq('order_date', orderDate)
    .order('business_number');
  const dailyRows = dailies ?? [];
  const dailyIds = dailyRows.map((d) => d.id);

  const [{ data: businesses }, { data: items }, { data: usages }, { data: boxes }] = await Promise.all([
    supabase.from('businesses').select('id, name').in('id', dailyRows.map((d) => d.business_id)),
    dailyIds.length
      ? supabase
          .from('order_items')
          .select('id, daily_business_id, product_sequence, product_name_raw, quantity, unit, measured_weight_kg, change_status')
          .in('daily_business_id', dailyIds)
          .order('product_sequence')
      : Promise.resolve({ data: [] }),
    dailyIds.length
      ? supabase.from('daily_business_boxes').select('id, daily_business_id, box_id, quantity').in('daily_business_id', dailyIds)
      : Promise.resolve({ data: [] }),
    supabase.from('boxes').select('id, name, is_active').order('name'),
  ]);

  const nameById = new Map((businesses ?? []).map((b) => [b.id, b.name]));

  const rows = dailyRows.map((d) => ({
    id: d.id,
    number: d.business_number,
    businessName: nameById.get(d.business_id) ?? '',
    items: (items ?? [])
      .filter((i) => i.daily_business_id === d.id && i.change_status !== 'cancelled')
      .map((i) => ({
        id: i.id,
        name: i.product_name_raw,
        quantity: Number(i.quantity),
        unit: i.unit,
        weightKg: i.measured_weight_kg == null ? null : Number(i.measured_weight_kg),
      })),
    usages: (usages ?? [])
      .filter((u) => u.daily_business_id === d.id)
      .map((u) => ({ id: u.id, boxId: u.box_id, quantity: u.quantity })),
  }));

  return <PackingLogClient orderDate={orderDate} rows={rows} boxes={boxes ?? []} />;
}
