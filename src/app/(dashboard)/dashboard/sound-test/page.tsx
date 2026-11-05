import { requireMenu } from '@/lib/permissions/access';
import { SoundTestClient } from './sound-test-client';

export default async function SoundTestPage() {
  await requireMenu('dashboard');
  return <SoundTestClient />;
}
