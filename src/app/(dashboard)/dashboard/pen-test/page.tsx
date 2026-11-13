import { requireMenu } from '@/lib/permissions/access';
import { PenTestClient } from './pen-test-client';

export default async function PenTestPage() {
  await requireMenu('dashboard');
  return <PenTestClient />;
}
