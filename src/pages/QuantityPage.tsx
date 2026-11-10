import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell } from '../components/Shell';
import QuantitySheet from '../components/QuantitySheet';
import LocationPicker from '../components/LocationPicker';
import { Btn, Empty } from '../components/ui';
import { go, goBack } from '../router';
import { useState } from 'react';

/** Screen 8 as a route (from the product database). The scanner uses the same sheet in-place. */
export default function QuantityPage({ id }: { id: string }) {
  const { t, sessionId, locationId } = useApp();
  const [pick, setPick] = useState(false);
  const product = useLiveQuery(async () => {
    const p = await db.products.get(id);
    return p?.mergedInto ? db.products.get(p.mergedInto) : p;
  }, [id]);

  if (product === undefined) return <Shell title={t('qty')} noNav><div /></Shell>;
  if (!product) return <Shell title={t('qty')} back noNav><Empty icon="alert" title={t('err.NOT_FOUND')} /></Shell>;
  if (!sessionId) return <Shell title={t('qty')} back><Empty icon="layers" title={t('home.noSession')} action={<Btn variant="primary" onClick={() => go('/sessions')}>{t('sessions')}</Btn>} /></Shell>;
  if (!locationId)
    return (
      <Shell title={t('qty')} back>
        <Empty icon="pin" title={t('scan.needLocation')} action={<Btn variant="primary" onClick={() => setPick(true)}>{t('loc.choose')}</Btn>} />
        <LocationPicker open={pick} onClose={() => setPick(false)} />
      </Shell>
    );
  return (
    <Shell title={product.name} noNav>
      <QuantitySheet product={product} onDone={() => go('/scan', true)} onCancel={() => goBack('/products')} />
    </Shell>
  );
}
